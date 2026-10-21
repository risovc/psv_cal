/**
 * Node tests for tools/vessel-mech.js — run: node tests/tools/vessel-mech.test.js
 * Cross-checks against published worked examples / tabulated coefficients and independent USC formulations.
 */
const tool = require('../../tools/vessel-mech.js');

let passed = 0, failed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); } else { failed++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); } };
const near = (a, b, rel) => Number.isFinite(a) && Math.abs(a - b) <= Math.abs(b) * rel;
const IN = 25.4, PSI = 145.0377377, LBF = 4.4482216;

// ---------------------------------------------------------------------------------------------
// 1. Zick K coefficients vs tabulated values (Megyesy, Pressure Vessel Handbook, "Values of constant K")
// ---------------------------------------------------------------------------------------------
{
  const k120 = tool.zickK(120, 1), k150 = tool.zickK(150, 1);
  const tab = [['K1 120° (unstiff.)', k120.K1u, 0.335], ['K2 120°', k120.K2, 1.171], ['K3 120°', k120.K3, 0.880], ['K4 120°', k120.K4, 0.401],
    ['K5 120°', k120.K5, 0.760], ['K6 120° A/R≥1', k120.K6, 0.0528], ['K2 150°', k150.K2, 0.799], ['K3 150°', k150.K3, 0.485],
    ['K5 150°', k150.K5, 0.673], ['K6 150° A/R≥1', k150.K6, 0.0316]];
  const bad = tab.filter(t => !near(t[1], t[2], 0.01));
  check('Zick K1–K6 closed forms reproduce Megyesy K table (120°/150°) within 1%', bad.length === 0,
    tab.map(t => `${t[0]}=${t[1].toFixed(4)}`).join(', '));
  check('Zick K6 reduced to K6/4 for A/R ≤ 0.5 (Zick head-proximity rule)', near(tool.zickK(120, 0.4).K6, k120.K6 / 4, 1e-9));
}

// ---------------------------------------------------------------------------------------------
// 2. Megyesy Pressure Vessel Handbook Zick example: Q = 300,000 lb, R = 60 in, ts = 1 in, A = 48 in,
//    L = 960 in, H = 21 in, b = 24 in, θ = 120°, P = 250 psi. Published: S2 = 4,959 psi; S4 = −18,279 psi
//    (Megyesy reads K6 = 0.036 from the chart at A/R = 0.8; we interpolate K6 linearly → expect ≤ 3% high).
// ---------------------------------------------------------------------------------------------
{
  const z = tool.zick({ Q_N: 300000 * LBF, R_mm: 60 * IN, ts_mm: 1 * IN, th_mm: 1 * IN, L_mm: 960 * IN, A_mm: 48 * IN, H_mm: 21 * IN,
    b_mm: 24 * IN, tw_mm: 0, P_mpa: 250 / PSI, S_mpa: 20000 / PSI, Sy_mpa: 38000 / PSI, E: 0.85, thetaDeg: 120 });
  const S2 = Math.abs(z.S2) * PSI, S4 = z.S4 * PSI, S1 = Math.abs(z.S1) * PSI, S3 = Math.abs(z.S3) * PSI, S5 = Math.abs(z.S5) * PSI;
  check('Megyesy Zick example: S2 midspan = 4,959 psi (±1%)', near(S2, 4959, 0.01), `got ${S2.toFixed(0)} psi`);
  check('Megyesy Zick example: S4 horn = −18,279 psi (±3%, K6 chart vs interpolation)', near(S4, -18279, 0.03), `got ${S4.toFixed(0)} psi`);
  check('Megyesy Zick example: PR/2t = 7,500 psi and S2+PR/2t = 12,459 psi (±1%)', near(z.sigP * PSI, 7500, 0.001) && near(S2 + z.sigP * PSI, 12459, 0.01));
  // Independent USC re-derivation (inches, lb, psi) for S1, S3, S5 with tabulated K (K1 = 0.335, K2 = 1.171, K5 = 0.760)
  const Q = 300000, R = 60, t = 1, A = 48, L = 960, H = 21, b = 24;
  const S1u = Q * A * (1 - (1 - A / L + (R * R - H * H) / (2 * A * L)) / (1 + 4 * H / (3 * L))) / (0.335 * R * R * t);
  const S3u = 1.171 * Q / (R * t) * (L - 2 * A) / (L + 4 * H / 3);
  const S5u = 0.760 * Q / (t * (b + 1.56 * Math.sqrt(R * t)));
  check('Zick S1/S3/S5 vs independent USC hand formulation with tabulated K (±1%)', near(S1, S1u, 0.01) && near(S3, S3u, 0.01) && near(S5, S5u, 0.01),
    `S1 ${S1.toFixed(0)}/${S1u.toFixed(0)}, S3 ${S3.toFixed(0)}/${S3u.toFixed(0)}, S5 ${S5.toFixed(0)}/${S5u.toFixed(0)} psi`);
  check('Zick case selection: A = 48 in > R/2 → unstiffened (K1 = 0.335), L ≥ 8R → long-vessel S4', !z.stiff && z.long && near(z.K1, 0.335, 0.01));
  const zs = tool.zick({ Q_N: 300000 * LBF, R_mm: 60 * IN, ts_mm: IN, L_mm: 960 * IN, A_mm: 24 * IN, H_mm: 21 * IN, b_mm: 24 * IN, thetaDeg: 120, P_mpa: 0 });
  check('Zick A ≤ R/2: K1 = π (head-stiffened), S3 = K3·Q/(R·ts) with K3 = 0.880', zs.stiff && near(zs.K1, Math.PI, 1e-9) && near(Math.abs(zs.S3) * PSI, 0.880 * 300000 / 60, 0.01));
}

// ---------------------------------------------------------------------------------------------
// 3. UG-37 hand calculation (USC, Fig. UG-37.1 equations evaluated by hand):
//    P = 150 psi, shell ID 48 in, t = 0.500 in, CA = 0.0625 in, S = 20,000 psi, E1 = F = fr = 1;
//    NPS 6 Sch 40 (OD 6.625 in, tn = 0.280 in), outside fillet leg 0.375 in.
//    R = 24.0625, t = 0.4375 → tr = 150·24.0625/(20000 − 90) = 0.18129 in
//    d = 6.625 − 2(0.280 − 0.0625) = 6.190 in, Rn = 3.095 → trn = 150·3.095/19910 = 0.023317 in
//    A = 6.190·0.18129 = 1.1222 in²; A1 = max(6.190·0.25621, 2·0.655·0.25621) = 1.5860 in²
//    A2 = min(5·0.19418·0.4375, 5·0.19418·0.2175) = 0.21117 in²; A41 = 0.140625 in²
// ---------------------------------------------------------------------------------------------
{
  const r = tool.ug37({ P_mpa: 150 / PSI, Di_mm: 48 * IN, t_mm: 0.5 * IN, ca_mm: 0.0625 * IN, S_mpa: 20000 / PSI, fr: 1,
    od_mm: 6.625 * IN, tn_mm: 0.280 * IN, leg41_mm: 0.375 * IN, leg43_mm: 0, te_mm: 0, Dp_mm: 0 });
  const in2 = (mm2) => mm2 / 645.16;
  check('UG-37 hand calc: t_r = 0.18129 in, t_rn = 0.023317 in, d = 6.190 in (±0.2%)',
    near(r.tr / IN, 0.18129, 0.002) && near(r.trn / IN, 0.023317, 0.002) && near(r.d / IN, 6.190, 0.002), `tr=${(r.tr / IN).toFixed(5)} trn=${(r.trn / IN).toFixed(5)} d=${(r.d / IN).toFixed(4)}`);
  check('UG-37 hand calc: A = 1.1222, A1 = 1.5860, A2 = 0.21117, A41 = 0.14063 in² (±0.3%)',
    near(in2(r.A), 1.1222, 0.003) && near(in2(r.A1), 1.5860, 0.003) && near(in2(r.A2), 0.21117, 0.003) && near(in2(r.A41), 0.140625, 0.003),
    `A=${in2(r.A).toFixed(4)} A1=${in2(r.A1).toFixed(4)} A2=${in2(r.A2).toFixed(4)} A41=${in2(r.A41).toFixed(4)}`);
  check('UG-37 edge case: pad NOT required when A1 + A2 + A41 ≥ A', !r.padRequired && r.status === 'PASS' && in2(r.availNoPad) > 1.9);

  // fr < 1 (weaker nozzle): A gains 2·tn·tr·(1 − fr1) and A2 scales with fr2 — independent USC evaluation
  const fr = 0.75;
  const rf = tool.ug37({ P_mpa: 150 / PSI, Di_mm: 48 * IN, t_mm: 0.5 * IN, ca_mm: 0.0625 * IN, S_mpa: 20000 / PSI, fr,
    od_mm: 6.625 * IN, tn_mm: 0.280 * IN, leg41_mm: 0.375 * IN });
  const tr = 150 * 24.0625 / 19910, tn = 0.2175, trn = 150 * 3.095 / (20000 * fr - 90), t = 0.4375, d = 6.190;
  const Au = d * tr + 2 * tn * tr * (1 - fr);
  const A1u = Math.max(d * (t - tr) - 2 * tn * (t - tr) * (1 - fr), 2 * (t + tn) * (t - tr) - 2 * tn * (t - tr) * (1 - fr));
  const A2u = Math.min(5 * (tn - trn) * fr * t, 5 * (tn - trn) * fr * tn);
  check('UG-37 with f_r = 0.75 vs independent USC formulation (A, A1, A2 ±0.3%)',
    near(in2(rf.A), Au, 0.003) && near(in2(rf.A1), A1u, 0.003) && near(in2(rf.A2), A2u, 0.003), `A=${in2(rf.A).toFixed(4)}/${Au.toFixed(4)}`);

  // Thin shell, large nozzle → pad required; the computed minimum pad exactly closes the area balance
  const base = { P_mpa: 2.0, Di_mm: 2000, t_mm: 14, ca_mm: 3, S_mpa: 138, fr: 1, od_mm: 406.4, tn_mm: 12.7, leg41_mm: 10, te_mm: 14 };
  const r0 = tool.ug37(base);
  const rp = tool.ug37(Object.assign({}, base, { Dp_mm: r0.padMin.DpReq }));
  check('UG-37 pad sizing: pad required, and D_p,min gives A_avail = A (±0.1%) within UG-40 limit',
    r0.padRequired && r0.status === 'NEEDS_PAD' && near(rp.availPad, rp.A, 0.001) && rp.status === 'PASS_PAD' && r0.padMin.withinLimit,
    `A=${r0.A.toFixed(0)} mm², no-pad=${r0.availNoPad.toFixed(0)} mm², pad width=${r0.padMin.widthMm.toFixed(0)} mm`);
  const rpBig = tool.ug37(Object.assign({}, base, { Dp_mm: 5000 }));
  check('UG-37 pad credit capped at UG-40 limit 2·L_d', near(rpBig.DpEff, 2 * rpBig.Ld, 1e-9));
}

// ---------------------------------------------------------------------------------------------
// 4. Skirt / wind — independent USC formulation (ASCE 7-16 Eq. 26.10-1 USC: qz = 0.00256·Kz·Kzt·Kd·V², psf, mph)
// ---------------------------------------------------------------------------------------------
{
  const p = { Do_mm: 1828, tsk_mm: 12, ca_mm: 3, Htot_m: 9.4, V_ms: 45, exposure: 'C', Kzt: 1, Kd: 0.95, G: 0.85, Cf: 0.7, kD: 1.2,
    Wop_kg: 22000, We_kg: 11000, Wh_kg: 26000, S_mpa: 138, Eweld: 0.7, boltS_mpa: 138 };
  const k = tool.skirt(p);
  const Hft = 9.4 / 0.3048, Vmph = 45 / 0.44704, Kz = 2.01 * Math.pow(Hft / 900, 2 / 9.5);
  const qpsf = 0.00256 * Kz * 1 * 0.95 * Vmph * Vmph;
  const Dft = 1828 / 304.8 * 1.2;
  const Flb = qpsf * 0.85 * 0.7 * Dft * Hft;
  const Minlb = Flb * Hft / 2 * 12;                                  // in·lb
  const tin = 9 / 25.4, Dmin = (1828 - 9) / 25.4;
  const Wop = 22000 * 2.20462262;                                    // lb (1 kgf = 2.2046 lbf)
  const comp = Wop / (Math.PI * Dmin * tin) + 4 * Minlb / (Math.PI * Dmin * Dmin * tin);
  check('ASCE 7 Kz (Exp. C, z = 9.4 m) vs USC table formula 2.01(z/900 ft)^(2/9.5)', near(k.Kz, Kz, 1e-6), `Kz=${k.Kz.toFixed(4)}`);
  check('Skirt: q_z, F, M vs independent USC calc (±0.5%)', near(k.qz * 0.020885434, qpsf, 0.005) && near(k.F / LBF, Flb, 0.005) && near(k.M * 8.8507458, Minlb, 0.005),
    `qz=${qpsf.toFixed(2)} psf, F=${Flb.toFixed(0)} lb, M=${(Minlb / 12).toFixed(0)} ft·lb`);
  check('Skirt operating compression W/πDt + 4M/πD²t vs independent USC calc (±0.5%)', near(k.comp * PSI, comp, 0.005), `${(k.comp * PSI).toFixed(0)} vs ${comp.toFixed(0)} psi`);
  check('Kz floor: z < 4.6 m (15 ft) uses 15 ft (ASCE 7-16 Table 26.10-1 note)', near(tool.kzASCE7(2, 'C'), 2.01 * Math.pow(15 / 900, 2 / 9.5), 1e-6));
}

// ---------------------------------------------------------------------------------------------
// 5. calc()/summaryRows() integrity over presets — finite numbers, ≥ 4 rows, no NaN/undefined strings
// ---------------------------------------------------------------------------------------------
{
  let ok = true, msg = [];
  for (const pr of tool.presets) {
    tool.setState(JSON.parse(JSON.stringify(pr.state)));
    const r = tool.calc(tool.getState());
    const rows = tool.summaryRows();
    const txt = JSON.stringify(rows);
    if (!(rows.length >= 4 && rows.every(x => x.length === 3 && x.every(c => typeof c === 'string'))) || /NaN|undefined|Infinity|\[object Object\]/.test(txt)) { ok = false; msg.push(pr.id); }
    if (!r.nozzles.every(n => Number.isFinite(n.A) && Number.isFinite(n.avail))) { ok = false; msg.push(pr.id + ':nozzles'); }
  }
  // degenerate / hostile inputs must not produce NaN
  const r = tool.calc({ Di_mm: 0, Ltt_mm: -5, t_mm: 'x', P_barg: NaN, A_mm: 1e9, nozzles: [{ nps: 'bogus' }], orientation: 'vertical', V_ms: -3 });
  const txt = JSON.stringify(r);
  if (/NaN|null/.test(JSON.stringify(r.skirt.checks)) || !r.nozzles.every(n => Number.isFinite(n.ratio))) { ok = false; msg.push('degenerate'); }
  check('Presets + degenerate inputs: finite results, summaryRows ≥ 4 clean string rows', ok && txt.length > 0, msg.join(','));
  const st = tool.getState(); tool.setState(st);
  check('getState()/setState() round-trip is lossless (canonical SI)', JSON.stringify(tool.getState()) === JSON.stringify(st));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
