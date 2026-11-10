/**
 * Verification Suite — relief-thermo.js (HDI direct integration, EOS omega, supercritical fire) and the
 * thermoTP / flashPS / flashPH helpers in tools/fluid-props.js.
 *
 * Independent physics references (hand-derived, no external numbers):
 *   - Ideal-gas isentropic choked mass flux  G* = P0·√(k·M/(R·T0))·(2/(k+1))^((k+1)/(2(k−1))),  η_c = (2/(k+1))^(k/(k−1))
 *   - Clausius-Clapeyron / equilibrium: h_fg = T_sat·s_fg at saturation
 *   - Ideal-gas entropy  Δs = ∫Cp°/T dT − R·ln(P2/P1)  (Simpson integration of the Cp polynomial in this file)
 *   - Leung omega critical-flow:  η_c² + (ω²−2ω)(1−η_c)² + 2ω²·ln η_c + 2ω²(1−η_c) = 0,
 *     G = √(−2·[ω·ln η_c + (ω−1)(1−η_c)]) / (ω·(1/η_c − 1) + 1) · √(P0·ρ0)
 *   - Ideal-gas isobaric expansivity β_T = 1/T  →  W = Q/(Cp·T)
 */
'use strict';

const FP = require('../tools/fluid-props.js');
const RT = require('../relief-thermo.js');

const R = 8.314462618;
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { failed++; console.error(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// ---------------------------------------------------------------------------
// A. thermoTP — entropy / enthalpy fundamentals
// ---------------------------------------------------------------------------
const N2 = { comps: { N2: 1 } };
const n2_300_3 = FP.thermoTP({ ...N2, temperatureC: 26.85, pressureBara: 3 });
const n2_400_3 = FP.thermoTP({ ...N2, temperatureC: 126.85, pressureBara: 3 });
const n2_300_6 = FP.thermoTP({ ...N2, temperatureC: 26.85, pressureBara: 6 });
const M_N2 = 0.028014;

// Ideal-gas pressure term: s(300 K, 3 bar) − s(300 K, 1 bar ref) = −R ln 3 / M; PR residual at 3 bar is < 0.1 %
const sIdealPressure = -R * Math.log(3) / M_N2;
check('thermoTP N2 300 K / 3 bar: s ≈ −(R/M)·ln(P/Pref) (near-ideal gas, residual < 1.5 %)',
  n2_300_3.ok && rel(n2_300_3.mix.sMass, sIdealPressure) < 0.015 && Math.abs(n2_300_3.vap.sRes) < 0.5,
  `s = ${n2_300_3.mix.sMass.toFixed(3)} J/(kg·K), ideal = ${sIdealPressure.toFixed(3)}, s^R = ${n2_300_3.vap.sRes.toFixed(4)} J/(mol·K)`);

// Δs(300→400 K) at fixed P: Simpson integration of Cp°(T)/T from the library polynomial (independent of hIdealPure/sIdealPure)
const cpN2 = FP.library.find(c => c.id === 'N2').cp;
const cpPoly = (T) => cpN2[0] + cpN2[1] * T + cpN2[2] * T * T + cpN2[3] * T ** 3;
(function () {
  const n = 2000, a = 300, b = 400, hh = (b - a) / n; let s = 0;
  for (let i = 0; i <= n; i++) { const T = a + i * hh; const w = (i === 0 || i === n) ? 1 : (i % 2 ? 4 : 2); s += w * cpPoly(T) / T; }
  const dsIdeal = s * hh / 3 / M_N2;
  const dsEos = n2_400_3.mix.sMass - n2_300_3.mix.sMass;
  const dsResid = (n2_400_3.vap.sRes - n2_300_3.vap.sRes) / M_N2;
  check('Entropy rises with T: Δs(300→400 K, 3 bar) − Δs^R equals Simpson ∫Cp°/T dT to 1e-6; residual part < 1 %',
    dsEos > 0 && rel(dsEos - dsResid, dsIdeal) < 1e-6 && Math.abs(dsResid) < 0.01 * dsEos,
    `Δs_EOS = ${dsEos.toFixed(4)}, Δs^R = ${dsResid.toFixed(4)}, Δs_ideal = ${dsIdeal.toFixed(4)} J/(kg·K)`);
})();

const dsP = n2_300_6.mix.sMass - n2_300_3.mix.sMass;
const dsPres = (n2_300_6.vap.sRes - n2_300_3.vap.sRes) / M_N2;
check('Entropy falls with P: Δs(3→6 bar, 300 K) − Δs^R equals −(R/M)·ln 2 to 1e-9; residual part < 2 %',
  dsP < 0 && Math.abs(dsP - dsPres - (-R * Math.log(2) / M_N2)) < 1e-9 * Math.abs(dsP) && Math.abs(dsPres) < 0.02 * Math.abs(dsP),
  `Δs = ${dsP.toFixed(4)} (Δs^R = ${dsPres.toFixed(4)}) vs ideal ${(-R * Math.log(2) / M_N2).toFixed(4)} J/(kg·K)`);

// Clausius-Clapeyron at saturation (pure propane, 10 bara): h_fg = T_sat · s_fg — exact for a consistent EOS
const c3sat = FP.thermoTP({ comps: { C3: 1 }, pressureBara: 10, quality: 0.5 });
const hfg = c3sat.vap.hMass - c3sat.liq.hMass, sfg = c3sat.vap.sMass - c3sat.liq.sMass;
check('Saturated propane 10 bara: h_fg = T_sat·s_fg to 1e-6 (equilibrium consistency of PR h^R and s^R)',
  c3sat.ok && c3sat.phase === 'two-phase' && rel(hfg, c3sat.T * sfg) < 1e-6,
  `T_sat = ${(c3sat.T - 273.15).toFixed(2)} °C, h_fg = ${(hfg / 1e3).toFixed(2)} kJ/kg, T·s_fg = ${(c3sat.T * sfg / 1e3).toFixed(2)} kJ/kg, ρ_L = ${c3sat.liq.rho.toFixed(1)}, ρ_V = ${c3sat.vap.rho.toFixed(2)} kg/m³`);

check('Pure-component T_sat(P) inverts P_sat(T): propane 10 bara',
  rel(FP.psatPure('C3', FP.tsatPure('C3', 10)), 10) < 1e-6, `P_sat(T_sat) = ${FP.psatPure('C3', FP.tsatPure('C3', 10)).toFixed(6)} bara`);

// ---------------------------------------------------------------------------
// B. flashPS / flashPH
// ---------------------------------------------------------------------------
const MIX = { comps: { C3: 0.6, nC4: 0.4 }, kijMode: 'typical' };
const mix0 = FP.thermoTP({ ...MIX, temperatureC: 30, pressureBara: 5 });
const mixPS = FP.flashPS({ ...MIX, pressureBara: 2.5 }, mix0.mix.sMass);
check('flashPS (C3/nC4, 5 → 2.5 bara): s(T_solved) equals target to 1e-6 relative, converged flag set',
  mixPS.ok && mixPS.converged && rel(mixPS.mix.sMass, mix0.mix.sMass) < 1e-6 && mixPS.tC < 30,
  `T = ${mixPS.tC.toFixed(3)} °C, phase ${mixPS.phase}, |Δs|/s = ${rel(mixPS.mix.sMass, mix0.mix.sMass).toExponential(2)}, ${mixPS.iterations} iterations`);

const mixPH = FP.flashPH({ ...MIX, pressureBara: 5 }, mix0.mix.hMass);
check('flashPH round trip (same P, h target from thermoTP) recovers T = 30 °C within 1e-5 K',
  mixPH.ok && mixPH.converged && Math.abs(mixPH.tC - 30) < 1e-5, `T = ${mixPH.tC.toFixed(7)} °C`);

// Pure component through the dome: expand saturated liquid propane 10 → 3 bara isentropically; lever rule quality
const sL10 = FP.thermoTP({ comps: { C3: 1 }, pressureBara: 10, quality: 0 }).mix.sMass;
const c3ps3 = FP.flashPS({ comps: { C3: 1 }, pressureBara: 3 }, sL10);
(function () {
  const sat3 = FP.thermoTP({ comps: { C3: 1 }, pressureBara: 3, quality: 0 }), sat3v = FP.thermoTP({ comps: { C3: 1 }, pressureBara: 3, quality: 1 });
  const xLever = (sL10 - sat3.mix.sMass) / (sat3v.mix.sMass - sat3.mix.sMass);
  check('flashPS pure propane sat. liquid 10 → 3 bara lands inside the dome at T_sat(3 bar) with lever-rule quality',
    c3ps3.ok && c3ps3.phase === 'two-phase' && Math.abs(c3ps3.betaMass - xLever) < 1e-9 && Math.abs(c3ps3.T - FP.tsatPure('C3', 3)) < 1e-6 && rel(c3ps3.mix.sMass, sL10) < 1e-9,
    `T = ${c3ps3.tC.toFixed(2)} °C, x = ${c3ps3.betaMass.toFixed(4)} (lever ${xLever.toFixed(4)})`);
})();

// ---------------------------------------------------------------------------
// C. HDI direct integration vs ideal-gas isentropic choked flow (N2, 3 bara, 300 K)
// ---------------------------------------------------------------------------
const hdiN2 = RT.calcHdiMassFlux({ fluid: N2, P0_bara: 3, T0_C: 26.85, backPressureBara: 1.01325, nSteps: 60 });
const kN2 = n2_300_3.vap.kIdeal;   // Cp°/Cv° at T0
const Gstar = 3e5 * Math.sqrt(kN2 * M_N2 / (R * 300)) * Math.pow(2 / (kN2 + 1), (kN2 + 1) / (2 * (kN2 - 1)));
const etaStar = Math.pow(2 / (kN2 + 1), kN2 / (kN2 - 1));
check('HDI N2 3 bara/300 K: G_max within 3 % of ideal-gas isentropic choked flux P0·√(kM/RT0)·(2/(k+1))^((k+1)/(2(k−1)))',
  hdiN2.ok && hdiN2.choked && rel(hdiN2.G_kgM2s, Gstar) < 0.03,
  `G_HDI = ${hdiN2.G_kgM2s.toFixed(1)}, G* = ${Gstar.toFixed(1)} kg/(m²·s) (k = ${kN2.toFixed(4)}, diff ${(100 * (hdiN2.G_kgM2s / Gstar - 1)).toFixed(2)} %)`);
check('HDI N2: P_throat/P0 within 3 % of (2/(k+1))^(k/(k−1))',
  rel(hdiN2.P_throat_bara / 3, etaStar) < 0.03, `η_HDI = ${(hdiN2.P_throat_bara / 3).toFixed(4)}, η* = ${etaStar.toFixed(4)}`);
check('HDI points: s = s0 along the whole path (|Δs|/s0 < 1e-6) and h decreases monotonically',
  hdiN2.points.every(p => rel(p.s, hdiN2.s0) < 1e-6) && hdiN2.points.every((p, i, a) => i === 0 || p.h < a[i - 1].h),
  `${hdiN2.points.length} points, T_end = ${hdiN2.points[hdiN2.points.length - 1].T_C.toFixed(2)} °C`);

const hdiSub = RT.calcHdiMassFlux({ fluid: N2, P0_bara: 3, T0_C: 26.85, backPressureBara: 2.5, nSteps: 40 });
(function () {
  // subcritical ideal-gas mass flux at η = 2.5/3: G = P0·√(2k·M/((k−1)RT0)·(η^(2/k) − η^((k+1)/k)))
  const eta = 2.5 / 3, k = kN2;
  const Gsub = 3e5 * Math.sqrt(2 * k * M_N2 / ((k - 1) * R * 300) * (Math.pow(eta, 2 / k) - Math.pow(eta, (k + 1) / k)));
  check('HDI N2 with Pb = 2.5 bara (η > η_c): reported subcritical, G = G(Pb) within 1 % of ideal-gas subcritical flux',
    hdiSub.ok && !hdiSub.choked && Math.abs(hdiSub.P_throat_bara - 2.5) < 1e-9 && rel(hdiSub.G_kgM2s, Gsub) < 0.01,
    `G = ${hdiSub.G_kgM2s.toFixed(1)} vs ideal ${Gsub.toFixed(1)} kg/(m²·s)`);
})();

const area = RT.requiredAreaMm2FromG({ flowRateKgHr: 3600, G_kgM2s: 1000, Kd: 0.85 });
check('requiredAreaMm2FromG: 3600 kg/h, G = 1000, Kd = 0.85 → A = 1/(0.85·1000) m² = 1176.47 mm²',
  area.ok && Math.abs(area.areaMm2 - 1e6 / 850) < 1e-6, `A = ${area.areaMm2.toFixed(3)} mm²`);

// ---------------------------------------------------------------------------
// D. Omega methods — saturated propane 10 bara (x0 = 5 % mass vapour) vs HDI
// ---------------------------------------------------------------------------
const C3SAT = { comps: { C3: 1 }, quality: 0.05 };
const om2 = RT.calcOmegaTwoPointEos({ fluid: C3SAT, P0_bara: 10, T0_C: 27 });
check('Two-point ω for saturated propane 10 bara (x0 = 0.05): ω > 1, quality rises on expansion to 0.9·P0',
  om2.ok && om2.omega > 1 && om2.x9 > om2.x0 && om2.phase9 === 'two-phase',
  `ω = ${om2.omega.toFixed(3)}, v0 = ${om2.v0.toExponential(4)}, v9 = ${om2.v9.toExponential(4)} m³/kg, x0 = ${om2.x0.toFixed(4)} → x9 = ${om2.x9.toFixed(4)}`);

// Leung omega critical flow (independent implementation, exact η_c from the transcendental equation)
function leungG(omega, P0_Pa, rho0) {
  const F = (e) => e * e + (omega * omega - 2 * omega) * (1 - e) ** 2 + 2 * omega * omega * Math.log(e) + 2 * omega * omega * (1 - e);
  let lo = 1e-6, hi = 1 - 1e-9;   // F(lo) < 0 (ln term), F(1) = 1 > 0
  for (let i = 0; i < 200; i++) { const m = 0.5 * (lo + hi); if (F(m) < 0) lo = m; else hi = m; }
  const eta = 0.5 * (lo + hi);
  const Gs = Math.sqrt(-2 * (omega * Math.log(eta) + (omega - 1) * (1 - eta))) / (omega * (1 / eta - 1) + 1);
  return { eta, Gstar: Gs, G: Gs * Math.sqrt(P0_Pa * rho0) };
}
const hdiC3 = RT.calcHdiMassFlux({ fluid: C3SAT, P0_bara: 10, T0_C: 27, backPressureBara: 1.01325, nSteps: 80 });
const lg = leungG(om2.omega, 10e5, om2.rho0);
const aHdi = RT.requiredAreaMm2FromG({ flowRateKgHr: 10000, G_kgM2s: hdiC3.G_kgM2s }).areaMm2;
const aOmega = RT.requiredAreaMm2FromG({ flowRateKgHr: 10000, G_kgM2s: lg.G }).areaMm2;
check('HDI area vs ω-method area (Leung, exact η_c) for saturated propane agree within 25 %',
  hdiC3.ok && hdiC3.choked && rel(aHdi, aOmega) < 0.25,
  `A_HDI = ${aHdi.toFixed(1)} mm² (G = ${hdiC3.G_kgM2s.toFixed(0)}, η_c = ${hdiC3.etaCrit.toFixed(3)}), A_ω = ${aOmega.toFixed(1)} mm² (G = ${lg.G.toFixed(0)}, η_c = ${lg.eta.toFixed(3)}) → difference ${(100 * (aHdi / aOmega - 1)).toFixed(1)} %`);

const omSat = RT.calcOmegaSaturatedEos({ fluid: C3SAT, P0_bara: 10, T0_C: 27 });
check('Saturated-ω (Eq. C.1 form) for the same state: ω > 1 and within 30 % of the two-point ω (both terms positive)',
  omSat.ok && omSat.omega > 1 && omSat.term_alpha_k > 0 && omSat.term_flash > 0 && rel(omSat.omega, om2.omega) < 0.30,
  `ω_sat = ${omSat.omega.toFixed(3)} (α0/k = ${omSat.term_alpha_k.toFixed(3)}, flash term = ${omSat.term_flash.toFixed(3)}, α0 = ${omSat.alpha0.toFixed(3)}) vs ω_2pt = ${om2.omega.toFixed(3)}`);

const omSatFail = RT.calcOmegaSaturatedEos({ fluid: N2, P0_bara: 3, T0_C: 26.85 });
check('Saturated-ω on a single-phase gas returns ok:false with a reason', !omSatFail.ok && /two-phase/.test(omSatFail.error), omSatFail.error);

// ---------------------------------------------------------------------------
// E. Supercritical / single-phase fire
// ---------------------------------------------------------------------------
const sfIdeal = RT.calcSupercriticalFire({ fluid: { comps: { C1: 1 } }, P1_bara: 2, T0_C: 126.85, fireHeatKw: 1000, tMaxC: 593, dT_C: 50, fluidMassKg: 1000 });
(function () {
  const s0 = sfIdeal.steps[0];
  const Wref = 1e6 / (s0.cpMass * 400) * 3600;   // ideal gas: β_T = 1/T → W = Q/(Cp·T)
  check('Supercritical-fire C1 2 bara/400 K: W = Q·β_T/Cp equals ideal-gas Q/(Cp·T) within 2 % (β_T·T ≈ 1)',
    sfIdeal.ok && rel(s0.W_kgHr, Wref) < 0.02, `W = ${s0.W_kgHr.toFixed(1)} kg/h vs Q/(Cp·T) = ${Wref.toFixed(1)} kg/h, β_T·T = ${(s0.betaT_perK * s0.T_K).toFixed(4)}`);
  check('W_kgHr decreases monotonically with T at constant P (ideal-gas limit), governing step is the first (coldest)',
    sfIdeal.steps.every((s, i, a) => i === 0 || s.W_kgHr < a[i - 1].W_kgHr) && sfIdeal.governing.index === 0,
    `W: ${sfIdeal.steps[0].W_kgHr.toFixed(0)} → ${sfIdeal.steps[sfIdeal.steps.length - 1].W_kgHr.toFixed(0)} kg/h over ${sfIdeal.steps.length} steps; A_gov = ${sfIdeal.governing.areaMm2.toFixed(1)} mm²`);
  // API 520 Pt I SI gas equation: A[mm²] = W/(C·Kd·P1[kPaa]·Kb·Kc)·√(T·Z/M), W kg/h, C = 0.03948·√(k·(2/(k+1))^((k+1)/(k−1)))
  const k = s0.kUsed, C = 0.03948 * Math.sqrt(k * Math.pow(2 / (k + 1), (k + 1) / (k - 1)));
  const Aapi = s0.W_kgHr / (C * 0.975 * 200 * 1 * 1) * Math.sqrt(s0.T_K * s0.Z / s0.mw);
  check('Per-step area reproduces the API 520 Pt I SI gas equation (C = 0.03948·√(k(2/(k+1))^((k+1)/(k−1))), P1 in kPa) within 0.2 %',
    rel(s0.areaMm2, Aapi) < 2e-3, `A_step = ${s0.areaMm2.toFixed(2)} mm², A_API520 = ${Aapi.toFixed(2)} mm²`);
  // time estimate: dt = m·Cp·dT/Q with m = m0·ρ/ρ0
  check('Heat-up time per step dt = m·Cp·ΔT/Q with m = m0·ρ/ρ0, cumulative time positive and increasing',
    Math.abs(s0.dt_s - 1000 * s0.cpMass * 50 / 1e6) < 1e-9 && sfIdeal.steps.every((s, i, a) => i === 0 || (s.tCum_s > a[i - 1].tCum_s && s.massKg < a[i - 1].massKg)),
    `dt_0 = ${s0.dt_s.toFixed(1)} s, total ${(sfIdeal.steps[sfIdeal.steps.length - 1].tCum_s / 60).toFixed(1)} min`);
})();

const sfSC = RT.calcSupercriticalFire({ fluid: { comps: { C1: 0.9, C2: 0.1 }, kijMode: 'typical' }, P1_bara: 60, T0_C: 30, fireHeatKw: 2000, dT_C: 25 });
check('isSupercritical: C1/C2 at 60 bara (P_pc = Σz·Pc ≈ 46.3 bar) → true; C1 at 2 bara → false (with warning)',
  sfSC.ok && sfSC.isSupercritical && Math.abs(sfSC.pseudoCritical.ppcBar - (0.9 * 45.99 + 0.1 * 48.72)) < 1e-6 && !sfIdeal.isSupercritical && sfIdeal.warnings.some(w => /pseudo-critical/.test(w)),
  `P_pc = ${sfSC.pseudoCritical.ppcBar.toFixed(3)} bar, dense-phase governing A = ${sfSC.governing.areaMm2.toFixed(1)} mm² at ${sfSC.governing.T_C} °C, ρ0 = ${sfSC.steps[0].rho.toFixed(1)} kg/m³`);

// Phase change while stepping: liquid propane at 15 bara heated from 20 °C crosses T_sat(15 bar) ≈ 43 °C
const sfPC = RT.calcSupercriticalFire({ fluid: { comps: { C3: 1 } }, P1_bara: 15, T0_C: 20, fireHeatKw: 500, dT_C: 5 });
check('Phase change detected: liquid propane 15 bara heated from 20 °C stops stepping near T_sat with a latent-heat warning',
  sfPC.ok && sfPC.stoppedTwoPhaseAtC !== null && Math.abs(sfPC.stoppedTwoPhaseAtC - (FP.tsatPure('C3', 15) - 273.15)) <= 5.5 && sfPC.warnings.some(w => /latent-heat/.test(w)) && sfPC.steps.every(s => s.phase === 'liquid'),
  `stopped at ${sfPC.stoppedTwoPhaseAtC} °C (T_sat = ${(FP.tsatPure('C3', 15) - 273.15).toFixed(2)} °C), ${sfPC.steps.length} liquid steps`);

// ---------------------------------------------------------------------------
// F. Contract: ok / warnings / trace shape, error handling
// ---------------------------------------------------------------------------
const allRes = [hdiN2, hdiSub, area, om2, omSat, sfIdeal, sfSC, hdiC3];
check('Every result carries ok, warnings[] and trace[{title,symbolic,substitution,result}] as plain text (no HTML tags)',
  allRes.every(r => r.ok && Array.isArray(r.warnings) && Array.isArray(r.trace) && r.trace.length >= 1 &&
    r.trace.every(t => ['title', 'symbolic', 'substitution', 'result'].every(k => typeof t[k] === 'string' && !/<[a-z/]/i.test(t[k])))),
  `${allRes.reduce((s, r) => s + r.trace.length, 0)} trace steps checked`);
const bad = RT.calcHdiMassFlux({ fluid: N2, P0_bara: 1, T0_C: 20, backPressureBara: 2 });
const bad2 = RT.calcHdiMassFlux({ fluid: { comps: {} }, P0_bara: 5, T0_C: 20 });
check('Invalid inputs return ok:false with error (Pb ≥ P0; empty composition)', !bad.ok && /Back pressure/.test(bad.error) && !bad2.ok && /empty/i.test(bad2.error), `${bad.error} | ${bad2.error}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
