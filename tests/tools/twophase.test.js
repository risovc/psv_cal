/**
 * Tests for tools/twophase.js (Beggs-Brill + homogeneous + API RP 14E).
 * Run: node tests/tools/twophase.test.js
 *
 * Cross-checks use an INDEPENDENT USC-unit implementation written here (g = 32.174 ft/s², g_c,
 * Re = 1488·ρ·v·d/μ, NLv = 1.938·vSL·(ρL/σ)^0.25, iterative Colebrook friction factor) rather than
 * the module's SI code path (Churchill friction factor, SI dimensionless groups).
 */
const tool = require('../../tools/twophase.js');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

// ---------------- independent USC reference implementation ----------------
const FT = 0.3048, LBM = 0.45359237, PSI = 6894.757293;
const gUS = 32.174;
function colebrook(Re, eD) {
  if (Re < 2000) return 64 / Re;
  let f = 0.02;
  for (let i = 0; i < 100; i++) f = Math.pow(-2 * Math.log10(eD / 3.7 + 2.51 / (Re * Math.sqrt(f))), -2);
  return f;
}
/** Beggs & Brill per Brill & Mukherjee (1999) §4.2.3, all USC. Returns psi/ft gradients (no acceleration term). */
function bbUSC({ vSL, vSG, dFt, rhoL, rhoG, muL, muG, sigDyn, thetaDeg, epsFt }) {
  const vm = vSL + vSG, lam = vSL / vm, NFr = vm * vm / (gUS * dFt);
  const NLv = 1.938 * vSL * Math.pow(rhoL / sigDyn, 0.25);
  const L1 = 316 * lam ** 0.302, L2 = 0.0009252 * lam ** -2.4684, L3 = 0.1 * lam ** -1.4516, L4 = 0.5 * lam ** -6.738;
  let pat;
  if ((lam < 0.01 && NFr < L1) || (lam >= 0.01 && NFr < L2)) pat = 'Segregated';
  else if (lam >= 0.01 && NFr <= L3) pat = 'Transition';
  else if ((lam < 0.4 && NFr <= L1) || (lam >= 0.4 && NFr <= L4)) pat = 'Intermittent';
  else pat = 'Distributed';
  const th = thetaDeg * Math.PI / 180;
  const T = { Segregated: [0.98, 0.4846, 0.0868, [0.011, -3.768, 3.539, -1.614]], Intermittent: [0.845, 0.5351, 0.0173, [2.96, 0.305, -0.4473, 0.0978]], Distributed: [1.065, 0.5824, 0.0609, null] };
  const hl = (p) => {
    const [a, b, c, up] = T[p];
    const h0 = Math.max(lam, a * lam ** b / NFr ** c);
    const co = thetaDeg < 0 ? [4.70, -0.3692, 0.1244, -0.5056] : up;
    const C = co && thetaDeg !== 0 ? Math.max(0, (1 - lam) * Math.log(co[0] * lam ** co[1] * NLv ** co[2] * NFr ** co[3])) : 0;
    const x = Math.sin(1.8 * th);
    return { h0, C, h: h0 * (1 + C * (x - 0.333 * x ** 3)) };
  };
  let r;
  if (pat === 'Transition') { const A = (L3 - NFr) / (L3 - L2); const s = hl('Segregated'), i = hl('Intermittent'); r = { h0: A * s.h0 + (1 - A) * i.h0, C: NaN, h: A * s.h + (1 - A) * i.h }; }
  else r = hl(pat);
  let HL = r.h * (thetaDeg > 0 ? 0.924 : thetaDeg < 0 ? 0.685 : 1);
  if (thetaDeg >= 0) HL = Math.max(lam, HL);
  const rhoN = rhoL * lam + rhoG * (1 - lam), muN = muL * lam + muG * (1 - lam);
  const Re = 1488 * rhoN * vm * dFt / muN;
  const fn = colebrook(Re, epsFt / dFt);
  const y = lam / HL ** 2, ly = Math.log(y);
  const S = y > 1 && y < 1.2 ? Math.log(2.2 * y - 1.2) : ly / (-0.0523 + 3.182 * ly - 0.8725 * ly ** 2 + 0.01853 * ly ** 4);
  const ftp = fn * Math.exp(S);
  const rhoS = rhoL * HL + rhoG * (1 - HL);
  const fric = ftp * rhoN * vm * vm / (2 * gUS * dFt) / 144;    // lbf/ft² per ft → psi/ft
  const elev = rhoS * Math.sin(th) / 144;                        // (g/gc)·ρs·sinθ, psi/ft
  return { pat, lam, NFr, NLv, L1, L2, L3, L4, h0: r.h0, C: r.C, HL, fn, y, S, ftp, fric, elev, total: fric + elev };
}
const toSI = (u) => ({ vSL: u.vSL * FT, vSG: u.vSG * FT, D: u.dFt * FT, rhoL: u.rhoL * LBM / FT ** 3, rhoG: u.rhoG * LBM / FT ** 3, muL: u.muL, muG: u.muG, sigma: u.sigDyn * 1e-3, theta: u.thetaDeg * Math.PI / 180, eps: u.epsFt * FT, pAbsPa: 1e9 /* acceleration negligible */ });
const siGradPsiFt = (paPerM) => paPerM * FT / PSI;

// ---------------- 1. Brill & Mukherjee (1999) Example 3.2 data, Beggs & Brill method ----------------
// Data: vSL=3.97 ft/s, vSG=3.86 ft/s, d=6 in, ρL=47.61, ρg=5.88 lbm/ft³, σL=8.41 dyn/cm, μL=0.97 cP, μg=0.016 cP,
// ε=0.00006 ft, vertical upward (θ=90°). Reference values hand-computed from the B&B (1973) equations as
// tabulated in the same text: λL=0.507, NFr=3.81, intermittent, HL(0)=0.574, C<0→0, HL(Payne)=0.530,
// dp/dz ≈ 0.203 psi/ft (elevation 0.195 + friction 0.008).
const ex = { vSL: 3.97, vSG: 3.86, dFt: 0.5, rhoL: 47.61, rhoG: 5.88, muL: 0.97, muG: 0.016, sigDyn: 8.41, thetaDeg: 90, epsFt: 0.00006 };
const bx = tool.beggsBrill(toSI(ex));
check('Brill & Mukherjee Ex. 3.2 data: λL = 0.507, NFr = 3.81, NLv = 11.87', rel(bx.lam, 0.507) < 0.002 && rel(bx.NFr, 3.81) < 0.003 && rel(bx.NLv, 11.87) < 0.005,
  `λL=${bx.lam.toFixed(4)} NFr=${bx.NFr.toFixed(3)} NLv=${bx.NLv.toFixed(3)}`);
check('Brill & Mukherjee Ex. 3.2 data: flow pattern = Intermittent', bx.regime === 'Intermittent', bx.regime);
check('Brill & Mukherjee Ex. 3.2 data: HL(0) = 0.574, C → 0, HL(90°, Payne ×0.924) = 0.530',
  Math.abs(bx.HL0 - 0.574) < 0.003 && bx.C === 0 && Math.abs(bx.HL - 0.530) < 0.003, `HL0=${bx.HL0.toFixed(4)} C=${bx.C} HL=${bx.HL.toFixed(4)}`);
const gx = siGradPsiFt(bx.gradF + bx.gradEl);
check('Brill & Mukherjee Ex. 3.2 data: dp/dz ≈ 0.203 psi/ft (±3%)', rel(gx, 0.203) < 0.03,
  `total=${gx.toFixed(4)} psi/ft (el ${siGradPsiFt(bx.gradEl).toFixed(4)}, fr ${siGradPsiFt(bx.gradF).toFixed(4)})`);

// ---------------- 2. L1–L4 boundary formulas ----------------
const bd = tool.bbBoundaries(0.507);
check('L1–L4 at λL = 0.507: 257.4 / 4.95e-3 / 0.268 / 48.6 (hand-computed, Brill & Beggs 1991)',
  rel(bd.L1, 257.4) < 0.003 && rel(bd.L2, 0.00495) < 0.01 && rel(bd.L3, 0.268) < 0.005 && rel(bd.L4, 48.6) < 0.005,
  `L1=${bd.L1.toFixed(2)} L2=${bd.L2.toExponential(3)} L3=${bd.L3.toFixed(4)} L4=${bd.L4.toFixed(2)}`);
const b01 = tool.bbBoundaries(0.01), b04 = tool.bbBoundaries(0.4);
check('Map topology: L1≈L2≈L3 meet near λL=0.01 (NFr≈80) and L1≈L4 near λL=0.4 (NFr≈240)',
  rel(b01.L2, b01.L1) < 0.05 && rel(b01.L3, b01.L1) < 0.05 && rel(b04.L4, b04.L1) < 0.02,
  `λ=0.01: ${b01.L1.toFixed(1)}/${b01.L2.toFixed(1)}/${b01.L3.toFixed(1)}; λ=0.4: L1=${b04.L1.toFixed(1)} L4=${b04.L4.toFixed(1)}`);

// ---------------- 3. Regime classification sanity at extremes ----------------
const cases = [[0.001, 1e3, 'Distributed'], [0.001, 0.1, 'Segregated'], [0.9, 1e-4, 'Segregated'], [0.9, 100, 'Distributed'], [0.2, 10, 'Intermittent'], [0.2, 0.5, 'Transition'], [0.6, 5, 'Intermittent']];
const bad = cases.filter(([l, f, exp]) => tool.bbRegime(l, f) !== exp);
check('Regime classification at extreme / mid-map points (7 cases)', bad.length === 0, bad.length ? 'wrong: ' + JSON.stringify(bad) : 'all match');

// ---------------- 4. Module vs independent USC Beggs-Brill (several inclinations / patterns) ----------------
const xs = [
  { ...ex },
  { vSL: 0.5, vSG: 20, dFt: 0.333, rhoL: 50, rhoG: 2.5, muL: 1.5, muG: 0.012, sigDyn: 20, thetaDeg: 0, epsFt: 0.00015 },   // horizontal
  { vSL: 0.3, vSG: 1.5, dFt: 0.667, rhoL: 55, rhoG: 1.2, muL: 2.0, muG: 0.011, sigDyn: 25, thetaDeg: 5, epsFt: 0.00015 },   // uphill segregated
  { vSL: 2.0, vSG: 6.0, dFt: 0.5, rhoL: 50, rhoG: 3.0, muL: 1.0, muG: 0.012, sigDyn: 15, thetaDeg: -10, epsFt: 0.00015 },   // downhill
  { vSL: 0.2, vSG: 3.0, dFt: 1.0, rhoL: 50, rhoG: 3.0, muL: 1.0, muG: 0.012, sigDyn: 15, thetaDeg: 2, epsFt: 0.00015 }      // transition
];
let worst = 0, pats = [];
for (const u of xs) {
  const R = bbUSC(u), M = tool.beggsBrill(toSI(u));
  pats.push(`${M.regime}/${R.pat}`);
  if (M.regime !== R.pat) worst = Infinity;
  worst = Math.max(worst, rel(M.HL, R.HL), rel(siGradPsiFt(M.gradF + M.gradEl), R.total));
}
check('Module (SI, Churchill) vs independent USC B&B (Colebrook): pattern match, HL & dp/dL within 1.5%', worst < 0.015, `max dev ${(worst * 100).toFixed(2)}% · ${pats.join(', ')}`);

// Payne: downhill holdup lower than uphill for identical flows
const up = tool.beggsBrill(toSI({ ...xs[3], thetaDeg: 10 })), dn = tool.beggsBrill(toSI(xs[3]));
check('Payne et al. corrections: HL(downhill −10°) < HL(uphill +10°) and factors 0.685 / 0.924', dn.HL < up.HL && dn.payne === 0.685 && up.payne === 0.924, `HL↓=${dn.HL.toFixed(3)} HL↑=${up.HL.toFixed(3)}`);

// ---------------- 5. API RP 14E erosional velocity ----------------
check('API RP 14E Eq. 2.14: ρm = 40 lb/ft³, C = 100 → Ve = 15.8 ft/s', Math.abs(tool.erosionalVelocityFtS(100, 40) - 15.81) < 0.01, tool.erosionalVelocityFtS(100, 40).toFixed(3) + ' ft/s');
{
  // full calc: choose flows so no-slip ρm = 40 lb/ft³ exactly → Ve(C=125) = 19.76 ft/s
  const rhoL = 50 / 0.06242796 * 1, rhoG = 2 / 0.06242796;          // 50 and 2 lb/ft³ in kg/m³
  const lam = (40 - 2) / (50 - 2);                                    // volume fraction liquid
  const qL = lam * 0.05, qG = (1 - lam) * 0.05;                       // m³/s
  const r = tool.calc({ ...tool.defaultState(), wLiqKgHr: qL * rhoL * 3600, wGasKgHr: qG * rhoG * 3600, rhoL, rhoG, cFactor: 125 });
  check('calc(): no-slip ρm = 40 lb/ft³ with C = 125 → Ve = 19.76 ft/s (6.02 m/s)', Math.abs(r.rhoLb - 40) < 0.01 && Math.abs(r.veFtS - 19.764) < 0.01, `ρm=${r.rhoLb.toFixed(3)} lb/ft³ Ve=${r.veFtS.toFixed(3)} ft/s`);
}

// ---------------- 6. Homogeneous ΔP vs independent USC Darcy-Weisbach ----------------
{
  const st = { wGasKgHr: 10000, wLiqKgHr: 40000, rhoG: 30, rhoL: 750, muG: 0.013, muL: 1.2, sigma: 15, nps: '6"', schedule: 'Sch 40 (Std)', idMm: 154.05, lengthM: 250, elevM: 10, roughMm: 0.0457, pInBarg: 40, cFactor: 100 };
  const r = tool.calc(st);
  // USC: W lb/s, ρ lb/ft³, d ft, ε ft, L ft
  const Wg = st.wGasKgHr * 2.20462262 / 3600, Wl = st.wLiqKgHr * 2.20462262 / 3600;
  const rg = st.rhoG * 0.06242796, rl = st.rhoL * 0.06242796;
  const d = 154.05 / 304.8, A = Math.PI * d * d / 4;
  const Qg = Wg / rg, Ql = Wl / rl, vm = (Qg + Ql) / A, lam = Ql / (Qg + Ql);
  const rho = (Wg + Wl) / (Qg + Ql), mu = st.muL * lam + st.muG * (1 - lam);
  const Re = 1488 * rho * vm * d / mu, f = colebrook(Re, (0.0457 / 304.8) / d);
  const Lft = 250 / FT, dzFt = 10 / FT;
  const dpPsi = f * (Lft / d) * rho * vm * vm / (2 * gUS) / 144 + rho * dzFt / 144;
  const dpBar = dpPsi / 14.5037738;
  check('Homogeneous ΔP (SI, Churchill) vs independent USC Darcy-Weisbach + Colebrook within 1%', rel(r.homog.dpTotBar, dpBar) < 0.01, `module ${r.homog.dpTotBar.toFixed(4)} bar vs USC ${dpBar.toFixed(4)} bar (${dpPsi.toFixed(3)} psi)`);
  check('Mixture velocity & ρv² consistent with USC (ρv² = ρm·vm²)', rel(r.bb.vm, vm * FT) < 1e-4 && rel(r.rhoV2, rho / 0.06242796 * (vm * FT) ** 2) < 1e-4, `vm=${r.bb.vm.toFixed(3)} m/s J=${r.rhoV2.toFixed(0)} Pa`);
}

// ---------------- 7. Churchill vs Colebrook ----------------
{
  let w = 0;
  for (const Re of [5e3, 3e4, 2e5, 1e6, 1e7]) for (const eD of [0, 1e-5, 1e-4, 1e-3, 1e-2]) w = Math.max(w, rel(tool.churchill(Re, eD), colebrook(Re, eD)));
  check('Churchill (1977) vs Colebrook-White over Re 5e3–1e7, ε/D 0–0.01: within 3%', w < 0.03, `max dev ${(w * 100).toFixed(2)}%`);
}

// ---------------- 8. Robustness, presets & summaryRows ----------------
{
  const BAD = /NaN|undefined|Infinity|\[object Object\]/;
  const garbage = tool.calc({ wGasKgHr: 'abc', wLiqKgHr: -5, rhoG: 0, rhoL: null, lengthM: 0, elevM: 1e9, nps: 'zz', schedule: 'none', cFactor: 7 });
  const okG = Number.isFinite(garbage.dpTotBar) && Number.isFinite(garbage.veMS) && garbage.scan.every(s => Number.isFinite(s.dp100Bar));
  const presetsOk = tool.presets.length >= 2 && tool.presets.every(p => { const r = tool.calc(p.state); return Number.isFinite(r.dpTotBar) && r.scan.length >= 10; });
  const rows = tool.summaryRows();
  const rowsOk = rows.length >= 4 && rows.every(r => r.length === 3 && r.every(c => typeof c === 'string' && !BAD.test(c)));
  check('Garbage input clamps to finite results; presets compute; summaryRows ≥4 clean string rows', okG && presetsOk && rowsOk, `${tool.presets.length} presets, ${rows.length} rows`);
  const s = tool.defaultState(); const r1 = tool.calc(s), r2 = tool.calc(JSON.parse(JSON.stringify(s)));
  check('Scan includes 2"–24" and selected row matches chosen NPS', r1.scan[0].nps === '2"' && r1.scan[r1.scan.length - 1].nps === '24"' && r1.scan.some(x => x.selected && x.nps === s.nps) && r1.dpTotBar === r2.dpTotBar, `${r1.scan.length} sizes`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
