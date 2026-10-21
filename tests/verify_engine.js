/**
 * Independent verification of engine.js against API 520 / 521 equations written
 * in their US Customary form (different constants than the SI engine), plus the
 * published API 520 Part I Annex B gas example. Run: node tests/verify_engine.js
 */
const E = require('../engine.js');
const U = E.Units;

let pass = 0, fail = 0;
function check(name, got, exp, tolPct = 1.0) {
  const err = Math.abs(got - exp) / Math.max(1e-9, Math.abs(exp)) * 100;
  const ok = err <= tolPct;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(4)}, expected ${exp.toFixed(4)} (err ${err.toFixed(2)}%)`);
}
function checkTrue(name, cond) { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); }

const kTerm = k => Math.sqrt(k * Math.pow(2 / (k + 1), (k + 1) / (k - 1)));

// ---------------------------------------------------------------------------
// 1. Gas coefficient C vs API 520 Table (k=1.11 -> C=327; k=1.40 -> C=356) and a USC
//    hand calc using the tabulated C: W=53,500 lb/h, M=51, T=627 °R, Z=0.90, Pset=75 psig
// ---------------------------------------------------------------------------
{
  const setBarg = U.psiToBar(75);
  const base = {
    fluidPhase: 'gas', flowRateKgHr: U.lbHrToKgHr(53500), setPressureBarg: setBarg,
    overpressurePct: 10, superimposedBackBarg: 0, builtUpBackBarg: 0,
    atmPressureBara: U.psiToBar(14.7), relievingTempC: (627 / 1.8) - 273.15,
    valveType: 'conventional', mw: 51, z: 0.90
  };
  const r = E.sizeOrificeApi520({ ...base, k: 1.11 });
  check('C (USC) at k=1.11 vs API table 327', r.C_USC, 327, 0.5);
  check('C (USC) at k=1.40 vs API table 356', E.sizeOrificeApi520({ ...base, k: 1.40 }).C_USC, 356, 0.5);
  const Ahand = 53500 / (327 * 0.975 * (75 * 1.1 + 14.7)) * Math.sqrt(627 * 0.9 / 51);
  check('Gas example area with tabulated C (in²)', r.reqAreaIn2, Ahand, 0.5);
  checkTrue('Gas example selects orifice P', r.selectedOrifice.letter === 'P');
}

// ---------------------------------------------------------------------------
// 2. Gas critical: SI engine vs USC form A = W/(C·Kd·P1·Kb·Kc)·sqrt(TZ/M), C=520·kTerm
// ---------------------------------------------------------------------------
{
  const inp = { fluidPhase: 'gas', flowRateKgHr: 28450, setPressureBarg: 22.5, overpressurePct: 10,
    superimposedBackBarg: 1.4, builtUpBackBarg: 0.55, atmPressureBara: 1.01325, relievingTempC: 68,
    valveType: 'conventional', mw: 38.5, k: 1.29, z: 0.88 };
  const r = E.sizeOrificeApi520(inp);
  const P1psia = U.barToPsi(22.5 * 1.1 + 1.01325);
  const A = U.kgHrToLbHr(28450) / (520 * kTerm(1.29) * 0.975 * P1psia) * Math.sqrt(U.cToR(68) * 0.88 / 38.5);
  check('Gas critical SI vs USC (in²)', r.reqAreaIn2, A, 0.5);
}

// ---------------------------------------------------------------------------
// 3. Gas subcritical (high backpressure, pilot valve): USC A = W/(735·F2·Kd·Kc)·sqrt(ZT/(M·P1·(P1-P2)))
// ---------------------------------------------------------------------------
{
  const inp = { fluidPhase: 'gas', flowRateKgHr: 10000, setPressureBarg: 5, overpressurePct: 10,
    superimposedBackBarg: 3.0, builtUpBackBarg: 0.2, atmPressureBara: 1.01325, relievingTempC: 40,
    valveType: 'pilot', mw: 20, k: 1.3, z: 0.95 };
  const r = E.sizeOrificeApi520(inp);
  const P1 = U.barToPsi(5 * 1.1 + 1.01325), P2 = U.barToPsi(3.2 + 1.01325), rr = P2 / P1, k = 1.3;
  const F2 = Math.sqrt((k / (k - 1)) * Math.pow(rr, 2 / k) * (1 - Math.pow(rr, (k - 1) / k)) / (1 - rr));
  const A = U.kgHrToLbHr(10000) / (735 * F2 * 0.975) * Math.sqrt(0.95 * U.cToR(40) / (20 * P1 * (P1 - P2)));
  checkTrue('Subcritical regime detected', r.flowRegime.includes('SUBCRITICAL'));
  check('Gas subcritical SI vs USC (in²)', r.reqAreaIn2, A, 0.5);
}

// ---------------------------------------------------------------------------
// 4. Liquid (non-viscous): USC A = Q(gpm)/(38·Kd·Kw·Kc·Kv)·sqrt(G/ΔP_psi)
// ---------------------------------------------------------------------------
{
  const inp = { fluidPhase: 'liquid', flowRateKgHr: 42500, setPressureBarg: 14, overpressurePct: 10,
    superimposedBackBarg: 1.5, builtUpBackBarg: 0.35, atmPressureBara: 1.01325, relievingTempC: 55,
    valveType: 'conventional', rhoLiqKgM3: 1035, viscCp: 0.5 };
  const r = E.sizeOrificeApi520(inp);
  const G = 1035 / 999, gpm = U.m3HrToGpm(42500 / 1035), dP = U.barToPsi(14 * 1.1 - 1.85);
  const A = gpm / (38 * 0.65) * Math.sqrt(G / dP) / r.Kv;
  check('Liquid SI vs USC (in²)', r.reqAreaIn2, A, 0.5);
}

// ---------------------------------------------------------------------------
// 5. Liquid viscosity: Kv must be < 1 for a viscous liquid and follow API Eq. with selected-orifice Re
// ---------------------------------------------------------------------------
{
  const r = E.sizeOrificeApi520({ fluidPhase: 'liquid', flowRateKgHr: 20000, setPressureBarg: 10,
    overpressurePct: 10, superimposedBackBarg: 0, builtUpBackBarg: 0, atmPressureBara: 1.01325,
    relievingTempC: 40, valveType: 'conventional', rhoLiqKgM3: 900, viscCp: 800 });
  checkTrue(`Viscous liquid Kv < 1 (Kv=${r.Kv.toFixed(3)})`, r.Kv < 0.99);
  checkTrue('Selected orifice area ≥ viscosity-corrected required area', r.selectedOrifice.areaMm2 >= r.reqAreaMm2);
}

// ---------------------------------------------------------------------------
// 6. Steam: USC Napier A = W/(51.5·P1·Kd·Kb·Kc·Kn·Ksh)
// ---------------------------------------------------------------------------
{
  const r = E.sizeOrificeApi520({ fluidPhase: 'steam', flowRateKgHr: 29800, setPressureBarg: 16,
    overpressurePct: 10, superimposedBackBarg: 0, builtUpBackBarg: 0.35, atmPressureBara: 1.01325,
    relievingTempC: 245, valveType: 'conventional', steamSuperheatC: 0 });
  const A = U.kgHrToLbHr(29800) / (51.5 * U.barToPsi(16 * 1.1 + 1.01325) * 0.975);
  check('Steam SI vs USC Napier (in²)', r.reqAreaIn2, A, 0.5);
}

// ---------------------------------------------------------------------------
// 7. Balanced bellows Kb (API 520 Fig. 30) is a function of GAUGE backpressure % of set:
//    10% OP -> Kb = 1.0 up to 30%, ~0.70 at 50%
// ---------------------------------------------------------------------------
{
  const base = { fluidPhase: 'gas', flowRateKgHr: 10000, setPressureBarg: 10, overpressurePct: 10,
    atmPressureBara: 1.01325, relievingTempC: 40, valveType: 'bellows', mw: 20, k: 1.3, z: 0.95, builtUpBackBarg: 0 };
  const r25 = E.sizeOrificeApi520({ ...base, superimposedBackBarg: 2.5 });
  const r40 = E.sizeOrificeApi520({ ...base, superimposedBackBarg: 4.0 });
  check('Bellows Kb at 25% gauge backpressure', r25.Kb, 1.0, 0.5);
  check('Bellows Kb at 40% gauge backpressure (Fig. 30 ≈ 0.85)', r40.Kb, 0.85, 3.0);
}

// ---------------------------------------------------------------------------
// 8. Fire on wetted vessel: SI 43,200·F·A^0.82 (W) must equal USC 21,000·F·A^0.82 (BTU/h)
//    and 2:1 ellipsoidal head area ≈ 1.084·D² per head
// ---------------------------------------------------------------------------
{
  const f = E.calcFireLiquidVessel({ orientation: 'horizontal', headType: 'ellipsoidal', diameterM: 3.2,
    lengthM: 12.5, nllM: 3.2, elevAboveGradeM: 0.5, drainageAdequate: true, envFactorF: 1, latentHeatKjKg: 338 });
  const expectedTotal = Math.PI * 3.2 * 12.5 + 2 * 1.084 * 3.2 * 3.2;
  check('Horizontal 2:1 ellipsoidal total area (m²)', f.totalAreaM2, expectedTotal, 1.0);
  const qUscKw = 21000 * Math.pow(f.wettedAreaM2 * 10.7639, 0.82) / 3412.14;
  check('Fire heat input SI vs USC (kW)', f.heatDutyKw, qUscKw, 1.0);
  check('Fire relief W = Q/λ (kg/h)', f.reliefRateKgHr, f.heatDutyKw * 3600 / 338, 0.01);
}

// ---------------------------------------------------------------------------
// 9. Unwetted gas-filled vessel fire (API 521 Eq. 4.4.13.2.7 USC):
//    W = 0.2772·sqrt(M·P1)·A'·(Tw−T1)^1.25 / T1^1.1506, T1 = Tn·P1/Pn
// ---------------------------------------------------------------------------
{
  const g = E.calcFireGasVessel({ exposedAreaM2: 42, setPressureBarg: 18.5, operatingPressureBarg: 15.6,
    atmPressureBara: 1.01325, normalGasTempC: 52, maxWallTempC: 593, mw: 42.08 });
  const P1 = U.barToPsi(18.5 * 1.21 + 1.01325), Pn = U.barToPsi(15.6 + 1.01325);
  const T1 = U.cToR(52) * P1 / Pn, Tw = U.cToR(593), A = 42 * 10.7639;
  const W = 0.2772 * Math.sqrt(42.08 * P1) * A * Math.pow(Tw - T1, 1.25) / Math.pow(T1, 1.1506);
  check('Unwetted fire relief (lb/h) vs API 521 USC', g.reliefRateLbHr, W, 1.0);
}

// ---------------------------------------------------------------------------
// 10. Thermal expansion: USC gpm = α·H/(500·G·Cp), H BTU/h
// ---------------------------------------------------------------------------
{
  const t = E.calcThermalExpansion({ heatInputKw: 350, alphaVPerC: 0.0009, cpLiqKjKgK: 2.2, rhoLiqKgM3: 810 });
  const H = 350 * 3412.14, aF = 0.0009 / 1.8, G = 810 / 999, cp = 2.2 * 0.238846;
  const gpm = aF * H / (500 * G * cp);
  check('Thermal expansion volumetric (gpm) vs API 521 USC', t.volFlowGpm, gpm, 1.0);
}

// ---------------------------------------------------------------------------
// 11. Control valve gas: IEC 60534 W = N8·Cv·P1·Y·sqrt(x·M/(T·Z)), N8 = 94.8 (Cv, bar, kg/h)
// ---------------------------------------------------------------------------
{
  const c = E.calcControlValveFailure({ fluidPhase: 'gas', ratedCv: 50, bypassCv: 0, upstreamPressBarg: 40,
    setPressureBarg: 15, atmPressureBara: 1.01325, tempC: 40, mw: 20, z: 0.9, normalFlowCreditKgHr: 0, kGas: 1.4 });
  const P1 = 41.01325, x = Math.min(0.42, (P1 - (15 * 1.1 + 1.01325)) / P1), Y = 1 - x / (3 * 0.42);
  const W = 94.8 * 50 * P1 * Y * Math.sqrt(x * 20 / (313.15 * 0.9));
  check('CV failure gas flow (kg/h)', c.reliefRateKgHr, W, 0.5);
}

// ---------------------------------------------------------------------------
// 12. Line hydraulics: two-phase must use mixture density (not ideal-gas density);
//     reaction force for gas = W·v_exit + A·(P_exit − P_atm) with sonic exit
// ---------------------------------------------------------------------------
{
  const tag = E.EPC_TAG_PRESETS.find(p => p.fluidPhase === 'twophase');
  const s = E.sizeOrificeApi520(tag);
  const h = E.calcLineHydraulicsApi520Part2(s, tag);
  check('Two-phase inlet density uses mixture density (kg/m³)', h.rhoInletKgM3, tag.rhoLiqKgM3, 0.1);

  const gTag = E.EPC_TAG_PRESETS[0];
  const gs = E.sizeOrificeApi520(gTag);
  const gh = E.calcLineHydraulicsApi520Part2(gs, { ...gTag, superimposedBackBarg: 0 });
  // open discharge: exit at sonic velocity if choked
  const k = gTag.k, T = gs.T1_K, M = gTag.mw, Z = gTag.z, R = 8314.46;
  const Tstar = 2 * T / (k + 1), vs = Math.sqrt(k * Z * R * Tstar / M);
  const Wkgs = gh.W_evalKgHr / 3600, A = gh.outlet.areaPipeM2;
  const Pstar = (Wkgs / (A * vs)) * Z * R * Tstar / M;
  const Fexp = Pstar > 101325 ? Wkgs * vs + A * (Pstar - 101325) : null;
  if (Fexp) check('Open-discharge reaction force (N), choked exit', gh.outlet.reactionForceN, Fexp, 1.0);
}

// ---------------------------------------------------------------------------
// 13. API 526 selection: smallest orifice ≥ A_req; multi-T valves above 16,774 mm²
// ---------------------------------------------------------------------------
{
  checkTrue('A=126.5 mm² -> E', E.selectApi526Orifice(126.5).letter === 'E');
  checkTrue('A=126.6 mm² -> F', E.selectApi526Orifice(126.6).letter === 'F');
  checkTrue('A=20000 mm² -> 2 × T', E.selectApi526Orifice(20000).letter === '2 × T');
}

// ---------------------------------------------------------------------------
// 14. All presets produce finite, positive results
// ---------------------------------------------------------------------------
for (const p of E.EPC_TAG_PRESETS) {
  const s = E.sizeOrificeApi520(p);
  const h = E.calcLineHydraulicsApi520Part2(s, p);
  const finite = [s.reqAreaMm2, s.ratedCapacityKgHr, h.inlet.dP_totalBar, h.outlet.totalBackBarg, h.outlet.reactionForceN]
    .every(v => Number.isFinite(v) && v >= 0);
  checkTrue(`${p.tagNumber}: finite results (A=${s.reqAreaMm2.toFixed(0)} mm², ${s.selectedOrifice.letter}, inlet ${h.inlet.lossPctOfSet.toFixed(2)}%, Pbt ${h.outlet.totalBackPctOfSet.toFixed(1)}%)`, finite);
}

// ---------------------------------------------------------------------------
// 15. Centrifugal Pump Loop Hydraulics (API 610 / API 14E / IEC 60534):
//     Compare SI engine against USC equations:
//     - TDH (ft) = ΔP (psi) × 2.31 / SG
//     - Brake Power (hp) = Q (gpm) × TDH (ft) × SG / (3960 × η_pump)
//     - NPSHa (ft) = (P_suc_psia - P_vap_psia) × 2.31 / SG + Z_s (ft) - h_f,suc (ft)
//     - API 14E Erosional Velocity v_e (ft/s) = C / sqrt(ρ_lb/ft³)
//     - IEC 60534 Liquid Cv = Q (gpm) × sqrt(SG / ΔP_psi)
// ---------------------------------------------------------------------------
{
  const p = E.PUMP_LOOP_PRESETS[0];
  const r = E.calcPumpLoopHydraulics({ ...p, atmPressureBara: 1.01325 });
  const SG = p.rhoKgM3 / 999.0;

  // USC TDH check: 1 psi = 2.3106 ft of water (ρ_w = 999 kg/m³)
  const dP_psi = U.barToPsi(r.pump.diffPressureRatedBar);
  const tdhFtUsc = (dP_psi * 2.3106) / SG;
  check('Pump TDH SI vs USC (ft)', r.pump.tdhRatedFt, tdhFtUsc, 0.5);

  // USC Brake Horsepower check: BHP = Q(gpm) * H(ft) * SG / (3960 * eff)
  const bhpUsc = (r.Q_ratedGpm * tdhFtUsc * SG) / (3960.0 * (p.pumpEfficiencyPct / 100.0));
  check('Pump Brake Horsepower SI vs USC (hp)', r.pump.brakePowerHp, bhpUsc, 0.5);

  // USC NPSHa check:
  const PsucAbsPsia = U.barToPsi(p.suctionVesselBarg + 1.01325);
  const PvapPsia = U.barToPsi(p.vaporPressBara);
  const hfSucPsia = U.barToPsi(r.suction.dP_totalBar);
  const npshaFtUsc = ((PsucAbsPsia - PvapPsia - hfSucPsia) * 2.3106) / SG + U.mToFt(p.suctionStaticHeadM);
  check('Pump NPSHa SI vs USC (ft)', r.npsh.npshaFt, npshaFtUsc, 0.5);

  // API 14E Erosional Velocity check:
  const vErosFtS = p.erosionalConstantC / Math.sqrt(U.kgm3ToLbft3(p.rhoKgM3));
  check('API 14E Erosional Velocity (ft/s)', r.discharge.vErosionalFtS, vErosFtS, 0.1);

  // Control Valve Cv at Normal Flow check:
  const cvNormUsc = r.Q_normGpm * Math.sqrt(SG / r.controlValve.normal.availableCvDpPsi);
  check('Control Valve Normal Cv vs ISA/IEC USC', r.controlValve.normal.reqCv, cvNormUsc, 0.1);

  for (const preset of E.PUMP_LOOP_PRESETS) {
    const pr = E.calcPumpLoopHydraulics(preset);
    checkTrue(`Pump preset ${preset.pumpTag}: NPSHa compliant & finite TDH (${pr.pump.tdhRatedM.toFixed(1)} m, Motor ${pr.pump.selectedMotorKw} kW)`,
      pr.npsh.compliant && Number.isFinite(pr.pump.tdhRatedM) && pr.pump.selectedMotorKw > 0);
  }
}

// ---------------------------------------------------------------------------
// 16. Process & Mechanical Vessel Sizing from Scratch (GPSA / API 12J / ASME VIII):
//     Compare SI engine against USC equations:
//     - Souders-Brown v_max (ft/s) = K_SB(ft/s) * sqrt((ρ_L - ρ_V) / ρ_V)
//     - Horizontal half-full cylinder area fraction f_A(0.5) = 0.5000
//     - ASME Sec. VIII Div. 1 UG-27 Shell Thickness (in) = P(psi)*R(in) / (S(psi)*E - 0.6*P(psi)) + CA(in)
//     - ASME Sec. VIII Div. 1 UG-32 2:1 Ellipsoidal Head Thickness (in) = P(psi)*D(in) / (2*S(psi)*E - 0.2*P(psi)) + CA(in)
//     - Corroded MAWP (psig) = S(psi)*E*t_net(in) / (R_corr(in) + 0.6*t_net(in))
// ---------------------------------------------------------------------------
{
  const vp = E.VESSEL_SIZING_PRESETS[0];
  const vr = E.calcVesselSizingFromScratch(vp);

  // 1. Souders-Brown maximum velocity SI vs USC (ft/s)
  const vmaxFtSUsc = vr.separation.effectiveKsbFtS * Math.sqrt((vp.liquidDensityKgM3 - vp.vaporDensityKgM3) / vp.vaporDensityKgM3);
  check('Vessel Souders-Brown v_max SI vs USC (ft/s)', U.mToFt(vr.separation.vMaxSoudersBrownMS), vmaxFtSUsc, 0.05);

  // 2. Partial horizontal cylinder area fraction at h/D = 0.50 is exactly 0.5000
  check('Horizontal cylinder half-fill area fraction f_A(0.5)', E.horizontalCylAreaFraction(0.5), 0.5, 0.001);

  // 3. ASME Section VIII Div. 1 UG-27 Shell Thickness SI vs USC (in)
  const P_psi = U.barToPsi(vr.designPressureBarg);
  const S_psi = vr.mechanical.allowableStressPsi;
  const E_j = vr.mechanical.jointEfficiencyE;
  const CA_in = vr.mechanical.corrosionAllowanceMm / 25.4;
  const R_corrIn = (vr.geometry.diameterMm / 2.0 + vr.mechanical.corrosionAllowanceMm) / 25.4;
  const D_corrIn = R_corrIn * 2.0;
  const tShellInUsc = (P_psi * R_corrIn) / (S_psi * E_j - 0.6 * P_psi) + CA_in;
  check('ASME VIII UG-27 Shell Thickness SI vs USC (in)', vr.mechanical.tShellReqIn, tShellInUsc, 0.2);

  // 4. ASME Section VIII Div. 1 UG-32 2:1 Ellipsoidal Head Thickness SI vs USC (in)
  const tHeadInUsc = (P_psi * D_corrIn) / (2 * S_psi * E_j - 0.2 * P_psi) + CA_in;
  check('ASME VIII UG-32 2:1 Ellipsoidal Head SI vs USC (in)', vr.mechanical.tHeadReqIn, tHeadInUsc, 0.2);

  // 5. Corroded MAWP SI vs USC (psig)
  const tNetIn = (vr.mechanical.tShellSelectedMm - vr.mechanical.corrosionAllowanceMm) / 25.4;
  const mawpPsigUsc = (S_psi * E_j * tNetIn) / (R_corrIn + 0.6 * tNetIn);
  check('ASME VIII Corroded Shell MAWP SI vs USC (psig)', vr.mechanical.mawpCorrodedPsig, mawpPsigUsc, 0.2);

  // 6. Verify all 4 EPC Vessel Presets (V-1001, V-2004, V-5001, V-3002)
  for (const preset of E.VESSEL_SIZING_PRESETS) {
    const res = E.calcVesselSizingFromScratch(preset);
    checkTrue(`Vessel preset ${preset.vesselTag} (${preset.vesselServiceType}): compliant separation & finite ASME thickness (ID=${res.geometry.diameterM.toFixed(2)}m × L=${res.geometry.lengthM.toFixed(2)}m, t_shell=${res.mechanical.tShellSelectedMm}mm)`,
      res.separation.vaporCompliant && res.geometry.diameterM >= 0.6 && res.mechanical.tShellSelectedMm >= 6 && res.firePreview.reliefRateKgHr > 0);
  }
}

// ---------------------------------------------------------------------------
// 17. API 521 §4.4.5 Abnormal Heat Input & P&ID Scenario Identification Engine:
//     - Abnormal heat input W = 3600 * max(0, Q_normal*F_surge - Q_cond_credit) / lambda
//     - P&ID System Boundary Credibility Engine across all 4 PID_SYSTEM_PRESETS
// ---------------------------------------------------------------------------
{
  const ah = E.calcAbnormalHeatInput({
    normalDutyKw: 6500,
    abnormalSurgeFactor: 1.65,
    creditedCondenserDutyKw: 0,
    latentHeatKjKg: 215,
    heaterTag: 'E-2005 Reboiler TCV-2005'
  });
  const expectedAhKgHr = (3600.0 * (6500 * 1.65)) / 215.0;
  check('API 521 §4.4.5 Abnormal Heat Input W (kg/h)', ah.reliefRateKgHr, expectedAhKgHr, 0.05);
  checkTrue('API 521 §4.4.5 Abnormal Heat Input overpressure = 10%', ah.allowedOverpressurePct === 10 && ah.scenarioKey === 'abnormal_heat');

  for (const pidPreset of E.PID_SYSTEM_PRESETS) {
    const evalRes = E.evaluatePidScenarioIdentification(pidPreset);
    checkTrue(`P&ID Preset ${pidPreset.id} (${pidPreset.protectedTag}): identifies ${evalRes.credibleScenarios.length} credible causes & governing=${evalRes.governingCredible?.scenarioKey} (Orifice ${evalRes.governingCredible?.orifice?.letter}, W=${Math.round(evalRes.governingCredible?.reliefRateKgHr || 0)} kg/h)`,
      evalRes.credibleScenarios.length >= 2 && !!evalRes.governingCredible && evalRes.governingCredible.reliefRateKgHr > 0 && evalRes.matrix.length === 7);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
