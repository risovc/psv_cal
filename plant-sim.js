/**
 * PSVCalc Pro — Step 8 Interactive 3D Process Plant & Contactor Simulation Core (plant-sim.js)
 * --------------------------------------------------------------------------------------------
 * Pure, deterministic chemical engineering solver coupling:
 *   - Step 0: GPSA / ASME VIII Vessel Sizing (V-1001 geometry, levels, wall thickness)
 *   - Steps 1-3: API 521 / 520 / 526 PSV Sizing & Line Hydraulics (PSV-1001A, inlet 3%, Mach)
 *   - Step 4: API 610 / IEC 60534 Pump & Control Valve Loop (P-3102A/B, FCV-1014)
 *   - Step 7: 20-Component Peng-Robinson (1976/1978) EOS Flash (tools/fluid-props.js)
 *
 * Solves:
 *   1. Inlet 2/3-Phase Separator (V-1001) PR EOS flash with interactive binary interaction
 *      parameters k_ij (C1-C5+, CO2-HC, H2S-HC), Weinaug-Katz surface tension, Hinze/Sauter
 *      oil droplet diameter d_32, Schiller-Naumann droplet terminal settling velocity v_t,
 *      and Souders-Brown mist carryover.
 *   2. Multi-stage Trayed Gas-Liquid Contactor (C-1001, N = 6..24 sieve trays): stagewise
 *      Kremser-Edmister countercurrent absorption + exothermic absorption temperature bulge,
 *      Francis weir froth height, and Fair / Souders-Brown jet-flood % per tray.
 *   3. Sales Gas & Stabilized Oil / Condensate Specification Evaluator (ON-SPEC vs OFF-SPEC).
 *   4. Complete 7-Unit & 8-Stream (S-01 .. S-08) telemetry dictionary in both Normal Operation
 *      and Overpressure PSV Relief Simulation modes.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const engine = require('./engine.js');
    const fluidProps = require('./tools/fluid-props.js');
    module.exports = factory(engine, fluidProps);
  } else {
    const fp = root.PSVTools && typeof root.PSVTools.get === 'function'
      ? root.PSVTools.get('fluid-props')
      : null;
    root.PSVPlantSim = factory(root.PSVEngine, fp);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (Engine, FluidProps) {
  'use strict';

  const G_ACCEL = 9.80665;
  const R_GAS = 8.314462618;
  const HEAVY_IDS = new Set(['iC5', 'nC5', 'nC6', 'nC7', 'nC8', 'nC9', 'nC10', 'BENZ', 'TOL', 'PSEUDO']);
  const LIGHT_IDS = new Set(['C1', 'C2']);

  const KIJ_PRESETS = {
    typical: {
      id: 'typical',
      label: 'GPA / DECHEMA Typical (On-Spec Baseline)',
      kijC1Heavy: 0.045,
      kijCo2Hc: 0.120,
      kijH2sHc: 0.080
    },
    zero: {
      id: 'zero',
      label: 'Ideal Mixing (k_ij = 0.000)',
      kijC1Heavy: 0.000,
      kijCo2Hc: 0.000,
      kijH2sHc: 0.000
    },
    retrograde: {
      id: 'retrograde',
      label: 'High Solvation / Swollen Oil (k_ij < 0)',
      kijC1Heavy: -0.085,
      kijCo2Hc: -0.030,
      kijH2sHc: -0.025
    },
    high: {
      id: 'high',
      label: 'Strong Non-Ideality / High Gas Reject (k_ij High)',
      kijC1Heavy: 0.210,
      kijCo2Hc: 0.220,
      kijH2sHc: 0.190
    }
  };

  function defaultSimControls() {
    return {
      kijPreset: 'typical',
      kijC1Heavy: 0.045,
      kijCo2Hc: 0.120,
      kijH2sHc: 0.080,
      trayCount: 12,
      lvRatio: 0.78,
      tempOffsetC: 0.0,
      operatingMode: 'normal', // 'normal' | 'relief'
      cutawayPct: 78,          // 0 (solid shell) .. 100 (full cutaway)
      autoRotate: false,
      selectedEntity: { kind: 'unit', id: 'C-1001' }
    };
  }

  function clamp(v, lo, hi, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  /**
   * Schiller-Naumann (1933) iterative terminal settling velocity [m/s] for a spherical
   * liquid oil droplet of diameter d_m [m] in gas of density rhoG [kg/m3] and viscosity muG [Pa.s].
   */
  function calcDropletTerminalVelocity(dMeter, rhoL, rhoG, muGPaS) {
    const dRho = Math.max(1.0, rhoL - rhoG);
    const rhoVap = Math.max(0.15, rhoG);
    const mu = Math.max(5e-6, muGPaS);
    const d = Math.max(15e-6, dMeter);
    // Start with Stokes estimate clamped to turbulent Newton regime
    let vt = Math.min(2.5, (G_ACCEL * d * d * dRho) / (18 * mu));
    vt = Math.max(0.005, vt);
    for (let iter = 0; iter < 18; iter++) {
      const Re = Math.max(1e-4, (rhoVap * vt * d) / mu);
      const Cd = Re > 1000 ? 0.44 : (24 / Re) * (1 + 0.15 * Math.pow(Re, 0.687));
      const vtNext = Math.sqrt((4 * G_ACCEL * d * dRho) / (3 * Cd * rhoVap));
      vt = 0.5 * (vt + vtNext);
    }
    const ReFinal = (rhoVap * vt * d) / mu;
    const CdFinal = ReFinal > 1000 ? 0.44 : (24 / Math.max(1e-4, ReFinal)) * (1 + 0.15 * Math.pow(Math.max(1e-4, ReFinal), 0.687));
    return { vtMS: vt, reynolds: ReFinal, dragCoeff: CdFinal };
  }

  /**
   * Build effective feed composition from Step 7 fluid-props state (or realistic sour/rich
   * HP gas-condensate default when empty), ensuring sour AGRU tags have trace H2S/CO2 if
   * the user has not customized H2S yet so acid-gas contactor physics are observable.
   */
  function resolveFeedComposition(fluidState, tag) {
    const defComps = {
      N2: 0.005, CO2: 0.026, H2S: 0.0032,
      C1: 0.585, C2: 0.098, C3: 0.078,
      iC4: 0.028, nC4: 0.038, iC5: 0.020, nC5: 0.020,
      nC6: 0.030, nC7: 0.032, nC8: 0.020, nC9: 0.011, nC10: 0.006
    };
    const raw = (fluidState && fluidState.comps && typeof fluidState.comps === 'object')
      ? { ...fluidState.comps }
      : { ...defComps };

    let sum = 0;
    Object.keys(raw).forEach(k => {
      const v = Number(raw[k]);
      raw[k] = Number.isFinite(v) && v > 0 ? v : 0;
      sum += raw[k];
    });
    if (sum <= 1e-9) return { ...defComps };

    // If user is on the untouched hpsep default (H2S absent/0) and service is AGRU/sour/absorber,
    // seed 0.32 mol% (3200 ppmv) H2S so the amine/solvent contactor demonstrates H2S sweetening.
    const svc = String((tag && tag.service) || '') + ' ' + String((tag && tag.equipmentProtected) || '');
    const isUntouchedHpSep = (!fluidState || !fluidState._preset || fluidState._preset === 'hpsep') &&
      !(Number(raw.H2S) > 0) && Math.abs((raw.C1 || 0) - 0.59) < 0.02;
    if (isUntouchedHpSep && /acid|agru|amine|sour|contactor|absorber/i.test(svc)) {
      raw.H2S = 0.0032 * sum;
      raw.CO2 = Math.max(raw.CO2 || 0, 0.026 * sum);
    }
    return raw;
  }

  /**
   * Main plant simulation entry point.
   * @param {Object} bundle - { tag, sizing, hyd, vessel, vesselRes, pumpLoop, pumpRes, fluidState, sim }
   */
  function simulatePlant(bundle) {
    bundle = bundle || {};
    const sim = { ...defaultSimControls(), ...(bundle.sim || {}) };
    const kijC1Heavy = clamp(sim.kijC1Heavy, -0.20, 0.35, 0.045);
    const kijCo2Hc = clamp(sim.kijCo2Hc, -0.15, 0.35, 0.120);
    const kijH2sHc = clamp(sim.kijH2sHc, -0.15, 0.35, 0.080);
    const trayCount = Math.round(clamp(sim.trayCount, 6, 24, 12));
    const lvRatio = clamp(sim.lvRatio, 0.15, 2.50, 0.78);
    const tempOffsetC = clamp(sim.tempOffsetC, -30, 45, 0);
    const isRelief = sim.operatingMode === 'relief';

    // Pull workbench context (with fallbacks for standalone Node unit tests)
    const tag = bundle.tag || (Engine && Engine.EPC_TAG_PRESETS ? Engine.EPC_TAG_PRESETS[0] : {
      tagNumber: 'PSV-1001A',
      service: 'AGRU Acid Gas Absorber Overhead',
      equipmentProtected: 'C-1001 (Amine Contactor Column)',
      fluidPhase: 'gas',
      valveType: 'bellows',
      operatingPressureBarg: 52.0,
      setPressureBarg: 58.0,
      overpressurePct: 10.0,
      atmPressureBara: 1.01325,
      flowRateKgHr: 42500,
      relievingTempC: 58.0,
      superimposedBackBarg: 3.5,
      inletNps: '6"',
      outletNps: '8"'
    });
    const atmBara = clamp(tag.atmPressureBara, 0.5, 1.5, 1.01325);

    const sizing = bundle.sizing || (Engine && Engine.sizeOrificeApi520 ? Engine.sizeOrificeApi520(tag) : {
      P1_bara: (tag.setPressureBarg || 58) * 1.1 + atmBara,
      reqAreaMm2: 1203.8,
      selectedOrifice: { letter: 'L', areaMm2: 1841, inletOutFlange: '4" x 6"' },
      ratedCapacityKgHr: 64900,
      flowRegime: 'Critical (Choked)'
    });
    const hyd = bundle.hyd || (Engine && Engine.calcLineHydraulicsApi520Part2
      ? Engine.calcLineHydraulicsApi520Part2(tag, sizing)
      : {
          inlet: { nps: '6"', lossPctOfSet: 1.58, passes3Pct: true, dP_totalBar: 0.92 },
          outlet: { nps: '8"', totalBackPctOfSet: 13.9, passesBackpressure: true, machNumber: 0.44, reactionForceKn: 14.2, builtUpBackBarg: 4.55 }
        });

    const vesselInput = bundle.vessel || (Engine && Engine.VESSEL_SIZING_PRESETS ? Engine.VESSEL_SIZING_PRESETS[0] : {});
    const vesselRes = bundle.vesselRes || (Engine && Engine.calcVesselSizingFromScratch
      ? Engine.calcVesselSizingFromScratch({ ...vesselInput, atmPressureBara: atmBara })
      : {
          vesselTag: 'V-1001',
          service: 'HP Inlet 3-Phase Production Separator',
          orientation: 'horizontal',
          operatingPressureBarg: 48,
          designPressureBarg: 55,
          geometry: { diameterM: 2.4, lengthM: 8.5, diameterMm: 2400, lengthMm: 8500, ldRatio: 3.54, levels: { lllM: 0.45, nllM: 1.05, hllM: 1.35 } },
          separation: { effectiveKsbMS: 0.088, actualVaporVelMS: 0.062, vaporVelUtilizationPct: 70.5, vaporCompliant: true },
          mechanical: { tShellSelectedMm: 52, mawpCorrodedBarg: 56.8, emptyWeightKg: 38200 }
        });

    const pumpInput = bundle.pumpLoop || (Engine && Engine.PUMP_LOOP_PRESETS ? Engine.PUMP_LOOP_PRESETS[0] : { pumpTag: 'P-3102A/B', service: 'Lean Amine Booster Pump' });
    const pumpRes = bundle.pumpRes || (Engine && Engine.calcPumpLoopHydraulics
      ? Engine.calcPumpLoopHydraulics({ ...pumpInput, atmPressureBara: atmBara })
      : {
          Q_ratedM3Hr: 145, W_ratedKgHr: 152000, rhoKgM3: 1048, tempC: 45,
          pump: { tdhRatedM: 565, maxDischargeBarg: 68.5, selectedMotorKw: 315, diffPressureRatedBar: 58.1 },
          npsh: { npshaM: 14.2, npshrM: 6.5, marginM: 7.7, compliant: true },
          suction: { nps: '8"', velocityMS: 1.42 },
          discharge: { nps: '6"', velocityMS: 2.38 },
          controlValve: { allocatedDpRatedBar: 6.8, normal: { reqCv: 84 }, rated: { reqCv: 108 } }
        });

    const fluidState = bundle.fluidState || (FluidProps && FluidProps.defaultState ? FluidProps.defaultState() : {});
    const feedComps = resolveFeedComposition(fluidState, tag);

    // Determine Separator & Contactor operating P & T coupled to workbench
    const baseOpBarg = clamp(
      tag.operatingPressureBarg || vesselRes.operatingPressureBarg || ((fluidState.pressureBara || 45) - atmBara),
      1.5, 250, 48.0
    );
    const setBarg = clamp(tag.setPressureBarg, baseOpBarg + 0.5, 300, baseOpBarg * 1.12);
    const reliefBarg = Math.max(setBarg * (1 + (tag.overpressurePct || 10) / 100), (sizing.P1_bara || (setBarg * 1.1 + atmBara)) - atmBara);
    const activePressBarg = isRelief ? reliefBarg : baseOpBarg;
    const activePressBara = activePressBarg + atmBara;

    const baseTempC = clamp(
      Number.isFinite(Number(fluidState.temperatureC)) ? Number(fluidState.temperatureC) : (tag.relievingTempC || 42),
      -60, 260, 42
    );
    const sepTempC = clamp(baseTempC + tempOffsetC + (isRelief ? 6.5 : 0), -80, 320, 42);

    // 1. Solve Peng-Robinson EOS Flash in V-1001 Separator with k_ij overrides
    const flashInput = {
      temperatureC: sepTempC,
      pressureBara: activePressBara,
      kijMode: 'typical',
      kijOverrides: {
        c1Heavy: kijC1Heavy,
        co2Hc: kijCo2Hc,
        h2sHc: kijH2sHc
      },
      pseudo: fluidState.pseudo || { label: 'C11+ pseudo', mw: 160, tcC: 365, pcBara: 19.5, omega: 0.53 },
      comps: feedComps
    };
    const flash = FluidProps.calc(flashInput);

    // Extract phase properties with graceful fallbacks when single-phase
    const beta = flash.ok ? clamp(flash.beta, 0, 1, 0.72) : 0.72;
    const oilMolFrac = 1 - beta;
    const mwFeed = flash.ok ? flash.mwFeed : 26.5;

    const vapProps = (flash.ok && flash.vap) ? flash.vap : {
      mw: Math.max(16.04, mwFeed * 0.74),
      Z: 0.86,
      rho: (activePressBara * 1e5 * 19.5e-3) / (0.86 * R_GAS * (sepTempC + 273.15)),
      kIdeal: 1.27,
      kReal: 1.38,
      muLGE: 0.0135,
      cpMass: 2.35,
      x: flash.ok ? flash.z : []
    };
    const liqProps = (flash.ok && flash.liq) ? flash.liq : {
      mw: Math.max(58.0, mwFeed * 1.85),
      Z: 0.19,
      rho: clamp(tag.rhoLiqKgM3 || 640, 420, 980, 620),
      muLGE: 0.38,
      cpMass: 2.25,
      x: flash.ok ? flash.z : []
    };

    // Component breakdown helpers on separator V & L
    let yC5Plus = 0, yH2S = 0, yCO2 = 0, yC1 = 0;
    let xC1C2 = 0, xC5Plus = 0, xCO2 = 0, xH2S = 0;
    const compTable = [];
    if (flash.ok && Array.isArray(flash.comps)) {
      flash.comps.forEach((c, idx) => {
        const zi = flash.z[idx] || 0;
        const yi = flash.vap ? (flash.vap.x[idx] || 0) : (beta > 0.5 ? zi : 0);
        const xi = flash.liq ? (flash.liq.x[idx] || 0) : (beta <= 0.5 ? zi : 0);
        const Ki = (flash.flash && flash.flash.K && Number.isFinite(flash.flash.K[idx]))
          ? flash.flash.K[idx]
          : (xi > 1e-12 ? yi / xi : 1);
        if (HEAVY_IDS.has(c.id)) {
          yC5Plus += yi;
          xC5Plus += xi;
        }
        if (LIGHT_IDS.has(c.id)) xC1C2 += xi;
        if (c.id === 'C1') yC1 += yi;
        if (c.id === 'H2S') { yH2S += yi; xH2S += xi; }
        if (c.id === 'CO2') { yCO2 += yi; xCO2 += xi; }
        compTable.push({
          id: c.id,
          label: c.label,
          mw: c.mw,
          z: zi,
          y: yi,
          x: xi,
          K: Ki
        });
      });
    }

    // Total raw feed mass flow coupled to workbench Vessel / PSV tag flows
    const vesselFeedKgHr = (vesselRes.flows && (vesselRes.flows.W_vapKgHr + vesselRes.flows.W_liqKgHr)) || 0;
    const baseGasTargetKgHr = Math.max(8000, Number(tag.flowRateKgHr) || 42500);
    const feedMassKgHr = vesselFeedKgHr > 2000
      ? Math.max(vesselFeedKgHr, baseGasTargetKgHr * 1.15)
      : baseGasTargetKgHr / Math.max(0.35, beta);
    const feedKmolHr = feedMassKgHr / Math.max(2.0, mwFeed);

    const sepVapKmolHr = feedKmolHr * beta;
    const sepLiqKmolHr = feedKmolHr * oilMolFrac;
    // Exact mass conservation via component / phase molar flows
    const rawVapKgHr = sepVapKmolHr * vapProps.mw;
    const rawLiqKgHr = sepLiqKmolHr * liqProps.mw;
    const massScale = (rawVapKgHr + rawLiqKgHr) > 0 ? feedMassKgHr / (rawVapKgHr + rawLiqKgHr) : 1;
    const sepVapKgHr = rawVapKgHr * massScale;
    const sepOilKgHr = rawLiqKgHr * massScale;
    const sepVapM3Hr = sepVapKgHr / Math.max(0.2, vapProps.rho);
    const sepOilM3Hr = sepOilKgHr / Math.max(250, liqProps.rho);

    // 2. Oil Droplet Size, Surface Tension & Settling Physics in V-1001
    const dRho = Math.max(15, liqProps.rho - vapProps.rho);
    // Weinaug-Katz / Macleod-Sugden hydrocarbon interfacial tension [N/m]: scales as (dRho)^3.6
    const sigmaNM = clamp(0.024 * Math.pow(dRho / 560, 3.2), 0.0025, 0.035, 0.016);
    const muGasPaS = Math.max(0.006, vapProps.muLGE || 0.0135) * 1e-3;

    // Separator gas cross-sectional velocity & Hinze/Sauter droplet diameter d_32 [um]
    const sepDiaM = clamp(vesselRes.geometry && vesselRes.geometry.diameterM, 0.9, 8.0, 2.4);
    const sepLenM = clamp(vesselRes.geometry && vesselRes.geometry.lengthM, 2.5, 28.0, 8.5);
    const sepGasAreaM2 = vesselRes.orientation === 'vertical'
      ? (Math.PI * 0.25 * sepDiaM * sepDiaM)
      : (0.52 * Math.PI * 0.25 * sepDiaM * sepDiaM);
    const vGasSepMS = (sepVapM3Hr / 3600) / Math.max(0.15, sepGasAreaM2);
    const kSbSep = clamp(vesselRes.separation && vesselRes.separation.effectiveKsbMS, 0.04, 0.16, 0.088);
    const vMaxSbSepMS = kSbSep * Math.sqrt(dRho / Math.max(0.2, vapProps.rho));

    // Droplet diameter d_32 responds to surface tension sigma & liquid fraction:
    // Swollen low-sigma oil breaks into finer mist (~110-165 um); high-sigma clean oil coalesces (~220-340 um).
    const d32Um = clamp(
      235 * Math.pow(sigmaNM / 0.016, 0.48) * (0.86 + 0.45 * Math.min(0.45, oilMolFrac)),
      75, 440, 220
    );
    const dropSettle = calcDropletTerminalVelocity(d32Um * 1e-6, liqProps.rho, vapProps.rho, muGasPaS);
    const settleRatio = vGasSepMS / Math.max(0.01, dropSettle.vtMS);

    // Mechanical oil mist carryover from separator into contactor [ppmv molar equivalent]
    const sepMistCarryoverPpm = clamp(
      18 * Math.pow(Math.max(0.15, settleRatio), 2.15) * (0.016 / sigmaNM),
      4, 1800, 35
    );

    // Condensate / Oil stabilization RVP & light-ends metric:
    // Multi-stage stabilizer letdown leaves residual light ends proportional to Henry-normalized C1+C2 loading
    const pressNorm = Math.pow(42.0 / Math.max(4.0, activePressBara), 0.72);
    const effectiveLightLoadPct = xC1C2 * 100 * pressNorm;
    const oilRvpBara = clamp(0.24 + 0.0285 * effectiveLightLoadPct + 0.25 * xCO2, 0.15, 4.50, 0.76);
    const oilLightEndsPct = xC1C2 * 100;

    // 3. Multi-Stage Trayed Contactor (C-1001, Trays 1..N from top to bottom)
    // Lean solvent / absorbent enters Tray 1; separator gas (S-02) enters below Tray N.
    const leanMolarFlowKmolHr = sepVapKmolHr * lvRatio;
    const solventMw = clamp(pumpInput.rhoKgM3 > 920 ? 62.0 : 145.0, 45, 220, 62.0);
    const solventRho = clamp((pumpRes && pumpRes.rhoKgM3) || 1035, 760, 1120, 1035);
    const leanMassKgHr = leanMolarFlowKmolHr * solventMw;
    const leanTempC = clamp((pumpRes && pumpRes.tempC) || 40, 20, 85, 40);

    // Contactor column diameter sized at ~68% Fair jet flood for nominal design vapour load (fixed steel shell during k_ij sweeps)
    const nominalDesignVapKgHr = Math.max(baseGasTargetKgHr, (vesselRes.flows && vesselRes.flows.W_vapKgHr) || 0, feedMassKgHr * 0.76);
    const cSbTray = 0.078; // Fair sieve-tray C_sb at 600 mm tray spacing [m/s]
    const rhoVapNominal = Math.max(1.2, (baseOpBarg + atmBara) * 0.88);
    const uFloodNominal = Math.max(0.30, cSbTray * Math.sqrt(Math.max(30, solventRho - rhoVapNominal) / rhoVapNominal));
    const uFloodBaseMS = Math.max(0.25, cSbTray * Math.sqrt(Math.max(30, solventRho - vapProps.rho) / Math.max(0.2, vapProps.rho)) * Math.pow(sigmaNM / 0.020, 0.2));
    const colAreaNetM2 = clamp(((nominalDesignVapKgHr / 3600) / rhoVapNominal) / (0.68 * uFloodNominal), 0.65, 22.0, 3.2);
    const colDiaM = Math.round(Math.sqrt((4 * colAreaNetM2) / (0.88 * Math.PI)) * 20) / 20; // 12% downcomer area
    const colHeightM = Number((3.2 + trayCount * 0.60).toFixed(2));

    // Effective equilibrium K-values in amine / lean-solvent contactor sensitive to P, T, and k_ij!
    // Chemical amine reaction lowers effective H2S & CO2 equilibrium slope m_eq = y*/x* so 12 trays achieve < 4 ppmv H2S.
    const tAvgK = ((sepTempC + leanTempC) * 0.5) + 273.15;
    const pFactor = Math.pow(24.0 / Math.max(2.0, activePressBara), 0.55);
    const tFactor = Math.exp(0.024 * (tAvgK - 315.15));

    const mEqH2S = Math.max(0.02, 0.285 * pFactor * tFactor * Math.exp(4.8 * (kijH2sHc - 0.08)));
    const mEqCO2 = Math.max(0.04, 0.44 * pFactor * tFactor * Math.exp(4.2 * (kijCo2Hc - 0.12)));
    // Heavy C5+ scrubbing in contactor: positive k_ij(C1-Heavy) above ~0.12 increases heavy escape / entrainment
    const mEqHeavy = Math.max(0.05, 0.32 * pFactor * tFactor * Math.exp(5.0 * (kijC1Heavy - 0.045)));

    const A_H2S = clamp(lvRatio / mEqH2S, 0.15, 14.0, 2.75);
    const A_CO2 = clamp(lvRatio / mEqCO2, 0.15, 12.0, 1.85);
    const A_Heavy = clamp(lvRatio / mEqHeavy, 0.15, 12.0, 2.25);

    // Kremser-Souders-Brown removal efficiency: eta = (A^(N+1) - A) / (A^(N+1) - 1), with Murphree stage efficiency E_mv = 0.74
    const trayEff = 0.74;
    const nEff = Math.max(1.5, trayCount * trayEff);
    const kremserRemoval = (A) => {
      if (Math.abs(A - 1.0) < 1e-4) return nEff / (nEff + 1.0);
      const p1 = Math.pow(A, nEff + 1.0);
      return clamp((p1 - A) / (p1 - 1.0), 0.02, 0.99992, 0.9);
    };

    const remH2S = kremserRemoval(A_H2S);
    const remCO2 = kremserRemoval(A_CO2);
    const remHeavy = kremserRemoval(A_Heavy);

    const absorbedH2SKmolHr = sepVapKmolHr * yH2S * remH2S;
    const absorbedCO2KmolHr = sepVapKmolHr * yCO2 * remCO2;
    const absorbedHeavyKmolHr = sepVapKmolHr * yC5Plus * remHeavy;
    const totalAbsorbedKmolHr = absorbedH2SKmolHr + absorbedCO2KmolHr + absorbedHeavyKmolHr;
    const rawAbsorbedMassKgHr = absorbedH2SKmolHr * 34.082 + absorbedCO2KmolHr * 44.010 + absorbedHeavyKmolHr * 86.177;
    const absorbedMassKgHr = Math.min(rawAbsorbedMassKgHr, Math.max(0, sepVapKgHr * 0.98));
    const effectiveAbsorbedKmolHr = Math.min(totalAbsorbedKmolHr, Math.max(0, sepVapKmolHr * 0.98));

    // Overhead sweet/dry gas before relief split (exact mass conservation across C-1001)
    const ovhdGasKmolHrTotal = Math.max(0.01, sepVapKmolHr - effectiveAbsorbedKmolHr);
    const ovhdTotalKgHr = Math.max(0, sepVapKgHr - absorbedMassKgHr);
    const richBottomsKgHr = leanMassKgHr + (sepVapKgHr - ovhdTotalKgHr);
    const richBottomsKmolHr = leanMolarFlowKmolHr + effectiveAbsorbedKmolHr;

    // Stagewise tray profile (Tray 1 = Top, Tray N = Bottom)
    const dPColBar = 0.0065 * trayCount * (isRelief ? 1.45 : 1.0);
    const pTopBara = Math.max(1.05, activePressBara - dPColBar);
    // Exothermic heat of acid-gas absorption creates realistic bottom-to-lower-middle temperature bulge
    const exothermDeltaC = clamp((absorbedCO2KmolHr * 72 + absorbedH2SKmolHr * 65) / Math.max(40, leanMassKgHr * 0.0036), 0.8, 22.0, 6.5);

    const trays = [];
    let maxJetFloodPct = 0;
    for (let j = 1; j <= trayCount; j++) {
      // s = 0 at top (Tray 1), s = 1 at bottom (Tray N)
      const s = trayCount > 1 ? (j - 1) / (trayCount - 1) : 1;
      const pTrayBara = pTopBara + s * dPColBar;
      // Temperature profile with exothermic bulge near lower trays (s ~ 0.78)
      const bulge = Math.sin(Math.pow(s, 0.85) * Math.PI) * exothermDeltaC * 0.85;
      const tTrayC = leanTempC + s * (sepTempC + exothermDeltaC * 0.55 - leanTempC) + bulge;

      // Exponential composition decay from bottom (j=N) to top (j=1)
      const progFromBottom = 1 - s;
      const yH2Sj = yH2S * Math.pow(Math.max(1e-6, 1 - remH2S), progFromBottom);
      const yCO2j = yCO2 * Math.pow(Math.max(1e-5, 1 - remCO2), progFromBottom);
      const yHeavyj = yC5Plus * Math.pow(Math.max(1e-5, 1 - remHeavy), progFromBottom);

      const vMolTray = ovhdGasKmolHrTotal + totalAbsorbedKmolHr * s;
      const lMolTray = leanMolarFlowKmolHr + totalAbsorbedKmolHr * s;
      const qVapTrayM3S = ((vMolTray / Math.max(1, sepVapKmolHr)) * sepVapM3Hr) / 3600;
      const uNetMS = qVapTrayM3S / Math.max(0.25, colAreaNetM2);
      const jetFloodPct = clamp((uNetMS / uFloodBaseMS) * 100 * (isRelief ? 1.24 : 1.0), 8, 135, 62);
      if (jetFloodPct > maxJetFloodPct) maxJetFloodPct = jetFloodPct;

      // Francis weir clear liquid + froth height [mm] (50 mm outlet weir + froth expansion)
      const qLiqM3S = ((lMolTray * solventMw) / solventRho) / 3600;
      const weirLenM = 0.72 * colDiaM;
      const howMm = 664 * Math.pow(qLiqM3S / Math.max(0.3, weirLenM), 0.667);
      const frothDensityFrac = clamp(0.48 - 0.0022 * jetFloodPct, 0.20, 0.55, 0.36);
      const frothHeightMm = clamp((50 + howMm) / frothDensityFrac, 85, 420, 165);
      const richLoadingMolMol = (totalAbsorbedKmolHr * s) / Math.max(1.0, leanMolarFlowKmolHr);

      trays.push({
        trayNumber: j,
        positionLabel: j === 1 ? 'Top Tray (Lean Feed)' : (j === trayCount ? 'Bottom Tray (Gas Inlet)' : `Intermediate Sieve Tray ${j}`),
        tempC: Number(tTrayC.toFixed(2)),
        pressureBarg: Number((pTrayBara - atmBara).toFixed(3)),
        pressureBara: Number(pTrayBara.toFixed(3)),
        vaporKmolHr: Number(vMolTray.toFixed(1)),
        liquidKmolHr: Number(lMolTray.toFixed(1)),
        yH2SPpmv: Number((yH2Sj * 1e6).toFixed(2)),
        yCO2MolPct: Number((yCO2j * 100).toFixed(3)),
        yHeavyPpmv: Number((yHeavyj * 1e6).toFixed(1)),
        richLoading: Number(richLoadingMolMol.toFixed(4)),
        frothHeightMm: Number(frothHeightMm.toFixed(1)),
        jetFloodPct: Number(jetFloodPct.toFixed(1)),
        weepingRisk: jetFloodPct < 24 ? 'LOW VAPOR (WEEPING)' : (jetFloodPct > 85 ? 'FLOODING WARNING' : 'NORMAL FROTH')
      });
    }

    // Top tray mechanical oil/solvent mist carryover rises sharply when jetFloodPct > 78% or separator mist slips through
    const floodCarryoverPpm = maxJetFloodPct > 72
      ? 12 * Math.pow((maxJetFloodPct - 70) / 10, 2.3)
      : 2.5 * (maxJetFloodPct / 72);
    const salesC5PlusPpmv = (trays[0].yHeavyPpmv * 0.032) + sepMistCarryoverPpm * (1 - 0.55 * remHeavy) + floodCarryoverPpm;
    const salesH2SPpmv = trays[0].yH2SPpmv;
    const salesCO2MolPct = trays[0].yCO2MolPct;
    // Sales gas hydrocarbon dewpoint margin [C below operating sales temp]
    const hcDewpointMarginC = Number((14.5 - salesC5PlusPpmv / 32).toFixed(2));

    // 4. Product Specification Scorecard (Sales Gas S-05 & Stabilized Oil S-03)
    const specs = {
      c5PlusPpmv: {
        label: 'Sales Gas Heavy Oil / C5+ Carryover',
        value: Number(salesC5PlusPpmv.toFixed(1)),
        limit: 350.0,
        unit: 'ppmv',
        pass: salesC5PlusPpmv <= 350.0,
        detail: `HC dewpoint margin ${hcDewpointMarginC >= 0 ? '+' : ''}${hcDewpointMarginC.toFixed(1)} °C`
      },
      h2sPpmv: {
        label: 'Pipeline H₂S Spec',
        value: Number(salesH2SPpmv.toFixed(2)),
        limit: 4.0,
        unit: 'ppmv',
        pass: salesH2SPpmv <= 4.0,
        detail: `${(remH2S * 100).toFixed(2)}% H₂S absorbed across ${trayCount} trays`
      },
      co2MolPct: {
        label: 'Pipeline CO₂ Spec',
        value: Number(salesCO2MolPct.toFixed(3)),
        limit: 2.0,
        unit: 'mol%',
        pass: salesCO2MolPct <= 2.0,
        detail: `${(remCO2 * 100).toFixed(1)}% CO₂ removal (A = ${A_CO2.toFixed(2)})`
      },
      contactorFlood: {
        label: 'Contactor Jet Flood',
        value: Number(maxJetFloodPct.toFixed(1)),
        limit: 85.0,
        unit: '%',
        pass: maxJetFloodPct <= 85.0,
        detail: `Peak on Tray ${trayCount} (Fair C_sb correlation)`
      },
      oilStabilization: {
        label: 'Condensate / Oil Stabilizer RVP',
        value: Number(oilRvpBara.toFixed(2)),
        limit: 0.85,
        unit: 'bara',
        pass: oilRvpBara <= 0.85,
        lightEndsPct: Number(oilLightEndsPct.toFixed(2)),
        rvpBara: Number(oilRvpBara.toFixed(2)),
        detail: `Dissolved C₁+C₂ = ${oilLightEndsPct.toFixed(2)} mol% in V-1001 oil`
      }
    };
    specs.salesGasOnSpec = specs.c5PlusPpmv.pass && specs.h2sPpmv.pass && specs.co2MolPct.pass && specs.contactorFlood.pass;
    specs.oilOnSpec = specs.oilStabilization.pass;
    specs.allOnSpec = specs.salesGasOnSpec && specs.oilOnSpec;

    // 5. PSV Relief Flow Split (Normal = closed / standby; Relief = PSV pops at required/rated load)
    const reliefFlowKgHr = isRelief ? Math.min(ovhdTotalKgHr * 0.92, Math.max(100, Number(tag.flowRateKgHr) || ovhdTotalKgHr * 0.65)) : 0;
    const salesExportKgHr = Math.max(0, ovhdTotalKgHr - reliefFlowKgHr);
    const reboilerDutyKw = Number((richBottomsKgHr * 0.088).toFixed(1));

    // Top 6 components for compact unit/stream inspector display
    const topFeedComps = compTable.slice().sort((a, b) => b.z - a.z).slice(0, 6);
    const topVapComps = compTable.slice().sort((a, b) => b.y - a.y).slice(0, 6);
    const topLiqComps = compTable.slice().sort((a, b) => b.x - a.x).slice(0, 6);

    // 6. Build 7 Interactive Equipment Units Dictionary
    const units = {
      'V-1001': {
        id: 'V-1001',
        kind: 'unit',
        name: `${vesselRes.vesselTag || 'V-1001'} — Inlet 3-Phase Separator`,
        std: 'GPSA Sec. 7 · ASME VIII-1 · PR EOS',
        status: (vesselRes.separation && vesselRes.separation.vaporCompliant !== false && specs.oilOnSpec) ? 'PASS' : 'WARN',
        statusLabel: specs.oilOnSpec ? 'DROPLET SETTLING & OIL ON-SPEC' : 'OIL SWOLLEN / HIGH LIGHT-ENDS',
        metrics: [
          ['Flash T / P', `${sepTempC.toFixed(1)} °C / ${activePressBarg.toFixed(2)} barg (${activePressBara.toFixed(2)} bara)`],
          ['PR Vapour Fraction β', `${beta.toFixed(4)} (${(oilMolFrac * 100).toFixed(2)} mol% oil dropout)`],
          ['Gas / Oil Mass Split', `${Math.round(sepVapKgHr).toLocaleString()} kg/h gas · ${Math.round(sepOilKgHr).toLocaleString()} kg/h oil`],
          ['Phase Densities (ρ_V / ρ_L)', `${vapProps.rho.toFixed(2)} kg/m³ / ${liqProps.rho.toFixed(1)} kg/m³`],
          ['Oil Droplet d₃₂ / v_t', `${d32Um.toFixed(0)} μm · v_t = ${dropSettle.vtMS.toFixed(3)} m/s (v_gas = ${vGasSepMS.toFixed(3)} m/s)`],
          ['Mist Carryover to C-1001', `${sepMistCarryoverPpm.toFixed(1)} ppmv · σ = ${(sigmaNM * 1000).toFixed(1)} mN/m`],
          ['Sized Shell (Step 0)', `${Math.round(sepDiaM * 1000)} mm ID × ${Math.round(sepLenM * 1000)} mm T/T (${vesselRes.orientation || 'horizontal'})`],
          ['ASME VIII Wall / MAWP', `${(vesselRes.mechanical && vesselRes.mechanical.tShellSelectedMm) || 52} mm · MAWP ${((vesselRes.mechanical && vesselRes.mechanical.mawpCorrodedBarg) || 56.8).toFixed(1)} barg`]
        ],
        compositions: topFeedComps
      },
      'C-1001': {
        id: 'C-1001',
        kind: 'unit',
        name: `C-1001 — Trayed Gas-Liquid Contactor (${trayCount} Trays)`,
        std: 'Kremser-Edmister · Fair Sieve-Tray Flood',
        status: specs.salesGasOnSpec ? 'PASS' : 'FAIL',
        statusLabel: specs.salesGasOnSpec ? `SALES GAS ON-SPEC (${trayCount} TRAYS)` : 'OFF-SPEC OVERHEAD / FLOOD',
        metrics: [
          ['Column Dimensions', `${(colDiaM * 1000).toFixed(0)} mm ID × ${colHeightM.toFixed(1)} m (${trayCount} Sieve Trays)`],
          ['Top / Bottom Pressure', `${(pTopBara - atmBara).toFixed(2)} / ${activePressBarg.toFixed(2)} barg (ΔP = ${dPColBar.toFixed(3)} bar)`],
          ['Top / Bottom Temp', `${trays[0].tempC.toFixed(1)} °C → ${trays[trayCount - 1].tempC.toFixed(1)} °C (Exotherm +${exothermDeltaC.toFixed(1)} °C)`],
          ['Molar L/V Ratio', `${lvRatio.toFixed(2)} mol/mol (${Math.round(leanMassKgHr).toLocaleString()} kg/h lean feed)`],
          ['Overhead H₂S / CO₂', `${salesH2SPpmv.toFixed(2)} ppmv (≤4) · ${salesCO2MolPct.toFixed(2)} mol% (≤2.0%)`],
          ['Sales C5+ Carryover', `${salesC5PlusPpmv.toFixed(1)} ppmv (≤350 ppmv · Dewpt margin ${hcDewpointMarginC.toFixed(1)} °C)`],
          ['Peak Tray Jet Flood', `${maxJetFloodPct.toFixed(1)}% on Tray ${trayCount} (Fair limit ≤ 85%)`],
          ['Avg. Froth Deck Height', `${trays[Math.floor(trayCount / 2)].frothHeightMm.toFixed(0)} mm active bubbling froth`]
        ],
        compositions: topVapComps
      },
      'PSV-1001A': {
        id: 'PSV-1001A',
        kind: 'unit',
        name: `${tag.tagNumber || 'PSV-1001A'} — Pressure Relief Valve`,
        std: 'API 520 Pt I & II · API 526',
        status: (hyd.inlet.passes3Pct && hyd.outlet.passesBackpressure) ? (isRelief ? 'WARN' : 'PASS') : 'FAIL',
        statusLabel: isRelief ? `LIFTING AT ${activePressBarg.toFixed(1)} BARG` : `STANDBY (SET ${setBarg.toFixed(1)} BARG)`,
        metrics: [
          ['Valve State', isRelief ? `OPEN / RELIEVING (${Math.round(reliefFlowKgHr).toLocaleString()} kg/h)` : `CLOSED / SEATED (Margin ${((1 - baseOpBarg / setBarg) * 100).toFixed(1)}%)`],
          ['Set / Relieving P₁', `${setBarg.toFixed(2)} barg / ${(sizing.P1_bara || (reliefBarg + atmBara)).toFixed(2)} bara`],
          ['API 526 Selected Orifice', `"${(sizing.selectedOrifice && sizing.selectedOrifice.letter) || 'L'}" (${(sizing.selectedOrifice && sizing.selectedOrifice.areaMm2) || 1841} mm² · ${(sizing.selectedOrifice && sizing.selectedOrifice.inletOutFlange) || '4" x 6"'})`],
          ['Required Area A_req', `${(sizing.reqAreaMm2 || 1203.8).toFixed(1)} mm² (${sizing.flowRegime || 'Critical'})`],
          ['Valve Construction', `${String(tag.valveType || 'bellows').toUpperCase()}${tag.ruptureDisc ? ' + Rupture Disc' : ''}`],
          ['Inlet Piping Loss (Step 3)', `${hyd.inlet.nps} line · ${(hyd.inlet.lossPctOfSet || 0).toFixed(2)}% of P_set (${hyd.inlet.passes3Pct ? '≤ 3% PASS' : '> 3% CHATTER RISK'})`],
          ['Total Backpressure', `${hyd.outlet.nps} tailpipe · ${(hyd.outlet.totalBackPctOfSet || 0).toFixed(1)}% of P_set`],
          ['Tailpipe Mach / Force', `Ma = ${(hyd.outlet.machNumber || 0).toFixed(2)} · F_r = ${(hyd.outlet.reactionForceKn || 0).toFixed(1)} kN`]
        ],
        compositions: topVapComps
      },
      'P-3102A': {
        id: 'P-3102A',
        kind: 'unit',
        name: `${pumpInput.pumpTag || 'P-3102A/B'} — Lean Solvent Booster Pump`,
        std: 'API 610 (ISO 13709) · API RP 14E',
        status: pumpRes.npsh.compliant ? 'PASS' : 'FAIL',
        statusLabel: pumpRes.npsh.compliant ? 'API 610 NPSHa COMPLIANT' : 'NPSHa CAVITATION WARNING',
        metrics: [
          ['Service', pumpInput.service || 'Lean Amine / Absorbent Circulation'],
          ['Contactor Demand / Rated Q', `${(leanMassKgHr / solventRho).toFixed(1)} m³/h sim · ${pumpRes.Q_ratedM3Hr.toFixed(1)} m³/h API 610 rated`],
          ['Total Diff. Head (TDH)', `${pumpRes.pump.tdhRatedM.toFixed(1)} m (ΔP = ${pumpRes.pump.diffPressureRatedBar.toFixed(2)} bar)`],
          ['Max Shutoff Discharge', `${pumpRes.pump.maxDischargeBarg.toFixed(2)} barg (Blocked-outlet basis)`],
          ['NPSHa vs NPSHr', `${pumpRes.npsh.npshaM.toFixed(2)} m vs ${pumpRes.npsh.npshrM.toFixed(2)} m (Margin ${pumpRes.npsh.marginM.toFixed(2)} m)`],
          ['Suction / Discharge Lines', `${pumpRes.suction.nps} (${pumpRes.suction.velocityMS.toFixed(2)} m/s) / ${pumpRes.discharge.nps} (${pumpRes.discharge.velocityMS.toFixed(2)} m/s)`],
          ['Driver Nameplate Rating', `${pumpRes.pump.selectedMotorKw} kW electric motor`]
        ],
        compositions: []
      },
      'FCV-1014': {
        id: 'FCV-1014',
        kind: 'unit',
        name: 'FCV-1014 — Lean Solvent Top-Feed Control Valve',
        std: 'IEC 60534-2-1',
        status: 'PASS',
        statusLabel: 'MODULATING L/V CONTROL',
        metrics: [
          ['Controlled Variable', `Contactor L/V = ${lvRatio.toFixed(2)} (${Math.round(leanMassKgHr).toLocaleString()} kg/h)`],
          ['Allocated Rated ΔP', `${pumpRes.controlValve.allocatedDpRatedBar.toFixed(2)} bar`],
          ['Required C_v (Norm / Rated)', `${pumpRes.controlValve.normal.reqCv.toFixed(1)} / ${pumpRes.controlValve.rated.reqCv.toFixed(1)}`],
          ['Downstream Pressure', `${(pTopBara - atmBara).toFixed(2)} barg (Contactor Tray 1 nozzle)`],
          ['Fail Action', 'FC (Fail-Closed on loss of instrument air)']
        ],
        compositions: []
      },
      'E-1002': {
        id: 'E-1002',
        kind: 'unit',
        name: 'E-1002 — Rich Solvent Regeneration Reboiler / Trim Exchanger',
        std: 'TEMA R · API 521 §4.4.5',
        status: 'PASS',
        statusLabel: `DUTY ${reboilerDutyKw.toFixed(0)} kW`,
        metrics: [
          ['Process Side Flow', `${Math.round(richBottomsKgHr).toLocaleString()} kg/h rich bottoms from C-1001`],
          ['Inlet / Outlet Temp', `${trays[trayCount - 1].tempC.toFixed(1)} °C → ${(trays[trayCount - 1].tempC + 46).toFixed(1)} °C`],
          ['Thermal Duty Q', `${reboilerDutyKw.toFixed(1)} kW (${(reboilerDutyKw / 1000).toFixed(2)} MW)`],
          ['Acid Gas Stripped', `${(absorbedCO2KmolHr + absorbedH2SKmolHr).toFixed(2)} kmol/h (H₂S + CO₂)`],
          ['Tube-Rupture / Heat Input', 'Linked to Step 1 Scenarios 1F & 1G']
        ],
        compositions: []
      },
      'V-5001': {
        id: 'V-5001',
        kind: 'unit',
        name: 'V-5001 — Flare Knock-Out Drum & Elevated Flare Stack',
        std: 'API 521 §5.4–5.5 (300–600 μm KO)',
        status: isRelief ? 'WARN' : 'PASS',
        statusLabel: isRelief ? `ACTIVE FLARING (${Math.round(reliefFlowKgHr).toLocaleString()} kg/h)` : 'PURGE STANDBY',
        metrics: [
          ['Flare Header Backpressure', `${(tag.superimposedBackBarg || 3.5).toFixed(2)} barg superimposed`],
          ['Active Relief Load', isRelief ? `${Math.round(reliefFlowKgHr).toLocaleString()} kg/h` : '0 kg/h (Pilot purge only)'],
          ['Tailpipe Built-Up P_bt', `${(hyd.outlet.builtUpBackBarg || 0).toFixed(2)} barg · Mach ${(hyd.outlet.machNumber || 0).toFixed(2)}`],
          ['KO Droplet Cut-Size', '300 μm liquid hydrocarbon knockout per API 521 §5.4.2'],
          ['Flame Tip Radiation Check', isRelief ? 'Active relief plume — verify sterile radius' : 'Standby pilot flame']
        ],
        compositions: topVapComps
      }
    };

    // 7. Build 8 Interactive Process & Relief Streams (S-01 .. S-08)
    const streams = [
      {
        id: 'S-01',
        kind: 'stream',
        name: 'S-01 — Raw Multicomponent Wellhead / Plant Feed',
        from: 'Battery Limit',
        to: 'V-1001 Inlet',
        phase: flash.phase === 'two-phase' ? 'Two-Phase (Gas + Oil)' : (beta > 0.5 ? 'Vapour' : 'Liquid'),
        tempC: Number(sepTempC.toFixed(2)),
        pressureBarg: Number(activePressBarg.toFixed(2)),
        massFlowKgHr: Number(feedMassKgHr.toFixed(1)),
        molarFlowKmolHr: Number(feedKmolHr.toFixed(2)),
        vaporFrac: Number(beta.toFixed(4)),
        mw: Number(mwFeed.toFixed(2)),
        rhoKgM3: Number((flash.bulkRho || 120).toFixed(2)),
        zFactor: Number((vapProps.Z || 0.86).toFixed(4)),
        cpCv: Number((vapProps.kIdeal || 1.26).toFixed(3)),
        specStatus: 'FEED',
        compositions: topFeedComps
      },
      {
        id: 'S-02',
        kind: 'stream',
        name: 'S-02 — Separator Overhead Sour/Wet Gas → Contactor Bottom',
        from: 'V-1001 Vapour Outlet',
        to: `C-1001 Tray ${trayCount}`,
        phase: 'Vapour (+ Mist)',
        tempC: Number(sepTempC.toFixed(2)),
        pressureBarg: Number(activePressBarg.toFixed(2)),
        massFlowKgHr: Number(sepVapKgHr.toFixed(1)),
        molarFlowKmolHr: Number(sepVapKmolHr.toFixed(2)),
        vaporFrac: 1.0,
        mw: Number(vapProps.mw.toFixed(2)),
        rhoKgM3: Number(vapProps.rho.toFixed(2)),
        zFactor: Number(vapProps.Z.toFixed(4)),
        cpCv: Number(vapProps.kIdeal.toFixed(3)),
        specStatus: `Carryover ${sepMistCarryoverPpm.toFixed(0)} ppmv`,
        compositions: topVapComps
      },
      {
        id: 'S-03',
        kind: 'stream',
        name: 'S-03 — Separator Hydrocarbon Oil / Condensate Draw',
        from: 'V-1001 Oil Boot',
        to: 'Condensate Stabilizer',
        phase: 'Liquid Oil',
        tempC: Number(sepTempC.toFixed(2)),
        pressureBarg: Number(activePressBarg.toFixed(2)),
        massFlowKgHr: Number(sepOilKgHr.toFixed(1)),
        molarFlowKmolHr: Number(sepLiqKmolHr.toFixed(2)),
        vaporFrac: 0.0,
        mw: Number(liqProps.mw.toFixed(2)),
        rhoKgM3: Number(liqProps.rho.toFixed(1)),
        zFactor: Number((liqProps.Z || 0.19).toFixed(4)),
        cpCv: 1.0,
        specStatus: specs.oilOnSpec ? `ON-SPEC (C₁+C₂ ${oilLightEndsPct.toFixed(1)}%)` : `OFF-SPEC (C₁+C₂ ${oilLightEndsPct.toFixed(1)}%)`,
        onSpec: specs.oilOnSpec,
        compositions: topLiqComps
      },
      {
        id: 'S-04',
        kind: 'stream',
        name: 'S-04 — Lean Solvent / Absorbent Top Feed',
        from: 'P-3102A → FCV-1014',
        to: 'C-1001 Tray 1',
        phase: 'Liquid Solvent',
        tempC: Number(leanTempC.toFixed(2)),
        pressureBarg: Number((pTopBara - atmBara + 0.35).toFixed(2)),
        massFlowKgHr: Number(leanMassKgHr.toFixed(1)),
        molarFlowKmolHr: Number(leanMolarFlowKmolHr.toFixed(2)),
        vaporFrac: 0.0,
        mw: Number(solventMw.toFixed(2)),
        rhoKgM3: Number(solventRho.toFixed(1)),
        zFactor: 0.085,
        cpCv: 1.0,
        specStatus: `L/V = ${lvRatio.toFixed(2)}`,
        compositions: []
      },
      {
        id: 'S-05',
        kind: 'stream',
        name: 'S-05 — Sweet / Dry Overhead Sales Gas Export',
        from: 'C-1001 Overhead Demister',
        to: 'Sales Gas Pipeline',
        phase: 'Sales Gas',
        tempC: Number(trays[0].tempC.toFixed(2)),
        pressureBarg: Number((pTopBara - atmBara).toFixed(2)),
        massFlowKgHr: Number(salesExportKgHr.toFixed(1)),
        molarFlowKmolHr: Number((ovhdGasKmolHrTotal * (salesExportKgHr / Math.max(1, ovhdTotalKgHr))).toFixed(2)),
        vaporFrac: 1.0,
        mw: Number(Math.max(16.04, vapProps.mw * 0.94).toFixed(2)),
        rhoKgM3: Number((vapProps.rho * 0.93).toFixed(2)),
        zFactor: Number(Math.min(0.99, vapProps.Z * 1.02).toFixed(4)),
        cpCv: Number(vapProps.kIdeal.toFixed(3)),
        specStatus: specs.salesGasOnSpec ? 'ON-SPEC SALES GAS' : 'OFF-SPEC SALES GAS',
        onSpec: specs.salesGasOnSpec,
        compositions: topVapComps
      },
      {
        id: 'S-06',
        kind: 'stream',
        name: 'S-06 — Contactor Rich Bottoms Liquid → Reboiler',
        from: 'C-1001 Sump',
        to: 'E-1002 Reboiler',
        phase: 'Rich Liquid',
        tempC: Number(trays[trayCount - 1].tempC.toFixed(2)),
        pressureBarg: Number(activePressBarg.toFixed(2)),
        massFlowKgHr: Number(richBottomsKgHr.toFixed(1)),
        molarFlowKmolHr: Number(richBottomsKmolHr.toFixed(2)),
        vaporFrac: 0.0,
        mw: Number((richBottomsKgHr / Math.max(1, richBottomsKmolHr)).toFixed(2)),
        rhoKgM3: Number((solventRho * 1.012).toFixed(1)),
        zFactor: 0.09,
        cpCv: 1.0,
        specStatus: `Rich Load ${trays[trayCount - 1].richLoading.toFixed(3)}`,
        compositions: []
      },
      {
        id: 'S-07',
        kind: 'stream',
        name: `S-07 — PSV Inlet Nozzle Stub (${hyd.inlet.nps} · API 520 Pt II)`,
        from: 'C-1001 Top Head',
        to: tag.tagNumber || 'PSV-1001A',
        phase: isRelief ? 'Relieving Gas' : 'Static Gas Cushion',
        tempC: Number(trays[0].tempC.toFixed(2)),
        pressureBarg: Number((pTopBara - atmBara).toFixed(2)),
        massFlowKgHr: Number(reliefFlowKgHr.toFixed(1)),
        molarFlowKmolHr: Number((reliefFlowKgHr / Math.max(2, vapProps.mw)).toFixed(2)),
        vaporFrac: 1.0,
        mw: Number(vapProps.mw.toFixed(2)),
        rhoKgM3: Number(vapProps.rho.toFixed(2)),
        zFactor: Number(vapProps.Z.toFixed(4)),
        cpCv: Number(vapProps.kIdeal.toFixed(3)),
        specStatus: hyd.inlet.passes3Pct ? `ΔP ${(hyd.inlet.lossPctOfSet || 0).toFixed(2)}% ≤ 3% PASS` : `ΔP ${(hyd.inlet.lossPctOfSet || 0).toFixed(2)}% > 3% FAIL`,
        onSpec: !!hyd.inlet.passes3Pct,
        compositions: topVapComps
      },
      {
        id: 'S-08',
        kind: 'stream',
        name: `S-08 — PSV Discharge Tailpipe → Flare (${hyd.outlet.nps})`,
        from: tag.tagNumber || 'PSV-1001A',
        to: 'V-5001 Flare KO Drum',
        phase: isRelief ? 'Choked / Expanding Relief' : 'Flare Header Purge',
        tempC: Number((trays[0].tempC - (isRelief ? 14.0 : 2.0)).toFixed(2)),
        pressureBarg: Number((isRelief ? (hyd.outlet.totalBackBarg || 5.2) : (tag.superimposedBackBarg || 3.5)).toFixed(2)),
        massFlowKgHr: Number(reliefFlowKgHr.toFixed(1)),
        molarFlowKmolHr: Number((reliefFlowKgHr / Math.max(2, vapProps.mw)).toFixed(2)),
        vaporFrac: 1.0,
        mw: Number(vapProps.mw.toFixed(2)),
        rhoKgM3: Number(Math.max(0.8, vapProps.rho * 0.18).toFixed(2)),
        zFactor: 0.985,
        cpCv: Number(vapProps.kIdeal.toFixed(3)),
        specStatus: `Mach ${(hyd.outlet.machNumber || 0).toFixed(2)} · P_bt ${(hyd.outlet.totalBackPctOfSet || 0).toFixed(1)}%`,
        onSpec: !!hyd.outlet.passesBackpressure,
        compositions: topVapComps
      }
    ];

    const streamMap = {};
    streams.forEach(s => { streamMap[s.id] = s; });

    // Overall mass balance check across plant boundary:
    // Inputs = S-01 (raw feed) + S-04 (lean solvent)
    // Outputs = S-03 (oil draw) + S-05 (sales gas) + S-06 (rich bottoms) + S-08 (flare relief)
    const massInKgHr = feedMassKgHr + leanMassKgHr;
    const massOutKgHr = sepOilKgHr + salesExportKgHr + richBottomsKgHr + reliefFlowKgHr;
    const massBalanceRelErr = Math.abs(massInKgHr - massOutKgHr) / Math.max(1, massInKgHr);

    return {
      ok: true,
      sim: {
        ...sim,
        kijC1Heavy,
        kijCo2Hc,
        kijH2sHc,
        trayCount,
        lvRatio,
        tempOffsetC,
        operatingMode: isRelief ? 'relief' : 'normal'
      },
      conditions: {
        sepTempC: Number(sepTempC.toFixed(2)),
        activePressBarg: Number(activePressBarg.toFixed(2)),
        activePressBara: Number(activePressBara.toFixed(2)),
        setBarg: Number(setBarg.toFixed(2)),
        atmBara
      },
      eos: {
        phase: flash.phase || 'two-phase',
        beta: Number(beta.toFixed(5)),
        oilMolFrac: Number(oilMolFrac.toFixed(5)),
        mwFeed: Number(mwFeed.toFixed(2)),
        vapMw: Number(vapProps.mw.toFixed(3)),
        vapZ: Number(vapProps.Z.toFixed(4)),
        vapRho: Number(vapProps.rho.toFixed(2)),
        vapKIdeal: Number((vapProps.kIdeal || 1.27).toFixed(4)),
        vapKReal: Number((vapProps.kReal || 1.35).toFixed(4)),
        vapViscCp: Number((vapProps.muLGE || 0.0135).toFixed(4)),
        liqMw: Number(liqProps.mw.toFixed(2)),
        liqRho: Number(liqProps.rho.toFixed(1)),
        sigmaMNm: Number((sigmaNM * 1000).toFixed(2)),
        compTable
      },
      droplets: {
        d32Um: Number(d32Um.toFixed(1)),
        vtMS: Number(dropSettle.vtMS.toFixed(4)),
        vGasSepMS: Number(vGasSepMS.toFixed(4)),
        vMaxSbSepMS: Number(vMaxSbSepMS.toFixed(4)),
        settleRatio: Number(settleRatio.toFixed(3)),
        sepOilKgHr: Number(sepOilKgHr.toFixed(1)),
        sepOilM3Hr: Number(sepOilM3Hr.toFixed(2)),
        sepVapKgHr: Number(sepVapKgHr.toFixed(1)),
        sepMistCarryoverPpm: Number(sepMistCarryoverPpm.toFixed(1)),
        salesC5PlusPpmv: Number(salesC5PlusPpmv.toFixed(1)),
        hcDewpointMarginC
      },
      contactor: {
        trayCount,
        colDiaM,
        colHeightM,
        lvRatio,
        dPColBar: Number(dPColBar.toFixed(3)),
        exothermDeltaC: Number(exothermDeltaC.toFixed(2)),
        maxJetFloodPct: Number(maxJetFloodPct.toFixed(1)),
        remH2SPct: Number((remH2S * 100).toFixed(2)),
        remCO2Pct: Number((remCO2 * 100).toFixed(2)),
        trays
      },
      geometry: {
        sepDiaM,
        sepLenM,
        sepOrientation: vesselRes.orientation || 'horizontal',
        sepLiquidFrac: clamp(0.22 + 0.95 * oilMolFrac, 0.16, 0.72, 0.45),
        colDiaM,
        colHeightM,
        psvOrificeLetter: (sizing.selectedOrifice && sizing.selectedOrifice.letter) || 'L',
        inletNps: hyd.inlet.nps || '6"',
        outletNps: hyd.outlet.nps || '8"'
      },
      specs,
      units,
      streams,
      streamMap,
      massBalance: {
        massInKgHr: Number(massInKgHr.toFixed(2)),
        massOutKgHr: Number(massOutKgHr.toFixed(2)),
        relError: massBalanceRelErr
      },
      step2Patch: {
        fluidPresetKey: 'custom',
        mw: Number(vapProps.mw.toFixed(3)),
        z: Number(vapProps.Z.toFixed(4)),
        k: Number(clamp(vapProps.kIdeal, 1.02, 2.2, 1.27).toFixed(4)),
        rhoLiqKgM3: Number(liqProps.rho.toFixed(1)),
        relievingTempC: Number(sepTempC.toFixed(1))
      }
    };
  }

  return {
    KIJ_PRESETS,
    defaultSimControls,
    calcDropletTerminalVelocity,
    simulatePlant
  };
});
