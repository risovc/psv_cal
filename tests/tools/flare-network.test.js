/**
 * Node tests for tools/flare-network.js (Flare header network backpressure).
 * Run: node tests/tools/flare-network.test.js
 */
const tool = require('../../tools/flare-network.js');
const E = require('../../engine.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-30, Math.abs(b));

// ---------------------------------------------------------------------------------------------
// 1. Isothermal equation vs Crane TP-410 Eq. 1-6 in USC units with independent constants.
//    w² = [144·g·A² / (V̄₁·(fL/D + 2·ln(P₁'/P₂')))]·[(P₁'² − P₂'²)/P₁']   (w lb/s, A ft², V̄₁ ft³/lb, P' psia)
//    R = 1545.35 ft·lbf/(lbmol·°R), g = 32.174 ft/s². ΣK is added to fL/D (resistance coefficient K).
// ---------------------------------------------------------------------------------------------
{
  const wKgH = 60000, idMm = 381.0, L = 300, sumK = 3, M = 28, Tc = 60, z = 0.95, k = 1.3;
  const pf = tool.pipeFlow({ wKgH, idMm, lengthM: L, sumK, M, T_K: Tc + 273.15, z, k, P2: 1.6e5, roughnessMm: 0.0457, viscCp: 0.011 });
  const P1psia = pf.P1 / 6894.757, P2psia = pf.Pout / 6894.757;
  const Dft = idMm / 304.8, Aft2 = Math.PI * Dft * Dft / 4;
  const TR = (Tc + 273.15) * 1.8;
  const V1 = z * 1545.35 * TR / (M * P1psia * 144);              // ft³/lb at inlet
  const Kres = pf.f * (L * 3.2808399) / Dft + sumK;
  const w = Math.sqrt(144 * 32.174 * Aft2 * Aft2 / (V1 * (Kres + 2 * Math.log(P1psia / P2psia))) * (P1psia * P1psia - P2psia * P2psia) / P1psia);
  const wLbS = wKgH * 2.20462262 / 3600;
  check('Isothermal P1 vs Crane TP-410 Eq. 1-6 (USC form, independent constants) — back-calculated w within 0.1 %', rel(w, wLbS) < 1e-3,
    `w_Crane = ${w.toFixed(3)} lb/s vs ${wLbS.toFixed(3)} lb/s; P1 = ${P1psia.toFixed(3)} psia`);
}

// ---------------------------------------------------------------------------------------------
// 2. Closed form vs numerical integration (RK4) of the differential momentum balance
//    (P/c² − G²/P)·dP = −(f·G²/2D)·dx  (isothermal, ideal gas with Z) — independent of the closed form.
// ---------------------------------------------------------------------------------------------
{
  const D = 0.2027, L = 250, f = 0.0145, M = 20, T = 330, z = 0.97, W = 40000 / 3600;
  const A = Math.PI * D * D / 4, G = W / A, c2 = z * 8314.462618 * T / M;
  const P2 = 1.4e5;
  const dPdx = P => -(f * G * G / (2 * D)) / (P / c2 - G * G / P);
  let P = P2; const N = 20000, h = L / N;
  for (let i = 0; i < N; i++) { // integrate from outlet (x=L) back to inlet: dP/d(−x) = −dPdx
    const g = p => -dPdx(p);
    const k1 = g(P), k2 = g(P + h / 2 * k1), k3 = g(P + h / 2 * k2), k4 = g(P + h * k3);
    P += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
  }
  const closed = tool.isothermalP1(P2, G, c2, f * L / D).P1;
  check('Isothermal closed form vs RK4 integration of dP/dx momentum ODE within 0.01 %', rel(closed, P) < 1e-4,
    `closed ${(closed / 1e5).toFixed(5)} bara vs RK4 ${(P / 1e5).toFixed(5)} bara`);
}

// ---------------------------------------------------------------------------------------------
// 3. Choked flow: isothermal limiting exit Mach = 1/√k and P* = G·√(ZRT/M); upstream insensitive to downstream.
// ---------------------------------------------------------------------------------------------
{
  const base = { wKgH: 150000, idMm: 154.08, lengthM: 30, sumK: 2, M: 20, T_K: 350, z: 1, k: 1.3, roughnessMm: 0.0457, viscCp: 0.011 };
  const a = tool.pipeFlow({ ...base, P2: 1.0e5 });
  const b = tool.pipeFlow({ ...base, P2: 0.6e5 });
  check('Isothermal choke: exit Mach = 1/√k when downstream pressure < P*', a.choked && Math.abs(a.Ma2 - 1 / Math.sqrt(1.3)) < 1e-9,
    `Ma2 = ${a.Ma2.toFixed(6)}, 1/√k = ${(1 / Math.sqrt(1.3)).toFixed(6)}, P* = ${(a.Pcrit / 1e5).toFixed(4)} bara`);
  check('Choked: P* = G·√(ZRT/M) and upstream P1 independent of downstream pressure', Math.abs(a.Pout - a.G * Math.sqrt(a.c2)) < 1e-6 && rel(a.P1, b.P1) < 1e-12,
    `P1 = ${(a.P1 / 1e5).toFixed(4)} bara for P2 = 1.0 and 0.6 bara`);
  const c = tool.pipeFlow({ ...base, wKgH: 5000, P2: 1.0e5 });
  check('Sub-critical case is not flagged choked (Ma < 1/√k)', !c.choked && c.Ma2 < 1 / Math.sqrt(1.3), `Ma2 = ${c.Ma2.toFixed(3)}`);
}

// ---------------------------------------------------------------------------------------------
// 4. Low-ΔP limit → incompressible Darcy-Weisbach ΔP = K·ρ·v²/2 (Darcy-Weisbach with resistance coefficient K, Crane TP-410), within 0.5 %.
// ---------------------------------------------------------------------------------------------
{
  const pf = tool.pipeFlow({ wKgH: 3000, idMm: 304.84, lengthM: 50, sumK: 1, M: 28, T_K: 300, z: 1, k: 1.4, P2: 5e5, roughnessMm: 0.0457, viscCp: 0.018 });
  const rhoMean = ((pf.P1 + pf.Pout) / 2) / pf.c2, v = pf.G / rhoMean;
  const dpDarcy = pf.Kt * rhoMean * v * v / 2;
  check('Low-ΔP limit reduces to Darcy-Weisbach ΔP = K·ρv²/2 within 0.5 %', rel(pf.P1 - pf.Pout, dpDarcy) < 5e-3,
    `ΔP_iso = ${(pf.P1 - pf.Pout).toFixed(2)} Pa vs Darcy ${dpDarcy.toFixed(2)} Pa`);
}

// ---------------------------------------------------------------------------------------------
// 5. Friction factor: Colebrook vs engine Churchill (independent correlation) within 2 %; pipe ID per ASME B36.10M.
// ---------------------------------------------------------------------------------------------
{
  const fC = tool.darcyFriction(1e6, 0.0457 / 154.08);
  // Churchill (1977) recomputed independently here
  const Re = 1e6, e = 0.0457 / 154.08;
  const A = Math.pow(2.457 * Math.log(1 / (Math.pow(7 / Re, 0.9) + 0.27 * e)), 16), B = Math.pow(37530 / Re, 16);
  const fCh = 8 * Math.pow(Math.pow(8 / Re, 12) + 1 / Math.pow(A + B, 1.5), 1 / 12);
  check('Colebrook-White f vs Churchill (1977) within 2 % at Re = 1e6', rel(fC, fCh) < 0.02, `f_Colebrook = ${fC.toFixed(5)}, f_Churchill = ${fCh.toFixed(5)}`);
  check('Pipe ID 6" STD = 154.08 mm and 24" STD = 590.54 mm (ASME B36.10M)', Math.abs(tool.pipeIdMm('6"') - 154.08) < 0.01 && Math.abs(tool.pipeIdMm('24"') - 590.54) < 0.01);
}

// ---------------------------------------------------------------------------------------------
// 6. Single tailpipe vs PSVEngine.calcLineHydraulicsApi520Part2 outlet built-up backpressure (mean-density
//    incompressible approach, Churchill f) — moderate ΔP so both methods should agree within 3 %.
// ---------------------------------------------------------------------------------------------
{
  const W = 8000, M = 30, k = 1.25, z = 0.93, Tc = 80, set = 15, patm = 1.01325;
  const sup = 0.5; // KO+seal+tip → superimposed at tailpipe exit
  const state = {
    scenario: 'all', patmBara: patm, dpKoBar: 0.2, dpSealBar: 0.0, dpTipBar: 0.3, roughnessMm: 0.0457, viscCp: 0.012,
    sources: [{ tag: 'PSV-T', flowKgHr: W, mw: M, tempC: Tc, k, z, setBarg: set, valveType: 'conventional', tailNps: '6"', tailLenM: 40, tailK: 2.5, header: '' }],
    segments: [{ id: 'S1', name: 'dummy', nps: '24"', lengthM: 1, sumK: 0, downstream: '' }]
  };
  const r = tool.calc(state);
  const mine = r.sources[0].PbBarg - sup;
  const sizing = { ratedCapacityKgHr: W, W_kgHr: W, fluidPhase: 'gas', T1_K: Tc + 273.15, P1_bara: set * 1.1 + patm, P1_barg: set * 1.1, P_setBarg: set, overpressurePct: 10 };
  const hyd = E.calcLineHydraulicsApi520Part2(sizing, { outletNps: '6"', outletSch: 'Sch 40 (Std)', outletLengthM: 40, outletFittingsK: 2.5, superimposedBackBarg: sup,
    valveType: 'conventional', mw: M, k, z, viscCp: 0.012, roughnessMm: 0.0457 });
  const eng = hyd.outlet.builtUpBackBarg;
  // The engine's mean-density method ΔP = K·G²/(2ρ_mean) with ρ_mean = (P1+P2)/(2c²) is algebraically
  // P1² − P2² = G²c²·K, i.e. the isothermal equation WITHOUT the 2·ln(P1/P2) acceleration term.
  const f = r.sources[0].flow;
  const noAcc = (Math.sqrt(f.Pout * f.Pout + f.G * f.G * f.c2 * f.Kt) - f.Pout) / 1e5;
  check('Single tailpipe: PSVEngine.calcLineHydraulicsApi520Part2 ΔP = isothermal eq. without acceleration term within 1.5 %', rel(noAcc, eng) < 0.015,
    `isothermal(no 2ln term) ${noAcc.toFixed(4)} bar vs engine ${eng.toFixed(4)} bar (Colebrook vs Churchill f)`);
  const accShare = 2 * Math.log(f.P1 / f.Pout) / f.Kt;
  check('Single tailpipe: full isothermal built-up vs engine within a few % and higher by ≈ the acceleration-term share',
    mine > eng && rel(mine, eng) < 0.06 && Math.abs((mine - noAcc) / noAcc - accShare) < 0.02,
    `isothermal ${mine.toFixed(4)} bar vs engine ${eng.toFixed(4)} bar (+${(100 * (mine - eng) / eng).toFixed(2)} %; 2ln(P1/P2)/K = ${(100 * accShare).toFixed(2)} %)`);
}

// ---------------------------------------------------------------------------------------------
// 7. Junction mixing: molar MW, enthalpy-balance T (equal c_p → mass-weighted average), mass conservation.
// ---------------------------------------------------------------------------------------------
{
  const m = tool.mixStreams([{ w: 3000, M: 16, T_K: 300, k: 1.3, z: 1 }, { w: 1000, M: 44, T_K: 400, k: 1.3, z: 0.9 }]);
  const Mhand = 4000 / (3000 / 16 + 1000 / 44);
  // c_p ∝ 1/M for equal k: T = Σ w·T/M / Σ w/M (hand calc)
  const Thand = (3000 * 300 / 16 + 1000 * 400 / 44) / (3000 / 16 + 1000 / 44);
  check('Mixing: M_mix = Σṁ/Σ(ṁ/M) and enthalpy-balance T_mix (hand calc)', rel(m.M, Mhand) < 1e-12 && rel(m.T_K, Thand) < 1e-12 && m.w === 4000,
    `M_mix = ${m.M.toFixed(3)} (hand ${Mhand.toFixed(3)}), T_mix = ${m.T_K.toFixed(2)} K (hand ${Thand.toFixed(2)} K)`);
  const e = tool.mixStreams([{ w: 2000, M: 28, T_K: 320, k: 1.4, z: 1 }, { w: 6000, M: 28, T_K: 360, k: 1.4, z: 1 }]);
  check('Mixing: identical gases → mass-weighted T and unchanged M, k', Math.abs(e.T_K - (2000 * 320 + 6000 * 360) / 8000) < 1e-9 && Math.abs(e.M - 28) < 1e-12 && Math.abs(e.k - 1.4) < 1e-12,
    `T_mix = ${e.T_K.toFixed(3)} K`);
}

// ---------------------------------------------------------------------------------------------
// 8. Network: mass conservation, monotonic pressure rise upstream along governing path, scenario logic.
// ---------------------------------------------------------------------------------------------
{
  const p = tool.presets[0].state;
  const r = tool.calc(p);
  const main = r.segments.find(g => !g.down);
  const sumW = p.sources.reduce((a, s) => a + s.flowKgHr, 0);
  check('Network mass balance: main header flow = Σ PSV relief rates', Math.abs(main.flow.W * 3600 - sumW) < 1e-6, `${(main.flow.W * 3600).toFixed(1)} kg/h`);
  const prof = r.profile.map(q => q.barg);
  const mono = prof.every((v, i) => i === 0 || v <= prof[i - 1] + 1e-12);
  check('Pressure decreases monotonically from governing PSV outlet to stack base', mono && prof.length > 5 && Math.abs(prof[prof.length - 1] - (r.PbaseBara - r.PatmBara)) < 1e-12,
    `${prof[0].toFixed(3)} → ${prof[prof.length - 1].toFixed(3)} barg`);
  const junctionOk = r.sources.every(s => !s.header || Math.abs(s.flow.P2 - r.segments.find(g => g.id === s.header).flow.P1) < 1e-9);
  check('Tailpipe exit pressure equals header inlet pressure at each junction', junctionOk);
  const single = tool.calc({ ...p, scenario: 0 });
  const s0All = r.sources[0].PbBarg, s0One = single.sources[0].PbBarg;
  check('Single-source scenario: only that PSV relieves and its backpressure is lower than simultaneous case',
    single.totals.nRelieving === 1 && Math.abs(single.totals.wKgHr - p.sources[0].flowKgHr) < 1e-9 && s0One < s0All && single.sources[1].status === 'idle',
    `${s0One.toFixed(3)} vs ${s0All.toFixed(3)} barg`);
}

// ---------------------------------------------------------------------------------------------
// 9. Robustness: degenerate inputs never yield NaN/Infinity; summaryRows shape.
// ---------------------------------------------------------------------------------------------
{
  const bad = tool.calc({ sources: [{ flowKgHr: -5, mw: 'x', k: 0.5, setBarg: 0 }], segments: [{ id: 'A', downstream: 'A' }, { id: 'B', downstream: 'C' }] });
  const nonFinite = [];
  const walk = (o, p) => { if (typeof o === "number") { if (!Number.isFinite(o)) nonFinite.push(p); } else if (o && typeof o === "object") Object.keys(o).forEach(k => walk(o[k], p + "." + k)); };
  walk(bad, "bad");
  const loop = tool.calc({ sources: [{ header: 'A' }], segments: [{ id: 'A', downstream: 'B' }, { id: 'B', downstream: 'A' }] });
  check('Degenerate/looped inputs: no NaN/Infinity, loop broken to a terminating tree', nonFinite.length === 0 && Number.isFinite(loop.sources[0].PbBarg), nonFinite.slice(0, 5).join(", "));
  const rows = tool.summaryRows();
  check('summaryRows() ≥ 4 rows of 3 strings without NaN/undefined', rows.length >= 4 && rows.every(x => x.length === 3 && x.every(c => typeof c === 'string' && !/NaN|undefined|Infinity/.test(c))), `${rows.length} rows`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
