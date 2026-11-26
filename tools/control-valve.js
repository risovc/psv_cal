/**
 * PSVCalc Pro — Control Valve Sizing Workbench
 * Standards:
 *   - IEC 60534-2-1:2011 (= ANSI/ISA-75.01.01) — Liquid, Gas/Vapour & Steam Flow Sizing
 *   - IEC 60534-8-3 (Aerodynamic) & IEC 60534-8-4 (Hydrodynamic) — Acoustic Noise & Cavitation Screening
 *   - ASME B36.10M / B36.19M — Upstream (D1) & Downstream (D2) Pipe Schedules & Wall Thickness
 *   - ISA-20 / IEC 60534-2-4 — Inherent vs. Installed Flow Characteristics & Valve Authority
 *
 * Pure calc in canonical SI (kg/h, barg/bara, °C, mm, kg/m³, cP). Internally the IEC equations are
 * evaluated with the "Cv" column of IEC 60534-2-1 Table 1 (numerical constants) in bar units;
 * Kv = Cv / 1.156 (IEC 60534-1).
 */
(function () {
  // ---------------------------------------------------------------- constants
  // IEC 60534-2-1:2011 Table 1 — numerical constants, Cv column (Kv column in comments).
  const N = {
    N1: 0.865,    // Q m³/h, p bar            (Kv: 1)
    N2: 2.14e-3,  // d mm                     (Kv: 1.60e-3)
    N4: 7.60e-2,  // Q m³/h, ν m²/s           (Kv: 7.07e-2)
    N5: 2.41e-3,  // d mm                     (Kv: 1.80e-3)
    N6: 27.3,     // W kg/h, p bar, ρ kg/m³   (Kv: 31.6)
    N8: 94.8      // W kg/h, p bar, T K       (Kv: 110)
  };
  const KV_PER_CV = 1 / 1.156;      // IEC 60534-1: Kv = 0.865·Cv
  const RHO0 = 999.1;               // water at 15 °C (IEC: ρ1/ρ0 = 1 for water at 15 °C)
  const RU = 8314.462;              // J/(kmol·K)
  const RHO_STEEL = 7800;           // kg/m³ carbon/stainless steel pipe wall
  const C_STEEL = 5000;             // m/s longitudinal wave speed in steel
  const Z0_AIR = 415;               // Pa·s/m acoustic impedance of ambient air (20 °C)

  // ASME B36.10M / B36.19M exact pipe table (mirrors engine.js for standalone Node & browser purity)
  const PIPE_SCHEDULE_KEYS = ['Sch 10S', 'STD', 'Sch 40', 'XS', 'Sch 80', 'Sch 160'];
  const PIPE_SCHEDULES = [
    ['1"',   25,  1.315, { 'Sch 10S': 0.109, 'STD': 0.133, 'Sch 40': 0.133, 'XS': 0.179, 'Sch 80': 0.179, 'Sch 160': 0.250 }],
    ['1.5"', 40,  1.900, { 'Sch 10S': 0.109, 'STD': 0.145, 'Sch 40': 0.145, 'XS': 0.200, 'Sch 80': 0.200, 'Sch 160': 0.281 }],
    ['2"',   50,  2.375, { 'Sch 10S': 0.109, 'STD': 0.154, 'Sch 40': 0.154, 'XS': 0.218, 'Sch 80': 0.218, 'Sch 160': 0.344 }],
    ['3"',   80,  3.500, { 'Sch 10S': 0.120, 'STD': 0.216, 'Sch 40': 0.216, 'XS': 0.300, 'Sch 80': 0.300, 'Sch 160': 0.438 }],
    ['4"',   100, 4.500, { 'Sch 10S': 0.120, 'STD': 0.237, 'Sch 40': 0.237, 'XS': 0.337, 'Sch 80': 0.337, 'Sch 160': 0.531 }],
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
    const p = PIPE_SCHEDULES.find(x => x.nps === nps) || PIPE_SCHEDULES[4]; // default 4"
    const sch = PIPE_SCHEDULE_KEYS.includes(schedule) ? schedule : 'Sch 40';
    return { nps: p.nps, dn: p.dn, schedule: sch, idMm: p.idMm[sch], wallMm: p.wallMm[sch], odMm: p.odMm };
  }

  function estimateWallFromId(idMm) {
    // Nearest Sch 40 pipe wall for custom ID mode (used in IEC 60534-8-3/-8-4 pipe transmission loss)
    let best = PIPE_SCHEDULES[4], bestErr = Infinity;
    for (const p of PIPE_SCHEDULES) {
      const err = Math.abs(p.idMm['Sch 40'] - idMm);
      if (err < bestErr) { bestErr = err; best = p; }
    }
    return best.wallMm['Sch 40'];
  }

  // Typical/indicative valve data — FL, xT, Fd from IEC 60534-2-1 Table 2 (typical values at rated travel);
  // rated Cv per size are representative vendor-catalogue magnitudes ONLY (always confirm with vendor data).
  const SIZES_IN = [1, 1.5, 2, 3, 4, 6, 8, 10, 12];
  const SIZES_MM = [25, 40, 50, 80, 100, 150, 200, 250, 300];
  const VALVES = {
    'globe-lin': { label: 'Globe, contoured plug, linear (flow-to-open)', char: 'lin', R: 30, FL: 0.90, xT: 0.72, Fd: 0.46, noiseTrimBonusDb: 0,
      cv: [12, 28, 50, 110, 195, 400, 640, 1000, 1440] },
    'globe-eqp': { label: 'Globe, contoured plug, equal-% (flow-to-open)', char: 'eqp', R: 50, FL: 0.90, xT: 0.72, Fd: 0.46, noiseTrimBonusDb: 0,
      cv: [10, 24, 42, 95, 170, 360, 580, 920, 1300] },
    'globe-lownoise': { label: 'Globe, multi-stage low-noise / anti-cavitation cage (=%)' , char: 'eqp', R: 50, FL: 0.96, xT: 0.85, Fd: 0.25, noiseTrimBonusDb: 15,
      cv: [7, 16, 28, 62, 110, 230, 380, 600, 860] },
    'eccentric-plug': { label: 'Eccentric rotary plug, Camflex-style (≈ linear)', char: 'lin', R: 100, FL: 0.85, xT: 0.65, Fd: 0.42, noiseTrimBonusDb: 0,
      cv: [14, 32, 60, 135, 230, 500, 840, 1300, 1850] },
    'butterfly': { label: 'Butterfly, swing-through, 70° (≈ equal-%)', char: 'eqp', R: 20, FL: 0.62, xT: 0.35, Fd: 0.57, noiseTrimBonusDb: 0,
      cv: [null, null, 90, 220, 400, 950, 1750, 2800, 4100] },
    'ball': { label: 'Segmented (V-notch) ball, 90° (≈ equal-%)', char: 'eqp', R: 100, FL: 0.60, xT: 0.30, Fd: 0.98, noiseTrimBonusDb: 0,
      cv: [30, 70, 120, 290, 520, 1150, 2050, 3200, 4600] }
  };
  const TRIM_FACTORS = [
    { val: 1.0, label: '100% Full Trim' },
    { val: 0.6, label: '60% Reduced Trim' },
    { val: 0.4, label: '40% Reduced Trim' },
    { val: 0.25, label: '25% Reduced Trim' }
  ];
  const EQP_R = 50; // inherent equal-percentage characteristic used for travel (R = 50)

  const num = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ------------------------------------------------ IAPWS-IF97 Steam Properties
  /** Exact IAPWS-IF97 Region 4 saturation temperature (°C) from absolute pressure (bara, 0.01..220.64). */
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

  /**
   * Real steam vapour properties via IAPWS-IF97 saturation + Peng-Robinson compressibility
   * (water: Tc = 647.096 K, Pc = 220.64 bar, ω = 0.344, M = 18.01528 kg/kmol).
   */
  function calcSteamProps(pBara, tempC, isSaturated) {
    const P = clamp(num(pBara, 5), 0.05, 220.0);
    const TsatC = steamSatTempC(P);
    const TuseC = isSaturated ? TsatC : num(tempC, TsatC + 10);
    const superheatC = TuseC - TsatC;
    const wetSteam = !isSaturated && (TuseC < TsatC - 0.5);
    // Evaluate vapour EOS at max(TuseC, TsatC) so density remains physical even if wet-steam warning fires
    const TK = Math.max(273.15, (wetSteam ? TsatC : TuseC) + 273.15);
    const Tc = 647.096, Pc = 220.64, omega = 0.344, M = 18.01528;
    const Tr = TK / Tc, Pr = P / Pc;
    const kappa = 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
    const alpha = Math.pow(1 + kappa * (1 - Math.sqrt(Tr)), 2);
    const A = 0.45724 * alpha * Pr / (Tr * Tr);
    const B = 0.07780 * Pr / Tr;
    // Vapour root (largest real root of Z³ − (1−B)Z² + (A − 3B² − 2B)Z − (AB − B² − B³) = 0)
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
      const r1 = m * Math.cos(phi / 3) - c2 / 3;
      const r2 = m * Math.cos((phi + 2 * Math.PI) / 3) - c2 / 3;
      const r3 = m * Math.cos((phi + 4 * Math.PI) / 3) - c2 / 3;
      Z = Math.max(r1, r2, r3);
    }
    Z = clamp(Z, 0.35, 1.05);
    const rho1 = (P * 1e5 * M) / (Z * RU * TK);
    // Steam isentropic exponent γ (1.33 low-P sat → ~1.28-1.31 superheated)
    const k = clamp(1.332 - 0.00014 * Math.max(0, TuseC - 100) - 0.0005 * Math.min(P, 80) * (1 - Z), 1.24, 1.35);
    const muCp = clamp(0.0088 + 3.8e-5 * Math.max(0, TuseC), 0.008, 0.04);
    return { TsatC, TuseC, superheatC, wetSteam, Z, rho1, k, muCp, M };
  }

  // ------------------------------------------------------- correction factors
  /** Velocity-head loss coefficients of short concentric reducers / expanders (IEC 60534-2-1 piping geometry factors). */
  function zetas(dMm, D1Mm, D2Mm) {
    const r1 = dMm / D1Mm, r2 = dMm / D2Mm;
    const z1 = D1Mm > dMm ? 0.5 * Math.pow(1 - r1 * r1, 2) : 0;   // inlet reducer
    const z2 = D2Mm > dMm ? 1.0 * Math.pow(1 - r2 * r2, 2) : 0;   // outlet expander
    const zB1 = 1 - Math.pow(r1, 4), zB2 = 1 - Math.pow(r2, 4);   // Bernoulli coefficients
    return { z1, z2, zB1, zB2, sum: z1 + z2 + zB1 - zB2, inlet: z1 + zB1 };
  }
  /** FP = [1 + Σζ/N2·(C/d²)²]^-1/2 */
  const calcFP = (C, d, z) => 1 / Math.sqrt(1 + (z.sum / N.N2) * Math.pow(C / (d * d), 2));
  /** FLP = FL / [1 + FL²/N2·Σζ1·(C/d²)²]^1/2 */
  const calcFLP = (C, d, z, FL) => FL / Math.sqrt(1 + (FL * FL / N.N2) * z.inlet * Math.pow(C / (d * d), 2));
  /** xTP = (xT/FP²) / [1 + xT·ζi/N5·(C/d²)²] */
  const calcXTP = (C, d, z, xT, FP) => (xT / (FP * FP)) / (1 + (xT * z.inlet / N.N5) * Math.pow(C / (d * d), 2));
  /** Liquid critical pressure ratio factor FF = 0.96 − 0.28·√(pv/pc) */
  const calcFF = (pv, pc) => 0.96 - 0.28 * Math.sqrt(clamp(pv / Math.max(1e-9, pc), 0, 1));
  /** Expansion factor Y = 1 − x/(3·Fγ·xT(P)), x limited to the choked value → Y ≥ 2/3 */
  const calcY = (x, Fg, xTx) => 1 - Math.min(x, Fg * xTx) / (3 * Fg * xTx);
  /** Valve Reynolds number Rev = N4·Fd·Q/(ν·√(C·FL))·[FL²C²/(N2·d⁴) + 1]^1/4 */
  const calcRev = (Q, nu, C, FL, Fd, d) =>
    (N.N4 * Fd * Q) / (nu * Math.sqrt(Math.max(1e-12, C * FL))) * Math.pow((FL * FL * C * C) / (N.N2 * Math.pow(d, 4)) + 1, 0.25);
  /** Reynolds number factor FR, full-size trim (screening): lesser of the two IEC expressions, ≤ 1. */
  function calcFR(Rev, C, d, FL) {
    if (Rev >= 10000) return 1;
    const n1 = N.N2 / Math.pow(C / (d * d), 2);
    const frB = (0.026 / FL) * Math.sqrt(n1 * Rev);
    const frA = Rev >= 10 ? 1 + (0.33 * Math.sqrt(FL) / Math.pow(n1, 0.25)) * Math.log10(Rev / 10000) : Infinity;
    return clamp(Math.min(frA, frB, 1), 1e-3, 1);
  }

  /** Travel h (0..1.2) from C/Crated for the inherent characteristic. */
  function opening(C, Crated, char) {
    if (!(Crated > 0) || !(C > 0)) return 0;
    const phi = C / Crated;
    if (char === 'lin') return clamp(phi, 0, 1.2);
    return clamp(1 + Math.log(phi) / Math.log(EQP_R), 0, 1.2); // φ = R^(h−1)
  }
  const cvAtTravel = (h, Crated, char) => (char === 'lin' ? h * Crated : Crated * Math.pow(EQP_R, h - 1));

  /** Installed fractional flow q(h) = φ(h) / √(N + (1 − N)·φ(h)²) for valve authority N ∈ (0, 1]. */
  function installedFlow(h, char, authorityN) {
    const Nv = clamp(num(authorityN, 1), 0.02, 1.0);
    const phi = char === 'lin' ? clamp(h, 0, 1) : Math.pow(EQP_R, clamp(h, 0, 1) - 1);
    if (h <= 0) return 0;
    return phi / Math.sqrt(Nv + (1 - Nv) * phi * phi);
  }

  /** Installed process gain d(%Q)/d(%h) via central finite difference at travel h ∈ [0.02, 0.98]. */
  function installedGain(h, char, authorityN) {
    const hc = clamp(h, 0.02, 0.98), dh = 0.005;
    return (installedFlow(hc + dh, char, authorityN) - installedFlow(hc - dh, char, authorityN)) / (2 * dh);
  }

  // -------------------------------------- Acoustic Noise (IEC 60534-8-3 / -8-4)
  /**
   * Screening acoustic noise prediction L_pAe,1m (dBA at 1 m downstream of pipe wall).
   * - Gas / Steam: IEC 60534-8-3 multi-regime jet Mach & steel pipe wall transmission loss.
   * - Liquid: IEC 60534-8-4 turbulent + cavitating noise & liquid-filled steel pipe transmission loss.
   */
  function calcNoise(pt, valve, dMm, D2Mm, wall2Mm, xFz) {
    if (!pt || !pt.valid) return { lpAe1m: 0, lpi: 0, tlPipe: 0, fpHz: 0, regime: 'N/A', status: 'PASS' };
    const mDot = pt.W / 3600; // kg/s
    const D2 = Math.max(0.015, num(D2Mm, dMm) / 1000); // m
    const ts = Math.max(0.002, num(wall2Mm, estimateWallFromId(D2Mm)) / 1000); // m
    const FL = clamp(valve.FL, 0.3, 1.0);
    const Fd = clamp(valve.Fd, 0.05, 1.0);
    const bonusDb = num(valve.noiseTrimBonusDb, 0);
    const dj = Math.max(0.001, 0.0046 * Fd * Math.sqrt(Math.max(1e-4, pt.C * FL))); // vena contracta jet dia (m)
    const distAtten = 10 * Math.log10((D2 + 2.0) / D2); // cylindrical spreading to 1 m from pipe wall

    if (pt.fluid === 'liquid') {
      const rho = Math.max(100, pt.rho1);
      const cL = 1400; // m/s typical process liquid acoustic speed
      const dPeffPa = Math.min(pt.dP, Math.max(pt.dPmax, 1e-4)) * 1e5;
      const Uvc = (1 / FL) * Math.sqrt((2 * dPeffPa) / rho);
      const Wm = 0.5 * mDot * Uvc * Uvc;
      const etaTurb = 1e-4 * (Uvc / cL);
      let etaCav = 0, nRegime = 'Turbulent (non-cavitating)';
      if (pt.flashing) {
        etaCav = 15 * etaTurb;
        nRegime = 'Flashing two-phase';
      } else if (pt.xF > xFz && xFz > 0) {
        const xf = clamp(pt.xF, xFz + 1e-4, 0.98);
        const ratio = (xf - xFz) / Math.max(0.05, 1 - xFz);
        // Smooth cavitation noise escalation (peaks ~22-26 dB above turbulent baseline in full cavitation)
        etaCav = etaTurb * Math.min(400, 12 * Math.pow(ratio, 1.6) * Math.exp(3.2 * xf));
        nRegime = pt.choked ? 'Full cavitation (choked)' : 'Cavitating (xF ≥ xFz)';
      }
      const Wa = Math.max(1e-12, (etaTurb + etaCav) * Wm);
      const Zliq = rho * cL;
      const lpi = 10 * Math.log10((3.2e9 * Wa * Zliq) / (D2 * D2));
      const fpHz = clamp(0.2 * Uvc / dj, 150, 12000);
      // Liquid-to-steel-to-air mass-law + shell stiffness transmission loss
      const zm = 2 * Math.PI * fpHz * RHO_STEEL * ts;
      const fr = C_STEEL / (Math.PI * D2);
      const shellBoost = fpHz < fr ? Math.pow(fpHz / fr, 0.45) : 1.0;
      const tlPipe = 20 * Math.log10((2 * Z0_AIR) / Math.sqrt(Math.pow(Zliq + Z0_AIR, 2) + zm * zm)) + 10 * Math.log10(Math.max(0.08, shellBoost));
      const lpAe1m = clamp(lpi + tlPipe - distAtten - (pt.xF > xFz ? bonusDb : bonusDb * 0.4), 30, 130);
      const status = lpAe1m > 85 ? 'FAIL' : lpAe1m > 80 ? 'WARN' : 'PASS';
      return { lpAe1m, lpi, tlPipe, fpHz, regime: nRegime, status };
    }

    // Gas / Steam Aerodynamic Noise (IEC 60534-8-3)
    const k = clamp(pt.kUsed || 1.3, 1.05, 1.7);
    const P1Pa = pt.P1 * 1e5, P2Pa = Math.max(1e3, pt.P2 * 1e5);
    const pr = P1Pa / P2Pa;
    const rho1 = Math.max(0.01, pt.rho1);
    const rho2 = Math.max(0.005, pt.rho2 || rho1 * (P2Pa / P1Pa));
    const c1 = Math.sqrt(k * P1Pa / rho1);
    const c2 = Math.max(100, pt.c2 || c1);
    const cVc = c1 * Math.sqrt(2 / (k + 1));
    const prCrit = Math.pow((k + 1) / 2, k / (k - 1));
    const alpha = Math.max(0.15, 1 - FL * FL * (1 - 1 / prCrit));
    const prBreak = prCrit / alpha; // valve critical pressure ratio P1/P2C

    let Wm = 0, eta = 1e-6, fpHz = 2000, nRegime = 'Regime I (subsonic)';
    if (pr < prBreak) {
      // Regime I: subsonic vena contracta
      const dPvc = (P1Pa - P2Pa) / (FL * FL);
      const Uvc = Math.min(cVc, Math.sqrt((2 * Math.max(0, dPvc)) / rho1));
      const Mvc = clamp(Uvc / c1, 0.02, 0.99);
      Wm = 0.5 * mDot * Uvc * Uvc;
      eta = 1e-4 * FL * FL * Math.pow(Mvc, 3.6);
      fpHz = clamp(0.2 * Uvc / dj, 200, 14000);
      nRegime = 'Regime I (subsonic)';
    } else {
      // Regimes II–V: sonic/supersonic jet
      const Mj = clamp(Math.sqrt((2 / (k - 1)) * (Math.pow(pr, (k - 1) / k) - 1)), 1.0, 5.0);
      Wm = 0.5 * mDot * cVc * cVc;
      if (Mj <= 1.4) {
        eta = 1e-4 * Math.pow(Mj, 6.6 * FL * FL);
        nRegime = 'Regime II (sonic jet)';
      } else if (Mj <= 2.2) {
        eta = 1e-4 * Math.pow(1.4, 6.6 * FL * FL) * Math.pow(Mj / 1.4, 3.6 * FL * FL);
        nRegime = 'Regime III (shock-cell)';
      } else if (Mj <= 3.5) {
        eta = 1e-4 * Math.pow(1.4, 6.6 * FL * FL) * Math.pow(2.2 / 1.4, 3.6 * FL * FL) * Math.pow(Mj / 2.2, 2.0);
        nRegime = 'Regime IV (Mach-disc)';
      } else {
        eta = 1e-4 * Math.pow(1.4, 6.6 * FL * FL) * Math.pow(2.2 / 1.4, 3.6 * FL * FL) * Math.pow(3.5 / 2.2, 2.0) * 1.15;
        nRegime = 'Regime V (constant eff.)';
      }
      eta = clamp(eta, 1e-6, 0.015);
      fpHz = clamp((0.2 * cVc) / (dj * Math.sqrt(Math.max(1, Mj * Mj - 0.5))), 300, 15000);
    }
    const Wa = Math.max(1e-12, eta * Wm);
    const Z2 = rho2 * c2;
    const lpi = 10 * Math.log10((3.2e9 * Wa * Z2) / (D2 * D2));
    // Steel pipe wall mass-law + cylindrical ring/coincidence transmission loss
    const zm = 2 * Math.PI * fpHz * RHO_STEEL * ts;
    const fr = C_STEEL / (Math.PI * D2);
    const fo = c2 / (Math.PI * D2);
    const gx = fpHz < fo ? Math.pow(fo / fr, 0.67) * Math.pow(fpHz / fo, 2.5) : (fpHz < fr ? Math.pow(fpHz / fr, 0.5) : 1.0);
    // Reference transmission loss relative to internal sound pressure (increases ~6-9 dB per doubling of ts)
    const tlMass = 20 * Math.log10((2 * Z0_AIR) / Math.sqrt(Math.pow(Z2 + Z0_AIR, 2) + zm * zm));
    const tlShell = 10 * Math.log10(clamp(gx, 0.05, 1.5)) - 3.0 * Math.log10(Math.max(0.5, ts / 0.005));
    const tlPipe = tlMass + tlShell;
    // A-weighting approximation around peak frequency (flat 1-5 kHz, rolls off gently below 500 Hz)
    const aWeight = fpHz < 500 ? -6 * Math.log10(500 / fpHz) : 0;
    const lpAe1m = clamp(lpi + tlPipe - distAtten + aWeight - bonusDb, 35, 135);
    const status = lpAe1m > 85 ? 'FAIL' : lpAe1m > 80 ? 'WARN' : 'PASS';
    return { lpAe1m, lpi, tlPipe, fpHz, regime: nRegime, status };
  }

  // ---------------------------------------------------------- one operating point
  /**
   * Size one operating point. All pressures ABSOLUTE bar, W kg/h, T °C, d/D mm, mu cP.
   * p = { fluid, W, P1, P2, rho, pv, pc, mu, T, M, k, Z, FL, xT, Fd, d, D1, D2, steamSaturated }
   * Returns required Cv (and Kv) by fixed-point iteration of the implicit IEC equations (FP, FLP, xTP depend on C).
   */
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
    let mu = Math.max(1e-4, num(p.mu, 1)); // cP
    const out = { fluid, W, P1, P2, dP, valid: W > 0 && dP > 0, choked: false, flashing: false, cavIncipient: false,
      C: 0, Kv: 0, Cturb: 0, FP: 1, FLP: FL, xTP: xT, Y: 1, Fg: 1, x: 0, xs: 0, dPmax: 0, FF: 1, Rev: 0, FR: 1,
      Q: 0, rho1: 0, rho2: 0, c2: 0, vOutMS: 0, machOut: 0, sigma: 0, xF: 0, z, iterations: 0,
      steam: null, kUsed: num(p.k, 1.3), mUsed: num(p.M, 20), zUsed: num(p.Z, 1), tUsedC: num(p.T, 20) };
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
        const dPmax = Math.pow(FLP / FP, 2) * dPeff;           // choked ΔP limit
        const choked = dP >= dPmax;
        const Cn = choked ? (Q / (N.N1 * FLP)) * Math.sqrt(G / dPeff)  // choked turbulent
                          : (Q / (N.N1 * FP)) * Math.sqrt(G / dP);     // non-choked turbulent
        return { Cn, FP, FLP, dPmax, choked };
      };
    } else {
      let TuseC, M, Zf, k;
      if (fluid === 'steam') {
        const sp = calcSteamProps(P1, p.T, !!p.steamSaturated);
        const Tsat2C = steamSatTempC(Math.max(0.05, P2));
        // Approximate isenthalpic Joule-Thomson outlet temperature for steam (~0.45 °C/bar moderate range)
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
        const Cn = (W / (N.N8 * FP * P1 * Y)) * Math.sqrt(TK * Zf / (xs * M)); // mass-flow form with T, Z, M
        return { Cn, FP, xTP, Y, xs, choked, dPmax: xChoke * P1 };
      };
    }
    // fixed-point iteration on C (C appears in FP / FLP / xTP)
    let C = f(1e-9).Cn, r, i = 0;
    for (; i < 200; i++) {
      r = f(C);
      if (Math.abs(r.Cn - C) <= 1e-10 * Math.max(1, C)) { C = r.Cn; break; }
      C = r.Cn;
    }
    r = f(C);
    Object.assign(out, { Cturb: C, FP: r.FP, choked: r.choked, dPmax: r.dPmax, iterations: i, rho1, Q });
    if (!isCompressible) out.FLP = r.FLP; else Object.assign(out, { xTP: r.xTP, Y: r.Y, xs: r.xs });

    // Reynolds number factor (screening): solve C·FR(Rev(C), C) = C_turb (Rev depends on C) by log-bisection
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

    // Downstream pipe velocity & Mach number (using D2)
    const A2 = (Math.PI / 4) * Math.pow(D2 / 1000, 2);
    if (!isCompressible) {
      out.rho2 = rho1;
      out.vOutMS = (Q / 3600) / Math.max(1e-9, A2);
      out.machOut = 0;
    } else {
      const TK2 = Math.max(100, (out.steam ? out.steam.T2EstC : out.tUsedC) + 273.15);
      out.rho2 = Math.max(0.005, (Math.max(0.01, P2) * 1e5 * out.mUsed) / (out.zUsed * RU * TK2));
      out.vOutMS = (W / (3600 * out.rho2)) / Math.max(1e-9, A2);
      out.c2 = Math.sqrt((out.kUsed * out.zUsed * RU * TK2) / out.mUsed);
      out.machOut = out.vOutMS / Math.max(1, out.c2);
    }
    return out;
  }

  /** IEC 60534-8-4 estimate of incipient-cavitation pressure ratio when manufacturer xFz is unavailable (Cv basis, N34 = 1). */
  const estimateXFz = (Crated, Fd, FL) => 0.90 / Math.sqrt(1 + 3 * Fd * Math.sqrt(Math.max(0, Crated) / FL));

  // ---------------------------------------------------------------- full calc
  const POINTS = [['min', 'Min'], ['norm', 'Normal'], ['max', 'Max']];

  function defaultState() {
    return {
      tag: 'LV-3102', service: 'Lean Amine Booster Pump Discharge Flow Control',
      fluid: 'liquid', valveType: 'globe-eqp', sizeIn: 0, trimFactor: 1.0,
      pipeMode: 'asme', d1Nps: '4"', d1Sch: 'Sch 40', d2Nps: '4"', d2Sch: 'Sch 40',
      pipeIdMm: 102.26, d1Mm: 102.26, d2Mm: 102.26, atmBara: 1.01325,
      wMin: 42500, wNorm: 129400, wMax: 142300,
      p1Min: 26.5, p1Norm: 24.8, p1Max: 24.0, p2Min: 19.6, p2Norm: 20.4, p2Max: 20.9,
      rho: 1035, pvBara: 0.28, pcBara: 220.64, viscCp: 2.85,
      tempC: 35, mw: 18.6, k: 1.27, z: 0.92, steamSaturated: false,
      pSysVarBar: 2.8, // variable piping+equipment friction at max flow (for Valve Authority N)
      customVendor: false, customCrated: 170, customFL: 0.90, customXT: 0.72, customFd: 0.46
    };
  }

  function resolvePipes(s, rawInput) {
    // Backwards compatibility: if caller passed raw pipeIdMm without d1Nps/d2Nps and didn't request asme, honor pipeIdMm directly
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
    } else {
      v.isCustom = false;
    }
    return v;
  }

  function sizeForValve(s, v, idx, pipes, trimFactor) {
    const d = SIZES_MM[idx];
    const baseCr = v.cv[idx];
    const Cr = (s.customVendor && num(s.customCrated, 0) > 0) ? num(s.customCrated, baseCr) : baseCr * trimFactor;
    const atm = num(s.atmBara, 1.01325);
    const pts = POINTS.map(([key, label]) => {
      const K = key[0].toUpperCase() + key.slice(1);
      const r = sizePoint({
        fluid: s.fluid, W: s['w' + K], P1: num(s['p1' + K], 0) + atm, P2: num(s['p2' + K], 0) + atm,
        rho: s.rho, pv: s.pvBara, pc: s.pcBara, mu: s.viscCp, T: s.tempC, M: s.mw, k: s.k, Z: s.z,
        steamSaturated: !!s.steamSaturated,
        FL: v.FL, xT: v.xT, Fd: v.Fd, d, D1: pipes.D1, D2: pipes.D2
      });
      r.key = key; r.label = label;
      r.open = opening(r.C, Cr, v.char) * 100;
      return r;
    });
    const [pMin, pNorm, pMax] = pts;
    return { idx, sizeIn: SIZES_IN[idx], dMm: d, Crated: Cr, baseCrated: baseCr, trimFactor, pts, valid: pts.every(p => p.valid),
      normOk: pNorm.open >= 50 && pNorm.open <= 80, maxOk: pMax.open <= 90 && pMax.C <= Cr, minOk: pMin.open >= 10 };
  }

  function calc(input) {
    const s = Object.assign(defaultState(), input || {});
    s.fluid = s.fluid === 'steam' ? 'steam' : (s.fluid === 'gas' ? 'gas' : 'liquid');
    const vKey = VALVES[s.valveType] ? s.valveType : 'globe-eqp';
    const v = effectiveValve(s, VALVES[vKey]);
    const trimFactor = clamp(num(s.trimFactor, 1.0), 0.1, 1.0);
    s.trimFactor = trimFactor;
    const pipes = resolvePipes(s, input);
    s.pipeIdMm = pipes.D1;
    const Dlim = Math.min(pipes.D1, pipes.D2); // body size shouldn't exceed smallest connecting pipe
    const cands = SIZES_IN.map((_, i) => i).filter(i => v.cv[i] && SIZES_MM[i] <= 1.05 * Dlim);
    const forced = SIZES_IN.indexOf(num(s.sizeIn, 0));
    const options = cands.map(i => sizeForValve(s, v, i, pipes, trimFactor));
    let sel = null, basis = '';
    if (forced >= 0 && v.cv[forced]) {
      sel = sizeForValve(s, v, forced, pipes, trimFactor); basis = 'user-fixed size';
    } else if (options.length) {
      sel = options.find(o => o.valid && o.maxOk && o.normOk && o.minOk) || options.find(o => o.valid && o.maxOk && o.normOk)
        || options.find(o => o.valid && o.maxOk);
      basis = sel ? 'smallest size meeting opening criteria' : 'no size ≤ line size meets max ≤ 90 % (largest shown)';
      if (!sel) sel = options[options.length - 1];
    } else {
      sel = sizeForValve(s, v, v.cv.findIndex(c => c), pipes, trimFactor); basis = 'line smaller than smallest valve';
    }
    const pts = sel.pts;
    const [pMin, pNorm, pMax] = pts;
    const reqRange = pMin.C > 0 ? pMax.C / pMin.C : 0;
    const minControllable = sel.Crated / v.R;
    const rangeOk = pMin.C >= minControllable && sel.minOk;
    const selStatus = !sel.valid || !sel.maxOk ? 'FAIL' : (sel.normOk && sel.minOk ? 'PASS' : 'WARN');

    let regime = 'PASS', regimeText = '';
    const isLiq = s.fluid === 'liquid';
    const xFz = isLiq ? estimateXFz(sel.Crated, v.Fd, v.FL) : 0;
    pts.forEach(p => {
      p.cavIncipient = isLiq && p.valid && p.xF >= xFz;
      p.noise = calcNoise(p, v, sel.dMm, pipes.D2, pipes.wall2Mm, xFz);
    });

    if (!sel.valid) { regime = 'FAIL'; regimeText = 'Invalid point (W ≤ 0 or P1 ≤ P2)'; }
    else if (isLiq) {
      if (pts.some(p => p.flashing)) { regime = 'FAIL'; regimeText = 'FLASHING (P2 ≤ pv): special trim/body'; }
      else if (pts.some(p => p.choked)) { regime = 'WARN'; regimeText = 'CHOKED / full cavitation'; }
      else if (pts.some(p => p.cavIncipient)) { regime = 'WARN'; regimeText = 'Incipient cavitation (xF ≥ xFz)'; }
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

    // Governing acoustic noise across Min / Normal / Max
    const maxNoiseDb = Math.max(...pts.map(p => (p.noise ? p.noise.lpAe1m : 0)));
    const govNoisePt = pts.reduce((a, b) => ((b.noise?.lpAe1m || 0) > (a.noise?.lpAe1m || 0) ? b : a), pts[2]);
    const noiseStatus = maxNoiseDb > 85 ? 'FAIL' : maxNoiseDb > 80 ? 'WARN' : 'PASS';

    // Outlet velocity / Mach screening
    const maxVelOut = Math.max(...pts.map(p => p.vOutMS || 0));
    const maxMachOut = Math.max(...pts.map(p => p.machOut || 0));
    const exitStatus = isLiq
      ? (maxVelOut > (pts.some(p => p.flashing) ? 15 : 9) ? 'WARN' : 'PASS')
      : (maxMachOut > 0.50 ? 'FAIL' : maxMachOut > 0.30 ? 'WARN' : 'PASS');

    // Valve Authority & Installed Gain (ISA loop stability screening)
    const pSysVar = Math.max(0, num(s.pSysVarBar, 0));
    const dpMax = pMax.valid ? pMax.dP : 0;
    const authorityN = dpMax > 0 ? dpMax / (dpMax + pSysVar) : 1.0;
    const gainNorm = pNorm.valid ? installedGain(pNorm.open / 100, v.char, authorityN) : 1.0;
    const gainMin = pMin.valid ? installedGain(pMin.open / 100, v.char, authorityN) : 1.0;
    const gainMax = pMax.valid ? installedGain(pMax.open / 100, v.char, authorityN) : 1.0;
    const authorityStatus = authorityN < 0.25 || gainNorm < 0.5 || gainNorm > 3.0 ? 'WARN' : 'PASS';

    return {
      state: s, valve: Object.assign({ key: vKey }, v), pipes, options, sel, basis, pts, xFz,
      reqRange, minControllable, rangeOk, selStatus, regime, regimeText, laminar,
      noise: { maxDb: maxNoiseDb, govCase: govNoisePt.label, govRegime: govNoisePt.noise?.regime || '', status: noiseStatus },
      exit: { maxVelMS: maxVelOut, maxMach: maxMachOut, status: exitStatus },
      installed: { pSysVarBar: pSysVar, authorityN, gainMin, gainNorm, gainMax, status: authorityStatus }
    };
  }

  // ---------------------------------------------------------------- presets
  const presets = [
    { id: 'amine', label: 'LV-3102 Lean amine pump discharge (liquid, globe =%)', state: defaultState() },
    { id: 'fuelgas', label: 'PV-2101 Fuel-gas letdown 40→25 barg (gas, globe linear)', state: Object.assign(defaultState(), {
      tag: 'PV-2101', service: 'Fuel Gas Header Pressure Letdown',
      fluid: 'gas', valveType: 'globe-lin', pipeMode: 'asme', d1Nps: '3"', d1Sch: 'Sch 40', d2Nps: '4"', d2Sch: 'Sch 40',
      wMin: 1800, wNorm: 5200, wMax: 6800, p1Min: 41, p1Norm: 40, p1Max: 39, p2Min: 25, p2Norm: 25, p2Max: 25,
      tempC: 35, mw: 18.6, k: 1.27, z: 0.92, viscCp: 0.012, pSysVarBar: 0.8 }) },
    { id: 'propane', label: 'LV-2004 C3 reflux near bubble point (liquid, cavitation)', state: Object.assign(defaultState(), {
      tag: 'LV-2004', service: 'Propane Reflux Drum Level Control',
      fluid: 'liquid', valveType: 'globe-eqp', pipeMode: 'asme', d1Nps: '6"', d1Sch: 'Sch 40', d2Nps: '6"', d2Sch: 'Sch 40',
      wMin: 60000, wNorm: 150000, wMax: 175000, p1Min: 21.5, p1Norm: 20.8, p1Max: 20.5, p2Min: 16.0, p2Norm: 16.6, p2Max: 16.9,
      rho: 470, pvBara: 16.4, pcBara: 42.5, viscCp: 0.08, pSysVarBar: 1.5 }) },
    { id: 'steam', label: 'TV-0510 LP steam to reboiler (steam, butterfly)', state: Object.assign(defaultState(), {
      tag: 'TV-0510', service: 'LP Steam Supply to Amine Reboiler E-1002',
      fluid: 'steam', valveType: 'butterfly', pipeMode: 'asme', d1Nps: '8"', d1Sch: 'Sch 40', d2Nps: '8"', d2Sch: 'Sch 40',
      wMin: 3000, wNorm: 9000, wMax: 11000, p1Min: 4.5, p1Norm: 4.3, p1Max: 4.2, p2Min: 3.2, p2Norm: 3.3, p2Max: 3.4,
      tempC: 165, steamSaturated: false, pSysVarBar: 0.3 }) },
    { id: 'hpsteam', label: 'PV-0520 HP steam letdown 42→10 barg (steam, low-noise cage)', state: Object.assign(defaultState(), {
      tag: 'PV-0520', service: 'HP to MP Steam Header Letdown Station',
      fluid: 'steam', valveType: 'globe-lownoise', pipeMode: 'asme', d1Nps: '4"', d1Sch: 'Sch 80', d2Nps: '6"', d2Sch: 'Sch 80',
      wMin: 4500, wNorm: 14000, wMax: 18500, p1Min: 43.0, p1Norm: 42.0, p1Max: 41.0, p2Min: 10.0, p2Norm: 10.0, p2Max: 10.0,
      tempC: 365, steamSaturated: false, pSysVarBar: 1.0 }) }
  ];

  // ---------------------------------------------------------------- UI helpers
  const BAR_PSI = 14.5037738, KG_LB = 2.20462262, KGM3_LBFT3 = 0.06242796;
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
  const sizeLabel = (inch) => (inch === 1.5 ? '1½"' : inch + '"');
  const badge = (st, text) => `<span class="status-badge status-${st === 'PASS' ? 'pass' : st === 'WARN' ? 'warn' : 'fail'}">${text}</span>`;

  let state = defaultState();
  let root = null, ctx = null;
  const usc = () => !!(ctx && ctx.isUSC && ctx.isUSC());
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uLab = (k) => (usc() ? UNITS[k].usc : UNITS[k].si);
  const disp = (k, v, dp) => fmt(usc() ? UNITS[k].to(v) : v, dp);
  const inVal = (k, v) => { const x = usc() ? UNITS[k].to(num(v, 0)) : num(v, 0); return String(Number(x.toPrecision(6))); };
  const withU = (k, v, dp) => `${disp(k, v, dp)} ${uLab(k)}`;

  const STYLE = `
#toolPane-control-valve .cv-grid{display:grid;grid-template-columns:minmax(340px,0.92fr) minmax(420px,1.08fr);gap:1.1rem;align-items:start}
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
#toolPane-control-valve .cv-section{font-size:0.73rem;font-weight:700;color:var(--text-secondary);margin:0.55rem 0 0.35rem;text-transform:uppercase;letter-spacing:0.03em;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap}
#toolPane-control-valve .cv-action-bar{display:flex;gap:0.45rem;flex-wrap:wrap;padding:0.6rem 0.75rem;margin-bottom:0.85rem;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);align-items:center;justify-content:space-between}
#toolPane-control-valve .cv-pipe-pair{display:grid;grid-template-columns:1fr 1fr;gap:0.35rem}
#toolPane-control-valve .cv-custom-box{margin-top:0.45rem;padding:0.55rem 0.65rem;border:1px dashed var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-elevated)}
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
    const isLiq = state.fluid === 'liquid';
    const isSteam = state.fluid === 'steam';
    const isGas = state.fluid === 'gas';
    const v = VALVES[state.valveType] || VALVES['globe-eqp'];
    const cell = (key, kind) => `<td><input type="number" class="mono" id="control-valve-${key}" data-key="${key}" data-u="${kind}" step="any" value="${inVal(kind, state[key])}" /></td>`;
    const isAsme = state.pipeMode !== 'custom';
    root.innerHTML = `
    <div class="panel" style="margin-bottom:1rem;">
      <div class="panel-header">
        <div>
          <div class="panel-title">Control Valve Sizing Workbench (IEC 60534 / ANSI/ISA-75.01)</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">Liquid, Gas &amp; Steam Cv/Kv · ASME B36.10M D₁/D₂ · IEC 60534-8-3/-8-4 Noise (dBA) · Installed Characteristic &amp; Authority</div>
        </div>
        <div class="cv-head-ctrls">
          <label for="control-valve-preset" style="font-size:0.76rem;font-weight:700;color:var(--text-secondary);">Preset:</label>
          <select id="control-valve-preset" class="header-select" style="background:var(--bg-surface);color:var(--text-primary);border-color:var(--border-strong);">
            <option value="">Select preset…</option>
            ${presets.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}
          </select>
          <button type="button" id="control-valve-open-ipds" class="btn btn-primary" title="Open printable ISA-20 Control Valve Datasheet in Step 5">ISA-20 Datasheet / PDF →</button>
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
            <div class="cv-section">1. Service &amp; Operating Envelope (Min / Normal / Max)</div>
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
            <div class="field-group" style="margin-bottom:0.65rem;">
              <label class="field-label"><span>Fluid Phase</span><span class="field-sym">IEC 60534-2-1</span></label>
              <div class="segmented-control">
                <button type="button" class="seg-btn ${isLiq ? 'active' : ''}" id="control-valve-fluid-liquid" data-fluid="liquid">Liquid</button>
                <button type="button" class="seg-btn ${isGas ? 'active' : ''}" id="control-valve-fluid-gas" data-fluid="gas">Gas / Vapour</button>
                <button type="button" class="seg-btn ${isSteam ? 'active' : ''}" id="control-valve-fluid-steam" data-fluid="steam">Steam (IF97)</button>
              </div>
            </div>
            <table class="cv-optable">
              <thead><tr><th></th><th>Min</th><th>Normal</th><th>Max</th></tr></thead>
              <tbody>
                <tr><th>W [${uLab('flow')}]</th>${cell('wMin', 'flow')}${cell('wNorm', 'flow')}${cell('wMax', 'flow')}</tr>
                <tr><th>P₁ [${uLab('pg')}]</th>${cell('p1Min', 'pg')}${cell('p1Norm', 'pg')}${cell('p1Max', 'pg')}</tr>
                <tr><th>P₂ [${uLab('pg')}]</th>${cell('p2Min', 'pg')}${cell('p2Norm', 'pg')}${cell('p2Max', 'pg')}</tr>
              </tbody>
            </table>

            <div class="cv-section">2. Valve Body, Trim &amp; ASME B36.10M Piping</div>
            <div class="form-grid-2" style="margin-bottom:0.55rem;">
              <div class="field-group">
                <label class="field-label" for="control-valve-valveType"><span>Valve Style &amp; Trim</span><span class="field-sym">FL·xT·Fd</span></label>
                <div class="input-with-unit"><select id="control-valve-valveType" data-key="valveType">
                  ${Object.entries(VALVES).map(([k, o]) => `<option value="${k}" ${k === state.valveType ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-sizeIn"><span>Body Size</span><span class="field-sym">d</span></label>
                <div class="input-with-unit"><select id="control-valve-sizeIn" data-key="sizeIn">
                  <option value="0">Auto-select (50–80% norm)</option>
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

            <div class="cv-section">3. ${isLiq ? 'Liquid Physical Properties' : (isSteam ? 'Steam Conditions (IAPWS-IF97 Auto-Properties)' : 'Gas / Vapour Properties')}</div>
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
            <div class="cv-note">Catalogue FL, xT, Fd (IEC 60534-2-1 Table 2) and rated Cv are <strong>indicative</strong>; toggle Vendor Override above to verify certified datasheet values.</div>
          </div>

          <div>
            <div class="cv-metrics" id="control-valve-metrics"></div>
            <div class="cv-svgbox" id="control-valve-plot"></div>
            <div class="cv-svgbox" id="control-valve-installed-plot"></div>
            <div class="cv-svgbox" id="control-valve-indicator"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Whitebox Engineering Calculation Trace</div><span class="panel-std-ref">IEC 60534-2-1 · 60534-8-3 · 60534-8-4 · ASME B36.10M</span></div>
      <div class="panel-body">
        <div id="control-valve-table" style="overflow-x:auto;margin-bottom:0.8rem;"></div>
        <div class="cv-trace" id="control-valve-trace"></div>
      </div>
    </div>`;
    bind();
    renderOutputs();
  }

  function bind() {
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
      if (state.fluid === 'steam' && state.tempC < 120) state.tempC = 185;
      render();
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
      pipeIdMm: num(dis.idMm, state.pipeIdMm), sizeIn: 0, pSysVarBar: Number(pSysVar.toFixed(2))
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
    } else {
      setMsg('No matching phase in Peng-Robinson EOS.');
    }
    if (ctx && ctx.notifyChanged) ctx.notifyChanged();
  }

  function sendToStep1D() {
    const res = calc(state);
    if (!res.sel || !(res.sel.Crated > 0)) { setMsg('No valid Cv to send.'); return; }
    if (ctx && ctx.applyControlValveToStep1D) {
      const vtMap = { 'globe-lin': 'globe_single', 'globe-eqp': 'globe_single', 'globe-lownoise': 'globe_cage', 'eccentric-plug': 'eccentric_plug', 'butterfly': 'butterfly', 'ball': 'ball_segmented' };
      ctx.applyControlValveToStep1D({
        tag: res.state.tag,
        ratedCv: Number(res.sel.Crated.toFixed(1)),
        fluidPhase: res.state.fluid === 'liquid' ? 'liquid' : 'gas',
        valveType: vtMap[res.valve.key] || 'globe_single',
        xT: res.valve.xT,
        FL: res.valve.FL,
        upstreamPressureBarg: Number(num(res.state.p1Max, res.state.p1Norm).toFixed(2))
      });
      setMsg(`Sent Cv=${res.sel.Crated.toFixed(1)} to Step 1D CV Fail-Open.`);
    } else {
      setMsg('Step 1D bridge unavailable.');
    }
  }

  // ---------------------------------------------------------------- SVG Plots
  function plotSvg(res) {
    const W = 600, H = 265, L = 56, R = 18, T = 24, B = 40, pw = W - L - R, ph = H - T - B;
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
    let pathInh = '', pathInst = '';
    for (let i = 0; i <= 50; i++) {
      const h = i / 50;
      const qi = installedFlow(h, v.char, 1.0);
      const qn = installedFlow(h, v.char, Nv);
      pathInh += `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Yq(qi).toFixed(1)}`;
      pathInst += `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Yq(qn).toFixed(1)}`;
    }
    const grid = [0, 0.25, 0.5, 0.75, 1].map(t =>
      `<line x1="${X(t)}" y1="${T}" x2="${X(t)}" y2="${T + ph}" stroke="currentColor" stroke-opacity="0.1"/>
       <text x="${X(t)}" y="${T + ph + 13}" text-anchor="middle" font-size="9.5" fill="currentColor">${Math.round(t * 100)}%</text>
       <line x1="${L}" y1="${Yq(t)}" x2="${L + pw}" y2="${Yq(t)}" stroke="currentColor" stroke-opacity="0.1"/>
       <text x="${L - 6}" y="${Yq(t) + 3}" text-anchor="end" font-size="9.5" fill="currentColor">${Math.round(t * 100)}%</text>`
    ).join('');
    const pNorm = res.pts[1];
    const hNorm = pNorm.valid ? clamp(pNorm.open / 100, 0, 1) : 0.6;
    const qNorm = installedFlow(hNorm, v.char, Nv);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Inherent versus installed flow characteristic" id="control-valve-svg-installed">
      ${grid}
      <line x1="${X(0)}" y1="${Yq(0)}" x2="${X(1)}" y2="${Yq(1)}" stroke="currentColor" stroke-opacity="0.28" stroke-dasharray="3 3"/>
      <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="currentColor" stroke-opacity="0.35"/>
      <path d="${pathInh}" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="6 4"/>
      <path d="${pathInst}" fill="none" stroke="#10b981" stroke-width="2.4"/>
      <circle cx="${X(hNorm).toFixed(1)}" cy="${Yq(qNorm).toFixed(1)}" r="5" fill="#10b981" stroke="currentColor" stroke-width="1"/>
      <g transform="translate(${L + 10} ${T + 14})">
        <line x1="0" y1="-3" x2="18" y2="-3" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="5 3"/><text x="23" y="0" font-size="9.8" fill="currentColor">Inherent (N = 1.0)</text>
        <line x1="0" y1="12" x2="18" y2="12" stroke="#10b981" stroke-width="2.4"/><text x="23" y="15" font-size="9.8" font-weight="700" fill="currentColor">Installed (N = ${fmt(Nv, 2)}, Gain@Norm = ${fmt(res.installed.gainNorm, 2)})</text>
      </g>
      <text x="${L + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="10.2" fill="currentColor">Installed Characteristic — % Max Flow vs % Travel (Valve Authority N = ΔP_v / (ΔP_v + ΔP_sys))</text>
      <text transform="translate(13 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="10.2" fill="currentColor">% Flow</text>
      <text x="${L + pw}" y="${T - 7}" text-anchor="end" font-size="9.8" font-weight="700" fill="${res.installed.status === 'PASS' ? '#10b981' : '#f59e0b'}">Target: N ≥ 0.25, Gain 0.5–3.0</text>
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
      const bx = X(val);
      return `<text x="${L - 8}" y="${y + 15}" text-anchor="end" font-size="10.5" fill="currentColor">${p.label}</text>
        <rect x="${L}" y="${y + 3}" width="${Math.max(1, bx - L).toFixed(1)}" height="17" rx="3" fill="${col}" fill-opacity="0.45"/>
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
      <text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="10.2" fill="currentColor">${liq ? 'Liquid: xF = ΔP/(P₁ − p_v) vs xFz (IEC 60534-8-4) & predicted noise (dBA)' : 'Gas / Steam: x = ΔP/P₁ vs choked Fγ·xTP & predicted noise (dBA)'}</text>
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
        <span class="metric-box-sub">Kv = ${fmtSig(pMin.Kv, 3)} / ${fmtSig(pNorm.Kv, 3)} / ${fmtSig(pMax.Kv, 3)} m³/h</span></div>
      <div class="metric-box"><span class="metric-box-label">Selected Valve &amp; Trim</span>
        <span class="metric-box-main">${sizeLabel(sel.sizeIn)} (DN${sel.dMm}), Cv<sub>r</sub> = ${fmtSig(sel.Crated, 4)}</span>
        <span class="metric-box-sub">${Math.round(sel.trimFactor * 100)}% trim${v.isCustom ? ' · Vendor override' : ''} · ${esc(res.basis)}</span></div>
      <div class="metric-box"><span class="metric-box-label">Travel min / norm / max</span>
        <span class="metric-box-main">${fmt(pMin.open, 0)} / ${fmt(pNorm.open, 0)} / ${fmt(pMax.open, 0)} %</span>
        <span class="metric-box-sub">${badge(res.selStatus, res.selStatus === 'PASS' ? 'PASS: norm 50–80%, max ≤ 90%' : res.selStatus === 'WARN' ? 'WARN: travel outside target' : 'FAIL: over-travel / undersized')}</span></div>
      <div class="metric-box"><span class="metric-box-label">Flow Regime &amp; Rangeability</span>
        <span class="metric-box-main" style="font-size:0.86rem;">${badge(res.regime, esc(res.regimeText))}</span>
        <span class="metric-box-sub">${badge(res.rangeOk ? 'PASS' : 'WARN', `Req ${fmt(res.reqRange, 1)}:1 vs ${v.R}:1`)}${res.laminar ? ' · FR&lt;1' : ''}</span></div>
      <div class="metric-box"><span class="metric-box-label">Acoustic Noise L<sub>pAe,1m</sub> (IEC 60534-8-3/-4)</span>
        <span class="metric-box-main">${fmt(res.noise.maxDb, 1)} dBA <span style="font-size:0.75rem;color:var(--text-muted);">(${res.noise.govCase})</span></span>
        <span class="metric-box-sub">${badge(res.noise.status, res.noise.status === 'PASS' ? 'PASS ≤ 80 dBA' : res.noise.status === 'WARN' ? 'MARGINAL 80–85 dBA' : 'HIGH > 85 dBA — low-noise trim / heavier Sch')}</span></div>
      <div class="metric-box"><span class="metric-box-label">Outlet Pipe &amp; Valve Authority</span>
        <span class="metric-box-main">${liq ? `v₂ = ${fmt(res.exit.maxVelMS, 2)} m/s` : `M₂ = ${fmt(res.exit.maxMach, 3)}`} · N = ${fmt(res.installed.authorityN, 2)}</span>
        <span class="metric-box-sub">${badge(res.exit.status, liq ? (res.exit.status === 'PASS' ? 'Exit vel OK' : 'High exit vel') : (res.exit.status === 'PASS' ? 'M₂ ≤ 0.30 OK' : res.exit.status === 'WARN' ? 'M₂ 0.30–0.50' : 'M₂ > 0.50 expand D₂'))} · Gain ${fmt(res.installed.gainNorm, 2)}</span></div>`;

    const plot = root.querySelector('#control-valve-plot'); if (plot) plot.innerHTML = plotSvg(res);
    const iplot = root.querySelector('#control-valve-installed-plot'); if (iplot) iplot.innerHTML = installedSvg(res);
    const ind = root.querySelector('#control-valve-indicator'); if (ind) ind.innerHTML = indicatorSvg(res);

    const tbl = root.querySelector('#control-valve-table');
    if (tbl) tbl.innerHTML = `<table class="eng-table" style="font-size:0.74rem;width:100%;">
      <thead><tr><th>Case</th><th>W [${uLab('flow')}]</th><th>P₁ [${uLab('pa')}]</th><th>ΔP [${uLab('dp')}]</th><th>${liq ? `ΔP_max [${uLab('dp')}]` : 'x / Fγ·xTP'}</th><th>FP</th><th>${liq ? 'FLP' : 'Y'}</th><th>Rev / FR</th><th>Cv req.</th><th>Kv req.</th><th>Travel</th><th>${liq ? 'v₂ [m/s]' : 'M₂'}</th><th>Noise [dBA]</th><th>Status</th></tr></thead>
      <tbody>${res.pts.map(p => `<tr><td>${p.label}</td><td class="mono">${disp('flow', p.W, 0)}</td><td class="mono">${disp('pa', p.P1, 2)}</td><td class="mono">${disp('dp', p.dP, 3)}</td>
        <td class="mono">${liq ? disp('dp', p.dPmax, 3) : `${fmt(p.x, 3)} / ${fmt(p.Fg * p.xTP, 3)}`}</td><td class="mono">${fmt(p.FP, 4)}</td><td class="mono">${liq ? fmt(p.FLP, 4) : fmt(p.Y, 4)}</td>
        <td class="mono">${fmtSig(p.Rev, 3)} / ${fmt(p.FR, 3)}</td><td class="mono">${fmtSig(p.C, 4)}</td><td class="mono">${fmtSig(p.Kv, 4)}</td><td class="mono">${fmt(p.open, 1)}%</td>
        <td class="mono">${liq ? fmt(p.vOutMS, 2) : fmt(p.machOut, 3)}</td>
        <td class="mono">${fmt(p.noise?.lpAe1m, 1)}</td>
        <td>${!p.valid ? badge('FAIL', 'INVALID') : p.flashing ? badge('FAIL', 'FLASHING') : p.choked ? badge('WARN', 'CHOKED') : p.cavIncipient ? badge('WARN', 'CAV') : p.noise?.status === 'FAIL' ? badge('FAIL', '>85dBA') : badge('PASS', 'OK')}</td></tr>`).join('')}</tbody></table>`;

    const pm = pMax, z = pm.z, steps = [];
    const atm = num(res.state.atmBara, 1.01325);
    steps.push(step('1. Valve constants, trim &amp; ASME B36.10M piping', 'IEC 60534-2-1 Table 1 · ASME B36.10M',
      `Cv basis (bar): N1=${N.N1}, N2=${N.N2}, N4=${N.N4}, N5=${N.N5}, N6=${N.N6}, N8=${N.N8}; Kv = Cv/1.156`,
      `${esc(v.label)}: FL=${v.FL}, xT=${v.xT}, Fd=${v.Fd} (${v.isCustom ? 'vendor override' : 'typical'}); d=${sel.dMm} mm; D₁=${esc(res.pipes.label1)}, D₂=${esc(res.pipes.label2)} (t_s2=${fmt(res.pipes.wall2Mm, 2)} mm); P_abs = P_g + ${fmt(atm, 5)} bar`,
      `Rated Cv (${sizeLabel(sel.sizeIn)}, ${Math.round(sel.trimFactor * 100)}% trim) = ${fmtSig(sel.Crated, 4)}`));
    steps.push(step('2. Piping geometry factors (independent D₁ / D₂ reducer &amp; expander)', 'IEC 60534-2-1 §7.4 (FP, FLP, xTP)',
      'ζ₁ = 0.5(1 − d²/D₁²)², ζ₂ = 1.0(1 − d²/D₂²)², ζB1 = 1 − (d/D₁)⁴, ζB2 = 1 − (d/D₂)⁴, Σζ = ζ₁ + ζ₂ + ζB1 − ζB2',
      `ζ₁ = ${fmt(z.z1, 4)}, ζ₂ = ${fmt(z.z2, 4)}, ζB1 − ζB2 = ${fmt(z.zB1 - z.zB2, 4)} → Σζ = ${fmt(z.sum, 4)}; max case C = ${fmtSig(pm.C, 4)}, d = ${sel.dMm} mm`,
      `FP = ${fmt(pm.FP, 4)}; ${liq ? `FLP = ${fmt(pm.FLP, 4)}` : `xTP = ${fmt(pm.xTP, 4)}`}`));
    if (liq) {
      steps.push(step('3. Liquid choked-flow limit &amp; required Cv', 'IEC 60534-2-1 incompressible flow',
        'FF = 0.96 − 0.28·√(p_v/p_c);  ΔP_max = (FLP/FP)²·(P₁ − FF·p_v);  C = Q/(N1·FP)·√((ρ₁/ρ₀)/ΔP)',
        `p_v = ${fmt(num(res.state.pvBara, 0), 3)} bara, p_c = ${fmt(num(res.state.pcBara, 0), 2)} bara → FF = ${fmt(pm.FF, 4)}; ΔP_max(max) = ${fmt(pm.dPmax, 3)} bar`,
        res.pts.map(p => `Cv_${p.key} = ${fmtSig(p.C, 4)}`).join(' | ') + (pm.flashing ? ' (FLASHING: P₂ ≤ p_v)' : pm.choked ? ' (CHOKED)' : ''),
        pm.flashing ? 'FAIL' : pm.choked ? 'WARN' : 'PASS'));
    } else if (isSteam && pm.steam) {
      steps.push(step('3. Steam properties (IAPWS-IF97 + PR EOS) &amp; choked expansion', 'IAPWS-IF97 · IEC 60534-2-1 compressible',
        'Fγ = γ/1.40;  Y = 1 − min(x, Fγ·xTP)/(3·Fγ·xTP);  C = W/(N8·FP·P₁·Y)·√(T₁·Z₁/(x_s·M))',
        `P₁(max)=${fmt(pm.P1, 2)} bara → T_sat(P₁)=${fmt(pm.steam.TsatC, 1)} °C, T₁=${fmt(pm.steam.TuseC, 1)} °C (ΔT_sh=${fmt(pm.steam.superheatC, 1)} °C), ρ₁=${fmt(pm.rho1, 3)} kg/m³, Z₁=${fmt(pm.zUsed, 4)}, γ=${fmt(pm.kUsed, 3)}; T_sat(P₂)=${fmt(pm.steam.Tsat2C, 1)} °C`,
        res.pts.map(p => `Cv_${p.key} = ${fmtSig(p.C, 4)}`).join(' | ') + `; Y(max)=${fmt(pm.Y, 4)}${pm.choked ? ' (CHOKED)' : ''}`,
        pm.steam.wetSteam || pm.choked ? 'WARN' : 'PASS'));
    } else {
      steps.push(step('3. Gas choked-flow limit, expansion factor &amp; required Cv', 'IEC 60534-2-1 compressible flow (N8 form)',
        'Fγ = γ/1.40;  Y = 1 − min(x, Fγ·xTP)/(3·Fγ·xTP);  C = W/(N8·FP·P₁·Y)·√(T₁·Z₁/(x_s·M))',
        `γ=${fmt(pm.kUsed, 3)} → Fγ=${fmt(pm.Fg, 4)}, M=${fmt(pm.mUsed, 2)}, Z₁=${fmt(pm.zUsed, 3)}, ρ₁(max)=${fmt(pm.rho1, 3)} kg/m³; x(max)=${fmt(pm.x, 4)} vs Fγ·xTP=${fmt(pm.Fg * pm.xTP, 4)}`,
        res.pts.map(p => `Cv_${p.key} = ${fmtSig(p.C, 4)}`).join(' | ') + `; Y(max)=${fmt(pm.Y, 4)}${pm.choked ? ' (CHOKED)' : ''}`,
        pm.choked ? 'WARN' : 'PASS'));
    }
    steps.push(step('4. Reynolds number factor FR &amp; inherent travel', 'IEC 60534-2-1 non-turbulent · IEC 60534-2-4',
      v.char === 'lin' ? 'Linear: h = C/C_rated  |  Rev ≥ 10⁴ ⇒ FR = 1' : 'Equal-%: h = 1 + ln(C/C_rated)/ln(50)  |  Rev ≥ 10⁴ ⇒ FR = 1',
      res.pts.map(p => `${p.label}: Rev=${fmtSig(p.Rev, 3)}, FR=${fmt(p.FR, 3)}, h=${fmt(p.open, 1)}%`).join(' | '),
      `Rangeability req. ${fmt(res.reqRange, 1)}:1 vs ${v.R}:1 · ${res.selStatus}`,
      res.selStatus));
    steps.push(step('5. Acoustic noise screening &amp; outlet pipe hydraulics', liq ? 'IEC 60534-8-4 Hydrodynamic' : 'IEC 60534-8-3 Aerodynamic',
      'L_pAe,1m = L_pi + TL_pipe(D₂, t_s, f_p) − 10·log₁₀((D₂+2)/D₂) − ΔL_trim   |   OSHA / EPC limit ≤ 85 dBA',
      res.pts.map(p => `${p.label}: ${fmt(p.noise?.lpAe1m, 1)} dBA (f_p=${fmt(p.noise?.fpHz, 0)} Hz, ${liq ? `v₂=${fmt(p.vOutMS, 2)} m/s` : `M₂=${fmt(p.machOut, 3)}`})`).join(' | '),
      `Max predicted noise = ${fmt(res.noise.maxDb, 1)} dBA (${res.noise.govCase} · ${res.noise.govRegime}) → ${res.noise.status}`,
      res.noise.status));
    steps.push(step('6. Installed flow characteristic &amp; valve authority', 'ISA Control Loop Controllability',
      'N = ΔP_v,max / (ΔP_v,max + ΔP_sys,var);  q_inst(h) = φ(h)/√(N + (1−N)φ(h)²);  G_inst = dq_inst/dh',
      `ΔP_v,max = ${fmt(pm.dP, 2)} bar, ΔP_sys,var = ${fmt(res.installed.pSysVarBar, 2)} bar → N = ${fmt(res.installed.authorityN, 3)}; Installed gain Min/Norm/Max = ${fmt(res.installed.gainMin, 2)} / ${fmt(res.installed.gainNorm, 2)} / ${fmt(res.installed.gainMax, 2)}`,
      res.installed.status === 'PASS' ? 'PASS: Good valve authority & linear installed loop gain (0.5–3.0)' : 'WARN: Low authority (N < 0.25) or extreme installed gain — consider equal-% trim or higher valve ΔP allocation',
      res.installed.status));
    if (liq) {
      steps.push(step('7. Cavitation index screening', 'IEC 60534-8-4 · ISA-RP75.23',
        'xF = ΔP/(P₁ − p_v) = 1/σ;  incipient cavitation if xF ≥ xFz ≈ 0.90/√(1 + 3·Fd·√(C_rated/FL))',
        res.pts.map(p => `${p.label}: xF=${fmt(p.xF, 3)}, σ=${fmt(p.sigma, 2)}`).join(' | '),
        `xFz = ${fmt(res.xFz, 3)} → ${res.pts.some(p => p.cavIncipient) ? 'Cavitation expected: select multi-stage anti-cavitation cage trim' : 'Below incipient cavitation'}`,
        res.pts.some(p => p.cavIncipient) ? 'WARN' : 'PASS'));
    }
    const tr = root.querySelector('#control-valve-trace');
    if (tr) tr.innerHTML = steps.join('') + `<div class="cv-note">Method: IEC 60534-2-1:2011 (ISA-75.01.01) turbulent sizing with converged FP/FLP/xTP for asymmetric D₁/D₂, IAPWS-IF97 + PR steam properties, and IEC 60534-8-3/-8-4 acoustic noise screening. For final procurement, verify certified vendor trim curves, actuator thrust/torque, and multi-stage whisper-trim attenuation.</div>`;
    if (ctx && ctx.notifyChanged) ctx.notifyChanged();
  }

  // ---------------------------------------------------------------- tool object
  const tool = {
    id: 'control-valve',
    standaloneTab: 'tab-cv',
    title: 'Control Valve Sizing (IEC 60534)',
    std: 'IEC 60534-2-1 / -8-3 / -8-4 · ISA-20',
    presets,
    constants: N,
    valves: VALVES,
    pipes: PIPE_SCHEDULES,
    calc,
    sizePoint,
    helpers: { zetas, calcFP, calcFLP, calcXTP, calcFF, calcY, calcRev, calcFR, opening, cvAtTravel, installedFlow, installedGain, estimateXFz, steamSatTempC, calcSteamProps, calcNoise, lookupPipe, KV_PER_CV, RHO0 },
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
        ['Connecting piping D1 / D2', `${r.pipes.label1} / ${r.pipes.label2}`, 'ASME B36.10M / Custom'],
        ['Selected size / rated Cv', `${sizeLabel(r.sel.sizeIn)} (DN${r.sel.dMm}) / ${fmtSig(r.sel.Crated, 4)}`, r.basis],
        ['Required Cv min / norm / max', `${fmtSig(a.C, 4)} / ${fmtSig(b.C, 4)} / ${fmtSig(c.C, 4)}`, `Kv ${fmtSig(a.Kv, 4)} / ${fmtSig(b.Kv, 4)} / ${fmtSig(c.Kv, 4)} m³/h`],
        ['Travel min / norm / max', `${fmt(a.open, 1)} / ${fmt(b.open, 1)} / ${fmt(c.open, 1)} %`, `${r.selStatus} (norm 50–80%, max ≤ 90%)`],
        ['Flow regime & rangeability', `${r.regimeText} · ${fmt(r.reqRange, 1)}:1`, r.regime],
        ['Predicted noise L_pAe,1m', `${fmt(r.noise.maxDb, 1)} dBA (${r.noise.govCase})`, `${r.noise.status} (limit ≤ 85 dBA)`],
        ['Outlet velocity / Mach & authority', r.state.fluid === 'liquid' ? `v₂=${fmt(r.exit.maxVelMS, 2)} m/s, N=${fmt(r.installed.authorityN, 2)}` : `M₂=${fmt(r.exit.maxMach, 3)}, N=${fmt(r.installed.authorityN, 2)}`, `Gain@Norm=${fmt(r.installed.gainNorm, 2)}`]
      ];
    }
  };

  if (typeof window !== 'undefined' && window.PSVTools) window.PSVTools.register(tool);
  if (typeof module !== 'undefined' && module.exports) module.exports = tool;
})();
