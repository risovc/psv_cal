/**
 * Unit Verification Suite — Relief-Scenario Engine Extension (engine-ext.js)
 * Expected values are computed inside this file from first principles (own constants),
 * never by calling the function under test.
 */
'use strict';

const E = require('../engine.js');
const X = require('../engine-ext.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { failed++; console.error(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const hasTrace = (r) => Array.isArray(r.warnings) && Array.isArray(r.trace) && r.trace.length > 0 &&
  r.trace.every((t) => typeof t.title === 'string' && typeof t.symbolic === 'string' && typeof t.substitution === 'string' && typeof t.result === 'string');

// ---------------------------------------------------------------------------
// 1. Checklist
// ---------------------------------------------------------------------------
const allowedKeys = new Set(['fire_liquid', 'fire_gas', 'fire_supercritical', 'blocked_outlet', 'cv_failure', 'gas_blowby', 'thermal_expansion', 'tube_rupture', 'abnormal_heat', 'column_unbalanced']);
const ids = X.API521_CAUSES.map((c) => c.id);
check('API521_CAUSES has ≥ 20 entries with unique ids', ids.length >= 20 && new Set(ids).size === ids.length, `${ids.length} entries`);
check('Every linkedScenarioKey is null or in the allowed set', X.API521_CAUSES.every((c) => c.linkedScenarioKey === null || allowedKeys.has(c.linkedScenarioKey)));
check('Every entry has the required fields and a valid group / defaultStatus',
  X.API521_CAUSES.every((c) => ['utility', 'process', 'mechanical', 'external'].includes(c.group) && c.defaultStatus === 'review' &&
    typeof c.title === 'string' && typeof c.api521Ref === 'string' && typeof c.typicalBasis === 'string' && c.typicalBasis.length > 20));
const summ = X.checklistSummary({ closed_outlet: 'applicable', gas_blowby: 'not_credible', lean_oil_failure: 'not_applicable', bogus_id: 'applicable' });
check('checklistSummary counts applicable / not_applicable / not_credible / review',
  summ.applicable === 1 && summ.not_applicable === 1 && summ.not_credible === 1 && summ.review === ids.length - 3, JSON.stringify(summ));

// ---------------------------------------------------------------------------
// 2. IEC 60534-2-1 gas flow
// ---------------------------------------------------------------------------
// Hand calc: air-like k = 1.4 → Fγ = 1; P1 = 10, P2 = 5 → x = 0.5 < xT 0.72; Y = 1 − 0.5/(3·0.72)
{
  const Y = 1 - 0.5 / (3 * 0.72);
  const Wexp = 94.8 * 100 * 10 * Y * Math.sqrt((0.5 * 29) / (300 * 1));
  const r = X.calcControlValveFlowGas({ cv: 100, P1_bara: 10, P2_bara: 5, tempC: 300 - 273.15, mw: 29, z: 1, k: 1.4, xT: 0.72 });
  check('Gas Cv flow sub-critical: W within 0.5 % of hand calc', rel(r.W_kgHr, Wexp) < 0.005 && !r.choked && Math.abs(r.Y - Y) < 1e-9, `W = ${r.W_kgHr.toFixed(1)} vs ${Wexp.toFixed(1)} kg/h, Y = ${r.Y.toFixed(4)}`);
  check('Gas Cv flow result carries warnings[] and trace[] steps', hasTrace(r) && r.Fgamma === 1 && r.xT === 0.72);
  const rc = X.calcControlValveFlowGas({ cv: 100, P1_bara: 10, P2_bara: 1, tempC: 300 - 273.15, mw: 29, z: 1, k: 1.4, xT: 0.72 });
  const WexpC = 94.8 * 100 * 10 * (2 / 3) * Math.sqrt((0.72 * 29) / 300);
  check('Gas Cv flow choked: x limited to Fγ·xT = 0.72 and Y = 2/3', rc.choked && Math.abs(rc.x - 0.72) < 1e-12 && Math.abs(rc.Y - 2 / 3) < 1e-12 && rel(rc.W_kgHr, WexpC) < 0.005, `W = ${rc.W_kgHr.toFixed(1)} vs ${WexpC.toFixed(1)} kg/h`);
  // k = 1.3 → Fγ = 0.9286; choke at x = 0.9286·0.72 = 0.6686
  const rk = X.calcControlValveFlowGas({ cv: 50, P1_bara: 20, P2_bara: 2, tempC: 50, mw: 20, z: 0.9, k: 1.3, xT: 0.72 });
  check('Gas Cv flow: Fγ = k/1.4 scales the choking limit', Math.abs(rk.xChoked - (1.3 / 1.4) * 0.72) < 1e-12 && rk.choked);
  const rt = X.calcControlValveFlowGas({ cv: 50, P1_bara: 20, P2_bara: 15, tempC: 50, mw: 20, z: 0.9, k: 1.3, valveType: 'ball_segmented' });
  check('Gas Cv flow: typical xT by valve type used when xT not given, with a warning', rt.xT === X.TYPICAL_XT.ball_segmented && rt.warnings.some((w) => /typical/.test(w)));
}

// ---------------------------------------------------------------------------
// 3. IEC 60534-2-1 liquid flow
// ---------------------------------------------------------------------------
{
  // Hand calc via USC: Q_gpm = Cv·√(ΔP_psi/SG); 1 bar = 14.5037738 psi; 1 gpm = 0.2271247 m³/h
  const cv = 40, P1 = 12, P2 = 7, rho = 800;
  const Qgpm = cv * Math.sqrt(((P1 - P2) * 14.5037738) / (rho / 1000));
  const Wexp = Qgpm * 0.2271247 * rho;
  const r = X.calcControlValveFlowLiquid({ cv, P1_bara: P1, P2_bara: P2, rhoLiqKgM3: rho });
  check('Liquid Cv flow matches USC Cv definition within 0.3 %', rel(r.W_kgHr, Wexp) < 0.003 && !r.choked, `W = ${r.W_kgHr.toFixed(1)} vs ${Wexp.toFixed(1)} kg/h`);
  // Choked liquid: Pv = 6 bara, Pc missing → FF = 0.96; ΔP_max = 0.9²·(12 − 0.96·6) = 0.81·6.24 = 5.0544 bar; ΔP = 11 → choked
  const dPmax = 0.81 * (12 - 0.96 * 6);
  const rc = X.calcControlValveFlowLiquid({ cv, P1_bara: 12, P2_bara: 1, rhoLiqKgM3: rho, FL: 0.9, pvBara: 6 });
  const WexpC = cv * Math.sqrt((dPmax * 14.5037738) / (rho / 1000)) * 0.2271247 * rho;
  check('Liquid Cv flow choked: ΔP limited to FL²·(P1 − FF·Pv) with FF = 0.96 when Pc missing', rc.choked && Math.abs(rc.dPMaxBar - dPmax) < 1e-9 && rel(rc.W_kgHr, WexpC) < 0.003, `ΔP_max = ${rc.dPMaxBar.toFixed(4)} bar`);
  const rf = X.calcControlValveFlowLiquid({ cv, P1_bara: 12, P2_bara: 1, rhoLiqKgM3: rho, FL: 0.9, pvBara: 6, pcBara: 24 });
  check('Liquid FF = 0.96 − 0.28·√(Pv/Pc)', Math.abs(rf.FF - (0.96 - 0.28 * Math.sqrt(6 / 24))) < 1e-12, `FF = ${rf.FF.toFixed(4)}`);
}

// ---------------------------------------------------------------------------
// 4. Cv estimation
// ---------------------------------------------------------------------------
{
  const t = X.estimateControlValveCv({ method: 'size_table', valveType: 'globe_single', sizeNps: 3 });
  check('Size-table Cv: Cv = Cd·d² (globe 3 in → 10·9 = 90) and labelled as typical', Math.abs(t.ratedCv - 90) < 1e-9 && t.assumptions.some((a) => /confirm with vendor/.test(a)));
  // Forward gas flow with a known Cv, then invert
  const gasIn = { P1_bara: 30, P2_bara: 22, tempC: 40, mw: 19, z: 0.92, k: 1.28, xT: 0.7 };
  const Wfwd = X.calcControlValveFlowGas({ cv: 37.5, ...gasIn }).W_kgHr;
  const back = X.estimateControlValveCv({ method: 'normal_flow', fluidPhase: 'gas', normalFlowKgHr: Wfwd, normalInletBara: 30, normalOutletBara: 22, tempC: 40, mw: 19, z: 0.92, k: 1.28, xT: 0.7, normalOpeningPct: 100, characteristic: 'linear' });
  check('normal_flow Cv back-calculation inverts the gas forward flow within 0.1 %', rel(back.cvNormal, 37.5) < 0.001 && rel(back.ratedCv, 37.5) < 0.001, `Cv = ${back.cvNormal.toFixed(4)}`);
  const liqIn = { normalFlowKgHr: 50000, normalInletBara: 15, normalOutletBara: 9, rhoLiq: 850 };
  const bl = X.estimateControlValveCv({ method: 'normal_flow', fluidPhase: 'liquid', ...liqIn, normalOpeningPct: 50, characteristic: 'linear' });
  const Wchk = X.calcControlValveFlowLiquid({ cv: bl.cvNormal, P1_bara: 15, P2_bara: 9, rhoLiqKgM3: 850 }).W_kgHr;
  check('normal_flow liquid: Cv_norm reproduces normal flow within 0.1 % and linear scaling doubles at 50 % opening', rel(Wchk, 50000) < 0.001 && Math.abs(bl.ratedCv - 2 * bl.cvNormal) < 1e-9);
  const eq = X.estimateControlValveCv({ method: 'normal_flow', fluidPhase: 'gas', normalFlowKgHr: Wfwd, normalInletBara: 30, normalOutletBara: 22, tempC: 40, mw: 19, z: 0.92, k: 1.28, xT: 0.7, normalOpeningPct: 60, characteristic: 'equal_pct', rangeability: 50 });
  check('Equal-percentage scaling: Cv_rated = Cv_norm·R^(1 − f)', rel(eq.ratedCv, eq.cvNormal * Math.pow(50, 0.4)) < 1e-9, `${eq.ratedCv.toFixed(2)} = ${eq.cvNormal.toFixed(2)}·50^0.4`);
}

// ---------------------------------------------------------------------------
// 5. Gas blow-by
// ---------------------------------------------------------------------------
{
  const p = { levelValveCv: 60, bypassCv: 10, hpPressBarg: 50, lpSetPressureBarg: 10, atmPressureBara: 1.01325, gasTempC: 40, mw: 19, z: 0.9, k: 1.28, xT: 0.72 };
  const r = X.calcGasBlowby(p);
  const ref = X.calcControlValveFlowGas({ cv: 70, P1_bara: 51.01325, P2_bara: 1.1 * 10 + 1.01325, tempC: 40, mw: 19, z: 0.9, k: 1.28, xT: 0.72 });
  check('Gas blow-by: W equals calcControlValveFlowGas at P1 = HP + atm, P2 = 1.1·set + atm, Cv = level + bypass',
    Math.abs(r.gasFlowKgHr - ref.W_kgHr) < 1e-6 && Math.abs(r.P2_bara - 12.01325) < 1e-12 && r.reliefRateKgHr === r.gasFlowKgHr, `W = ${r.gasFlowKgHr.toFixed(1)} kg/h`);
  check('Gas blow-by metadata: scenarioKey/name/overpressure/sizingPhase/trace', r.scenarioKey === 'gas_blowby' && r.allowedOverpressurePct === 10 && r.sizingPhase === 'gas' && /Blow-by/.test(r.scenarioName) && hasTrace(r) && Math.abs(r.reliefRateLbHr - r.reliefRateKgHr * 2.20462262) < 1e-6);
  const rcred = X.calcGasBlowby({ ...p, normalOutflowCreditKgHr: 5000 });
  check('Gas blow-by: normal outflow credit subtracted (max 0)', Math.abs(rcred.reliefRateKgHr - Math.max(0, r.gasFlowKgHr - 5000)) < 1e-9 && rcred.warnings.some((w) => /credit/.test(w)));
  // Time to lose seal: ρ = 800, V = 4 m³, W_out supplied 60 000 kg/h, W_in 20 000 → t = 3200/40000 h = 0.08 h = 4.8 min
  const rs = X.calcGasBlowby({ ...p, hpLiquidInventoryM3: 4, rhoLiqKgM3: 800, hpLiquidInflowKgHr: 20000, hpLiquidOutflowKgHr: 60000 });
  check('Gas blow-by: time-to-lose-seal t = ρ·V/(W_out − W_in) = 4.8 min', rs.liquidSeal && Math.abs(rs.liquidSeal.timeToLoseSealMin - 4.8) < 1e-9, `t = ${rs.liquidSeal && rs.liquidSeal.timeToLoseSealMin.toFixed(3)} min`);
  const rs2 = X.calcGasBlowby({ ...p, hpLiquidInventoryM3: 4, rhoLiqKgM3: 800, hpLiquidInflowKgHr: 20000 });
  const liqRef = X.calcControlValveFlowLiquid({ cv: 70, P1_bara: 51.01325, P2_bara: 11.01325, rhoLiqKgM3: 800 }).W_kgHr;
  check('Gas blow-by: valve liquid capacity used as W_out when not supplied', rs2.liquidSeal && Math.abs(rs2.liquidSeal.outflowUsedKgHr - liqRef) < 1e-6 && Math.abs(rs2.liquidSeal.timeToLoseSealMin - (3200 / (liqRef - 20000)) * 60) < 1e-6);
  const rz = X.calcGasBlowby({ ...p, hpPressBarg: 9 });
  check('Gas blow-by: HP below LP relieving pressure → zero load with warning', rz.reliefRateKgHr === 0 && rz.warnings.length > 0);
}

// ---------------------------------------------------------------------------
// 6. DIERS swell
// ---------------------------------------------------------------------------
{
  const g = 9.80665;
  const base = { orientation: 'vertical', diameterM: 2, lengthM: 6, liquidLevelM: 3, rhoVapKgM3: 5, rhoLiqKgM3: 600, surfaceTensionNm: 0.01, regime: 'churn' };
  const Uinf = 1.53 * Math.pow((0.01 * g * (600 - 5)) / (600 * 600), 0.25);
  const r0 = X.calcSwellEntrainment({ ...base, vaporRateKgHr: 0 });
  check('Swell: ψ → 0 gives ᾱ → 0 and H_swell = H_liq', r0.psi === 0 && r0.alphaBar === 0 && Math.abs(r0.hSwellM - 3) < 1e-12 && !r0.twoPhaseVentingLikely && Math.abs(r0.Uinf - Uinf) < 1e-12);
  const W = 20000; // kg/h
  const A = Math.PI; // πD²/4 with D = 2
  const jg = W / 3600 / (5 * A);
  const psi = jg / Uinf;
  const alphaChurn = psi / (2 + 1.5 * psi);
  const r1 = X.calcSwellEntrainment({ ...base, vaporRateKgHr: W });
  check('Swell churn: j_g, ψ and closed-form ᾱ = ψ/(2 + C₀ψ) satisfy ψ = 2ᾱ/(1 − C₀ᾱ)',
    Math.abs(r1.jg - jg) < 1e-12 && Math.abs(r1.psi - psi) < 1e-9 && Math.abs(r1.alphaBar - alphaChurn) < 1e-9 && Math.abs((2 * r1.alphaBar) / (1 - 1.5 * r1.alphaBar) - psi) < 1e-8 && hasTrace(r1),
    `ψ = ${psi.toFixed(4)}, ᾱ = ${alphaChurn.toFixed(4)}`);
  check('Swell: H_swell > H_liq when vapour flows, and α₀ = 1 − H_liq/H for a vertical vessel', r1.hSwellM > 3 && Math.abs(r1.hSwellM - 3 / (1 - alphaChurn)) < 1e-9 && Math.abs(r1.alpha0 - 0.5) < 1e-12);
  const rb = X.calcSwellEntrainment({ ...base, regime: 'bubbly', vaporRateKgHr: W });
  const a = rb.alphaBar;
  const psiB = (a * (1 - a) * (1 - a)) / ((1 - a * a * a) * (1 - 1.2 * a));
  check('Swell bubbly: bisection root satisfies ψ = ᾱ(1 − ᾱ)²/((1 − ᾱ³)(1 − C₀ᾱ)) to 1e-8', rb.C0 === 1.2 && Math.abs(psiB - psi) < 1e-8 && a < 1 / 1.2, `ᾱ_bubbly = ${a.toFixed(5)}`);
  // Horizontal half-full: chord = D → A = D·L
  const rh = X.calcSwellEntrainment({ orientation: 'horizontal', diameterM: 2, lengthM: 8, liquidLevelM: 1, vaporRateKgHr: 1000, rhoVapKgM3: 5, rhoLiqKgM3: 600, surfaceTensionNm: 0.01 });
  check('Swell horizontal half-full: free-surface area = D·L (chord = D) and α₀ = 0.5', Math.abs(rh.areaM2 - 16) < 1e-9 && Math.abs(rh.alpha0 - 0.5) < 1e-9 && Math.abs(rh.liquidVolumeM3 - (Math.PI / 8) * 4 * 8 / 1) < 1e-9);
  const rq = X.calcSwellEntrainment({ orientation: 'horizontal', diameterM: 2, lengthM: 8, liquidLevelM: 0.5, vaporRateKgHr: 1000, rhoVapKgM3: 5, rhoLiqKgM3: 600 });
  check('Swell horizontal quarter-depth: chord = 2·√(R² − (h − R)²) = √3 m', Math.abs(rq.areaM2 - Math.sqrt(3) * 8) < 1e-9);
  // Flip: W small → vapour only; W very large → two-phase (need ᾱ ≥ α₀ = 0.5 → ψ ≥ 2·0.5/(1 − 0.75) = 4)
  const psiFlip = (2 * 0.5) / (1 - 1.5 * 0.5);
  const Wflip = psiFlip * Uinf * 5 * A * 3600;
  const rlo = X.calcSwellEntrainment({ ...base, vaporRateKgHr: 0.9 * Wflip });
  const rhi = X.calcSwellEntrainment({ ...base, vaporRateKgHr: 1.1 * Wflip });
  check('Swell: twoPhaseVentingLikely flips false → true as vapour rate crosses the ᾱ = α₀ threshold', !rlo.twoPhaseVentingLikely && rhi.twoPhaseVentingLikely && rhi.reachesNozzle && rhi.ventQualityEstimate !== null && rlo.ventQualityEstimate === null, `W_flip ≈ ${Wflip.toFixed(0)} kg/h`);
  const x0 = (0.5 * 5) / (0.5 * 5 + 0.5 * 600);
  check('Swell: ventQualityEstimate = α₀ρ_V/(α₀ρ_V + (1 − α₀)ρ_L) and foamy fluid forces two-phase', Math.abs(rhi.ventQualityEstimate - x0) < 1e-12 && X.calcSwellEntrainment({ ...base, vaporRateKgHr: 1, fluidType: 'foamy' }).twoPhaseVentingLikely);
}

// ---------------------------------------------------------------------------
// 7. Column unbalanced heat
// ---------------------------------------------------------------------------
{
  const lc = X.calcColumnUnbalancedHeat({ upset: 'loss_cooling', reboilerDutyKw: 2000, condenserDutyKw: 1900, topLatentHeatKjKg: 300 });
  check('Column loss of cooling: W = 3600·2000/300 = 24 000 kg/h', Math.abs(lc.reliefRateKgHr - 24000) < 1e-9 && lc.dutiesKw.condenserRelief === 0 && lc.scenarioKey === 'column_unbalanced' && lc.allowedOverpressurePct === 10 && lc.sizingPhase === 'gas' && hasTrace(lc));
  const lr = X.calcColumnUnbalancedHeat({ upset: 'loss_reflux', reboilerDutyKw: 1000, condenserDutyKw: 1200, refluxRateKgHr: 30000, netOverheadKgHr: 10000, topLatentHeatKjKg: 300 });
  check('Column loss of reflux: vapour basis = reflux + net overhead = 40 000 kg/h governs over heat basis 12 000 kg/h', Math.abs(lr.W_vapourKgHr - 40000) < 1e-9 && Math.abs(lr.W_heatKgHr - 12000) < 1e-9 && lr.reliefRateKgHr === 40000 && lr.governingBasis === 'overhead_vapour' && lr.bases.length === 2);
  const pf = X.calcColumnUnbalancedHeat({ upset: 'power_failure', reboilerDutyKw: 3000, condenserDutyKw: 2500, pumparoundDutyKw: 800, refluxRateKgHr: 5000, netOverheadKgHr: 1000, topLatentHeatKjKg: 250 });
  check('Column power failure: condenser + pumparound lost → W_heat = 3600·3000/250 = 43 200 kg/h governs', Math.abs(pf.W_heatKgHr - 43200) < 1e-9 && pf.reliefRateKgHr === 43200 && pf.dutiesKw.pumparoundRelief === 0);
  const rc = X.calcColumnUnbalancedHeat({ upset: 'reboiler_control_fail', reboilerDutyKw: 2000, condenserDutyKw: 2000, reboilerSurgeFactor: 1.5, topLatentHeatKjKg: 300 });
  check('Column reboiler control failure: (2000·1.5 − 2000)·3600/300 = 12 000 kg/h', Math.abs(rc.reliefRateKgHr - 12000) < 1e-9);
  // Pinch credit: Tm = 200, Tb,norm = 150, Tb,relief = 175 → ratio 0.5; W = 3600·(2000·0.5)/300 = 12 000
  const pc = X.calcColumnUnbalancedHeat({ upset: 'loss_cooling', reboilerDutyKw: 2000, condenserDutyKw: 1900, topLatentHeatKjKg: 300, reboilerPinchCredit: true, heatingMediumTempC: 200, normalBottomTempC: 150, relievingBottomTempC: 175 });
  const pc2 = X.calcColumnUnbalancedHeat({ upset: 'loss_cooling', reboilerDutyKw: 2000, condenserDutyKw: 1900, topLatentHeatKjKg: 300, reboilerPinchCredit: true, heatingMediumTempC: 200, normalBottomTempC: 150, relievingBottomTempC: 162.5 });
  check('Column pinch credit scales reboiler duty linearly with (Tm − Tb,relief)/(Tm − Tb,normal)', Math.abs(pc.pinchRatio - 0.5) < 1e-12 && Math.abs(pc.reliefRateKgHr - 12000) < 1e-9 && Math.abs(pc2.pinchRatio - 0.75) < 1e-12 && Math.abs(pc2.reliefRateKgHr - 18000) < 1e-9);
  const fp = X.calcColumnUnbalancedHeat({ upset: 'feed_preheat_fail_high', reboilerDutyKw: 1000, condenserDutyKw: 1000, feedPreheatDutyKw: 500, feedPreheatMaxDutyKw: 900, topLatentHeatKjKg: 400 });
  check('Column feed preheat at max: (1000 + 900 − 1000)·3600/400 = 8 100 kg/h', Math.abs(fp.reliefRateKgHr - 8100) < 1e-9);
}

// ---------------------------------------------------------------------------
// 8. Subcooled omega (API 520 Annex C)
// ---------------------------------------------------------------------------
{
  const omegaS = 10;
  const etaSt = 20 / 21;
  const P0 = 10, rho = 700;
  const rA = X.calcSubcooledOmegaSizing({ flowRateKgHr: 10000, P0_bara: P0, Ps_bara: 9.9, rhoLiq0KgM3: rho, omegaS, backPressureBara: 1.01325 });
  check('Subcooled: η_st = 2ω/(1 + 2ω) = 20/21 for ω_s = 10', Math.abs(rA.etaSt - etaSt) < 1e-12 && rA.region === 'low_subcooling' && rA.Kd === 0.85 && hasTrace(rA));
  // High subcooling: Ps = 5 → η_s = 0.5 < η_st; G = 1.414·√(ρ·ΔP) with ΔP in Pa; Pb < Ps → throat at Ps
  const rH = X.calcSubcooledOmegaSizing({ flowRateKgHr: 10000, P0_bara: P0, Ps_bara: 5, rhoLiq0KgM3: rho, omegaS, backPressureBara: 1.01325 });
  const Gh = Math.SQRT2 * Math.sqrt(rho * (10 - 5) * 1e5);
  const Ah = (10000 / (3600 * Gh * 0.65)) * 1e6;
  check('Subcooled high: G = 1.414·√(ρ·(P0 − Ps)) [Pa] and A = W/(3600·G·Kd) with Kd = 0.65', rH.region === 'high_subcooling' && rel(rH.G_kgM2s, Gh) < 1e-9 && rel(rH.areaMm2, Ah) < 1e-9 && Math.abs(rH.areaIn2 - Ah / 645.16) < 1e-9, `G = ${rH.G_kgM2s.toFixed(1)} kg/m²s, A = ${rH.areaMm2.toFixed(2)} mm²`);
  const rHb = X.calcSubcooledOmegaSizing({ flowRateKgHr: 10000, P0_bara: P0, Ps_bara: 5, rhoLiq0KgM3: rho, omegaS, backPressureBara: 7 });
  check('Subcooled high with Pb > Ps: throat pressure = Pb (all liquid)', !rHb.choked && rel(rHb.G_kgM2s, Math.sqrt(2 * rho * 3e5)) < 1e-9);
  // Continuity across η_st (both branches evaluated just either side of η_st)
  const PsLo = P0 * etaSt * 0.999, PsHi = P0 * etaSt * 1.001;
  const gLo = X.calcSubcooledOmegaSizing({ flowRateKgHr: 1, P0_bara: P0, Ps_bara: PsLo, rhoLiq0KgM3: rho, omegaS, backPressureBara: 1 });
  const gHi = X.calcSubcooledOmegaSizing({ flowRateKgHr: 1, P0_bara: P0, Ps_bara: PsHi, rhoLiq0KgM3: rho, omegaS, backPressureBara: 1 });
  check('Subcooled: G continuous across η_s = η_st within 2 % (η_c → η_s at the transition)', gLo.region === 'high_subcooling' && gHi.region === 'low_subcooling' && rel(gHi.G_kgM2s, gLo.G_kgM2s) < 0.02 && Math.abs(gHi.etaC - gHi.etaS) < 0.01, `G_high = ${gLo.G_kgM2s.toFixed(1)}, G_low = ${gHi.G_kgM2s.toFixed(1)}`);
  // Transcendental equation residual at the returned η_c
  const etaC = X.solveSubcooledEtaC(omegaS, 0.98);
  const resid = ((omegaS + 1 / omegaS - 2) / (2 * 0.98)) * etaC * etaC - 2 * (omegaS - 1) * etaC + omegaS * 0.98 * Math.log(etaC / 0.98) + 1.5 * omegaS * 0.98 - 1;
  check('Subcooled: η_c satisfies the Annex C transcendental equation (residual < 1e-9) and η_c < η_s', Math.abs(resid) < 1e-9 && etaC < 0.98 && etaC > 0, `η_c = ${etaC.toFixed(5)}`);
  // Saturated-inlet limit vs engine.js case 4 (same ω). Engine: P1 = set·1.1 + atm, P2 = atm (choked).
  const set = 9, atm = 1.01325, omega = 2.0, Wt = 5000;
  const eng = E.sizeOrificeApi520({ fluidPhase: 'twophase', flowRateKgHr: Wt, setPressureBarg: set, overpressurePct: 10, superimposedBackBarg: 0, builtUpBackBarg: 0, atmPressureBara: atm, rhoLiqKgM3: rho, omegaParam: omega, autoKb: false, manualKb: 1, ruptureDiscUpstream: false });
  const Geng = (Wt * 1000) / (3.6 * 0.85 * 1 * 1 * eng.reqAreaMm2);
  const P1 = set * 1.1 + atm;
  const sat = X.calcSubcooledOmegaSizing({ flowRateKgHr: Wt, P0_bara: P1, Ps_bara: P1, rhoLiq0KgM3: rho, omegaS: omega, backPressureBara: atm });
  check('Subcooled with Ps → P0 approaches engine.js saturated-ω G (case 4) within 10 %', rel(sat.G_kgM2s, Geng) < 0.10 && rel(sat.areaMm2, eng.reqAreaMm2) < 0.10, `G_ext = ${sat.G_kgM2s.toFixed(1)} vs G_engine = ${Geng.toFixed(1)} kg/m²s (η_c ${sat.etaC.toFixed(4)} vs ${(eng.Pcf_bara / eng.P1_bara).toFixed(4)})`);
  const kd = X.calcSubcooledOmegaSizing({ flowRateKgHr: 10000, P0_bara: P0, Ps_bara: 5, rhoLiq0KgM3: rho, omegaS, Kd: 0.7, Kb: 0.9, Kc: 0.9, Kv: 0.95 });
  check('Subcooled: user Kd/Kb/Kc/Kv honoured in A = W/(3600·G·Kd·Kb·Kc·Kv)', rel(kd.areaMm2, (10000 / (3600 * Gh * 0.7 * 0.9 * 0.9 * 0.95)) * 1e6) < 1e-9 && kd.Kd === 0.7);
}

// ---------------------------------------------------------------------------
// 9. Omega helpers
// ---------------------------------------------------------------------------
{
  const tp = X.calcOmegaTwoPoint({ v0: 0.002, v9: 0.0026 });
  check('Two-point omega: ω = 9·(v9/v0 − 1) = 2.7', Math.abs(tp.omega - 2.7) < 1e-12 && hasTrace(tp));
  // Saturated liquid (x0 = 0): ω = ρ0·Cp·T0·P0·((vg − vl)/hfg)²  (SI)
  const vl = 1 / 700, vg = 0.05, cp = 2.4e3, T0 = 100 + 273.15, P0 = 8e5, hfg = 3.2e5;
  const wExp = 700 * cp * T0 * P0 * Math.pow((vg - vl) / hfg, 2);
  const w = X.calcOmegaSaturated({ x0: 0, vLiq0M3Kg: vl, vVap0M3Kg: vg, cpLiqKjKgK: 2.4, T0_C: 100, P0_bara: 8, hfgKjKg: 320 });
  check('Saturated-liquid omega (x0 = 0) matches Annex C eq. C.1 flashing term (SI)', rel(w.omega, wExp) < 1e-9 && w.alpha0 === 0, `ω = ${w.omega.toFixed(4)}`);
  const x0 = 0.1;
  const v0 = x0 * vg + (1 - x0) * vl;
  const a0 = (x0 * vg) / v0;
  const wExp2 = a0 / 1.0 + (1 / v0) * cp * T0 * P0 * Math.pow((vg - vl) / hfg, 2);
  const w2 = X.calcOmegaSaturated({ x0, vLiq0M3Kg: vl, vVap0M3Kg: vg, cpLiqKjKgK: 2.4, T0_C: 100, P0_bara: 8, hfgKjKg: 320, k: 1.0 });
  check('Two-phase inlet omega (x0 = 0.1): ω = α₀/k + ρ₀·Cp·T₀·P₀·((vg − vl)/hfg)²', rel(w2.omega, wExp2) < 1e-9 && Math.abs(w2.alpha0 - a0) < 1e-12);
}

// ---------------------------------------------------------------------------
// 10. Input guards
// ---------------------------------------------------------------------------
{
  const z = X.calcControlValveFlowGas({ cv: 10, P1_bara: 10, P2_bara: 0, tempC: 20, mw: 29 });
  check('Guards: P2 = 0 (legit zero) is accepted by Number.isFinite guard and choked', z.choked && z.W_kgHr > 0);
  const bad = X.calcControlValveFlowGas({ cv: 10, P1_bara: 'x', P2_bara: 5, tempC: 20, mw: 29 });
  check('Guards: non-finite inputs give zero flow with a warning (no NaN)', bad.W_kgHr === 0 && bad.warnings.length > 0 && Number.isFinite(bad.W_kgHr));
  const sw = X.calcSwellEntrainment({ diameterM: 2, lengthM: 6, liquidLevelM: 3, vaporRateKgHr: 100, rhoVapKgM3: 700, rhoLiqKgM3: 600 });
  check('Guards: ρ_V ≥ ρ_L rejected with warning', sw.warnings.length > 0 && sw.twoPhaseVentingLikely === false);
  check('Module exports all required names', ['API521_CAUSES', 'checklistSummary', 'calcControlValveFlowGas', 'calcControlValveFlowLiquid', 'estimateControlValveCv', 'calcGasBlowby', 'calcSwellEntrainment', 'calcColumnUnbalancedHeat', 'calcSubcooledOmegaSizing', 'calcOmegaSaturated', 'calcOmegaTwoPoint'].every((n) => typeof X[n] === 'function' || Array.isArray(X[n])));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
