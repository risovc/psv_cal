/**
 * Node tests for tools/fluid-props.js (Peng-Robinson EOS fluid properties).
 * Run: node tests/tools/fluid-props.test.js
 */
const tool = require('../../tools/fluid-props.js');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const run = (tK, pBar, comps, extra) => tool.calc(Object.assign({ temperatureC: tK - 273.15, pressureBara: pBar, comps }, extra || {}));

// 1. Pure methane Z vs reference data (Setzmann & Wagner 1991 via NIST WebBook; ISO 6976 at reference conditions;
//    virial EOS with B(300 K) = −42.8 cm³/mol, C = 2620 cm⁶/mol² (Dymond & Smith compilation) at moderate density).
[
  { T: 288.15, P: 1.01325, Zref: 0.9980, src: 'ISO 6976:2016 Z(CH4, 15 °C, 1 atm)' },
  { T: 300, P: 20, Zref: 0.9664, src: 'virial EOS B,C (Dymond-Smith)' },
  { T: 300, P: 50, Zref: 0.9191, src: 'virial EOS B,C (Dymond-Smith)' },
  { T: 300, P: 100, Zref: 0.8556, src: 'NIST WebBook / Setzmann-Wagner ρ = 4.686 mol/dm³' }
].forEach(c => {
  const r = run(c.T, c.P, { C1: 1 });
  const z = r.vap ? r.vap.Z : NaN;
  check(`Methane Z at ${c.T} K / ${c.P} bar within 1.5 % of ${c.src}`, r.phase === 'vapour' && rel(z, c.Zref) < 0.015,
    `PR-Péneloux Z = ${z.toFixed(4)} (raw PR ${r.vap.zRaw.toFixed(4)}) vs ${c.Zref} → ${(100 * (z - c.Zref) / c.Zref).toFixed(2)} %`);
});

// 2. Propane vapour pressure at 300 K vs NIST WebBook (Lemmon et al. EOS) 9.974 bar.
{
  const ps = tool.psatPure('C3', 300);
  check('Propane P_sat(300 K) within 3 % of NIST 9.974 bar', rel(ps, 9.974) < 0.03, `PR P_sat = ${ps.toFixed(3)} bar (${(100 * (ps - 9.974) / 9.974).toFixed(2)} %)`);
  // single-phase labelling around saturation
  const above = run(300, ps * 1.05, { C3: 1 }), below = run(300, ps * 0.95, { C3: 1 });
  check('Pure propane is liquid 5 % above P_sat and vapour 5 % below', above.phase === 'liquid' && below.phase === 'vapour', `${above.phase} / ${below.phase}`);
}

// 3. Binary C1/nC5 flash: mass balance closure and equal fugacities (φ_i^L x_i = φ_i^V y_i ⇔ y_i/x_i = K_i).
{
  const r = run(311, 50, { C1: 0.6, nC5: 0.4 });
  const ok2 = r.phase === 'two-phase';
  const mb = ok2 ? Math.max(...r.z.map((z, i) => Math.abs(z - (r.beta * r.vap.x[i] + (1 - r.beta) * r.liq.x[i])))) : 1;
  const sum = ok2 ? Math.abs(r.vap.x.reduce((s, v) => s + v, 0) - 1) + Math.abs(r.liq.x.reduce((s, v) => s + v, 0) - 1) : 1;
  check('Binary C1/nC5 (311 K, 50 bar) flash: two-phase, component mass balance |z − βy − (1−β)x| < 1e-9', ok2 && mb < 1e-9 && sum < 1e-9,
    ok2 ? `β = ${r.beta.toFixed(4)}, max residual ${mb.toExponential(2)}, y_C1 = ${r.vap.x[0].toFixed(4)}, x_C1 = ${r.liq.x[0].toFixed(4)}` : r.phase);
  // Independent lever-rule check on a ternary C1/C3/nC10 flash: β_i = (z_i − x_i)/(y_i − x_i) identical for every i.
  const t3 = run(300, 30, { C1: 0.5, C3: 0.2, nC10: 0.3 });
  const levers = t3.phase === 'two-phase' ? t3.z.map((z, i) => (z - t3.liq.x[i]) / (t3.vap.x[i] - t3.liq.x[i])) : [];
  check('Ternary C1/C3/nC10 (300 K, 30 bar) lever rule: per-component β_i agree with RR β within 1e-9', levers.length === 3 && levers.every(b => Math.abs(b - t3.beta) < 1e-9),
    levers.length ? `β = ${t3.beta.toFixed(5)}, β_i = ${levers.map(b => b.toFixed(5)).join(', ')}` : t3.phase);
  check('Binary flash converged with equal fugacities (Σ(Δln K)² < 1e-12)', r.flash.converged && r.flash.residual < 1e-12, `${r.flash.iterations} iterations, residual ${r.flash.residual.toExponential(2)}`);
}

// 4. Methane k at low pressure ≈ ideal-gas value (1.31 at 288 K; Cp° = 35.0 J/mol·K, GPSA Fig. 13-6 k = 1.31).
{
  const r = run(288.15, 1.01325, { C1: 1 });
  check('Methane ideal k at 288 K = 1.31 ± 0.01 (GPSA Fig. 13-6)', Math.abs(r.vap.kIdeal - 1.31) < 0.01, `k° = ${r.vap.kIdeal.toFixed(4)}`);
  check('Methane real Cp/Cv at 1 atm within 0.5 % of ideal k', rel(r.vap.kReal, r.vap.kIdeal) < 0.005, `k_real = ${r.vap.kReal.toFixed(4)}`);
}

// 5. Independent formulation: Cp from finite difference of the PR residual enthalpy H^R(T) at constant P
//    (Cp = Cp° + ∂H^R/∂T|P) vs the analytic Cv^R + (Cp − Cv) route used in the tool.
{
  const T = 300, P = 100, dT = 0.01;
  const h = (t) => run(t, P, { C1: 1 }).vap.hRes;
  const r = run(T, P, { C1: 1 });
  const cpFD = r.vap.cpIg + (h(T + dT) - h(T - dT)) / (2 * dT);
  check('Real Cp (methane 300 K / 100 bar): analytic vs ∂H^R/∂T finite difference within 0.1 %', rel(r.vap.cp, cpFD) < 1e-3, `analytic ${r.vap.cp.toFixed(3)} vs FD ${cpFD.toFixed(3)} J/mol·K`);
}

// 6. Independent USC formulation of PR for pure methane with GPSA Fig. 23-2 constants (Tc = 343.01 °R,
//    Pc = 667.0 psia, ω = 0.0115, R = 10.7316 psia·ft³/(lbmol·°R)), cubic solved by Newton from Z = 1.
{
  const TR = 540, Ppsia = 1000;            // 80.33 °F, 1000 psia
  const Tc = 343.01, Pc = 667.0, w = 0.0115, Ru = 10.7316;
  const kap = 0.37464 + 1.54226 * w - 0.26992 * w * w;
  const alpha = (1 + kap * (1 - Math.sqrt(TR / Tc))) ** 2;
  const a = 0.45724 * Ru * Ru * Tc * Tc / Pc * alpha, b = 0.07780 * Ru * Tc / Pc;
  const A = a * Ppsia / (Ru * TR) ** 2, B = b * Ppsia / (Ru * TR);
  let Z = 1;
  for (let i = 0; i < 50; i++) { const fz = Z ** 3 - (1 - B) * Z ** 2 + (A - 3 * B * B - 2 * B) * Z - (A * B - B * B - B ** 3); const d = 3 * Z * Z - 2 * (1 - B) * Z + (A - 3 * B * B - 2 * B); Z -= fz / d; }
  const r = run(TR / 1.8, Ppsia / 14.5037738, { C1: 1 });
  check('PR methane Z (540 °R, 1000 psia) vs independent USC PR with GPSA constants within 0.3 %', rel(r.vap.zRaw, Z) < 0.003, `tool raw Z_PR ${r.vap.zRaw.toFixed(5)} vs USC ${Z.toFixed(5)}`);
}

// 7. Rachford-Rice root sanity: z = [0.5, 0.5], K = [2, 0.5] → analytic β = 0.5; single-phase detection.
{
  const rr = tool.rachfordRice([0.5, 0.5], [2, 0.5]);
  check('Rachford-Rice analytic root β = 0.5 for z = [0.5,0.5], K = [2,0.5]', Math.abs(rr.beta - 0.5) < 1e-10, `β = ${rr.beta}`);
  const rr2 = tool.rachfordRice([0.3, 0.7], [3, 1.5]);
  check('Rachford-Rice: all K > 1 → no root, superheated vapour (β → +∞)', rr2.bracketed === false && rr2.beta === Infinity, String(rr2.beta));
  const rr3 = tool.rachfordRice([0.2, 0.3, 0.5], [4.0, 1.2, 0.1]);
  const fRes = [0.2, 0.3, 0.5].reduce((s, z, i) => s + z * ([4.0, 1.2, 0.1][i] - 1) / (1 + rr3.beta * ([4.0, 1.2, 0.1][i] - 1)), 0);
  check('Rachford-Rice 3-component residual |f(β)| < 1e-10 with β in (0,1)', Math.abs(fRes) < 1e-10 && rr3.beta > 0 && rr3.beta < 1, `β = ${rr3.beta.toFixed(6)}`);
}

// 8. Normalisation.
{
  const n = tool.normalize({ C1: 80, C2: 15, C3: 5, N2: -1 });
  check('normalize(): fractions sum to 1, negatives clamped to 0', Math.abs(n.comps.C1 + n.comps.C2 + n.comps.C3 + n.comps.N2 - 1) < 1e-12 && n.comps.N2 === 0 && Math.abs(n.comps.C1 - 0.8) < 1e-12 && n.sum === 100);
  const a = run(300, 30, { C1: 0.9, C2: 0.1 }), b = run(300, 30, { C1: 9, C2: 1 });
  check('calc() is invariant to composition scaling (auto-normalised)', Math.abs(a.vap.Z - b.vap.Z) < 1e-12 && b.warnings.length > 0);
}

// 9. Liquid density with Péneloux translation: n-decane at 298.15 K, 1 atm vs 726 kg/m³ (CRC / NIST), within 3 %.
{
  const r = run(298.15, 1.01325, { nC10: 1 });
  check('n-Decane liquid density 298 K within 3 % of 726 kg/m³ (Péneloux-translated PR)', r.phase === 'liquid' && rel(r.liq.rho, 726) < 0.03, `ρ = ${r.liq.rho.toFixed(1)} (raw PR ${r.liq.rhoRaw.toFixed(1)}) kg/m³`);
}

// 10. Presets & summaryRows produce finite numbers (no NaN/undefined/Infinity strings).
{
  let bad = [];
  tool.presets.forEach(p => { const r = tool.calc(p.state); if (!r.ok || !r.flash.converged) bad.push(p.id); });
  tool.setState(tool.presets[0].state);
  const rows = tool.summaryRows();
  const txt = JSON.stringify(rows);
  check('All presets converge; summaryRows() ≥ 4 clean rows', bad.length === 0 && rows.length >= 4 && !/NaN|undefined|Infinity/.test(txt), `${rows.length} rows${bad.length ? ', bad: ' + bad.join(',') : ''}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
