/**
 * PSVCalc Pro — Step 7 toolkit module: Fluid Properties (Peng-Robinson EOS).
 *
 * Method (all SI internally: T [K], P [Pa], V [m³/mol], R = 8.314462618 J/(mol·K)):
 *  - Peng, D.-Y. & Robinson, D.B. (1976) Ind. Eng. Chem. Fundam. 15(1) 59-64, Eqs. (4),(9)-(13),(17)-(19);
 *    κ(ω) for ω > 0.491 per the 1978 PR revision (Robinson & Peng, GPA RR-28).
 *  - van der Waals one-fluid mixing rules, a_ij = (1 − k_ij)·√(a_i a_j)  (PR 1976 Eqs. 14-15).
 *  - Wilson (1968) K-value initialisation; Rachford & Rice (1952) objective solved on the
 *    negative-flash window of Whitson & Michelsen (1989); successive substitution on PR fugacities
 *    (Michelsen & Mollerup, "Thermodynamic Models: Fundamentals & Computational Aspects", Ch. 10).
 *  - Cubic root choice by minimum Gibbs energy (lowest Σ x_i ln φ_i).
 *  - Residual properties: U^R, C_v^R and C_p − C_v from the PR pressure-explicit form
 *    (Poling, Prausnitz & O'Connell, "Properties of Gases and Liquids" 5th ed., Ch. 6).
 *  - Liquid density with Péneloux et al. (1982) volume translation, PR form
 *    c_i = 0.50033·(0.25969 − Z_RA,i)·R·T_ci/P_ci (Pedersen & Christensen, Phase Behavior of Petroleum
 *    Reservoir Fluids, §4.5), Z_RA from Yamada & Gunn (1973): Z_RA = 0.29056 − 0.08775·ω.
 *  - Vapour viscosity: Lee, Gonzalez & Eakin (1966) JPT 18(8) 997 — ESTIMATE (±2-4 % lean gas).
 *
 * Data: T_c, P_c, ω, MW from Poling, Prausnitz & O'Connell 5th ed. Appendix A (≈ GPSA Fig. 23-2).
 * Ideal-gas Cp = A + B·T + C·T² + D·T³ [J/(mol·K)], T in K, from Reid, Prausnitz & Poling,
 * "Properties of Gases and Liquids" 4th ed. Appendix A (valid ≈ 273-1500 K).
 */
(function () {
  'use strict';
  const R = 8.314462618;
  const SQ2 = Math.SQRT2;

  // id, label, MW [g/mol], Tc [K], Pc [bar], ω, Cp°: A, B, C, D
  const LIB = [
    ['N2', 'Nitrogen N₂', 28.014, 126.20, 33.98, 0.037, 31.15, -1.357e-2, 2.680e-5, -1.168e-8],
    ['CO2', 'Carbon dioxide CO₂', 44.010, 304.12, 73.74, 0.225, 19.80, 7.344e-2, -5.602e-5, 1.715e-8],
    ['H2S', 'Hydrogen sulfide H₂S', 34.082, 373.40, 89.63, 0.090, 31.94, 1.436e-3, 2.432e-5, -1.176e-8],
    ['H2', 'Hydrogen H₂', 2.016, 33.19, 13.13, -0.216, 27.14, 9.274e-3, -1.381e-5, 7.645e-9],
    ['O2', 'Oxygen O₂', 31.999, 154.58, 50.43, 0.022, 28.11, -3.680e-6, 1.746e-5, -1.065e-8],
    ['H2O', 'Water H₂O', 18.015, 647.14, 220.64, 0.344, 32.24, 1.924e-3, 1.055e-5, -3.596e-9],
    ['C1', 'Methane C₁', 16.043, 190.56, 45.99, 0.011, 19.25, 5.213e-2, 1.197e-5, -1.132e-8],
    ['C2', 'Ethane C₂', 30.070, 305.32, 48.72, 0.099, 5.409, 1.781e-1, -6.938e-5, 8.713e-9],
    ['C3', 'Propane C₃', 44.097, 369.83, 42.48, 0.152, -4.224, 3.063e-1, -1.586e-4, 3.215e-8],
    ['iC4', 'i-Butane iC₄', 58.123, 407.85, 36.40, 0.186, -1.390, 3.847e-1, -1.846e-4, 2.895e-8],
    ['nC4', 'n-Butane nC₄', 58.123, 425.12, 37.96, 0.200, 9.487, 3.313e-1, -1.108e-4, -2.822e-9],
    ['iC5', 'i-Pentane iC₅', 72.150, 460.39, 33.81, 0.229, -9.525, 5.066e-1, -2.729e-4, 5.723e-8],
    ['nC5', 'n-Pentane nC₅', 72.150, 469.70, 33.70, 0.252, -3.626, 4.873e-1, -2.580e-4, 5.305e-8],
    ['nC6', 'n-Hexane nC₆', 86.177, 507.60, 30.25, 0.300, -4.413, 5.820e-1, -3.119e-4, 6.494e-8],
    ['nC7', 'n-Heptane nC₇', 100.204, 540.20, 27.40, 0.350, -5.146, 6.762e-1, -3.651e-4, 7.658e-8],
    ['nC8', 'n-Octane nC₈', 114.231, 568.70, 24.90, 0.399, -6.096, 7.712e-1, -4.195e-4, 8.855e-8],
    ['nC9', 'n-Nonane nC₉', 128.258, 594.60, 22.90, 0.445, -8.374, 8.729e-1, -4.823e-4, 1.031e-7],
    ['nC10', 'n-Decane nC₁₀', 142.285, 617.70, 21.10, 0.490, -7.913, 9.609e-1, -5.288e-4, 1.131e-7],
    ['BENZ', 'Benzene', 78.114, 562.05, 48.95, 0.210, -33.92, 4.739e-1, -3.017e-4, 7.130e-8],
    ['TOL', 'Toluene', 92.141, 591.75, 41.08, 0.264, -24.35, 5.125e-1, -2.765e-4, 4.911e-8]
  ].map(r => ({ id: r[0], label: r[1], mw: r[2], tc: r[3], pc: r[4], omega: r[5], cp: [r[6], r[7], r[8], r[9]] }));
  const HC = new Set(['C1', 'C2', 'C3', 'iC4', 'nC4', 'iC5', 'nC5', 'nC6', 'nC7', 'nC8', 'nC9', 'nC10', 'BENZ', 'TOL', 'PSEUDO']);

  /** Typical PR k_ij (screening values, cf. Knapp et al. 1982 DECHEMA Vol. VI; Danesh 1998 Table 4.1). */
  function kijTypical(a, b) {
    const pair = (p, q) => (a === p && b === q) || (a === q && b === p);
    const withHC = (g) => (a === g && HC.has(b)) || (b === g && HC.has(a));
    if (pair('CO2', 'N2')) return -0.02;
    if (pair('CO2', 'H2S')) return 0.10;
    if (pair('N2', 'H2S')) return 0.17;
    if (pair('N2', 'C1')) return 0.03;
    if (pair('CO2', 'C1')) return 0.10;
    if (pair('H2S', 'C1')) return 0.08;
    if (withHC('CO2')) return 0.13;
    if (withHC('N2')) return 0.08;
    if (withHC('H2S')) return 0.07;
    if (withHC('H2O')) return 0.48;
    return 0;
  }

  const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

  /** Ideal-gas molar Cp [J/(mol·K)] — Reid/Prausnitz/Poling 4th ed. App. A polynomial. */
  const cpIdeal = (c, T) => c.cp[0] + c.cp[1] * T + c.cp[2] * T * T + c.cp[3] * T * T * T;

  /** Build component list from input (pseudo-component Cp° scaled per unit mass from n-heptane — screening). */
  function buildComponents(input) {
    const ps = input.pseudo || {};
    const nc7 = LIB.find(c => c.id === 'nC7');
    const pmw = clamp(ps.mw, 2, 1000, 120);
    const pseudo = {
      id: 'PSEUDO', label: String(ps.label || 'Pseudo-component'), mw: pmw,
      tc: clamp(ps.tcC, -260, 1200, 330) + 273.15, pc: clamp(ps.pcBara, 1, 500, 26), omega: clamp(ps.omega, -0.4, 2, 0.4),
      cp: nc7.cp.map(v => v * pmw / nc7.mw)
    };
    return LIB.concat([pseudo]);
  }

  /** Normalise a {id: z} map, clamping negatives to zero. */
  function normalize(comps) {
    const out = {}; let s = 0;
    Object.keys(comps || {}).forEach(k => { const v = Math.max(0, Number(comps[k]) || 0); out[k] = v; s += v; });
    if (s > 0) Object.keys(out).forEach(k => { out[k] = out[k] / s; });
    return { comps: out, sum: s };
  }

  /** Pure-component PR parameters at T (a, b and the temperature derivatives of a). */
  function prParams(c, T) {
    const Tc = c.tc, Pc = c.pc * 1e5, w = c.omega;
    const kappa = w <= 0.491 ? 0.37464 + 1.54226 * w - 0.26992 * w * w
      : 0.379642 + 1.48503 * w - 0.164423 * w * w + 0.016666 * w * w * w; // PR 1976 Eq. 18 / PR 1978
    const ac = 0.45724 * R * R * Tc * Tc / Pc;   // PR Eq. 9
    const b = 0.07780 * R * Tc / Pc;             // PR Eq. 10
    const s = 1 + kappa * (1 - Math.sqrt(T / Tc));
    const alpha = s * s;                         // PR Eq. 17
    const sTT = Math.sqrt(T * Tc);
    const dAlpha = -kappa * s / sTT;
    const d2Alpha = kappa * kappa / (2 * T * Tc) + kappa * s / (2 * T * sTT);
    const zra = 0.29056 - 0.08775 * w;
    return { a: ac * alpha, da: ac * dAlpha, d2a: ac * d2Alpha, b, kappa, alpha, ac,
      cShift: 0.50033 * (0.25969 - zra) * R * Tc / Pc };
  }

  /** Mixture a, b, derivatives and Σ_j x_j a_ij (vdW one-fluid). */
  function mixture(x, pp, kij) {
    const n = x.length; let a = 0, da = 0, d2a = 0, b = 0, c = 0;
    const sumA = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      b += x[i] * pp[i].b; c += x[i] * pp[i].cShift;
      for (let j = 0; j < n; j++) {
        const ai = pp[i].a, aj = pp[j].a, ai1 = pp[i].da, aj1 = pp[j].da;
        const g = Math.sqrt(ai * aj), k = 1 - kij[i][j];
        const g1 = (ai1 * aj + ai * aj1) / (2 * g);
        const g2 = (pp[i].d2a * aj + 2 * ai1 * aj1 + ai * pp[j].d2a) / (2 * g) - (ai1 * aj + ai * aj1) ** 2 / (4 * g * g * g);
        const aij = k * g;
        sumA[i] += x[j] * aij;
        a += x[i] * x[j] * aij; da += x[i] * x[j] * k * g1; d2a += x[i] * x[j] * k * g2;
      }
    }
    return { a, da, d2a, b, c, sumA };
  }

  /** Real roots of Z³ + c2 Z² + c1 Z + c0 = 0 (Cardano / trigonometric), Newton-polished. */
  function cubicRoots(c2, c1, c0) {
    const p = c1 - c2 * c2 / 3, q = 2 * c2 * c2 * c2 / 27 - c2 * c1 / 3 + c0;
    const disc = q * q / 4 + p * p * p / 27;
    let roots;
    if (disc > 0) {
      const sd = Math.sqrt(disc);
      roots = [Math.cbrt(-q / 2 + sd) + Math.cbrt(-q / 2 - sd) - c2 / 3];
    } else {
      const r = Math.sqrt(Math.max(0, -p / 3));
      const phi = r > 0 ? Math.acos(Math.max(-1, Math.min(1, -q / (2 * r * r * r)))) : 0;
      roots = [0, 1, 2].map(k => 2 * r * Math.cos((phi - 2 * Math.PI * k) / 3) - c2 / 3);
    }
    return roots.map(z => {
      for (let i = 0; i < 4; i++) {
        const f = ((z + c2) * z + c1) * z + c0, d = (3 * z + 2 * c2) * z + c1;
        if (Math.abs(d) < 1e-14) break;
        z -= f / d;
      }
      return z;
    });
  }

  /**
   * Single-phase PR evaluation for composition x. root: 'gibbs' (default) | 'vapour' (largest) | 'liquid' (smallest).
   */
  function evalPhase(x, T, P, pp, kij, root) {
    const m = mixture(x, pp, kij);
    const A = m.a * P / (R * R * T * T), B = m.b * P / (R * T);       // PR Eqs. 11-12
    const rootsAll = cubicRoots(-(1 - B), A - 3 * B * B - 2 * B, -(A * B - B * B - B * B * B)); // PR Eq. 13
    let roots = rootsAll.filter(z => z > B * (1 + 1e-9) && Number.isFinite(z)).sort((u, v) => u - v);
    if (!roots.length) roots = [Math.max(B * 1.0001, Math.max(...rootsAll.filter(Number.isFinite), B * 1.01))];
    const lnPhiAt = (Z) => {
      const L = Math.log((Z + (1 + SQ2) * B) / (Z + (1 - SQ2) * B));
      return x.map((_, i) => {
        const bi = pp[i].b / m.b;
        return bi * (Z - 1) - Math.log(Z - B) - A / (2 * SQ2 * B) * (2 * m.sumA[i] / m.a - bi) * L; // PR Eq. 19
      });
    };
    let Z, lnPhi;
    if (root === 'vapour') Z = roots[roots.length - 1];
    else if (root === 'liquid') Z = roots[0];
    let best = null;
    (Z !== undefined ? [Z] : roots).forEach(z => {
      const lp = lnPhiAt(z);
      const g = lp.reduce((s, v, i) => s + x[i] * v, 0);
      if (!best || g < best.g) best = { z, lp, g };
    });
    Z = best.z; lnPhi = best.lp;
    return { Z, lnPhi, A, B, mix: m, nRoots: roots.length, roots };
  }

  /** Rachford-Rice: solve Σ z_i(K_i−1)/(1+β(K_i−1)) = 0 on the negative-flash window (bisection). */
  function rachfordRice(z, K) {
    const f = (bt) => z.reduce((s, zi, i) => s + zi * (K[i] - 1) / (1 + bt * (K[i] - 1)), 0);
    const kMax = Math.max(...K), kMin = Math.min(...K);
    if (!(kMax > 1 && kMin < 1)) return { beta: kMin >= 1 ? Infinity : -Infinity, f0: f(0), f1: f(1), bracketed: false };
    let lo = 1 / (1 - kMax), hi = 1 / (1 - kMin);
    const eps = 1e-12 * (hi - lo);
    lo += eps; hi -= eps;
    for (let it = 0; it < 200; it++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) > 0) lo = mid; else hi = mid;
      if (hi - lo < 1e-14) break;
    }
    return { beta: 0.5 * (lo + hi), f0: f(0), f1: f(1), bracketed: true };
  }

  const wilsonK = (c, T, Pbar) => (c.pc / Pbar) * Math.exp(5.373 * (1 + c.omega) * (1 - c.tc / T));

  /** Thermal / transport properties of one phase (composition x, already EOS-evaluated). */
  function phaseProperties(x, comps, pp, T, P, ev) {
    const mw = x.reduce((s, xi, i) => s + xi * comps[i].mw, 0);
    const m = ev.mix, zRaw = ev.Z, V = zRaw * R * T / P;
    const rhoRaw = P * mw * 1e-3 / (zRaw * R * T);
    // Péneloux translation applied consistently to every phase (does not change K-values)
    const Vs = V - m.c > 0 ? V - m.c : V;
    const Z = P * Vs / (R * T), rho = mw * 1e-3 / Vs;
    const L = Math.log((V + (1 + SQ2) * m.b) / (V + (1 - SQ2) * m.b));
    const cpIg = x.reduce((s, xi, i) => s + xi * cpIdeal(comps[i], T), 0);
    const den = V * V + 2 * m.b * V - m.b * m.b;
    const dPdT = R / (V - m.b) - m.da / den;
    const dPdV = -R * T / ((V - m.b) ** 2) + 2 * m.a * (V + m.b) / (den * den);
    const cvRes = T * m.d2a * L / (2 * SQ2 * m.b);
    const cv = cpIg - R + cvRes;
    const cp = dPdV < 0 ? cv - T * dPdT * dPdT / dPdV : NaN;
    const hRes = R * T * (Z - 1) + (T * m.da - m.a) * L / (2 * SQ2 * m.b);
    const kIdeal = cpIg / (cpIg - R);
    const kReal = cp / cv;
    const nIsen = -(Vs / P) * kReal * dPdV;               // real-gas isentropic exponent (API 520 Pt I Annex B)
    // Lee-Gonzalez-Eakin (1966): μ[cP] = 1e-4·K·exp(X·ρ^Y), ρ g/cm³, T °R
    const TR = T * 1.8;
    const Kl = (9.4 + 0.02 * mw) * Math.pow(TR, 1.5) / (209 + 19 * mw + TR);
    const Xl = 3.5 + 986 / TR + 0.01 * mw, Yl = 2.4 - 0.2 * Xl;
    const muLGE = 1e-4 * Kl * Math.exp(Xl * Math.pow(rho / 1000, Yl));
    return { x, mw, Z, zRaw, V, Vs, rho, rhoRaw, cShift: m.c, cpIg, cv, cp, kIdeal, kReal, nIsen, hRes, muLGE,
      cpMass: cp / mw, A: ev.A, B: ev.B, nRoots: ev.nRoots, a: m.a, b: m.b, da: m.da, d2a: m.d2a, dPdT, dPdV, cvRes };
  }

  /**
   * PURE calculation. input: { temperatureC, pressureBara, comps:{id:z}, pseudo:{label,mw,tcC,pcBara,omega}, kijMode:'zero'|'typical' }
   */
  function calc(input) {
    input = input || {};
    const all = buildComponents(input);
    const nz = normalize(input.comps);
    const comps = all.filter(c => (nz.comps[c.id] || 0) > 1e-12);
    const res = { ok: false, sumInput: nz.sum, warnings: [] };
    if (!comps.length) { res.error = 'Composition is empty — enter at least one mole fraction > 0.'; return res; }
    const z = comps.map(c => nz.comps[c.id]);
    const tC = clamp(input.temperatureC, -200, 1000, 40), pBar = clamp(input.pressureBara, 0.05, 1000, 10);
    const T = tC + 273.15, P = pBar * 1e5;
    const typical = input.kijMode === 'typical';
    const kij = comps.map(a => comps.map(b => (a.id === b.id ? 0 : typical ? kijTypical(a.id, b.id) : 0)));
    const pp = comps.map(c => prParams(c, T));
    const n = comps.length;

    // --- Two-phase flash: Wilson K → Rachford-Rice → successive substitution ---
    let K = comps.map(c => wilsonK(c, T, pBar));
    const K0 = K.slice();
    const rr0 = rachfordRice(z, K0);
    let beta = rr0.beta, iter = 0, err = 1, converged = false, trivial = false, x = z.slice(), y = z.slice();
    let evL = null, evV = null;
    if (n > 1) {
      for (iter = 1; iter <= 1500; iter++) {
        const rr = rachfordRice(z, K);
        if (!rr.bracketed) { beta = rr.beta; break; }
        beta = rr.beta;
        x = z.map((zi, i) => zi / (1 + beta * (K[i] - 1)));
        y = x.map((xi, i) => xi * K[i]);
        const sx = x.reduce((s, v) => s + v, 0), sy = y.reduce((s, v) => s + v, 0);
        x = x.map(v => v / sx); y = y.map(v => v / sy);
        evL = evalPhase(x, T, P, pp, kij); evV = evalPhase(y, T, P, pp, kij);
        const Kn = K.map((_, i) => Math.exp(evL.lnPhi[i] - evV.lnPhi[i]));
        err = Kn.reduce((s, k, i) => s + (Math.log(k) - Math.log(K[i])) ** 2, 0);
        K = Kn;
        if (K.reduce((s, k) => s + Math.log(k) ** 2, 0) < 1e-8) { trivial = true; break; }
        if (err < 1e-14) { converged = true; break; }
      }
    }
    const twoPhase = n > 1 && converged && !trivial && beta > 1e-10 && beta < 1 - 1e-10;
    res.flash = { iterations: iter, residual: err, converged: n === 1 || converged || trivial || !Number.isFinite(beta),
      trivial, betaRaw: beta, K0, K: K.slice(), rr0 };

    const feedEv = evalPhase(z, T, P, pp, kij);
    let vap = null, liq = null, phase;
    if (twoPhase) {
      vap = phaseProperties(y, comps, pp, T, P, evV);
      liq = phaseProperties(x, comps, pp, T, P, evL);
      phase = 'two-phase';
    } else {
      // Single phase: pick EOS root by Gibbs energy; label from flash / pseudo-critical (Kay) temperature
      const props = phaseProperties(z, comps, pp, T, P, feedEv);
      let isVap;
      if (n === 1) {
        const c = comps[0];
        isVap = T >= c.tc || pBar <= psatComp(c, T);
      } else if (!trivial && Number.isFinite(beta)) isVap = beta >= 1;
      else if (beta === Infinity) isVap = true;
      else if (beta === -Infinity) isVap = false;
      else isVap = T >= z.reduce((s, zi, i) => s + zi * comps[i].tc, 0);
      if (isVap) vap = props; else liq = props;
      phase = isVap ? 'vapour' : 'liquid';
      beta = isVap ? 1 : 0;
    }
    if (!res.flash.converged) res.warnings.push('Successive substitution did not reach |Δln K|² < 1e-14 (near-critical?) — results approximate.');
    if (Math.abs(nz.sum - 1) > 1e-4) res.warnings.push(`Mole fractions summed to ${nz.sum.toFixed(4)}; normalised to 1.`);
    if (comps.some(c => c.id === 'H2O') && twoPhase) res.warnings.push('Water present: VLLE (free-water) phase not modelled — 2-phase VLE only.');

    const mwFeed = z.reduce((s, zi, i) => s + zi * comps[i].mw, 0);
    const bulkRho = (() => {
      const vMol = (vap ? beta * vap.Vs : 0) + (liq ? (1 - beta) * liq.Vs : 0);
      return vMol > 0 ? mwFeed * 1e-3 / vMol : 0;
    })();

    // Vapour-branch Z vs P curve at current T (composition of vapour phase, or feed)
    const xc = vap ? vap.x : z;
    const pMax = Math.min(1000, Math.max(50, 2 * pBar));
    const curve = [];
    for (let i = 0; i <= 48; i++) {
      const pb = 1 + (pMax - 1) * i / 48;
      const e = evalPhase(xc, T, pb * 1e5, pp, kij, 'vapour');
      const zs = e.Z - e.mix.c * pb * 1e5 / (R * T);
      if (Number.isFinite(zs)) curve.push([pb, zs]);
    }

    Object.assign(res, {
      ok: true, T, P, tC, pBar, comps: comps.map((c, i) => ({ id: c.id, label: c.label, mw: c.mw, tc: c.tc, pc: c.pc, omega: c.omega, z: z[i],
        kappa: pp[i].kappa, alpha: pp[i].alpha, a: pp[i].a, b: pp[i].b, cShift: pp[i].cShift })),
      z, kij, kijMode: typical ? 'typical' : 'zero', phase, beta, vap, liq, mwFeed, bulkRho, curve, pMax,
      feedRoots: feedEv.roots
    });
    return res;
  }

  /** Pure-component saturation pressure [bara] at T [K] by equal-fugacity iteration P ← P·φ_L/φ_V. */
  function psatPure(id, T) { return psatComp(LIB.find(k => k.id === id), T); }
  function psatComp(c, T) {
    if (!c || !(T < c.tc)) return NaN;
    const pp = [prParams(c, T)], kij = [[0]];
    let pBar = wilsonK(c, T, 1);  // Wilson/Edmister estimate of Psat [bar]
    for (let i = 0; i < 300; i++) {
      const eL = evalPhase([1], T, pBar * 1e5, pp, kij, 'liquid'), eV = evalPhase([1], T, pBar * 1e5, pp, kij, 'vapour');
      const ratio = Math.exp(eL.lnPhi[0] - eV.lnPhi[0]);
      pBar *= ratio;
      if (Math.abs(ratio - 1) < 1e-11) break;
    }
    return pBar;
  }

  // ---------------------------------------------------------------------------
  // Presets & state
  // ---------------------------------------------------------------------------
  const PSEUDO_DEF = { label: 'C11+ pseudo', mw: 160, tcC: 365, pcBara: 19.5, omega: 0.53 };
  const presets = [
    { id: 'hpsep', label: 'HP separator feed — rich associated gas + condensate (2-phase)',
      state: { temperatureC: 40, pressureBara: 40, kijMode: 'typical', kSent: 'ideal', pseudo: { ...PSEUDO_DEF },
        comps: { N2: 0.005, CO2: 0.02, C1: 0.59, C2: 0.10, C3: 0.08, iC4: 0.03, nC4: 0.04, iC5: 0.02, nC5: 0.02, nC6: 0.03, nC7: 0.03, nC8: 0.02, nC9: 0.01, nC10: 0.005 } } },
    { id: 'sales', label: 'Lean pipeline sales gas (single-phase vapour)',
      state: { temperatureC: 40, pressureBara: 70, kijMode: 'zero', kSent: 'ideal', pseudo: { ...PSEUDO_DEF },
        comps: { N2: 0.01, CO2: 0.01, C1: 0.90, C2: 0.05, C3: 0.02, iC4: 0.005, nC4: 0.005 } } },
    { id: 'sour', label: 'Sour fuel gas — H₂S / CO₂ / H₂ (typical k_ij)',
      state: { temperatureC: 60, pressureBara: 25, kijMode: 'typical', kSent: 'ideal', pseudo: { ...PSEUDO_DEF },
        comps: { N2: 0.02, CO2: 0.08, H2S: 0.05, H2: 0.01, C1: 0.75, C2: 0.06, C3: 0.03 } } },
    { id: 'lpg', label: 'LPG C₃/C₄ rundown (subcooled liquid)',
      state: { temperatureC: 40, pressureBara: 20, kijMode: 'zero', kSent: 'ideal', pseudo: { ...PSEUDO_DEF },
        comps: { C2: 0.01, C3: 0.60, iC4: 0.15, nC4: 0.24 } } }
  ];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const defaultState = () => clone(presets[0].state);
  let state = defaultState();
  let mounted = null; // { root, ctx }
  let lastRes = null;

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const isUSC = () => !!(mounted && mounted.ctx && mounted.ctx.isUSC && mounted.ctx.isUSC());
  const UNITS = {
    T: { si: '°C', usc: '°F', to: v => v * 9 / 5 + 32, from: v => (v - 32) * 5 / 9 },
    P: { si: 'bara', usc: 'psia', to: v => v * 14.5037738, from: v => v / 14.5037738 },
    rho: { si: 'kg/m³', usc: 'lb/ft³', to: v => v * 0.06242796, from: v => v / 0.06242796 },
    cp: { si: 'kJ/kg·K', usc: 'Btu/lb·°F', to: v => v * 0.2388459, from: v => v / 0.2388459 }
  };
  const uLab = (q, usc) => (usc ? UNITS[q].usc : UNITS[q].si);
  const uTo = (q, v, usc) => (usc ? UNITS[q].to(v) : v);
  const fmtU = (q, v, d, usc) => (Number.isFinite(v) ? `${uTo(q, v, usc).toFixed(d)} ${uLab(q, usc)}` : '—');

  function kSentValue(res) {
    const v = res && res.vap;
    if (!v) return NaN;
    return state.kSent === 'real' ? v.kReal : v.kIdeal;
  }

  function summaryRows() {
    const r = calc(state);
    if (!r.ok) return [['Status', 'Invalid input', r.error || ''], ['Temperature', f(Number(state.temperatureC), 1), '°C'], ['Pressure', f(Number(state.pressureBara), 2), 'bara'], ['Method', 'Peng-Robinson 1976/78', '—']];
    const rows = [
      ['Conditions (T, P)', `${f(r.tC, 1)} °C, ${f(r.pBar, 2)} bara`, 'Peng-Robinson 1976/78 EOS, k_ij ' + r.kijMode],
      ['Phase state / vapour fraction β', `${r.phase} / ${f(r.beta, 4)}`, 'mol vapour / mol feed (Rachford-Rice + SS)'],
      ['Feed MW', f(r.mwFeed, 2), 'kg/kmol']
    ];
    if (r.vap) {
      rows.push(['Vapour MW / Z', `${f(r.vap.mw, 2)} / ${f(r.vap.Z, 4)}`, 'kg/kmol / —']);
      rows.push(['Vapour density', f(r.vap.rho, 2), 'kg/m³']);
      rows.push(['Vapour k ideal / real Cp/Cv / n_s', `${f(r.vap.kIdeal, 3)} / ${f(r.vap.kReal, 3)} / ${f(r.vap.nIsen, 3)}`, 'Cp° Reid-Prausnitz-Poling + PR departure']);
      rows.push(['Vapour viscosity (LGE estimate)', f(r.vap.muLGE, 4), 'cP (Lee-Gonzalez-Eakin 1966)']);
    }
    if (r.liq) rows.push(['Liquid MW / density (Péneloux)', `${f(r.liq.mw, 2)} / ${f(r.liq.rho, 1)}`, 'kg/kmol / kg/m³']);
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const STYLE = `
#toolPane-fluid-props .fp-comp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0.4rem 0.55rem;}
#toolPane-fluid-props .fp-comp-grid .field-label{font-size:0.7rem;}
#toolPane-fluid-props .form-grid-2{grid-template-columns:repeat(2,minmax(0,1fr));}
#toolPane-fluid-props .input-with-unit{min-width:0;}
#toolPane-fluid-props .input-with-unit input{width:100%;min-width:0;}
#toolPane-fluid-props .fp-comp-grid input{padding:0.3rem 0.4rem;font-size:0.78rem;}
#toolPane-fluid-props .fp-svg{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0.4rem;margin-bottom:0.75rem;color:var(--text-secondary);}
#toolPane-fluid-props .fp-svg svg{width:100%;height:auto;display:block;}
#toolPane-fluid-props .fp-row{display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;}
#toolPane-fluid-props .fp-table{width:100%;border-collapse:collapse;font-size:0.74rem;}
#toolPane-fluid-props .fp-table th,#toolPane-fluid-props .fp-table td{padding:0.25rem 0.4rem;border-bottom:1px solid var(--border-subtle);text-align:right;}
#toolPane-fluid-props .fp-table th:first-child,#toolPane-fluid-props .fp-table td:first-child{text-align:left;}
#toolPane-fluid-props .fp-note{font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;}
#toolPane-fluid-props .fp-warn{font-size:0.74rem;color:var(--warn-text);margin:0.2rem 0;}
`;

  function numField(id, label, sym, value, unit, step) {
    return `<div class="field-group"><label class="field-label" for="fluid-props-${id}"><span>${label}</span><span class="field-sym">${sym}</span></label>
      <div class="input-with-unit"><input type="number" id="fluid-props-${id}" data-field="${id}" step="${step || 'any'}" value="${value}"><span class="unit-addon">${unit}</span></div></div>`;
  }

  function renderInputs() {
    const root = mounted.root, usc = isUSC();
    const ps = state.pseudo || PSEUDO_DEF;
    const tVal = +uTo('T', Number(state.temperatureC), usc).toFixed(3);
    const pVal = +uTo('P', Number(state.pressureBara), usc).toFixed(4);
    const all = buildComponents(state);
    root.querySelector('#fluid-props-inputs').innerHTML = `
      <div class="form-section-title">1. Conditions</div>
      <div class="form-grid-2">
        ${numField('T', 'Temperature', 'T', tVal, uLab('T', usc))}
        ${numField('P', 'Pressure (absolute)', 'P', pVal, uLab('P', usc))}
      </div>
      <div class="form-section-title">2. Binary interaction k<sub>ij</sub> &amp; k sent to Step 2</div>
      <div class="segmented-control" style="margin-bottom:0.4rem;">
        <button type="button" class="seg-btn ${state.kijMode !== 'typical' ? 'active' : ''}" data-kij="zero" id="fluid-props-kij-zero">k<sub>ij</sub> = 0</button>
        <button type="button" class="seg-btn ${state.kijMode === 'typical' ? 'active' : ''}" data-kij="typical" id="fluid-props-kij-typ">Typical CO₂/H₂S/N₂–HC</button>
      </div>
      <div class="segmented-control">
        <button type="button" class="seg-btn ${state.kSent !== 'real' ? 'active' : ''}" data-ks="ideal" id="fluid-props-ks-ideal">Send ideal-gas k</button>
        <button type="button" class="seg-btn ${state.kSent === 'real' ? 'active' : ''}" data-ks="real" id="fluid-props-ks-real">Send real Cp/Cv</button>
      </div>
      <div class="form-section-title fp-row" style="justify-content:space-between;"><span>3. Feed composition (mole fraction)</span>
        <span class="fp-row"><span id="fluid-props-sum" class="mono" style="text-transform:none;"></span>
        <button type="button" class="btn btn-secondary" id="fluid-props-normalize" style="font-size:0.7rem;padding:0.2rem 0.5rem;">Normalize Σ = 1</button></span></div>
      <div class="fp-comp-grid">
        ${all.map(c => `<div class="field-group"><label class="field-label" for="fluid-props-z-${c.id}"><span>${esc(c.id === 'PSEUDO' ? 'Pseudo' : c.label.split(' ').slice(-1)[0])}</span></label>
          <div class="input-with-unit"><input type="number" min="0" step="any" id="fluid-props-z-${c.id}" data-comp="${c.id}" value="${+(Number((state.comps || {})[c.id]) || 0).toFixed(6)}" title="${esc(c.label)}"></div></div>`).join('')}
      </div>
      <div class="form-section-title">4. User pseudo-component (e.g. C<sub>n</sub>+ fraction)</div>
      <div class="form-grid-2">
        <div class="field-group"><label class="field-label" for="fluid-props-ps-label"><span>Name</span><span class="field-sym">ID</span></label>
          <div class="input-with-unit"><input type="text" id="fluid-props-ps-label" value="${esc(ps.label)}"></div></div>
        ${numField('ps-mw', 'Molar mass', 'MW', ps.mw, 'kg/kmol')}
        ${numField('ps-tc', 'Critical temperature', 'T_c', +uTo('T', Number(ps.tcC), usc).toFixed(3), uLab('T', usc))}
        ${numField('ps-pc', 'Critical pressure', 'P_c', +uTo('P', Number(ps.pcBara), usc).toFixed(4), uLab('P', usc))}
        ${numField('ps-w', 'Acentric factor', 'ω', ps.omega, '—')}
      </div>
      <div class="fp-note">Library constants: Poling-Prausnitz-O'Connell 5th ed. App. A (≈ GPSA Fig. 23-2). Pseudo-component Cp° scaled per unit mass from n-C₇ (screening).</div>`;
    const sel = root.querySelector('#fluid-props-preset');
    if (sel) sel.value = state._preset || '';
  }

  function zpSvg(r, usc) {
    const W = 720, H = 270, L = 52, Rm = 14, Tm = 18, Bm = 38;
    const pts = r.curve;
    if (pts.length < 2) return '';
    const zs = pts.map(p => p[1]);
    if (r.vap) zs.push(r.vap.Z);
    let zMin = Math.min(...zs), zMax = Math.max(...zs, 1.0);
    zMin = Math.floor((zMin - 0.02) * 20) / 20; zMax = Math.ceil((zMax + 0.01) * 20) / 20;
    if (zMax - zMin < 0.1) zMin = zMax - 0.1;
    const pTo = (p) => uTo('P', p, usc);
    const p0 = pTo(pts[0][0]), p1 = pTo(pts[pts.length - 1][0]);
    const X = (p) => L + (pTo(p) - p0) / (p1 - p0) * (W - L - Rm);
    const Y = (zz) => Tm + (zMax - zz) / (zMax - zMin) * (H - Tm - Bm);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    const yTicks = []; for (let t = zMin; t <= zMax + 1e-9; t += (zMax - zMin) / 4) yTicks.push(t);
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map(fr => p0 + fr * (p1 - p0));
    const grid = yTicks.map(t => `<line x1="${L}" x2="${W - Rm}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="currentColor" stroke-opacity="0.15"/>
      <text x="${L - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="currentColor">${t.toFixed(2)}</text>`).join('') +
      xTicks.map(pv => { const xx = L + (pv - p0) / (p1 - p0) * (W - L - Rm); return `<line x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${Tm}" y2="${H - Bm}" stroke="currentColor" stroke-opacity="0.1"/>
      <text x="${xx.toFixed(1)}" y="${H - Bm + 14}" text-anchor="middle" font-size="10" fill="currentColor">${pv.toFixed(0)}</text>`; }).join('');
    const ideal = (Y(1) >= Tm && Y(1) <= H - Bm) ? `<line x1="${L}" x2="${W - Rm}" y1="${Y(1).toFixed(1)}" y2="${Y(1).toFixed(1)}" stroke="currentColor" stroke-opacity="0.45" stroke-dasharray="4 3"/><text x="${W - Rm - 4}" y="${(Y(1) - 4).toFixed(1)}" text-anchor="end" font-size="9.5" fill="currentColor">ideal gas Z = 1</text>` : '';
    const cur = r.vap ? (() => { const cx = X(r.pBar), cy = Y(r.vap.Z); return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="var(--accent-primary)" stroke="var(--bg-surface)" stroke-width="1.5"/>
      <text x="${(cx + (cx > W * 0.7 ? -8 : 8)).toFixed(1)}" y="${(cy + 16).toFixed(1)}" text-anchor="${cx > W * 0.7 ? 'end' : 'start'}" font-size="10.5" font-weight="700" fill="var(--accent-primary)">Z = ${r.vap.Z.toFixed(4)} @ ${pTo(r.pBar).toFixed(1)} ${uLab('P', usc)}</text>`; })() : '';
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vapour Z-factor vs pressure" font-family="var(--font-mono)">
      <rect x="${L}" y="${Tm}" width="${W - L - Rm}" height="${H - Tm - Bm}" fill="rgba(2,132,199,0.05)" stroke="currentColor" stroke-opacity="0.35"/>
      ${grid}${ideal}
      <path d="${path}" fill="none" stroke="var(--accent-primary)" stroke-width="2.2"/>
      ${cur}
      <text x="${(L + W - Rm) / 2}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="currentColor">Pressure (${uLab('P', usc)}) — PR largest real root (vapour branch) at T = ${fmtU('T', r.tC, 1, usc)}</text>
      <text x="13" y="${(Tm + H - Bm) / 2}" text-anchor="middle" font-size="10.5" fill="currentColor" transform="rotate(-90 13 ${(Tm + H - Bm) / 2})">Z</text>
    </svg>`;
  }

  const PAL = ['#0284c7', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0d9488', '#ca8a04', '#db2777', '#4f46e5', '#65a30d', '#ea580c', '#0891b2'];
  function compSvg(r) {
    const W = 720, L = 70, Rm = 12;
    const rows = [['Feed z', r.z]];
    if (r.vap) rows.push([r.phase === 'two-phase' ? 'Vapour y' : 'Vapour', r.vap.x]);
    if (r.liq) rows.push([r.phase === 'two-phase' ? 'Liquid x' : 'Liquid', r.liq.x]);
    const bh = 18, gap = 9, top = 8;
    const bars = rows.map((row, k) => {
      let x0 = L; const y0 = top + k * (bh + gap);
      return `<text x="${L - 6}" y="${y0 + 13}" text-anchor="end" font-size="10.5" fill="currentColor">${row[0]}</text>` + row[1].map((v, i) => {
        const w = v * (W - L - Rm); const s = `<rect x="${x0.toFixed(2)}" y="${y0}" width="${Math.max(0, w).toFixed(2)}" height="${bh}" fill="${PAL[i % PAL.length]}" fill-opacity="0.8"><title>${esc(r.comps[i].id)}: ${v.toFixed(4)}</title></rect>` +
          (w > 26 ? `<text x="${(x0 + w / 2).toFixed(1)}" y="${y0 + 12.5}" text-anchor="middle" font-size="9" fill="#fff">${esc(r.comps[i].id)}</text>` : '');
        x0 += w; return s;
      }).join('');
    }).join('');
    const gy = top + rows.length * (bh + gap) + 4, gw = W - L - Rm;
    const gauge = `<text x="${L - 6}" y="${gy + 10}" text-anchor="end" font-size="10.5" fill="currentColor">β (mol V)</text>
      <rect x="${L}" y="${gy}" width="${gw}" height="12" fill="rgba(217,119,6,0.30)" stroke="currentColor" stroke-opacity="0.3"/>
      <rect x="${L}" y="${gy}" width="${(gw * Math.min(1, Math.max(0, r.beta))).toFixed(1)}" height="12" fill="rgba(2,132,199,0.55)"/>
      <text x="${L + 4}" y="${gy + 9.5}" font-size="9" fill="currentColor">vapour ${(100 * r.beta).toFixed(1)} %</text>
      <text x="${W - Rm - 4}" y="${gy + 9.5}" text-anchor="end" font-size="9" fill="currentColor">liquid ${(100 * (1 - r.beta)).toFixed(1)} %</text>`;
    const Hh = gy + 18;
    return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Phase compositions and vapour fraction" font-family="var(--font-mono)">${bars}${gauge}</svg>`;
  }

  function badge(kind, text) { return `<span class="status-badge status-${kind}">${esc(text)}</span>`; }

  function card(title, symbolic, substitution, result) {
    return `<div class="eq-step-card"><div class="eq-step-header">${title}</div><div class="eq-symbolic">${symbolic}</div><div class="eq-substitution">${substitution}</div><div class="eq-result">${result}</div></div>`;
  }

  function renderOutputs() {
    const root = mounted.root, usc = isUSC();
    const r = calc(state); lastRes = r;
    const sumEl = root.querySelector('#fluid-props-sum');
    if (sumEl) sumEl.textContent = `Σz = ${f(r.sumInput, 4)}`;
    const out = root.querySelector('#fluid-props-outputs');
    if (!r.ok) {
      out.innerHTML = `<div class="metrics-summary-grid"><div class="metric-box"><span class="metric-box-label">Status</span><span class="metric-box-main" style="color:var(--fail-text);">Invalid</span><span class="metric-box-sub">${esc(r.error)}</span></div>
        <div class="metric-box"><span class="metric-box-label">Action</span><span class="metric-box-main">—</span><span class="metric-box-sub">Enter a composition</span></div></div>
        <div class="fp-svg"><svg viewBox="0 0 10 2"></svg></div><div class="eq-step-card"><div class="eq-step-header">No calculation</div></div><div class="eq-step-card"><div class="eq-step-header">—</div></div>`;
      root.querySelector('#fluid-props-send').disabled = true;
      return;
    }
    root.querySelector('#fluid-props-send').disabled = false;
    const v = r.vap, l = r.liq;
    const phaseBadge = r.phase === 'vapour' ? badge('pass', 'SINGLE-PHASE VAPOUR') : r.phase === 'liquid' ? badge('pass', 'SINGLE-PHASE LIQUID') : badge('warn', 'TWO-PHASE');
    const convBadge = r.flash.converged ? badge('pass', 'CONVERGED') : badge('warn', 'NOT CONVERGED');
    const zBadge = v ? (v.Z >= 0.9 ? badge('pass', 'NEAR-IDEAL') : v.Z >= 0.75 ? badge('warn', 'NON-IDEAL') : badge('fail', 'HIGHLY NON-IDEAL')) : '';
    out.innerHTML = `
      ${r.warnings.map(w => `<div class="fp-warn">⚠ ${esc(w)}</div>`).join('')}
      <div class="metrics-summary-grid" style="margin-bottom:0.85rem;">
        <div class="metric-box"><span class="metric-box-label">Phase split β (vapour mol frac.)</span>
          <span class="metric-box-main">${f(r.beta, 4)}</span>
          <span class="metric-box-sub">${phaseBadge} Bulk ρ = ${fmtU('rho', r.bulkRho, 2, usc)} · MW<sub>feed</sub> ${f(r.mwFeed, 2)}</span></div>
        <div class="metric-box"><span class="metric-box-label">Vapour MW / Z (PR-Péneloux) / ρ<sub>v</sub></span>
          <span class="metric-box-main">${v ? `Z = ${f(v.Z, 4)}` : '—'}</span>
          <span class="metric-box-sub">${v ? `${zBadge} MW ${f(v.mw, 2)} · ρ<sub>v</sub> ${fmtU('rho', v.rho, 2, usc)}` : 'No vapour phase at these conditions'}</span></div>
        <div class="metric-box"><span class="metric-box-label">Vapour k = Cp/Cv</span>
          <span class="metric-box-main">${v ? `${f(v.kIdeal, 3)} / ${f(v.kReal, 3)}` : '—'}</span>
          <span class="metric-box-sub">${v ? `ideal / real · n<sub>s</sub> = ${f(v.nIsen, 3)} · Cp ${fmtU('cp', v.cpMass, 3, usc)}` : '—'}</span></div>
        <div class="metric-box"><span class="metric-box-label">Liquid density (Péneloux)</span>
          <span class="metric-box-main">${l ? fmtU('rho', l.rho, 1, usc) : '—'}</span>
          <span class="metric-box-sub">${l ? `MW ${f(l.mw, 2)} · Z<sub>L</sub> ${f(l.Z, 4)} · raw PR ${fmtU('rho', l.rhoRaw, 1, usc)}` : 'No liquid phase at these conditions'}</span></div>
        <div class="metric-box"><span class="metric-box-label">Vapour viscosity (estimate)</span>
          <span class="metric-box-main">${v ? `${f(v.muLGE, 4)} cP` : '—'}</span>
          <span class="metric-box-sub">Lee-Gonzalez-Eakin 1966 — screening estimate</span></div>
        <div class="metric-box"><span class="metric-box-label">Flash convergence</span>
          <span class="metric-box-main">${r.flash.iterations} it.</span>
          <span class="metric-box-sub">${convBadge} Σ(Δln K)² = ${r.flash.residual.toExponential(1)}</span></div>
      </div>
      <div class="fp-svg" id="fluid-props-zp">${zpSvg(r, usc)}</div>
      <div class="fp-svg" id="fluid-props-comp">${compSvg(r)}</div>
      <div style="overflow-x:auto;margin-bottom:0.85rem;"><table class="fp-table mono"><thead><tr><th>Comp.</th><th>z</th><th>K (final)</th><th>y</th><th>x</th><th>T<sub>c</sub> K</th><th>P<sub>c</sub> bar</th><th>ω</th></tr></thead><tbody>
        ${r.comps.map((c, i) => `<tr><td>${esc(c.id === 'PSEUDO' ? c.label : c.id)}</td><td>${c.z.toFixed(4)}</td><td>${r.phase === 'two-phase' ? r.flash.K[i].toExponential(3) : '—'}</td><td>${v ? v.x[i].toFixed(4) : '—'}</td><td>${l ? l.x[i].toFixed(4) : '—'}</td><td>${c.tc.toFixed(2)}</td><td>${c.pc.toFixed(2)}</td><td>${c.omega.toFixed(3)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="equation-step-list" id="fluid-props-trace">${traceHtml(r, usc)}</div>`;
  }

  function traceHtml(r, usc) {
    const ref = r.vap || r.liq;
    const c0 = r.comps.reduce((m, c) => (c.z > m.z ? c : m), r.comps[0]);
    const rr = r.flash.rr0;
    const cards = [
      card('1 · PR pure-component parameters (Peng & Robinson 1976, Eqs. 9-10, 17-18; PR 1978 κ for ω > 0.491)',
        'a<sub>i</sub> = 0.45724 R²T<sub>c</sub>²/P<sub>c</sub> · α<sub>i</sub>, b<sub>i</sub> = 0.07780 RT<sub>c</sub>/P<sub>c</sub>, α = [1 + κ(1 − √T<sub>r</sub>)]², κ = 0.37464 + 1.54226ω − 0.26992ω²',
        `Major component ${esc(c0.id)}: T<sub>c</sub> = ${c0.tc.toFixed(2)} K, P<sub>c</sub> = ${c0.pc.toFixed(2)} bar, ω = ${c0.omega.toFixed(3)}, T = ${r.T.toFixed(2)} K → κ = ${c0.kappa.toFixed(4)}, α = ${c0.alpha.toFixed(4)}`,
        `a = ${c0.a.toExponential(4)} Pa·m⁶/mol², b = ${c0.b.toExponential(4)} m³/mol`),
      card('2 · Wilson K-value initialisation (Wilson 1968; Michelsen & Mollerup Ch. 10)',
        'K<sub>i</sub> = (P<sub>c,i</sub>/P)·exp[5.373(1 + ω<sub>i</sub>)(1 − T<sub>c,i</sub>/T)]',
        `${esc(c0.id)}: K = (${c0.pc.toFixed(2)}/${r.pBar.toFixed(2)})·exp[5.373(1+${c0.omega.toFixed(3)})(1 − ${c0.tc.toFixed(2)}/${r.T.toFixed(2)})] = ${r.flash.K0[r.comps.indexOf(c0)].toExponential(4)}`,
        `Rachford-Rice with Wilson K: f(0) = Σz(K−1) = ${f(rr.f0, 4)}, f(1) = Σz(K−1)/K = ${f(rr.f1, 4)} → ${rr.f0 > 0 && rr.f1 < 0 ? 'root in (0,1): two-phase candidate' : 'no root in (0,1): single-phase candidate'}`),
      card('3 · Rachford-Rice + successive substitution (Rachford & Rice 1952; negative flash, Whitson & Michelsen 1989)',
        'Σ z<sub>i</sub>(K<sub>i</sub> − 1)/[1 + β(K<sub>i</sub> − 1)] = 0; x<sub>i</sub> = z<sub>i</sub>/[1 + β(K<sub>i</sub> − 1)], y<sub>i</sub> = K<sub>i</sub>x<sub>i</sub>; K<sub>i</sub> ← φ<sub>i</sub><sup>L</sup>/φ<sub>i</sub><sup>V</sup>',
        `${r.flash.iterations} iterations, Σ(Δln K)² = ${r.flash.residual.toExponential(2)}${r.flash.trivial ? ' (trivial solution K→1: single phase)' : ''}; unbounded β = ${Number.isFinite(r.flash.betaRaw) ? r.flash.betaRaw.toFixed(5) : 'no K straddle'}`,
        `Phase state: ${r.phase}, β = ${r.beta.toFixed(5)}${r.phase !== 'two-phase' ? ' (single-phase root chosen by minimum Gibbs energy Σx ln φ)' : ''}`),
      card('4 · Mixture cubic & fugacity coefficient (PR 1976 Eqs. 11-15, 19)',
        'Z³ − (1 − B)Z² + (A − 3B² − 2B)Z − (AB − B² − B³) = 0; ln φ<sub>i</sub> = (b<sub>i</sub>/b)(Z−1) − ln(Z−B) − A/(2√2B)·(2Σx<sub>j</sub>a<sub>ij</sub>/a − b<sub>i</sub>/b)·ln[(Z+2.414B)/(Z−0.414B)]',
        `${r.vap ? 'Vapour' : 'Liquid'}: A = aP/(RT)² = ${f(ref.A, 5)}, B = bP/(RT) = ${f(ref.B, 5)}, ${ref.nRoots} real root(s) > B; a<sub>ij</sub> = (1 − k<sub>ij</sub>)√(a<sub>i</sub>a<sub>j</sub>), k<sub>ij</sub> ${r.kijMode === 'typical' ? 'typical CO₂/H₂S/N₂–HC set' : '= 0'}`,
        `Z<sub>PR</sub> = ${f(ref.zRaw, 5)}${r.liq && r.vap ? `, Z<sub>PR,L</sub> = ${f(r.liq.zRaw, 5)}` : ''} → with Péneloux shift Z = Z<sub>PR</sub> − cP/(RT) = ${f(ref.Z, 5)}`)
    ];
    if (r.vap) {
      const v = r.vap;
      cards.push(card('5 · Vapour density & real-gas heat-capacity ratio (Poling-Prausnitz-O\'Connell Ch. 6; Cp° Reid et al. 4th ed. App. A)',
        'ρ = P·MW/(ZRT) (Z incl. Péneloux shift); C<sub>v</sub> = C<sub>p</sub>° − R + T(∂²a/∂T²)/(2√2b)·ln[(V+2.414b)/(V−0.414b)]; C<sub>p</sub> = C<sub>v</sub> − T(∂P/∂T)<sub>V</sub>²/(∂P/∂V)<sub>T</sub>; n<sub>s</sub> = −(V/P)(C<sub>p</sub>/C<sub>v</sub>)(∂P/∂V)<sub>T</sub>',
        `ρ<sub>v</sub> = ${r.P.toExponential(4)}·${(v.mw / 1000).toFixed(5)}/(${v.Z.toFixed(5)}·8.31446·${r.T.toFixed(2)}) = ${v.rho.toFixed(3)} kg/m³; C<sub>p</sub>° = ${v.cpIg.toFixed(3)}, C<sub>v</sub><sup>R</sup> = ${v.cvRes.toFixed(3)}, C<sub>v</sub> = ${v.cv.toFixed(3)}, C<sub>p</sub> = ${v.cp.toFixed(3)} J/(mol·K)`,
        `k° = C<sub>p</sub>°/(C<sub>p</sub>° − R) = ${v.kIdeal.toFixed(4)}; k<sub>real</sub> = C<sub>p</sub>/C<sub>v</sub> = ${v.kReal.toFixed(4)}; n<sub>s</sub> = ${v.nIsen.toFixed(4)}. API 520 Pt I gas sizing uses ideal-gas k unless the Annex B real-gas method is applied.`));
      cards.push(card('6 · Vapour viscosity — Lee, Gonzalez & Eakin (1966) (GPSA Ch. 23) — ESTIMATE',
        'μ = 10⁻⁴·K·exp(Xρ<sup>Y</sup>) cP; K = (9.4 + 0.02M)T<sup>1.5</sup>/(209 + 19M + T); X = 3.5 + 986/T + 0.01M; Y = 2.4 − 0.2X (T in °R, ρ in g/cm³)',
        `M = ${v.mw.toFixed(3)}, T = ${(r.T * 1.8).toFixed(2)} °R, ρ = ${(v.rho / 1000).toFixed(5)} g/cm³`,
        `μ<sub>v</sub> ≈ ${v.muLGE.toFixed(5)} cP (typ. ±2-4 % for sweet natural gas; not validated for high H₂/H₂S/CO₂)`));
    }
    if (r.liq) {
      const l = r.liq;
      cards.push(card('7 · Liquid density with Péneloux volume translation (Péneloux et al. 1982; PR form, Pedersen & Christensen §4.5; Z_RA Yamada-Gunn 1973)',
        'c<sub>i</sub> = 0.50033(0.25969 − Z<sub>RA,i</sub>)RT<sub>c,i</sub>/P<sub>c,i</sub>, Z<sub>RA</sub> = 0.29056 − 0.08775ω; V<sub>L</sub> = ZRT/P − Σx<sub>i</sub>c<sub>i</sub>; ρ<sub>L</sub> = MW/V<sub>L</sub>',
        `V<sub>PR</sub> = ${(l.V * 1e6).toFixed(3)} cm³/mol, Σx·c = ${(l.cShift * 1e6).toFixed(3)} cm³/mol, MW = ${l.mw.toFixed(3)}`,
        `ρ<sub>L</sub> = ${l.rho.toFixed(2)} kg/m³ (uncorrected PR ${l.rhoRaw.toFixed(2)} kg/m³, Z<sub>PR</sub> = ${l.zRaw.toFixed(5)} → Z = ${l.Z.toFixed(5)}). Shift does not alter phase equilibrium.`));
    }
    return cards.join('');
  }

  function recompute() {
    if (!mounted) return;
    renderOutputs();
    if (mounted.ctx && mounted.ctx.notifyChanged) mounted.ctx.notifyChanged();
  }

  function onInput(e) {
    const el = e.target, usc = isUSC();
    if (el.id === 'fluid-props-preset') return;
    const num = Number(el.value);
    if (el.dataset.comp) { state.comps = { ...(state.comps || {}), [el.dataset.comp]: Number.isFinite(num) ? Math.max(0, num) : 0 }; }
    else if (el.id === 'fluid-props-ps-label') state.pseudo = { ...state.pseudo, label: el.value.slice(0, 40) };
    else if (el.dataset.field) {
      if (el.value === '' || !Number.isFinite(num)) return;
      const fld = el.dataset.field;
      if (fld === 'T') state.temperatureC = usc ? UNITS.T.from(num) : num;
      else if (fld === 'P') state.pressureBara = usc ? UNITS.P.from(num) : num;
      else if (fld === 'ps-mw') state.pseudo = { ...state.pseudo, mw: num };
      else if (fld === 'ps-tc') state.pseudo = { ...state.pseudo, tcC: usc ? UNITS.T.from(num) : num };
      else if (fld === 'ps-pc') state.pseudo = { ...state.pseudo, pcBara: usc ? UNITS.P.from(num) : num };
      else if (fld === 'ps-w') state.pseudo = { ...state.pseudo, omega: num };
    } else return;
    delete state._preset;
    const sel = mounted.root.querySelector('#fluid-props-preset'); if (sel) sel.value = '';
    recompute();
  }

  function sendToPsv() {
    const r = lastRes || calc(state);
    if (!r.ok || !mounted || !mounted.ctx) return;
    const patch = { fluidPresetKey: 'custom' };
    if (r.vap) { patch.mw = +r.vap.mw.toFixed(3); patch.z = +r.vap.Z.toFixed(4); const k = kSentValue(r); if (Number.isFinite(k) && k > 1) patch.k = +k.toFixed(4); }
    if (r.liq) patch.rhoLiqKgM3 = +r.liq.rho.toFixed(1);
    mounted.ctx.applyToPsvTag(patch, 'tab-sizing');
  }

  function mount(container, ctx) {
    mounted = { root: container, ctx };
    if (typeof document !== 'undefined' && !document.getElementById('style-fluid-props')) {
      const st = document.createElement('style'); st.id = 'style-fluid-props'; st.textContent = STYLE; document.head.appendChild(st);
    }
    container.innerHTML = `
      <div class="workbench-grid">
        <div>
          <div class="panel">
            <div class="panel-header"><div class="panel-title">Fluid Definition — T, P &amp; Composition</div>
              <select id="fluid-props-preset" class="header-select" style="background:var(--bg-elevated);color:var(--text-primary);border-color:var(--border-strong);font-size:0.72rem;max-width:230px;">
                <option value="">— Preset fluid —</option>
                ${presets.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}
              </select></div>
            <div class="panel-body" id="fluid-props-inputs"></div>
          </div>
        </div>
        <div>
          <div class="panel">
            <div class="panel-header"><div><div class="panel-title">Peng-Robinson Flash &amp; Phase Properties</div>
              <div style="font-size:0.73rem;color:var(--text-muted);">Wilson K → Rachford-Rice → successive substitution on PR fugacities · single-phase root by Gibbs energy</div></div>
              <span class="panel-std-ref">PR 1976/78 · GPSA Ch. 23–25</span></div>
            <div class="panel-body">
              <div class="callout-banner callout-info" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;margin-bottom:0.85rem;">
                <div><strong style="display:block;font-size:0.8rem;">1-Click Coupling to Step 2 PSV Sizing</strong>
                  <span style="font-size:0.74rem;">Pushes vapour MW, k (ideal or real per toggle), Z and Péneloux liquid density into the active PSV tag.</span></div>
                <button type="button" id="fluid-props-send" class="btn btn-primary" style="font-size:0.74rem;padding:0.42rem 0.75rem;">⚡ Send MW / k / Z / ρ_liq to Step 2 PSV sizing</button>
              </div>
              <div id="fluid-props-outputs"></div>
              <div class="fp-note">Screening tool: PR EOS with classical mixing rules; two-phase VLE only (no free-water/VLLE, no solids/hydrates). Liquid densities use volume translation; vapour viscosity is an LGE correlation estimate. Verify critical cases with a validated process simulator.</div>
            </div>
          </div>
        </div>
      </div>`;
    container.addEventListener('input', onInput);
    container.addEventListener('change', (e) => {
      if (e.target.id === 'fluid-props-preset') {
        const p = presets.find(x => x.id === e.target.value);
        if (p) { state = { ...clone(p.state), _preset: p.id }; renderInputs(); recompute(); }
      } else onInput(e);
    });
    container.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'fluid-props-send') sendToPsv();
      else if (b.id === 'fluid-props-normalize') { state.comps = normalize(state.comps).comps; renderInputs(); recompute(); }
      else if (b.dataset.kij) { state.kijMode = b.dataset.kij; renderInputs(); recompute(); }
      else if (b.dataset.ks) { state.kSent = b.dataset.ks; renderInputs(); recompute(); }
    });
    if (ctx && ctx.onUnitChange) ctx.onUnitChange(() => { if (mounted) { renderInputs(); renderOutputs(); } });
    renderInputs();
    recompute();
  }

  const tool = {
    id: 'fluid-props',
    title: 'Fluid Properties (Peng-Robinson)',
    std: 'Peng-Robinson 1976/78 · Rachford-Rice · LGE · GPSA Ch. 23',
    calc,
    defaultState,
    presets,
    mount,
    getState: () => clone(state),
    setState(s) {
      state = { ...defaultState(), ...(s ? clone(s) : {}) };
      if (mounted) { renderInputs(); recompute(); }
    },
    summaryRows,
    // extra pure helpers (for tests)
    library: LIB,
    normalize,
    rachfordRice,
    psatPure,
    cubicRoots,
    kijTypical
  };

  if (typeof window !== 'undefined' && window.PSVTools) window.PSVTools.register(tool);
  if (typeof module !== 'undefined' && module.exports) module.exports = tool;
})();
