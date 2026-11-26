/**
 * Tests for tools/control-valve.js — IEC 60534-2-1:2011 (ISA-75.01.01) control valve sizing.
 * Run: node tests/tools/control-valve.test.js
 */
const tool = require('../../tools/control-valve.js');
const H = tool.helpers;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// ---------------------------------------------------------------------------
// IEC 60534-2-1 Annex D, Example 1 — incompressible, non-choked turbulent, no fittings
// water 363 K, ρ1 = 965.4 kg/m³, pv = 70.1 kPa, pc = 22 120 kPa, ν = 3.26e-7 m²/s,
// p1 = 680 kPa, p2 = 220 kPa, Q = 360 m³/h, globe FL = 0.90, Fd = 0.46, d = D = 150 mm.
// Published: FF = 0.944, ΔPmax = 497 kPa (non-choked), C = Kv = 165 m³/h, Rev = 2.97e6.
const ex1 = tool.sizePoint({ fluid: 'liquid', W: 360 * 965.4, P1: 6.8, P2: 2.2, rho: 965.4, pv: 0.701, pc: 221.2,
  mu: 3.26e-7 * 965.4 * 1e3, FL: 0.90, xT: 0.72, Fd: 0.46, d: 150, D1: 150, D2: 150 });
check('Annex D Ex.1 (IEC 60534-2-1): Kv = 165 m³/h within 1 %', rel(ex1.Kv, 165) < 0.01, `Kv = ${ex1.Kv.toFixed(2)}, Cv = ${ex1.C.toFixed(1)}`);
check('Annex D Ex.1: FF = 0.944, ΔPmax = 497 kPa, non-choked', rel(ex1.FF, 0.944) < 0.002 && rel(ex1.dPmax * 100, 497) < 0.005 && !ex1.choked,
  `FF = ${ex1.FF.toFixed(4)}, ΔPmax = ${(ex1.dPmax * 100).toFixed(1)} kPa`);
check('Annex D Ex.1: Rev = 2.97e6 (turbulent, FR = 1)', rel(ex1.Rev, 2.97e6) < 0.02 && ex1.FR === 1, `Rev = ${ex1.Rev.toExponential(3)}`);

// Independent USC formulation (ISA-75.01.01 USC, N1 = 1 for gpm/psia): Cv = Q_gpm·√(SG/ΔP_psi)
{
  const gpm = 360 * 264.172052 / 60, dPpsi = 460 / 6.894757, SG = 965.4 / 999.1;
  const cvUsc = gpm * Math.sqrt(SG / dPpsi);
  check('SI N1 = 0.865 (bar) vs USC N1 = 1.00 (gpm, psi) give the same Cv (< 0.1 %)', rel(ex1.C, cvUsc) < 1e-3, `SI ${ex1.C.toFixed(3)} vs USC ${cvUsc.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// IEC 60534-2-1 Annex D, Example 2 — compressible (CO2), rotary eccentric plug xT = 0.60, FL = 0.85, Fd = 0.42
// p1 = 680 kPa, p2 = 310 kPa, T1 = 433 K, M = 44.01, γ = 1.30, Z = 0.988, Qs = 3800 m³/h (0 °C, 101.325 kPa).
// Published (step before fitting correction): Fγ = 0.929, x = 0.544 < Fγ·xT = 0.557 (non-choked), Y = 0.674, C = 62.7 m³/h.
const rhoStd = 101325 * 44.01 / (8314.462 * 273.15);
const gas2 = { fluid: 'gas', W: 3800 * rhoStd, P1: 6.8, P2: 3.1, T: 433 - 273.15, M: 44.01, k: 1.30, Z: 0.988, mu: 0.15, FL: 0.85, xT: 0.60, Fd: 0.42, d: 50 };
const ex2 = tool.sizePoint(Object.assign({}, gas2, { D1: 50, D2: 50 }));
check('Annex D Ex.2 (IEC 60534-2-1): Fγ = 0.929, x = 0.544, Y = 0.674, non-choked',
  rel(ex2.Fg, 0.929) < 0.001 && rel(ex2.x, 0.544) < 0.002 && rel(ex2.Y, 0.674) < 0.002 && !ex2.choked,
  `Fγ = ${ex2.Fg.toFixed(4)}, x = ${ex2.x.toFixed(4)}, Y = ${ex2.Y.toFixed(4)}`);
check('Annex D Ex.2: Kv = 62.7 m³/h within 1 % (N8 mass-flow form from Qs)', rel(ex2.Kv, 62.7) < 0.01, `Kv = ${ex2.Kv.toFixed(2)}`);

// Independent USC gas formulation: Cv = W/(19.3·p1·Y)·√(T·Z/(x·M)), lb/h, psia, °R (ISA-75.01.01 USC N8 = 19.3)
{
  const W = gas2.W * 2.20462262, p1 = 6.8 * 14.5037738, x = 3.7 / 6.8, Fg = 1.30 / 1.40, Y = 1 - x / (3 * Fg * 0.60), TR = 433 * 1.8;
  const cvUsc = W / (19.3 * p1 * Y) * Math.sqrt(TR * 0.988 / (x * 44.01));
  check('Gas: SI N8 = 94.8 vs independent USC N8 = 19.3 (lb/h, psia, °R) agree < 0.5 %', rel(ex2.C, cvUsc) < 0.005, `SI ${ex2.C.toFixed(3)} vs USC ${cvUsc.toFixed(3)}`);
  // N6 density form: C = W/(N6·Y·√(x·p1·ρ1))
  const cvN6 = gas2.W / (27.3 * ex2.Y * Math.sqrt(ex2.x * 6.8 * ex2.rho1));
  check('Gas: N6 (density) form equals N8 (T, Z, M) form < 0.5 %', rel(ex2.C, cvN6) < 0.005, `N6 ${cvN6.toFixed(3)} vs N8 ${ex2.C.toFixed(3)}`);
}

// Same example WITH the 80 × 50 mm reducers: converged C must satisfy the IEC fitting equations, re-evaluated
// independently on the Kv basis (N2 = 1.60e-3, N5 = 1.80e-3, N9 = 24.6 kPa standard-volume form).
{
  const r = tool.sizePoint(Object.assign({}, gas2, { D1: 80, D2: 80 }));
  const Kv = r.Kv, d = 50, b = 50 / 80;
  const z1 = 0.5 * (1 - b * b) ** 2, z2 = (1 - b * b) ** 2, zB1 = 1 - b ** 4;
  const FP = 1 / Math.sqrt(1 + (z1 + z2) / 1.60e-3 * (Kv / d ** 2) ** 2);
  const xTP = (0.60 / FP ** 2) / (1 + 0.60 * (z1 + zB1) / 1.80e-3 * (Kv / d ** 2) ** 2);
  const x = 370 / 680, Fg = 1.3 / 1.4, xs = Math.min(x, Fg * xTP), Y = 1 - xs / (3 * Fg * xTP);
  const KvCheck = 3800 / (24.6 * FP * 680 * Y) * Math.sqrt(44.01 * 433 * 0.988 / xs);
  check('Annex D Ex.2 data with 80×50 reducers: converged Kv satisfies independent Kv-basis FP/xTP/N9 equations (< 0.5 %)',
    rel(Kv, KvCheck) < 0.005 && FP < 1 && Kv > ex2.Kv, `Kv = ${Kv.toFixed(2)} vs ${KvCheck.toFixed(2)}, FP = ${FP.toFixed(4)} (tool ${r.FP.toFixed(4)}), xTP = ${xTP.toFixed(4)}`);
}

// ---------------------------------------------------------------------------
// Choked limits
{
  const base = { fluid: 'liquid', W: 100000, P1: 10, rho: 1000, pv: 2, pc: 220.64, mu: 1, FL: 0.9, xT: 0.72, Fd: 0.46, d: 100, D1: 100, D2: 100 };
  const FF = H.calcFF(2, 220.64), dPmax = 0.81 * (10 - FF * 2);
  const a = tool.sizePoint(Object.assign({}, base, { P2: 10 - dPmax * 1.2 }));
  const b = tool.sizePoint(Object.assign({}, base, { P2: 10 - dPmax * 1.6 }));
  const cExpected = (100000 / 1000) / (0.865 * 0.9) * Math.sqrt((1000 / 999.1) / (10 - FF * 2));
  check('Liquid choked: ΔPmax = FL²(P1 − FF·pv); beyond it C = Q/(N1·FL)·√(G/(P1 − FF·pv)) and independent of P2',
    a.choked && b.choked && rel(a.dPmax, dPmax) < 1e-9 && rel(a.C, cExpected) < 1e-9 && rel(b.C, a.C) < 1e-12, `ΔPmax = ${dPmax.toFixed(3)} bar, C = ${a.C.toFixed(3)}`);
  const fl = tool.sizePoint(Object.assign({}, base, { P2: 1.5 }));
  check('Liquid flashing detected when P2 ≤ pv (and treated as choked)', fl.flashing && fl.choked, `P2 = 1.5 < pv = 2 bara`);
}
{
  const g = { fluid: 'gas', W: 5000, P1: 20, T: 40, M: 20, k: 1.4, Z: 1, mu: 0.012, FL: 0.9, xT: 0.7, Fd: 0.46, d: 80, D1: 80, D2: 80 };
  const choke = tool.sizePoint(Object.assign({}, g, { P2: 20 * (1 - 0.7) }));
  const deep = tool.sizePoint(Object.assign({}, g, { P2: 2 }));
  check('Gas Y bounds: Y(0) = 1, Y = 2/3 at x = Fγ·xT, clamps to 2/3 beyond; choked C constant',
    H.calcY(0, 1, 0.7) === 1 && Math.abs(choke.Y - 2 / 3) < 1e-9 && Math.abs(deep.Y - 2 / 3) < 1e-12 && choke.choked && deep.choked && rel(deep.C, choke.C) < 1e-9,
    `Y_choke = ${choke.Y.toFixed(6)}, C = ${choke.C.toFixed(3)} / ${deep.C.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// Characteristics, FP, FR, constants
check('Equal-% (R = 50): h(C_r) = 100 %, h(C_r/50) = 0 %, h(C_r/√50) = 50 %; linear h = C/C_r',
  Math.abs(H.opening(200, 200, 'eqp') - 1) < 1e-12 && Math.abs(H.opening(4, 200, 'eqp')) < 1e-12 && Math.abs(H.opening(200 / Math.sqrt(50), 200, 'eqp') - 0.5) < 1e-12
  && Math.abs(H.opening(50, 200, 'lin') - 0.25) < 1e-12 && Math.abs(H.cvAtTravel(0.7, 200, 'eqp') - 200 * Math.pow(50, -0.3)) < 1e-9);
{
  const zLine = H.zetas(100, 100, 100), zRed = H.zetas(100, 150, 150);
  const FP = H.calcFP(150, 100, zRed), FLP = H.calcFLP(150, 100, zRed, 0.9);
  check('FP = 1 for line-size valve; FP < 1 and FLP < FL with 150×100 reducers', H.calcFP(150, 100, zLine) === 1 && FP < 1 && FLP < 0.9,
    `Σζ = ${zRed.sum.toFixed(4)}, FP = ${FP.toFixed(4)}, FLP = ${FLP.toFixed(4)}`);
}
{
  const visc = tool.sizePoint({ fluid: 'liquid', W: 5000, P1: 5, P2: 4.0, rho: 900, pv: 0.01, pc: 20, mu: 300, FL: 0.9, xT: 0.72, Fd: 0.46, d: 25, D1: 25, D2: 25 });
  check('Viscous liquid: Rev < 10⁴ → FR < 1 and C = C_turb/FR > C_turb (self-consistent)', visc.Rev < 1e4 && visc.FR < 1 && visc.FR > 0.1 && visc.C > visc.Cturb && rel(visc.C * visc.FR, visc.Cturb) < 1e-6,
    `Rev = ${visc.Rev.toFixed(0)}, FR = ${visc.FR.toFixed(3)}, C = ${visc.C.toFixed(3)} vs C_turb ${visc.Cturb.toFixed(3)}`);
}
{
  const N = tool.constants;
  check('IEC Table 1 Cv-column constants consistent with Kv column (N1 1/0.865, N2 1.60e-3, N6 31.6, N8 110 → ratio ≈ 1.156 / 1.156²)',
    rel(1 / N.N1, 1.156) < 0.001 && rel(N.N2 / 1.60e-3, 1.156 ** 2) < 0.002 && rel(31.6 / N.N6, 1.156) < 0.002 && rel(110 / N.N8, 1.156) < 0.005);
}

// ---------------------------------------------------------------------------
// Whole-tool behaviour
{
  const r = tool.calc(tool.defaultState());
  check('Default case: selected valve keeps max travel ≤ 90 % and normal within 50–80 %', r.sel.maxOk && r.sel.normOk && r.pts[2].open <= 90,
    `${r.sel.sizeIn}" Cv ${r.sel.Crated}: ${r.pts.map(p => p.open.toFixed(1)).join(' / ')} %`);
  let ok = true;
  for (const p of tool.presets) {
    const rows = (tool.setState(p.state), tool.summaryRows());
    const txt = JSON.stringify(rows);
    if (!(rows.length >= 4 && rows.every(x => x.length === 3 && x.every(c => typeof c === 'string')) && !/NaN|undefined|Infinity|\[object Object\]/.test(txt))) ok = false;
  }
  tool.setState(tool.defaultState());
  check(`All ${tool.presets.length} presets: summaryRows() ≥ 4 clean string rows`, ok && tool.presets.length >= 2);
  const s = tool.getState();
  tool.setState(JSON.parse(JSON.stringify(s)));
  check('getState()/setState() round-trip is lossless (canonical SI)', JSON.stringify(tool.getState()) === JSON.stringify(s));
}

// ---------------------------------------------------------------------------
// New Workbench Features: Steam (IF97), Asymmetric D1/D2, Noise (IEC 60534-8-3/-8-4),
// Installed Characteristic & Authority, Reduced Trim & Custom Vendor Overrides
// ---------------------------------------------------------------------------
{
  // 1. IAPWS-IF97 saturation temperature & real steam density accuracy
  const t1 = H.steamSatTempC(1.01325), t10 = H.steamSatTempC(10), t40 = H.steamSatTempC(40);
  check('IAPWS-IF97 Tsat(1.01325, 10, 40 bara) matches steam tables within 0.1 °C',
    Math.abs(t1 - 99.974) < 0.1 && Math.abs(t10 - 179.886) < 0.1 && Math.abs(t40 - 250.358) < 0.1,
    `Tsat = ${t1.toFixed(2)} / ${t10.toFixed(2)} / ${t40.toFixed(2)} °C`);

  const sp10 = H.calcSteamProps(10, 250, false); // IAPWS-IF97 rho = 4.296 kg/m³
  const sp42 = H.calcSteamProps(42, 365, false); // IAPWS-IF97 rho = 15.49 kg/m³
  check('Real steam density (PR EOS) within 1.5 % of IAPWS-IF97 at 10 & 42 bara',
    rel(sp10.rho1, 4.296) < 0.015 && rel(sp42.rho1, 15.49) < 0.015 && !sp10.wetSteam && sp10.superheatC > 65,
    `ρ(10/250)=${sp10.rho1.toFixed(3)}, ρ(42/365)=${sp42.rho1.toFixed(3)} kg/m³`);

  const spWet = H.calcSteamProps(10, 150, false);
  const spSat = H.calcSteamProps(10, 150, true);
  check('Steam wet-inlet warning triggers below Tsat; saturated toggle locks T = Tsat',
    spWet.wetSteam && !spSat.wetSteam && Math.abs(spSat.TuseC - spSat.TsatC) < 1e-6);

  const stStd = tool.calc(Object.assign(tool.defaultState(), {
    fluid: 'steam', valveType: 'globe-eqp', pipeMode: 'asme', d1Nps: '4"', d1Sch: 'Sch 80', d2Nps: '6"', d2Sch: 'Sch 80',
    wMin: 4500, wNorm: 14000, wMax: 18500, p1Min: 43, p1Norm: 42, p1Max: 41, p2Min: 10, p2Norm: 10, p2Max: 10, tempC: 365
  }));
  const stRes = tool.calc(Object.assign(tool.defaultState(), {
    fluid: 'steam', valveType: 'globe-lownoise', pipeMode: 'asme', d1Nps: '4"', d1Sch: 'Sch 80', d2Nps: '6"', d2Sch: 'Sch 80',
    wMin: 4500, wNorm: 14000, wMax: 18500, p1Min: 43, p1Norm: 42, p1Max: 41, p2Min: 10, p2Norm: 10, p2Max: 10, tempC: 365
  }));
  check('Steam HP letdown (41→10 barg): standard globe chokes while high-xT low-noise cage avoids choking',
    stStd.sel.valid && stStd.pts[2].choked && stRes.sel.valid && !stRes.pts[2].choked && stRes.pts[2].C > 20 && stRes.pts[2].steam.superheatC > 100,
    `stdCv=${stStd.pts[2].C.toFixed(1)}(choked), lowNoiseCv=${stRes.pts[2].C.toFixed(1)}(non-choked), M2=${stRes.exit.maxMach.toFixed(3)}`);
}

{
  // 2. Asymmetric piping D1 != D2 (IEC 60534-2-1 §7.4) & ASME B36.10M lookup
  const p4_40 = H.lookupPipe('4"', 'Sch 40');
  const p12_std = H.lookupPipe('12"', 'STD');
  const p12_40 = H.lookupPipe('12"', 'Sch 40');
  check('ASME B36.10M separates 12" STD vs Sch 40 IDs & walls accurately',
    Math.abs(p4_40.idMm - 102.26) < 0.05 && p12_std.idMm > p12_40.idMm && p12_40.wallMm > p12_std.wallMm,
    `4" Sch40=${p4_40.idMm}mm, 12" STD=${p12_std.idMm}mm vs Sch40=${p12_40.idMm}mm`);

  const zSym = H.zetas(50, 100, 100);
  const zExp = H.zetas(50, 100, 150);
  check('Asymmetric expander D2 > D1 yields zB1 != zB2 and larger Σζ than symmetric piping',
    Math.abs(zSym.zB1 - zSym.zB2) < 1e-12 && zExp.zB2 > zExp.zB1 && zExp.z2 > zSym.z2,
    `zExp: z1=${zExp.z1.toFixed(3)}, z2=${zExp.z2.toFixed(3)}, zB1-zB2=${(zExp.zB1 - zExp.zB2).toFixed(3)}`);
}

{
  // 3. Acoustic noise screening: IEC 60534-8-3 (gas/steam) & IEC 60534-8-4 (liquid)
  const gasBase = Object.assign(tool.defaultState(), {
    fluid: 'gas', valveType: 'globe-lin', sizeIn: 2, pipeMode: 'asme', d1Nps: '4"', d1Sch: 'Sch 40', d2Nps: '4"', d2Sch: 'Sch 40',
    wMin: 6000, wNorm: 14000, wMax: 18000, p1Min: 42, p1Norm: 40, p1Max: 39, p2Min: 12, p2Norm: 12, p2Max: 12,
    tempC: 40, mw: 18.6, k: 1.27, z: 0.92
  });
  const rSch40 = tool.calc(gasBase);
  const rSch80 = tool.calc(Object.assign({}, gasBase, { d2Sch: 'Sch 80' }));
  const rLowNoise = tool.calc(Object.assign({}, gasBase, { valveType: 'globe-lownoise', sizeIn: 3 }));
  check('IEC 60534-8-3 aerodynamic noise decreases with heavier pipe schedule (Sch 80 vs Sch 40) and low-noise cage trim',
    rSch80.noise.maxDb < rSch40.noise.maxDb - 2.0 && rLowNoise.noise.maxDb < rSch40.noise.maxDb - 10.0,
    `Sch40=${rSch40.noise.maxDb.toFixed(1)} dBA, Sch80=${rSch80.noise.maxDb.toFixed(1)} dBA, LowNoise=${rLowNoise.noise.maxDb.toFixed(1)} dBA`);

  const liqQuiet = tool.calc(tool.presets.find(p => p.id === 'amine').state);
  const liqCav = tool.calc(tool.presets.find(p => p.id === 'propane').state);
  check('IEC 60534-8-4 hydrodynamic noise escalates strongly under cavitation (propane > amine + 12 dBA)',
    liqQuiet.noise.maxDb < 85 && liqCav.noise.maxDb > 85 && liqCav.noise.maxDb > liqQuiet.noise.maxDb + 12,
    `amine=${liqQuiet.noise.maxDb.toFixed(1)} dBA, propane=${liqCav.noise.maxDb.toFixed(1)} dBA`);
}

{
  // 4. Installed characteristic & valve authority N
  const qInh50 = H.installedFlow(0.5, 'lin', 1.0);
  const qLowN50 = H.installedFlow(0.5, 'lin', 0.2);
  const gEqpLowN = H.installedGain(0.6, 'eqp', 0.25);
  check('Valve authority N=1 matches inherent linear; low N shifts linear upward; eq-% stays near-linear at low N',
    Math.abs(qInh50 - 0.5) < 1e-12 && qLowN50 > 0.75 && gEqpLowN > 0.8 && gEqpLowN < 2.2,
    `lin(0.5, N=0.2)=${qLowN50.toFixed(3)}, eqp gain@60% (N=0.25)=${gEqpLowN.toFixed(2)}`);
}

{
  // 5. Reduced trims, custom vendor data overrides, and legacy pipeIdMm backwards compatibility
  const rFull = tool.calc(Object.assign(tool.defaultState(), { sizeIn: 4, trimFactor: 1.0 }));
  const rRed = tool.calc(Object.assign(tool.defaultState(), { sizeIn: 4, trimFactor: 0.6 }));
  check('60% reduced trim scales Crated by 0.6 and increases required travel %',
    rel(rRed.sel.Crated, rFull.sel.Crated * 0.6) < 1e-9 && rRed.pts[1].open > rFull.pts[1].open,
    `Cr: ${rFull.sel.Crated} -> ${rRed.sel.Crated}, h_norm: ${rFull.pts[1].open.toFixed(1)}% -> ${rRed.pts[1].open.toFixed(1)}%`);

  const rCust = tool.calc(Object.assign(tool.defaultState(), { customVendor: true, customCrated: 215, customFL: 0.84, customXT: 0.61, customFd: 0.35 }));
  check('Custom vendor override replaces Crated, FL, xT, Fd exactly',
    rCust.sel.Crated === 215 && rCust.valve.FL === 0.84 && rCust.valve.xT === 0.61 && rCust.valve.Fd === 0.35 && rCust.valve.isCustom);

  const rLegacy = tool.calc({ pipeIdMm: 150, fluid: 'liquid', wMin: 40000, wNorm: 120000, wMax: 140000, p1Min: 26, p1Norm: 25, p1Max: 24, p2Min: 20, p2Norm: 20, p2Max: 20 });
  check('Legacy saved state with only pipeIdMm (no ASME NPS/Sch keys) remains backwards compatible',
    rLegacy.pipes.mode === 'custom' && rLegacy.pipes.D1 === 150 && rLegacy.pipes.D2 === 150 && rLegacy.sel.valid);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
