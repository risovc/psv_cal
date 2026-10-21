/**
 * PSVCalc Pro — Step 7 toolkit module `vessel-mech`
 * Vessel Nozzles & Supports: ASME VIII Div. 1 UG-37 area replacement, L.P. Zick saddle analysis
 * (horizontal) and a skirt / wind screening check (vertical).
 *
 * Canonical state units (SI): mm, barg, MPa, kg, m/s. Pure calc helpers are exposed on the tool
 * object (ug37, zickK, zick, skirt, kzASCE7) for the Node tests.
 */
(function () {
  'use strict';

  const G = 9.80665;          // m/s²
  const EY_MPA = 200000;      // carbon-steel elastic modulus used for the UG-23(b) elastic line (ambient)
  const ID = 'vessel-mech';
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const div = (a, b) => (Math.abs(b) > 1e-12 ? a / b : 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ASME B36.10M: [OD mm, wall Sch 40 mm, wall Sch 80 mm]. Kept local (true Sch 40/80 walls for NPS ≥ 12").
  const PIPE = {
    '1"': [33.4, 3.38, 4.55], '1.5"': [48.3, 3.68, 5.08], '2"': [60.3, 3.91, 5.54], '3"': [88.9, 5.49, 7.62],
    '4"': [114.3, 6.02, 8.56], '6"': [168.3, 7.11, 10.97], '8"': [219.1, 8.18, 12.70], '10"': [273.0, 9.27, 15.09],
    '12"': [323.8, 10.31, 17.48], '14"': [355.6, 11.13, 19.05], '16"': [406.4, 12.70, 21.44], '18"': [457.2, 14.27, 23.83],
    '20"': [508.0, 15.09, 26.19], '24"': [610.0, 17.48, 30.96]
  };
  const NPS_LIST = Object.keys(PIPE);
  const pipeOf = (nps, sched) => { const p = PIPE[nps] || PIPE['4"']; return { od: p[0], tn: sched === 'Sch 80' ? p[2] : p[1] }; };

  // ---------------------------------------------------------------------------------------------
  // 1. ASME VIII-1 UG-37 area replacement — radial set-in nozzle in a cylindrical shell, F = E1 = 1
  // ---------------------------------------------------------------------------------------------
  function ug37(p) {
    const P = Math.max(0, num(p.P_mpa, 0));
    const S = Math.max(1, num(p.S_mpa, 138));
    const ca = Math.max(0, num(p.ca_mm, 0));
    const caN = Math.max(0, num(p.caN_mm, ca));
    const fr = clamp(num(p.fr, 1), 0.1, 1);            // fr1 = fr2 = fr3 = Sn/Sv (≤ 1)
    const fr4 = clamp(num(p.fr4, 1), 0.1, 1);          // Sp/Sv (pad = shell material)
    const t = Math.max(0.1, num(p.t_mm, 10) - ca);     // corroded shell thickness
    const R = Math.max(1, num(p.Di_mm, 1000) / 2 + ca);// corroded inside radius
    const od = Math.max(10, num(p.od_mm, 114.3));
    const tnNom = clamp(num(p.tn_mm, 6), 0.5, od / 2 - 1);
    const tn = Math.max(0.01, tnNom - caN);            // corroded nozzle wall
    const d = od - 2 * tn;                             // finished opening, corroded (= ID + 2·CA)
    const Rn = d / 2;
    const tr = div(P * R, S * 1 - 0.6 * P);            // UG-27(c)(1), seamless shell E = 1
    const trn = div(P * Rn, S * fr - 0.6 * P);         // UG-27(c)(1) on nozzle, Sn = fr·Sv
    const F = 1, E1 = 1;
    const A = d * tr * F + 2 * tn * tr * F * (1 - fr);
    const ex = E1 * t - F * tr;
    const A1a = d * ex - 2 * tn * ex * (1 - fr);
    const A1b = 2 * (t + tn) * ex - 2 * tn * ex * (1 - fr);
    const A1 = Math.max(0, A1a, A1b);
    const exn = tn - trn;
    const A2a = 5 * exn * fr * t, A2b = 5 * exn * fr * tn;
    const A2 = Math.max(0, Math.min(A2a, A2b));
    const leg41 = Math.max(0, num(p.leg41_mm, 0)), leg43 = Math.max(0, num(p.leg43_mm, 0));
    const A41 = leg41 * leg41 * fr, A43 = leg43 * leg43 * fr;
    const availNoPad = A1 + A2 + A41 + A43;
    const Ld = Math.max(d, Rn + tn + t);               // UG-40 limit parallel to shell (each side of CL)
    // Reinforcing pad (te, Dp), Fig. UG-37.1 with pad
    const te = Math.max(0, num(p.te_mm, 0));
    const leg42 = Math.min(leg41, te);
    const A2pad = te > 0 ? Math.max(0, Math.min(A2a, 2 * exn * (2.5 * tn + te) * fr)) : A2;
    const A42 = leg42 * leg42 * fr4;
    const DpIn = Math.max(0, num(p.Dp_mm, 0));
    const hasPad = te > 0 && DpIn > od;
    const DpEff = hasPad ? Math.min(DpIn, 2 * Ld) : 0;
    const A5 = hasPad ? Math.max(0, (DpEff - d - 2 * tn) * te * fr4) : 0;
    const availPad = hasPad ? A1 + A2pad + A41 + A42 + A43 + A5 : availNoPad;
    const padRequired = availNoPad < A;
    // Minimum pad OD/width for the given te
    let padMin = null;
    if (te > 0) {
      const A5req = Math.max(0, A - (A1 + A2pad + A41 + A42 + A43));
      const DpReq = d + 2 * tn + div(A5req, te * fr4);
      padMin = { A5req, DpReq, widthMm: (DpReq - od) / 2, withinLimit: DpReq <= 2 * Ld + 1e-9, DpLimit: 2 * Ld };
    }
    const avail = hasPad ? availPad : availNoPad;
    const ok = avail >= A - 1e-9;
    const status = !padRequired ? 'PASS' : (hasPad && ok ? 'PASS_PAD' : 'NEEDS_PAD');
    // UG-36(c)(3)(a) small-opening exemption (finished opening ≤ 89 mm in shells ≤ 10 mm, ≤ 60 mm otherwise)
    const exempt = (num(p.t_mm, 10) <= 10 ? d <= 89 : d <= 60);
    return { P, S, fr, fr4, t, R, od, tnNom, tn, d, Rn, tr, trn, F, A, A1, A1a, A1b, A2, A2a, A2b, A2pad, A41, A42, A43, A5, te, DpIn, DpEff, hasPad,
      Ld, availNoPad, availPad, avail, ratio: div(avail, A), padRequired, padMin, status, exempt, shellOk: t >= tr, neckOk: tn >= trn };
  }

  // ---------------------------------------------------------------------------------------------
  // 2. Zick coefficients (L.P. Zick 1951/1971; tabulated in Megyesy, Pressure Vessel Handbook)
  // ---------------------------------------------------------------------------------------------
  function zickK(thetaDeg, AoverR) {
    const th = clamp(num(thetaDeg, 120), 120, 180) * Math.PI / 180;
    // K1 (unstiffened shell at saddle): effective arc Δ = π/6 + 5θ/12 (Zick); Megyesy K1 = π × section-modulus ratio
    const D = Math.PI / 6 + 5 * th / 12, sD = Math.sin(D), cD = Math.cos(D);
    const K1u = (D + sD * cD - 2 * sD * sD / D) / (sD / D - cD);
    const a = 0.95 * (Math.PI - th / 2), sa = Math.sin(a), ca = Math.cos(a);
    const den = Math.PI - a + sa * ca;
    const K2 = sa / den;                                   // shear, unstiffened (A > R/2)
    const K3 = (sa / Math.PI) * (a - sa * ca) / den;       // shear, head-stiffened (A ≤ R/2)
    const K4 = 0.375 * sa * sa / den;                      // additional stress in head used as stiffener
    const K5 = (1 + ca) / den;                             // circumferential compression at bottom of shell
    const b = Math.PI - th / 2, sb = Math.sin(b), cb = Math.cos(b), q = sb / b;
    const brk = q * q - 0.5 - Math.sin(2 * b) / (4 * b);
    const K6full = (0.75 * cb * q * q - 5 * sb * cb * cb / (4 * b) + cb * cb * cb / 2 - sb / (4 * b) + cb / 4 - b * sb * brk) / (2 * Math.PI * brk);
    const ar = num(AoverR, 1);
    const f6 = ar >= 1 ? 1 : ar <= 0.5 ? 0.25 : 0.25 + 0.75 * (ar - 0.5) / 0.5;   // Zick: K6/4 for A/R ≤ 0.5, linear to A/R = 1
    return { K1u, K1s: Math.PI, K2, K3, K4, K5, K6full, K6: K6full * f6, f6 };
  }

  // Zick stresses. Inputs SI: Q (N) per saddle, lengths mm, P MPa → stresses MPa.
  function zick(p) {
    const Q = Math.max(0, num(p.Q_N, 0));
    const R = Math.max(10, num(p.R_mm, 1000));
    const ts = Math.max(0.5, num(p.ts_mm, 10));
    const th = Math.max(0.5, num(p.th_mm, ts));
    const L = Math.max(100, num(p.L_mm, 5000));
    const A = clamp(num(p.A_mm, 0.2 * L), 0, L / 2 - 1);
    const H = Math.max(0, num(p.H_mm, 0));
    const b = Math.max(10, num(p.b_mm, 200));
    const tw = Math.max(0, num(p.tw_mm, 0));
    const P = Math.max(0, num(p.P_mpa, 0));
    const S = Math.max(1, num(p.S_mpa, 138)), Sy = Math.max(1, num(p.Sy_mpa, 260)), E = clamp(num(p.E, 1), 0.3, 1);
    const thetaDeg = clamp(num(p.thetaDeg, 120), 120, 180);
    const K = zickK(thetaDeg, A / R);
    const stiff = A <= R / 2;                                      // shell stiffened by head
    const K1 = stiff ? K.K1s : K.K1u;
    const hq = 1 + 4 * H / (3 * L);
    const M1 = Q * A * (1 - (1 - A / L + (R * R - H * H) / (2 * A * L || 1)) / hq);   // N·mm
    const S1 = div(M1, K1 * R * R * ts);
    const M2 = (Q * L / 4) * ((1 + 2 * (R * R - H * H) / (L * L)) / hq - 4 * A / L);
    const S2 = div(M2, Math.PI * R * R * ts);
    const S3 = stiff ? K.K3 * Q / (R * ts) : K.K2 * Q / (R * ts) * (L - 2 * A) / (L + 4 * H / 3);
    const S3h = stiff ? K.K3 * Q / (R * th) : null;
    const S3hAdd = stiff ? K.K4 * Q / (R * th) : null;
    const Dh = 2 * R;
    const sigHead = P * (Dh + 0.2 * th) / (2 * th);                // UG-32(d) solved for stress
    const te = ts + tw;                                            // Megyesy: substitute ts + wear plate
    const bEff = b + 1.56 * Math.sqrt(R * te);
    const long = L >= 8 * R;
    const S4a = Q / (4 * te * bEff);
    const S4b = long ? 3 * K.K6 * Q / (2 * te * te) : 12 * K.K6 * Q * R / (L * te * te);
    const S4 = -(S4a + S4b);
    const S5 = -K.K5 * Q / (te * bEff);
    const sigP = P * R / (2 * ts);
    const Ro = R + ts / 2;
    const Bfac = 0.125 / (Ro / ts) * EY_MPA / 2;                   // UG-23(b) elastic line: A = 0.125/(Ro/t), B = A·E/2
    const allowC = Math.min(0.5 * Sy, Bfac);
    const checks = [
      { id: 'S1t', label: 'S1 + PR/2t (tension, saddle)', val: sigP + Math.abs(S1), allow: S * E, basis: 'S·E' },
      { id: 'S1c', label: 'S1 compression (empty)', val: Math.abs(S1), allow: allowC, basis: 'min(0.5Sy, B)' },
      { id: 'S2t', label: 'S2 + PR/2t (tension, midspan)', val: sigP + Math.abs(S2), allow: S * E, basis: 'S·E' },
      { id: 'S2c', label: 'S2 compression (empty)', val: Math.abs(S2), allow: allowC, basis: 'min(0.5Sy, B)' },
      { id: 'S3', label: 'S3 tangential shear, shell', val: Math.abs(S3), allow: 0.8 * S, basis: '0.8·S' }
    ];
    if (stiff) {
      checks.push({ id: 'S3h', label: 'S3 shear in head', val: Math.abs(S3h), allow: 0.8 * S, basis: '0.8·S' });
      checks.push({ id: 'S3x', label: "S3' head add. + pressure", val: Math.abs(S3hAdd) + sigHead, allow: 1.25 * S, basis: '1.25·S' });
    }
    checks.push({ id: 'S4', label: 'S4 circumferential at horn', val: Math.abs(S4), allow: 1.5 * S, basis: '1.5·S' });
    checks.push({ id: 'S5', label: 'S5 compression, shell bottom', val: Math.abs(S5), allow: 0.5 * Sy, basis: '0.5·Sy' });
    checks.forEach(c => { c.ratio = div(c.val, c.allow); c.ok = c.ratio <= 1 + 1e-9; });
    const gov = checks.reduce((m, c) => (c.ratio > m.ratio ? c : m), checks[0]);
    return { Q, R, ts, th, L, A, H, b, tw, te, P, S, Sy, E, thetaDeg, K, K1, stiff, hq, M1, S1, M2, S2, S3, S3h, S3hAdd, sigHead,
      bEff, long, S4a, S4b, S4, S5, sigP, Ro, Bfac, allowC, checks, gov, ok: checks.every(c => c.ok) };
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Vertical vessel skirt — ASCE 7-16 Ch. 26/29 velocity pressure (screening) + base stresses
  // ---------------------------------------------------------------------------------------------
  const EXPO = { B: { alpha: 7.0, zg: 365.76 }, C: { alpha: 9.5, zg: 274.32 }, D: { alpha: 11.5, zg: 213.36 } };
  function kzASCE7(zM, exposure) {
    const e = EXPO[exposure] || EXPO.C;
    const z = clamp(num(zM, 4.572), 4.572, e.zg);                  // Table 26.10-1 note: z < 4.6 m (15 ft) → 4.6 m
    return 2.01 * Math.pow(z / e.zg, 2 / e.alpha);
  }
  // Root areas (in²) of UNC/8UN anchor bolts — Megyesy bolting data / TEMA
  const BOLTS = [['3/4"', 0.302], ['7/8"', 0.419], ['1"', 0.551], ['1-1/8"', 0.728], ['1-1/4"', 0.929], ['1-3/8"', 1.155], ['1-1/2"', 1.405],
    ['1-5/8"', 1.680], ['1-3/4"', 1.980], ['1-7/8"', 2.304], ['2"', 2.652]];
  function skirt(p) {
    const Do = Math.max(100, num(p.Do_mm, 2000));
    const tsk = Math.max(0.5, num(p.tsk_mm, 10) - Math.max(0, num(p.ca_mm, 0)));
    const Dm = Do - tsk;                                            // skirt OD flush with shell OD
    const Htot = Math.max(0.5, num(p.Htot_m, 10));
    const V = Math.max(0, num(p.V_ms, 40));
    const Kz = kzASCE7(Htot, p.exposure);
    const Kzt = Math.max(0, num(p.Kzt, 1)), Kd = Math.max(0, num(p.Kd, 0.95)), Gf = Math.max(0, num(p.G, 0.85)), Cf = Math.max(0, num(p.Cf, 0.7));
    const Deff = Do / 1000 * Math.max(1, num(p.kD, 1));
    const qz = 0.613 * Kz * Kzt * Kd * V * V;                       // Pa, ASCE 7-16 Eq. 26.10-1 (SI)
    const F = qz * Gf * Cf * Deff * Htot;                            // N, Eq. 29.4-1, uniform at qz(top)
    const M = F * Htot / 2;                                          // N·m at base
    const Mmm = M * 1000;
    const Wop = Math.max(0, num(p.Wop_kg, 0)) * G, We = Math.max(0, num(p.We_kg, 0)) * G, Wh = Math.max(0, num(p.Wh_kg, 0)) * G;
    const Aring = Math.PI * Dm * tsk, Zs = Math.PI * Dm * Dm * tsk / 4;
    const sigW = (w) => w / Aring, sigM = Mmm / Zs;
    const S = Math.max(1, num(p.S_mpa, 138)), Ew = clamp(num(p.Eweld, 0.7), 0.3, 1);
    const Afac = 0.125 / ((Do / 2) / tsk);
    const B = Afac * EY_MPA / 2;
    const allowC = Math.min(B, S);
    const comp = sigW(Wop) + sigM, tens = sigM - sigW(We), hyd = sigW(Wh);
    const checks = [
      { id: 'op', label: 'Operating compression W/πDt + 4M/πD²t', val: comp, allow: allowC, basis: 'min(B, S)' },
      { id: 'em', label: 'Empty net tension 4M/πD²t − W/πDt', val: Math.max(0, tens), allow: S * Ew, basis: 'S·E_weld' },
      { id: 'hy', label: 'Hydrotest compression (no wind)', val: hyd, allow: allowC, basis: 'min(B, S)' }
    ];
    checks.forEach(c => { c.ratio = div(c.val, c.allow); c.ok = c.ratio <= 1 + 1e-9; });
    // Anchor bolts (indicative): bolt circle = Do + 150 mm, N multiple of 4 at ≤ 600 mm pitch
    const Db = Do + 150;
    const N = Math.max(4, 4 * Math.ceil(Math.PI * Db / (4 * 600)));
    const Sb = Math.max(1, num(p.boltS_mpa, 138));
    const Tb = 4 * Mmm / (N * Db) - We / N;                          // N per bolt
    const AreqMm2 = Math.max(0, Tb) / Sb;
    const AreqIn2 = AreqMm2 / 645.16;
    const pick = BOLTS.find(x => x[1] >= AreqIn2 && x[1] >= 0.551) || null;   // ≥ 1" practical minimum
    const gov = checks.reduce((m, c) => (c.ratio > m.ratio ? c : m), checks[0]);
    return { Do, tsk, Dm, Htot, V, Kz, Kzt, Kd, G: Gf, Cf, Deff, qz, F, M, Wop, We, Wh, sigWop: sigW(Wop), sigWe: sigW(We), sigM, S, Ew, Afac, B, allowC,
      comp, tens, hyd, checks, gov, ok: checks.every(c => c.ok), Db, N, Sb, Tb, AreqMm2, AreqIn2, bolt: pick ? pick[0] : '> 2" (redesign)', uplift: Tb > 0 };
  }

  // ---------------------------------------------------------------------------------------------
  // State, presets, calc()
  // ---------------------------------------------------------------------------------------------
  const noz = (key, label, nps, sched, padDp) => ({ key, label, nps, sched, padDp_mm: padDp });
  function defaultState() {
    return {
      orientation: 'horizontal', tag: 'V-2004', material: 'SA-516 Gr. 70',
      Di_mm: 2400, Ltt_mm: 7200, t_mm: 22, th_mm: 22, ca_mm: 3, P_barg: 20, S_mpa: 138, Sy_mpa: 260, E_joint: 0.85,
      Wop_kg: 42000, Whydro_kg: 48000, Wempty_kg: 14000, weightBasis: 'hydrotest',
      fr: 1, leg41_mm: 10, leg43_mm: 0, padTe_mm: 16,
      nozzles: [noz('N1', 'N1 Inlet', '12"', 'Sch 40', 0), noz('N2', 'N2 Vapour out', '10"', 'Sch 40', 0), noz('N3', 'N3 Liquid out', '4"', 'Sch 80', 0)],
      A_mm: 600, theta_deg: 120, b_mm: 250, H_mm: 600, tw_mm: 10,
      skirtH_mm: 2500, tSkirt_mm: 12, Eweld: 0.7, V_ms: 45, exposure: 'C', Cf: 0.7, G: 0.85, Kd: 0.95, Kzt: 1, kD: 1.2, boltS_mpa: 138
    };
  }
  const presets = [
    { id: 'h-reflux', label: 'V-2004 — Horizontal reflux drum on 2 saddles (A = R/2)', state: defaultState() },
    { id: 'v-ko', label: 'V-1001 — Vertical KO drum on skirt (V = 45 m/s, Exp. C)', state: Object.assign(defaultState(), {
      orientation: 'vertical', tag: 'V-1001', Di_mm: 1800, Ltt_mm: 6000, t_mm: 16, th_mm: 16, ca_mm: 3, P_barg: 18, E_joint: 1,
      Wop_kg: 22000, Whydro_kg: 26000, Wempty_kg: 11000, padTe_mm: 16,
      nozzles: [noz('N1', 'N1 Inlet', '10"', 'Sch 40', 430), noz('N2', 'N2 Vapour out', '8"', 'Sch 40', 345), noz('N3', 'N3 Liquid out', '3"', 'Sch 80', 0)],
      H_mm: 450, skirtH_mm: 2500, tSkirt_mm: 12 }) },
    { id: 'megyesy', label: 'Megyesy Zick example — 120" OD × 80 ft, Q = 300 kip/saddle', state: Object.assign(defaultState(), {
      tag: 'MEGYESY-EX', material: 'SA-516 Gr. 70', Di_mm: 2997.2, Ltt_mm: 24384, t_mm: 25.4, th_mm: 25.4, ca_mm: 0, P_barg: 250 / 14.5037738,
      S_mpa: 20000 / 145.0377377, Sy_mpa: 38000 / 145.0377377, E_joint: 0.85, Wop_kg: 600000 / 2.20462262, Whydro_kg: 600000 / 2.20462262,
      Wempty_kg: 150000 / 2.20462262, weightBasis: 'operating', A_mm: 1219.2, theta_deg: 120, b_mm: 609.6, H_mm: 533.4, tw_mm: 0,
      nozzles: [noz('N1', 'N1 Inlet', '16"', 'Sch 40', 0), noz('N2', 'N2 Vapour out', '12"', 'Sch 40', 0), noz('N3', 'N3 Liquid out', '6"', 'Sch 80', 0)] }) }
  ];

  function normState(s) {
    const d = defaultState();
    const o = Object.assign({}, d, s || {});
    Object.keys(d).forEach(k => { if (typeof d[k] === 'number') o[k] = num(o[k], d[k]); });
    o.orientation = o.orientation === 'vertical' ? 'vertical' : 'horizontal';
    o.weightBasis = o.weightBasis === 'operating' ? 'operating' : 'hydrotest';
    o.exposure = EXPO[o.exposure] ? o.exposure : 'C';
    o.theta_deg = clamp(o.theta_deg, 120, 180);
    const nz = Array.isArray(o.nozzles) ? o.nozzles : d.nozzles;
    o.nozzles = d.nozzles.map((dn, i) => {
      const n = nz[i] || dn;
      return { key: dn.key, label: String(n.label || dn.label), nps: PIPE[n.nps] ? n.nps : dn.nps, sched: n.sched === 'Sch 80' ? 'Sch 80' : 'Sch 40', padDp_mm: Math.max(0, num(n.padDp_mm, 0)) };
    });
    return o;
  }

  function calc(input) {
    const s = normState(input);
    const P_mpa = Math.max(0, s.P_barg) / 10;
    const nozzles = s.nozzles.map(n => {
      const pp = pipeOf(n.nps, n.sched);
      const r = ug37({ P_mpa, Di_mm: s.Di_mm, t_mm: s.t_mm, ca_mm: s.ca_mm, S_mpa: s.S_mpa, fr: s.fr, od_mm: pp.od, tn_mm: pp.tn,
        leg41_mm: s.leg41_mm, leg43_mm: s.leg43_mm, te_mm: s.padTe_mm, Dp_mm: n.padDp_mm });
      return Object.assign(r, { key: n.key, label: n.label, nps: n.nps, sched: n.sched });
    });
    const govNoz = nozzles.reduce((m, n) => (n.ratio < m.ratio ? n : m), nozzles[0]);
    const nozOk = nozzles.every(n => n.status !== 'NEEDS_PAD');
    const W_kg = s.weightBasis === 'operating' ? s.Wop_kg : Math.max(s.Whydro_kg, s.Wop_kg);
    const res = { state: s, P_mpa, nozzles, govNoz, nozOk, W_kg };
    const tc = Math.max(0.5, s.t_mm - s.ca_mm), thc = Math.max(0.5, s.th_mm - s.ca_mm);
    if (s.orientation === 'horizontal') {
      const R = (s.Di_mm + 2 * s.ca_mm) / 2 + tc / 2;               // corroded mean radius
      res.Q_N = W_kg * G / 2;
      res.zick = zick({ Q_N: res.Q_N, R_mm: R, ts_mm: tc, th_mm: thc, L_mm: s.Ltt_mm, A_mm: s.A_mm, H_mm: s.H_mm, b_mm: s.b_mm,
        tw_mm: s.tw_mm, P_mpa, S_mpa: s.S_mpa, Sy_mpa: s.Sy_mpa, E: s.E_joint, thetaDeg: s.theta_deg });
      res.supportOk = res.zick.ok; res.supportGov = res.zick.gov;
    } else {
      const Do = s.Di_mm + 2 * s.t_mm;
      const Htot_m = (s.skirtH_mm + s.Ltt_mm + 2 * s.H_mm) / 1000;
      res.skirt = skirt({ Do_mm: Do, tsk_mm: s.tSkirt_mm, ca_mm: s.ca_mm, Htot_m, V_ms: s.V_ms, exposure: s.exposure, Kzt: s.Kzt, Kd: s.Kd, G: s.G, Cf: s.Cf,
        kD: s.kD, Wop_kg: s.Wop_kg, We_kg: s.Wempty_kg, Wh_kg: s.Whydro_kg, S_mpa: s.S_mpa, Eweld: s.Eweld, boltS_mpa: s.boltS_mpa });
      res.supportOk = res.skirt.ok; res.supportGov = res.skirt.gov;
    }
    return res;
  }

  // ---------------------------------------------------------------------------------------------
  // Units at the DOM boundary
  // ---------------------------------------------------------------------------------------------
  const UNIT = {
    len: { si: 'mm', us: 'in', f: 1 / 25.4, dSi: 1, dUs: 3 },
    press: { si: 'barg', us: 'psig', f: 14.5037738, dSi: 2, dUs: 1 },
    stress: { si: 'MPa', us: 'psi', f: 145.0377377, dSi: 1, dUs: 0 },
    mass: { si: 'kg', us: 'lb', f: 2.20462262, dSi: 0, dUs: 0 },
    vel: { si: 'm/s', us: 'mph', f: 2.23693629, dSi: 1, dUs: 1 },
    none: { si: '—', us: '—', f: 1, dSi: 3, dUs: 3 },
    deg: { si: '°', us: '°', f: 1, dSi: 0, dUs: 0 }
  };
  const fx = (v, d) => (fin(v) ? v.toFixed(d) : '—');
  function F(usc) {
    const c = (kind, v, d) => { const u = UNIT[kind]; const x = usc ? v * u.f : v; return `${fx(x, d ?? (usc ? u.dUs : u.dSi))} ${usc ? u.us : u.si}`; };
    return {
      usc,
      len: (v, d) => c('len', v, d), press: (v, d) => c('press', v, d), stress: (v, d) => c('stress', v, d), mass: (v, d) => c('mass', v, d), vel: (v, d) => c('vel', v, d),
      area: (mm2) => (usc ? `${fx(mm2 / 645.16, 3)} in²` : `${fx(mm2, 0)} mm²`),
      force: (N) => (usc ? `${fx(N / 4.4482216, 0)} lbf` : `${fx(N / 1000, 1)} kN`),
      moment: (Nm) => (usc ? `${fx(Nm * 0.7375621, 0)} ft·lbf` : `${fx(Nm / 1000, 1)} kN·m`),
      pa: (pa) => (usc ? `${fx(pa * 0.020885434, 1)} psf` : `${fx(pa, 0)} Pa`),
      longLen: (mm) => (usc ? `${fx(mm / 304.8, 2)} ft` : `${fx(mm / 1000, 2)} m`)
    };
  }

  // [key, label, symbol, unit kind, min, max, group]
  const FIELDS = [
    ['Di_mm', 'Shell inside diameter', 'D_i', 'len', 300, 10000, 'vessel'],
    ['Ltt_mm', 'Length tangent–tangent', 'L', 'len', 500, 60000, 'vessel'],
    ['t_mm', 'Shell nominal thickness', 't_s', 'len', 3, 200, 'vessel'],
    ['th_mm', 'Head nominal thickness', 't_h', 'len', 3, 200, 'vessel'],
    ['ca_mm', 'Corrosion allowance', 'CA', 'len', 0, 12, 'vessel'],
    ['P_barg', 'Design pressure (internal)', 'P', 'press', 0, 400, 'vessel'],
    ['S_mpa', 'Allowable stress at design T', 'S', 'stress', 20, 600, 'vessel'],
    ['Sy_mpa', 'Yield strength (compression)', 'S_y', 'stress', 100, 1000, 'vessel'],
    ['E_joint', 'Joint efficiency (girth seam)', 'E', 'none', 0.35, 1, 'vessel'],
    ['Wop_kg', 'Operating weight', 'W_op', 'mass', 0, 5e6, 'vessel'],
    ['Whydro_kg', 'Hydrotest (full water) weight', 'W_hyd', 'mass', 0, 5e6, 'vessel'],
    ['Wempty_kg', 'Empty (erection) weight', 'W_e', 'mass', 0, 5e6, 'vessel'],
    ['fr', 'Strength ratio Sn/Sv', 'f_r', 'none', 0.1, 1, 'noz'],
    ['leg41_mm', 'Outside fillet weld leg', 'leg41', 'len', 0, 50, 'noz'],
    ['leg43_mm', 'Inside fillet weld leg', 'leg43', 'len', 0, 50, 'noz'],
    ['padTe_mm', 'Pad thickness for sizing', 't_e', 'len', 0, 100, 'noz'],
    ['A_mm', 'Saddle from tangent line', 'A', 'len', 0, 20000, 'h'],
    ['b_mm', 'Saddle width', 'b', 'len', 50, 2000, 'h'],
    ['H_mm', 'Head depth (2:1 ≈ D/4)', 'H', 'len', 0, 5000, 'hv'],
    ['tw_mm', 'Wear plate thickness (0 = none)', 't_w', 'len', 0, 100, 'h'],
    ['skirtH_mm', 'Skirt height', 'h_sk', 'len', 300, 20000, 'v'],
    ['tSkirt_mm', 'Skirt nominal thickness', 't_sk', 'len', 3, 100, 'v'],
    ['Eweld', 'Skirt-to-head weld efficiency', 'E_w', 'none', 0.3, 1, 'v'],
    ['V_ms', 'Basic wind speed (3-s gust)', 'V', 'vel', 0, 90, 'v'],
    ['Cf', 'Force coefficient (round)', 'C_f', 'none', 0.3, 2, 'v'],
    ['G', 'Gust-effect factor', 'G', 'none', 0.5, 1.5, 'v'],
    ['Kd', 'Directionality factor', 'K_d', 'none', 0.5, 1, 'v'],
    ['Kzt', 'Topographic factor', 'K_zt', 'none', 1, 3, 'v'],
    ['kD', 'Effective diameter factor (ladders/insulation)', 'k_D', 'none', 1, 2, 'v'],
    ['boltS_mpa', 'Anchor bolt allowable tension', 'S_b', 'stress', 20, 600, 'v']
  ];
  const FMAP = Object.fromEntries(FIELDS.map(f => [f[0], f]));

  // ---------------------------------------------------------------------------------------------
  // Tool object
  // ---------------------------------------------------------------------------------------------
  let state = defaultState();
  let root = null, ctxRef = null;
  const isUSC = () => !!(ctxRef && ctxRef.isUSC && ctxRef.isUSC());
  const $ = (id) => (root ? root.querySelector('#' + ID + '-' + id) : null);

  const STYLE = `
#toolPane-vessel-mech .vm-grid{display:grid;grid-template-columns:minmax(330px,0.9fr) minmax(420px,1.25fr);gap:1rem;align-items:start}
#toolPane-vessel-mech .vm-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.6rem}
#toolPane-vessel-mech .vm-svgbox{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0.5rem;margin-bottom:0.8rem;color:var(--text-primary)}
#toolPane-vessel-mech .vm-svgbox svg{width:100%;height:auto;display:block}
#toolPane-vessel-mech .vm-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:0.7rem;margin-bottom:0.8rem}
#toolPane-vessel-mech .vm-note{font-size:0.74rem;color:var(--text-secondary);line-height:1.45;margin:0.4rem 0}
#toolPane-vessel-mech .vm-table{width:100%;border-collapse:collapse;font-size:0.74rem}
#toolPane-vessel-mech .vm-table th,#toolPane-vessel-mech .vm-table td{border-bottom:1px solid var(--border-subtle);padding:0.3rem 0.35rem;text-align:left;white-space:nowrap}
#toolPane-vessel-mech .vm-table th{color:var(--text-muted);font-weight:600}
#toolPane-vessel-mech .vm-trace{display:flex;flex-direction:column;gap:0.6rem}
#toolPane-vessel-mech .vm-head-actions{display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap}
#toolPane-vessel-mech .vm-noz{display:grid;grid-template-columns:1.2fr 0.8fr 0.9fr 1fr;gap:0.4rem;align-items:end;margin-bottom:0.4rem}
#toolPane-vessel-mech .vm-noz select,#toolPane-vessel-mech .vm-noz input{font-size:0.8rem}
#toolPane-vessel-mech .metric-box .status-badge{align-self:flex-start;margin-top:0.35rem}
@media (max-width:1000px){#toolPane-vessel-mech .vm-grid{grid-template-columns:1fr}}`;

  function fieldHtml(key) {
    const f = FMAP[key];
    return `<div class="field-group" data-grp="${f[6]}"><label class="field-label" for="${ID}-${key}"><span>${esc(f[1])}</span><span class="field-sym">${esc(f[2])}</span></label>
      <div class="input-with-unit"><input type="number" step="any" id="${ID}-${key}" data-key="${key}"><span class="unit-addon" data-unit="${f[3]}"></span></div></div>`;
  }
  const selHtml = (id, opts, label, sym) => `<div class="field-group"><label class="field-label" for="${ID}-${id}"><span>${esc(label)}</span><span class="field-sym">${esc(sym)}</span></label>
      <div class="input-with-unit"><select id="${ID}-${id}">${opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select></div></div>`;

  function mount(container, ctx) {
    root = container; ctxRef = ctx;
    if (typeof document !== 'undefined' && !document.getElementById('style-vessel-mech')) {
      const st = document.createElement('style'); st.id = 'style-vessel-mech'; st.textContent = STYLE; document.head.appendChild(st);
    }
    const g = (grp) => FIELDS.filter(f => f[6] === grp).map(f => fieldHtml(f[0])).join('');
    const npsOpts = NPS_LIST.map(n => [n, 'NPS ' + n]);
    container.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Vessel Nozzles &amp; Supports — UG-37 Reinforcement · Zick Saddles · Skirt Wind Screening</div>
        <div class="vm-head-actions">
          <select id="${ID}-preset" class="header-select" style="background:var(--bg-elevated);color:var(--text-primary);border-color:var(--border-strong);font-size:0.75rem;">
            <option value="">— Preset —</option>${presets.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select>
          <button type="button" class="btn btn-primary" id="${ID}-pull" style="font-size:0.74rem;">⇩ Load from Step 0 vessel</button>
          <span class="panel-std-ref">ASME VIII-1 UG-27/UG-37/UG-40/UG-23 · Zick (Megyesy) · ASCE 7-16</span>
        </div>
      </div>
      <div class="panel-body">
        <div class="vm-note" id="${ID}-pullmsg">Pull ID, T/T length, thicknesses, CA, S, E, weights, design pressure and nozzle sizes from the Step 0 vessel; all fields stay editable.</div>
        <div class="vm-grid">
          <div>
            <div class="form-section-title" style="margin-top:0;">1. Vessel, material &amp; loads</div>
            <div class="segmented-control" id="${ID}-orient" style="margin-bottom:0.6rem;">
              <button type="button" class="seg-btn" data-orient="horizontal">Horizontal · 2 saddles (Zick)</button>
              <button type="button" class="seg-btn" data-orient="vertical">Vertical · skirt (wind)</button>
            </div>
            <div class="vm-fields">
              <div class="field-group"><label class="field-label" for="${ID}-tag"><span>Vessel tag</span><span class="field-sym">Tag</span></label>
                <div class="input-with-unit"><input type="text" id="${ID}-tag" maxlength="40"></div></div>
              <div class="field-group"><label class="field-label" for="${ID}-material"><span>Material</span><span class="field-sym">Mat</span></label>
                <div class="input-with-unit"><input type="text" id="${ID}-material" maxlength="60"></div></div>
              ${g('vessel')}
            </div>
            <div class="form-section-title">2. Nozzles — UG-37 (radial set-in, F = 1, E1 = 1)</div>
            <div class="vm-fields">${g('noz')}</div>
            <div style="margin-top:0.6rem;">
              ${state.nozzles.map((n, i) => `<div class="vm-noz">
                <div class="field-group"><label class="field-label"><span>${esc(n.key)}</span><span class="field-sym" id="${ID}-nzlab-${i}"></span></label>
                  <div class="input-with-unit"><select id="${ID}-nps-${i}" data-noz="${i}" data-f="nps">${npsOpts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select></div></div>
                <div class="field-group"><label class="field-label"><span>Schedule</span></label>
                  <div class="input-with-unit"><select id="${ID}-sch-${i}" data-noz="${i}" data-f="sched"><option value="Sch 40">Sch 40</option><option value="Sch 80">Sch 80</option></select></div></div>
                <div class="field-group" style="grid-column:span 2;"><label class="field-label" for="${ID}-dp-${i}"><span>Pad OD D_p (0 = none)</span></label>
                  <div class="input-with-unit"><input type="number" step="any" id="${ID}-dp-${i}" data-noz="${i}" data-f="padDp_mm"><span class="unit-addon" data-unit="len"></span></div></div>
              </div>`).join('')}
            </div>
            <div class="form-section-title">3. Supports</div>
            <div class="vm-fields" id="${ID}-grp-h">
              ${selHtml('theta', [['120', '120°'], ['150', '150°']], 'Saddle contact angle', 'θ')}
              ${selHtml('basis', [['hydrotest', 'max(Hydrotest, Operating)'], ['operating', 'Operating']], 'Weight basis for Q', 'W')}
              ${g('h')}${g('hv')}
            </div>
            <div class="vm-fields" id="${ID}-grp-v">
              ${selHtml('expo', [['B', 'Exposure B'], ['C', 'Exposure C'], ['D', 'Exposure D']], 'ASCE 7 exposure', 'Exp')}
              ${g('v')}
            </div>
            <div class="vm-note" id="${ID}-guide"></div>
          </div>
          <div>
            <div class="vm-metrics" id="${ID}-metrics"></div>
            <div class="vm-svgbox" id="${ID}-svg-support"></div>
            <div class="vm-svgbox" id="${ID}-svg-noz"></div>
            <div class="table-responsive" id="${ID}-noztable"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Whitebox calculation trace</div><span class="panel-std-ref">UG-37 Fig. UG-37.1 · Zick 1951/1971 · ASCE 7-16 Eq. 26.10-1 / 29.4-1</span></div>
      <div class="panel-body"><div class="vm-trace" id="${ID}-trace"></div>
        <div class="vm-note" id="${ID}-caveats"></div></div>
    </div>`;

    container.addEventListener('input', onInput);
    container.addEventListener('change', onInput);
    $('preset').addEventListener('change', (e) => { const p = presets.find(x => x.id === e.target.value); if (p) setState(JSON.parse(JSON.stringify(p.state))); });
    $('pull').addEventListener('click', pullFromVessel);
    $('orient').querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => { state.orientation = b.dataset.orient; syncInputs(); recompute(); }));
    if (ctx && ctx.onUnitChange) ctx.onUnitChange(() => { syncInputs(); recompute(); });
    syncInputs(); recompute();
  }

  function onInput(e) {
    const el = e.target;
    if (!el || !root) return;
    if (el.id === ID + '-preset') return;
    const usc = isUSC();
    if (el.dataset.key) {
      const f = FMAP[el.dataset.key]; const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      const si = usc ? v / UNIT[f[3]].f : v;
      state[f[0]] = clamp(si, f[4], f[5]);
    } else if (el.dataset.noz) {
      const n = state.nozzles[Number(el.dataset.noz)]; if (!n) return;
      if (el.dataset.f === 'padDp_mm') { const v = parseFloat(el.value); if (!Number.isFinite(v)) return; n.padDp_mm = clamp(usc ? v * 25.4 : v, 0, 5000); }
      else n[el.dataset.f] = el.value;
    } else if (el.id === ID + '-tag') state.tag = el.value.slice(0, 40);
    else if (el.id === ID + '-material') state.material = el.value.slice(0, 60);
    else if (el.id === ID + '-theta') state.theta_deg = Number(el.value) || 120;
    else if (el.id === ID + '-basis') state.weightBasis = el.value;
    else if (el.id === ID + '-expo') state.exposure = el.value;
    else return;
    recompute();
  }

  function syncInputs() {
    if (!root) return;
    const usc = isUSC();
    FIELDS.forEach(f => {
      const el = $(f[0]); if (!el) return;
      const u = UNIT[f[3]]; const v = usc ? state[f[0]] * u.f : state[f[0]];
      const d = f[3] === 'none' ? 3 : (usc ? u.dUs : u.dSi) + (f[3] === 'len' && !usc ? 1 : 0);
      el.value = fin(v) ? String(Number(v.toFixed(d))) : '';
    });
    root.querySelectorAll('.unit-addon[data-unit]').forEach(s => { const u = UNIT[s.dataset.unit]; s.textContent = usc ? u.us : u.si; });
    state.nozzles.forEach((n, i) => {
      $('nps-' + i).value = n.nps; $('sch-' + i).value = n.sched;
      $('dp-' + i).value = String(Number((usc ? n.padDp_mm / 25.4 : n.padDp_mm).toFixed(usc ? 3 : 1)));
      $('nzlab-' + i).textContent = n.label;
    });
    $('tag').value = state.tag; $('material').value = state.material;
    $('theta').value = String(state.theta_deg === 150 ? 150 : 120);
    $('basis').value = state.weightBasis; $('expo').value = state.exposure;
    const h = state.orientation === 'horizontal';
    $('orient').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.orient === state.orientation));
    $('grp-h').style.display = h ? '' : 'none';
    $('grp-v').style.display = h ? 'none' : '';
    // H (head depth) is also needed for the vertical overall height
    const hf = $('H_mm'); if (hf && !h) { const grpV = $('grp-v'); if (hf.closest('.field-group').parentElement !== grpV) grpV.appendChild(hf.closest('.field-group')); }
    if (hf && h) { const grpH = $('grp-h'); if (hf.closest('.field-group').parentElement !== grpH) grpH.appendChild(hf.closest('.field-group')); }
  }

  function pullFromVessel() {
    const msg = $('pullmsg');
    let v = null;
    try { v = ctxRef && ctxRef.getVesselResult ? ctxRef.getVesselResult() : null; } catch (e) { v = null; }
    if (!v || !v.geometry || !v.mechanical) { if (msg) msg.textContent = 'Step 0 vessel result not available — size a vessel in Step 0 first.'; return; }
    const g = v.geometry, m = v.mechanical, s = state;
    s.orientation = v.orientation === 'vertical' ? 'vertical' : 'horizontal';
    s.tag = String(v.vesselTag || s.tag).slice(0, 40);
    s.material = String(m.materialName || s.material).slice(0, 60);
    s.Di_mm = num(g.diameterMm, s.Di_mm); s.Ltt_mm = num(g.lengthMm, s.Ltt_mm);
    s.t_mm = num(m.tShellSelectedMm, s.t_mm); s.th_mm = num(m.tHeadSelectedMm, s.t_mm);
    s.ca_mm = num(m.corrosionAllowanceMm, s.ca_mm); s.S_mpa = num(m.allowableStressMpa, s.S_mpa); s.E_joint = num(m.jointEfficiencyE, s.E_joint);
    s.Wop_kg = num(m.operatingWeightKg, s.Wop_kg); s.Whydro_kg = num(m.hydrotestWeightKg, s.Whydro_kg); s.Wempty_kg = num(m.emptyWeightKg, s.Wempty_kg);
    s.P_barg = num(v.designPressureBarg, s.P_barg);
    s.H_mm = v.headType === 'hemispherical' ? s.Di_mm / 2 : v.headType === 'torispherical' ? 0.194 * s.Di_mm : s.Di_mm / 4;
    s.A_mm = Math.min(0.2 * s.Ltt_mm, s.Di_mm / 4);              // A ≤ R/2 (head stiffening) and ≤ 0.2·L
    const nz = v.nozzles || {};
    [nz.inlet, nz.vaporOutlet, nz.liquidOutlet].forEach((n, i) => { if (n && PIPE[n.nps]) { s.nozzles[i].nps = n.nps; s.nozzles[i].sched = 'Sch 40'; s.nozzles[i].padDp_mm = 0; } });
    if (msg) msg.textContent = `Loaded ${s.tag}: ${s.orientation}, ID ${fx(s.Di_mm, 0)} mm × ${fx(s.Ltt_mm, 0)} mm T/T, t = ${fx(s.t_mm, 1)} mm, P = ${fx(s.P_barg, 2)} barg, nozzles ${s.nozzles.map(n => n.nps).join(' / ')}. Saddle A set to min(R/2, 0.2·L).`;
    syncInputs(); recompute();
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------
  const badge = (ok, txtOk, txtBad, warn) => `<span class="status-badge ${ok ? 'status-pass' : warn ? 'status-warn' : 'status-fail'}">${esc(ok ? txtOk : txtBad)}</span>`;
  const NZTXT = { PASS: 'PASS — no pad', PASS_PAD: 'PASS — with pad', NEEDS_PAD: 'NEEDS PAD' };

  function recompute() {
    if (!root) return;
    const r = calc(state), u = F(isUSC());
    renderMetrics(r, u);
    $('svg-support').innerHTML = r.zick ? svgSaddle(r, u) : svgSkirt(r, u);
    $('svg-noz').innerHTML = svgNozzles(r, u);
    renderNozTable(r, u);
    $('trace').innerHTML = traceSteps(r, u).map(s => `<div class="eq-step-card"><div class="eq-step-header">${s[0]}</div><div class="eq-symbolic">${s[1]}</div><div class="eq-substitution">${s[2]}</div><div class="eq-result">${s[3]}</div></div>`).join('');
    const z = r.zick;
    $('guide').textContent = z
      ? `A/L = ${fx(z.A / z.L, 3)}, A/R = ${fx(z.A / z.R, 2)}. Zick guidance: A ≤ 0.2·L, and A ≤ R/2 (= ${u.len(z.R / 2, 0)}) lets the heads stiffen the shell (K1 = π, K3 shear). L ${z.long ? '≥' : '<'} 8R → ${z.long ? 'long' : 'short'}-vessel S4 formula.`
      : 'Wind: ASCE 7-16 velocity pressure at the top elevation applied uniformly over the full height (conservative screening). Seismic, vortex shedding, nozzle loads and platform loads are not included.';
    $('caveats').innerHTML = `<strong>Screening limitations.</strong> UG-37 here assumes radial set-in nozzles located in the cylindrical shell (head nozzles evaluated with shell t_r — conservative only if the head is at least as thick), no inward projection (A3 = 0), F = 1, fr4 = 1 (pad of shell material); UG-45 neck thickness, UG-41 weld strength paths and UG-42 overlapping limits are not checked. Zick: R = corroded mean radius, two identical symmetric saddles, ring stiffeners not modelled; K6 between A/R = 0.5 and 1 linearly interpolated (Megyesy chart reads up to ~3% lower). Compression allowable B uses the UG-23(b) elastic line (B = A·E/2, E = 200 GPa) capped by 0.5·S_y / S — read the material chart (e.g. CS-2) for the final design. Skirt check is an ASCE 7 screening (rigid structure, G = 0.85 default), not a full dynamic wind/seismic design. Anchor-bolt suggestion is indicative (bolt circle = D_o + 150 mm, pitch ≤ 600 mm, ≥ 1" bolts).`;
    if (ctxRef && ctxRef.notifyChanged) ctxRef.notifyChanged();
  }

  function renderMetrics(r, u) {
    const gn = r.govNoz;
    const padTxt = gn.padMin ? (gn.padRequired ? `${u.len(Math.max(0, gn.padMin.widthMm), 0)} wide × ${u.len(state.padTe_mm, 1)}` : 'not required') : 'set t_e > 0';
    const padNeedAll = r.nozzles.filter(n => n.padRequired);
    let sup;
    if (r.zick) {
      const z = r.zick;
      sup = `<div class="metric-box"><span class="metric-box-label">Zick saddle governing check</span>
        <span class="metric-box-main" style="color:${z.ok ? 'var(--pass-text)' : 'var(--fail-text)'};">${fx(z.gov.ratio * 100, 0)}% · ${esc(z.gov.id)}</span>
        <span class="metric-box-sub">${esc(z.gov.label)}: ${u.stress(z.gov.val)} vs ${esc(z.gov.basis)} = ${u.stress(z.gov.allow)}</span>${badge(z.ok, 'PASS', 'FAIL')}</div>
        <div class="metric-box"><span class="metric-box-label">Load per saddle Q</span><span class="metric-box-main">${u.force(r.Q_N)}</span>
        <span class="metric-box-sub">W = ${u.mass(r.W_kg)} (${esc(state.weightBasis)}) · θ = ${fx(z.thetaDeg, 0)}° · ${z.stiff ? 'head-stiffened (A ≤ R/2)' : 'unstiffened (A > R/2)'}</span></div>`;
    } else {
      const k = r.skirt;
      sup = `<div class="metric-box"><span class="metric-box-label">Skirt governing check</span>
        <span class="metric-box-main" style="color:${k.ok ? 'var(--pass-text)' : 'var(--fail-text)'};">${fx(k.gov.ratio * 100, 0)}% · ${esc(k.gov.id)}</span>
        <span class="metric-box-sub">${esc(k.gov.label)}: ${u.stress(k.gov.val)} vs ${u.stress(k.gov.allow)}</span>${badge(k.ok, 'PASS', 'FAIL')}</div>
        <div class="metric-box"><span class="metric-box-label">Wind base shear / moment</span><span class="metric-box-main">${u.moment(k.M)}</span>
        <span class="metric-box-sub">F = ${u.force(k.F)} · q_z = ${u.pa(k.qz)} · bolts ${k.uplift ? `${k.N} × ${esc(k.bolt)}` : `${k.N} × 1" min. (no uplift)`}</span>${badge(true, 'SCREENING', '', true)}</div>`;
    }
    $('metrics').innerHTML = `
      <div class="metric-box"><span class="metric-box-label">UG-37 governing nozzle</span>
        <span class="metric-box-main" style="color:${r.nozOk ? 'var(--pass-text)' : 'var(--fail-text)'};">${esc(gn.key)} ${esc(gn.nps)}: ${fx(gn.availNoPad / (gn.A || 1), 2)}× A</span>
        <span class="metric-box-sub">A1+A2+A41+A43 = ${u.area(gn.availNoPad)} vs A = ${u.area(gn.A)}</span>${r.nozzles.some(n => !n.shellOk) ? badge(false, "", "SHELL t < t_r", true) : ""}${badge(r.nozOk, padNeedAll.length ? 'PASS — pads fitted' : 'PASS — no pads', 'NEEDS PAD')}</div>
      <div class="metric-box"><span class="metric-box-label">Min. pad (${esc(gn.key)}, given t_e)</span>
        <span class="metric-box-main">${padTxt}</span>
        <span class="metric-box-sub">${gn.padMin && gn.padRequired ? `D_p ≥ ${u.len(gn.padMin.DpReq, 0)} (UG-40 limit ${u.len(gn.padMin.DpLimit, 0)})` : `${padNeedAll.length} of 3 nozzles need a pad`}</span>
        ${gn.padMin && gn.padRequired && !gn.padMin.withinLimit ? badge(false, '', 'EXCEEDS 2·L_d', true) : ''}</div>
      ${sup}`;
  }

  function renderNozTable(r, u) {
    const rows = r.nozzles.map(n => `<tr><td><strong>${esc(n.key)}</strong> ${esc(n.nps)} ${esc(n.sched)}</td><td>${u.len(n.d, 1)}</td><td>${u.len(n.tr, 2)} / ${u.len(n.trn, 2)}</td>
      <td>${u.area(n.A)}</td><td>${u.area(n.A1)}</td><td>${u.area(n.hasPad ? n.A2pad : n.A2)}</td><td>${u.area(n.A41 + n.A43 + (n.hasPad ? n.A42 : 0))}</td><td>${u.area(n.A5)}</td>
      <td>${badge(n.status !== 'NEEDS_PAD', NZTXT[n.status], NZTXT[n.status])}</td></tr>`).join('');
    $('noztable').innerHTML = `<table class="vm-table data-table mono"><thead><tr><th>Nozzle</th><th>d (corr.)</th><th>t_r / t_rn</th><th>A req</th><th>A1</th><th>A2</th><th>A4x welds</th><th>A5 pad</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // SVG helpers (currentColor text; translucent fills for dark mode)
  const T = (x, y, s, o = {}) => `<text x="${fx(x, 1)}" y="${fx(y, 1)}" font-size="${o.fs || 11}" fill="${o.fill || 'currentColor'}" text-anchor="${o.a || 'start'}" ${o.w ? `font-weight="${o.w}"` : ''} font-family="var(--font-mono, monospace)">${esc(s)}</text>`;
  const COL = { ok: 'rgba(16,185,129,0.55)', bad: 'rgba(239,68,68,0.6)', shell: 'rgba(56,189,248,0.18)', stroke: 'rgba(100,116,139,0.9)' };
  function bars(checks, y0, u) {
    const x0 = 225, W = 240;
    let out = T(10, y0 - 8, 'Utilisation vs allowable (bar = 0–150 %, line = 100 %)', { fs: 10.5, w: 700 });
    checks.forEach((c, i) => {
      const y = y0 + i * 22, w = clamp(c.ratio / 1.5, 0, 1) * W;
      out += T(10, y + 12, c.label, { fs: 10 }) + `<rect x="${x0}" y="${y + 2}" width="${W}" height="14" fill="rgba(148,163,184,0.15)" rx="2"/>` +
        `<rect x="${x0}" y="${y + 2}" width="${fx(w, 1)}" height="14" fill="${c.ok ? COL.ok : COL.bad}" rx="2"/>` +
        T(x0 + W + 8, y + 13, `${fx(c.ratio * 100, 0)}% (${u.stress(c.val, u.usc ? 0 : 1)} / ${u.stress(c.allow, u.usc ? 0 : 1)})`, { fs: 9.5 });
    });
    out += `<line x1="${x0 + W / 1.5}" y1="${y0 - 2}" x2="${x0 + W / 1.5}" y2="${y0 + checks.length * 22}" stroke="var(--fail-text)" stroke-dasharray="4 3" stroke-width="1.2"/>`;
    return out;
  }

  function svgSaddle(r, u) {
    const z = r.zick, s = state;
    const Do = s.Di_mm + 2 * s.t_mm, H = Math.max(0, s.H_mm), tot = z.L + 2 * H;
    const sc = Math.min(470 / tot, 110 / Do), cx = 280, yc = 85, rr = Do * sc / 2;
    const xt1 = cx - z.L * sc / 2, xt2 = cx + z.L * sc / 2, hx = H * sc;
    const xs = [xt1 + z.A * sc, xt2 - z.A * sc], yg = yc + rr + 34;
    let g = `<path d="M${fx(xt1, 1)},${fx(yc - rr, 1)} L${fx(xt2, 1)},${fx(yc - rr, 1)} A${fx(Math.max(hx, 1), 1)},${fx(rr, 1)} 0 0 1 ${fx(xt2, 1)},${fx(yc + rr, 1)} L${fx(xt1, 1)},${fx(yc + rr, 1)} A${fx(Math.max(hx, 1), 1)},${fx(rr, 1)} 0 0 1 ${fx(xt1, 1)},${fx(yc - rr, 1)} Z" fill="${COL.shell}" stroke="${COL.stroke}" stroke-width="1.5"/>`;
    g += `<line x1="${fx(xt1, 1)}" y1="${fx(yc - rr, 1)}" x2="${fx(xt1, 1)}" y2="${fx(yc + rr, 1)}" stroke="${COL.stroke}" stroke-dasharray="3 3"/><line x1="${fx(xt2, 1)}" y1="${fx(yc - rr, 1)}" x2="${fx(xt2, 1)}" y2="${fx(yc + rr, 1)}" stroke="${COL.stroke}" stroke-dasharray="3 3"/>`;
    g += `<line x1="20" y1="${fx(yg, 1)}" x2="540" y2="${fx(yg, 1)}" stroke="${COL.stroke}" stroke-width="1.5"/>`;
    xs.forEach(x => {
      const bw = Math.max(8, s.b_mm * sc);
      g += `<path d="M${fx(x - bw / 2 - 10, 1)},${fx(yg, 1)} L${fx(x - bw / 2, 1)},${fx(yc + rr * 0.6, 1)} L${fx(x + bw / 2, 1)},${fx(yc + rr * 0.6, 1)} L${fx(x + bw / 2 + 10, 1)},${fx(yg, 1)} Z" fill="rgba(245,158,11,0.35)" stroke="rgba(217,119,6,0.9)"/>`;
      g += `<line x1="${fx(x, 1)}" y1="${fx(yg + 30, 1)}" x2="${fx(x, 1)}" y2="${fx(yg + 4, 1)}" stroke="var(--accent-primary)" stroke-width="2"/><path d="M${fx(x - 4, 1)},${fx(yg + 10, 1)} L${fx(x, 1)},${fx(yg + 3, 1)} L${fx(x + 4, 1)},${fx(yg + 10, 1)}" fill="none" stroke="var(--accent-primary)" stroke-width="2"/>`;
      g += T(x, yg + 42, `Q = ${u.force(z.Q)}`, { a: 'middle', fs: 10.5, w: 700 });
    });
    // A and L dimensions
    const yd = yc - rr - 12;
    g += `<line x1="${fx(xt1, 1)}" y1="${fx(yd, 1)}" x2="${fx(xs[0], 1)}" y2="${fx(yd, 1)}" stroke="currentColor" stroke-width="1"/>` + T((xt1 + xs[0]) / 2, yd - 4, `A = ${u.len(z.A, 0)}`, { a: 'middle', fs: 10 });
    g += T(cx, yc + 4, `L(T/T) = ${u.longLen(z.L)} · D_o = ${u.longLen(Do)}`, { a: 'middle', fs: 10.5 });
    g += T(cx, yd - 4, `S2 midspan = ${u.stress(z.S2)}`, { a: 'middle', fs: 10 });
    // End view with contact angle θ
    const ex = 615, ey = 85, er = 42, half = z.thetaDeg / 2 * Math.PI / 180;
    const p1 = [ex - er * Math.sin(half), ey + er * Math.cos(half)], p2 = [ex + er * Math.sin(half), ey + er * Math.cos(half)];
    g += `<circle cx="${ex}" cy="${ey}" r="${er}" fill="${COL.shell}" stroke="${COL.stroke}" stroke-width="1.5"/>`;
    g += `<path d="M${fx(p1[0], 1)},${fx(p1[1], 1)} A${er},${er} 0 0 0 ${fx(p2[0], 1)},${fx(p2[1], 1)}" fill="none" stroke="rgba(217,119,6,0.95)" stroke-width="5"/>`;
    g += `<line x1="${ex}" y1="${ey}" x2="${fx(p1[0], 1)}" y2="${fx(p1[1], 1)}" stroke="currentColor" stroke-dasharray="3 2"/><line x1="${ex}" y1="${ey}" x2="${fx(p2[0], 1)}" y2="${fx(p2[1], 1)}" stroke="currentColor" stroke-dasharray="3 2"/>`;
    g += T(ex, ey - 8, `θ = ${fx(z.thetaDeg, 0)}°`, { a: 'middle', fs: 10.5, w: 700 }) + T(ex, ey - er - 8, 'End view', { a: 'middle', fs: 10 });
    g += T(ex, ey + er + 18, `horn S4 ${u.stress(z.S4, 0)}`, { a: 'middle', fs: 9.5 });
    const y0 = yg + 72, hgt = y0 + z.checks.length * 22 + 10;
    return `<svg viewBox="0 0 680 ${fx(hgt, 0)}" role="img" aria-label="Horizontal vessel on two saddles with Zick stresses">${g}${bars(z.checks, y0, u)}</svg>`;
  }

  function svgSkirt(r, u) {
    const k = r.skirt, s = state;
    const Do = k.Do, Htot = k.Htot * 1000, sc = Math.min(230 / Htot, 100 / Do);
    const yg = 260, cx = 170, rw = Do * sc / 2, hs = s.skirtH_mm * sc, hh = Math.max(2, s.H_mm * sc), Ls = s.Ltt_mm * sc;
    const yb = yg - hs, yt = yb - hh - Ls - hh;
    let g = `<line x1="20" y1="${yg}" x2="660" y2="${yg}" stroke="${COL.stroke}" stroke-width="1.5"/>`;
    g += `<rect x="${fx(cx - rw, 1)}" y="${fx(yb, 1)}" width="${fx(2 * rw, 1)}" height="${fx(hs, 1)}" fill="rgba(245,158,11,0.3)" stroke="rgba(217,119,6,0.9)"/>`;
    g += `<path d="M${fx(cx - rw, 1)},${fx(yb - hh, 1)} L${fx(cx - rw, 1)},${fx(yb - hh - Ls, 1)} A${fx(rw, 1)},${fx(hh, 1)} 0 0 1 ${fx(cx + rw, 1)},${fx(yb - hh - Ls, 1)} L${fx(cx + rw, 1)},${fx(yb - hh, 1)} A${fx(rw, 1)},${fx(hh, 1)} 0 0 1 ${fx(cx - rw, 1)},${fx(yb - hh, 1)} Z" fill="${COL.shell}" stroke="${COL.stroke}" stroke-width="1.5"/>`;
    for (let i = 0; i < 5; i++) {
      const y = yt + (yg - yt) * (i + 0.5) / 5, len = 22 + 18 * (1 - i / 5);
      g += `<line x1="${fx(cx - rw - 12 - len, 1)}" y1="${fx(y, 1)}" x2="${fx(cx - rw - 8, 1)}" y2="${fx(y, 1)}" stroke="var(--accent-primary)" stroke-width="2"/><path d="M${fx(cx - rw - 14, 1)},${fx(y - 4, 1)} L${fx(cx - rw - 8, 1)},${fx(y, 1)} L${fx(cx - rw - 14, 1)},${fx(y + 4, 1)}" fill="none" stroke="var(--accent-primary)" stroke-width="2"/>`;
    }
    g += T(20, yt - 6 < 14 ? 14 : yt - 6, `V = ${u.vel(k.V)} · q_z = ${u.pa(k.qz)}`, { fs: 10 });
    g += T(cx + rw + 8, yg - hs / 2, `skirt ${u.len(s.tSkirt_mm, u.usc ? 3 : 0)}`, { fs: 9.5 });
    g += T(cx + rw + 8, yb - hh - Ls / 2, `H = ${u.longLen(Htot)}`, { fs: 10 });
    // Moment diagram M(z) = M_base·(1 − z/H)²
    const mx0 = 420, mw = 170;
    let path = `M${mx0},${fx(yt, 1)}`;
    for (let i = 0; i <= 20; i++) { const zf = i / 20, y = yt + (yg - yt) * zf; path += ` L${fx(mx0 + mw * zf * zf, 1)},${fx(y, 1)}`; }
    path += ` L${mx0},${yg} Z`;
    g += `<path d="${path}" fill="rgba(99,102,241,0.25)" stroke="rgba(99,102,241,0.9)"/><line x1="${mx0}" y1="${fx(yt, 1)}" x2="${mx0}" y2="${yg}" stroke="currentColor"/>`;
    g += T(mx0, yt - 6 < 14 ? 14 : yt - 6, 'Wind moment M(z)', { fs: 10, w: 700 }) + T(mx0 + mw, yg - 6, `M_base = ${u.moment(k.M)}`, { a: 'end', fs: 10, w: 700 });
    g += T(mx0 + 6, yg + 16, `F = ${u.force(k.F)} at H/2`, { fs: 10 });
    const y0 = yg + 50, hgt = y0 + k.checks.length * 22 + 10;
    const chk = k.checks.map(c => Object.assign({}, c, { label: c.id === 'op' ? 'Operating compression' : c.id === 'em' ? 'Empty net tension' : 'Hydrotest compression' }));
    return `<svg viewBox="0 0 680 ${fx(hgt, 0)}" role="img" aria-label="Vertical vessel on skirt with wind load and moment diagram">${g}${bars(chk, y0, u)}</svg>`;
  }

  function svgNozzles(r, u) {
    const segs = [['A1 shell', 'rgba(56,189,248,0.6)'], ['A2 neck', 'rgba(20,184,166,0.6)'], ['A4x welds', 'rgba(245,158,11,0.65)'], ['A5 pad', 'rgba(168,85,247,0.6)']];
    const vmax = Math.max(1, ...r.nozzles.map(n => Math.max(n.A, n.avail))) * 1.08;
    const x0 = 120, W = 400;
    let g = T(10, 16, 'UG-37 area replacement — available (stacked) vs required A (dashed)', { fs: 10.5, w: 700 });
    r.nozzles.forEach((n, i) => {
      const y = 30 + i * 40;
      const vals = [n.A1, n.hasPad ? n.A2pad : n.A2, n.A41 + n.A43 + (n.hasPad ? n.A42 : 0), n.A5];
      let x = x0;
      g += T(10, y + 15, `${n.key} ${n.nps}`, { fs: 10.5, w: 700 }) + T(10, y + 28, n.sched, { fs: 9 });
      vals.forEach((v, j) => { const w = Math.max(0, v) / vmax * W; if (w > 0.2) g += `<rect x="${fx(x, 1)}" y="${y + 4}" width="${fx(w, 1)}" height="20" fill="${segs[j][1]}"/>`; x += w; });
      const xa = x0 + n.A / vmax * W;
      g += `<line x1="${fx(xa, 1)}" y1="${y}" x2="${fx(xa, 1)}" y2="${y + 28}" stroke="var(--fail-text)" stroke-width="2" stroke-dasharray="4 2"/>`;
      g += T(x0 + W + 8, y + 12, `A = ${u.area(n.A)}`, { fs: 9.5 }) + T(x0 + W + 8, y + 25, `${fx(n.ratio, 2)}× · ${NZTXT[n.status]}`, { fs: 9.5, fill: n.status === 'NEEDS_PAD' ? 'var(--fail-text)' : 'var(--pass-text)' });
    });
    const yl = 30 + r.nozzles.length * 40 + 6;
    segs.forEach((s, j) => { g += `<rect x="${10 + j * 120}" y="${yl}" width="12" height="10" fill="${s[1]}"/>` + T(26 + j * 120, yl + 9, s[0], { fs: 9.5 }); });
    return `<svg viewBox="0 0 680 ${yl + 18}" role="img" aria-label="Nozzle reinforcement area bars">${g}</svg>`;
  }

  function traceSteps(r, u) {
    const s = state, n = r.govNoz, steps = [];
    steps.push([`1. Required shell thickness for UG-37 — ${esc(n.key)} (UG-27(c)(1), E = 1)`,
      't_r = P·R / (S·E − 0.6·P)   |   t_rn = P·R_n / (S_n·E − 0.6·P)   |   d = OD − 2·t_n (corroded)',
      `P = ${u.press(s.P_barg)}, R = ${u.len(n.R, 1)} (corroded), S = ${u.stress(n.S)}, R_n = ${u.len(n.Rn, 1)}, S_n = ${fx(n.fr, 2)}·S, t = ${u.len(n.t, 2)}, t_n = ${u.len(n.tn, 2)} (nominal ${u.len(n.tnNom, 2)} − CA)`,
      `t_r = ${u.len(n.tr, 2)} · t_rn = ${u.len(n.trn, 3)} · d = ${u.len(n.d, 1)}${n.exempt ? " · UG-36(c)(3) small-opening exemption may apply" : ""}${n.shellOk ? "" : " · WARNING: corroded shell t < t_r (UG-27) — shell itself is under-thickness, A1 = 0"}`]);
    steps.push([`2. Area required & available — Fig. UG-37.1 (${esc(n.key)} ${esc(n.nps)} ${esc(n.sched)})`,
      'A = d·t_r·F + 2·t_n·t_r·F·(1−f_r1) | A1 = max[d(E1·t−F·t_r) − 2t_n(E1·t−F·t_r)(1−f_r1), 2(t+t_n)(E1·t−F·t_r) − 2t_n(E1·t−F·t_r)(1−f_r1)] | A2 = min[5(t_n−t_rn)f_r2·t, 5(t_n−t_rn)f_r2·t_n] | A41 = leg²·f_r3, A43 = leg²·f_r2',
      `A1 options = ${u.area(n.A1a)} / ${u.area(n.A1b)} · A2 options = ${u.area(n.A2a)} / ${u.area(n.A2b)} · A41 = ${u.area(n.A41)} · A43 = ${u.area(n.A43)}`,
      `A = ${u.area(n.A)} · A1 + A2 + A41 + A43 = ${u.area(n.availNoPad)} → ${n.padRequired ? 'reinforcing pad required' : 'adequate without pad'}`]);
    if (n.padMin) {
      steps.push([`3. Reinforcing pad — A5 = (D_p − d − 2t_n)·t_e·f_r4, with pad A2 = min[5(t_n−t_rn)f_r2·t, 2(t_n−t_rn)(2.5t_n+t_e)f_r2], A42 = leg²·f_r4`,
        'D_p,min = d + 2t_n + [A − (A1 + A2 + A41 + A42 + A43)] / (t_e·f_r4)   ≤   2·L_d,  L_d = max(d, R_n + t_n + t)  (UG-40)',
        `t_e = ${u.len(s.padTe_mm, 1)}, A2(pad) = ${u.area(n.A2pad)}, A42 = ${u.area(n.A42)}, A5 needed = ${u.area(n.padMin.A5req)}, L_d = ${u.len(n.Ld, 0)}${n.hasPad ? `, fitted D_p = ${u.len(n.DpEff, 0)} → A5 = ${u.area(n.A5)}, total = ${u.area(n.availPad)}` : ''}`,
        n.padRequired ? `D_p ≥ ${u.len(n.padMin.DpReq, 0)} → pad width ≥ ${u.len(Math.max(0, n.padMin.widthMm), 0)}${n.padMin.withinLimit ? '' : ' (exceeds UG-40 limit — increase t_e or nozzle wall)'}` : 'No pad needed for this nozzle']);
    }
    if (r.zick) {
      const z = r.zick, K = z.K;
      steps.push(['4. Zick coefficients for θ (Zick 1951; tabulated in Megyesy, Pressure Vessel Handbook)',
        'K1 = (Δ + sinΔcosΔ − 2sin²Δ/Δ)/(sinΔ/Δ − cosΔ), Δ = π/6 + 5θ/12 | α = 0.95(π − θ/2): K2 = sinα/(π−α+sinαcosα), K3 = (sinα/π)(α−sinαcosα)/(π−α+sinαcosα), K4 = ⅜sin²α/(…), K5 = (1+cosα)/(…) | K6(β = π − θ/2), ¼ at A/R ≤ 0.5',
        `θ = ${fx(z.thetaDeg, 0)}°, A/R = ${fx(z.A / z.R, 3)}: K1(unstiff.) = ${fx(K.K1u, 3)}, K2 = ${fx(K.K2, 3)}, K3 = ${fx(K.K3, 3)}, K4 = ${fx(K.K4, 3)}, K5 = ${fx(K.K5, 3)}, K6(A/R≥1) = ${fx(K.K6full, 4)}`,
        `Used: K1 = ${fx(z.K1, 3)} (${z.stiff ? 'A ≤ R/2, head-stiffened' : 'A > R/2, unstiffened'}), K6 = ${fx(K.K6, 4)} (factor ${fx(K.f6, 2)})`]);
      steps.push(['5. Longitudinal bending S1 (saddle) and S2 (midspan) — Zick',
        'S1 = ±Q·A·[1 − (1 − A/L + (R²−H²)/(2AL)) / (1 + 4H/3L)] / (K1·R²·t_s)   |   S2 = ±(Q·L/4)·[(1 + 2(R²−H²)/L²)/(1 + 4H/3L) − 4A/L] / (π·R²·t_s)',
        `Q = ${u.force(z.Q)}, R = ${u.len(z.R, 1)} (mean, corroded), t_s = ${u.len(z.ts, 2)}, L = ${u.len(z.L, 0)}, A = ${u.len(z.A, 0)}, H = ${u.len(z.H, 0)}, PR/2t = ${u.stress(z.sigP)}`,
        `S1 = ±${u.stress(Math.abs(z.S1))} · S2 = ±${u.stress(Math.abs(z.S2))} · allow tension S·E = ${u.stress(z.S * z.E)}, compression min(0.5S_y, B) = ${u.stress(z.allowC)} (B = ${u.stress(z.Bfac)})`]);
      steps.push(['6. Tangential shear S3 — Zick',
        z.stiff ? 'A ≤ R/2: S3 = K3·Q/(R·t_s) (shell), K3·Q/(R·t_h) (head); additional head stress S3\' = K4·Q/(R·t_h), S3\' + σ_head ≤ 1.25·S' : 'A > R/2: S3 = K2·Q/(R·t_s) · (L − 2A)/(L + 4H/3)',
        z.stiff ? `t_h = ${u.len(z.th, 2)}, σ_head (UG-32(d)) = P(D + 0.2t_h)/(2t_h) = ${u.stress(z.sigHead)}` : `K2 = ${fx(K.K2, 3)}, (L − 2A)/(L + 4H/3) = ${fx((z.L - 2 * z.A) / (z.L + 4 * z.H / 3), 4)}`,
        `S3 = ${u.stress(Math.abs(z.S3))}${z.stiff ? ` · S3(head) = ${u.stress(z.S3h)} · S3' + σ_head = ${u.stress(z.S3hAdd + z.sigHead)}` : ''} · allow 0.8·S = ${u.stress(0.8 * z.S)}`]);
      steps.push(['7. Circumferential stress at horn S4 and bottom S5 — Zick',
        `S4 = −Q/[4t(b + 1.56√(R·t))] − ${z.long ? '3·K6·Q/(2t²)  (L ≥ 8R)' : '12·K6·Q·R/(L·t²)  (L < 8R)'}   |   S5 = −K5·Q/[t(b + 1.56√(R·t))]   (t = t_s + t_w, Megyesy)`,
        `b = ${u.len(z.b, 0)}, t = ${u.len(z.te, 2)}${z.tw > 0 ? ' (wear plate must extend R/10 above horn)' : ''}, b + 1.56√(Rt) = ${u.len(z.bEff, 0)}; terms = ${u.stress(z.S4a)} + ${u.stress(z.S4b)}`,
        `S4 = ${u.stress(z.S4)} (allow 1.5·S = ${u.stress(1.5 * z.S)}) · S5 = ${u.stress(z.S5)} (allow 0.5·S_y = ${u.stress(0.5 * z.Sy)})`]);
    } else {
      const k = r.skirt;
      steps.push(['4. Wind velocity pressure & base moment — ASCE 7-16 Eq. 26.10-1, 29.4-1 (screening)',
        'K_z = 2.01·(z/z_g)^(2/α) (Table 26.10-1) | q_z = 0.613·K_z·K_zt·K_d·V² [Pa] | F = q_z·G·C_f·D_eff·H | M = F·H/2',
        `z = H = ${u.longLen(k.Htot * 1000)}, Exp. ${esc(s.exposure)} → K_z = ${fx(k.Kz, 3)}, K_zt = ${fx(k.Kzt, 2)}, K_d = ${fx(k.Kd, 2)}, V = ${u.vel(k.V)}, G = ${fx(k.G, 2)}, C_f = ${fx(k.Cf, 2)}, D_eff = ${u.longLen(k.Deff * 1000)}`,
        `q_z = ${u.pa(k.qz)} · F = ${u.force(k.F)} · M_base = ${u.moment(k.M)}`]);
      steps.push(['5. Skirt longitudinal stress at base',
        'σ = W/(π·D_m·t) ± 4M/(π·D_m²·t),  D_m = D_o − t (skirt OD = shell OD), t = t_sk − CA',
        `D_m = ${u.len(k.Dm, 0)}, t = ${u.len(k.tsk, 2)}, W/πDt: oper. ${u.stress(k.sigWop)}, empty ${u.stress(k.sigWe)}; 4M/πD²t = ${u.stress(k.sigM)}`,
        `Compression (oper.) = ${u.stress(k.comp)} · net tension (empty) = ${u.stress(Math.max(0, k.tens))} (allow S·E_w = ${u.stress(k.S * k.Ew)}) · hydrotest = ${u.stress(k.hyd)}`]);
      steps.push(['6. Skirt buckling — UG-23(b) factor B (simplified, elastic line)',
        'A = 0.125 / (R_o / t)   |   B = A·E/2  (E = 200 GPa)   |   σ_c ≤ min(B, S)',
        `R_o/t = ${fx(k.Do / 2 / k.tsk, 1)}, A = ${fx(k.Afac, 6)}`,
        `B = ${u.stress(k.B)} → allowable compression = ${u.stress(k.allowC)}`]);
      steps.push(['7. Anchor bolts (indicative, Megyesy approach)',
        'T_bolt = 4M/(N·D_b) − W_empty/N   |   A_root ≥ T_bolt / S_b',
        `D_b = ${u.len(k.Db, 0)}, N = ${k.N}, S_b = ${u.stress(k.Sb)}, T_bolt = ${u.force(k.Tb)}`,
        k.uplift ? `A_root ≥ ${u.area(k.AreqMm2)} → ${k.N} × ${esc(k.bolt)} bolts` : `No net uplift → ${k.N} × 1" minimum (practice)`]);
    }
    return steps;
  }

  function summaryRows() {
    const r = calc(state), u = F(isUSC()), rows = [];
    rows.push(['Vessel / orientation', `${state.tag} · ${state.orientation}`, `${u.len(state.Di_mm, 0)} ID × ${u.longLen(state.Ltt_mm)} T/T`]);
    r.nozzles.forEach(n => rows.push([`UG-37 ${n.key} ${n.nps} ${n.sched}`, `${NZTXT[n.status]} (${fx(n.ratio, 2)}× A)`,
      `A = ${u.area(n.A)}; A1+A2+A4x = ${u.area(n.availNoPad)}${n.padRequired && n.padMin ? `; pad ≥ ${u.len(Math.max(0, n.padMin.widthMm), 0)} wide × ${u.len(state.padTe_mm, 1)}` : ''}`]));
    if (r.zick) {
      const z = r.zick;
      rows.push(['Zick load per saddle Q', u.force(r.Q_N), `θ = ${fx(z.thetaDeg, 0)}°, A = ${u.len(z.A, 0)}`]);
      rows.push(['Zick S1 / S2 / S3', `${u.stress(Math.abs(z.S1))} / ${u.stress(Math.abs(z.S2))} / ${u.stress(Math.abs(z.S3))}`, 'Zick (Megyesy)']);
      rows.push(['Zick S4 horn / S5 bottom', `${u.stress(z.S4)} / ${u.stress(z.S5)}`, `allow 1.5S / 0.5Sy`]);
      rows.push(['Saddle governing check', `${z.ok ? 'PASS' : 'FAIL'} ${fx(z.gov.ratio * 100, 0)}%`, z.gov.label]);
    } else {
      const k = r.skirt;
      rows.push(['Wind q_z / base moment', `${u.pa(k.qz)} / ${u.moment(k.M)}`, 'ASCE 7-16 screening']);
      rows.push(['Skirt compression / tension', `${u.stress(k.comp)} / ${u.stress(Math.max(0, k.tens))}`, `allow ${u.stress(k.allowC)} / ${u.stress(k.S * k.Ew)}`]);
      rows.push(['Skirt governing check', `${k.ok ? 'PASS' : 'FAIL'} ${fx(k.gov.ratio * 100, 0)}%`, k.gov.label]);
      rows.push(['Anchor bolts (indicative)', k.uplift ? `${k.N} × ${k.bolt}` : `${k.N} × 1" min.`, `T/bolt = ${u.force(Math.max(0, k.Tb))}`]);
    }
    return rows;
  }

  function getState() { return JSON.parse(JSON.stringify(state)); }
  function setState(s) {
    state = normState(JSON.parse(JSON.stringify(s || {})));
    if (root) { syncInputs(); recompute(); }
  }

  const tool = {
    id: ID,
    title: 'Vessel Nozzles & Supports (ASME UG-37 / Zick)',
    std: 'ASME VIII-1 UG-37 · Zick · ASCE 7',
    presets, defaultState, calc, mount, getState, setState, summaryRows,
    ug37, zickK, zick, skirt, kzASCE7, PIPE
  };

  if (typeof window !== 'undefined' && window.PSVTools) window.PSVTools.register(tool);
  if (typeof module !== 'undefined' && module.exports) module.exports = tool;
})();
