/**
 * PSVCalc Pro — Control Valve Sizing & Selection Workbench
 * Standards & Baseline References:
 *   - IEC 60534-2-1:2011 (= ANSI/ISA-75.01.01) — Liquid, Gas/Vapour & Steam Flow Sizing
 *   - IEC 60534-8-3 (Aerodynamic) & IEC 60534-8-4 (Hydrodynamic) — Acoustic Noise & Cavitation Screening
 *   - ASME B36.10M / B36.19M — Upstream (D1) & Downstream (D2) Pipe Schedules & Wall Thickness
 *   - ASME B16.34 — Pressure-Temperature Class Rating (150–2500) & Body Material Screening
 *   - ANSI/FCI 70-2 (ANSI B16.104) — Seat Leakage Classes II–VI
 *   - ISA-20 / IEC 60534-2-4 & CED M04-034 — Installed Characteristic, Segmental Gain, Actuator, Positioner & P&ID Station
 *
 * Pure calc in canonical SI (kg/h, barg/bara, °C, mm, kg/m³, cP). Internally the IEC equations are
 * evaluated with the "Cv" column of IEC 60534-2-1 Table 1 (numerical constants) in bar units;
 * Kv = Cv / 1.156 (IEC 60534-1).
 */
(function () {
  // ---------------------------------------------------------------- constants
  const N = {
    N1: 0.865,    // Q m³/h, p bar            (Kv: 1)
    N2: 2.14e-3,  // d mm                     (Kv: 1.60e-3)
    N4: 7.60e-2,  // Q m³/h, ν m²/s           (Kv: 7.07e-2)
    N5: 2.41e-3,  // d mm                     (Kv: 1.80e-3)
    N6: 27.3,     // W kg/h, p bar, ρ kg/m³   (Kv: 31.6)
    N8: 94.8      // W kg/h, p bar, T K       (Kv: 110)
  };
  const KV_PER_CV = 1 / 1.156;
  const RHO0 = 999.1;               // water at 15 °C (kg/m³)
  const RU = 8314.462;              // J/(kmol·K)
  const RHO_STEEL = 7800;           // kg/m³ steel pipe wall
  const C_STEEL = 5000;             // m/s longitudinal wave speed in steel
  const Z0_AIR = 415;               // Pa·s/m ambient air acoustic impedance
  const M3HR_TO_GPM = 4.4028675;    // 1 m³/h = 4.4028675 US GPM
  const NM3_PER_KMOL = 22.41397;    // Normal m³/kmol at 0 °C, 1.01325 bara
  const SCF_PER_LBMOL = 379.482;    // Standard ft³/lbmol at 60 °F, 14.696 psia
  const BAR_PSI = 14.5037738, KG_LB = 2.20462262, KGM3_LBFT3 = 0.06242796;

  // ASME B36.10M / B36.19M exact pipe table (0.5" through 24")
  const PIPE_SCHEDULE_KEYS = ['Sch 10S', 'STD', 'Sch 40', 'XS', 'Sch 80', 'Sch 160'];
  const PIPE_SCHEDULES = [
    ['0.5"', 15,  0.840, { 'Sch 10S': 0.083, 'STD': 0.109, 'Sch 40': 0.109, 'XS': 0.147, 'Sch 80': 0.147, 'Sch 160': 0.188 }],
    ['0.75"',20,  1.050, { 'Sch 10S': 0.083, 'STD': 0.113, 'Sch 40': 0.113, 'XS': 0.154, 'Sch 80': 0.154, 'Sch 160': 0.219 }],
    ['1"',   25,  1.315, { 'Sch 10S': 0.109, 'STD': 0.133, 'Sch 40': 0.133, 'XS': 0.179, 'Sch 80': 0.179, 'Sch 160': 0.250 }],
    ['1.25"',32,  1.660, { 'Sch 10S': 0.109, 'STD': 0.140, 'Sch 40': 0.140, 'XS': 0.191, 'Sch 80': 0.191, 'Sch 160': 0.250 }],
    ['1.5"', 40,  1.900, { 'Sch 10S': 0.109, 'STD': 0.145, 'Sch 40': 0.145, 'XS': 0.200, 'Sch 80': 0.200, 'Sch 160': 0.281 }],
    ['2"',   50,  2.375, { 'Sch 10S': 0.109, 'STD': 0.154, 'Sch 40': 0.154, 'XS': 0.218, 'Sch 80': 0.218, 'Sch 160': 0.344 }],
    ['2.5"', 65,  2.875, { 'Sch 10S': 0.120, 'STD': 0.203, 'Sch 40': 0.203, 'XS': 0.276, 'Sch 80': 0.276, 'Sch 160': 0.375 }],
    ['3"',   80,  3.500, { 'Sch 10S': 0.120, 'STD': 0.216, 'Sch 40': 0.216, 'XS': 0.300, 'Sch 80': 0.300, 'Sch 160': 0.438 }],
    ['4"',   100, 4.500, { 'Sch 10S': 0.120, 'STD': 0.237, 'Sch 40': 0.237, 'XS': 0.337, 'Sch 80': 0.337, 'Sch 160': 0.531 }],
    ['5"',   125, 5.563, { 'Sch 10S': 0.134, 'STD': 0.258, 'Sch 40': 0.258, 'XS': 0.375, 'Sch 80': 0.375, 'Sch 160': 0.625 }],
    ['6"',   150, 6.625, { 'Sch 10S': 0.134, 'STD': 0.280, 'Sch 40': 0.280, 'XS': 0.432, 'Sch 80': 0.432, 'Sch 160': 0.719 }],
    ['8"',   200, 8.625, { 'Sch 10S': 0.148, 'STD': 0.322, 'Sch 40': 0.322, 'XS': 0.500, 'Sch 80': 0.500, 'Sch 160': 0.906 }],
    ['10"',  250, 10.750,{ 'Sch 10S': 0.165, 'STD': 0.365, 'Sch 40': 0.365, 'XS': 0.500, 'Sch 80': 0.594, 'Sch 160': 1.125 }],
    ['12"',  300, 12.750,{ 'Sch 10S': 0.180, 'STD': 0.375, 'Sch 40': 0.406, 'XS': 0.500, 'Sch 80': 0.688, 'Sch 160': 1.312 }],
    ['14"',  350, 14.000,{ 'Sch 10S': 0.188, 'STD': 0.375, 'Sch 40': 0.438, 'XS': 0.500, 'Sch 80': 0.750, 'Sch 160': 1.406 }],
    ['16"',  400, 16.000,{ 'Sch 10S': 0.188, 'STD': 0.375, 'Sch 40': 0.500, 'XS': 0.500, 'Sch 80': 0.844, 'Sch 160': 1.594 }],
    ['18"',  450, 18.000,{ 'Sch 10S': 0.188, 'STD': 0.375, 'Sch 40': 0.562, 'XS': 0.500, 'Sch 80': 0.938, 'Sch 160': 1.781 }],
    ['20"',  500, 20.000,{ 'Sch 10S': 0.218, 'STD': 0.375, 'Sch 40': 0.594, 'XS': 0.500, 'Sch 80': 1.031, 'Sch 160': 1.969 }],
    ['24"',  600, 24.000,{ 'Sch 10S': 0.250, 'STD': 0.375, 'Sch 40': 0.688, 'XS': 0.500, 'Sch 80': 1.219, 'Sch 160': 2.344 }]
  ].map(([nps, dn, odIn, wallIn]) => {
    const r2 = v => Math.round(v * 100) / 100;
    const odMm = r2(odIn * 25.4), wallMm = {}, idMm = {};
    for (const sch of PIPE_SCHEDULE_KEYS) {
      wallMm[sch] = r2(wallIn[sch] * 25.4);
      idMm[sch] = r2((odIn - 2 * wallIn[sch]) * 25.4);
    }
    return { nps, dn, odIn, odMm, wallMm, idMm };
  });

  function lookupPipe(nps, schedule) {
    const p = PIPE_SCHEDULES.find(x => x.nps === nps) || PIPE_SCHEDULES.find(x => x.nps === '4"');
    const sch = PIPE_SCHEDULE_KEYS.includes(schedule) ? schedule : 'Sch 40';
    return { nps: p.nps, dn: p.dn, schedule: sch, idMm: p.idMm[sch], wallMm: p.wallMm[sch], odMm: p.odMm };
  }

  function estimateWallFromId(idMm) {
    let best = PIPE_SCHEDULES.find(x => x.nps === '4"'), bestErr = Infinity;
    for (const p of PIPE_SCHEDULES) {
      const err = Math.abs(p.idMm['Sch 40'] - idMm);
      if (err < bestErr) { bestErr = err; best = p; }
    }
    return best.wallMm['Sch 40'];
  }

  // Full 14 standard sizes (0.5"–12", matching CED M04-034 p. 46 chart + industrial NPS up to 12")
  const SIZES_IN = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12];
  const SIZES_MM = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300];
  const VALVES = {
    'globe-lin': { label: 'Globe, contoured plug, linear (flow-to-open)', char: 'lin', R: 30, FL: 0.90, xT: 0.72, Fd: 0.46, noiseTrimBonusDb: 0, maxLeak: 'V', slurryOk: false,
      cv: [4.5, 7.5, 12, 19, 28, 50, 75, 110, 195, 285, 400, 640, 1000, 1440] },
    'globe-eqp': { label: 'Globe, contoured plug, equal-% (flow-to-open)', char: 'eqp', R: 50, FL: 0.90, xT: 0.72, Fd: 0.46, noiseTrimBonusDb: 0, maxLeak: 'V', slurryOk: false,
      cv: [4.0, 6.3, 10, 16, 24, 42, 63, 95, 170, 250, 360, 580, 920, 1300] },
    'globe-lownoise': { label: 'Globe, multi-stage low-noise / anti-cavitation cage (=%)' , char: 'eqp', R: 50, FL: 0.96, xT: 0.85, Fd: 0.25, noiseTrimBonusDb: 15, maxLeak: 'V', slurryOk: false,
      cv: [2.5, 4.5, 7, 11, 16, 28, 42, 62, 110, 165, 230, 380, 600, 860] },
    'eccentric-plug': { label: 'Eccentric rotary plug, Camflex-style (≈ linear)', char: 'lin', R: 100, FL: 0.85, xT: 0.65, Fd: 0.42, noiseTrimBonusDb: 0, maxLeak: 'IV', slurryOk: true,
      cv: [5.5, 9, 14, 22, 32, 60, 90, 135, 230, 350, 500, 840, 1300, 1850] },
    'butterfly': { label: 'Butterfly, swing-through, 70° (≈ equal-%)', char: 'eqp', R: 20, FL: 0.62, xT: 0.35, Fd: 0.57, noiseTrimBonusDb: 0, maxLeak: 'III', slurryOk: false,
      cv: [null, null, null, null, null, 90, 145, 220, 400, 650, 950, 1750, 2800, 4100] },
    'ball': { label: 'Segmented (V-notch) ball, 90° (≈ equal-%)', char: 'eqp', R: 100, FL: 0.60, xT: 0.30, Fd: 0.98, noiseTrimBonusDb: 0, maxLeak: 'VI', slurryOk: true,
      cv: [10, 18, 30, 48, 70, 120, 195, 290, 520, 800, 1150, 2050, 3200, 4600] }
  };
  const TRIM_FACTORS = [
    { val: 1.0, label: '100% Full Trim' },
    { val: 0.6, label: '60% Reduced Trim' },
    { val: 0.4, label: '40% Reduced Trim' },
    { val: 0.25, label: '25% Reduced Trim' }
  ];
  const EQP_R = 50;

  // ASME B16.34 Pressure-Temperature Standard Class Rating Tables (barg vs °C)
  const ASME_CLASSES = [150, 300, 600, 900, 1500, 2500];
  const B1634_MATERIALS = {
    wcb: {
      label: 'ASTM A216 Gr. WCB / WCC (Carbon Steel)', group: 'Group 1.1', minTempC: -29, maxTempC: 425,
      temps: [-29, 38, 50, 100, 150, 200, 250, 300, 350, 400, 425],
      ratings: {
        150:  [19.6, 19.6, 19.2, 17.7, 15.8, 13.8, 12.1, 10.2, 8.4, 6.5, 5.5],
        300:  [51.1, 51.1, 50.1, 46.6, 45.1, 43.8, 41.9, 39.8, 37.6, 34.7, 28.8],
        600:  [102.1, 102.1, 100.2, 93.2, 90.2, 87.6, 83.9, 79.6, 75.1, 69.4, 57.5],
        900:  [153.2, 153.2, 150.4, 139.8, 135.2, 131.4, 125.8, 119.5, 112.7, 104.2, 86.3],
        1500: [255.3, 255.3, 250.6, 233.0, 225.4, 219.0, 209.7, 199.1, 187.8, 173.6, 143.8],
        2500: [425.5, 425.5, 417.7, 388.3, 375.6, 365.0, 349.5, 331.8, 313.0, 289.3, 239.7]
      }
    },
    cf8m: {
      label: 'ASTM A351 Gr. CF8M (316 Stainless Steel)', group: 'Group 2.2', minTempC: -196, maxTempC: 538,
      temps: [-196, 38, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 538],
      ratings: {
        150:  [19.0, 19.0, 18.4, 16.2, 14.8, 13.7, 12.1, 10.2, 8.4, 6.5, 4.6, 2.8, 1.4],
        300:  [49.6, 49.6, 48.1, 42.2, 38.5, 35.7, 33.4, 31.6, 30.3, 29.4, 28.8, 28.2, 25.2],
        600:  [99.3, 99.3, 96.2, 84.4, 77.0, 71.3, 66.8, 63.2, 60.7, 58.9, 57.7, 56.5, 50.0],
        900:  [148.9, 148.9, 144.3, 126.6, 115.5, 107.0, 100.1, 94.9, 91.0, 88.3, 86.5, 84.7, 75.2],
        1500: [248.2, 248.2, 240.6, 211.0, 192.5, 178.3, 166.9, 158.1, 151.6, 147.2, 144.2, 140.9, 125.5],
        2500: [413.7, 413.7, 400.9, 351.6, 320.8, 297.2, 278.1, 263.5, 252.7, 245.3, 240.4, 235.0, 208.9]
      }
    },
    cf8: {
      label: 'ASTM A351 Gr. CF8 (304 Stainless Steel)', group: 'Group 2.1', minTempC: -196, maxTempC: 538,
      temps: [-196, 38, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 538],
      ratings: {
        150:  [19.0, 19.0, 18.3, 15.7, 14.2, 13.2, 12.1, 10.2, 8.4, 6.5, 4.6, 2.8, 1.4],
        300:  [49.6, 49.6, 47.8, 40.9, 37.0, 34.5, 32.5, 30.9, 29.9, 29.0, 28.1, 26.5, 24.4],
        600:  [99.3, 99.3, 95.6, 81.7, 74.0, 69.0, 65.0, 61.8, 59.7, 58.0, 56.2, 53.0, 48.9],
        900:  [148.9, 148.9, 143.5, 122.6, 111.0, 103.4, 97.5, 92.7, 89.6, 87.0, 84.3, 79.5, 73.3],
        1500: [248.2, 248.2, 239.1, 204.3, 185.0, 172.4, 162.4, 154.6, 149.3, 145.0, 140.4, 132.5, 122.1],
        2500: [413.7, 413.7, 398.5, 340.4, 308.4, 287.3, 270.7, 257.6, 248.8, 241.7, 234.1, 220.9, 203.6]
      }
    },
    wc9: {
      label: 'ASTM A217 Gr. WC9 (2¼Cr-1Mo Chrome-Moly)', group: 'Group 1.9', minTempC: -29, maxTempC: 565,
      temps: [-29, 38, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 538, 565],
      ratings: {
        150:  [19.8, 19.8, 19.5, 17.7, 15.8, 13.8, 12.1, 10.2, 8.4, 6.5, 4.6, 2.8, 1.4, 1.4],
        300:  [51.7, 51.7, 51.7, 51.5, 49.7, 48.0, 46.3, 42.9, 40.3, 36.5, 33.7, 28.2, 18.4, 11.7],
        600:  [103.4, 103.4, 103.4, 103.0, 99.5, 95.9, 92.7, 85.7, 80.4, 73.3, 67.7, 56.5, 36.9, 23.4],
        900:  [155.1, 155.1, 155.1, 154.4, 149.2, 143.9, 139.0, 128.6, 120.7, 109.8, 101.4, 84.7, 55.3, 35.1],
        1500: [258.6, 258.6, 258.6, 257.4, 248.7, 239.8, 231.8, 214.4, 201.1, 183.1, 169.0, 140.9, 92.2, 58.6],
        2500: [430.9, 430.9, 430.9, 429.0, 414.5, 399.6, 386.2, 357.1, 335.3, 304.9, 281.8, 235.0, 153.7, 97.6]
      }
    }
  };

  const LEAKAGE_CLASSES = {
    II:  { rank: 2, label: 'Class II (0.5% rated Cv)', desc: 'Double-ported / balanced metal seat' },
    III: { rank: 3, label: 'Class III (0.1% rated Cv)', desc: 'Standard rotary / balanced metal seat' },
    IV:  { rank: 4, label: 'Class IV (0.01% rated Cv)', desc: 'Metal-to-metal single-seated globe (industrial default)' },
    V:   { rank: 5, label: 'Class V (0.0005 mL/min/in/psi)', desc: 'Tight metal-seated shutoff (high-thrust actuator)' },
    VI:  { rank: 6, label: 'Class VI (Bubble-tight soft seat)', desc: 'Resilient / elastomeric seat (temp limited)' }
  };

  const num = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function interp1(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 0; i < xs.length - 1; i++) {
      if (x >= xs[i] && x <= xs[i + 1]) {
        const t = (x - xs[i]) / Math.max(1e-9, xs[i + 1] - xs[i]);
        return ys[i] + t * (ys[i + 1] - ys[i]);
      }
    }
    return ys[ys.length - 1];
  }

  /** ASME B16.34 body class selection from design pressure (barg), design temp (°C), material, and body size (in). */
  function calcAsmeB1634(materialKey, designPressBarg, designTempC, sizeIn) {
    const matKey = B1634_MATERIALS[materialKey] ? materialKey : 'wcb';
    const mat = B1634_MATERIALS[matKey];
    const Pdes = Math.max(0, num(designPressBarg, 10));
    const Tdes = num(designTempC, 65);
    const overTemp = Tdes > mat.maxTempC || Tdes < mat.minTempC;
    const minClassBySize = sizeIn <= 1.5 ? 300 : 150; // M04-034 p. 63 Tip #7
    let selectedClass = null, allowableBarg = 0;
    for (const cls of ASME_CLASSES) {
      if (cls < minClassBySize) continue;
      const allow = interp1(mat.temps, mat.ratings[cls], clamp(Tdes, mat.minTempC, mat.maxTempC));
      if (allow >= Pdes) { selectedClass = cls; allowableBarg = allow; break; }
    }
    if (!selectedClass) {
      selectedClass = 2500;
      allowableBarg = interp1(mat.temps, mat.ratings[2500], clamp(Tdes, mat.minTempC, mat.maxTempC));
    }
    const overPress = Pdes > allowableBarg;
    const utilPct = allowableBarg > 0 ? (Pdes / allowableBarg) * 100 : 999;
    const status = (overTemp || overPress) ? 'FAIL' : (utilPct > 90 ? 'WARN' : 'PASS');
    const note = overTemp
      ? `Design temp ${Tdes.toFixed(0)} °C outside ${mat.label} limit (${mat.minTempC}..${mat.maxTempC} °C)`
      : overPress
        ? `Design pressure ${Pdes.toFixed(1)} barg exceeds Class 2500 rating (${allowableBarg.toFixed(1)} barg)`
        : (sizeIn <= 1.5 && selectedClass === 300 ? `Class 300 enforced for ≤ 1½" body (M04-034 Tip #7)` : `Allowable ${allowableBarg.toFixed(1)} barg @ ${Tdes.toFixed(0)} °C (${utilPct.toFixed(0)}% used)`);
    return { materialKey: matKey, material: mat.label, group: mat.group, designPressBarg: Pdes, designTempC: Tdes,
      ansiClass: selectedClass, allowableBarg, utilPct, minClassBySize, overTemp, overPress, status, note };
  }

  // ------------------------------------------------ IAPWS-IF97 Steam Properties
  function steamSatTempC(pBara) {
    const pMpa = clamp(num(pBara, 1.01325) * 0.1, 0.0006113, 22.064);
    const n1 = 0.11670521452767e4, n2 = -0.72421316703206e6, n3 = -0.17073846940092e2;
    const n4 = 0.12020824702470e5, n5 = -0.32325550322333e7, n6 = 0.14915108613530e2;
    const n7 = -0.48232657361591e4, n8 = 0.40511340542057e6, n9 = -0.23855557567849;
    const n10 = 0.65017534844798e3;
    const beta = Math.pow(pMpa, 0.25);
    const E = beta * beta + n3 * beta + n6;
    const F = n1 * beta * beta + n4 * beta + n7;
    const G = n2 * beta * beta + n5 * beta + n8;
    const D = (2 * G) / (-F - Math.sqrt(Math.max(0, F * F - 4 * E * G)));
    const TK = (n10 + D - Math.sqrt(Math.max(0, (n10 + D) * (n10 + D) - 4 * (n9 + n10 * D)))) / 2;
    return TK - 273.15;
  }

  function calcSteamProps(pBara, tempC, isSaturated) {
    const P = clamp(num(pBara, 5), 0.05, 220.0);
    const TsatC = steamSatTempC(P);
    const TuseC = isSaturated ? TsatC : num(tempC, TsatC + 10);
    const superheatC = TuseC - TsatC;
    const wetSteam = !isSaturated && (TuseC < TsatC - 0.5);
    const TK = Math.max(273.15, (wetSteam ? TsatC : TuseC) + 273.15);
    const Tc = 647.096, Pc = 220.64, omega = 0.344, M = 18.01528;
    const Tr = TK / Tc, Pr = P / Pc;
    const kappa = 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
    const alpha = Math.pow(1 + kappa * (1 - Math.sqrt(Tr)), 2);
    const A = 0.45724 * alpha * Pr / (Tr * Tr);
    const B = 0.07780 * Pr / Tr;
    const c2 = -(1 - B), c1 = A - 3 * B * B - 2 * B, c0 = -(A * B - B * B - B * B * B);
    const p = c1 - c2 * c2 / 3;
    const q = (2 * c2 * c2 * c2 - 9 * c2 * c1 + 27 * c0) / 27;
    const disc = q * q / 4 + p * p * p / 27;
    let Z = 1;
    if (disc >= 0) {
      const sd = Math.sqrt(disc);
      Z = Math.cbrt(-q / 2 + sd) + Math.cbrt(-q / 2 - sd) - c2 / 3;
    } else {
      const r = Math.sqrt(-p * p * p / 27);
      const phi = Math.acos(clamp(-q / (2 * r), -1, 1));
      const m = 2 * Math.cbrt(r);
      Z = Math.max(m * Math.cos(phi / 3) - c2 / 3, m * Math.cos((phi + 2 * Math.PI) / 3) - c2 / 3, m * Math.cos((phi + 4 * Math.PI) / 3) - c2 / 3);
    }
    Z = clamp(Z, 0.35, 1.05);
    const rho1 = (P * 1e5 * M) / (Z * RU * TK);
    const k = clamp(1.332 - 0.00014 * Math.max(0, TuseC - 100) - 0.0005 * Math.min(P, 80) * (1 - Z), 1.24, 1.35);
    const muCp = clamp(0.0088 + 3.8e-5 * Math.max(0, TuseC), 0.008, 0.04);
    return { TsatC, TuseC, superheatC, wetSteam, Z, rho1, k, muCp, M };
  }

  // ------------------------------------------------------- correction factors
  function zetas(dMm, D1Mm, D2Mm) {
    const r1 = dMm / D1Mm, r2 = dMm / D2Mm;
    const z1 = D1Mm > dMm ? 0.5 * Math.pow(1 - r1 * r1, 2) : 0;
    const z2 = D2Mm > dMm ? 1.0 * Math.pow(1 - r2 * r2, 2) : 0;
    const zB1 = 1 - Math.pow(r1, 4), zB2 = 1 - Math.pow(r2, 4);
    return { z1, z2, zB1, zB2, sum: z1 + z2 + zB1 - zB2, inlet: z1 + zB1 };
  }
  const calcFP = (C, d, z) => 1 / Math.sqrt(1 + (z.sum / N.N2) * Math.pow(C / (d * d), 2));
  const calcFLP = (C, d, z, FL) => FL / Math.sqrt(1 + (FL * FL / N.N2) * z.inlet * Math.pow(C / (d * d), 2));
  const calcXTP = (C, d, z, xT, FP) => (xT / (FP * FP)) / (1 + (xT * z.inlet / N.N5) * Math.pow(C / (d * d), 2));
  const calcFF = (pv, pc) => 0.96 - 0.28 * Math.sqrt(clamp(pv / Math.max(1e-9, pc), 0, 1));
  const calcY = (x, Fg, xTx) => 1 - Math.min(x, Fg * xTx) / (3 * Fg * xTx);
  const calcRev = (Q, nu, C, FL, Fd, d) =>
    (N.N4 * Fd * Q) / (nu * Math.sqrt(Math.max(1e-12, C * FL))) * Math.pow((FL * FL * C * C) / (N.N2 * Math.pow(d, 4)) + 1, 0.25);
  function calcFR(Rev, C, d, FL) {
    if (Rev >= 10000) return 1;
    const n1 = N.N2 / Math.pow(C / (d * d), 2);
    const frB = (0.026 / FL) * Math.sqrt(n1 * Rev);
    const frA = Rev >= 10 ? 1 + (0.33 * Math.sqrt(FL) / Math.pow(n1, 0.25)) * Math.log10(Rev / 10000) : Infinity;
    return clamp(Math.min(frA, frB, 1), 1e-3, 1);
  }
  function opening(C, Crated, char) {
    if (!(Crated > 0) || !(C > 0)) return 0;
    const phi = C / Crated;
    if (char === 'lin') return clamp(phi, 0, 1.2);
    return clamp(1 + Math.log(phi) / Math.log(EQP_R), 0, 1.2);
  }
  const cvAtTravel = (h, Crated, char) => (char === 'lin' ? h * Crated : Crated * Math.pow(EQP_R, h - 1));
  function installedFlow(h, char, authorityN) {
    const Nv = clamp(num(authorityN, 1), 0.02, 1.0);
    const phi = char === 'lin' ? clamp(h, 0, 1) : Math.pow(EQP_R, clamp(h, 0, 1) - 1);
    if (h <= 0) return 0;
    return phi / Math.sqrt(Nv + (1 - Nv) * phi * phi);
  }
  function installedGain(h, char, authorityN) {
    const hc = clamp(h, 0.02, 0.98), dh = 0.005;
    return (installedFlow(hc + dh, char, authorityN) - installedFlow(hc - dh, char, authorityN)) / (2 * dh);
  }

  /** CED M04-034 simplified hand-check Cv (pp. 19, 42–44) for educational comparison in trace. */
  function calcM04QuickCv(pt) {
    if (!pt || !pt.valid) return { cv: 0, note: 'invalid' };
    const p1Psi = pt.P1 * BAR_PSI, p2Psi = pt.P2 * BAR_PSI, dpPsi = pt.dP * BAR_PSI;
    if (pt.fluid === 'liquid') {
      const qGpm = pt.Q * M3HR_TO_GPM, S = pt.rho1 / RHO0;
      const cv = qGpm * Math.sqrt(S / Math.max(1e-6, dpPsi));
      return { cv, note: `Q·√(S/ΔP) = ${qGpm.toFixed(1)}·√(${S.toFixed(3)}/${dpPsi.toFixed(2)})` };
    }
    if (pt.fluid === 'steam') {
      const wLb = pt.W * KG_LB;
      const shF = pt.steam ? Math.max(0, pt.steam.superheatC * 1.8) : 0;
      const K = 1 + 0.0007 * shF;
      const crit = p2Psi <= 0.5 * p1Psi;
      const cv = crit ? (wLb * K) / (1.82 * p1Psi) : (wLb * K) / (2.1 * Math.sqrt(dpPsi * (p1Psi + p2Psi)));
      return { cv, note: crit ? `Critical (P₂ ≤ ½P₁): W·K/(1.82·P₁), K=${K.toFixed(3)}` : `Subcritical: W·K/(2.1·√(ΔP(P₁+P₂))), K=${K.toFixed(3)}` };
    }
    // Gas (M04-034 pp. 42-43)
    const wLb = pt.W * KG_LB;
    const scfh = (wLb / Math.max(1, pt.mUsed)) * SCF_PER_LBMOL;
    const G = pt.mUsed / 28.964;
    const TR = pt.tUsedC * 1.8 + 491.67;
    const crit = p2Psi <= 0.5 * p1Psi;
    const cv = crit ? (scfh * Math.sqrt(G * TR)) / (660 * p1Psi) : (scfh * Math.sqrt(G * TR)) / (1360 * Math.sqrt(dpPsi * Math.max(0.1, p2Psi)));
    return { cv, note: crit ? `Critical (P₂ ≤ ½P₁): Qa·√(G·T_R)/(660·P₁)` : `Subcritical: Qa·√(G·T_R)/(1360·√(ΔP·P₂))` };
  }

  // -------------------------------------- Acoustic Noise (IEC 60534-8-3 / -8-4)
  function calcNoise(pt, valve, dMm, D2Mm, wall2Mm, xFz) {
    if (!pt || !pt.valid) return { lpAe1m: 0, lpi: 0, tlPipe: 0, fpHz: 0, regime: 'N/A', status: 'PASS', tier: 'PASS', action: 'Acceptable (≤ 85 dBA)' };
    const mDot = pt.W / 3600;
    const D2 = Math.max(0.015, num(D2Mm, dMm) / 1000);
    const ts = Math.max(0.002, num(wall2Mm, estimateWallFromId(D2Mm)) / 1000);
    const FL = clamp(valve.FL, 0.3, 1.0), Fd = clamp(valve.Fd, 0.05, 1.0);
    const bonusDb = num(valve.noiseTrimBonusDb, 0);
    const dj = Math.max(0.001, 0.0046 * Fd * Math.sqrt(Math.max(1e-4, pt.C * FL)));
    const distAtten = 10 * Math.log10((D2 + 2.0) / D2);

    let lpAe1m = 50, lpi = 120, tlPipe = -50, fpHz = 1000, nRegime = '';
    if (pt.fluid === 'liquid') {
      const rho = Math.max(100, pt.rho1), cL = 1400;
      const dPeffPa = Math.min(pt.dP, Math.max(pt.dPmax, 1e-4)) * 1e5;
      const Uvc = (1 / FL) * Math.sqrt((2 * dPeffPa) / rho);
      const Wm = 0.5 * mDot * Uvc * Uvc;
      const etaTurb = 1e-4 * (Uvc / cL);
      let etaCav = 0;
      nRegime = 'Turbulent (non-cavitating)';
      if (pt.flashing) { etaCav = 15 * etaTurb; nRegime = 'Flashing two-phase'; }
      else if (pt.xF > xFz && xFz > 0) {
        const xf = clamp(pt.xF, xFz + 1e-4, 0.98);
        const ratio = (xf - xFz) / Math.max(0.05, 1 - xFz);
        etaCav = etaTurb * Math.min(400, 12 * Math.pow(ratio, 1.6) * Math.exp(3.2 * xf));
        nRegime = pt.choked ? 'Full cavitation (choked)' : 'Cavitating (xF ≥ xFz)';
      }
      const Wa = Math.max(1e-12, (etaTurb + etaCav) * Wm);
      const Zliq = rho * cL;
      lpi = 10 * Math.log10((3.2e9 * Wa * Zliq) / (D2 * D2));
      fpHz = clamp(0.2 * Uvc / dj, 150, 12000);
      const zm = 2 * Math.PI * fpHz * RHO_STEEL * ts;
      const fr = C_STEEL / (Math.PI * D2);
      const shellBoost = fpHz < fr ? Math.pow(fpHz / fr, 0.45) : 1.0;
      tlPipe = 20 * Math.log10((2 * Z0_AIR) / Math.sqrt(Math.pow(Zliq + Z0_AIR, 2) + zm * zm)) + 10 * Math.log10(Math.max(0.08, shellBoost));
      lpAe1m = clamp(lpi + tlPipe - distAtten - (pt.xF > xFz ? bonusDb : bonusDb * 0.4), 30, 130);
    } else {
      const k = clamp(pt.kUsed || 1.3, 1.05, 1.7);
      const P1Pa = pt.P1 * 1e5, P2Pa = Math.max(1e3, pt.P2 * 1e5), pr = P1Pa / P2Pa;
      const rho1 = Math.max(0.01, pt.rho1), rho2 = Math.max(0.005, pt.rho2 || rho1 * (P2Pa / P1Pa));
      const c1 = Math.sqrt(k * P1Pa / rho1), c2 = Math.max(100, pt.c2 || c1);
      const cVc = c1 * Math.sqrt(2 / (k + 1));
      const prCrit = Math.pow((k + 1) / 2, k / (k - 1));
      const alpha = Math.max(0.15, 1 - FL * FL * (1 - 1 / prCrit));
      const prBreak = prCrit / alpha;
      let Wm = 0, eta = 1e-6;
      if (pr < prBreak) {
        const dPvc = (P1Pa - P2Pa) / (FL * FL);
        const Uvc = Math.min(cVc, Math.sqrt((2 * Math.max(0, dPvc)) / rho1));
        const Mvc = clamp(Uvc / c1, 0.02, 0.99);
        Wm = 0.5 * mDot * Uvc * Uvc;
        eta = 1e-4 * FL * FL * Math.pow(Mvc, 3.6);
        fpHz = clamp(0.2 * Uvc / dj, 200, 14000);
        nRegime = 'Regime I (subsonic)';
      } else {
        const Mj = clamp(Math.sqrt((2 / (k - 1)) * (Math.pow(pr, (k - 1) / k) - 1)), 1.0, 5.0);
        Wm = 0.5 * mDot * cVc * cVc;
        if (Mj <= 1.4) { eta = 1e-4 * Math.pow(Mj, 6.6 * FL * FL); nRegime = 'Regime II (sonic jet)'; }
        else if (Mj <= 2.2) { eta = 1e-4 * Math.pow(1.4, 6.6 * FL * FL) * Math.pow(Mj / 1.4, 3.6 * FL * FL); nRegime = 'Regime III (shock-cell)'; }
        else if (Mj <= 3.5) { eta = 1e-4 * Math.pow(1.4, 6.6 * FL * FL) * Math.pow(2.2 / 1.4, 3.6 * FL * FL) * Math.pow(Mj / 2.2, 2.0); nRegime = 'Regime IV (Mach-disc)'; }
        else { eta = 1e-4 * Math.pow(1.4, 6.6 * FL * FL) * Math.pow(2.2 / 1.4, 3.6 * FL * FL) * Math.pow(3.5 / 2.2, 2.0) * 1.15; nRegime = 'Regime V (constant eff.)'; }
        eta = clamp(eta, 1e-6, 0.015);
        fpHz = clamp((0.2 * cVc) / (dj * Math.sqrt(Math.max(1, Mj * Mj - 0.5))), 300, 15000);
      }
      const Wa = Math.max(1e-12, eta * Wm);
      const Z2 = rho2 * c2;
      lpi = 10 * Math.log10((3.2e9 * Wa * Z2) / (D2 * D2));
      const zm = 2 * Math.PI * fpHz * RHO_STEEL * ts;
      const fr = C_STEEL / (Math.PI * D2), fo = c2 / (Math.PI * D2);
      const gx = fpHz < fo ? Math.pow(fo / fr, 0.67) * Math.pow(fpHz / fo, 2.5) : (fpHz < fr ? Math.pow(fpHz / fr, 0.5) : 1.0);
      const tlMass = 20 * Math.log10((2 * Z0_AIR) / Math.sqrt(Math.pow(Z2 + Z0_AIR, 2) + zm * zm));
      const tlShell = 10 * Math.log10(clamp(gx, 0.05, 1.5)) - 3.0 * Math.log10(Math.max(0.5, ts / 0.005));
      tlPipe = tlMass + tlShell;
      const aWeight = fpHz < 500 ? -6 * Math.log10(500 / fpHz) : 0;
      lpAe1m = clamp(lpi + tlPipe - distAtten + aWeight - bonusDb, 35, 135);
    }

    // M04-034 p. 61 3-Tier Noise Decision Rule
    let status = 'PASS', tier = 'PASS', action = 'PASS ≤ 80 dBA (standard pipe & trim)';
    if (lpAe1m > 100) {
      status = 'FAIL'; tier = 'SOURCE';
      action = '> 100 dBA — SOURCE TREATMENT MANDATORY (pipe vibration risk: multi-stage labyrinth/cage trim or diffuser)';
    } else if (lpAe1m > 85) {
      status = 'FAIL'; tier = 'PATH';
      action = '85–100 dBA — PATH TREATMENT (heavier pipe Sch 80/160, acoustic insulation, expand D₂, or silencer)';
    } else if (lpAe1m > 80) {
      status = 'WARN'; tier = 'MARGINAL';
      action = 'MARGINAL 80–85 dBA (verify vendor trim acoustics)';
    }
    return { lpAe1m, lpi, tlPipe, fpHz, regime: nRegime, status, tier, action };
  }

  // ---------------------------------------------------------- one operating point
  function sizePoint(p) {
    const fluid = p.fluid === 'steam' ? 'steam' : (p.fluid === 'gas' ? 'gas' : 'liquid');
    const isCompressible = fluid === 'gas' || fluid === 'steam';
    const W = Math.max(0, num(p.W, 0));
    const P1 = Math.max(0.01, num(p.P1, 1));
    const P2 = Math.max(0, num(p.P2, 0));
    const dP = P1 - P2;
    const FL = clamp(num(p.FL, 0.9), 0.3, 1), xT = clamp(num(p.xT, 0.7), 0.05, 1), Fd = clamp(num(p.Fd, 0.46), 0.05, 1);
    const d = Math.max(5, num(p.d, 100));
    const D1 = Math.max(d, num(p.D1, d));
    const D2 = Math.max(d, num(p.D2, D1));
    const z = zetas(d, D1, D2);
    let mu = Math.max(1e-4, num(p.mu, 1));
    const out = { fluid, W, P1, P2, dP, valid: W > 0 && dP > 0, choked: false, flashing: false, cavIncipient: false,
      C: 0, Kv: 0, Cturb: 0, FP: 1, FLP: FL, xTP: xT, Y: 1, Fg: 1, x: 0, xs: 0, dPmax: 0, FF: 1, Rev: 0, FR: 1,
      Q: 0, rho1: 0, rho2: 0, c1: 0, c2: 0, vInMS: 0, machIn: 0, vOutMS: 0, machOut: 0, pVcBara: 0,
      sigma: 0, xF: 0, z, iterations: 0, steam: null, kUsed: num(p.k, 1.3), mUsed: num(p.M, 20), zUsed: num(p.Z, 1), tUsedC: num(p.T, 20) };
    if (!out.valid) return out;

    let rho1, Q, f;
    if (!isCompressible) {
      rho1 = Math.max(1, num(p.rho, 1000));
      const pv = Math.max(0, num(p.pv, 0)), pc = Math.max(0.1, num(p.pc, 220.64));
      const G = rho1 / RHO0;
      Q = W / rho1;
      out.FF = calcFF(pv, pc);
      out.flashing = P2 <= pv;
      out.xF = P1 > pv ? dP / (P1 - pv) : 99;
      out.sigma = (P1 - pv) / dP;
      const dPeff = Math.max(1e-6, P1 - out.FF * pv);
      f = (C) => {
        const FP = calcFP(C, d, z), FLP = calcFLP(C, d, z, FL);
        const dPmax = Math.pow(FLP / FP, 2) * dPeff;
        const choked = dP >= dPmax;
        const Cn = choked ? (Q / (N.N1 * FLP)) * Math.sqrt(G / dPeff) : (Q / (N.N1 * FP)) * Math.sqrt(G / dP);
        return { Cn, FP, FLP, dPmax, choked };
      };
    } else {
      let TuseC, M, Zf, k;
      if (fluid === 'steam') {
        const sp = calcSteamProps(P1, p.T, !!p.steamSaturated);
        const Tsat2C = steamSatTempC(Math.max(0.05, P2));
        const T2EstC = sp.TuseC - 0.45 * dP;
        const condensingOutlet = T2EstC < Tsat2C - 0.5;
        TuseC = sp.TuseC; M = sp.M; Zf = sp.Z; k = sp.k; mu = sp.muCp; rho1 = sp.rho1;
        out.steam = Object.assign({}, sp, { Tsat2C, T2EstC, condensingOutlet });
      } else {
        TuseC = num(p.T, 20); M = Math.max(1, num(p.M, 20)); Zf = clamp(num(p.Z, 1), 0.05, 2); k = clamp(num(p.k, 1.3), 1.0, 2.0);
        rho1 = (P1 * 1e5 * M) / (Zf * RU * Math.max(1, TuseC + 273.15));
      }
      const TK = Math.max(1, TuseC + 273.15);
      out.kUsed = k; out.mUsed = M; out.zUsed = Zf; out.tUsedC = TuseC;
      Q = W / rho1;
      out.Fg = k / 1.40;
      out.x = dP / P1;
      f = (C) => {
        const FP = calcFP(C, d, z), xTP = calcXTP(C, d, z, xT, FP);
        const xChoke = out.Fg * xTP, choked = out.x >= xChoke, xs = Math.min(out.x, xChoke);
        const Y = calcY(out.x, out.Fg, xTP);
        const Cn = (W / (N.N8 * FP * P1 * Y)) * Math.sqrt(TK * Zf / (xs * M));
        return { Cn, FP, xTP, Y, xs, choked, dPmax: xChoke * P1 };
      };
    }
    let C = f(1e-9).Cn, r, i = 0;
    for (; i < 200; i++) {
      r = f(C);
      if (Math.abs(r.Cn - C) <= 1e-10 * Math.max(1, C)) { C = r.Cn; break; }
      C = r.Cn;
    }
    r = f(C);
    Object.assign(out, { Cturb: C, FP: r.FP, choked: r.choked, dPmax: r.dPmax, iterations: i, rho1, Q });
    if (!isCompressible) out.FLP = r.FLP; else Object.assign(out, { xTP: r.xTP, Y: r.Y, xs: r.xs });

    const nu = (mu * 1e-3) / rho1;
    const frAt = (Cx) => calcFR(calcRev(Q, nu, Cx, FL, Fd, d), Cx, d, FL);
    let Cl = C;
    if (frAt(C) < 1) {
      let lo = C, hi = C * 2;
      while (hi * frAt(hi) < C && hi < C * 1e6) { lo = hi; hi *= 2; }
      for (let j = 0; j < 80; j++) { const mid = Math.sqrt(lo * hi); if (mid * frAt(mid) < C) lo = mid; else hi = mid; }
      Cl = hi;
    }
    out.Rev = calcRev(Q, nu, Cl, FL, Fd, d);
    out.FR = frAt(Cl);
    out.C = Cl;
    out.Kv = Cl * KV_PER_CV;

    // Estimated vena contracta minimum static pressure P_vc (bara) for pressure-velocity profile SVG
    if (!isCompressible) {
      const flEff = clamp(out.FLP || FL, 0.3, 1);
      const pv = Math.max(0, num(p.pv, 0));
      out.pVcBara = Math.max(out.FF * pv, P1 - dP / (flEff * flEff));
    } else {
      out.pVcBara = Math.max(0.05, P1 * (1 - Math.min(0.85, (out.xs || out.x) / Math.max(0.25, FL * FL))));
    }

    // Upstream (D1) & Downstream (D2) pipe velocities & Mach numbers
    const A1 = (Math.PI / 4) * Math.pow(D1 / 1000, 2);
    const A2 = (Math.PI / 4) * Math.pow(D2 / 1000, 2);
    if (!isCompressible) {
      out.rho2 = rho1;
      out.vInMS = (Q / 3600) / Math.max(1e-9, A1);
      out.vOutMS = (Q / 3600) / Math.max(1e-9, A2);
      out.machIn = 0; out.machOut = 0;
    } else {
      const TK1 = Math.max(100, out.tUsedC + 273.15);
      const TK2 = Math.max(100, (out.steam ? out.steam.T2EstC : out.tUsedC) + 273.15);
      out.c1 = Math.sqrt((out.kUsed * out.zUsed * RU * TK1) / out.mUsed);
      out.vInMS = (Q / 3600) / Math.max(1e-9, A1);
      out.machIn = out.vInMS / Math.max(1, out.c1);
      out.rho2 = Math.max(0.005, (Math.max(0.01, P2) * 1e5 * out.mUsed) / (out.zUsed * RU * TK2));
      out.vOutMS = (W / (3600 * out.rho2)) / Math.max(1e-9, A2);
      out.c2 = Math.sqrt((out.kUsed * out.zUsed * RU * TK2) / out.mUsed);
      out.machOut = out.vOutMS / Math.max(1, out.c2);
    }
    return out;
  }

  const estimateXFz = (Crated, Fd, FL) => 0.90 / Math.sqrt(1 + 3 * Fd * Math.sqrt(Math.max(0, Crated) / FL));

  // ---------------------------------------------------------------- full calc
  const POINTS = [['min', 'Min'], ['norm', 'Normal'], ['max', 'Max']];

  function defaultState() {
    return {
      tag: 'LV-3102', service: 'Lean Amine Booster Pump Discharge Flow Control',
      fluid: 'liquid', flowBasis: 'mass', valveType: 'globe-eqp', sizeIn: 0, trimFactor: 1.0,
      pipeMode: 'asme', d1Nps: '4"', d1Sch: 'Sch 40', d2Nps: '4"', d2Sch: 'Sch 40',
      pipeIdMm: 102.26, d1Mm: 102.26, d2Mm: 102.26, atmBara: 1.01325,
      wMin: 42500, wNorm: 129400, wMax: 142300,
      p1Min: 26.5, p1Norm: 24.8, p1Max: 24.0, p2Min: 19.6, p2Norm: 20.4, p2Max: 20.9,
      rho: 1035, pvBara: 0.28, pcBara: 220.64, viscCp: 2.85,
      tempC: 35, mw: 18.6, k: 1.27, z: 0.92, steamSaturated: false,
      pSysVarBar: 2.8,
      customVendor: false, customCrated: 170, customFL: 0.90, customXT: 0.72, customFd: 0.46,
      // M04-034 Mechanical, Rating, Actuator & P&ID Station Specification
      bodyMaterial: 'wcb', designPressBarg: 0, designTempC: 65,
      loopType: 'level', fluidService: 'clean', leakageClass: 'IV',
      failAction: 'FC', actuatorType: 'pneumatic-diaphragm', endConn: 'rf-flanged',
      hasBypass: true, fireSafe: false
    };
  }

  function resolvePipes(s, rawInput) {
    const legacyRawPipe = rawInput && rawInput.pipeIdMm != null && rawInput.d1Nps == null && rawInput.d2Nps == null && rawInput.pipeMode !== 'asme';
    if (legacyRawPipe || s.pipeMode === 'custom') {
      const D1 = Math.max(10, num(legacyRawPipe ? rawInput.pipeIdMm : (s.d1Mm || s.pipeIdMm), 102.26));
      const D2 = Math.max(10, num(legacyRawPipe ? rawInput.pipeIdMm : (s.d2Mm || D1), D1));
      return {
        mode: 'custom', D1, D2,
        wall1Mm: estimateWallFromId(D1), wall2Mm: estimateWallFromId(D2),
        label1: `Custom ID ${D1.toFixed(1)} mm`, label2: `Custom ID ${D2.toFixed(1)} mm`
      };
    }
    const p1 = lookupPipe(s.d1Nps, s.d1Sch);
    const p2 = lookupPipe(s.d2Nps, s.d2Sch);
    return {
      mode: 'asme', D1: p1.idMm, D2: p2.idMm,
      wall1Mm: p1.wallMm, wall2Mm: p2.wallMm,
      d1Nps: p1.nps, d1Sch: p1.schedule, d2Nps: p2.nps, d2Sch: p2.schedule,
      label1: `${p1.nps} ${p1.schedule} (${p1.idMm.toFixed(1)} mm)`,
      label2: `${p2.nps} ${p2.schedule} (${p2.idMm.toFixed(1)} mm)`
    };
  }

  function effectiveValve(s, baseValve) {
    const v = Object.assign({}, baseValve);
    if (s.customVendor) {
      v.FL = clamp(num(s.customFL, baseValve.FL), 0.3, 1.0);
      v.xT = clamp(num(s.customXT, baseValve.xT), 0.05, 1.0);
      v.Fd = clamp(num(s.customFd, baseValve.Fd), 0.05, 1.0);
      v.isCustom = true;
    } else v.isCustom = false;
    return v;
  }

  function sizeForValve(s, v, idx, pipes, trimFactor) {
    const d = SIZES_MM[idx], baseCr = v.cv[idx];
    const Cr = (s.customVendor && num(s.customCrated, 0) > 0) ? num(s.customCrated, baseCr) : baseCr * trimFactor;
    const atm = num(s.atmBara, 1.01325);
    const pts = POINTS.map(([key, label]) => {
      const K = key[0].toUpperCase() + key.slice(1);
      const r = sizePoint({
        fluid: s.fluid, W: s['w' + K], P1: num(s['p1' + K], 0) + atm, P2: num(s['p2' + K], 0) + atm,
        rho: s.rho, pv: s.pvBara, pc: s.pcBara, mu: s.viscCp, T: s.tempC, M: s.mw, k: s.k, Z: s.z,
        steamSaturated: !!s.steamSaturated, FL: v.FL, xT: v.xT, Fd: v.Fd, d, D1: pipes.D1, D2: pipes.D2
      });
      r.key = key; r.label = label;
      r.open = opening(r.C, Cr, v.char) * 100;
      return r;
    });
    const [pMin, pNorm, pMax] = pts;
    const ratioOk = d >= 0.48 * pipes.D1; // M04-034 p. 45 & 63: valve >= 1/2 pipe size
    return { idx, sizeIn: SIZES_IN[idx], dMm: d, Crated: Cr, baseCrated: baseCr, trimFactor, pts, valid: pts.every(p => p.valid),
      normOk: pNorm.open >= 50 && pNorm.open <= 80, maxOk: pMax.open <= 90 && pMax.C <= Cr, minOk: pMin.open >= 10, ratioOk };
  }

  function calc(input) {
    const s = Object.assign(defaultState(), input || {});
    s.fluid = s.fluid === 'steam' ? 'steam' : (s.fluid === 'gas' ? 'gas' : 'liquid');
    s.flowBasis = s.flowBasis === 'vol' ? 'vol' : 'mass';
    const vKey = VALVES[s.valveType] ? s.valveType : 'globe-eqp';
    const v = effectiveValve(s, VALVES[vKey]);
    const trimFactor = clamp(num(s.trimFactor, 1.0), 0.1, 1.0);
    s.trimFactor = trimFactor;
    const pipes = resolvePipes(s, input);
    s.pipeIdMm = pipes.D1;
    const Dlim = Math.min(pipes.D1, pipes.D2);
    const cands = SIZES_IN.map((_, i) => i).filter(i => v.cv[i] && SIZES_MM[i] <= 1.05 * Dlim);
    const forced = SIZES_IN.indexOf(num(s.sizeIn, 0));
    const options = cands.map(i => sizeForValve(s, v, i, pipes, trimFactor));
    let sel = null, basis = '';
    if (forced >= 0 && v.cv[forced]) {
      sel = sizeForValve(s, v, forced, pipes, trimFactor); basis = 'user-fixed size';
    } else if (options.length) {
      // Prefer candidates honoring M04-034 d >= 0.5*D1 rule alongside opening targets
      sel = options.find(o => o.valid && o.ratioOk && o.maxOk && o.normOk && o.minOk)
        || options.find(o => o.valid && o.maxOk && o.normOk && o.minOk)
        || options.find(o => o.valid && o.ratioOk && o.maxOk && o.normOk)
        || options.find(o => o.valid && o.maxOk && o.normOk)
        || options.find(o => o.valid && o.maxOk);
      basis = sel ? 'smallest size meeting opening criteria' : 'no size ≤ line size meets max ≤ 90 % (largest shown)';
      if (!sel) sel = options[options.length - 1];
    } else {
      sel = sizeForValve(s, v, v.cv.findIndex(c => c), pipes, trimFactor); basis = 'line smaller than smallest valve';
    }

    const pts = sel.pts;
    const [pMin, pNorm, pMax] = pts;
    const isLiq = s.fluid === 'liquid';
    const reqRange = pMin.C > 0 ? pMax.C / pMin.C : 0;
    const appTurndown = pMin.W > 0 ? pMax.W / pMin.W : 0;
    const minControllable = sel.Crated / v.R;
    const rangeOk = pMin.C >= minControllable && sel.minOk;
    const selStatus = !sel.valid || !sel.maxOk ? 'FAIL' : (sel.normOk && sel.minOk ? 'PASS' : 'WARN');

    // M04-034 pp. 39–40 Rated Cv Sizing Margin Check
    const maxOverNorm = pNorm.W > 0 ? pMax.W / pNorm.W : 1;
    const cvMarginRule = maxOverNorm <= 1.4 ? '1.5 × Cv_norm (Q_max ≤ 1.4·Q_norm)' : '1.1 × Cv_max (Q_max > 1.4·Q_norm)';
    const cvMarginTarget = maxOverNorm <= 1.4 ? 1.5 * pNorm.C : 1.1 * pMax.C;
    const cvMarginOk = sel.Crated >= cvMarginTarget * 0.98;

    // M04-034 p. 45 & 63 Valve-to-Pipe Size Ratio Check (d >= 0.5 * D1)
    const dToD1 = pipes.D1 > 0 ? sel.dMm / pipes.D1 : 1;
    const pipeRatioOk = dToD1 >= 0.48 && !(pipes.D1 > 30 && sel.sizeIn < 1);
    const pipeRatioNote = dToD1 < 0.48
      ? `d/D₁ = ${dToD1.toFixed(2)} < 0.50 (M04-034: never < ½ pipe size — use larger body with reduced trim)`
      : (pipes.D1 > 30 && sel.sizeIn < 1 ? 'Line > 1": valve should be ≥ 1" (M04-034 Tip #6)' : `d/D₁ = ${dToD1.toFixed(2)} ≥ 0.50 PASS`);

    // Cavitation & Acoustic Noise
    let regime = 'PASS', regimeText = '';
    const xFz = isLiq ? estimateXFz(sel.Crated, v.Fd, v.FL) : 0;
    pts.forEach(p => {
      p.cavIncipient = isLiq && p.valid && p.xF >= xFz;
      p.noise = calcNoise(p, v, sel.dMm, pipes.D2, pipes.wall2Mm, xFz);
    });
    if (!sel.valid) { regime = 'FAIL'; regimeText = 'Invalid point (W ≤ 0 or P1 ≤ P2)'; }
    else if (isLiq) {
      if (pts.some(p => p.flashing)) { regime = 'FAIL'; regimeText = 'FLASHING (P2 ≤ pv): hard-faced trim / angle body'; }
      else if (pts.some(p => p.choked)) { regime = 'WARN'; regimeText = 'CHOKED / full cavitation: low-recovery cage + straight exit run'; }
      else if (pts.some(p => p.cavIncipient)) { regime = 'WARN'; regimeText = 'Incipient cavitation (xF ≥ xFz): check anti-cavitation trim'; }
      else regimeText = 'Non-choked, no cavitation';
    } else if (s.fluid === 'steam') {
      const wet = pts.some(p => p.steam && p.steam.wetSteam);
      const cond = pts.some(p => p.steam && p.steam.condensingOutlet);
      if (wet) { regime = 'WARN'; regimeText = 'WET STEAM INLET (T₁ < T_sat): check erosion'; }
      else if (pts.some(p => p.choked)) { regime = 'WARN'; regimeText = cond ? 'CHOKED + condensing outlet: check noise/erosion' : 'CHOKED steam (x ≥ Fγ·xTP): check noise'; }
      else if (cond) { regime = 'WARN'; regimeText = 'Non-choked, condensing outlet (T₂ < T_sat)'; }
      else regimeText = 'Superheated / dry steam, non-choked';
    } else {
      regime = pts.some(p => p.choked) ? 'WARN' : 'PASS';
      regimeText = regime === 'WARN' ? 'CHOKED (x ≥ Fγ·xTP): check noise' : 'Non-choked (x < Fγ·xTP)';
    }
    const laminar = pts.some(p => p.valid && p.Rev < 10000);

    // Governing acoustic noise (3-tier M04-034 p. 61)
    const govNoisePt = pts.reduce((a, b) => ((b.noise?.lpAe1m || 0) > (a.noise?.lpAe1m || 0) ? b : a), pts[2]);
    const maxNoiseDb = govNoisePt.noise ? govNoisePt.noise.lpAe1m : 0;
    const noiseStatus = govNoisePt.noise ? govNoisePt.noise.status : 'PASS';
    const noiseTier = govNoisePt.noise ? govNoisePt.noise.tier : 'PASS';
    const noiseAction = govNoisePt.noise ? govNoisePt.noise.action : '';

    // Inlet & Outlet Pipe Velocities / Mach (M04-034 pp. 55 & 63)
    const maxVelIn = Math.max(...pts.map(p => p.vInMS || 0));
    const maxVelOut = Math.max(...pts.map(p => p.vOutMS || 0));
    const maxMachIn = Math.max(...pts.map(p => p.machIn || 0));
    const maxMachOut = Math.max(...pts.map(p => p.machOut || 0));
    const exitStatus = isLiq
      ? (maxVelOut > (pts.some(p => p.flashing) ? 15 : 10) ? 'WARN' : 'PASS')
      : (maxMachOut > 0.50 || maxMachIn > 0.35 ? 'FAIL' : (maxMachOut > 0.33 || maxMachIn > 0.30) ? 'WARN' : 'PASS');

    // Valve Authority, Installed Gain & M04-034 Step #5 Segmental Gain Consistency
    const pSysVar = Math.max(0, num(s.pSysVarBar, 0));
    const dpMax = pMax.valid ? pMax.dP : 0;
    const authorityN = dpMax > 0 ? dpMax / (dpMax + pSysVar) : 1.0;
    const gainNorm = pNorm.valid ? installedGain(pNorm.open / 100, v.char, authorityN) : 1.0;
    const gainMin = pMin.valid ? installedGain(pMin.open / 100, v.char, authorityN) : 1.0;
    const gainMax = pMax.valid ? installedGain(pMax.open / 100, v.char, authorityN) : 1.0;
    // Normalized segmental gains (% of Q_max per % travel) + raw volumetric flow/travel gains
    const dVT1 = Math.max(0.1, pNorm.open - pMin.open);
    const dVT2 = Math.max(0.1, pMax.open - pNorm.open);
    const segGain1Norm = pMax.W > 0 ? (((pNorm.W - pMin.W) / pMax.W) * 100) / dVT1 : 0;
    const segGain2Norm = pMax.W > 0 ? (((pMax.W - pNorm.W) / pMax.W) * 100) / dVT2 : 0;
    const segGain1Flow = (pNorm.Q - pMin.Q) / dVT1; // m³/h per % travel
    const segGain2Flow = (pMax.Q - pNorm.Q) / dVT2;
    const segMax = Math.max(segGain1Norm, segGain2Norm);
    const segMin = Math.min(segGain1Norm, segGain2Norm);
    const segDiffPct = segMax > 0 ? (Math.abs(segGain2Norm - segGain1Norm) / segMax) * 100 : 0;
    const segGainOk = segDiffPct < 50 && segMin >= 0.50;
    const authorityStatus = authorityN < 0.25 || gainNorm < 0.5 || gainNorm > 3.0 || !segGainOk ? 'WARN' : 'PASS';
    const rangeabilityAuth = appTurndown * Math.sqrt(Math.max(0.05, authorityN)); // M04-034 p. 31 form

    // ASME B16.34 P-T Rating & Mechanical / Instrumentation Advisor (M04-034 §§1, 3, 4)
    const maxP1g = Math.max(num(s.p1Min, 0), num(s.p1Norm, 0), num(s.p1Max, 0));
    const pDes = num(s.designPressBarg, 0) > 0 ? num(s.designPressBarg, 0) : Number((maxP1g * 1.1).toFixed(2));
    const tDes = Number.isFinite(Number(s.designTempC)) && s.designTempC !== '' ? num(s.designTempC, 65) : Math.max(65, num(s.tempC, 35) + 15);
    const rating = calcAsmeB1634(s.bodyMaterial, pDes, tDes, sel.sizeIn);

    const leakKey = LEAKAGE_CLASSES[s.leakageClass] ? s.leakageClass : 'IV';
    const leakInfo = LEAKAGE_CLASSES[leakKey];
    const maxLeakRank = LEAKAGE_CLASSES[v.maxLeak]?.rank || 4;
    const leakCompatOk = leakInfo.rank <= maxLeakRank;
    const maxDp = Math.max(...pts.map(p => p.valid ? p.dP : 0));
    const p2OverP1 = pMax.valid && pMax.P1 > 0 ? pMax.P2 / pMax.P1 : 0;
    const balancedRec = (p2OverP1 > 0.25 && (maxDp > 5 || sel.sizeIn >= 3)) || maxDp > 10;

    // Positioner recommendation (M04-034 p. 14 & Tip #11)
    const posReasons = [];
    if (maxDp > 5) posReasons.push(`ΔP_max = ${maxDp.toFixed(1)} bar > 5 bar`);
    if (reqRange > 10) posReasons.push(`wide rangeability (${reqRange.toFixed(1)}:1)`);
    if (authorityN < 0.5) posReasons.push(`varying ΔP (N = ${authorityN.toFixed(2)})`);
    if (s.fluidService === 'viscous' || s.fluidService === 'slurry') posReasons.push(`${s.fluidService} service friction`);
    posReasons.push('4–20 mA DCS / I/P loop accuracy (Tip #11)');
    const positionerReq = maxDp > 5 || reqRange > 10 || authorityN < 0.5 || s.fluidService === 'viscous' || s.fluidService === 'slurry';

    // Service & Characteristic Advisor (M04-034 pp. 32–35, 57)
    const recChar = s.loopType === 'onoff' ? 'Quick-Opening (On/Off)'
      : (authorityN < 0.35 || s.loopType === 'pressure' || s.loopType === 'temp') ? 'Equal Percentage'
      : 'Linear (or Equal-%)';
    const charMatchOk = s.loopType === 'onoff' ? false : (recChar.startsWith('Equal') ? v.char === 'eqp' : true);
    const serviceWarnings = [];
    if (s.fluidService === 'slurry' && !v.slurryOk) serviceWarnings.push(`${v.label.split(',')[0]} not suited for abrasive slurry (M04-034 p. 35) — consider V-ball or eccentric plug`);
    if (s.fluidService === 'fibrous' && vKey !== 'ball' && vKey !== 'eccentric-plug') serviceWarnings.push('Fibrous solids may plug contoured globe — consider V-port ball or eccentric plug');
    if (!leakCompatOk) serviceWarnings.push(`Requested ${leakInfo.label} exceeds typical ${v.label.split(',')[0]} rating (max Class ${v.maxLeak})`);
    if (s.endConn === 'npt' && sel.sizeIn > 2) serviceWarnings.push('NPT screwed ends are limited to ≤ 2" globe valves (M04-034 Q14)');
    if (s.actuatorType === 'electric' && (s.failAction === 'FO' || s.failAction === 'FC')) serviceWarnings.push('Electric actuator fails in last position on power loss unless battery/spring return is added');
    if (!rangeOk && reqRange > v.R) serviceWarnings.push(`Required rangeability (${reqRange.toFixed(1)}:1) > valve R (${v.R}:1) — consider V-port ball or 2 parallel split-range valves (M04-034 Q6)`);
    if (isLiq && (pts.some(p => p.cavIncipient) || pts.some(p => p.choked))) serviceWarnings.push('Provide straight downstream pipe run before elbows/tees in cavitating service (M04-034 Tip #12)');

    const drainCount = s.failAction === 'FO' ? 1 : 2; // M04-034 p. 52 Guideline #3
    const m04QuickMax = calcM04QuickCv(pMax);

    return {
      state: s, valve: Object.assign({ key: vKey }, v), pipes, options, sel, basis, pts, xFz,
      reqRange, appTurndown, rangeabilityAuth, minControllable, rangeOk, selStatus, regime, regimeText, laminar,
      cvMargin: { rule: cvMarginRule, target: cvMarginTarget, ok: cvMarginOk },
      pipeRatio: { dToD1, ok: pipeRatioOk, note: pipeRatioNote },
      noise: { maxDb: maxNoiseDb, govCase: govNoisePt.label, govRegime: govNoisePt.noise?.regime || '', status: noiseStatus, tier: noiseTier, action: noiseAction },
      exit: { maxVelInMS: maxVelIn, maxVelMS: maxVelOut, maxMachIn, maxMach: maxMachOut, status: exitStatus },
      installed: {
        pSysVarBar: pSysVar, authorityN, gainMin, gainNorm, gainMax,
        segGain1Norm, segGain2Norm, segGain1Flow, segGain2Flow, segDiffPct, segGainOk, status: authorityStatus
      },
      rating,
      mech: {
        leakKey, leakLabel: leakInfo.label, leakDesc: leakInfo.desc, leakCompatOk,
        balancedRec, p2OverP1, maxDp, positionerReq, posReasons,
        failAction: s.failAction, actuatorType: s.actuatorType, endConn: s.endConn,
        hasBypass: !!s.hasBypass, fireSafe: !!s.fireSafe, drainCount,
        recChar, charMatchOk, serviceWarnings
      },
      m04QuickMax
    };
  }

  // ---------------------------------------------------------------- presets
  const presets = [
    { id: 'amine', label: 'LV-3102 Lean amine pump discharge (liquid, globe =%)', state: defaultState() },
    { id: 'ced-ex1', label: 'FCV-0100 CED M04-034 Water Example (150/110/25 GPM, 3" pipe → 2½" =%)', state: Object.assign(defaultState(), {
      tag: 'FCV-0100', service: 'CED M04-034 Worked Example — Pumped Water Loop (150 psi sys)',
      fluid: 'liquid', flowBasis: 'vol', valveType: 'globe-eqp', sizeIn: 0, trimFactor: 1.0,
      pipeMode: 'asme', d1Nps: '3"', d1Sch: 'Sch 40', d2Nps: '3"', d2Sch: 'Sch 40',
      // 25 / 110 / 150 US GPM water @ 70°F (998 kg/m³) -> 5667 / 24934 / 34001 kg/h; ΔP = 15 psi = 1.0342 bar
      wMin: 5667, wNorm: 24934, wMax: 34001,
      p1Min: 11.4, p1Norm: 11.4, p1Max: 11.4, p2Min: 10.3658, p2Norm: 10.3658, p2Max: 10.3658,
      rho: 998.0, pvBara: 0.025, pcBara: 220.64, viscCp: 0.98, tempC: 21.1,
      pSysVarBar: 9.308, // 135 psi piping drop + 15 psi valve = 150 psi total system drop
      bodyMaterial: 'wcb', designPressBarg: 15, designTempC: 50, loopType: 'flow', fluidService: 'clean', leakageClass: 'IV', failAction: 'FC' }) },
    { id: 'fuelgas', label: 'PV-2101 Fuel-gas letdown 40→25 barg (gas, globe linear)', state: Object.assign(defaultState(), {
      tag: 'PV-2101', service: 'Fuel Gas Header Pressure Letdown',
      fluid: 'gas', flowBasis: 'mass', valveType: 'globe-lin', pipeMode: 'asme', d1Nps: '3"', d1Sch: 'Sch 40', d2Nps: '4"', d2Sch: 'Sch 40',
      wMin: 1800, wNorm: 5200, wMax: 6800, p1Min: 41, p1Norm: 40, p1Max: 39, p2Min: 25, p2Norm: 25, p2Max: 25,
      tempC: 35, mw: 18.6, k: 1.27, z: 0.92, viscCp: 0.012, pSysVarBar: 0.8,
      bodyMaterial: 'wcb', designPressBarg: 46, designTempC: 80, loopType: 'pressure', failAction: 'FC', fireSafe: true }) },
    { id: 'propane', label: 'LV-2004 C3 reflux near bubble point (liquid, cavitation)', state: Object.assign(defaultState(), {
      tag: 'LV-2004', service: 'Propane Reflux Drum Level Control',
      fluid: 'liquid', flowBasis: 'mass', valveType: 'globe-eqp', pipeMode: 'asme', d1Nps: '6"', d1Sch: 'Sch 40', d2Nps: '6"', d2Sch: 'Sch 40',
      wMin: 60000, wNorm: 150000, wMax: 175000, p1Min: 21.5, p1Norm: 20.8, p1Max: 20.5, p2Min: 16.0, p2Norm: 16.6, p2Max: 16.9,
      rho: 470, pvBara: 16.4, pcBara: 42.5, viscCp: 0.08, pSysVarBar: 1.5,
      bodyMaterial: 'wcb', designPressBarg: 26, designTempC: 65, loopType: 'level', failAction: 'FO', fireSafe: true }) },
    { id: 'steam', label: 'TV-0510 LP steam to reboiler (steam, butterfly)', state: Object.assign(defaultState(), {
      tag: 'TV-0510', service: 'LP Steam Supply to Amine Reboiler E-1002',
      fluid: 'steam', flowBasis: 'mass', valveType: 'butterfly', pipeMode: 'asme', d1Nps: '8"', d1Sch: 'Sch 40', d2Nps: '8"', d2Sch: 'Sch 40',
      wMin: 3000, wNorm: 9000, wMax: 11000, p1Min: 4.5, p1Norm: 4.3, p1Max: 4.2, p2Min: 3.2, p2Norm: 3.3, p2Max: 3.4,
      tempC: 165, steamSaturated: false, pSysVarBar: 0.3,
      bodyMaterial: 'wcb', designPressBarg: 8, designTempC: 200, loopType: 'temp', leakageClass: 'III', failAction: 'FC' }) },
    { id: 'hpsteam', label: 'PV-0520 HP steam letdown 42→10 barg (steam, low-noise cage)', state: Object.assign(defaultState(), {
      tag: 'PV-0520', service: 'HP to MP Steam Header Letdown Station',
      fluid: 'steam', flowBasis: 'mass', valveType: 'globe-lownoise', pipeMode: 'asme', d1Nps: '4"', d1Sch: 'Sch 80', d2Nps: '6"', d2Sch: 'Sch 80',
      wMin: 4500, wNorm: 14000, wMax: 18500, p1Min: 43.0, p1Norm: 42.0, p1Max: 41.0, p2Min: 10.0, p2Norm: 10.0, p2Max: 10.0,
      tempC: 365, steamSaturated: false, pSysVarBar: 1.0,
      bodyMaterial: 'wc9', designPressBarg: 50, designTempC: 400, loopType: 'pressure', leakageClass: 'IV', failAction: 'FC' }) }
  ];

  // ---------------------------------------------------------------- UI helpers
  const UNITS = {
    flow: { si: 'kg/h', usc: 'lb/h', to: v => v * KG_LB, from: v => v / KG_LB },
    pg: { si: 'barg', usc: 'psig', to: v => v * BAR_PSI, from: v => v / BAR_PSI },
    pa: { si: 'bara', usc: 'psia', to: v => v * BAR_PSI, from: v => v / BAR_PSI },
    dp: { si: 'bar', usc: 'psi', to: v => v * BAR_PSI, from: v => v / BAR_PSI },
    temp: { si: '°C', usc: '°F', to: v => v * 9 / 5 + 32, from: v => (v - 32) * 5 / 9 },
    dens: { si: 'kg/m³', usc: 'lb/ft³', to: v => v * KGM3_LBFT3, from: v => v / KGM3_LBFT3 },
    mm: { si: 'mm', usc: 'in', to: v => v / 25.4, from: v => v * 25.4 },
    cp: { si: 'cP', usc: 'cP', to: v => v, from: v => v },
    none: { si: '', usc: '', to: v => v, from: v => v }
  };
  const fmt = (v, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
  const fmtSig = (v, sig = 4) => {
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) return v.toExponential(sig - 1);
    return v.toFixed(Math.max(0, sig - 1 - Math.floor(Math.log10(a))));
  };
  const sizeLabel = (inch) => {
    const map = { 0.5: '½"', 0.75: '¾"', 1.25: '1¼"', 1.5: '1½"', 2.5: '2½"' };
    return map[inch] || (inch + '"');
  };
  const badge = (st, text) => `<span class="status-badge status-${st === 'PASS' ? 'pass' : st === 'WARN' ? 'warn' : 'fail'}">${text}</span>`;

  let state = defaultState();
  let activeVisTab = 'curves'; // 'curves' | 'vena' | 'pid'
  let root = null, ctx = null;
  const usc = () => !!(ctx && ctx.isUSC && ctx.isUSC());
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uLab = (k) => (usc() ? UNITS[k].usc : UNITS[k].si);
  const disp = (k, v, dp) => fmt(usc() ? UNITS[k].to(v) : v, dp);
  const inVal = (k, v) => { const x = usc() ? UNITS[k].to(num(v, 0)) : num(v, 0); return String(Number(x.toPrecision(6))); };
  const withU = (k, v, dp) => `${disp(k, v, dp)} ${uLab(k)}`;

  // Flow basis display conversions (canonical state always stays kg/h!)
  function flowUnitLabel() {
    if (state.flowBasis === 'vol' && state.fluid === 'liquid') return usc() ? 'GPM' : 'm³/h';
    if (state.flowBasis === 'vol' && state.fluid === 'gas') return usc() ? 'SCFH' : 'Nm³/h';
    return uLab('flow');
  }
  function flowToDisp(wKgHr) {
    const w = num(wKgHr, 0);
    if (state.flowBasis === 'vol' && state.fluid === 'liquid') {
      const m3hr = w / Math.max(1, num(state.rho, 1000));
      return usc() ? m3hr * M3HR_TO_GPM : m3hr;
    }
    if (state.flowBasis === 'vol' && state.fluid === 'gas') {
      const M = Math.max(1, num(state.mw, 20));
      return usc() ? (w * KG_LB / M) * SCF_PER_LBMOL : (w / M) * NM3_PER_KMOL;
    }
    return usc() ? w * KG_LB : w;
  }
  function flowFromDisp(val) {
    const x = num(val, 0);
    if (state.flowBasis === 'vol' && state.fluid === 'liquid') {
      const m3hr = usc() ? x / M3HR_TO_GPM : x;
      return m3hr * Math.max(1, num(state.rho, 1000));
    }
    if (state.flowBasis === 'vol' && state.fluid === 'gas') {
      const M = Math.max(1, num(state.mw, 20));
      return usc() ? ((x / SCF_PER_LBMOL) * M) / KG_LB : (x / NM3_PER_KMOL) * M;
    }
    return usc() ? x / KG_LB : x;
  }

  const STYLE = `
#toolPane-control-valve .cv-grid{display:grid;grid-template-columns:minmax(345px,0.92fr) minmax(420px,1.08fr);gap:1.1rem;align-items:start}
#toolPane-control-valve .cv-metrics{display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-bottom:0.8rem}
#toolPane-control-valve .cv-optable{width:100%;border-collapse:collapse;font-size:0.76rem;margin-bottom:0.8rem}
#toolPane-control-valve .cv-optable th{font-weight:700;color:var(--text-secondary);text-align:left;padding:0.2rem 0.25rem;white-space:nowrap}
#toolPane-control-valve .cv-optable td{padding:0.2rem 0.25rem}
#toolPane-control-valve .cv-optable input{width:100%;min-width:0;box-sizing:border-box;padding:0.35rem 0.45rem;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary)}
#toolPane-control-valve .cv-svgbox{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0.45rem;margin-bottom:0.7rem;color:var(--text-secondary);overflow-x:auto;-webkit-overflow-scrolling:touch}
#toolPane-control-valve .cv-svgbox svg{width:100%;height:auto;display:block}
#toolPane-control-valve .cv-trace{display:flex;flex-direction:column;gap:0.6rem}
#toolPane-control-valve .cv-note{font-size:0.72rem;color:var(--text-muted);line-height:1.45;margin-top:0.5rem}
#toolPane-control-valve .cv-head-ctrls{display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap}
#toolPane-control-valve .cv-msg{font-size:0.72rem;color:var(--accent-primary);font-weight:600}
#toolPane-control-valve .cv-section{font-size:0.73rem;font-weight:700;color:var(--text-secondary);margin:0.6rem 0 0.35rem;text-transform:uppercase;letter-spacing:0.03em;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap}
#toolPane-control-valve .cv-action-bar{display:flex;gap:0.45rem;flex-wrap:wrap;padding:0.6rem 0.75rem;margin-bottom:0.85rem;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);align-items:center;justify-content:space-between}
#toolPane-control-valve .cv-pipe-pair{display:grid;grid-template-columns:1fr 1fr;gap:0.35rem}
#toolPane-control-valve .cv-custom-box{margin-top:0.45rem;padding:0.55rem 0.65rem;border:1px dashed var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-elevated)}
#toolPane-control-valve .cv-vis-tabs{margin-bottom:0.65rem}
#toolPane-control-valve .cv-advisory{margin-top:0.55rem;padding:0.55rem 0.7rem;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);background:var(--bg-elevated);font-size:0.74rem;line-height:1.45}
#toolPane-control-valve .cv-advisory-warn{border-left:3px solid var(--warn-dot);color:var(--warn-text)}
#toolPane-control-valve .metric-box-sub .status-badge{white-space:normal}
@media (max-width:1100px){#toolPane-control-valve .cv-grid{grid-template-columns:1fr}}
@media (max-width:768px){
  #toolPane-control-valve .cv-metrics{grid-template-columns:1fr}
  #toolPane-control-valve .cv-optable input{font-size:16px}
  #toolPane-control-valve .cv-svgbox svg{min-width:440px}
}`;

  function field(key, label, sym, kind) {
    return `<div class="field-group">
      <label class="field-label" for="control-valve-${key}"><span>${label}</span><span class="field-sym">${sym}</span></label>
      <div class="input-with-unit"><input type="number" id="control-valve-${key}" data-key="${key}" data-u="${kind}" step="any" value="${inVal(kind, state[key])}" />${kind !== 'none' ? `<span class="unit-addon">${uLab(kind)}</span>` : ''}</div>
    </div>`;
  }

  function pipeSelects(prefix, label, sym) {
    const npsKey = prefix + 'Nps', schKey = prefix + 'Sch';
    return `<div class="field-group">
      <label class="field-label"><span>${label}</span><span class="field-sym">${sym}</span></label>
      <div class="cv-pipe-pair">
        <select id="control-valve-${npsKey}" data-key="${npsKey}" aria-label="${label} NPS">
          ${PIPE_SCHEDULES.map(p => `<option value="${esc(p.nps)}" ${p.nps === state[npsKey] ? 'selected' : ''}>NPS ${esc(p.nps)}</option>`).join('')}
        </select>
        <select id="control-valve-${schKey}" data-key="${schKey}" aria-label="${label} Schedule">
          ${PIPE_SCHEDULE_KEYS.map(k => `<option value="${esc(k)}" ${k === state[schKey] ? 'selected' : ''}>${esc(k)}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }

  function render() {
    if (!root) return;
    const isLiq = state.fluid === 'liquid', isSteam = state.fluid === 'steam', isGas = state.fluid === 'gas';
    const v = VALVES[state.valveType] || VALVES['globe-eqp'];
    const cell = (key, kind) => `<td><input type="number" class="mono" id="control-valve-${key}" data-key="${key}" data-u="${kind}" step="any" value="${inVal(kind, state[key])}" /></td>`;
    const flowCell = (key) => `<td><input type="number" class="mono" id="control-valve-${key}" data-flowkey="${key}" step="any" value="${String(Number(flowToDisp(state[key]).toPrecision(5)))}" /></td>`;
    const isAsme = state.pipeMode !== 'custom';
    const volAllowed = isLiq || isGas;
    if (!volAllowed && state.flowBasis === 'vol') state.flowBasis = 'mass';
    root.innerHTML = `
    <div class="panel" style="margin-bottom:1rem;">
      <div class="panel-header">
        <div>
          <div class="panel-title">Control Valve Sizing &amp; Selection Workbench (IEC 60534 / ASME B16.34 / ISA-20)</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">Liquid, Gas &amp; Steam Cv/Kv · ASME B36.10M D₁/D₂ · B16.34 Class Rating · IEC 60534-8-3/-8-4 Noise · Vena Contracta &amp; ISA P&amp;ID</div>
        </div>
        <div class="cv-head-ctrls">
          <label for="control-valve-preset" style="font-size:0.76rem;font-weight:700;color:var(--text-secondary);">Preset:</label>
          <select id="control-valve-preset" class="header-select" style="background:var(--bg-surface);color:var(--text-primary);border-color:var(--border-strong);">
            <option value="">Select preset…</option>
            ${presets.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}
          </select>
          <button type="button" id="control-valve-open-ipds" class="btn btn-primary" title="Open printable 4-section ISA-20 Control Valve Datasheet in Step 5">ISA-20 Datasheet / PDF →</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="cv-action-bar">
          <div class="cv-head-ctrls">
            <button type="button" id="control-valve-pull-pump" class="btn btn-secondary" title="Pre-fill liquid flows, CV ΔP allocation, pipe schedule & system friction from Step 4 Pump Hydraulics">⇐ Pull Step 4 Pump</button>
            <button type="button" id="control-valve-pull-eos" class="btn btn-secondary" title="Pull fluid MW, k, Z or liquid density from Peng-Robinson EOS (Step 7)">⇐ Pull EOS Fluid</button>
            <button type="button" id="control-valve-send-step1d" class="btn btn-secondary" title="Push rated Cv, xT/FL & inlet pressure to Step 1D (CV Fail-Open PSV Relief)">⇒ Send to Step 1D (CV Fail-Open PSV)</button>
          </div>
          <span id="control-valve-msg" class="cv-msg"></span>
        </div>

        <div class="cv-grid">
          <div>
            <div class="cv-section"><span>1. Service &amp; Operating Envelope (Min / Normal / Max)</span></div>
            <div class="form-grid-2" style="margin-bottom:0.55rem;">
              <div class="field-group">
                <label class="field-label" for="control-valve-tag"><span>Valve Tag</span><span class="field-sym">Tag</span></label>
                <div class="input-with-unit"><input type="text" id="control-valve-tag" data-key="tag" class="mono" value="${esc(state.tag)}" /></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-service"><span>Service Description</span><span class="field-sym">Desc</span></label>
                <div class="input-with-unit"><input type="text" id="control-valve-service" data-key="service" value="${esc(state.service || '')}" /></div>
              </div>
            </div>
            <div class="form-grid-2" style="margin-bottom:0.6rem;">
              <div class="field-group">
                <label class="field-label"><span>Fluid Phase</span><span class="field-sym">IEC 60534-2-1</span></label>
                <div class="segmented-control">
                  <button type="button" class="seg-btn ${isLiq ? 'active' : ''}" id="control-valve-fluid-liquid" data-fluid="liquid">Liquid</button>
                  <button type="button" class="seg-btn ${isGas ? 'active' : ''}" id="control-valve-fluid-gas" data-fluid="gas">Gas</button>
                  <button type="button" class="seg-btn ${isSteam ? 'active' : ''}" id="control-valve-fluid-steam" data-fluid="steam">Steam</button>
                </div>
              </div>
              <div class="field-group">
                <label class="field-label"><span>Flow Input Basis</span><span class="field-sym">${volAllowed ? (isLiq ? 'Mass / GPM' : 'Mass / SCFH') : 'Mass'}</span></label>
                <div class="segmented-control">
                  <button type="button" class="seg-btn ${state.flowBasis === 'mass' ? 'active' : ''}" id="control-valve-basis-mass" data-flowbasis="mass">Mass (${uLab('flow')})</button>
                  ${volAllowed ? `<button type="button" class="seg-btn ${state.flowBasis === 'vol' ? 'active' : ''}" id="control-valve-basis-vol" data-flowbasis="vol">Vol (${isLiq ? (usc() ? 'GPM' : 'm³/h') : (usc() ? 'SCFH' : 'Nm³/h')})</button>` : ''}
                </div>
              </div>
            </div>
            <table class="cv-optable">
              <thead><tr><th></th><th>Min</th><th>Normal</th><th>Max</th></tr></thead>
              <tbody>
                <tr><th>${state.flowBasis === 'vol' ? 'Q' : 'W'} [${flowUnitLabel()}]</th>${flowCell('wMin')}${flowCell('wNorm')}${flowCell('wMax')}</tr>
                <tr><th>P₁ [${uLab('pg')}]</th>${cell('p1Min', 'pg')}${cell('p1Norm', 'pg')}${cell('p1Max', 'pg')}</tr>
                <tr><th>P₂ [${uLab('pg')}]</th>${cell('p2Min', 'pg')}${cell('p2Norm', 'pg')}${cell('p2Max', 'pg')}</tr>
              </tbody>
            </table>

            <div class="cv-section"><span>2. Valve Body, Trim &amp; ASME B36.10M Piping</span></div>
            <div class="form-grid-2" style="margin-bottom:0.55rem;">
              <div class="field-group">
                <label class="field-label" for="control-valve-valveType"><span>Valve Style &amp; Trim</span><span class="field-sym">FL·xT·Fd</span></label>
                <div class="input-with-unit"><select id="control-valve-valveType" data-key="valveType">
                  ${Object.entries(VALVES).map(([k, o]) => `<option value="${k}" ${k === state.valveType ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-sizeIn"><span>Body Size (½"–12")</span><span class="field-sym">d</span></label>
                <div class="input-with-unit"><select id="control-valve-sizeIn" data-key="sizeIn">
                  <option value="0">Auto-select (50–80% norm, d ≥ ½D₁)</option>
                  ${SIZES_IN.map((s, i) => v.cv[i] ? `<option value="${s}" ${s === Number(state.sizeIn) ? 'selected' : ''}>${sizeLabel(s)} (DN${SIZES_MM[i]})</option>` : '').join('')}
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-trimFactor"><span>Trim Port Capacity</span><span class="field-sym">Trim %</span></label>
                <div class="input-with-unit"><select id="control-valve-trimFactor" data-key="trimFactor">
                  ${TRIM_FACTORS.map(tf => `<option value="${tf.val}" ${Math.abs(tf.val - num(state.trimFactor, 1)) < 0.01 ? 'selected' : ''}>${esc(tf.label)}</option>`).join('')}
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-pipeMode"><span>Pipe Sizing Basis</span><span class="field-sym">B36.10M</span></label>
                <div class="input-with-unit"><select id="control-valve-pipeMode" data-key="pipeMode">
                  <option value="asme" ${isAsme ? 'selected' : ''}>ASME B36.10M / B36.19M</option>
                  <option value="custom" ${!isAsme ? 'selected' : ''}>Custom ID (mm / in)</option>
                </select></div>
              </div>
              ${isAsme
                ? pipeSelects('d1', 'Upstream Pipe (Inlet)', 'D₁') + pipeSelects('d2', 'Downstream Pipe (Outlet)', 'D₂')
                : field('d1Mm', 'Upstream Pipe ID', 'D₁', 'mm') + field('d2Mm', 'Downstream Pipe ID', 'D₂', 'mm')}
              ${field('pSysVarBar', 'System Variable ΔP @ Max', 'ΔP_sys', 'dp')}
              ${isSteam ? '' : field('viscCp', 'Dynamic Viscosity', 'μ', 'cp')}
            </div>

            <div class="cv-custom-box">
              <label style="display:flex;align-items:center;gap:0.45rem;font-size:0.76rem;font-weight:600;cursor:pointer;">
                <input type="checkbox" id="control-valve-customVendor" ${state.customVendor ? 'checked' : ''} />
                <span>Override with certified vendor data (Fisher / Masoneilan / Samson C<sub>v,rated</sub>, F<sub>L</sub>, x<sub>T</sub>, F<sub>d</sub>)</span>
              </label>
              ${state.customVendor ? `<div class="form-grid-2" style="margin-top:0.5rem;">
                ${field('customCrated', 'Vendor Rated Cv', 'Cv,r', 'none')}
                ${field('customFL', 'Recovery Factor', 'FL', 'none')}
                ${field('customXT', 'Pressure Drop Ratio', 'xT', 'none')}
                ${field('customFd', 'Style Modifier', 'Fd', 'none')}
              </div>` : ''}
            </div>

            <div class="cv-section"><span>3. ${isLiq ? 'Liquid Physical Properties' : (isSteam ? 'Steam Conditions (IAPWS-IF97 Auto-Properties)' : 'Gas / Vapour Properties')}</span></div>
            <div class="form-grid-2">
              ${isLiq
                ? field('rho', 'Density at Inlet', 'ρ₁', 'dens') + field('pvBara', 'Vapour Pressure', 'p_v', 'pa') + field('pcBara', 'Critical Pressure', 'p_c', 'pa')
                : isSteam
                  ? `<div class="field-group">
                      <label class="field-label"><span>Steam State</span><span class="field-sym">IF97</span></label>
                      <label style="display:flex;align-items:center;gap:0.45rem;font-size:0.78rem;padding:0.45rem 0.5rem;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);cursor:pointer;">
                        <input type="checkbox" id="control-valve-steamSaturated" ${state.steamSaturated ? 'checked' : ''} />
                        <span>Dry Saturated Steam (T₁ = T<sub>sat</sub>)</span>
                      </label>
                    </div>` + (state.steamSaturated ? '' : field('tempC', 'Inlet Steam Temp.', 'T₁', 'temp'))
                  : field('tempC', 'Inlet Temperature', 'T₁', 'temp') + field('mw', 'Molar Mass', 'M', 'none') + field('k', 'Specific Heat Ratio', 'γ', 'none') + field('z', 'Compressibility', 'Z₁', 'none')}
              ${field('atmBara', 'Atmospheric Pressure', 'p_atm', 'pa')}
            </div>

            <div class="cv-section"><span>4. Mechanical Rating (ASME B16.34), Leakage, Actuator &amp; P&amp;ID</span></div>
            <div class="form-grid-2">
              <div class="field-group">
                <label class="field-label" for="control-valve-bodyMaterial"><span>Body Material</span><span class="field-sym">B16.34</span></label>
                <div class="input-with-unit"><select id="control-valve-bodyMaterial" data-key="bodyMaterial">
                  ${Object.entries(B1634_MATERIALS).map(([k, o]) => `<option value="${k}" ${k === state.bodyMaterial ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-leakageClass"><span>Shut-Off Leakage Class</span><span class="field-sym">FCI 70-2</span></label>
                <div class="input-with-unit"><select id="control-valve-leakageClass" data-key="leakageClass">
                  ${Object.entries(LEAKAGE_CLASSES).map(([k, o]) => `<option value="${k}" ${k === state.leakageClass ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                </select></div>
              </div>
              ${field('designPressBarg', 'Design Pressure (0 = auto)', 'P_des', 'pg')}
              ${field('designTempC', 'Design Temperature', 'T_des', 'temp')}
              <div class="field-group">
                <label class="field-label" for="control-valve-loopType"><span>Control Loop Type</span><span class="field-sym">Loop</span></label>
                <div class="input-with-unit"><select id="control-valve-loopType" data-key="loopType">
                  <option value="flow" ${state.loopType === 'flow' ? 'selected' : ''}>Flow Control (FIC)</option>
                  <option value="level" ${state.loopType === 'level' ? 'selected' : ''}>Level Control (LIC)</option>
                  <option value="pressure" ${state.loopType === 'pressure' ? 'selected' : ''}>Pressure Control (PIC)</option>
                  <option value="temp" ${state.loopType === 'temp' ? 'selected' : ''}>Temperature Control (TIC)</option>
                  <option value="onoff" ${state.loopType === 'onoff' ? 'selected' : ''}>On / Off Isolation (XV)</option>
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-fluidService"><span>Fluid Service / Solids</span><span class="field-sym">Medium</span></label>
                <div class="input-with-unit"><select id="control-valve-fluidService" data-key="fluidService">
                  <option value="clean" ${state.fluidService === 'clean' ? 'selected' : ''}>Clean Liquid / Gas / Steam</option>
                  <option value="corrosive" ${state.fluidService === 'corrosive' ? 'selected' : ''}>Corrosive / Chemical</option>
                  <option value="viscous" ${state.fluidService === 'viscous' ? 'selected' : ''}>Viscous / Gummy</option>
                  <option value="fibrous" ${state.fluidService === 'fibrous' ? 'selected' : ''}>Fibrous / Suspended Solids</option>
                  <option value="slurry" ${state.fluidService === 'slurry' ? 'selected' : ''}>Abrasive Slurry</option>
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-actuatorType"><span>Actuator Type</span><span class="field-sym">Actuator</span></label>
                <div class="input-with-unit"><select id="control-valve-actuatorType" data-key="actuatorType">
                  <option value="pneumatic-diaphragm" ${state.actuatorType === 'pneumatic-diaphragm' ? 'selected' : ''}>Pneumatic Spring-Diaphragm</option>
                  <option value="pneumatic-piston" ${state.actuatorType === 'pneumatic-piston' ? 'selected' : ''}>Pneumatic Piston-Cylinder</option>
                  <option value="electric" ${state.actuatorType === 'electric' ? 'selected' : ''}>Electric Motor / Servo</option>
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-failAction"><span>Fail-Safe Action</span><span class="field-sym">P&amp;ID</span></label>
                <div class="input-with-unit"><select id="control-valve-failAction" data-key="failAction">
                  <option value="FC" ${state.failAction === 'FC' ? 'selected' : ''}>FC — Fail Closed (Air-to-Open)</option>
                  <option value="FO" ${state.failAction === 'FO' ? 'selected' : ''}>FO — Fail Open (Air-to-Close)</option>
                  <option value="FL" ${state.failAction === 'FL' ? 'selected' : ''}>FL — Fail Last / Locked</option>
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-endConn"><span>End Connections</span><span class="field-sym">Flange</span></label>
                <div class="input-with-unit"><select id="control-valve-endConn" data-key="endConn">
                  <option value="rf-flanged" ${state.endConn === 'rf-flanged' ? 'selected' : ''}>Raised Face Flanged (RF)</option>
                  <option value="rtj-flanged" ${state.endConn === 'rtj-flanged' ? 'selected' : ''}>Ring-Type Joint (RTJ)</option>
                  <option value="butt-weld" ${state.endConn === 'butt-weld' ? 'selected' : ''}>Butt-Weld Ends (BW)</option>
                  <option value="wafer" ${state.endConn === 'wafer' ? 'selected' : ''}>Flangeless Wafer / Lug</option>
                  <option value="npt" ${state.endConn === 'npt' ? 'selected' : ''}>Screwed NPT / SW (≤ 2")</option>
                </select></div>
              </div>
              <div class="field-group" style="display:flex;flex-direction:column;justify-content:center;gap:0.35rem;padding-top:0.3rem;">
                <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.76rem;cursor:pointer;">
                  <input type="checkbox" id="control-valve-hasBypass" ${state.hasBypass ? 'checked' : ''} /> <span>Manual Block &amp; Bypass Station</span>
                </label>
                <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.76rem;cursor:pointer;">
                  <input type="checkbox" id="control-valve-fireSafe" ${state.fireSafe ? 'checked' : ''} /> <span>Fire-Safe Metal / Tandem Seat</span>
                </label>
              </div>
            </div>
            <div id="control-valve-advisory"></div>
          </div>

          <div>
            <div class="cv-metrics" id="control-valve-metrics"></div>
            <div class="segmented-control cv-vis-tabs" role="tablist" aria-label="Control valve visual diagrams">
              <button type="button" class="seg-btn ${activeVisTab === 'curves' ? 'active' : ''}" id="cvVisTabCurves" data-vistab="curves">Cv &amp; Installed Curves</button>
              <button type="button" class="seg-btn ${activeVisTab === 'vena' ? 'active' : ''}" id="cvVisTabVena" data-vistab="vena">Vena Contracta Profile</button>
              <button type="button" class="seg-btn ${activeVisTab === 'pid' ? 'active' : ''}" id="cvVisTabPid" data-vistab="pid">ISA P&amp;ID Station</button>
            </div>
            <div id="cvVisPaneCurves" style="${activeVisTab === 'curves' ? '' : 'display:none;'}">
              <div class="cv-svgbox" id="control-valve-plot"></div>
              <div class="cv-svgbox" id="control-valve-installed-plot"></div>
              <div class="cv-svgbox" id="control-valve-indicator"></div>
            </div>
            <div id="cvVisPaneVena" style="${activeVisTab === 'vena' ? '' : 'display:none;'}">
              <div class="cv-svgbox" id="control-valve-vena-plot"></div>
            </div>
            <div id="cvVisPanePid" style="${activeVisTab === 'pid' ? '' : 'display:none;'}">
              <div class="cv-svgbox" id="control-valve-pid-plot"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Whitebox Engineering Calculation Trace &amp; Segmental Gain Table</div><span class="panel-std-ref">IEC 60534-2-1 · 60534-8-3/-8-4 · ASME B16.34 · CED M04-034</span></div>
      <div class="panel-body">
        <div id="control-valve-table" style="overflow-x:auto;margin-bottom:0.8rem;"></div>
        <div id="control-valve-gain-table" style="overflow-x:auto;margin-bottom:0.8rem;"></div>
        <div class="cv-trace" id="control-valve-trace"></div>
      </div>
    </div>`;
    bind();
    renderOutputs();
  }

  function bind() {
    root.querySelectorAll('input[data-flowkey]').forEach(inp => {
      const h = () => {
        const x = Number(inp.value);
        if (inp.value === '' || !Number.isFinite(x)) return;
        state[inp.dataset.flowkey] = flowFromDisp(x);
        renderOutputs();
      };
      inp.addEventListener('input', h); inp.addEventListener('change', h);
    });
    root.querySelectorAll('input[data-key]').forEach(inp => {
      const h = () => {
        const key = inp.dataset.key;
        if (inp.type === 'text') state[key] = inp.value.slice(0, 80);
        else {
          const x = Number(inp.value);
          if (inp.value === '' || !Number.isFinite(x)) return;
          const u = UNITS[inp.dataset.u] || UNITS.none;
          state[key] = usc() ? u.from(x) : x;
          if (key === 'd1Mm') state.pipeIdMm = state.d1Mm;
        }
        renderOutputs();
      };
      inp.addEventListener('input', h); inp.addEventListener('change', h);
    });
    root.querySelectorAll('select[data-key]').forEach(sel => sel.addEventListener('change', () => {
      const k = sel.dataset.key;
      state[k] = (k === 'sizeIn' || k === 'trimFactor') ? Number(sel.value) : sel.value;
      if (k === 'valveType') { state.sizeIn = 0; render(); }
      else if (k === 'pipeMode') {
        if (state.pipeMode === 'custom') {
          const p1 = lookupPipe(state.d1Nps, state.d1Sch), p2 = lookupPipe(state.d2Nps, state.d2Sch);
          state.d1Mm = p1.idMm; state.d2Mm = p2.idMm; state.pipeIdMm = p1.idMm;
        }
        render();
      } else renderOutputs();
    }));
    root.querySelectorAll('[data-fluid]').forEach(b => b.addEventListener('click', () => {
      state.fluid = b.dataset.fluid;
      if (state.fluid === 'steam') { state.flowBasis = 'mass'; if (state.tempC < 120) state.tempC = 185; }
      render();
    }));
    root.querySelectorAll('[data-flowbasis]').forEach(b => b.addEventListener('click', () => {
      state.flowBasis = b.dataset.flowbasis;
      render();
    }));
    root.querySelectorAll('[data-vistab]').forEach(b => b.addEventListener('click', () => {
      activeVisTab = b.dataset.vistab;
      root.querySelectorAll('[data-vistab]').forEach(x => x.classList.toggle('active', x.dataset.vistab === activeVisTab));
      const map = { curves: 'cvVisPaneCurves', vena: 'cvVisPaneVena', pid: 'cvVisPanePid' };
      Object.entries(map).forEach(([k, id]) => { const el = root.querySelector('#' + id); if (el) el.style.display = k === activeVisTab ? '' : 'none'; });
    }));
    const cbCustom = root.querySelector('#control-valve-customVendor');
    if (cbCustom) cbCustom.addEventListener('change', () => {
      state.customVendor = cbCustom.checked;
      if (state.customVendor) {
        const res = calc(Object.assign({}, state, { customVendor: false }));
        state.customCrated = Number((res.sel.Crated || 100).toFixed(1));
        state.customFL = res.valve.FL; state.customXT = res.valve.xT; state.customFd = res.valve.Fd;
      }
      render();
    });
    const cbSat = root.querySelector('#control-valve-steamSaturated');
    if (cbSat) cbSat.addEventListener('change', () => { state.steamSaturated = cbSat.checked; render(); });
    const cbBypass = root.querySelector('#control-valve-hasBypass');
    if (cbBypass) cbBypass.addEventListener('change', () => { state.hasBypass = cbBypass.checked; renderOutputs(); });
    const cbFire = root.querySelector('#control-valve-fireSafe');
    if (cbFire) cbFire.addEventListener('change', () => { state.fireSafe = cbFire.checked; renderOutputs(); });

    const ps = root.querySelector('#control-valve-preset');
    ps.addEventListener('change', () => {
      const p = presets.find(x => x.id === ps.value);
      if (p) { tool.setState(JSON.parse(JSON.stringify(p.state))); const n = root.querySelector('#control-valve-preset'); if (n) n.value = p.id; }
    });
    root.querySelector('#control-valve-pull-pump').addEventListener('click', pullFromPump);
    root.querySelector('#control-valve-pull-eos').addEventListener('click', pullFromEos);
    root.querySelector('#control-valve-send-step1d').addEventListener('click', sendToStep1D);
    root.querySelector('#control-valve-open-ipds').addEventListener('click', () => {
      if (ctx && ctx.openCvIpds) ctx.openCvIpds();
      else if (ctx && ctx.switchTab) ctx.switchTab('tab-ipds');
    });
  }

  function setMsg(text) {
    const m = root && root.querySelector('#control-valve-msg');
    if (m) m.textContent = text;
  }

  function pullFromPump() {
    let r = null;
    try { r = ctx && ctx.getPumpResult ? ctx.getPumpResult() : null; } catch (e) { r = null; }
    if (!r || !r.controlValve || !r.suction) { setMsg('Step 4 pump result unavailable.'); return; }
    const g = 9.80665, rho = num(r.rhoKgM3, 1000), cv = r.controlValve, Qr = Math.max(1e-6, num(r.Q_ratedM3Hr, 1));
    const dis = r.discharge || {}, suc = r.suction;
    const p1 = (pt) => {
      const q2 = Math.pow(num(pt.flowM3Hr, 0) / Qr, 2);
      const psuc = num(suc.nozzleBarg, 0) + num(suc.dP_totalBar, 0) * (1 - q2);
      return psuc + num(pt.pumpHeadM, 0) * rho * g / 1e5 - (num(dis.dP_equipBar, 0) + 0.5 * num(dis.dP_pipeBar, 0)) * q2;
    };
    const disNps = PIPE_SCHEDULES.some(x => x.nps === dis.nps) ? dis.nps : state.d1Nps;
    const disSch = PIPE_SCHEDULE_KEYS.includes(dis.schedule) ? dis.schedule : 'Sch 40';
    const pSysVar = Math.max(0, num(dis.dP_pipeBar, 0) + num(dis.dP_equipBar, 0) + num(suc.dP_totalBar, 0));
    const next = Object.assign({}, state, {
      tag: r.pumpTag ? `FCV-${String(r.pumpTag).replace(/^P-?/i, '')}` : state.tag,
      service: r.service ? `${r.service} (Discharge CV)` : state.service,
      fluid: 'liquid', rho, viscCp: num(r.viscCp, state.viscCp), pvBara: num(r.vaporPressBara, state.pvBara),
      pipeMode: 'asme', d1Nps: disNps, d1Sch: disSch, d2Nps: disNps, d2Sch: disSch,
      pipeIdMm: num(dis.idMm, state.pipeIdMm), sizeIn: 0, pSysVarBar: Number(pSysVar.toFixed(2)),
      designPressBarg: Number(num(r.pump?.maxDischargeBarg, 0).toFixed(1)), designTempC: Number(num(r.tempC, 65).toFixed(0))
    });
    [['Min', cv.min], ['Norm', cv.normal], ['Max', cv.rated]].forEach(([K, pt]) => {
      const P1 = p1(pt || {});
      next['w' + K] = num((pt || {}).flowM3Hr, 0) * rho;
      next['p1' + K] = P1;
      next['p2' + K] = P1 - num((pt || {}).availableCvDpBar, 0);
    });
    tool.setState(next);
    setMsg(`Pulled Step 4 Pump (${disNps} ${disSch}, ΔP_sys = ${withU('dp', pSysVar, 2)}).`);
    if (ctx && ctx.notifyChanged) ctx.notifyChanged();
  }

  function pullFromEos() {
    const fp = (typeof window !== 'undefined' && window.PSVTools && window.PSVTools.get('fluid-props')) || null;
    if (!fp) { setMsg('Peng-Robinson EOS module unavailable.'); return; }
    let r = null;
    try { r = fp.calc(fp.getState()); } catch (_) { r = null; }
    if (!r || !r.ok) { setMsg('EOS flash has no valid result yet.'); return; }
    const next = Object.assign({}, state);
    if (state.fluid === 'liquid' && r.liq) {
      next.rho = Number(r.liq.rho.toFixed(1));
      tool.setState(next);
      setMsg(`Pulled EOS liquid ρ = ${withU('dens', next.rho, 1)}.`);
    } else if (r.vap) {
      next.fluid = 'gas';
      next.mw = Number(r.vap.mw.toFixed(2));
      next.z = Number(r.vap.Z.toFixed(4));
      next.k = Number((r.vap.kIdeal || r.vap.kReal || 1.28).toFixed(3));
      if (Number.isFinite(r.vap.muLGE)) next.viscCp = Number(r.vap.muLGE.toFixed(4));
      if (Number.isFinite(r.T)) next.tempC = Number((r.T - 273.15).toFixed(1));
      tool.setState(next);
      setMsg(`Pulled EOS gas: MW=${next.mw}, k=${next.k}, Z=${next.z}.`);
    } else setMsg('No matching phase in Peng-Robinson EOS.');
    if (ctx && ctx.notifyChanged) ctx.notifyChanged();
  }

  function sendToStep1D() {
    const res = calc(state);
    if (!res.sel || !(res.sel.Crated > 0)) { setMsg('No valid Cv to send.'); return; }
    if (ctx && ctx.applyControlValveToStep1D) {
      const vtMap = { 'globe-lin': 'globe_single', 'globe-eqp': 'globe_single', 'globe-lownoise': 'globe_cage', 'eccentric-plug': 'eccentric_plug', 'butterfly': 'butterfly', 'ball': 'ball_segmented' };
      ctx.applyControlValveToStep1D({
        tag: res.state.tag, ratedCv: Number(res.sel.Crated.toFixed(1)),
        fluidPhase: res.state.fluid === 'liquid' ? 'liquid' : 'gas',
        valveType: vtMap[res.valve.key] || 'globe_single', xT: res.valve.xT, FL: res.valve.FL,
        upstreamPressureBarg: Number(num(res.state.p1Max, res.state.p1Norm).toFixed(2))
      });
      setMsg(`Sent Cv=${res.sel.Crated.toFixed(1)} to Step 1D CV Fail-Open.`);
    } else setMsg('Step 1D bridge unavailable.');
  }

  // ---------------------------------------------------------------- SVG Plots
  function plotSvg(res) {
    const W = 600, H = 260, L = 56, R = 18, T = 24, B = 38, pw = W - L - R, ph = H - T - B;
    const v = res.valve, Cr = res.sel.Crated || 1;
    const X = h => L + h * pw, Yc = c => T + ph - clamp(c / Cr, 0, 1.05) / 1.05 * ph;
    let path = '';
    for (let i = 0; i <= 50; i++) { const h = i / 50; path += `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Yc(cvAtTravel(h, Cr, v.char)).toFixed(1)}`; }
    const grid = [0, 0.2, 0.4, 0.6, 0.8, 1].map(t => `<line x1="${X(t)}" y1="${T}" x2="${X(t)}" y2="${T + ph}" stroke="currentColor" stroke-opacity="0.12"/><text x="${X(t)}" y="${T + ph + 14}" text-anchor="middle" font-size="10" fill="currentColor">${Math.round(t * 100)}</text>`).join('')
      + [0, 0.25, 0.5, 0.75, 1].map(t => `<line x1="${L}" y1="${Yc(t * Cr)}" x2="${L + pw}" y2="${Yc(t * Cr)}" stroke="currentColor" stroke-opacity="0.12"/><text x="${L - 6}" y="${Yc(t * Cr) + 3}" text-anchor="end" font-size="10" fill="currentColor">${fmtSig(t * Cr, 3)}</text>`).join('');
    const colors = { min: '#0ea5e9', norm: '#22c55e', max: '#f97316' };
    const vp = res.pts.filter(p => p.valid);
    const pts = vp.map((p) => {
      const h = clamp(p.open / 100, 0, 1), c = Math.min(p.C, Cr * 1.05);
      return `<circle cx="${X(h).toFixed(1)}" cy="${Yc(c).toFixed(1)}" r="5.5" fill="${colors[p.key]}" stroke="${p.choked ? '#dc2626' : 'currentColor'}" stroke-width="${p.choked ? 2.5 : 1}"/>`;
    }).join('');
    const legend = vp.map((p, i) => `<g transform="translate(${L + 10} ${T + 26 + i * 15})"><circle r="4.5" cx="0" cy="-3.5" fill="${colors[p.key]}" stroke="${p.choked ? '#dc2626' : 'currentColor'}" stroke-width="${p.choked ? 2 : 0.8}"/><text x="9" y="0" font-size="10.2" font-weight="700" fill="currentColor">${p.label}: h = ${fmt(p.open, 0)}%, Cv = ${fmtSig(p.C, 3)}${p.choked ? ' (choked)' : ''}</text></g>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cv versus travel with operating points" id="control-valve-svg-plot">
      <rect x="${X(0.1)}" y="${T}" width="${X(0.9) - X(0.1)}" height="${ph}" fill="rgba(56,189,248,0.08)"/>
      <rect x="${X(0.5)}" y="${T}" width="${X(0.8) - X(0.5)}" height="${ph}" fill="rgba(34,197,94,0.16)"/>
      <text x="${X(0.65)}" y="${T + 12}" text-anchor="middle" font-size="9.5" fill="currentColor">normal 50–80 %</text>
      <text x="${X(0.9) - 4}" y="${T + ph - 6}" text-anchor="end" font-size="9.5" fill="currentColor">operable 10–90 %</text>
      ${grid}
      <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="currentColor" stroke-opacity="0.4"/>
      <path d="${path}" fill="none" stroke="var(--accent-primary)" stroke-width="2.2"/>
      ${pts}${legend}
      <text x="${L + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="currentColor">Travel h [%], ${v.char === 'lin' ? 'linear' : 'equal-% (R = 50)'} inherent characteristic</text>
      <text transform="translate(13 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="10.5" fill="currentColor">Cv</text>
      <text x="${L + pw}" y="${T - 8}" text-anchor="end" font-size="10.2" font-weight="700" fill="currentColor">${esc(sizeLabel(res.sel.sizeIn))} ${esc(v.label.split(',')[0])} (${Math.round(res.sel.trimFactor * 100)}% trim), rated Cv ${fmtSig(Cr, 4)}</text>
    </svg>`;
  }

  function installedSvg(res) {
    const W = 600, H = 205, L = 56, R = 18, T = 24, B = 38, pw = W - L - R, ph = H - T - B;
    const v = res.valve, Nv = res.installed.authorityN;
    const X = h => L + h * pw, Yq = q => T + ph - clamp(q, 0, 1.02) * ph;
    let pathInh = '', pathInst = '', pathQo = '';
    for (let i = 0; i <= 50; i++) {
      const h = i / 50;
      pathInh += `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Yq(installedFlow(h, v.char, 1.0)).toFixed(1)}`;
      pathInst += `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Yq(installedFlow(h, v.char, Nv)).toFixed(1)}`;
      pathQo += `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Yq(Math.sqrt(h)).toFixed(1)}`;
    }
    const grid = [0, 0.25, 0.5, 0.75, 1].map(t =>
      `<line x1="${X(t)}" y1="${T}" x2="${X(t)}" y2="${T + ph}" stroke="currentColor" stroke-opacity="0.1"/>
       <text x="${X(t)}" y="${T + ph + 13}" text-anchor="middle" font-size="9.5" fill="currentColor">${Math.round(t * 100)}%</text>
       <line x1="${L}" y1="${Yq(t)}" x2="${L + pw}" y2="${Yq(t)}" stroke="currentColor" stroke-opacity="0.1"/>
       <text x="${L - 6}" y="${Yq(t) + 3}" text-anchor="end" font-size="9.5" fill="currentColor">${Math.round(t * 100)}%</text>`
    ).join('');
    const pNorm = res.pts[1], hNorm = pNorm.valid ? clamp(pNorm.open / 100, 0, 1) : 0.6;
    const qNorm = installedFlow(hNorm, v.char, Nv);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Inherent versus installed flow characteristic" id="control-valve-svg-installed">
      ${grid}
      <line x1="${X(0)}" y1="${Yq(0)}" x2="${X(1)}" y2="${Yq(1)}" stroke="currentColor" stroke-opacity="0.25" stroke-dasharray="3 3"/>
      <path d="${pathQo}" fill="none" stroke="#94a3b8" stroke-opacity="0.35" stroke-width="1.2" stroke-dasharray="2 3"/>
      <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="currentColor" stroke-opacity="0.35"/>
      <path d="${pathInh}" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="6 4"/>
      <path d="${pathInst}" fill="none" stroke="#10b981" stroke-width="2.4"/>
      <circle cx="${X(hNorm).toFixed(1)}" cy="${Yq(qNorm).toFixed(1)}" r="5" fill="#10b981" stroke="currentColor" stroke-width="1"/>
      <g transform="translate(${L + 10} ${T + 14})">
        <line x1="0" y1="-3" x2="18" y2="-3" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="5 3"/><text x="23" y="0" font-size="9.6" fill="currentColor">Inherent (N = 1.0)</text>
        <line x1="0" y1="12" x2="18" y2="12" stroke="#10b981" stroke-width="2.4"/><text x="23" y="15" font-size="9.6" font-weight="700" fill="currentColor">Installed (N = ${fmt(Nv, 2)}, G_norm = ${fmt(res.installed.gainNorm, 2)}, ΔGain = ${fmt(res.installed.segDiffPct, 0)}%)</text>
      </g>
      <text x="${L + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="10.2" fill="currentColor">Installed Characteristic — % Flow vs % Travel (dashed top ref: Quick-Opening)</text>
      <text transform="translate(13 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="10.2" fill="currentColor">% Flow</text>
      <text x="${L + pw}" y="${T - 7}" text-anchor="end" font-size="9.6" font-weight="700" fill="${res.installed.segGainOk ? '#10b981' : '#f59e0b'}">M04-034: ΔGain &lt; 50%, G ≥ 0.50</text>
    </svg>`;
  }

  function indicatorSvg(res) {
    const liq = res.state.fluid === 'liquid';
    const W = 600, H = 148, L = 64, R = 215, T = 28, rowH = 29;
    const pm = res.pts[2];
    const vals = res.pts.map(p => (liq ? Math.min(p.xF, 1.5) : p.x));
    const lines = liq
      ? [{ v: res.xFz, lab: `xFz ${fmt(res.xFz, 2)} (incipient)`, col: '#eab308' },
         { v: pm.valid ? pm.dPmax / Math.max(1e-9, pm.P1 - num(res.state.pvBara, 0)) : 0, lab: 'choked (max)', col: '#dc2626' }]
      : [{ v: pm.Fg * pm.xTP, lab: `Fγ·xTP ${fmt(pm.Fg * pm.xTP, 3)} (choked)`, col: '#dc2626' }];
    const vmax = clamp(Math.max(1, ...vals, ...lines.map(l => l.v)) * 1.08, 0.2, 1.65);
    const pw = W - L - R, X = v => L + clamp(v / vmax, 0, 1) * pw;
    const bars = res.pts.map((p, i) => {
      const y = T + i * rowH, val = vals[i];
      const col = !p.valid ? '#94a3b8' : (p.flashing ? '#dc2626' : p.choked ? '#f97316' : p.cavIncipient ? '#eab308' : '#22c55e');
      const db = p.noise ? `${fmt(p.noise.lpAe1m, 0)} dBA` : '—';
      const txt = !p.valid ? 'invalid' : liq ? `xF ${fmt(p.xF, 3)} · ${db}${p.flashing ? ' · FLASH' : p.choked ? ' · CHOKED' : p.cavIncipient ? ' · CAV' : ''}`
        : `x ${fmt(val, 3)}, Y ${fmt(p.Y, 3)} · ${db}${p.choked ? ' · CHOKED' : ''}`;
      return `<text x="${L - 8}" y="${y + 15}" text-anchor="end" font-size="10.5" fill="currentColor">${p.label}</text>
        <rect x="${L}" y="${y + 3}" width="${Math.max(1, X(val) - L).toFixed(1)}" height="17" rx="3" fill="${col}" fill-opacity="0.45"/>
        <text x="${L + pw + 10}" y="${y + 15.5}" font-size="9.8" font-weight="700" fill="currentColor">${txt}</text>`;
    }).join('');
    const ls = lines.filter(l => l.v > 0).map((l, i) => {
      const x = X(l.v), right = x > L + pw - 110;
      return `<line x1="${x}" y1="${T - 4}" x2="${x}" y2="${T + 3 * rowH}" stroke="${l.col}" stroke-width="2" stroke-dasharray="5 3"/>
      <text x="${x}" y="${T - 8 - i * 11}" text-anchor="${right ? 'end' : 'start'}" dx="${right ? -4 : 4}" font-size="9.5" fill="currentColor">${l.lab}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Choked flow, cavitation and acoustic noise indicator" id="control-valve-svg-indicator">
      ${bars}${ls}
      <line x1="${L}" y1="${T + 3 * rowH + 2}" x2="${L + pw}" y2="${T + 3 * rowH + 2}" stroke="currentColor" stroke-opacity="0.4"/>
      <text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="10.2" fill="currentColor">${liq ? 'Liquid: xF = ΔP/(P₁ − p_v) vs xFz (IEC 60534-8-4) & noise (dBA)' : 'Gas / Steam: x = ΔP/P₁ vs choked Fγ·xTP & noise (dBA)'}</text>
    </svg>`;
  }

  /** M04-034 pp. 18, 22–23: Vena Contracta Static Pressure & Velocity Profile SVG. */
  function venaContractaSvg(res) {
    const W = 600, H = 310, L = 58, R = 24, T = 36, B = 42, pw = W - L - R, ph = H - T - B;
    const pm = res.pts[2];
    const isLiq = res.state.fluid === 'liquid';
    const P1 = pm.valid ? pm.P1 : 10, P2 = pm.valid ? pm.P2 : 7, Pvc = pm.valid ? pm.pVcBara : 5;
    const Pref = isLiq ? num(res.state.pvBara, 0) : Math.max(0.1, P1 - pm.dPmax);
    const pMaxAxis = Math.max(P1, Pref, 1) * 1.12;
    const Yp = p => T + ph - clamp(p / pMaxAxis, 0, 1) * ph;
    const X = f => L + f * pw;

    // Static pressure curve P1 -> Pvc (at x=0.45) -> P2
    const pPath = `M${X(0).toFixed(1)},${Yp(P1).toFixed(1)} L${X(0.22).toFixed(1)},${Yp(P1 * 0.99).toFixed(1)} C${X(0.34).toFixed(1)},${Yp(P1 * 0.95).toFixed(1)} ${X(0.39).toFixed(1)},${Yp(Pvc).toFixed(1)} ${X(0.45).toFixed(1)},${Yp(Pvc).toFixed(1)} C${X(0.55).toFixed(1)},${Yp(Pvc).toFixed(1)} ${X(0.65).toFixed(1)},${Yp(P2).toFixed(1)} ${X(0.78).toFixed(1)},${Yp(P2).toFixed(1)} L${X(1).toFixed(1)},${Yp(P2 * 0.99).toFixed(1)}`;
    // Qualitative velocity mirror curve V1 -> Vmax (at vena contracta) -> V2
    const vBase1 = T + ph * 0.78, vPeak = T + ph * 0.14, vBase2 = T + ph * (res.pipes.D2 > res.pipes.D1 ? 0.84 : 0.72);
    const vPath = `M${X(0).toFixed(1)},${vBase1.toFixed(1)} L${X(0.22).toFixed(1)},${vBase1.toFixed(1)} C${X(0.35).toFixed(1)},${vBase1.toFixed(1)} ${X(0.40).toFixed(1)},${vPeak.toFixed(1)} ${X(0.45).toFixed(1)},${vPeak.toFixed(1)} C${X(0.55).toFixed(1)},${vPeak.toFixed(1)} ${X(0.65).toFixed(1)},${vBase2.toFixed(1)} ${X(0.78).toFixed(1)},${vBase2.toFixed(1)} L${X(1).toFixed(1)},${vBase2.toFixed(1)}`;

    const stateColor = !pm.valid ? '#94a3b8' : pm.flashing ? '#dc2626' : (pm.choked || pm.cavIncipient) ? '#f59e0b' : '#10b981';
    const stateLabel = isLiq
      ? (pm.flashing ? 'FLASHING: P_vc & P₂ ≤ p_v — Two-Phase Vapour Remains Downstream'
        : (Pvc <= Pref || pm.cavIncipient || pm.choked) ? 'CAVITATION ZONE: P_vc < p_v < P₂ — Vapour Bubbles Form & Collapse!'
        : 'SAFE SUBCOOLED: P_vc > p_v — All-Liquid Non-Cavitating Flow')
      : (pm.choked ? 'CHOKED SONIC JET (Mach 1 at Vena Contracta) — Check Aerodynamic Noise' : 'SUBSONIC COMPRESSIBLE EXPANSION — Non-Choked');

    // Cavitation/flashing bubble markers if applicable
    const bubbles = (isLiq && (pm.flashing || pm.cavIncipient || pm.choked))
      ? [0.44, 0.48, 0.52, 0.56, 0.61, 0.67].map((fx, i) => `<circle cx="${X(fx).toFixed(1)}" cy="${(Yp(Pvc) - 8 - (i % 3) * 6).toFixed(1)}" r="${pm.flashing ? 3.5 : (i < 4 ? 3.2 : 1.5)}" fill="none" stroke="${stateColor}" stroke-width="1.4"/>`).join('')
      : '';

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vena contracta static pressure and velocity profile" id="control-valve-svg-vena">
      <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="currentColor" stroke-opacity="0.25"/>
      <line x1="${X(0.45)}" y1="${T}" x2="${X(0.45)}" y2="${T + ph}" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="4 3"/>
      <text x="${X(0.45)}" y="${T - 7}" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">Vena Contracta (min area · P_min · V_max)</text>
      <line x1="${L}" y1="${Yp(Pref).toFixed(1)}" x2="${L + pw}" y2="${Yp(Pref).toFixed(1)}" stroke="#dc2626" stroke-width="1.6" stroke-dasharray="6 4"/>
      <text x="${L + pw - 6}" y="${(Yp(Pref) - 5).toFixed(1)}" text-anchor="end" font-size="9.5" font-weight="700" fill="#dc2626">${isLiq ? `Vapour Press. p_v = ${withU('pa', Pref, 2)}` : `Choke Limit P_choke = ${withU('pa', Pref, 2)}`}</text>
      <path d="${vPath}" fill="none" stroke="#0ea5e9" stroke-width="1.8" stroke-dasharray="5 3" stroke-opacity="0.75"/>
      <path d="${pPath}" fill="none" stroke="${stateColor}" stroke-width="2.8"/>
      ${bubbles}
      <circle cx="${X(0.05)}" cy="${Yp(P1).toFixed(1)}" r="4" fill="${stateColor}"/>
      <text x="${X(0.05) + 7}" y="${(Yp(P1) - 6).toFixed(1)}" font-size="9.8" font-weight="700" fill="currentColor">P₁ = ${withU('pa', P1, 2)}</text>
      <circle cx="${X(0.45)}" cy="${Yp(Pvc).toFixed(1)}" r="4.5" fill="${stateColor}"/>
      <text x="${X(0.45) + 8}" y="${(Yp(Pvc) + 12).toFixed(1)}" font-size="9.8" font-weight="700" fill="${stateColor}">P_vc ≈ ${withU('pa', Pvc, 2)}</text>
      <circle cx="${X(0.92)}" cy="${Yp(P2).toFixed(1)}" r="4" fill="${stateColor}"/>
      <text x="${X(0.92) - 6}" y="${(Yp(P2) - 6).toFixed(1)}" text-anchor="end" font-size="9.8" font-weight="700" fill="currentColor">P₂ = ${withU('pa', P2, 2)}</text>
      <text x="${X(0.04)}" y="${(vBase1 - 6).toFixed(1)}" font-size="9.3" fill="#0ea5e9">${isLiq ? `v₁=${fmt(pm.vInMS, 2)} m/s` : `M₁=${fmt(pm.machIn, 3)}`}</text>
      <text x="${X(0.96)}" y="${(vBase2 - 6).toFixed(1)}" text-anchor="end" font-size="9.3" fill="#0ea5e9">${isLiq ? `v₂=${fmt(pm.vOutMS, 2)} m/s` : `M₂=${fmt(pm.machOut, 3)}`}</text>
      <rect x="${L + 8}" y="${T + ph - 26}" width="${pw - 16}" height="20" rx="5" fill="${stateColor}" fill-opacity="0.14" stroke="${stateColor}" stroke-opacity="0.5"/>
      <text x="${L + pw / 2}" y="${T + ph - 12.5}" text-anchor="middle" font-size="9.8" font-weight="700" fill="${stateColor}">${esc(stateLabel)}</text>
      <text transform="translate(15 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="10.2" fill="currentColor">Static Pressure (solid) / Velocity (dashed)</text>
      <text x="${L + pw / 2}" y="${H - 10}" text-anchor="middle" font-size="10.2" fill="currentColor">Max Case Axial Profile (FL=${res.valve.FL}, Recovery = ${fmt((P2 - Pvc) / Math.max(0.01, P1 - Pvc) * 100, 0)}%) — CED M04-034 pp. 18, 22–23</text>
    </svg>`;
  }

  /** M04-034 pp. 49–50 & 52: Standard ISA P&ID Control Valve Station Schematic SVG. */
  function pidStationSvg(res) {
    const W = 600, H = 315;
    const m = res.mech, r = res.rating, sel = res.sel;
    const loopMap = { flow: 'FIC', level: 'LIC', pressure: 'PIC', temp: 'TIC', onoff: 'HS' };
    const ctrlTag = loopMap[res.state.loopType] || 'FIC';
    const numSuffix = String(res.state.tag || '100').replace(/^[A-Za-z-]+/, '') || '100';
    const failSym = m.failAction === 'FO'
      ? `<line x1="300" y1="158" x2="300" y2="128" stroke="#dc2626" stroke-width="2"/><polygon points="300,124 295,134 305,134" fill="#dc2626"/><text x="312" y="144" font-size="10.5" font-weight="800" fill="#dc2626">FO</text>`
      : m.failAction === 'FC'
        ? `<line x1="300" y1="126" x2="300" y2="156" stroke="#2563eb" stroke-width="2"/><polygon points="300,160 295,150 305,150" fill="#2563eb"/><text x="312" y="144" font-size="10.5" font-weight="800" fill="#2563eb">FC</text>`
        : `<line x1="292" y1="138" x2="308" y2="138" stroke="#f59e0b" stroke-width="2"/><line x1="292" y1="145" x2="308" y2="145" stroke="#f59e0b" stroke-width="2"/><text x="314" y="145" font-size="10.5" font-weight="800" fill="#f59e0b">FL</text>`;
    const hasRed = res.pipes.D1 > sel.dMm * 1.05, hasExp = res.pipes.D2 > sel.dMm * 1.05;
    const redSvg = hasRed ? `<polygon points="215,163 238,169 238,181 215,187" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/><text x="226" y="156" text-anchor="middle" font-size="8.5" fill="currentColor">RED</text>` : '';
    const expSvg = hasExp ? `<polygon points="362,169 385,163 385,187 362,181" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/><text x="374" y="156" text-anchor="middle" font-size="8.5" fill="currentColor">EXP</text>` : '';
    const drain2Svg = m.drainCount === 2
      ? `<line x1="398" y1="175" x2="398" y2="206" stroke="currentColor" stroke-width="1.6"/>
         <polygon points="391,206 405,206 398,215" fill="none" stroke="currentColor" stroke-width="1.5"/>
         <polygon points="391,224 405,224 398,215" fill="none" stroke="currentColor" stroke-width="1.5"/>
         <text x="412" y="219" font-size="8.8" fill="currentColor">Drain #2 (${m.failAction})</text>`
      : `<text x="392" y="204" font-size="8.5" fill="var(--text-muted)">(1 drain OK for FO)</text>`;
    const bypassSvg = m.hasBypass
      ? `<path d="M122,175 L122,256 L478,256 L478,175" fill="none" stroke="currentColor" stroke-width="1.8"/>
         <polygon points="282,246 282,266 300,256" fill="currentColor"/><polygon points="318,246 318,266 300,256" fill="currentColor"/>
         <circle cx="300" cy="256" r="4" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.5"/>
         <text x="300" y="280" text-anchor="middle" font-size="9.5" font-weight="700" fill="currentColor">Manual Globe Bypass Valve (Normally Closed)</text>`
      : `<line x1="300" y1="112" x2="332" y2="112" stroke="currentColor" stroke-width="2"/><line x1="332" y1="100" x2="332" y2="124" stroke="currentColor" stroke-width="2.5"/>
         <text x="338" y="116" font-size="9" font-weight="700" fill="currentColor">Handwheel (No Bypass)</text>`;

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ISA control valve P&amp;ID station arrangement" id="control-valve-svg-pid">
      <text x="16" y="22" font-size="11" font-weight="800" fill="currentColor">ISA P&amp;ID Control Valve Station — ${esc(res.state.tag)} (${sizeLabel(sel.sizeIn)} · Class ${r.ansiClass}# · ${m.leakKey})</text>
      <text x="584" y="22" text-anchor="end" font-size="9.5" font-weight="700" fill="var(--accent-primary)">${m.positionerReq ? 'I/P Smart Positioner Req.' : 'Direct / I/P Actuator'}</text>
      <!-- Control Loop Bubbles -->
      <circle cx="195" cy="64" r="19" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="1.8"/>
      <line x1="176" y1="64" x2="214" y2="64" stroke="var(--accent-primary)" stroke-width="1.2"/>
      <text x="195" y="61" text-anchor="middle" font-size="9.5" font-weight="800" fill="var(--accent-primary)">${ctrlTag}</text>
      <text x="195" y="75" text-anchor="middle" font-size="8.5" fill="currentColor">${esc(numSuffix.slice(0, 6))}</text>
      <line x1="214" y1="64" x2="281" y2="64" stroke="var(--accent-primary)" stroke-width="1.5" stroke-dasharray="5 3"/>
      <text x="247" y="57" text-anchor="middle" font-size="8.2" fill="var(--accent-primary)">4–20 mA</text>
      <circle cx="300" cy="64" r="19" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/>
      <text x="300" y="62" text-anchor="middle" font-size="9" font-weight="800" fill="currentColor">${m.positionerReq ? 'I/P' : 'FY'}</text>
      <text x="300" y="74" text-anchor="middle" font-size="7.8" fill="currentColor">${m.positionerReq ? 'POS' : 'XDR'}</text>
      <line x1="300" y1="83" x2="300" y2="106" stroke="currentColor" stroke-width="1.6"/>
      <!-- Actuator dome / piston / electric -->
      ${m.actuatorType === 'electric'
        ? `<rect x="284" y="98" width="32" height="22" rx="3" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/><text x="300" y="113" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">M</text>`
        : m.actuatorType === 'pneumatic-piston'
          ? `<rect x="284" y="98" width="32" height="22" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/><line x1="284" y1="109" x2="316" y2="109" stroke="currentColor" stroke-width="1.8"/>`
          : `<path d="M278,120 A22,18 0 0,1 322,120 Z" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/>`}
      <!-- Valve stem & fail arrow -->
      <line x1="300" y1="120" x2="300" y2="175" stroke="currentColor" stroke-width="2"/>
      ${failSym}
      <!-- Main process header line -->
      <line x1="30" y1="175" x2="570" y2="175" stroke="currentColor" stroke-width="2.4"/>
      <polygon points="62,175 50,169 50,181" fill="currentColor"/>
      <polygon points="562,175 550,169 550,181" fill="currentColor"/>
      <text x="36" y="160" font-size="9.2" font-weight="700" fill="currentColor">Inlet D₁: ${esc(res.pipes.d1Nps || fmt(res.pipes.D1, 0) + 'mm')}</text>
      <text x="564" y="160" text-anchor="end" font-size="9.2" font-weight="700" fill="currentColor">Outlet D₂: ${esc(res.pipes.d2Nps || fmt(res.pipes.D2, 0) + 'mm')}</text>
      <!-- Upstream & Downstream Block Valves -->
      <polygon points="150,165 150,185 166,175" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/>
      <polygon points="182,165 182,185 166,175" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/>
      <text x="166" y="156" text-anchor="middle" font-size="8.5" fill="currentColor">Block (LO)</text>
      <polygon points="418,165 418,185 434,175" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/>
      <polygon points="450,165 450,185 434,175" fill="var(--bg-surface)" stroke="currentColor" stroke-width="1.8"/>
      <text x="434" y="156" text-anchor="middle" font-size="8.5" fill="currentColor">Block (LO)</text>
      ${redSvg}${expSvg}
      <!-- Control Valve Body Bowtie -->
      <polygon points="274,161 274,189 300,175" fill="var(--accent-primary)" fill-opacity="0.22" stroke="var(--accent-primary)" stroke-width="2.2"/>
      <polygon points="326,161 326,189 300,175" fill="var(--accent-primary)" fill-opacity="0.22" stroke="var(--accent-primary)" stroke-width="2.2"/>
      <text x="300" y="205" text-anchor="middle" font-size="9.8" font-weight="800" fill="var(--accent-primary)">${esc(res.state.tag)} · ${sizeLabel(sel.sizeIn)} (${Math.round(sel.trimFactor * 100)}% Trim)</text>
      <!-- Upstream Drain Valve #1 (always present) -->
      <line x1="202" y1="175" x2="202" y2="206" stroke="currentColor" stroke-width="1.6"/>
      <polygon points="195,206 209,206 202,215" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <polygon points="195,224 209,224 202,215" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <text x="188" y="219" text-anchor="end" font-size="8.8" fill="currentColor">Drain #1</text>
      ${drain2Svg}
      ${bypassSvg}
      <text x="300" y="303" text-anchor="middle" font-size="9.2" fill="var(--text-muted)">CED M04-034 p. 52: ${m.drainCount} drain valve${m.drainCount > 1 ? 's' : ''} (${m.failAction}) · ${m.balancedRec ? 'Balanced' : 'Unbalanced'} Trim · ${m.fireSafe ? 'Fire-Safe' : 'Std Seat'} · ${esc(m.endConn.toUpperCase())}</text>
    </svg>`;
  }

  function step(title, ref, sym, sub, result, st) {
    const col = st && st !== 'PASS' ? `var(--${st === 'WARN' ? 'warn' : 'fail'}-text)` : '';
    return `<div class="eq-step-card"${col ? ` style="border-left-color:${col};"` : ''}>
      <div class="eq-step-header"><span>${title}</span><span class="panel-std-ref">${ref}</span></div>
      <div class="eq-symbolic">${sym}</div>
      <div class="eq-substitution">${sub}</div>
      <div class="eq-result"${col ? ` style="color:${col};"` : ''}>${result}</div>
    </div>`;
  }

  function renderOutputs() {
    if (!root) return;
    const res = calc(state);
    const sel = res.sel, v = res.valve, liq = res.state.fluid === 'liquid', isSteam = res.state.fluid === 'steam';
    const [pMin, pNorm, pMax] = res.pts;

    const m = root.querySelector('#control-valve-metrics');
    if (m) m.innerHTML = `
      <div class="metric-box"><span class="metric-box-label">Required Cv (min / norm / max)</span>
        <span class="metric-box-main" style="color:var(--accent-primary);">${fmtSig(pMin.C, 3)} / ${fmtSig(pNorm.C, 3)} / ${fmtSig(pMax.C, 3)}</span>
        <span class="metric-box-sub">Kv = ${fmtSig(pMin.Kv, 3)} / ${fmtSig(pNorm.Kv, 3)} / ${fmtSig(pMax.Kv, 3)} m³/h${liq ? ` · SG ${fmt(pMax.rho1 / RHO0, 3)}` : ''}</span></div>
      <div class="metric-box"><span class="metric-box-label">Selected Valve, Body &amp; B16.34 Class</span>
        <span class="metric-box-main">${sizeLabel(sel.sizeIn)} (DN${sel.dMm}) · Class ${res.rating.ansiClass}# · Cv<sub>r</sub> ${fmtSig(sel.Crated, 4)}</span>
        <span class="metric-box-sub">${badge(res.pipeRatio.ok ? 'PASS' : 'WARN', `d/D₁=${fmt(res.pipeRatio.dToD1, 2)}`)} ${badge(res.rating.status, res.rating.status === 'PASS' ? `${res.rating.allowableBarg.toFixed(0)} barg allow` : 'Check P-T')} ${badge(res.cvMargin.ok ? 'PASS' : 'WARN', res.cvMargin.ok ? 'Cv margin OK' : 'Low Cv margin')}</span></div>
      <div class="metric-box"><span class="metric-box-label">Travel &amp; Segmental Gain (M04-034)</span>
        <span class="metric-box-main">${fmt(pMin.open, 0)} / ${fmt(pNorm.open, 0)} / ${fmt(pMax.open, 0)} % <span style="font-size:0.75rem;color:var(--text-muted);">(ΔG ${fmt(res.installed.segDiffPct, 0)}%)</span></span>
        <span class="metric-box-sub">${badge(res.selStatus, res.selStatus === 'PASS' ? 'Travel PASS' : res.selStatus === 'WARN' ? 'Check travel' : 'Undersized')} ${badge(res.installed.segGainOk ? 'PASS' : 'WARN', res.installed.segGainOk ? 'Gain <50% PASS' : 'Gain check WARN')}</span></div>
      <div class="metric-box"><span class="metric-box-label">Flow Regime &amp; Rangeability</span>
        <span class="metric-box-main" style="font-size:0.84rem;">${badge(res.regime, esc(res.regimeText))}</span>
        <span class="metric-box-sub">${badge(res.rangeOk ? 'PASS' : 'WARN', `R_req ${fmt(res.reqRange, 1)}:1 vs ${v.R}:1`)} · TD ${fmt(res.appTurndown, 1)}:1</span></div>
      <div class="metric-box"><span class="metric-box-label">Acoustic Noise L<sub>pAe,1m</sub> (85 / 100 dBA)</span>
        <span class="metric-box-main">${fmt(res.noise.maxDb, 1)} dBA <span style="font-size:0.74rem;color:var(--text-muted);">(${res.noise.govCase})</span></span>
        <span class="metric-box-sub">${badge(res.noise.status, res.noise.tier === 'SOURCE' ? '>100 dBA: SOURCE TRIM REQ' : res.noise.tier === 'PATH' ? '85–100 dBA: PATH TREAT' : res.noise.tier === 'MARGINAL' ? '80–85 dBA MARGINAL' : 'PASS ≤ 80 dBA')}</span></div>
      <div class="metric-box"><span class="metric-box-label">Inlet/Outlet Hydraulics &amp; Authority</span>
        <span class="metric-box-main">${liq ? `v₁/v₂ = ${fmt(res.exit.maxVelInMS, 1)}/${fmt(res.exit.maxVelMS, 1)} m/s` : `M₁/M₂ = ${fmt(res.exit.maxMachIn, 2)}/${fmt(res.exit.maxMach, 2)}`} · N=${fmt(res.installed.authorityN, 2)}</span>
        <span class="metric-box-sub">${badge(res.exit.status, liq ? (res.exit.status === 'PASS' ? 'v₂ ≤ 10 m/s OK' : 'High exit vel') : (res.exit.status === 'PASS' ? 'M ≤ 0.33 OK' : 'Check Mach'))} · ${res.mech.positionerReq ? 'I/P Pos Req' : 'Pos Opt'} · ${res.mech.balancedRec ? 'Balanced' : 'Unbal'}</span></div>`;

    // Advisory strip on left column
    const advEl = root.querySelector('#control-valve-advisory');
    if (advEl) {
      const warns = [...res.mech.serviceWarnings];
      if (!res.pipeRatio.ok) warns.push(res.pipeRatio.note);
      if (res.rating.status === 'FAIL') warns.push(res.rating.note);
      if (res.mech.failAction === 'FO') warns.push('Fail-Open (FO) selected — click "⇒ Send to Step 1D" above to verify downstream PSV fail-open relief load.');
      advEl.innerHTML = `<div class="cv-advisory ${warns.length ? 'cv-advisory-warn' : ''}">
        <div><strong>Advisor (M04-034):</strong> Rec. Characteristic: <b>${esc(res.mech.recChar)}</b> · Trim: <b>${res.mech.balancedRec ? 'Balanced' : 'Unbalanced Single-Seat'}</b> · Positioner: <b>${res.mech.positionerReq ? 'Required' : 'Recommended'}</b> · Drains: <b>${res.mech.drainCount}</b> (${res.mech.failAction})</div>
        ${warns.length ? `<ul style="margin:0.35rem 0 0 1.1rem;padding:0;">${warns.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<div style="color:var(--pass-text);margin-top:0.2rem;">✓ Mechanical, material, leakage &amp; service selections are aligned.</div>'}
      </div>`;
    }

    const plot = root.querySelector('#control-valve-plot'); if (plot) plot.innerHTML = plotSvg(res);
    const iplot = root.querySelector('#control-valve-installed-plot'); if (iplot) iplot.innerHTML = installedSvg(res);
    const ind = root.querySelector('#control-valve-indicator'); if (ind) ind.innerHTML = indicatorSvg(res);
    const vena = root.querySelector('#control-valve-vena-plot'); if (vena) vena.innerHTML = venaContractaSvg(res);
    const pid = root.querySelector('#control-valve-pid-plot'); if (pid) pid.innerHTML = pidStationSvg(res);

    const tbl = root.querySelector('#control-valve-table');
    if (tbl) tbl.innerHTML = `<table class="eng-table" style="font-size:0.73rem;width:100%;">
      <thead><tr><th>Case</th><th>Flow [${flowUnitLabel()}]</th><th>P₁ [${uLab('pa')}]</th><th>ΔP [${uLab('dp')}]</th><th>${liq ? `ΔP_max [${uLab('dp')}]` : 'x / Fγ·xTP'}</th><th>FP</th><th>${liq ? 'FLP' : 'Y'}</th><th>Rev / FR</th><th>Cv req.</th><th>Kv req.</th><th>Travel</th><th>${liq ? 'v₁/v₂ [m/s]' : 'M₁/M₂'}</th><th>Noise [dBA]</th><th>Status</th></tr></thead>
      <tbody>${res.pts.map(p => `<tr><td>${p.label}</td><td class="mono">${fmt(flowToDisp(p.W), state.flowBasis === 'vol' ? 1 : 0)}</td><td class="mono">${disp('pa', p.P1, 2)}</td><td class="mono">${disp('dp', p.dP, 3)}</td>
        <td class="mono">${liq ? disp('dp', p.dPmax, 3) : `${fmt(p.x, 3)} / ${fmt(p.Fg * p.xTP, 3)}`}</td><td class="mono">${fmt(p.FP, 4)}</td><td class="mono">${liq ? fmt(p.FLP, 4) : fmt(p.Y, 4)}</td>
        <td class="mono">${fmtSig(p.Rev, 3)} / ${fmt(p.FR, 3)}</td><td class="mono">${fmtSig(p.C, 4)}</td><td class="mono">${fmtSig(p.Kv, 4)}</td><td class="mono">${fmt(p.open, 1)}%</td>
        <td class="mono">${liq ? `${fmt(p.vInMS, 1)}/${fmt(p.vOutMS, 1)}` : `${fmt(p.machIn, 2)}/${fmt(p.machOut, 2)}`}</td>
        <td class="mono">${fmt(p.noise?.lpAe1m, 1)}</td>
        <td>${!p.valid ? badge('FAIL', 'INVALID') : p.flashing ? badge('FAIL', 'FLASHING') : p.choked ? badge('WARN', 'CHOKED') : p.cavIncipient ? badge('WARN', 'CAV') : p.noise?.status === 'FAIL' ? badge('FAIL', `>${p.noise.tier === 'SOURCE' ? '100' : '85'}dBA`) : badge('PASS', 'OK')}</td></tr>`).join('')}</tbody></table>`;

    // CED M04-034 Step #5 Segmental Gain Consistency Table
    const gtbl = root.querySelector('#control-valve-gain-table');
    if (gtbl) gtbl.innerHTML = `<table class="eng-table" style="font-size:0.73rem;width:100%;">
      <thead><tr><th>Segment (CED M04-034 Step #5)</th><th>ΔFlow [${flowUnitLabel()}]</th><th>ΔTravel [%]</th><th>Raw Gain [Flow/%]</th><th>Norm. Gain [%Q/%VT]</th><th>Consistency Check (&lt; 50% diff &amp; ≥ 0.50)</th></tr></thead>
      <tbody>
        <tr><td>Min → Normal (${fmt(pMin.open, 1)}% → ${fmt(pNorm.open, 1)}%)</td><td class="mono">${fmt(flowToDisp(pNorm.W) - flowToDisp(pMin.W), 1)}</td><td class="mono">${fmt(pNorm.open - pMin.open, 1)}%</td><td class="mono">${fmt((flowToDisp(pNorm.W) - flowToDisp(pMin.W)) / Math.max(0.1, pNorm.open - pMin.open), 2)}</td><td class="mono">${fmt(res.installed.segGain1Norm, 2)}</td><td rowspan="2" style="vertical-align:middle;">${badge(res.installed.segGainOk ? 'PASS' : 'WARN', `ΔGain = ${fmt(res.installed.segDiffPct, 1)}% (${res.installed.segGainOk ? 'PASS < 50% & ≥ 0.50' : 'WARN: check trim/size'})`)}</td></tr>
        <tr><td>Normal → Max (${fmt(pNorm.open, 1)}% → ${fmt(pMax.open, 1)}%)</td><td class="mono">${fmt(flowToDisp(pMax.W) - flowToDisp(pNorm.W), 1)}</td><td class="mono">${fmt(pMax.open - pNorm.open, 1)}%</td><td class="mono">${fmt((flowToDisp(pMax.W) - flowToDisp(pNorm.W)) / Math.max(0.1, pMax.open - pNorm.open), 2)}</td><td class="mono">${fmt(res.installed.segGain2Norm, 2)}</td></tr>
      </tbody></table>`;

    const pm = pMax, z = pm.z, steps = [];
    const atm = num(res.state.atmBara, 1.01325);
    steps.push(step('1. Valve constants, ASME B36.10M piping &amp; B16.34 body class', 'IEC 60534-2-1 · ASME B36.10M · ASME B16.34',
      `Cv basis (bar): N1=${N.N1}, N2=${N.N2}, N4=${N.N4}, N5=${N.N5}, N6=${N.N6}, N8=${N.N8}; Kv = Cv/1.156`,
      `${esc(v.label)}: FL=${v.FL}, xT=${v.xT}, Fd=${v.Fd}; d=${sel.dMm} mm (${sizeLabel(sel.sizeIn)}), D₁=${esc(res.pipes.label1)}, D₂=${esc(res.pipes.label2)}; ${esc(res.rating.material)} @ P_des=${fmt(res.rating.designPressBarg, 1)} barg, T_des=${fmt(res.rating.designTempC, 0)} °C`,
      `Rated Cv = ${fmtSig(sel.Crated, 4)} · ANSI Class ${res.rating.ansiClass}# (${res.rating.note}) · ${res.pipeRatio.note}`,
      res.rating.status === 'FAIL' ? 'FAIL' : (res.pipeRatio.ok ? 'PASS' : 'WARN')));
    steps.push(step('2. Piping geometry factors (independent D₁ / D₂ reducer &amp; expander)', 'IEC 60534-2-1 §7.4 (FP, FLP, xTP)',
      'ζ₁ = 0.5(1 − d²/D₁²)², ζ₂ = 1.0(1 − d²/D₂²)², ζB1 = 1 − (d/D₁)⁴, ζB2 = 1 − (d/D₂)⁴, Σζ = ζ₁ + ζ₂ + ζB1 − ζB2',
      `ζ₁ = ${fmt(z.z1, 4)}, ζ₂ = ${fmt(z.z2, 4)}, ζB1 − ζB2 = ${fmt(z.zB1 - z.zB2, 4)} → Σζ = ${fmt(z.sum, 4)}; max case C = ${fmtSig(pm.C, 4)}, d = ${sel.dMm} mm`,
      `FP = ${fmt(pm.FP, 4)}; ${liq ? `FLP = ${fmt(pm.FLP, 4)}` : `xTP = ${fmt(pm.xTP, 4)}`}`));
    if (liq) {
      steps.push(step('3. Liquid choked-flow limit, IEC Cv &amp; M04-034 hand cross-check', 'IEC 60534-2-1 · CED M04-034 p. 19',
        'FF = 0.96 − 0.28·√(p_v/p_c);  ΔP_max = (FLP/FP)²·(P₁ − FF·p_v);  C = Q/(N1·FP)·√((ρ₁/ρ₀)/ΔP)',
        `p_v=${fmt(num(res.state.pvBara, 0), 3)} bara, p_c=${fmt(num(res.state.pcBara, 0), 2)} bara → FF=${fmt(pm.FF, 4)}, ΔP_max=${fmt(pm.dPmax, 3)} bar; M04-034 simplified max: ${esc(res.m04QuickMax.note)} = ${fmtSig(res.m04QuickMax.cv, 4)}`,
        res.pts.map(p => `Cv_${p.key} = ${fmtSig(p.C, 4)}`).join(' | ') + (pm.flashing ? ' (FLASHING)' : pm.choked ? ' (CHOKED)' : ''),
        pm.flashing ? 'FAIL' : pm.choked ? 'WARN' : 'PASS'));
    } else if (isSteam && pm.steam) {
      steps.push(step('3. Steam properties (IAPWS-IF97 + PR EOS), IEC Cv &amp; M04-034 cross-check', 'IAPWS-IF97 · IEC 60534-2-1 · CED M04-034 p. 43',
        'Fγ = γ/1.40;  Y = 1 − min(x, Fγ·xTP)/(3·Fγ·xTP);  C = W/(N8·FP·P₁·Y)·√(T₁·Z₁/(x_s·M))',
        `P₁=${fmt(pm.P1, 2)} bara → T_sat=${fmt(pm.steam.TsatC, 1)} °C, T₁=${fmt(pm.steam.TuseC, 1)} °C (ΔT_sh=${fmt(pm.steam.superheatC, 1)} °C), ρ₁=${fmt(pm.rho1, 3)} kg/m³, Z₁=${fmt(pm.zUsed, 4)}; M04-034 simplified max: ${fmtSig(res.m04QuickMax.cv, 4)} (${esc(res.m04QuickMax.note)})`,
        res.pts.map(p => `Cv_${p.key} = ${fmtSig(p.C, 4)}`).join(' | ') + `; Y(max)=${fmt(pm.Y, 4)}${pm.choked ? ' (CHOKED)' : ''}`,
        pm.steam.wetSteam || pm.choked ? 'WARN' : 'PASS'));
    } else {
      steps.push(step('3. Gas choked-flow limit, IEC Cv &amp; M04-034 hand cross-check', 'IEC 60534-2-1 · CED M04-034 pp. 42–43',
        'Fγ = γ/1.40;  Y = 1 − min(x, Fγ·xTP)/(3·Fγ·xTP);  C = W/(N8·FP·P₁·Y)·√(T₁·Z₁/(x_s·M))',
        `γ=${fmt(pm.kUsed, 3)} → Fγ=${fmt(pm.Fg, 4)}, M=${fmt(pm.mUsed, 2)}, Z₁=${fmt(pm.zUsed, 3)}; x=${fmt(pm.x, 4)} vs Fγ·xTP=${fmt(pm.Fg * pm.xTP, 4)}; M04-034 simplified max: ${fmtSig(res.m04QuickMax.cv, 4)} (${esc(res.m04QuickMax.note)})`,
        res.pts.map(p => `Cv_${p.key} = ${fmtSig(p.C, 4)}`).join(' | ') + `; Y(max)=${fmt(pm.Y, 4)}${pm.choked ? ' (CHOKED)' : ''}`,
        pm.choked ? 'WARN' : 'PASS'));
    }
    steps.push(step('4. Reynolds FR, inherent travel, rangeability &amp; Cv margin rule', 'IEC 60534-2-1 · CED M04-034 pp. 30–31, 39–40',
      'Margin: Cv_r ≥ 1.5·Cv_norm (Q_max ≤ 1.4·Q_norm) or 1.1·Cv_max | R_auth = (Q_max/Q_min)·√N',
      res.pts.map(p => `${p.label}: Rev=${fmtSig(p.Rev, 3)}, FR=${fmt(p.FR, 3)}, h=${fmt(p.open, 1)}%`).join(' | ') + `; Margin target (${res.cvMargin.rule}) = ${fmtSig(res.cvMargin.target, 3)}`,
      `Rangeability ${fmt(res.reqRange, 1)}:1 vs ${v.R}:1 (Turndown ${fmt(res.appTurndown, 1)}:1, R_auth ${fmt(res.rangeabilityAuth, 1)}:1) · Margin ${res.cvMargin.ok ? 'PASS' : 'WARN'}`,
      res.selStatus));
    steps.push(step('5. Acoustic noise (85/100 dBA tiers) &amp; inlet/outlet pipe hydraulics', liq ? 'IEC 60534-8-4 · CED M04-034 pp. 55, 61' : 'IEC 60534-8-3 · CED M04-034 pp. 55, 61',
      '≤ 85 dBA OK | 85–100 dBA Path Treatment | > 100 dBA Source Treatment Mandatory (pipe vibration) | M₁ < 0.30, M₂ < 0.33/0.50, v_liq < 10 m/s',
      res.pts.map(p => `${p.label}: ${fmt(p.noise?.lpAe1m, 1)} dBA (${liq ? `v₁=${fmt(p.vInMS, 1)}, v₂=${fmt(p.vOutMS, 1)} m/s` : `M₁=${fmt(p.machIn, 2)}, M₂=${fmt(p.machOut, 2)}`})`).join(' | '),
      `Max noise = ${fmt(res.noise.maxDb, 1)} dBA (${res.noise.govCase}) → ${res.noise.action}`,
      res.noise.status));
    steps.push(step('6. Installed characteristic, authority &amp; mechanical/P&amp;ID specification', 'ISA Control Loop · CED M04-034 §§1, 3, 4',
      'N = ΔP_v,max/(ΔP_v,max + ΔP_sys,var);  ΔGain = |G₂−G₁|/max(G₁,G₂) < 50%;  Balanced if P₂ > 0.25·P₁;  Positioner if ΔP > 5 bar',
      `N=${fmt(res.installed.authorityN, 3)}, Seg. Gains=${fmt(res.installed.segGain1Norm, 2)} / ${fmt(res.installed.segGain2Norm, 2)} (Δ=${fmt(res.installed.segDiffPct, 1)}%); P₂/P₁=${fmt(res.mech.p2OverP1, 2)}, ΔP_max=${fmt(res.mech.maxDp, 1)} bar; Leakage ${res.mech.leakLabel}; ${res.mech.drainCount} drain(s) for ${res.mech.failAction}`,
      `Authority/Gain: ${res.installed.status} · Trim: ${res.mech.balancedRec ? 'Balanced' : 'Unbalanced'} · Positioner: ${res.mech.positionerReq ? 'Required (' + res.mech.posReasons.slice(0, 2).join(', ') + ')' : 'Recommended'}`,
      res.installed.status));
    if (liq) {
      steps.push(step('7. Cavitation index &amp; downstream straight-run check', 'IEC 60534-8-4 · ISA-RP75.23 · M04-034 Tip #12',
        'xF = ΔP/(P₁ − p_v) = 1/σ;  incipient cavitation if xF ≥ xFz ≈ 0.90/√(1 + 3·Fd·√(C_rated/FL))',
        res.pts.map(p => `${p.label}: xF=${fmt(p.xF, 3)}, σ=${fmt(p.sigma, 2)}, P_vc≈${fmt(p.pVcBara, 2)} bara`).join(' | '),
        `xFz = ${fmt(res.xFz, 3)} → ${res.pts.some(p => p.cavIncipient) ? 'Cavitation expected: select multi-stage anti-cavitation cage + straight downstream run' : 'Below incipient cavitation'}`,
        res.pts.some(p => p.cavIncipient) ? 'WARN' : 'PASS'));
    }
    const tr = root.querySelector('#control-valve-trace');
    if (tr) tr.innerHTML = steps.join('') + `<div class="cv-note">Primary Engine: IEC 60534-2-1:2011 (ISA-75.01.01) converged FP/FLP/xTP with IAPWS-IF97 steam, ASME B36.10M/B16.34, IEC 60534-8-3/-8-4 acoustics, and CED M04-034 selection/gain/P&amp;ID guardrails. Verify final vendor trim curves &amp; actuator thrust before procurement.</div>`;
    if (ctx && ctx.notifyChanged) ctx.notifyChanged();
  }

  // ---------------------------------------------------------------- tool object
  const tool = {
    id: 'control-valve',
    standaloneTab: 'tab-cv',
    title: 'Control Valve Sizing (IEC 60534)',
    std: 'IEC 60534-2-1 / -8-3 / -8-4 · ASME B16.34 · ISA-20',
    presets,
    constants: N,
    valves: VALVES,
    pipes: PIPE_SCHEDULES,
    materials: B1634_MATERIALS,
    leakageClasses: LEAKAGE_CLASSES,
    calc,
    sizePoint,
    helpers: {
      zetas, calcFP, calcFLP, calcXTP, calcFF, calcY, calcRev, calcFR, opening, cvAtTravel,
      installedFlow, installedGain, estimateXFz, steamSatTempC, calcSteamProps, calcNoise,
      lookupPipe, calcAsmeB1634, calcM04QuickCv, KV_PER_CV, RHO0
    },
    defaultState,
    mount(container, c) {
      root = container; ctx = c || null;
      if (typeof document !== 'undefined' && !document.getElementById('style-control-valve')) {
        const st = document.createElement('style'); st.id = 'style-control-valve'; st.textContent = STYLE; document.head.appendChild(st);
      }
      if (ctx && ctx.onUnitChange) ctx.onUnitChange(() => render());
      render();
    },
    getState() { return JSON.parse(JSON.stringify(state)); },
    setState(s) { state = Object.assign(defaultState(), s || {}); if (root) render(); },
    summaryRows() {
      const r = calc(state), [a, b, c] = r.pts;
      return [
        ['Valve tag / service', `${String(r.state.tag || '')}${r.state.service ? ' — ' + r.state.service : ''}`, r.state.fluid.toUpperCase()],
        ['Valve style & trim', `${r.valve.label} (${Math.round(r.sel.trimFactor * 100)}% trim)`, `FL ${r.valve.FL}, xT ${r.valve.xT}, Fd ${r.valve.Fd}`],
        ['Connecting piping D1 / D2', `${r.pipes.label1} / ${r.pipes.label2}`, r.pipeRatio.note],
        ['Selected size / rated Cv', `${sizeLabel(r.sel.sizeIn)} (DN${r.sel.dMm}) / ${fmtSig(r.sel.Crated, 4)}`, `${r.basis} (${r.cvMargin.ok ? 'margin OK' : 'low margin'})`],
        ['Required Cv min / norm / max', `${fmtSig(a.C, 4)} / ${fmtSig(b.C, 4)} / ${fmtSig(c.C, 4)}`, `Kv ${fmtSig(a.Kv, 4)} / ${fmtSig(b.Kv, 4)} / ${fmtSig(c.Kv, 4)} m³/h`],
        ['Travel & segmental gain check', `${fmt(a.open, 1)} / ${fmt(b.open, 1)} / ${fmt(c.open, 1)} %`, `ΔGain ${fmt(r.installed.segDiffPct, 1)}% (${r.installed.segGainOk ? 'PASS <50%' : 'WARN'})`],
        ['Flow regime & rangeability', `${r.regimeText} · R_req ${fmt(r.reqRange, 1)}:1`, `Turndown ${fmt(r.appTurndown, 1)}:1 · ${r.regime}`],
        ['Predicted noise L_pAe,1m', `${fmt(r.noise.maxDb, 1)} dBA (${r.noise.govCase})`, `${r.noise.tier} — ${r.noise.status}`],
        ['Inlet / outlet hydraulics & authority', r.state.fluid === 'liquid' ? `v₁/v₂=${fmt(r.exit.maxVelInMS, 1)}/${fmt(r.exit.maxVelMS, 1)} m/s, N=${fmt(r.installed.authorityN, 2)}` : `M₁/M₂=${fmt(r.exit.maxMachIn, 2)}/${fmt(r.exit.maxMach, 2)}, N=${fmt(r.installed.authorityN, 2)}`, `G_norm=${fmt(r.installed.gainNorm, 2)}`],
        ['ASME B16.34 body rating & material', `Class ${r.rating.ansiClass}# · ${r.rating.material}`, r.rating.note],
        ['Leakage, trim balance & actuator', `${r.mech.leakLabel} · ${r.mech.balancedRec ? 'Balanced' : 'Unbalanced'} · ${r.mech.actuatorType}`, `Fail ${r.mech.failAction} · ${r.mech.positionerReq ? 'I/P Pos Req' : 'Pos Opt'} · ${r.mech.drainCount} drain(s)`]
      ];
    }
  };

  if (typeof window !== 'undefined' && window.PSVTools) window.PSVTools.register(tool);
  if (typeof module !== 'undefined' && module.exports) module.exports = tool;
})();
