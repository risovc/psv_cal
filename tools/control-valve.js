/**
 * PSVCalc Pro — Step 7 toolkit module: Control Valve Sizing per IEC 60534-2-1:2011 (= ANSI/ISA-75.01.01).
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

  // Typical/indicative valve data — FL, xT, Fd from IEC 60534-2-1 Table 2 (typical values at rated travel);
  // rated Cv per size are representative vendor-catalogue magnitudes ONLY (always confirm with vendor data).
  const SIZES_IN = [1, 1.5, 2, 3, 4, 6, 8, 10, 12];
  const SIZES_MM = [25, 40, 50, 80, 100, 150, 200, 250, 300];
  const VALVES = {
    'globe-lin': { label: 'Globe, contoured plug, linear (flow-to-open)', char: 'lin', R: 30, FL: 0.90, xT: 0.72, Fd: 0.46,
      cv: [12, 28, 50, 110, 195, 400, 640, 1000, 1440] },
    'globe-eqp': { label: 'Globe, contoured plug, equal-% (flow-to-open)', char: 'eqp', R: 50, FL: 0.90, xT: 0.72, Fd: 0.46,
      cv: [10, 24, 42, 95, 170, 360, 580, 920, 1300] },
    'butterfly': { label: 'Butterfly, swing-through, 70° (≈ equal-%)', char: 'eqp', R: 20, FL: 0.62, xT: 0.35, Fd: 0.57,
      cv: [null, null, 90, 220, 400, 950, 1750, 2800, 4100] },
    'ball': { label: 'Segmented (V-notch) ball, 90° (≈ equal-%)', char: 'eqp', R: 100, FL: 0.60, xT: 0.30, Fd: 0.98,
      cv: [30, 70, 120, 290, 520, 1150, 2050, 3200, 4600] }
  };
  const EQP_R = 50; // inherent equal-percentage characteristic used for travel (R = 50)

  const num = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

  // ---------------------------------------------------------- one operating point
  /**
   * Size one operating point. All pressures ABSOLUTE bar, W kg/h, T °C, d/D mm, mu cP.
   * p = { fluid, W, P1, P2, rho, pv, pc, mu, T, M, k, Z, FL, xT, Fd, d, D1, D2 }
   * Returns required Cv (and Kv) by fixed-point iteration of the implicit IEC equations (FP, FLP, xTP depend on C).
   */
  function sizePoint(p) {
    const fluid = p.fluid === 'gas' ? 'gas' : 'liquid';
    const W = Math.max(0, num(p.W, 0));
    const P1 = Math.max(0.01, num(p.P1, 1));
    const P2 = Math.max(0, num(p.P2, 0));
    const dP = P1 - P2;
    const FL = clamp(num(p.FL, 0.9), 0.3, 1), xT = clamp(num(p.xT, 0.7), 0.05, 1), Fd = clamp(num(p.Fd, 0.46), 0.05, 1);
    const d = Math.max(5, num(p.d, 100));
    const z = zetas(d, Math.max(d, num(p.D1, d)), Math.max(d, num(p.D2, num(p.D1, d))));
    const mu = Math.max(1e-4, num(p.mu, 1)); // cP
    const out = { fluid, W, P1, P2, dP, valid: W > 0 && dP > 0, choked: false, flashing: false, cavIncipient: false,
      C: 0, Kv: 0, Cturb: 0, FP: 1, FLP: FL, xTP: xT, Y: 1, Fg: 1, x: 0, xs: 0, dPmax: 0, FF: 1, Rev: 0, FR: 1,
      Q: 0, rho1: 0, sigma: 0, xF: 0, z, iterations: 0 };
    if (!out.valid) return out;

    let rho1, Q, f;
    if (fluid === 'liquid') {
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
      const T = num(p.T, 20) + 273.15, M = Math.max(1, num(p.M, 20)), Zf = clamp(num(p.Z, 1), 0.05, 2), k = clamp(num(p.k, 1.3), 1.0, 2.0);
      rho1 = (P1 * 1e5 * M) / (Zf * RU * Math.max(1, T));
      Q = W / rho1;
      out.Fg = k / 1.40;
      out.x = dP / P1;
      f = (C) => {
        const FP = calcFP(C, d, z), xTP = calcXTP(C, d, z, xT, FP);
        const xChoke = out.Fg * xTP, choked = out.x >= xChoke, xs = Math.min(out.x, xChoke);
        const Y = calcY(out.x, out.Fg, xTP);
        const Cn = (W / (N.N8 * FP * P1 * Y)) * Math.sqrt(T * Zf / (xs * M)); // mass-flow form with T, Z, M
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
    if (fluid === 'liquid') out.FLP = r.FLP; else Object.assign(out, { xTP: r.xTP, Y: r.Y, xs: r.xs });

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
    return out;
  }

  /** IEC 60534-8-4 estimate of incipient-cavitation pressure ratio when manufacturer xFz is unavailable (Cv basis, N34 = 1). */
  const estimateXFz = (Crated, Fd, FL) => 0.90 / Math.sqrt(1 + 3 * Fd * Math.sqrt(Math.max(0, Crated) / FL));

  // ---------------------------------------------------------------- full calc
  const POINTS = [['min', 'Min'], ['norm', 'Normal'], ['max', 'Max']];

  function defaultState() {
    return {
      tag: 'LV-3102', fluid: 'liquid', valveType: 'globe-eqp', sizeIn: 0, pipeIdMm: 102.3, atmBara: 1.01325,
      wMin: 42500, wNorm: 129400, wMax: 142300,
      p1Min: 26.5, p1Norm: 24.8, p1Max: 24.0, p2Min: 19.6, p2Norm: 20.4, p2Max: 20.9,
      rho: 1035, pvBara: 0.28, pcBara: 220.64, viscCp: 2.85,
      tempC: 35, mw: 18.6, k: 1.27, z: 0.92
    };
  }

  function sizeForValve(s, v, idx) {
    const d = SIZES_MM[idx], Cr = v.cv[idx], atm = num(s.atmBara, 1.01325);
    const pts = POINTS.map(([key, label]) => {
      const K = key[0].toUpperCase() + key.slice(1);
      const r = sizePoint({
        fluid: s.fluid, W: s['w' + K], P1: num(s['p1' + K], 0) + atm, P2: num(s['p2' + K], 0) + atm,
        rho: s.rho, pv: s.pvBara, pc: s.pcBara, mu: s.viscCp, T: s.tempC, M: s.mw, k: s.k, Z: s.z,
        FL: v.FL, xT: v.xT, Fd: v.Fd, d, D1: s.pipeIdMm, D2: s.pipeIdMm
      });
      r.key = key; r.label = label;
      r.open = opening(r.C, Cr, v.char) * 100;
      return r;
    });
    const [pMin, pNorm, pMax] = pts;
    return { idx, sizeIn: SIZES_IN[idx], dMm: d, Crated: Cr, pts, valid: pts.every(p => p.valid),
      normOk: pNorm.open >= 50 && pNorm.open <= 80, maxOk: pMax.open <= 90 && pMax.C <= Cr, minOk: pMin.open >= 10 };
  }

  function calc(input) {
    const s = Object.assign(defaultState(), input || {});
    s.fluid = s.fluid === 'gas' ? 'gas' : 'liquid';
    const vKey = VALVES[s.valveType] ? s.valveType : 'globe-eqp';
    const v = VALVES[vKey];
    const D = Math.max(10, num(s.pipeIdMm, 100));
    s.pipeIdMm = D;
    const cands = SIZES_IN.map((_, i) => i).filter(i => v.cv[i] && SIZES_MM[i] <= 1.05 * D);
    const forced = SIZES_IN.indexOf(num(s.sizeIn, 0));
    const options = cands.map(i => sizeForValve(s, v, i));
    let sel = null, basis = '';
    if (forced >= 0 && v.cv[forced]) {
      sel = sizeForValve(s, v, forced); basis = 'user-fixed size';
    } else if (options.length) {
      sel = options.find(o => o.valid && o.maxOk && o.normOk && o.minOk) || options.find(o => o.valid && o.maxOk && o.normOk)
        || options.find(o => o.valid && o.maxOk);
      basis = sel ? 'smallest size meeting opening criteria' : 'no size ≤ line size meets max ≤ 90 % (largest shown)';
      if (!sel) sel = options[options.length - 1];
    } else {
      sel = sizeForValve(s, v, v.cv.findIndex(c => c)); basis = 'line smaller than smallest valve';
    }
    const pts = sel.pts;
    const [pMin, , pMax] = pts;
    const reqRange = pMin.C > 0 ? pMax.C / pMin.C : 0;
    const minControllable = sel.Crated / v.R;
    const rangeOk = pMin.C >= minControllable && sel.minOk;
    const selStatus = !sel.valid || !sel.maxOk ? 'FAIL' : (sel.normOk && sel.minOk ? 'PASS' : 'WARN');
    let regime = 'PASS', regimeText = '';
    const xFz = s.fluid === 'liquid' ? estimateXFz(sel.Crated, v.Fd, v.FL) : 0;
    pts.forEach(p => { p.cavIncipient = s.fluid === 'liquid' && p.valid && p.xF >= xFz; });
    if (!sel.valid) { regime = 'FAIL'; regimeText = 'Invalid point (W ≤ 0 or P1 ≤ P2)'; }
    else if (s.fluid === 'liquid') {
      if (pts.some(p => p.flashing)) { regime = 'FAIL'; regimeText = 'FLASHING (P2 ≤ pv): special trim/body'; }
      else if (pts.some(p => p.choked)) { regime = 'WARN'; regimeText = 'CHOKED / full cavitation'; }
      else if (pts.some(p => p.cavIncipient)) { regime = 'WARN'; regimeText = 'Incipient cavitation (xF ≥ xFz)'; }
      else regimeText = 'Non-choked, no cavitation';
    } else {
      regime = pts.some(p => p.choked) ? 'WARN' : 'PASS';
      regimeText = regime === 'WARN' ? 'CHOKED (x ≥ Fγ·xTP): check noise' : 'Non-choked (x < Fγ·xTP)';
    }
    const laminar = pts.some(p => p.valid && p.Rev < 10000);
    return { state: s, valve: Object.assign({ key: vKey }, v), options, sel, basis, pts, xFz,
      reqRange, minControllable, rangeOk, selStatus, regime, regimeText, laminar };
  }

  // ---------------------------------------------------------------- presets
  const presets = [
    { id: 'amine', label: 'LV-3102 Lean amine pump discharge (liquid, globe =%)', state: defaultState() },
    { id: 'fuelgas', label: 'PV-2101 Fuel-gas letdown 40→25 barg (gas, globe linear)', state: Object.assign(defaultState(), {
      tag: 'PV-2101', fluid: 'gas', valveType: 'globe-lin', pipeIdMm: 77.9,
      wMin: 1800, wNorm: 5200, wMax: 6800, p1Min: 41, p1Norm: 40, p1Max: 39, p2Min: 25, p2Norm: 25, p2Max: 25,
      tempC: 35, mw: 18.6, k: 1.27, z: 0.92, viscCp: 0.012 }) },
    { id: 'propane', label: 'LV-2004 C3 reflux near bubble point (liquid, cavitation)', state: Object.assign(defaultState(), {
      tag: 'LV-2004', valveType: 'globe-eqp', pipeIdMm: 154.1,
      wMin: 60000, wNorm: 150000, wMax: 175000, p1Min: 21.5, p1Norm: 20.8, p1Max: 20.5, p2Min: 16.0, p2Norm: 16.6, p2Max: 16.9,
      rho: 470, pvBara: 16.4, pcBara: 42.5, viscCp: 0.08 }) },
    { id: 'steam', label: 'TV-0510 LP steam to reboiler (vapour, butterfly)', state: Object.assign(defaultState(), {
      tag: 'TV-0510', fluid: 'gas', valveType: 'butterfly', pipeIdMm: 202.7,
      wMin: 3000, wNorm: 9000, wMax: 11000, p1Min: 4.5, p1Norm: 4.3, p1Max: 4.2, p2Min: 3.2, p2Norm: 3.3, p2Max: 3.4,
      tempC: 165, mw: 18.015, k: 1.31, z: 0.98, viscCp: 0.014 }) }
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
#toolPane-control-valve .cv-grid{display:grid;grid-template-columns:minmax(330px,0.9fr) minmax(420px,1.1fr);gap:1.1rem;align-items:start}
#toolPane-control-valve .cv-metrics{display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-bottom:0.8rem}
#toolPane-control-valve .cv-optable{width:100%;border-collapse:collapse;font-size:0.76rem;margin-bottom:0.8rem}
#toolPane-control-valve .cv-optable th{font-weight:700;color:var(--text-secondary);text-align:left;padding:0.2rem 0.25rem;white-space:nowrap}
#toolPane-control-valve .cv-optable td{padding:0.2rem 0.25rem}
#toolPane-control-valve .cv-optable input{width:100%;min-width:0;box-sizing:border-box;padding:0.35rem 0.45rem;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary)}
#toolPane-control-valve .cv-svgbox{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0.4rem;margin-bottom:0.7rem;color:var(--text-secondary)}
#toolPane-control-valve .cv-svgbox svg{width:100%;height:auto;display:block}
#toolPane-control-valve .cv-trace{display:flex;flex-direction:column;gap:0.6rem}
#toolPane-control-valve .cv-note{font-size:0.72rem;color:var(--text-muted);line-height:1.45;margin-top:0.5rem}
#toolPane-control-valve .cv-head-ctrls{display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap}
#toolPane-control-valve .cv-msg{font-size:0.72rem;color:var(--text-secondary)}
#toolPane-control-valve .cv-section{font-size:0.74rem;font-weight:700;color:var(--text-secondary);margin:0.4rem 0 0.35rem;text-transform:uppercase;letter-spacing:0.03em}
#toolPane-control-valve .metric-box-sub .status-badge{white-space:normal}
@media (max-width:1100px){#toolPane-control-valve .cv-grid{grid-template-columns:1fr}}`;

  function field(key, label, sym, kind) {
    return `<div class="field-group">
      <label class="field-label" for="control-valve-${key}"><span>${label}</span><span class="field-sym">${sym}</span></label>
      <div class="input-with-unit"><input type="number" id="control-valve-${key}" data-key="${key}" data-u="${kind}" step="any" value="${inVal(kind, state[key])}" />${kind !== 'none' ? `<span class="unit-addon">${uLab(kind)}</span>` : ''}</div>
    </div>`;
  }

  function render() {
    if (!root) return;
    const liq = state.fluid === 'liquid';
    const v = VALVES[state.valveType] || VALVES['globe-eqp'];
    const cell = (key, kind) => `<td><input type="number" class="mono" id="control-valve-${key}" data-key="${key}" data-u="${kind}" step="any" value="${inVal(kind, state[key])}" /></td>`;
    root.innerHTML = `
    <div class="panel" style="margin-bottom:1rem;">
      <div class="panel-header">
        <div>
          <div class="panel-title">Control Valve Sizing: IEC 60534-2-1:2011 / ANSI/ISA-75.01.01</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">Liquid &amp; gas/vapour Cv/Kv at min / normal / max with FP, FLP, xTP, FF, Y, FR, choked-flow &amp; cavitation checks</div>
        </div>
        <div class="cv-head-ctrls">
          <label for="control-valve-preset" style="font-size:0.76rem;font-weight:700;color:var(--text-secondary);">Preset:</label>
          <select id="control-valve-preset" class="header-select" style="background:var(--bg-surface);color:var(--text-primary);border-color:var(--border-strong);">
            <option value="">Select preset…</option>
            ${presets.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}
          </select>
          <button type="button" id="control-valve-pull-pump" class="btn btn-secondary" title="Pre-fill liquid conditions from Step 4 pump loop (CV ΔP allocation, flows, ρ, pv)">⇐ Pull from Step 4 pump loop</button>
          <span id="control-valve-msg" class="cv-msg"></span>
        </div>
      </div>
      <div class="panel-body">
        <div class="cv-grid">
          <div>
            <div class="cv-section">Operating conditions</div>
            <table class="cv-optable">
              <thead><tr><th></th><th>Min</th><th>Normal</th><th>Max</th></tr></thead>
              <tbody>
                <tr><th>W [${uLab('flow')}]</th>${cell('wMin', 'flow')}${cell('wNorm', 'flow')}${cell('wMax', 'flow')}</tr>
                <tr><th>P₁ [${uLab('pg')}]</th>${cell('p1Min', 'pg')}${cell('p1Norm', 'pg')}${cell('p1Max', 'pg')}</tr>
                <tr><th>P₂ [${uLab('pg')}]</th>${cell('p2Min', 'pg')}${cell('p2Norm', 'pg')}${cell('p2Max', 'pg')}</tr>
              </tbody>
            </table>
            <div class="form-grid-2" style="margin-bottom:0.6rem;">
              <div class="field-group">
                <label class="field-label" for="control-valve-tag"><span>Valve tag</span><span class="field-sym">Tag</span></label>
                <div class="input-with-unit"><input type="text" id="control-valve-tag" data-key="tag" class="mono" value="${esc(state.tag)}" /></div>
              </div>
              <div class="field-group">
                <label class="field-label"><span>Fluid phase</span><span class="field-sym">IEC</span></label>
                <div class="segmented-control">
                  <button type="button" class="seg-btn ${liq ? 'active' : ''}" id="control-valve-fluid-liquid" data-fluid="liquid">Liquid</button>
                  <button type="button" class="seg-btn ${liq ? '' : 'active'}" id="control-valve-fluid-gas" data-fluid="gas">Gas / vapour</button>
                </div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-valveType"><span>Valve style (typical data)</span><span class="field-sym">FL·xT·Fd</span></label>
                <div class="input-with-unit"><select id="control-valve-valveType" data-key="valveType">
                  ${Object.entries(VALVES).map(([k, o]) => `<option value="${k}" ${k === state.valveType ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                </select></div>
              </div>
              <div class="field-group">
                <label class="field-label" for="control-valve-sizeIn"><span>Valve size</span><span class="field-sym">d</span></label>
                <div class="input-with-unit"><select id="control-valve-sizeIn" data-key="sizeIn">
                  <option value="0">Auto-select</option>
                  ${SIZES_IN.map((s, i) => v.cv[i] ? `<option value="${s}" ${s === Number(state.sizeIn) ? 'selected' : ''}>${sizeLabel(s)} (DN${SIZES_MM[i]})</option>` : '').join('')}
                </select></div>
              </div>
              ${field('pipeIdMm', 'Line inside diameter', 'D₁ = D₂', 'mm')}
              ${field('viscCp', 'Dynamic viscosity', 'μ', 'cp')}
            </div>
            <div class="cv-section">${liq ? 'Liquid properties' : 'Gas / vapour properties'}</div>
            <div class="form-grid-2">
              ${liq ? field('rho', 'Density at inlet', 'ρ₁', 'dens') + field('pvBara', 'Vapour pressure', 'p_v', 'pa') + field('pcBara', 'Critical pressure', 'p_c', 'pa')
                    : field('tempC', 'Inlet temperature', 'T₁', 'temp') + field('mw', 'Molar mass', 'M', 'none') + field('k', 'Specific heat ratio', 'γ', 'none') + field('z', 'Compressibility', 'Z₁', 'none')}
              ${field('atmBara', 'Atmospheric pressure', 'p_atm', 'pa')}
            </div>
            <div class="cv-note">Valve data (FL, xT, Fd per IEC 60534-2-1 Table 2 typical values; rated Cv per size) are <strong>typical / indicative</strong>. Replace with the selected vendor's certified data for final sizing.</div>
          </div>
          <div>
            <div class="cv-metrics" id="control-valve-metrics"></div>
            <div class="cv-svgbox" id="control-valve-plot"></div>
            <div class="cv-svgbox" id="control-valve-indicator"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Whitebox calculation trace</div><span class="panel-std-ref">IEC 60534-2-1:2011 · IEC 60534-8-4</span></div>
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
        if (inp.type === 'text') state[key] = inp.value.slice(0, 40);
        else {
          const x = Number(inp.value);
          if (inp.value === '' || !Number.isFinite(x)) return;
          const u = UNITS[inp.dataset.u] || UNITS.none;
          state[key] = usc() ? u.from(x) : x;
        }
        renderOutputs();
      };
      inp.addEventListener('input', h); inp.addEventListener('change', h);
    });
    root.querySelectorAll('select[data-key]').forEach(sel => sel.addEventListener('change', () => {
      state[sel.dataset.key] = sel.dataset.key === 'sizeIn' ? Number(sel.value) : sel.value;
      if (sel.dataset.key === 'valveType') { state.sizeIn = 0; render(); } else renderOutputs();
    }));
    root.querySelectorAll('[data-fluid]').forEach(b => b.addEventListener('click', () => { state.fluid = b.dataset.fluid; render(); }));
    const ps = root.querySelector('#control-valve-preset');
    ps.addEventListener('change', () => {
      const p = presets.find(x => x.id === ps.value);
      if (p) { tool.setState(JSON.parse(JSON.stringify(p.state))); const n = root.querySelector('#control-valve-preset'); if (n) n.value = p.id; }
    });
    root.querySelector('#control-valve-pull-pump').addEventListener('click', pullFromPump);
  }

  function pullFromPump() {
    let r = null;
    try { r = ctx && ctx.getPumpResult ? ctx.getPumpResult() : null; } catch (e) { r = null; }
    if (!r || !r.controlValve || !r.suction) { const m0 = root.querySelector('#control-valve-msg'); if (m0) m0.textContent = 'Step 4 pump result unavailable.'; return; }
    const g = 9.80665, rho = num(r.rhoKgM3, 1000), cv = r.controlValve, Qr = Math.max(1e-6, num(r.Q_ratedM3Hr, 1));
    const dis = r.discharge || {}, suc = r.suction;
    // CV inlet pressure re-derived as in engine.calcPumpLoopHydraulics (pump-curve head, line/equipment friction ∝ Q²)
    const p1 = (pt) => {
      const q2 = Math.pow(num(pt.flowM3Hr, 0) / Qr, 2);
      const psuc = num(suc.nozzleBarg, 0) + num(suc.dP_totalBar, 0) * (1 - q2);
      return psuc + num(pt.pumpHeadM, 0) * rho * g / 1e5 - (num(dis.dP_equipBar, 0) + 0.5 * num(dis.dP_pipeBar, 0)) * q2;
    };
    const next = Object.assign({}, state, { fluid: 'liquid', rho, viscCp: num(r.viscCp, state.viscCp), pvBara: num(r.vaporPressBara, state.pvBara),
      pipeIdMm: num(dis.idMm, state.pipeIdMm), sizeIn: 0 });
    [['Min', cv.min], ['Norm', cv.normal], ['Max', cv.rated]].forEach(([K, pt]) => {
      const P1 = p1(pt || {});
      next['w' + K] = num((pt || {}).flowM3Hr, 0) * rho;
      next['p1' + K] = P1;
      next['p2' + K] = P1 - num((pt || {}).availableCvDpBar, 0);
    });
    tool.setState(next);
    const m = root.querySelector('#control-valve-msg');
    if (m) m.textContent = `Pulled Step 4: ΔP_CV,rated ${withU('dp', num(cv.rated && cv.rated.availableCvDpBar, 0), 2)}, ρ ${withU('dens', rho, 1)}.`;
    if (ctx && ctx.notifyChanged) ctx.notifyChanged();
  }

  function plotSvg(res) {
    const W = 600, H = 290, L = 56, R = 18, T = 24, B = 42, pw = W - L - R, ph = H - T - B;
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
      const x = X(h), y = Yc(c);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${colors[p.key]}" stroke="${p.choked ? '#dc2626' : 'currentColor'}" stroke-width="${p.choked ? 2.5 : 1}"/>`;
    }).join('');
    // legend (avoids label collisions between nearby points)
    const legend = vp.map((p, i) => `<g transform="translate(${L + 10} ${T + 28 + i * 15})"><circle r="4.5" cx="0" cy="-3.5" fill="${colors[p.key]}" stroke="${p.choked ? '#dc2626' : 'currentColor'}" stroke-width="${p.choked ? 2 : 0.8}"/><text x="9" y="0" font-size="10.5" font-weight="700" fill="currentColor">${p.label}: h = ${fmt(p.open, 0)} %, Cv = ${fmtSig(p.C, 3)}${p.choked ? ' (choked)' : ''}</text></g>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cv versus travel with operating points" id="control-valve-svg-plot">
      <rect x="${X(0.1)}" y="${T}" width="${X(0.9) - X(0.1)}" height="${ph}" fill="rgba(56,189,248,0.08)"/>
      <rect x="${X(0.5)}" y="${T}" width="${X(0.8) - X(0.5)}" height="${ph}" fill="rgba(34,197,94,0.16)"/>
      <text x="${X(0.65)}" y="${T + 12}" text-anchor="middle" font-size="9.5" fill="currentColor">normal 50–80 %</text>
      <text x="${X(0.9) - 4}" y="${T + ph - 6}" text-anchor="end" font-size="9.5" fill="currentColor">operable 10–90 %</text>
      ${grid}
      <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="currentColor" stroke-opacity="0.4"/>
      <path d="${path}" fill="none" stroke="var(--accent-primary)" stroke-width="2.2"/>
      ${pts}${legend}
      <text x="${L + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="currentColor">Travel h [%], ${v.char === 'lin' ? 'linear' : 'equal-% (R = 50)'} inherent characteristic</text>
      <text transform="translate(13 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="currentColor">Cv</text>
      <text x="${L + pw}" y="${T - 8}" text-anchor="end" font-size="10.5" font-weight="700" fill="currentColor">${esc(sizeLabel(res.sel.sizeIn))} ${esc(v.label.split(',')[0])}, rated Cv ${fmtSig(Cr, 4)}</text>
    </svg>`;
  }

  function indicatorSvg(res) {
    const liq = res.state.fluid === 'liquid';
    const W = 600, H = 150, L = 64, R = 200, T = 28, rowH = 30;
    const pm = res.pts[2];
    const vals = res.pts.map(p => (liq ? Math.min(p.xF, 1.5) : p.x));
    const lines = liq
      ? [{ v: res.xFz, lab: `xFz ${fmt(res.xFz, 2)} (incipient)`, col: '#eab308' },
         { v: pm.valid ? pm.dPmax / Math.max(1e-9, pm.P1 - num(res.state.pvBara, 0)) : 0, lab: 'choked (max case)', col: '#dc2626' }]
      : [{ v: pm.Fg * pm.xTP, lab: `Fγ·xTP ${fmt(pm.Fg * pm.xTP, 3)} (choked)`, col: '#dc2626' }];
    const vmax = clamp(Math.max(1, ...vals, ...lines.map(l => l.v)) * 1.08, 0.2, 1.65);
    const pw = W - L - R, X = v => L + clamp(v / vmax, 0, 1) * pw;
    const bars = res.pts.map((p, i) => {
      const y = T + i * rowH, val = vals[i];
      const col = !p.valid ? '#94a3b8' : (p.flashing ? '#dc2626' : p.choked ? '#f97316' : p.cavIncipient ? '#eab308' : '#22c55e');
      const txt = !p.valid ? 'invalid' : liq ? `xF ${fmt(p.xF, 3)}, σ ${fmt(p.sigma, 2)}${p.flashing ? ', FLASHING' : p.choked ? ', CHOKED' : p.cavIncipient ? ', cavitating' : ''}`
        : `x ${fmt(val, 3)}, Y ${fmt(p.Y, 3)}${p.choked ? ', CHOKED' : ''}`;
      const bx = X(val);
      return `<text x="${L - 8}" y="${y + 15}" text-anchor="end" font-size="10.5" fill="currentColor">${p.label}</text>
        <rect x="${L}" y="${y + 3}" width="${Math.max(1, bx - L).toFixed(1)}" height="17" rx="3" fill="${col}" fill-opacity="0.45"/>
        <text x="${L + pw + 10}" y="${y + 15.5}" font-size="10" font-weight="700" fill="currentColor">${txt}</text>`;
    }).join('');
    const ls = lines.filter(l => l.v > 0).map((l, i) => {
      const x = X(l.v), right = x > L + pw - 110;
      return `<line x1="${x}" y1="${T - 4 - i * 0}" x2="${x}" y2="${T + 3 * rowH}" stroke="${l.col}" stroke-width="2" stroke-dasharray="5 3"/>
      <text x="${x}" y="${T - 8 - i * 11}" text-anchor="${right ? 'end' : 'start'}" dx="${right ? -4 : 4}" font-size="9.5" fill="currentColor">${l.lab}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Choked flow and cavitation indicator" id="control-valve-svg-indicator">
      ${bars}${ls}
      <line x1="${L}" y1="${T + 3 * rowH + 2}" x2="${L + pw}" y2="${T + 3 * rowH + 2}" stroke="currentColor" stroke-opacity="0.4"/>
      <text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="currentColor">${liq ? 'Liquid: xF = ΔP/(P₁ − p_v) vs incipient cavitation (xFz, IEC 60534-8-4) and choked limit' : 'Gas: x = ΔP/P₁ vs choked limit Fγ·xTP (IEC 60534-2-1)'}</text>
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
    const sel = res.sel, v = res.valve, liq = res.state.fluid === 'liquid';
    const [pMin, pNorm, pMax] = res.pts;
    const m = root.querySelector('#control-valve-metrics');
    if (m) m.innerHTML = `
      <div class="metric-box"><span class="metric-box-label">Required Cv (min / norm / max)</span>
        <span class="metric-box-main" style="color:var(--accent-primary);">${fmtSig(pMin.C, 3)} / ${fmtSig(pNorm.C, 3)} / ${fmtSig(pMax.C, 3)}</span>
        <span class="metric-box-sub">Kv = ${fmtSig(pMin.Kv, 3)} / ${fmtSig(pNorm.Kv, 3)} / ${fmtSig(pMax.Kv, 3)} m³/h</span></div>
      <div class="metric-box"><span class="metric-box-label">Selected valve</span>
        <span class="metric-box-main">${sizeLabel(sel.sizeIn)} (DN${sel.dMm}), rated Cv ${fmtSig(sel.Crated, 4)}</span>
        <span class="metric-box-sub">${esc(res.basis)}</span></div>
      <div class="metric-box"><span class="metric-box-label">Travel min / norm / max</span>
        <span class="metric-box-main">${fmt(pMin.open, 0)} / ${fmt(pNorm.open, 0)} / ${fmt(pMax.open, 0)} %</span>
        <span class="metric-box-sub">${badge(res.selStatus, res.selStatus === 'PASS' ? 'PASS: norm 50–80 %, max ≤ 90 %' : res.selStatus === 'WARN' ? 'WARN: opening outside target' : 'FAIL: over-travel / undersized')}</span></div>
      <div class="metric-box"><span class="metric-box-label">Flow regime &amp; rangeability</span>
        <span class="metric-box-main" style="font-size:0.9rem;">${badge(res.regime, esc(res.regimeText))}</span>
        <span class="metric-box-sub">${badge(res.rangeOk ? 'PASS' : 'WARN', `Required ${fmt(res.reqRange, 1)}:1 vs ${v.R}:1`)}${res.laminar ? ' FR &lt; 1 (non-turbulent)' : ''}</span></div>`;
    const plot = root.querySelector('#control-valve-plot'); if (plot) plot.innerHTML = plotSvg(res);
    const ind = root.querySelector('#control-valve-indicator'); if (ind) ind.innerHTML = indicatorSvg(res);

    const tbl = root.querySelector('#control-valve-table');
    if (tbl) tbl.innerHTML = `<table class="eng-table" style="font-size:0.74rem;width:100%;">
      <thead><tr><th>Case</th><th>W [${uLab('flow')}]</th><th>P₁ [${uLab('pa')}]</th><th>ΔP [${uLab('dp')}]</th><th>${liq ? `ΔP_max [${uLab('dp')}]` : 'x / Fγ·xTP'}</th><th>FP</th><th>${liq ? 'FLP' : 'Y'}</th><th>Rev / FR</th><th>Cv req.</th><th>Kv req.</th><th>Travel</th><th>Status</th></tr></thead>
      <tbody>${res.pts.map(p => `<tr><td>${p.label}</td><td class="mono">${disp('flow', p.W, 0)}</td><td class="mono">${disp('pa', p.P1, 2)}</td><td class="mono">${disp('dp', p.dP, 3)}</td>
        <td class="mono">${liq ? disp('dp', p.dPmax, 3) : `${fmt(p.x, 3)} / ${fmt(p.Fg * p.xTP, 3)}`}</td><td class="mono">${fmt(p.FP, 4)}</td><td class="mono">${liq ? fmt(p.FLP, 4) : fmt(p.Y, 4)}</td>
        <td class="mono">${fmtSig(p.Rev, 3)} / ${fmt(p.FR, 3)}</td><td class="mono">${fmtSig(p.C, 4)}</td><td class="mono">${fmtSig(p.Kv, 4)}</td><td class="mono">${fmt(p.open, 1)} %</td>
        <td>${!p.valid ? badge('FAIL', 'INVALID') : p.flashing ? badge('FAIL', 'FLASHING') : p.choked ? badge('WARN', 'CHOKED') : p.cavIncipient ? badge('WARN', 'CAVITATION') : badge('PASS', 'OK')}</td></tr>`).join('')}</tbody></table>`;

    const pm = pMax, z = pm.z, steps = [];
    const atm = num(res.state.atmBara, 1.01325);
    steps.push(step('1. Numerical constants &amp; valve data', 'IEC 60534-2-1 Table 1 · Table 2',
      `Cv basis (bar): N1 = ${N.N1}, N2 = ${N.N2}, N4 = ${N.N4}, N5 = ${N.N5}, N6 = ${N.N6}, N8 = ${N.N8};  Kv = Cv/1.156 (IEC 60534-1)`,
      `${esc(v.label)}: FL = ${v.FL}, xT = ${v.xT}, Fd = ${v.Fd} (typical); d = ${sel.dMm} mm, D = ${fmt(res.state.pipeIdMm, 1)} mm; P_abs = P_g + ${fmt(atm, 5)} bar (trace evaluated in bar units)`,
      `Rated Cv (${sizeLabel(sel.sizeIn)}) = ${fmtSig(sel.Crated, 4)} (indicative catalogue value)`));
    steps.push(step('2. Piping geometry factor (reducer / expander)', 'IEC 60534-2-1 piping geometry factors FP, FLP, xTP',
      'ζ₁ = 0.5(1 − d²/D₁²)², ζ₂ = 1.0(1 − d²/D₂²)², ζB = 1 − (d/D)⁴, Σζ = ζ₁ + ζ₂ + ζB1 − ζB2;  FP = [1 + Σζ/N2·(C/d²)²]^-½',
      `ζ₁ = ${fmt(z.z1, 4)}, ζ₂ = ${fmt(z.z2, 4)}, ζB1 − ζB2 = ${fmt(z.zB1 - z.zB2, 4)} → Σζ = ${fmt(z.sum, 4)}; max case C = ${fmtSig(pm.C, 4)}, d = ${sel.dMm} mm`,
      `FP = ${fmt(pm.FP, 4)}${z.sum === 0 ? ' (line-size valve)' : ''}; ${liq ? `FLP = FL/[1 + FL²(ζ₁+ζB1)/N2·(C/d²)²]^½ = ${fmt(pm.FLP, 4)}` : `xTP = (xT/FP²)/[1 + xT(ζ₁+ζB1)/N5·(C/d²)²] = ${fmt(pm.xTP, 4)}`}`));
    if (liq) {
      steps.push(step('3. Liquid choked-flow limit', 'IEC 60534-2-1 incompressible, choked turbulent flow',
        'FF = 0.96 − 0.28·√(p_v/p_c);  ΔP_max = (FLP/FP)²·(P₁ − FF·p_v)',
        `p_v = ${fmt(num(res.state.pvBara, 0), 3)} bara, p_c = ${fmt(num(res.state.pcBara, 0), 2)} bara → FF = ${fmt(pm.FF, 4)}; max case P₁ = ${fmt(pm.P1, 3)} bara, ΔP = ${fmt(pm.dP, 3)} bar`,
        `ΔP_max = ${fmt(pm.dPmax, 3)} bar → ${pm.choked ? 'CHOKED: sizing uses P₁ − FF·p_v' : 'non-choked (ΔP < ΔP_max)'}${pm.flashing ? '; P₂ ≤ p_v: FLASHING' : ''}`,
        pm.flashing ? 'FAIL' : pm.choked ? 'WARN' : 'PASS'));
      steps.push(step('4. Required flow coefficient (each case)', 'IEC 60534-2-1 incompressible, turbulent flow',
        'Non-choked: C = Q/(N1·FP)·√((ρ₁/ρ₀)/ΔP)   |   Choked: C = Q/(N1·FLP)·√((ρ₁/ρ₀)/(P₁ − FF·p_v))   (ρ₀ = 999.1 kg/m³)',
        res.pts.map(p => `${p.label}: Q = ${fmtSig(p.Q, 4)} m³/h, ΔP = ${fmt(p.dP, 3)} bar${p.choked ? ' (choked)' : ''}`).join('; ') + `; ρ₁/ρ₀ = ${fmt(num(res.state.rho, 0) / RHO0, 4)}`,
        res.pts.map(p => `Cv_${p.key} = ${fmtSig(p.C, 4)}`).join(' | ') + ' (FP/FLP iterated to convergence)'));
    } else {
      steps.push(step('3. Gas choked-flow limit &amp; expansion factor', 'IEC 60534-2-1 compressible flow',
        'Fγ = γ/1.40;  x = ΔP/P₁;  choked if x ≥ Fγ·xTP;  Y = 1 − x/(3·Fγ·xTP), x ≤ Fγ·xTP ⇒ Y ≥ 2/3',
        `γ = ${fmt(num(res.state.k, 0), 3)} → Fγ = ${fmt(pm.Fg, 4)}; max case x = ${fmt(pm.x, 4)}, Fγ·xTP = ${fmt(pm.Fg * pm.xTP, 4)}`,
        `Y = ${fmt(pm.Y, 4)}: ${pm.choked ? 'CHOKED (x_sizing = Fγ·xTP, Y = 0.667)' : 'non-choked'}`, pm.choked ? 'WARN' : 'PASS'));
      steps.push(step('4. Required flow coefficient, mass-flow form', 'IEC 60534-2-1 compressible flow (N8 form)',
        'C = W/(N8·FP·P₁·Y)·√(T₁·Z₁/(x·M))   (equivalent N6 form: C = W/(N6·FP·Y·√(x·P₁·ρ₁)))',
        `T₁ = ${fmt(num(res.state.tempC, 0) + 273.15, 2)} K, M = ${fmt(num(res.state.mw, 0), 3)}, Z₁ = ${fmt(num(res.state.z, 0), 3)}; ` + res.pts.map(p => `${p.label}: W = ${fmt(p.W, 0)} kg/h, P₁ = ${fmt(p.P1, 3)} bara, x = ${fmt(p.xs, 4)}`).join('; '),
        res.pts.map(p => `Cv_${p.key} = ${fmtSig(p.C, 4)}`).join(' | ') + `; ρ₁(max) = ${fmt(pm.rho1, 3)} kg/m³`));
    }
    steps.push(step('5. Reynolds number factor FR (screening)', 'IEC 60534-2-1 non-turbulent flow, full-size trim',
      'Rev = N4·Fd·Q/(ν·√(C·FL))·[FL²C²/(N2·d⁴) + 1]^¼;  Rev ≥ 10⁴ ⇒ FR = 1, else FR = min{1 + 0.33√FL/n₁^¼·log(Rev/10⁴), 0.026/FL·√(n₁·Rev), 1}, n₁ = N2/(C/d²)²',
      res.pts.map(p => `${p.label}: Rev = ${fmtSig(p.Rev, 3)}`).join('; '),
      res.pts.map(p => `FR_${p.key} = ${fmt(p.FR, 3)}`).join(' | ') + (res.laminar ? ': non-turbulent, C = C_turb/FR applied (simplified, verify with vendor)' : ': fully turbulent'),
      res.laminar ? 'WARN' : 'PASS'));
    steps.push(step('6. Travel from inherent characteristic &amp; selection', 'IEC 60534-2-4 inherent flow characteristic',
      v.char === 'lin' ? 'Linear: C/C_rated = h  ⇒  h = C/C_rated' : 'Equal-%: C/C_rated = R^(h−1), R = 50  ⇒  h = 1 + ln(C/C_rated)/ln R',
      `C_rated = ${fmtSig(sel.Crated, 4)}; criteria: normal 50–80 %, max ≤ 90 %, min ≥ 10 %; min controllable C = C_rated/${v.R} = ${fmtSig(res.minControllable, 3)}`,
      `h = ${fmt(pMin.open, 1)} / ${fmt(pNorm.open, 1)} / ${fmt(pMax.open, 1)} %; rangeability required ${fmt(res.reqRange, 1)}:1 (${res.rangeOk ? 'OK' : 'check'})`,
      res.selStatus));
    if (liq) {
      steps.push(step('7. Cavitation index (screening)', 'IEC 60534-8-4 · ISA-RP75.23',
        'xF = ΔP/(P₁ − p_v) = 1/σ;  incipient cavitation if xF ≥ xFz;  xFz ≈ 0.90/√(1 + 3·Fd·√(C_rated/FL)) (estimate with rated C, conservative; use manufacturer xFz when available)',
        res.pts.map(p => `${p.label}: xF = ${fmt(p.xF, 3)}, σ = ${fmt(p.sigma, 2)}`).join('; '),
        `xFz = ${fmt(res.xFz, 3)} → ${res.pts.some(p => p.cavIncipient) ? 'cavitation expected: consider anti-cavitation trim / staged ΔP' : 'below incipient cavitation'}`,
        res.pts.some(p => p.cavIncipient) ? 'WARN' : 'PASS'));
    }
    const tr = root.querySelector('#control-valve-trace');
    if (tr) tr.innerHTML = steps.join('') + `<div class="cv-note">Method: IEC 60534-2-1:2011 (ISA-75.01.01) turbulent sizing with converged FP/FLP/xTP iteration. FR is a simplified full-size-trim screening; xFz is the IEC 60534-8-4 estimate; valve FL/xT/Fd and rated Cv are typical values and FL/xT are taken constant over travel. Noise (IEC 60534-8-3/-8-4) and actuator sizing are not covered.</div>`;
    if (ctx && ctx.notifyChanged) ctx.notifyChanged();
  }

  // ---------------------------------------------------------------- tool object
  const tool = {
    id: 'control-valve',
    title: 'Control Valve Sizing (IEC 60534)',
    std: 'IEC 60534-2-1:2011 · ISA-75.01.01',
    presets,
    constants: N,
    valves: VALVES,
    calc,
    sizePoint,
    helpers: { zetas, calcFP, calcFLP, calcXTP, calcFF, calcY, calcRev, calcFR, opening, cvAtTravel, estimateXFz, KV_PER_CV, RHO0 },
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
        ['Valve tag / service', String(r.state.tag || ''), r.state.fluid === 'gas' ? 'Gas / vapour' : 'Liquid'],
        ['Valve style', r.valve.label, `FL ${r.valve.FL}, xT ${r.valve.xT}, Fd ${r.valve.Fd} (typical)`],
        ['Selected size / rated Cv', `${sizeLabel(r.sel.sizeIn)} / ${fmtSig(r.sel.Crated, 4)}`, r.basis],
        ['Required Cv min / norm / max', `${fmtSig(a.C, 4)} / ${fmtSig(b.C, 4)} / ${fmtSig(c.C, 4)}`, `Kv ${fmtSig(a.Kv, 4)} / ${fmtSig(b.Kv, 4)} / ${fmtSig(c.Kv, 4)} m³/h`],
        ['Travel min / norm / max', `${fmt(a.open, 1)} / ${fmt(b.open, 1)} / ${fmt(c.open, 1)} %`, `${r.selStatus} (norm 50–80 %, max ≤ 90 %)`],
        ['Flow regime', r.regimeText, r.regime],
        ['Rangeability required', `${fmt(r.reqRange, 1)}:1`, `${r.rangeOk ? 'PASS' : 'WARN'} vs ${r.valve.R}:1 indicative`]
      ];
    }
  };

  if (typeof window !== 'undefined' && window.PSVTools) window.PSVTools.register(tool);
  if (typeof module !== 'undefined' && module.exports) module.exports = tool;
})();
