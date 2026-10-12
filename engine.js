/**
 * PSVCalc Pro — Core Engineering Calculation Engine
 * Standards Implemented:
 *   - API 521 (8th Ed.): Pressure-Relieving and Depressuring Systems (Overpressure & Relief Load Scenarios)
 *   - API 520 Part I (10th Ed.): Sizing and Selection of Pressure-Relieving Devices
 *   - API 520 Part II (7th Ed.): Installation of Pressure-Relieving Devices (Inlet 3% Rule, Backpressure, Reaction Force)
 *   - API 526 (7th Ed.): Flanged Steel Pressure-Relief Valves (Standard Orifice Letters D to T)
 *
 * Internal canonical calculation units:
 *   - Mass flow: kg/h (and lb/hr where API USC equations are explicitly displayed alongside SI)
 *   - Pressure (gauge): barg, (absolute): bara, kPaa, psia
 *   - Temperature: °C, K, °F, °R
 *   - Area: mm² and in²
 *   - Density: kg/m³
 *   - Viscosity: cP (mPa·s)
 *   - Latent Heat: kJ/kg
 */

const PSVEngine = (() => {
  // =========================================================================
  // 1. REFERENCE TABLES: API 526 ORIFICES, PIPE SCHEDULES, FLUID PRESETS
  // =========================================================================

  const API_526_ORIFICES = [
    { letter: 'D', areaIn2: 0.110, areaMm2: 71.0,  inletOutFlange: '1" x 2"',     dOrificeMm: 9.51  },
    { letter: 'E', areaIn2: 0.196, areaMm2: 126.5, inletOutFlange: '1" x 2"',     dOrificeMm: 12.70 },
    { letter: 'F', areaIn2: 0.307, areaMm2: 198.1, inletOutFlange: '1.5" x 2"',   dOrificeMm: 15.88 },
    { letter: 'G', areaIn2: 0.503, areaMm2: 324.5, inletOutFlange: '1.5" x 3"',   dOrificeMm: 20.32 },
    { letter: 'H', areaIn2: 0.785, areaMm2: 506.5, inletOutFlange: '2" x 3"',     dOrificeMm: 25.40 },
    { letter: 'J', areaIn2: 1.287, areaMm2: 830.3, inletOutFlange: '3" x 4"',     dOrificeMm: 32.54 },
    { letter: 'K', areaIn2: 1.838, areaMm2: 1185.8,inletOutFlange: '3" x 4"',     dOrificeMm: 38.86 },
    { letter: 'L', areaIn2: 2.853, areaMm2: 1840.6,inletOutFlange: '4" x 6"',     dOrificeMm: 48.41 },
    { letter: 'M', areaIn2: 3.600, areaMm2: 2322.6,inletOutFlange: '4" x 6"',     dOrificeMm: 54.38 },
    { letter: 'N', areaIn2: 4.340, areaMm2: 2800.0,inletOutFlange: '4" x 6"',     dOrificeMm: 59.72 },
    { letter: 'P', areaIn2: 6.380, areaMm2: 4116.1,inletOutFlange: '4" x 6"',     dOrificeMm: 72.39 },
    { letter: 'Q', areaIn2: 11.05, areaMm2: 7129.0,inletOutFlange: '6" x 8"',     dOrificeMm: 95.28 },
    { letter: 'R', areaIn2: 16.00, areaMm2: 10322.6,inletOutFlange: '6" x 10"',   dOrificeMm: 114.68},
    { letter: 'T', areaIn2: 26.00, areaMm2: 16774.2,inletOutFlange: '8" x 10"',   dOrificeMm: 146.15}
  ];

  // ASME B36.10M Standard Pipe Internal Diameters in mm
  const PIPE_SCHEDULES = [
    { nps: '1"',    dn: 25,  odMm: 33.4,  idMm: { 'Sch 10S': 27.86, 'Sch 40 (Std)': 26.64, 'Sch 80 (XS)': 24.31, 'Sch 160': 20.70 } },
    { nps: '1.5"',  dn: 40,  odMm: 48.3,  idMm: { 'Sch 10S': 42.72, 'Sch 40 (Std)': 40.89, 'Sch 80 (XS)': 38.10, 'Sch 160': 33.99 } },
    { nps: '2"',    dn: 50,  odMm: 60.3,  idMm: { 'Sch 10S': 54.79, 'Sch 40 (Std)': 52.50, 'Sch 80 (XS)': 49.25, 'Sch 160': 42.85 } },
    { nps: '3"',    dn: 80,  odMm: 88.9,  idMm: { 'Sch 10S': 82.80, 'Sch 40 (Std)': 77.93, 'Sch 80 (XS)': 73.66, 'Sch 160': 66.65 } },
    { nps: '4"',    dn: 100, odMm: 114.3, idMm: { 'Sch 10S': 108.20,'Sch 40 (Std)': 102.26,'Sch 80 (XS)': 97.18, 'Sch 160': 87.33 } },
    { nps: '6"',    dn: 150, odMm: 168.3, idMm: { 'Sch 10S': 161.50,'Sch 40 (Std)': 154.05,'Sch 80 (XS)': 146.33,'Sch 160': 131.75} },
    { nps: '8"',    dn: 200, odMm: 219.1, idMm: { 'Sch 10S': 211.56,'Sch 40 (Std)': 202.72,'Sch 80 (XS)': 193.68,'Sch 160': 173.05} },
    { nps: '10"',   dn: 250, odMm: 273.1, idMm: { 'Sch 10S': 264.67,'Sch 40 (Std)': 254.51,'Sch 80 (XS)': 247.65,'Sch 160': 215.90} },
    { nps: '12"',   dn: 300, odMm: 323.9, idMm: { 'Sch 10S': 314.71,'Sch 40 (Std)': 304.80,'Sch 80 (XS)': 298.45,'Sch 160': 257.20} },
    { nps: '14"',   dn: 350, odMm: 355.6, idMm: { 'Sch 10S': 346.05,'Sch 40 (Std)': 333.35,'Sch 80 (XS)': 330.20,'Sch 160': 284.18} },
    { nps: '16"',   dn: 400, odMm: 406.4, idMm: { 'Sch 10S': 396.85,'Sch 40 (Std)': 381.00,'Sch 80 (XS)': 381.00,'Sch 160': 325.42} },
    { nps: '18"',   dn: 450, odMm: 457.2, idMm: { 'Sch 10S': 447.65,'Sch 40 (Std)': 428.65,'Sch 80 (XS)': 431.80,'Sch 160': 366.73} },
    { nps: '20"',   dn: 500, odMm: 508.0, idMm: { 'Sch 10S': 496.88,'Sch 40 (Std)': 477.88,'Sch 80 (XS)': 482.60,'Sch 160': 407.98} },
    { nps: '24"',   dn: 600, odMm: 609.6, idMm: { 'Sch 10S': 596.90,'Sch 40 (Std)': 574.65,'Sch 80 (XS)': 584.20,'Sch 160': 490.53} }
  ];

  // Standard Fittings Resistance Coefficients (K-factors) for Line Sizing
  const FITTING_K_FACTORS = {
    entranceSharp:   { label: 'Pipe Entrance (Sharp-Edged / Vessel Nozzle)', k: 0.50 },
    entranceRounded: { label: 'Pipe Entrance (Rounded / Contoured Nozzle)',  k: 0.25 },
    elbow90LR:       { label: '90° Long Radius Elbow (R/D = 1.5)',           k: 0.30 },
    elbow45:         { label: '45° Standard Elbow',                          k: 0.20 },
    teeRun:          { label: 'Tee — Flow Through Run',                      k: 0.20 },
    teeBranch:       { label: 'Tee — Flow Through Branch',                   k: 0.80 },
    gateValveOpen:   { label: 'Full-Port Gate / Ball Valve (CSO/LO)',        k: 0.15 },
    reducerConcentric:{label: 'Concentric Swage / Reducer',                  k: 0.15 },
    ruptureDisc:     { label: 'Upstream Rupture Disc Device',                k: 1.50 }
  };

  // Fluid Property Presets (HYSYS Reference Values)
  const FLUID_PRESETS = {
    sweetNatGas: {
      name: 'Sweet Natural Gas (C1 Rich)',
      phase: 'gas',
      mw: 18.2, k: 1.27, z: 0.91, viscCp: 0.014,
      rhoLiq: 420, latentHeat: 480, cpLiq: 2.5, alphaV: 0.0018
    },
    acidGasAGRU: {
      name: 'AGRU Acid Gas (H2S / CO2 Mix)',
      phase: 'gas',
      mw: 38.5, k: 1.29, z: 0.88, viscCp: 0.015,
      rhoLiq: 780, latentHeat: 390, cpLiq: 2.1, alphaV: 0.0014
    },
    propylene: {
      name: 'Polymer-Grade Propylene (C3=)',
      phase: 'gas',
      mw: 42.08, k: 1.15, z: 0.82, viscCp: 0.011,
      rhoLiq: 514, latentHeat: 338, cpLiq: 2.45, alphaV: 0.0021
    },
    propaneLPG: {
      name: 'Propane / LPG',
      phase: 'gas',
      mw: 44.10, k: 1.13, z: 0.83, viscCp: 0.010,
      rhoLiq: 500, latentHeat: 356, cpLiq: 2.52, alphaV: 0.0019
    },
    nitrogen: {
      name: 'Dry Nitrogen (N2 Utility)',
      phase: 'gas',
      mw: 28.01, k: 1.40, z: 1.00, viscCp: 0.018,
      rhoLiq: 808, latentHeat: 199, cpLiq: 2.04, alphaV: 0.0010
    },
    leanAmine: {
      name: 'Lean MDEA Amine Solution (Liquid)',
      phase: 'liquid',
      mw: 32.0, k: 1.32, z: 0.95, viscCp: 2.85,
      rhoLiq: 1035, latentHeat: 2150, cpLiq: 3.75, alphaV: 0.00045
    },
    coolingWater: {
      name: 'Cooling Water / Process Water',
      phase: 'liquid',
      mw: 18.02, k: 1.33, z: 0.98, viscCp: 0.89,
      rhoLiq: 998, latentHeat: 2257, cpLiq: 4.184, alphaV: 0.00021
    },
    viscousHydrocarbon: {
      name: 'Heavy Gas Oil / Viscous Liquid',
      phase: 'liquid',
      mw: 240.0, k: 1.08, z: 0.80, viscCp: 48.0,
      rhoLiq: 865, latentHeat: 250, cpLiq: 2.05, alphaV: 0.00083
    },
    hpSteam: {
      name: 'Superheated HP Steam',
      phase: 'steam',
      mw: 18.02, k: 1.30, z: 0.94, viscCp: 0.022,
      rhoLiq: 958, latentHeat: 1940, cpLiq: 4.22, alphaV: 0.00050
    },
    flashingCondensate: {
      name: 'Flashing Hydrocarbon Condensate (2-Phase)',
      phase: 'twophase',
      mw: 58.12, k: 1.12, z: 0.84, viscCp: 0.18,
      rhoLiq: 580, latentHeat: 320, cpLiq: 2.40, alphaV: 0.0015
    }
  };

  // =========================================================================
  // 2. UNIT CONVERSION HELPERS (SI <-> USC)
  // =========================================================================

  const Units = {
    // Mass flow: kg/h <-> lb/hr
    kgHrToLbHr: (v) => v * 2.20462262,
    lbHrToKgHr: (v) => v / 2.20462262,

    // Volumetric flow (Liquid): m³/h <-> US gpm
    m3HrToGpm: (v) => v * 4.4028675,
    gpmToM3Hr: (v) => v / 4.4028675,

    // Pressure: bar <-> psi, bar <-> kPa
    barToPsi: (v) => v * 14.5037738,
    psiToBar: (v) => v / 14.5037738,
    barToKpa: (v) => v * 100.0,
    kpaToBar: (v) => v / 100.0,

    // Temperature: °C <-> °F, K, °R
    cToF: (c) => (c * 9 / 5) + 32,
    fToC: (f) => (f - 32) * 5 / 9,
    cToK: (c) => c + 273.15,
    cToR: (c) => (c + 273.15) * 1.8,

    // Length / Area: m <-> ft, mm <-> in, mm² <-> in²
    mToFt: (m) => m * 3.2808399,
    ftToM: (ft) => ft / 3.2808399,
    mmToIn: (mm) => mm / 25.4,
    inToMm: (inch) => inch * 25.4,
    mm2ToIn2: (mm2) => mm2 / 645.16,
    in2ToMm2: (in2) => in2 * 645.16,

    // Density: kg/m³ <-> lb/ft³
    kgm3ToLbft3: (d) => d * 0.06242796,
    lbft3ToKgm3: (d) => d / 0.06242796,

    // Latent Heat: kJ/kg <-> BTU/lb
    kjKgToBtuLb: (h) => h * 0.4299226,
    btuLbToKjKg: (h) => h / 0.4299226,

    // Specific Heat: kJ/(kg·K) <-> BTU/(lb·°F)
    kjKgKToBtuLbF: (cp) => cp * 0.2388459,
    btuLbFToKjKgK: (cp) => cp / 0.2388459,

    // Heat Duty: kW <-> MMBTU/hr
    kwToMmbtuHr: (kw) => kw * 0.00341214,
    mmbtuHrToKw: (mb) => mb / 0.00341214
  };

  // =========================================================================
  // 3. API 521 OVERPRESSURE SCENARIO CALCULATIONS ("FROM BASE")
  // =========================================================================

  /**
   * 3A. External Fire — Liquid-Wetted Vessel (API 521 Section 4.4.13.2.4)
   * Calculates wetted surface area up to 7.62 m (25 ft) above fire grade,
   * heat absorption Q, and required vapor relief rate W = Q / lambda.
   */
  function calcFireLiquidVessel(params) {
    const {
      orientation = 'horizontal', // 'horizontal', 'vertical', 'spherical'
      headType = 'ellipsoidal',   // 'ellipsoidal' (2:1), 'hemispherical', 'flat'
      diameterM = 2.4,            // Vessel ID (m)
      lengthM = 8.0,              // Tangent-to-Tangent length (m)
      nllM = 1.6,                 // Normal Liquid Level from bottom of vessel (m)
      elevAboveGradeM = 1.8,      // Bottom of vessel elevation above fire source grade (m)
      drainageAdequate = true,    // Prompt firefighting & adequate drainage
      envFactorF = 1.0,           // Insulation / environmental factor F
      latentHeatKjKg = 338.0      // Latent heat at relieving pressure (kJ/kg)
    } = params;

    const D = Math.max(0.1, Number(diameterM));
    const L = Math.max(0.1, Number(lengthM));
    const nll = Math.max(0, Math.min(Number(nllM), orientation === 'vertical' ? L : D));
    const zBot = Math.max(0, Number(elevAboveGradeM));
    const flameCeilingM = 7.62; // API 521 25 ft (7.62 m) flame height cutoff above grade

    // Effective liquid height inside vessel that is ALSO below 7.62m above grade
    const maxWettedHeightInVessel = Math.max(0, flameCeilingM - zBot);
    const hEff = Math.min(nll, maxWettedHeightInVessel);

    let totalAreaM2 = 0;
    let wettedAreaM2 = 0;
    let geometryFormulaNote = '';

    if (orientation === 'horizontal') {
      const R = D / 2;
      // Head surface area, both heads combined (as multiple of D²):
      // Flat: 2 × πD²/4; 2:1 Ellipsoidal: 2 × 1.084·D²; Hemispherical: 2 × πD²/2
      const headsAreaFactor = headType === 'hemispherical' ? Math.PI : (headType === 'flat' ? Math.PI / 2 : 2 * 1.084);
      const totalHeadsArea = headsAreaFactor * D * D;
      const totalShellArea = Math.PI * D * L;
      totalAreaM2 = totalShellArea + totalHeadsArea;

      if (hEff <= 0) {
        wettedAreaM2 = 0;
      } else if (hEff >= D) {
        wettedAreaM2 = totalAreaM2;
      } else {
        // Wetted central angle theta (radians) from bottom: cos(theta/2) = (R - hEff) / R
        const cosHalfTheta = Math.max(-1, Math.min(1, (R - hEff) / R));
        const halfTheta = Math.acos(cosHalfTheta); // 0 to pi
        const fracArc = halfTheta / Math.PI;      // fraction of circumference wetted
        // Wetted area of shell + proportional wetted area of heads
        wettedAreaM2 = totalAreaM2 * fracArc;
      }
      geometryFormulaNote = `Horizontal Cylinder (${headType} heads), θ/2 = acos((R - h_eff)/R)`;
    } else if (orientation === 'vertical') {
      const R = D / 2;
      const singleHeadArea = headType === 'hemispherical'
        ? 0.5 * Math.PI * D * D
        : (headType === 'flat' ? Math.PI * R * R : 1.084 * D * D);
      totalAreaM2 = Math.PI * D * L + 2 * singleHeadArea;
      if (hEff <= 0) {
        wettedAreaM2 = 0;
      } else {
        const wettedShellLength = Math.min(L, hEff);
        wettedAreaM2 = singleHeadArea + Math.PI * D * wettedShellLength;
      }
      geometryFormulaNote = `Vertical Vessel (${headType} bottom head + wetted shell up to h_eff)`;
    } else {
      // Spherical vessel
      totalAreaM2 = Math.PI * D * D;
      // Spherical zone area = pi * D * hEff; API 521 also requires at least hemisphere up to equator if liquid below
      const hSphere = Math.min(D, Math.max(hEff, Math.min(D / 2, maxWettedHeightInVessel)));
      wettedAreaM2 = Math.PI * D * hSphere;
      geometryFormulaNote = `Spherical Vessel (A_ws = π · D · h_eff)`;
    }

    // API 521 Heat Absorption Equation (SI):
    // With adequate drainage & firefighting: Q (Watts) = 43,200 * F * A_ws^0.82
    // Without adequate drainage:            Q (Watts) = 70,900 * F * A_ws^0.82
    const cFireSI = drainageAdequate ? 43200 : 70900;
    const cFireUSC = drainageAdequate ? 21000 : 34500;
    const F = Math.max(0.01, Number(envFactorF));
    const heatDutyWatts = cFireSI * F * Math.pow(Math.max(0, wettedAreaM2), 0.82);
    const heatDutyKw = heatDutyWatts / 1000.0;

    // Relief rate W (kg/h) = (Q_kW * 3600) / latentHeat (kJ/kg)
    const lambda = Math.max(10, Number(latentHeatKjKg));
    const reliefRateKgHr = (heatDutyKw * 3600.0) / lambda;

    return {
      scenarioKey: 'fire_liquid',
      scenarioName: 'External Fire — Wetted Vessel (API 521 §4.4.13.2.4)',
      allowedOverpressurePct: 21.0,
      totalAreaM2,
      wettedAreaM2,
      wettedAreaFt2: Units.mToFt(1) * Units.mToFt(1) * wettedAreaM2,
      hEffM: hEff,
      maxWettedHeightInVesselM: maxWettedHeightInVessel,
      cFireSI,
      cFireUSC,
      envFactorF: F,
      heatDutyKw,
      heatDutyMmbtuHr: Units.kwToMmbtuHr(heatDutyKw),
      latentHeatKjKg: lambda,
      reliefRateKgHr,
      reliefRateLbHr: Units.kgHrToLbHr(reliefRateKgHr),
      geometryFormulaNote
    };
  }

  /**
   * 3B. External Fire — Unwetted / Gas-Filled Vessel (API 521 §4.4.13.2.7, USC form)
   *   T1 (°R) = Tn × P1 / Pn               (gas temperature at relieving pressure)
   *   W (lb/h) = 0.2772 × √(M × P1) × A' × (Tw − T1)^1.25 / T1^1.1506
   *   A' = exposed surface area (ft²), P1 = relieving pressure (psia), Tw = max wall temp (°R)
   * Assumes an uninsulated vessel, no credit for firefighting.
   */
  function calcFireGasVessel(params) {
    const {
      exposedAreaM2 = 45.0,
      setPressureBarg = 25.0,
      operatingPressureBarg = 20.0,
      atmPressureBara = 1.01325,
      normalGasTempC = 65.0,
      maxWallTempC = 593.0, // 1100 °F recommended carbon steel limit
      mw = 28.0
    } = params;

    const AsFt2 = Math.max(0.1, Number(exposedAreaM2)) * 10.76391;
    const P1Bara = Number(setPressureBarg) * 1.21 + Number(atmPressureBara);
    const PnBara = Math.max(0.1, Number(operatingPressureBarg) + Number(atmPressureBara));
    const P1Psia = Units.barToPsi(P1Bara);
    const TnR = Units.cToR(Number(normalGasTempC));
    const T1R = TnR * (P1Bara / PnBara);
    const TwR = Units.cToR(Number(maxWallTempC));
    const MW = Math.max(2, Number(mw));
    const dT = Math.max(0, TwR - T1R);

    const wLbHr = 0.2772 * Math.sqrt(MW * P1Psia) * AsFt2 * Math.pow(dT, 1.25) / Math.pow(T1R, 1.1506);
    const reliefRateKgHr = Units.lbHrToKgHr(wLbHr);

    return {
      scenarioKey: 'fire_gas',
      scenarioName: 'External Fire — Unwetted Gas Vessel (API 521 §4.4.13.2.7)',
      allowedOverpressurePct: 21.0,
      exposedAreaM2: Number(exposedAreaM2),
      exposedAreaFt2: AsFt2,
      P1Bara,
      P1Psia,
      PnBara,
      T1R,
      T1C: T1R / 1.8 - 273.15,
      TwR,
      wallTempWarning: dT <= 0 ? 'Gas temperature at relieving pressure ≥ wall temperature — equation not applicable.' : '',
      reliefRateKgHr,
      reliefRateLbHr: wLbHr
    };
  }

  /**
   * 3C. Blocked Outlet (API 521 §4.4.2)
   * Relief rate equals maximum upstream source capability at relieving pressure minus credited outflows.
   */
  function calcBlockedOutlet(params) {
    const {
      sourceType = 'pump_compressor', // 'pump_compressor', 'upstream_header'
      maxInflowKgHr = 28500,
      creditedOutflowKgHr = 0,
      safetyMarginFactor = 1.0
    } = params;

    const netFlow = Math.max(0, (Number(maxInflowKgHr) - Number(creditedOutflowKgHr)) * Number(safetyMarginFactor));
    return {
      scenarioKey: 'blocked_outlet',
      scenarioName: 'Blocked Outlet — Maximum Upstream Inflow (API 521 §4.4.2)',
      allowedOverpressurePct: 10.0,
      sourceType,
      maxInflowKgHr: Number(maxInflowKgHr),
      creditedOutflowKgHr: Number(creditedOutflowKgHr),
      safetyMarginFactor: Number(safetyMarginFactor),
      reliefRateKgHr: netFlow,
      reliefRateLbHr: Units.kgHrToLbHr(netFlow)
    };
  }

  /**
   * 3D. Control Valve Failure / Inadvertent Opening (API 521 §4.4.8)
   * Calculates maximum flow through failed-open control valve (plus optional partial bypass)
   * using ISA-75.01 / IEC 60534 Cv equations at relieving pressure P1.
   */
  function calcControlValveFailure(params) {
    const {
      fluidPhase = 'gas',       // 'gas' or 'liquid'
      ratedCv = 85.0,           // Control valve max rated Cv
      bypassCv = 0.0,           // Bypass valve Cv if credited open
      upstreamPressBarg = 42.0, // Upstream header pressure (barg)
      setPressureBarg = 18.0,   // Protected equipment set pressure (barg)
      atmPressureBara = 1.01325,
      tempC = 45.0,
      mw = 20.5,
      z = 0.90,
      rhoLiqKgM3 = 820.0,
      normalFlowCreditKgHr = 4500.0 // Normal flow credited when downstream remains open
    } = params;

    const totalCv = Math.max(0, Number(ratedCv) + Number(bypassCv));
    const P_upBara = Number(upstreamPressBarg) + Number(atmPressureBara);
    const P_1Bara = Number(setPressureBarg) * 1.10 + Number(atmPressureBara);
    const dPBar = Math.max(0.01, P_upBara - P_1Bara);

    let maxCvFlowKgHr = 0;
    let equationNote = '';

    if (fluidPhase === 'liquid') {
      const SG = Math.max(0.1, Number(rhoLiqKgM3) / 999.0);
      const dPPsi = Units.barToPsi(dPBar);
      // Q (gpm) = Cv * sqrt(dP_psi / SG)
      const qGpm = totalCv * Math.sqrt(dPPsi / SG);
      const qM3Hr = Units.gpmToM3Hr(qGpm);
      maxCvFlowKgHr = qM3Hr * Number(rhoLiqKgM3);
      equationNote = `Liquid ISA Cv: Q = Cv · √(ΔP / SG) = ${qGpm.toFixed(1)} US gpm (${qM3Hr.toFixed(1)} m³/h)`;
    } else {
      // Gas ISA-75.01 / IEC 60534-2-1 Eq. (N8 = 94.8 for W in kg/h, P_up in bara):
      // W (kg/h) = 94.8 * Cv * P_up(bara) * Y * sqrt(x * MW / (T_K * Z))
      const T_K = Units.cToK(Number(tempC));
      const x = Math.min(0.42, dPBar / Math.max(0.1, P_upBara)); // choked pressure drop ratio xT ~ 0.42
      const Y = 1 - (x / (3 * 0.42)); // expansion factor
      maxCvFlowKgHr = 94.8 * totalCv * P_upBara * Y * Math.sqrt((x * Number(mw)) / (T_K * Number(z)));
      equationNote = `Gas IEC 60534-2-1 (N₈ = 94.8, x = ${x.toFixed(3)}, Y = ${Y.toFixed(3)})`;
    }

    const netReliefKgHr = Math.max(0, maxCvFlowKgHr - Number(normalFlowCreditKgHr));

    return {
      scenarioKey: 'cv_failure',
      scenarioName: 'Control Valve Failure — Fail Open (API 521 §4.4.8)',
      allowedOverpressurePct: 10.0,
      totalCv,
      P_upBara,
      P_1Bara,
      dPBar,
      maxCvFlowKgHr,
      normalFlowCreditKgHr: Number(normalFlowCreditKgHr),
      reliefRateKgHr: netReliefKgHr,
      reliefRateLbHr: Units.kgHrToLbHr(netReliefKgHr),
      equationNote
    };
  }

  /**
   * 3E. Thermal / Hydraulic Expansion (API 521 §4.4.12)
   * Volumetric expansion rate: q (m³/h) = (3600 * alpha_v * Q_kW) / (rho_kg_m3 * Cp_kJ_kgK)
   * Mass relief rate: W (kg/h) = (3600 * alpha_v * Q_kW) / Cp_kJ_kgK
   */
  function calcThermalExpansion(params) {
    const {
      heatInputKw = 350.0,        // Exchanger blocked-in duty or solar radiation (kW)
      alphaVPerC = 0.00083,       // Cubical expansion coefficient (1/°C)
      cpLiqKjKgK = 2.20,          // Specific heat capacity of trapped liquid (kJ/kg·K)
      rhoLiqKgM3 = 810.0          // Liquid density (kg/m³)
    } = params;

    const Q = Math.max(0, Number(heatInputKw));
    const alpha = Math.max(0.00005, Number(alphaVPerC));
    const cp = Math.max(0.2, Number(cpLiqKjKgK));
    const rho = Math.max(100, Number(rhoLiqKgM3));

    const reliefRateKgHr = (3600.0 * alpha * Q) / cp;
    const volFlowM3Hr = reliefRateKgHr / rho;
    const volFlowGpm = Units.m3HrToGpm(volFlowM3Hr);

    return {
      scenarioKey: 'thermal_expansion',
      scenarioName: 'Thermal / Hydraulic Expansion (API 521 §4.4.12)',
      allowedOverpressurePct: 10.0,
      heatInputKw: Q,
      alphaVPerC: alpha,
      cpLiqKjKgK: cp,
      rhoLiqKgM3: rho,
      volFlowM3Hr,
      volFlowGpm,
      reliefRateKgHr,
      reliefRateLbHr: Units.kgHrToLbHr(reliefRateKgHr)
    };
  }

  /**
   * 3F. Heat Exchanger Tube Rupture (API 521 §4.4.14)
   * Double-ended guillotine tube break: flow enters from both tube ends (2 * A_tube).
   */
  function calcTubeRupture(params) {
    const {
      hpFluidPhase = 'liquid',  // 'liquid' or 'gas'
      tubeIdMm = 15.7,          // Exchanger tube ID (mm), e.g. 3/4" BWG 14
      hpPressureBarg = 65.0,    // High-pressure side design/operating pressure (barg)
      lpSetPressureBarg = 15.0, // Low-pressure side PSV set pressure (barg)
      atmPressureBara = 1.01325,
      rhoHpKgM3 = 780.0,
      mwHp = 22.0,
      kHp = 1.26,
      zHp = 0.90,
      tempHpC = 85.0
    } = params;

    const dMm = Math.max(2, Number(tubeIdMm));
    const singleTubeAreaMm2 = (Math.PI / 4) * dMm * dMm;
    const totalBreakAreaMm2 = 2 * singleTubeAreaMm2; // Double-ended guillotine break
    const totalBreakAreaM2 = totalBreakAreaMm2 * 1e-6;

    const P_hpBara = Number(hpPressureBarg) + Number(atmPressureBara);
    const P_lpBara = Number(lpSetPressureBarg) * 1.10 + Number(atmPressureBara);
    const dP_Pa = Math.max(1000, (P_hpBara - P_lpBara) * 1e5);
    const Cd = 0.70; // API 521 sharp-edged tube rupture discharge coefficient

    let reliefRateKgHr = 0;
    if (hpFluidPhase === 'liquid') {
      const rho = Math.max(100, Number(rhoHpKgM3));
      // Orifice equation: m_dot (kg/s) = Cd * A_break * sqrt(2 * rho * dP)
      const mDotKgS = Cd * totalBreakAreaM2 * Math.sqrt(2 * rho * dP_Pa);
      reliefRateKgHr = mDotKgS * 3600.0;
    } else {
      // Choked / subcritical gas flow across 2 * A_tube
      const K = Math.max(1.01, Number(kHp));
      const cSI = 0.03948 * Math.sqrt(K * Math.pow(2 / (K + 1), (K + 1) / (K - 1)));
      const P_hpKpaa = P_hpBara * 100.0;
      const T_K = Units.cToK(Number(tempHpC));
      // W (kg/h) = C_SI * Cd * A_mm2 * P_kPaa * sqrt(MW / (Z * T_K))
      reliefRateKgHr = cSI * Cd * totalBreakAreaMm2 * P_hpKpaa * Math.sqrt(Number(mwHp) / (Number(zHp) * T_K));
    }

    return {
      scenarioKey: 'tube_rupture',
      scenarioName: 'Heat Exchanger Tube Rupture — Double-Ended (API 521 §4.4.14)',
      allowedOverpressurePct: 10.0,
      tubeIdMm: dMm,
      singleTubeAreaMm2,
      totalBreakAreaMm2,
      P_hpBara,
      P_lpBara,
      Cd,
      reliefRateKgHr,
      reliefRateLbHr: Units.kgHrToLbHr(reliefRateKgHr)
    };
  }

  // =========================================================================
  // 4. API 520 PART I ORIFICE SIZING ENGINE (GAS, LIQUID, STEAM, TWO-PHASE)
  // =========================================================================

  /**
   * Computes backpressure correction factor Kb (Gas/Vapor/Steam) or Kw (Liquid)
   * for balanced bellows valves, digitized from API 520 Part I Fig. 30 / Fig. 32.
   * Input is GAUGE backpressure as a fraction of GAUGE set pressure (Pb/Ps).
   * These are generic curves — use vendor-certified factors for final design.
   */
  function computeBackpressureFactor(valveType, gaugeBackRatio, overpressurePct, fluidPhase) {
    const pct = Math.max(0, Math.min(99, gaugeBackRatio * 100));
    if (valveType !== 'bellows') {
      // Conventional (within its backpressure limit) and pilot valves: Kb = 1.0
      return 1.0;
    }
    if (fluidPhase === 'liquid') {
      // Fig. 32: Kw = 1.0 up to 15 %, then linear to ≈0.70 at 50 %
      if (pct <= 15) return 1.0;
      return Math.max(0.50, 1.0 - (pct - 15) * (0.30 / 35));
    }
    // Fig. 30: Kb = 1.0 up to a breakpoint that depends on overpressure, then ≈ −0.015 per %
    const op = Number(overpressurePct);
    const breakpoint = op >= 21 ? 50 : (op >= 16 ? 38 : 30);
    if (pct <= breakpoint) return 1.0;
    return Math.max(0.50, 1.0 - (pct - breakpoint) * 0.015);
  }

  /**
   * Select API 526 Standard Orifice from Required Area (mm² or in²)
   */
  function selectApi526Orifice(reqAreaMm2) {
    const areaMm2 = Math.max(0, Number(reqAreaMm2));
    for (const o of API_526_ORIFICES) {
      if (o.areaMm2 >= areaMm2) {
        const utilizationPct = o.areaMm2 > 0 ? (areaMm2 / o.areaMm2) * 100.0 : 0;
        return {
          ...o,
          exceedsSingleValve: false,
          numValvesRequired: 1,
          utilizationPct,
          marginPct: 100.0 - utilizationPct
        };
      }
    }
    // If larger than a single 'T' orifice, compute number of parallel 'T' valves needed
    const tOrifice = API_526_ORIFICES[API_526_ORIFICES.length - 1];
    const numValves = Math.ceil(areaMm2 / tOrifice.areaMm2);
    const totalInstalledAreaMm2 = numValves * tOrifice.areaMm2;
    const utilizationPct = (areaMm2 / totalInstalledAreaMm2) * 100.0;
    return {
      letter: `${numValves} × T`,
      areaIn2: numValves * tOrifice.areaIn2,
      areaMm2: totalInstalledAreaMm2,
      inletOutFlange: `${numValves} × (${tOrifice.inletOutFlange})`,
      dOrificeMm: tOrifice.dOrificeMm,
      exceedsSingleValve: true,
      numValvesRequired: numValves,
      utilizationPct,
      marginPct: 100.0 - utilizationPct
    };
  }

  /**
   * Master API 520 Part I Orifice Sizing Function
   */
  function sizeOrificeApi520(input) {
    const {
      fluidPhase = 'gas',          // 'gas', 'liquid', 'steam', 'twophase'
      flowRateKgHr = 18500,        // Required relief mass flow W (kg/h)
      setPressureBarg = 18.0,      // PSV Set Pressure (barg)
      overpressurePct = 10.0,      // Allowed overpressure % (10%, 16%, 21%)
      superimposedBackBarg = 1.2,  // Constant superimposed backpressure (barg)
      builtUpBackBarg = 0.6,       // Built-up backpressure (barg)
      atmPressureBara = 1.01325,   // Barometric pressure (bara)
      relievingTempC = 65.0,       // Relieving temperature T1 (°C)
      valveType = 'conventional',  // 'conventional', 'bellows', 'pilot'
      ruptureDiscUpstream = false, // Kc = 0.9 if true, 1.0 if false
      autoKb = true,
      manualKb = 1.0,
      // Fluid Properties
      mw = 20.5,                   // Molecular weight (kg/kmol)
      k = 1.27,                    // Cp/Cv ratio at relieving conditions
      z = 0.91,                    // Compressibility factor Z
      rhoLiqKgM3 = 820.0,          // Liquid density (kg/m³)
      viscCp = 1.2,                // Dynamic viscosity (cP)
      steamSuperheatC = 0.0,       // Degrees of superheat above saturation (°C) for steam
      // Two-Phase Leung Omega inputs
      omegaParam = 0.65            // Leung Omega parameter ω
    } = input;

    const W_kgHr = Math.max(1e-3, Number(flowRateKgHr));
    const W_lbHr = Units.kgHrToLbHr(W_kgHr);
    const P_setBarg = Math.max(0.05, Number(setPressureBarg));
    const P_setPsig = Units.barToPsi(P_setBarg);
    const opFrac = Math.max(0.01, Number(overpressurePct) / 100.0);
    const P_atmBara = Math.max(0.5, Number(atmPressureBara));
    const P_atmPsia = Units.barToPsi(P_atmBara);

    // Relieving Pressure P1 (absolute)
    const P1_barg = P_setBarg * (1.0 + opFrac);
    const P1_bara = P1_barg + P_atmBara;
    const P1_kPaa = P1_bara * 100.0;
    const P1_psia = Units.barToPsi(P1_bara);

    // Total Backpressure P2
    const P_backBarg = Math.max(0, Number(superimposedBackBarg) + Number(builtUpBackBarg));
    const P2_bara = P_backBarg + P_atmBara;
    const P2_kPaa = P2_bara * 100.0;
    const P2_psia = Units.barToPsi(P2_bara);

    const backpressurePctOfSet = (P_backBarg / P_setBarg) * 100.0;
    const absBackpressureRatio = P2_bara / P1_bara;

    // Temperature
    const T1_C = Number(relievingTempC);
    const T1_K = Units.cToK(T1_C);
    const T1_F = Units.cToF(T1_C);
    const T1_R = Units.cToR(T1_C);

    // Combination factor Kc
    const Kc = ruptureDiscUpstream ? 0.90 : 1.00;

    let Kd = 0.975;
    let Kb = 1.0;
    let Kv = 1.0;
    let Ksh = 1.0;
    let Kn = 1.0;
    let C_SI = 0;
    let C_USC = 0;
    let F2 = 0;
    let Pcf_bara = 0;
    let Pcf_psia = 0;
    let flowRegime = 'CRITICAL (CHOKED)';
    let reqAreaMm2 = 0;
    let reqAreaIn2 = 0;
    let ratedCapacityKgHr = 0;
    let steps = [];
    let warnings = [];

    // Check backpressure vs valve type suitability
    if (valveType === 'conventional' && backpressurePctOfSet > Number(overpressurePct)) {
      warnings.push(
        `Total backpressure (${backpressurePctOfSet.toFixed(1)}% of P_set) exceeds allowable limit (${Number(overpressurePct).toFixed(1)}%) for a Conventional PSV. Switch to Balanced Bellows or Pilot-Operated.`
      );
    } else if (valveType === 'bellows' && backpressurePctOfSet > 50.0) {
      warnings.push(
        `Total backpressure (${backpressurePctOfSet.toFixed(1)}% of P_set) exceeds 50% limit for Balanced Bellows PSV. Switch to Pilot-Operated.`
      );
    }

    // -----------------------------------------------------------------------
    // CASE 1: GAS / VAPOR SERVICE (API 520 Part I §5.6)
    // -----------------------------------------------------------------------
    if (fluidPhase === 'gas') {
      Kd = 0.975;
      const K = Math.max(1.001, Number(k));
      const MW = Math.max(2.0, Number(mw));
      const Z = Math.max(0.1, Number(z));

      // Critical Flow Nozzle Pressure Pcf (API 520 Eq. 1)
      const critRatio = Math.pow(2.0 / (K + 1.0), K / (K - 1.0));
      Pcf_bara = P1_bara * critRatio;
      Pcf_psia = P1_psia * critRatio;

      // Gas expansion coefficient C:
      const kTerm = Math.sqrt(K * Math.pow(2.0 / (K + 1.0), (K + 1.0) / (K - 1.0)));
      C_USC = 520.0 * kTerm;
      C_SI = 0.03948 * kTerm;

      const isCritical = P2_bara <= Pcf_bara;
      flowRegime = isCritical ? 'CRITICAL (CHOKED) FLOW' : 'SUBCRITICAL FLOW';

      if (isCritical) {
        Kb = autoKb ? computeBackpressureFactor(valveType, P_backBarg / P_setBarg, overpressurePct, 'gas') : Number(manualKb);
        // API 520 Eq. 3 (SI): A (mm²) = W / (C_SI * Kd * P1_kPaa * Kb * Kc) * sqrt((T1_K * Z) / MW)
        reqAreaMm2 = (W_kgHr / (C_SI * Kd * P1_kPaa * Kb * Kc)) * Math.sqrt((T1_K * Z) / MW);
        reqAreaIn2 = Units.mm2ToIn2(reqAreaMm2);

        steps = [
          {
            title: '1. Relieving & Backpressure Conditions',
            formula: 'P₁ = P_set × (1 + OP%) + P_atm   |   P₂ = P_back + P_atm',
            substitution: `P₁ = ${P_setBarg.toFixed(2)} × (1 + ${(opFrac * 100).toFixed(0)}%) + ${P_atmBara.toFixed(3)} = ${P1_bara.toFixed(3)} bara (${P1_kPaa.toFixed(1)} kPaa / ${P1_psia.toFixed(1)} psia)`,
            result: `P₁ = ${P1_bara.toFixed(3)} bara, P₂ = ${P2_bara.toFixed(3)} bara (P₂/P₁ = ${absBackpressureRatio.toFixed(3)})`
          },
          {
            title: '2. Critical Flow Pressure Ratio Check (API 520 Eq. 1)',
            formula: 'P_cf = P₁ × [ 2 / (k + 1) ]^(k / (k - 1))',
            substitution: `P_cf = ${P1_bara.toFixed(3)} × [ 2 / (${K.toFixed(3)} + 1) ]^(${K.toFixed(3)} / ${(K - 1).toFixed(3)}) = ${P1_bara.toFixed(3)} × ${critRatio.toFixed(4)}`,
            result: `P_cf = ${Pcf_bara.toFixed(3)} bara (${Pcf_psia.toFixed(1)} psia) ≥ P₂ (${P2_bara.toFixed(3)} bara) → CRITICAL FLOW`
          },
          {
            title: '3. Gas Constant C & Correction Factors (Kd, Kb, Kc)',
            formula: 'C_SI = 0.03948 × √[ k × (2/(k+1))^((k+1)/(k-1)) ]   (C_USC = 520 × ...)',
            substitution: `C_SI = 0.03948 × ${kTerm.toFixed(4)} = ${C_SI.toFixed(5)}   |   C_USC = ${C_USC.toFixed(2)}`,
            result: `C_SI = ${C_SI.toFixed(5)} (C_USC = ${C_USC.toFixed(1)}), Kd = ${Kd.toFixed(3)}, Kb = ${Kb.toFixed(3)}, Kc = ${Kc.toFixed(2)}`
          },
          {
            title: '4. Required Effective Orifice Area A (API 520 Part I §5.6.3.1.1)',
            formula: 'A = [ W / (C × Kd × P₁ × Kb × Kc) ] × √[ (T₁ × Z) / M ]',
            substitution: `A (mm²) = [ ${W_kgHr.toFixed(1)} / (${C_SI.toFixed(5)} × ${Kd} × ${P1_kPaa.toFixed(1)} × ${Kb.toFixed(3)} × ${Kc.toFixed(2)}) ] × √[ (${T1_K.toFixed(2)} × ${Z.toFixed(3)}) / ${MW.toFixed(2)} ]`,
            result: `A_req = ${reqAreaMm2.toFixed(1)} mm² (${reqAreaIn2.toFixed(4)} in²)`
          }
        ];
      } else {
        // Subcritical Gas/Vapor Flow (API 520 Part I §5.6.3.2)
        const r = Math.min(0.999, P2_bara / P1_bara);
        F2 = Math.sqrt((K / (K - 1.0)) * Math.pow(r, 2.0 / K) * ((1.0 - Math.pow(r, (K - 1.0) / K)) / (1.0 - r)));
        Kb = 1.0;
        const dP_kPa = Math.max(0.1, P1_kPaa - P2_kPaa);
        reqAreaMm2 = ((17.9 * W_kgHr) / (F2 * Kd * Kc)) * Math.sqrt((Z * T1_K) / (MW * P1_kPaa * dP_kPa));
        reqAreaIn2 = Units.mm2ToIn2(reqAreaMm2);

        steps = [
          {
            title: '1. Relieving & Backpressure Conditions',
            formula: 'P₁ = P_set × (1 + OP%) + P_atm   |   P₂ = P_back + P_atm',
            substitution: `P₁ = ${P1_bara.toFixed(3)} bara (${P1_kPaa.toFixed(1)} kPaa), P₂ = ${P2_bara.toFixed(3)} bara (${P2_kPaa.toFixed(1)} kPaa)`,
            result: `r = P₂ / P₁ = ${r.toFixed(4)}`
          },
          {
            title: '2. Critical Pressure Check & Subcritical Coefficient F₂ (API 520 Eq. 14)',
            formula: 'F₂ = √{ [k/(k-1)] × r^(2/k) × [1 - r^((k-1)/k)] / [1 - r] }',
            substitution: `P_cf = ${Pcf_bara.toFixed(3)} bara < P₂ (${P2_bara.toFixed(3)} bara) → SUBCRITICAL. F₂ evaluated at r = ${r.toFixed(4)}, k = ${K.toFixed(3)}`,
            result: `F₂ = ${F2.toFixed(4)}, Kd = ${Kd.toFixed(3)}, Kc = ${Kc.toFixed(2)}`
          },
          {
            title: '3. Subcritical Required Orifice Area A (API 520 Eq. 11)',
            formula: 'A = [ 17.9 × W / (F₂ × Kd × Kc) ] × √[ (Z × T₁) / (M × P₁ × (P₁ - P₂)) ]',
            substitution: `A (mm²) = [ 17.9 × ${W_kgHr.toFixed(1)} / (${F2.toFixed(4)} × ${Kd} × ${Kc}) ] × √[ (${Z} × ${T1_K.toFixed(1)}) / (${MW} × ${P1_kPaa.toFixed(1)} × ${dP_kPa.toFixed(1)}) ]`,
            result: `A_req = ${reqAreaMm2.toFixed(1)} mm² (${reqAreaIn2.toFixed(4)} in²)`
          }
        ];
      }
    }

    // -----------------------------------------------------------------------
    // CASE 2: LIQUID SERVICE WITH ITERATIVE VISCOSITY CORRECTION Kv (API 520 §5.8)
    // -----------------------------------------------------------------------
    else if (fluidPhase === 'liquid') {
      Kd = 0.65;
      const rho = Math.max(100, Number(rhoLiqKgM3));
      const SG = rho / 999.0;
      const muCp = Math.max(0.05, Number(viscCp));
      const Q_m3Hr = W_kgHr / rho;
      const Q_Lmin = (Q_m3Hr * 1000.0) / 60.0;
      const Q_gpm = Units.m3HrToGpm(Q_m3Hr);

      const dP_bar = Math.max(0.05, P1_barg - P_backBarg);
      const dP_kPa = dP_bar * 100.0;
      const dP_psi = Units.barToPsi(dP_bar);

      const pbRatioGauge = P_backBarg / P_setBarg;
      const Kw = autoKb ? computeBackpressureFactor(valveType, pbRatioGauge, overpressurePct, 'liquid') : Number(manualKb);
      Kb = Kw;

      const A_prelimMm2 = ((11.78 * Q_Lmin) / (Kd * Kw * Kc * 1.0)) * Math.sqrt(SG / dP_kPa);
      const A_prelimIn2 = Units.mm2ToIn2(A_prelimMm2);

      // API 520 §5.8.3: compute Re using the effective area of the selected standard orifice,
      // derive Kv, recompute A = A_prelim / Kv, and repeat until the orifice selection is stable.
      const kvFromRe = (re) => Math.max(0.30, Math.min(1.0,
        1.0 / (0.9935 + (2.878 / Math.pow(re, 0.5)) + (342.75 / Math.pow(re, 1.5)))));
      let trialOrificeIn2 = selectApi526Orifice(A_prelimMm2).areaIn2;
      let Re = 0;
      for (let iter = 0; iter < 10; iter++) {
        Re = (Q_gpm * 2800.0 * SG) / (muCp * Math.sqrt(Math.max(0.01, trialOrificeIn2)));
        Kv = kvFromRe(Re);
        const nextIn2 = selectApi526Orifice(A_prelimMm2 / Kv).areaIn2;
        if (nextIn2 === trialOrificeIn2) break;
        trialOrificeIn2 = nextIn2;
      }

      reqAreaMm2 = A_prelimMm2 / Kv;
      reqAreaIn2 = Units.mm2ToIn2(reqAreaMm2);
      flowRegime = Re < 2000 ? `LAMINAR / VISCOUS LIQUID (Re = ${Re.toFixed(0)})` : `TURBULENT LIQUID (Re = ${Re.toFixed(0)})`;

      steps = [
        {
          title: '1. Volumetric Flow Rate & Differential Pressure (ΔP)',
          formula: 'Q = W / ρ   |   ΔP = P₁ - P₂',
          substitution: `Q = ${W_kgHr.toFixed(1)} / ${rho.toFixed(1)} = ${Q_m3Hr.toFixed(2)} m³/h (${Q_Lmin.toFixed(1)} L/min / ${Q_gpm.toFixed(1)} US gpm), SG = ${SG.toFixed(3)}`,
          result: `ΔP = ${P1_barg.toFixed(2)} - ${P_backBarg.toFixed(2)} = ${dP_bar.toFixed(2)} bar (${dP_kPa.toFixed(1)} kPa / ${dP_psi.toFixed(1)} psi)`
        },
        {
          title: '2. Preliminary Non-Viscous Area A_prelim (Kv = 1.0, API 520 Eq. 33)',
          formula: 'A_prelim (mm²) = [ 11.78 × Q(L/min) / (Kd × Kw × Kc × 1.0) ] × √(G / ΔP_kPa)',
          substitution: `A_prelim = [ 11.78 × ${Q_Lmin.toFixed(1)} / (${Kd} × ${Kw.toFixed(3)} × ${Kc.toFixed(2)} × 1.0) ] × √(${SG.toFixed(3)} / ${dP_kPa.toFixed(1)})`,
          result: `A_prelim = ${A_prelimMm2.toFixed(1)} mm² (${A_prelimIn2.toFixed(4)} in²)`
        },
        {
          title: '3. Reynolds Number & Viscosity Correction Factor Kv (API 520 Eq. 35 & 36)',
          formula: 'Re = [ Q(gpm) × 2800 × G ] / [ μ(cP) × √A_in² ]   |   Kv = [ 0.9935 + 2.878/√Re + 342.75/Re^1.5 ]⁻¹',
          substitution: `Re = [ ${Q_gpm.toFixed(1)} × 2800 × ${SG.toFixed(3)} ] / [ ${muCp.toFixed(2)} × √${trialOrificeIn2.toFixed(3)} (selected std. orifice, iterated) ] = ${Re.toFixed(0)}`,
          result: `Re = ${Re.toFixed(0)}, Kv = ${Kv.toFixed(4)}`
        },
        {
          title: '4. Final Viscosity-Corrected Orifice Area A_req',
          formula: 'A_req = A_prelim / Kv',
          substitution: `A_req = ${A_prelimMm2.toFixed(1)} / ${Kv.toFixed(4)}`,
          result: `A_req = ${reqAreaMm2.toFixed(1)} mm² (${reqAreaIn2.toFixed(4)} in²)`
        }
      ];
    }

    // -----------------------------------------------------------------------
    // CASE 3: STEAM SERVICE (API 520 Part I §5.7 — Napier Equation)
    // -----------------------------------------------------------------------
    else if (fluidPhase === 'steam') {
      Kd = 0.975;
      Kb = autoKb ? computeBackpressureFactor(valveType, P_backBarg / P_setBarg, overpressurePct, 'gas') : Number(manualKb);

      if (P1_psia > 1500.0) {
        Kn = (0.1906 * P1_psia - 1000.0) / (0.2292 * P1_psia - 1061.0);
      } else {
        Kn = 1.0;
      }

      const dT_shC = Math.max(0, Number(steamSuperheatC));
      if (dT_shC <= 2) {
        Ksh = 1.0;
      } else {
        Ksh = Math.max(0.72, 1.0 / Math.sqrt(1.0 + 0.0021 * dT_shC));
      }

      reqAreaMm2 = (190.5 * W_kgHr) / (P1_kPaa * Kd * Kb * Kc * Kn * Ksh);
      reqAreaIn2 = Units.mm2ToIn2(reqAreaMm2);
      flowRegime = dT_shC > 2 ? `SUPERHEATED STEAM (ΔT_sh = ${dT_shC.toFixed(0)} °C)` : 'SATURATED DRY STEAM';

      steps = [
        {
          title: '1. Steam Relieving Pressure P₁',
          formula: 'P₁ = P_set × (1 + OP%) + P_atm',
          substitution: `P₁ = ${P_setBarg.toFixed(2)} × (1 + ${(opFrac * 100).toFixed(0)}%) + ${P_atmBara.toFixed(3)}`,
          result: `P₁ = ${P1_bara.toFixed(3)} bara (${P1_kPaa.toFixed(1)} kPaa / ${P1_psia.toFixed(1)} psia)`
        },
        {
          title: '2. Napier Correction Factors (Kn, Ksh, Kd, Kb, Kc)',
          formula: 'Kn = 1.0 (if P₁ ≤ 103.4 bara) else (0.1906·P₁_psia - 1000)/(0.2292·P₁_psia - 1061)',
          substitution: `Kn = ${Kn.toFixed(4)}, Ksh = ${Ksh.toFixed(4)} (Superheat = ${dT_shC.toFixed(1)} °C), Kd = ${Kd}, Kb = ${Kb.toFixed(3)}, Kc = ${Kc}`,
          result: `Kn = ${Kn.toFixed(4)}, Ksh = ${Ksh.toFixed(4)}`
        },
        {
          title: '3. Required Steam Orifice Area A (API 520 Eq. 28)',
          formula: 'A (mm²) = (190.5 × W) / (P₁_kPaa × Kd × Kb × Kc × Kn × Ksh)',
          substitution: `A = (190.5 × ${W_kgHr.toFixed(1)}) / (${P1_kPaa.toFixed(1)} × ${Kd} × ${Kb.toFixed(3)} × ${Kc} × ${Kn.toFixed(4)} × ${Ksh.toFixed(4)})`,
          result: `A_req = ${reqAreaMm2.toFixed(1)} mm² (${reqAreaIn2.toFixed(4)} in²)`
        }
      ];
    }

    // -----------------------------------------------------------------------
    // CASE 4: TWO-PHASE / FLASHING LIQUID (API 520 Part I Annex C — Leung Omega Method)
    // -----------------------------------------------------------------------
    else {
      Kd = 0.85;
      Kb = autoKb ? computeBackpressureFactor(valveType, P_backBarg / P_setBarg, overpressurePct, 'gas') : Number(manualKb);
      const omega = Math.max(0.05, Number(omegaParam));
      const rho0 = Math.max(50, Number(rhoLiqKgM3));
      const v0 = 1.0 / rho0;

      const eta_c = Math.max(
        0.35,
        Math.min(
          0.95,
          Math.pow(
            1.0 + (1.0446 - 0.0093431 * Math.sqrt(omega)) * Math.pow(omega, -0.56261),
            -0.70356 + 0.014685 * Math.log(omega)
          )
        )
      );
      Pcf_bara = P1_bara * eta_c;
      Pcf_psia = P1_psia * eta_c;

      const eta_a = P2_bara / P1_bara;
      const isChoked = eta_a <= eta_c;
      const eta = isChoked ? eta_c : Math.min(0.99, eta_a);
      flowRegime = isChoked ? `TWO-PHASE CHOKED FLASHING (ω = ${omega.toFixed(2)})` : `TWO-PHASE SUBCRITICAL (ω = ${omega.toFixed(2)})`;

      const numTerm = Math.max(1e-5, -2.0 * (omega * Math.log(eta) + (omega - 1.0) * (1.0 - eta)));
      const denTerm = omega * (1.0 / eta - 1.0) + 1.0;
      const G_star = Math.sqrt(numTerm) / denTerm;

      const P1_Pa = P1_bara * 1e5;
      const G_kg_s_m2 = G_star * Math.sqrt(P1_Pa / v0);

      reqAreaMm2 = (W_kgHr * 1000.0) / (3.6 * Kd * Kb * Kc * G_kg_s_m2);
      reqAreaIn2 = Units.mm2ToIn2(reqAreaMm2);

      steps = [
        {
          title: '1. Leung Omega Parameter (ω) & Critical Pressure Ratio (η_c)',
          formula: 'η_c = f(ω) per API 520 Part I Annex C   |   P_cf = η_c × P₁',
          substitution: `ω = ${omega.toFixed(3)} → η_c = ${eta_c.toFixed(4)}, P₁ = ${P1_bara.toFixed(3)} bara`,
          result: `P_cf = ${Pcf_bara.toFixed(3)} bara (${isChoked ? 'Choked Two-Phase Flow' : 'Subcritical Two-Phase Flow'})`
        },
        {
          title: '2. Dimensionless & Physical Mass Flux (G*, G)',
          formula: 'G* = √{ -2·[ω·ln(η) + (ω - 1)·(1 - η)] } / [ ω·(1/η - 1) + 1 ]   |   G = G* × √(P₁ × ρ₀)',
          substitution: `G* = ${G_star.toFixed(4)} at η = ${eta.toFixed(4)}, ρ₀ = ${rho0.toFixed(1)} kg/m³`,
          result: `G = ${G_kg_s_m2.toFixed(1)} kg/(s·m²)`
        },
        {
          title: '3. Required Two-Phase Orifice Area A (API 520 Annex C)',
          formula: 'A (mm²) = (W × 1000) / (3.6 × Kd × Kb × Kc × G)',
          substitution: `A = (${W_kgHr.toFixed(1)} × 1000) / (3.6 × ${Kd} × ${Kb.toFixed(3)} × ${Kc} × ${G_kg_s_m2.toFixed(1)})`,
          result: `A_req = ${reqAreaMm2.toFixed(1)} mm² (${reqAreaIn2.toFixed(4)} in²)`
        }
      ];
    }

    const selectedOrifice = selectApi526Orifice(reqAreaMm2);
    const areaRatio = reqAreaMm2 > 0 ? selectedOrifice.areaMm2 / reqAreaMm2 : 1.0;
    ratedCapacityKgHr = W_kgHr * areaRatio;

    return {
      fluidPhase,
      W_kgHr,
      W_lbHr,
      P_setBarg,
      P_setPsig,
      overpressurePct: Number(overpressurePct),
      P1_barg,
      P1_bara,
      P1_kPaa,
      P1_psia,
      P_backBarg,
      P2_bara,
      P2_kPaa,
      P2_psia,
      backpressurePctOfSet,
      absBackpressureRatio,
      T1_C,
      T1_K,
      T1_F,
      T1_R,
      Kd,
      Kb,
      Kc,
      Kv,
      Ksh,
      Kn,
      C_SI,
      C_USC,
      F2,
      Pcf_bara,
      Pcf_psia,
      flowRegime,
      reqAreaMm2,
      reqAreaIn2,
      selectedOrifice,
      ratedCapacityKgHr,
      ratedCapacityLbHr: Units.kgHrToLbHr(ratedCapacityKgHr),
      steps,
      warnings
    };
  }

  // =========================================================================
  // 5. API 520 PART II INLET & OUTLET LINE SIZING ENGINE
  // =========================================================================

  function calcDarcyFrictionFactor(Re, relRoughness) {
    const re = Math.max(10, Number(Re));
    const epsD = Math.max(1e-7, Number(relRoughness));
    if (re < 2100) {
      return 64.0 / re;
    }
    const A = Math.pow(
      2.457 * Math.log(1.0 / (Math.pow(7.0 / re, 0.9) + 0.27 * epsD)),
      16.0
    );
    const B = Math.pow(37530.0 / re, 16.0);
    const f = 8.0 * Math.pow(Math.pow(8.0 / re, 12.0) + 1.0 / Math.pow(A + B, 1.5), 1.0 / 12.0);
    return f;
  }

  function computeSinglePipeHydraulics({
    flowKgHr,
    idMm,
    lengthM,
    roughnessMm,
    sumK,
    elevChangeM = 0,
    rhoKgM3,
    viscCp,
    isGas,
    mw = 20.5,
    k = 1.27,
    z = 0.91,
    tempK = 338.15
  }) {
    const D_m = Math.max(0.005, Number(idMm) / 1000.0);
    const areaPipeM2 = (Math.PI / 4.0) * D_m * D_m;
    const W_kgS = Math.max(1e-5, Number(flowKgHr) / 3600.0);
    const rho = Math.max(0.1, Number(rhoKgM3));
    const muPaS = Math.max(1e-6, Number(viscCp) * 1e-3);

    const velocityMS = W_kgS / (rho * areaPipeM2);
    const Re = (rho * velocityMS * D_m) / muPaS;
    const relRoughness = (Number(roughnessMm) / 1000.0) / D_m;
    const fDarcy = calcDarcyFrictionFactor(Re, relRoughness);

    const K_pipe = fDarcy * (Math.max(0, Number(lengthM)) / D_m);
    const K_total = K_pipe + Math.max(0, Number(sumK));

    const dP_fricPa = K_total * 0.5 * rho * velocityMS * velocityMS;
    const dP_elevPa = !isGas ? rho * 9.80665 * Number(elevChangeM) : 0;
    const dP_totalBar = Math.max(0, (dP_fricPa + dP_elevPa) / 1e5);

    let sonicVelMS = 1400.0;
    if (isGas) {
      const R_spec = 8314.46 / Math.max(2, Number(mw));
      sonicVelMS = Math.sqrt(Math.max(1.01, Number(k)) * Math.max(0.1, Number(z)) * R_spec * tempK);
    }
    const machNumber = velocityMS / sonicVelMS;

    return {
      idMm: Number(idMm),
      areaPipeM2,
      velocityMS,
      velocityFtS: Units.mToFt(velocityMS),
      Re,
      fDarcy,
      K_pipe,
      K_fittings: Number(sumK),
      K_total,
      dP_fricBar: dP_fricPa / 1e5,
      dP_elevBar: dP_elevPa / 1e5,
      dP_totalBar,
      dP_totalPsi: Units.barToPsi(dP_totalBar),
      sonicVelMS,
      machNumber
    };
  }

  function calcLineHydraulicsApi520Part2(sizingResult, lineParams) {
    const {
      flowBasis = 'rated',
      roughnessMm = 0.0457,
      inletNps = '3"',
      inletSch = 'Sch 40 (Std)',
      inletLengthM = 2.5,
      inletElevM = 0.5,
      inletFittingsK = 1.15,
      outletNps = '4"',
      outletSch = 'Sch 40 (Std)',
      outletLengthM = 18.0,
      outletFittingsK = 2.40,
      superimposedBackBarg = 1.2,
      valveType = 'conventional',
      mw = 20.5,
      k = 1.27,
      z = 0.91,
      rhoLiqKgM3 = 820.0,
      viscCp = 0.015
    } = lineParams;

    const W_evalKgHr = flowBasis === 'rated' ? sizingResult.ratedCapacityKgHr : sizingResult.W_kgHr;
    const phase = sizingResult.fluidPhase;
    // Gas & steam are treated as compressible single-phase vapor. Two-phase uses the
    // user-supplied homogeneous mixture density (rhoLiqKgM3) and is treated as incompressible.
    const isGas = phase === 'gas' || phase === 'steam';
    const T1_K = sizingResult.T1_K;
    const P_atmBara = sizingResult.P1_bara - sizingResult.P1_barg;
    const R_UNIV = 8314.46;
    const Zg = Math.max(0.1, Number(z));
    const Kg = Math.max(1.01, Number(k));
    const Mg = Math.max(2, Number(mw));
    const gasDensity = (pBara) => (pBara * 1e5 * Mg) / (Zg * R_UNIV * T1_K);

    let rhoInletKgM3 = Number(rhoLiqKgM3);
    if (isGas) {
      rhoInletKgM3 = gasDensity(sizingResult.P1_bara);
    }

    const inletPipeObj = PIPE_SCHEDULES.find(p => p.nps === inletNps) || PIPE_SCHEDULES[3];
    const inletIdMm = inletPipeObj.idMm[inletSch] || inletPipeObj.idMm['Sch 40 (Std)'];

    const inletHyd = computeSinglePipeHydraulics({
      flowKgHr: W_evalKgHr,
      idMm: inletIdMm,
      lengthM: inletLengthM,
      roughnessMm,
      sumK: inletFittingsK,
      elevChangeM: inletElevM,
      rhoKgM3: rhoInletKgM3,
      viscCp,
      isGas,
      mw,
      k,
      z,
      tempK: T1_K
    });

    const inletLossPctOfSet = (inletHyd.dP_totalBar / sizingResult.P_setBarg) * 100.0;
    const inletPasses3Pct = inletLossPctOfSet <= 3.0;

    const inletNpsComparison = PIPE_SCHEDULES.map(pipe => {
      const id = pipe.idMm[inletSch] || pipe.idMm['Sch 40 (Std)'];
      const h = computeSinglePipeHydraulics({
        flowKgHr: W_evalKgHr,
        idMm: id,
        lengthM: inletLengthM,
        roughnessMm,
        sumK: inletFittingsK,
        elevChangeM: inletElevM,
        rhoKgM3: rhoInletKgM3,
        viscCp,
        isGas,
        mw,
        k,
        z,
        tempK: T1_K
      });
      const pct = (h.dP_totalBar / sizingResult.P_setBarg) * 100.0;
      return {
        nps: pipe.nps,
        idMm: id,
        velocityMS: h.velocityMS,
        dPBar: h.dP_totalBar,
        lossPct: pct,
        passes: pct <= 3.0
      };
    });

    const recommendedInletPipe = inletNpsComparison.find(p => p.passes) || inletNpsComparison[inletNpsComparison.length - 1];

    const outletPipeObj = PIPE_SCHEDULES.find(p => p.nps === outletNps) || PIPE_SCHEDULES[4];
    const outletIdMm = outletPipeObj.idMm[outletSch] || outletPipeObj.idMm['Sch 40 (Std)'];

    // Outlet: for vapor, iterate density at the mean tailpipe pressure (P_super + ΔP/2), isothermal at T1.
    const P_superBara = Math.max(0, Number(superimposedBackBarg)) + P_atmBara;
    let rhoOutletKgM3 = isGas ? gasDensity(P_superBara) : Number(rhoLiqKgM3);
    const runOutlet = () => computeSinglePipeHydraulics({
      flowKgHr: W_evalKgHr,
      idMm: outletIdMm,
      lengthM: outletLengthM,
      roughnessMm,
      sumK: outletFittingsK,
      elevChangeM: 0,
      rhoKgM3: rhoOutletKgM3,
      viscCp,
      isGas,
      mw,
      k,
      z,
      tempK: T1_K
    });
    let outletHyd = runOutlet();
    if (isGas) {
      for (let iter = 0; iter < 30; iter++) {
        const next = gasDensity(P_superBara + outletHyd.dP_totalBar / 2);
        const converged = Math.abs(next - rhoOutletKgM3) / rhoOutletKgM3 < 1e-5;
        rhoOutletKgM3 = next;
        outletHyd = runOutlet();
        if (converged) break;
      }
    }

    const builtUpBackBarg = outletHyd.dP_totalBar;
    const totalBackBarg = Number(superimposedBackBarg) + builtUpBackBarg;
    const totalBackPctOfSet = (totalBackBarg / sizingResult.P_setBarg) * 100.0;

    const maxAllowedBackPct = valveType === 'conventional'
      ? sizingResult.overpressurePct
      : (valveType === 'bellows' ? 50.0 : 70.0);

    const outletPassesBackpressure = totalBackPctOfSet <= maxAllowedBackPct;

    // Exit Mach at the downstream (header) end, where pressure — and density — is lowest.
    const W_kgS = W_evalKgHr / 3600.0;
    const A_out = outletHyd.areaPipeM2;
    let exitMach = 0;
    let exitVelocityMS = outletHyd.velocityMS;
    if (isGas) {
      exitVelocityMS = W_kgS / (gasDensity(P_superBara) * A_out);
      exitMach = exitVelocityMS / outletHyd.sonicVelMS;
    }
    const outletPassesMach = !isGas || exitMach <= 0.70;
    const compressibleWarning = isGas && builtUpBackBarg > 0.4 * P_superBara
      ? 'Outlet ΔP exceeds 40 % of downstream absolute pressure — verify with a compressible (isothermal/adiabatic) flow model.'
      : '';

    // API 520 Part II §4.4 reaction force, OPEN discharge to atmosphere basis:
    //   F = W·v_exit + A_exit·(P_exit − P_atm); for vapor the exit is sonic when choked.
    // Closed discharge into a flare header does not produce this steady-state thrust at the tailpipe.
    let reactionForceN = 0;
    let exitPressureBara = P_atmBara;
    if (isGas) {
      const Tstar = (2 * T1_K) / (Kg + 1);
      const vSonicExit = Math.sqrt(Kg * Zg * R_UNIV * Tstar / Mg);
      const pStarPa = (W_kgS / (A_out * vSonicExit)) * Zg * R_UNIV * Tstar / Mg;
      if (pStarPa > P_atmBara * 1e5) {
        exitPressureBara = pStarPa / 1e5;
        reactionForceN = W_kgS * vSonicExit + A_out * (pStarPa - P_atmBara * 1e5);
      } else {
        const vAtm = W_kgS / (gasDensity(P_atmBara) * A_out);
        reactionForceN = W_kgS * vAtm;
      }
    } else {
      const vLiq = W_kgS / (Math.max(1, Number(rhoLiqKgM3)) * A_out);
      reactionForceN = W_kgS * vLiq;
    }
    const reactionForceLbf = reactionForceN * 0.22480894;

    return {
      flowBasis,
      W_evalKgHr,
      W_evalLbHr: Units.kgHrToLbHr(W_evalKgHr),
      rhoInletKgM3,
      rhoOutletKgM3,
      inlet: {
        nps: inletNps,
        schedule: inletSch,
        lengthM: Number(inletLengthM),
        ...inletHyd,
        lossPctOfSet: inletLossPctOfSet,
        passes3Pct: inletPasses3Pct,
        recommendedNps: recommendedInletPipe.nps
      },
      inletNpsComparison,
      outlet: {
        nps: outletNps,
        schedule: outletSch,
        lengthM: Number(outletLengthM),
        ...outletHyd,
        superimposedBackBarg: Number(superimposedBackBarg),
        builtUpBackBarg,
        totalBackBarg,
        totalBackPctOfSet,
        maxAllowedBackPct,
        passesBackpressure: outletPassesBackpressure,
        passesMach: outletPassesMach,
        machNumber: exitMach,
        exitVelocityMS,
        exitPressureBara,
        compressibleWarning,
        reactionForceN,
        reactionForceKn: reactionForceN / 1000.0,
        reactionForceLbf
      }
    };
  }

  // =========================================================================
  // 6. SAMPLE EPC PROJECT TAG PRESETS (INSPIRED BY PROCESS ENGINEER RESUME)
  // =========================================================================

  const EPC_TAG_PRESETS = [
    {
      id: 'PSV-1001A',
      tagNumber: 'PSV-1001A',
      service: 'AGRU Acid Gas Absorber Overhead',
      equipmentProtected: 'C-1001 (Amine Contactor Column)',
      projectTitle: 'Fadhili Gas Plant — Acid Gas Removal Unit (AGRU)',
      clientName: 'Saudi Aramco / Samsung E&A',
      pidNumber: 'FGP-AGRU-PID-1014 Rev.2',
      governingScenarioKey: 'blocked_outlet',
      fluidPresetKey: 'acidGasAGRU',
      fluidPhase: 'gas',
      flowRateKgHr: 28450,
      setPressureBarg: 22.5,
      mawpBarg: 22.5,
      operatingPressureBarg: 19.8,
      overpressurePct: 10.0,
      superimposedBackBarg: 1.4,
      builtUpBackBarg: 0.55,
      atmPressureBara: 1.01325,
      relievingTempC: 68.0,
      valveType: 'bellows',
      ruptureDiscUpstream: false,
      mw: 38.5,
      k: 1.29,
      z: 0.88,
      rhoLiqKgM3: 780.0,
      viscCp: 0.015,
      steamSuperheatC: 0,
      omegaParam: 0.65,
      inletNps: '4"',
      inletSch: 'Sch 40 (Std)',
      inletLengthM: 2.2,
      inletElevM: 0.4,
      inletFittingsK: 0.95,
      outletNps: '6"',
      outletSch: 'Sch 40 (Std)',
      outletLengthM: 16.5,
      outletFittingsK: 2.10,
      scenarios: {
        fireLiquid: { orientation: 'vertical', headType: 'ellipsoidal', diameterM: 2.8, lengthM: 14.0, nllM: 3.5, elevAboveGradeM: 3.2, drainageAdequate: true, envFactorF: 0.30, latentHeatKjKg: 390 },
        fireGas: { exposedAreaM2: 68.0, normalGasTempC: 68.0, maxWallTempC: 593.0, envFactorF: 1.0 },
        blockedOutlet: { sourceType: 'upstream_header', maxInflowKgHr: 28450, creditedOutflowKgHr: 0, safetyMarginFactor: 1.0 },
        cvFailure: { fluidPhase: 'gas', ratedCv: 42.0, bypassCv: 0, upstreamPressBarg: 48.0, normalFlowCreditKgHr: 8000 },
        thermalExpansion: { heatInputKw: 180.0, alphaVPerC: 0.0005, cpLiqKjKgK: 3.75 },
        tubeRupture: { hpFluidPhase: 'gas', tubeIdMm: 15.7, hpPressureBarg: 55.0 }
      }
    },
    {
      id: 'PSV-2004',
      tagNumber: 'PSV-2004',
      service: 'PP Splitter Reflux Drum Fire Relief',
      equipmentProtected: 'V-2004 (Propylene Reflux Drum)',
      projectTitle: 'Alujain PP Feed & Petrochemical Project',
      clientName: 'Alujain National Industrial Co. (LNIC)',
      pidNumber: 'ALJ-PP-PID-2042 Rev.4',
      governingScenarioKey: 'fire_liquid',
      fluidPresetKey: 'propylene',
      fluidPhase: 'gas',
      flowRateKgHr: 18787,
      setPressureBarg: 18.5,
      mawpBarg: 18.5,
      operatingPressureBarg: 15.6,
      overpressurePct: 21.0,
      superimposedBackBarg: 0.9,
      builtUpBackBarg: 0.45,
      atmPressureBara: 1.01325,
      relievingTempC: 52.0,
      valveType: 'conventional',
      ruptureDiscUpstream: false,
      mw: 42.08,
      k: 1.15,
      z: 0.82,
      rhoLiqKgM3: 514.0,
      viscCp: 0.011,
      steamSuperheatC: 0,
      omegaParam: 0.65,
      inletNps: '4"',
      inletSch: 'Sch 40 (Std)',
      inletLengthM: 1.8,
      inletElevM: 0.3,
      inletFittingsK: 0.80,
      outletNps: '6"',
      outletSch: 'Sch 40 (Std)',
      outletLengthM: 14.0,
      outletFittingsK: 1.90,
      scenarios: {
        fireLiquid: { orientation: 'horizontal', headType: 'ellipsoidal', diameterM: 3.2, lengthM: 12.5, nllM: 2.3, elevAboveGradeM: 2.0, drainageAdequate: true, envFactorF: 1.0, latentHeatKjKg: 338 },
        fireGas: { exposedAreaM2: 42.0, normalGasTempC: 52.0, maxWallTempC: 593.0, envFactorF: 1.0 },
        blockedOutlet: { sourceType: 'pump_compressor', maxInflowKgHr: 14200, creditedOutflowKgHr: 0, safetyMarginFactor: 1.0 },
        cvFailure: { fluidPhase: 'gas', ratedCv: 30.0, bypassCv: 0, upstreamPressBarg: 28.0, normalFlowCreditKgHr: 5200 },
        thermalExpansion: { heatInputKw: 220.0, alphaVPerC: 0.0021, cpLiqKjKgK: 2.45 },
        tubeRupture: { hpFluidPhase: 'liquid', tubeIdMm: 12.5, hpPressureBarg: 26.0 }
      }
    },
    {
      id: 'PSV-3102',
      tagNumber: 'PSV-3102',
      service: 'Lean Amine Booster Pump Discharge',
      equipmentProtected: 'P-3102A/B Discharge Header',
      projectTitle: 'Ras Laffan Petrochemical Project (RLP2)',
      clientName: 'Chevron Phillips Chemical | Qatar',
      pidNumber: 'RLP2-UTL-PID-3108 Rev.1',
      governingScenarioKey: 'blocked_outlet',
      fluidPresetKey: 'leanAmine',
      fluidPhase: 'liquid',
      flowRateKgHr: 42500,
      setPressureBarg: 14.0,
      mawpBarg: 14.0,
      operatingPressureBarg: 11.2,
      overpressurePct: 10.0,
      superimposedBackBarg: 1.5,
      builtUpBackBarg: 0.35,
      atmPressureBara: 1.01325,
      relievingTempC: 55.0,
      valveType: 'bellows',
      ruptureDiscUpstream: false,
      mw: 32.0,
      k: 1.32,
      z: 0.95,
      rhoLiqKgM3: 1035.0,
      viscCp: 2.85,
      steamSuperheatC: 0,
      omegaParam: 0.65,
      inletNps: '3"',
      inletSch: 'Sch 40 (Std)',
      inletLengthM: 1.5,
      inletElevM: 0.2,
      inletFittingsK: 0.95,
      outletNps: '4"',
      outletSch: 'Sch 40 (Std)',
      outletLengthM: 12.0,
      outletFittingsK: 1.80,
      scenarios: {
        fireLiquid: { orientation: 'horizontal', headType: 'ellipsoidal', diameterM: 1.8, lengthM: 5.0, nllM: 1.2, elevAboveGradeM: 1.5, drainageAdequate: true, envFactorF: 1.0, latentHeatKjKg: 2150 },
        fireGas: { exposedAreaM2: 20.0, normalGasTempC: 55.0, maxWallTempC: 593.0, envFactorF: 1.0 },
        blockedOutlet: { sourceType: 'pump_compressor', maxInflowKgHr: 42500, creditedOutflowKgHr: 0, safetyMarginFactor: 1.0 },
        cvFailure: { fluidPhase: 'liquid', ratedCv: 35.0, bypassCv: 0, upstreamPressBarg: 22.0, normalFlowCreditKgHr: 12000 },
        thermalExpansion: { heatInputKw: 410.0, alphaVPerC: 0.00045, cpLiqKjKgK: 3.75 },
        tubeRupture: { hpFluidPhase: 'liquid', tubeIdMm: 12.5, hpPressureBarg: 24.0 }
      }
    },
    {
      id: 'PSV-4005',
      tagNumber: 'PSV-4005',
      service: 'MP Steam Header Overpressure Relief',
      equipmentProtected: 'MS-4005 Steam Letdown Header',
      projectTitle: 'Ras Laffan Utilities & Offsites (RLPP)',
      clientName: 'Chevron Phillips Chemical | Qatar',
      pidNumber: 'RLPP-STM-PID-4005 Rev.3',
      governingScenarioKey: 'cv_failure',
      fluidPresetKey: 'hpSteam',
      fluidPhase: 'steam',
      flowRateKgHr: 29800,
      setPressureBarg: 16.0,
      mawpBarg: 16.0,
      operatingPressureBarg: 13.8,
      overpressurePct: 10.0,
      superimposedBackBarg: 0.0,
      builtUpBackBarg: 0.35,
      atmPressureBara: 1.01325,
      relievingTempC: 245.0,
      valveType: 'conventional',
      ruptureDiscUpstream: false,
      mw: 18.02,
      k: 1.30,
      z: 0.94,
      rhoLiqKgM3: 958.0,
      viscCp: 0.022,
      steamSuperheatC: 41.0,
      omegaParam: 0.65,
      inletNps: '6"',
      inletSch: 'Sch 40 (Std)',
      inletLengthM: 1.6,
      inletElevM: 0.3,
      inletFittingsK: 0.75,
      outletNps: '10"',
      outletSch: 'Sch 40 (Std)',
      outletLengthM: 9.5,
      outletFittingsK: 1.20,
      scenarios: {
        fireLiquid: { orientation: 'horizontal', headType: 'ellipsoidal', diameterM: 1.5, lengthM: 4.5, nllM: 0.8, elevAboveGradeM: 2.0, drainageAdequate: true, envFactorF: 0.3, latentHeatKjKg: 1940 },
        fireGas: { exposedAreaM2: 24.0, normalGasTempC: 245.0, maxWallTempC: 593.0, envFactorF: 1.0 },
        blockedOutlet: { sourceType: 'upstream_header', maxInflowKgHr: 22000, creditedOutflowKgHr: 0, safetyMarginFactor: 1.0 },
        cvFailure: { fluidPhase: 'gas', ratedCv: 92.0, bypassCv: 15.0, upstreamPressBarg: 42.0, normalFlowCreditKgHr: 6400 },
        thermalExpansion: { heatInputKw: 150.0, alphaVPerC: 0.0005, cpLiqKjKgK: 4.22 },
        tubeRupture: { hpFluidPhase: 'gas', tubeIdMm: 19.0, hpPressureBarg: 42.0 }
      }
    },
    {
      id: 'PSV-5010',
      tagNumber: 'PSV-5010',
      service: 'Feed/Effluent Exchanger Cold Side Shell',
      equipmentProtected: 'E-5010 Shell Side (Tube Rupture / 2-Phase)',
      projectTitle: 'Fadhili Gas Plant — Condensate Stabilization',
      clientName: 'Saudi Aramco / Samsung E&A',
      pidNumber: 'FGP-CND-PID-5010 Rev.0',
      governingScenarioKey: 'tube_rupture',
      fluidPresetKey: 'flashingCondensate',
      fluidPhase: 'twophase',
      flowRateKgHr: 36800,
      setPressureBarg: 15.0,
      mawpBarg: 15.0,
      operatingPressureBarg: 12.0,
      overpressurePct: 10.0,
      superimposedBackBarg: 1.1,
      builtUpBackBarg: 0.40,
      atmPressureBara: 1.01325,
      relievingTempC: 82.0,
      valveType: 'bellows',
      ruptureDiscUpstream: true,
      mw: 58.12,
      k: 1.12,
      z: 0.84,
      rhoLiqKgM3: 580.0,
      viscCp: 0.18,
      steamSuperheatC: 0,
      omegaParam: 0.72,
      inletNps: '6"',
      inletSch: 'Sch 40 (Std)',
      inletLengthM: 1.9,
      inletElevM: 0.2,
      inletFittingsK: 1.45,
      outletNps: '8"',
      outletSch: 'Sch 40 (Std)',
      outletLengthM: 15.0,
      outletFittingsK: 1.80,
      scenarios: {
        fireLiquid: { orientation: 'horizontal', headType: 'ellipsoidal', diameterM: 1.4, lengthM: 6.0, nllM: 1.1, elevAboveGradeM: 1.8, drainageAdequate: true, envFactorF: 0.5, latentHeatKjKg: 320 },
        fireGas: { exposedAreaM2: 26.0, normalGasTempC: 82.0, maxWallTempC: 593.0, envFactorF: 1.0 },
        blockedOutlet: { sourceType: 'pump_compressor', maxInflowKgHr: 22000, creditedOutflowKgHr: 0, safetyMarginFactor: 1.0 },
        cvFailure: { fluidPhase: 'liquid', ratedCv: 38.0, bypassCv: 0, upstreamPressBarg: 35.0, normalFlowCreditKgHr: 8000 },
        thermalExpansion: { heatInputKw: 520.0, alphaVPerC: 0.0015, cpLiqKjKgK: 2.40 },
        tubeRupture: { hpFluidPhase: 'liquid', tubeIdMm: 12.6, hpPressureBarg: 48.0 }
      }
    }
  ];

  return {
    API_526_ORIFICES,
    PIPE_SCHEDULES,
    FITTING_K_FACTORS,
    FLUID_PRESETS,
    EPC_TAG_PRESETS,
    Units,
    calcFireLiquidVessel,
    calcFireGasVessel,
    calcBlockedOutlet,
    calcControlValveFailure,
    calcThermalExpansion,
    calcTubeRupture,
    sizeOrificeApi520,
    calcLineHydraulicsApi520Part2,
    selectApi526Orifice
  };
})();

// Expose globally for the browser (top-level const is not a window property) and for Node tests
if (typeof window !== 'undefined') {
  window.PSVEngine = PSVEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PSVEngine;
}
