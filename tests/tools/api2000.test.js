/**
 * Unit tests for tools/api2000.js (API Std 2000 7th Ed. / ISO 28300 tank venting).
 * Run: node tests/tools/api2000.test.js
 */
const tool = require('../../tools/api2000.js');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
// Tank with exactly V_tk = 1000 m³: D = 10 m, H = 1000/(π·25)
const D10 = { diameterM: 10, heightM: 1000 / (Math.PI * 25) };

// 1-2. Thermal breathing equations (API 2000 7th Ed. §3.3.2.3.2/3) — hand calculation at V_tk = 1000 m³
{
  const r = tool.calc(Object.assign({}, D10, { latBand: 'lt42', vpClass: 'hexane', storageTempC: 20, insulThkMm: 0 }));
  const vot = 0.32 * Math.pow(1000, 0.9), vit = 4 * Math.pow(1000, 0.7);
  check('API 2000 §3.3.2.3.2 V_OT = 0.32·1000^0.9 = 160.4 Nm³/h (latitude < 42°)', rel(r.outTherm, vot) < 1e-9 && Math.abs(r.outTherm - 160.38) < 0.05, r.outTherm.toFixed(2));
  check('API 2000 §3.3.2.3.3 V_IT = 4·1000^0.7 = 503.6 Nm³/h (hexane-like, T < 25 °C, < 42°)', rel(r.inTherm, vit) < 1e-9 && Math.abs(r.inTherm - 503.57) < 0.05, r.inTherm.toFixed(2));
  const r2 = tool.calc(Object.assign({}, D10, { latBand: '42to58', vpClass: 'higher' }));
  const r3 = tool.calc(Object.assign({}, D10, { latBand: 'gt58', vpClass: 'hexane', storageTempC: 30 }));
  check('Y/C table lookup: 42–58° → Y 0.25, C 5 (VP>hexane); >58° hexane T≥25 °C → Y 0.20, C 4', r2.Y === 0.25 && r2.C === 5 && r3.Y === 0.2 && r3.C === 4);
}

// 3. Insulation reduction factor (API 2000 §3.3.2.3): R_in = 1/(1 + h·l/λ), h = 4 W/m²K; partial R_inp
{
  const full = tool.calc(Object.assign({}, D10, { insulThkMm: 100, insulLambda: 0.04, insulFracPct: 100 }));
  const part = tool.calc(Object.assign({}, D10, { insulThkMm: 100, insulLambda: 0.04, insulFracPct: 50 }));
  check('R_in = 1/(1 + 4·0.1/0.04) = 1/11; R_inp(50 %) = 0.5·R_in + 0.5', rel(full.Ri, 1 / 11) < 1e-12 && rel(part.Ri, 0.5 / 11 + 0.5) < 1e-12,
    `${full.Ri.toFixed(4)}, ${part.Ri.toFixed(4)}`);
}

// 4. Liquid movement (API 2000 §3.3.2.2): volatile criterion FP < 37.8 °C or NBP < 149 °C doubles outbreathing
{
  const base = Object.assign({}, D10, { pumpInM3h: 100, pumpOutM3h: 80 });
  const vol = tool.calc(Object.assign({}, base, { flashPointC: 20, nbpC: 200 }));
  const nbp = tool.calc(Object.assign({}, base, { flashPointC: 60, nbpC: 120 }));
  const non = tool.calc(Object.assign({}, base, { flashPointC: 60, nbpC: 200 }));
  check('Pump-in outbreathing: ×2.0 if FP<37.8 °C or NBP<149 °C, else ×1.0; inbreathing = pump-out',
    vol.outPump === 200 && nbp.outPump === 200 && non.outPump === 100 && non.inPump === 80 && non.outTotal === 100 + non.outTherm);
}

// 5. Wetted-area cutoff (API 2000 §3.3.3): vertical tank shell up to 9.14 m (30 ft) above grade
{
  const low = tool.calc({ diameterM: 12, heightM: 6 }), high = tool.calc({ diameterM: 12, heightM: 20 });
  check('Wetted area: H = 6 m → π·D·H; H = 20 m → π·D·9.144 m (30 ft)', rel(low.Awet, Math.PI * 12 * 6) < 1e-12 && rel(high.Awet, Math.PI * 12 * 9.144) < 1e-12,
    `${low.Awet.toFixed(1)} / ${high.Awet.toFixed(1)} m²`);
}

// 6. Table 7 heat-input continuity at range boundaries (SI form)
{
  const h = tool.heatInputSI, e = 1e-9;
  const j1 = rel(h(18.6 - e, 50).Q, h(18.6, 50).Q), j2 = rel(h(93 - e, 50).Q, h(93, 50).Q);
  const j3 = rel(h(260 - e, 50).Q, h(260, 50).Q), j4 = rel(h(260 - e, 5).Q, h(260, 5).Q);
  check('API 2000 Table 7 continuity at 18.6 / 93 / 260 m² (P > 7 kPa and P ≤ 7 kPa) within 0.5 %',
    Math.max(j1, j2, j3, j4) < 0.005, [j1, j2, j3, j4].map(x => (x * 100).toFixed(3) + '%').join(', '));
}

// 7. Table 7 SI vs USC forms agree (A m²→ft², kPa→psig, W→BTU/h)
{
  const pts = [[10, 5], [50, 5], [150, 5], [500, 5], [500, 50]];
  const worst = Math.max(...pts.map(([A, p]) => rel(tool.heatInputSI(A, p).Q * 3.412142, tool.heatInputUSC(A * 10.7639104, p * 0.1450377))));
  check('API 2000 Table 7: SI and USC heat-input equations agree within 1 % across all ranges', worst < 0.01, (worst * 100).toFixed(3) + ' %');
}

// 8. Published API 2000 Table 8 (USC, hexane basis: L = 144 BTU/lb, M = 86.17, T = 60 °F) values
{
  const hex = (Aft2, psig) => tool.emergencyUSC(tool.heatInputUSC(Aft2, psig), 1, 144, 519.67, 86.17);
  const q20 = hex(20, 0.5), q2800 = hex(2800, 0.5);
  check('API 2000 Table 8 (USC): 20 ft² → 21 100 SCFH; ≥2800 ft² (≤1 psig) → 742 000 SCFH', rel(q20, 21100) < 0.005 && rel(q2800, 742000) < 0.005,
    `${q20.toFixed(0)} / ${q2800.toFixed(0)} SCFH`);
  // Table 8 note: q = 1107·F·A^0.82 SCFH for A > 2800 ft² and P > 1 psig
  const qBig = hex(5000, 2);
  check('API 2000 Table 8 note: q = 1107·A^0.82 SCFH (A > 2800 ft², P > 1 psig) for hexane', rel(qBig, 1107 * Math.pow(5000, 0.82)) < 0.005, qBig.toFixed(0));
}

// 9. SI vs USC emergency-venting forms — independent USC constants and first-principles derivation
{
  const r = tool.calc({ diameterM: 15, heightM: 12, nbpC: 80, latentKjKg: 390, mw: 78.1, designPmbarg: 20, fireCredit: 'bare' });
  const qUSC = tool.emergencyUSC(r.heatQ * 3.412142, r.F, 390 * 0.4299226, r.TK * 1.8, 78.1);   // SCFH (60 °F, 14.696 psia)
  const qUSCasNm3 = qUSC * 0.0283168 * (273.15 / 288.706);
  const airRef = Math.sqrt(288.706 / 273.15); // SI form normalised to 0 °C air, USC to 60 °F air
  check('Emergency q: SI (906.6) vs USC (3.091) forms agree after 0 °C/60 °F air-reference correction (≤0.3 %)', rel(r.qEm, qUSCasNm3 * airRef) < 0.003,
    `SI ${r.qEm.toFixed(0)} Nm³/h, USC ${qUSCasNm3.toFixed(0)} Nm³/h ×${airRef.toFixed(4)}`);
  // first principles: W = Q/L; equivalent-air flow through same orifice: q = W/M·22.414·√(M·T/(29·T_ref)), T_ref = 273.15 K
  const W = r.heatQ / 1000 * 3600 / 390;
  const qFP = W / 78.1 * 22.414 * Math.sqrt(78.1 * r.TK / (28.96 * 273.15));
  check('Emergency q: 906.6 constant reproduced from ideal-gas air-equivalence (≤0.2 %)', rel(r.qEm, qFP) < 0.002, `${r.qEm.toFixed(0)} vs ${qFP.toFixed(0)}`);
}

// 10. Frangible roof, environmental factor and insulated-F formula
{
  const fr = tool.calc({ frangibleRoof: true });
  const ins = tool.calc({ insulThkMm: 20, insulLambda: 0.06, insulFracPct: 100, fireCredit: 'insulated', nbpC: 60 });
  const Fexp = 3 * (904 - 60) / 66245;              // U = λ/l = 3 W/m²K
  const Fusc = (3 / 5.678263) * (1660 - 140) / 21000; // USC: U BTU/h·ft²·°F, T_f °F
  check('Frangible roof → emergency q = 0; insulated F = U(904−T_f)/66 245 = USC U(1660−T_f)/21 000',
    fr.qEm === 0 && fr.Wkgh === 0 && rel(ins.F, Fexp) < 1e-9 && rel(ins.F, Fusc) < 0.002, `F = ${ins.F.toFixed(5)} / USC ${Fusc.toFixed(5)}`);
  const imp = tool.calc({ fireCredit: 'impound' }), bare = tool.calc({ fireCredit: 'bare' });
  const thick = tool.calc({ insulThkMm: 100, insulLambda: 0.04, insulFracPct: 100, fireCredit: 'insulated', nbpC: 60 });
  check('Insulated F floored at 0.025 (lowest Table 9 insulation entry) for very low U', thick.F === 0.025, `U = 0.4 W/m²K → F = ${thick.F}`);
  check('Remote impoundment F = 0.5 halves emergency q (Table 9)', imp.F === 0.5 && rel(imp.qEm, 0.5 * bare.qEm) < 1e-12);
}

// 11. Robustness: garbage input stays finite; summaryRows has ≥4 rows with no bad strings
{
  const r = tool.calc({ diameterM: 'abc', heightM: -5, latentKjKg: 0, mw: null, designPmbarg: 1e9, latBand: 'x' });
  const finite = ['V', 'outTotal', 'inTotal', 'Awet', 'heatQ', 'qEm', 'F'].every(k => Number.isFinite(r[k]));
  const rows = tool.summaryRows();
  const txt = JSON.stringify(rows);
  check('Garbage inputs clamp to finite outputs; summaryRows ≥4 rows without NaN/undefined/Infinity',
    finite && rows.length >= 4 && rows.every(x => x.length === 3) && !/NaN|undefined|Infinity|\[object Object\]/.test(txt), rows.length + ' rows');
  const presetsOk = tool.presets.length >= 2 && tool.presets.every(p => Number.isFinite(tool.calc(p.state).qEm));
  check('Presets (≥2) compute finite results', presetsOk, tool.presets.length + ' presets');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
