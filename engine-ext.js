/**
 * PSVCalc Pro — Relief-Scenario Engine Extension (engine-ext.js)
 *
 * Extends engine.js with:
 *   1. API 521 Table 1 overpressure-cause checklist (documentation / credibility review)
 *   2. IEC 60534-2-1 control-valve gas & liquid capacity (choked-flow aware)
 *   3. Control-valve rated-Cv estimation (size table / back-calculation from normal flow)
 *   4. Gas blow-by (HP -> LP level-valve fail-open)
 *   5. DIERS drift-flux level swell / two-phase venting screen
 *   6. Distillation column unbalanced-heat relief load
 *   7. API 520 Part I Annex C subcooled-liquid omega sizing + omega parameter helpers
 *
 * Conventions (same as engine.js): SI canonical inputs (bara/barg, °C, kg/h, m, kg/m³),
 * pure functions, no DOM. Every calc result carries `warnings: []` and
 * `trace: [{title, symbolic, substitution, result}]` (plain text, unicode symbols).
 */

const PSVEngineExt = (() => {
  'use strict';

  // -------------------------------------------------------------------------
  // 0. Base-engine access (lazy) and small helpers
  // -------------------------------------------------------------------------
  function baseEngine() {
    if (typeof window !== 'undefined' && window.PSVEngine) return window.PSVEngine;
    if (typeof require === 'function') {
      try { return require('./engine.js'); } catch (e) { /* fall through */ }
    }
    return null;
  }

  const KG_HR_PER_LB_HR = 1 / 2.20462262;
  const MM2_PER_IN2 = 645.16;
  const G_ACCEL = 9.80665;            // m/s²

  const fin = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const kgHrToLbHr = (w) => w / KG_HR_PER_LB_HR;
  const f = (v, n = 3) => (Number.isFinite(v) ? Number(v).toFixed(n) : String(v));

  function step(title, symbolic, substitution, result) {
    return { title, symbolic, substitution, result };
  }

  /** Bisection on a continuous function over [lo, hi]; assumes a sign change. */
  function bisect(fn, lo, hi, iters = 200, tol = 1e-13) {
    let flo = fn(lo);
    for (let i = 0; i < iters; i++) {
      const mid = 0.5 * (lo + hi);
      const fm = fn(mid);
      if (!Number.isFinite(fm)) { hi = mid; continue; }
      if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else { hi = mid; }
      if (Math.abs(hi - lo) < tol) break;
    }
    return 0.5 * (lo + hi);
  }

  // -------------------------------------------------------------------------
  // 1. API 521 OVERPRESSURE-CAUSE CHECKLIST (API Std 521, 7th Ed., Table 1 / §4.4)
  //    api521Ref carries a clause only where it is known with confidence; otherwise
  //    'API 521 Table 1'.
  // -------------------------------------------------------------------------
  const LINKED_SCENARIO_KEYS = [
    'fire_liquid', 'fire_gas', 'fire_supercritical', 'blocked_outlet', 'cv_failure',
    'gas_blowby', 'thermal_expansion', 'tube_rupture', 'abnormal_heat', 'column_unbalanced'
  ];

  const API521_CAUSES = [
    { id: 'closed_outlet', title: 'Closed outlets on vessels (blocked discharge)', group: 'process', api521Ref: 'API 521 §4.4.2',
      typicalBasis: 'Maximum inflow from the upstream source (pump/compressor curve or upstream pressure) at relieving pressure, less credited normal outflows.', linkedScenarioKey: 'blocked_outlet', defaultStatus: 'review' },
    { id: 'cw_failure_condenser', title: 'Cooling-water failure to condenser', group: 'utility', api521Ref: 'API 521 §4.4.3',
      typicalBasis: 'Total incoming vapour to the condenser (condensing duty lost) at relieving conditions, via unbalanced heat.', linkedScenarioKey: 'column_unbalanced', defaultStatus: 'review' },
    { id: 'top_reflux_failure', title: 'Top-tower reflux failure', group: 'process', api521Ref: 'API 521 §4.4.3',
      typicalBasis: 'Total overhead vapour (reflux + net overhead) once the accumulator floods the condenser; cross-check by heat balance.', linkedScenarioKey: 'column_unbalanced', defaultStatus: 'review' },
    { id: 'side_reflux_failure', title: 'Side-stream reflux (pumparound) failure', group: 'process', api521Ref: 'API 521 §4.4.3',
      typicalBasis: 'Difference between vapour entering and leaving the pumparound section when the pumparound heat removal is lost.', linkedScenarioKey: 'column_unbalanced', defaultStatus: 'review' },
    { id: 'lean_oil_failure', title: 'Lean-oil (absorbent) failure to absorber', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'No relief load from the absorber itself; evaluate downstream effects of un-absorbed gas (normally none for the absorber).', linkedScenarioKey: null, defaultStatus: 'review' },
    { id: 'noncondensables', title: 'Accumulation of non-condensables (condenser blanketing)', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Same as total loss of condensing (loss of cooling) unless non-condensables are reliably vented.', linkedScenarioKey: 'column_unbalanced', defaultStatus: 'review' },
    { id: 'volatile_water_into_hot_oil', title: 'Entrance of highly volatile material — water into hot oil', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Rapid vaporisation of water slugs; usually not sized for (prevented by design/operation) and documented as not credible or mitigated.', linkedScenarioKey: null, defaultStatus: 'review' },
    { id: 'volatile_lights_into_hot_oil', title: 'Entrance of highly volatile material — light hydrocarbons into hot oil', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Flash of the light inflow at the hot-oil temperature; rate = light-material inflow fully vaporised where credible.', linkedScenarioKey: null, defaultStatus: 'review' },
    { id: 'overfilling', title: 'Overfilling storage or surge vessel', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Maximum liquid inflow rate (pump capacity at relieving pressure) once the vessel is liquid full.', linkedScenarioKey: 'blocked_outlet', defaultStatus: 'review' },
    { id: 'cv_fail_open_inlet', title: 'Failure of automatic controls — inlet control valve fails open', group: 'mechanical', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Fully open valve (plus any bypass credited open) capacity at relieving pressure, less normal outflow where the outlet remains open.', linkedScenarioKey: 'cv_failure', defaultStatus: 'review' },
    { id: 'cv_fail_closed_outlet', title: 'Failure of automatic controls — outlet control valve fails closed', group: 'mechanical', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Equivalent to a blocked outlet: maximum inflow at relieving pressure.', linkedScenarioKey: 'blocked_outlet', defaultStatus: 'review' },
    { id: 'abnormal_heat_input', title: 'Abnormal heat or vapour input (reboiler / heater over-firing)', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Vapour generated by the maximum heat-source duty (clean exchanger, control valve wide open) less credited condensing, divided by latent heat.', linkedScenarioKey: 'abnormal_heat', defaultStatus: 'review' },
    { id: 'split_exchanger_tube', title: 'Split exchanger tube / heat-transfer equipment failure', group: 'mechanical', api521Ref: 'API 521 §4.4.14',
      typicalBasis: 'Double-ended tube rupture: HP fluid through twice the tube cross-section into the LP side at relieving pressure.', linkedScenarioKey: 'tube_rupture', defaultStatus: 'review' },
    { id: 'internal_explosion', title: 'Internal explosions (excluding detonation)', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Not a PRV sizing case — pressure rise is too fast; addressed by explosion venting / suppression or prevention.', linkedScenarioKey: null, defaultStatus: 'review' },
    { id: 'chemical_reaction', title: 'Chemical reaction (runaway / exotherm)', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Peak vapour/gas generation rate from reaction calorimetry (DIERS methodology); frequently two-phase venting.', linkedScenarioKey: null, defaultStatus: 'review' },
    { id: 'hydraulic_expansion', title: 'Hydraulic (thermal) expansion of blocked-in liquid', group: 'external', api521Ref: 'API 521 §4.4.12',
      typicalBasis: 'Volumetric expansion from heat input (exchanger duty or solar): q = α·Q/(ρ·Cp); usually a thermal relief valve.', linkedScenarioKey: 'thermal_expansion', defaultStatus: 'review' },
    { id: 'exterior_fire_wetted', title: 'Exterior fire — liquid-wetted vessel', group: 'external', api521Ref: 'API 521 §4.4.13',
      typicalBasis: 'Q = C·F·A_ws^0.82 on the wetted area within 7.62 m of grade; W = Q/λ at relieving pressure.', linkedScenarioKey: 'fire_liquid', defaultStatus: 'review' },
    { id: 'exterior_fire_unwetted', title: 'Exterior fire — gas-filled / unwetted vessel', group: 'external', api521Ref: 'API 521 §4.4.13',
      typicalBasis: 'Gas expansion with wall temperature limit: W = 0.2772·√(M·P1)·A′·(Tw − T1)^1.25/T1^1.1506 (USC form).', linkedScenarioKey: 'fire_gas', defaultStatus: 'review' },
    { id: 'exterior_fire_supercritical', title: 'Exterior fire — supercritical / dense-phase fluid', group: 'external', api521Ref: 'API 521 §4.4.13',
      typicalBasis: 'Dynamic or pseudo-latent-heat method: unwetted heat flux applied to a fluid above its critical pressure.', linkedScenarioKey: 'fire_supercritical', defaultStatus: 'review' },
    { id: 'power_failure_fractionator', title: 'Power failure — fractionator (reflux and overhead pumps, fans)', group: 'utility', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Unbalanced heat with condenser, pumparound and reflux lost while the reboiler continues; governed by max of heat and vapour bases.', linkedScenarioKey: 'column_unbalanced', defaultStatus: 'review' },
    { id: 'power_failure_reactor', title: 'Power failure — reactor (loss of agitation / quench / cooling)', group: 'utility', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Reaction heat release without cooling; evaluate as runaway reaction where exothermic.', linkedScenarioKey: null, defaultStatus: 'review' },
    { id: 'power_failure_air_cooler', title: 'Power failure — air-cooled exchanger (fan failure)', group: 'utility', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Loss of condensing duty; natural-convection credit (typically 20–30 % of design duty) only where justified.', linkedScenarioKey: 'column_unbalanced', defaultStatus: 'review' },
    { id: 'power_failure_surge_vessel', title: 'Power failure — surge vessel (downstream pump stops)', group: 'utility', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Inflow continues while the outlet pump has stopped: maximum inflow at relieving pressure (blocked-outlet type).', linkedScenarioKey: 'blocked_outlet', defaultStatus: 'review' },
    { id: 'power_failure_general', title: 'Power failure — general / total plant utility failure', group: 'utility', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Simultaneous loss of all electrically driven equipment; evaluate each protected system and the common flare load.', linkedScenarioKey: null, defaultStatus: 'review' },
    { id: 'instrument_air_failure', title: 'Loss of instrument air (valves to fail position)', group: 'utility', api521Ref: 'API 521 Table 1',
      typicalBasis: 'All air-operated valves assume their fail positions simultaneously; evaluate resulting blocked outlets / fail-open inlets.', linkedScenarioKey: 'cv_failure', defaultStatus: 'review' },
    { id: 'inadvertent_valve_opening', title: 'Inadvertent valve opening (manual bypass / blowdown valve)', group: 'mechanical', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Full-open capacity of the valve from the highest-pressure source at relieving pressure.', linkedScenarioKey: 'cv_failure', defaultStatus: 'review' },
    { id: 'check_valve_failure', title: 'Check-valve failure / reverse flow', group: 'mechanical', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Reverse flow from the HP system through the failed check valve; single check valve is normally not credited as complete protection.', linkedScenarioKey: 'cv_failure', defaultStatus: 'review' },
    { id: 'gas_blowby', title: 'Gas blow-by (loss of liquid level in HP vessel, level valve fails open)', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'HP gas through the fully open level control valve (plus bypass) into the LP system at LP relieving pressure.', linkedScenarioKey: 'gas_blowby', defaultStatus: 'review' },
    { id: 'vacuum_loss_heat', title: 'Vacuum / loss of heat in series fractionation (condensing collapse)', group: 'process', api521Ref: 'API 521 Table 1',
      typicalBasis: 'Vacuum protection: maximum condensing/cooling rate or pump-out rate with inflow stopped; sized as vacuum relief or inert gas make-up.', linkedScenarioKey: null, defaultStatus: 'review' }
  ];

  /** Counts checklist statuses: applicable / not_applicable / not_credible / review. */
  function checklistSummary(statusMap = {}) {
    const counts = { applicable: 0, not_applicable: 0, not_credible: 0, review: 0, total: API521_CAUSES.length };
    for (const c of API521_CAUSES) {
      const s = statusMap && statusMap[c.id];
      if (s === 'applicable' || s === 'not_applicable' || s === 'not_credible') counts[s]++;
      else counts.review++;
    }
    return counts;
  }

  // -------------------------------------------------------------------------
  // 2. IEC 60534-2-1 CONTROL-VALVE FLOW
  // -------------------------------------------------------------------------
  // Typical pressure-differential ratio factors xT at full opening (IEC 60534-2-1 Annex C /
  // Fisher Control Valve Handbook typical values). Representative values only — use vendor data.
  const TYPICAL_XT = {
    globe_single: 0.72,
    globe: 0.72,
    globe_cage: 0.70,
    ball_segmented: 0.32,
    ball_full: 0.20,
    butterfly: 0.30,
    eccentric_plug: 0.45
  };
  const N8_CV_BAR_KGHR = 94.8;   // IEC 60534-2-1 N8 for Cv (US), P in bar, T in K, W in kg/h
  const N1_CV_BAR_M3HR = 0.865;  // IEC 60534-2-1 N1 for Cv (US), ΔP in bar, Q in m³/h
  const RHO_WATER_REF = 1000.0;  // kg/m³ reference for relative density in IEC 60534-2-1

  function typicalXt(valveType) {
    return Object.prototype.hasOwnProperty.call(TYPICAL_XT, valveType) ? TYPICAL_XT[valveType] : TYPICAL_XT.globe_single;
  }

  /**
   * Gas mass flow through a control valve (IEC 60534-2-1, turbulent, Fp = 1):
   *   W [kg/h] = N8·Fp·Cv·P1·Y·√(x·M/(T·Z)),  x = min(ΔP/P1, Fγ·xT),  Y = 1 − x/(3·Fγ·xT) ≥ 2/3
   */
  function calcControlValveFlowGas(params = {}) {
    const warnings = [];
    const trace = [];
    const cv = Math.max(0, fin(params.cv, 0));
    const P1 = fin(params.P1_bara, NaN);
    const P2 = fin(params.P2_bara, NaN);
    const T = fin(params.tempC, NaN) + 273.15;
    const M = fin(params.mw, NaN);
    const Z = fin(params.z, 1.0);
    const k = fin(params.k, 1.3);
    const valveType = params.valveType || 'globe';
    const xTGiven = Number.isFinite(num(params.xT));
    const xT = xTGiven ? num(params.xT) : typicalXt(valveType);
    const Fp = 1.0;

    if (![P1, P2, T, M].every(Number.isFinite) || P1 <= 0 || T <= 0 || M <= 0 || Z <= 0) {
      warnings.push('Invalid inputs: P1, P2, temperature and molecular weight must be finite and positive.');
      return { W_kgHr: 0, W_lbHr: 0, choked: false, x: 0, xChoked: 0, Y: 1, Fgamma: k / 1.4, xT, Fp, warnings, trace };
    }
    if (P2 >= P1) {
      warnings.push('Downstream pressure ≥ upstream pressure — no forward flow.');
    }
    if (!xTGiven) warnings.push(`xT not supplied — typical ${valveType} value ${xT} used (confirm with vendor data).`);

    const Fgamma = k / 1.4;
    const xActual = Math.max(0, (P1 - P2) / P1);
    const xChoked = Fgamma * xT;
    const choked = xActual >= xChoked;
    const x = Math.min(xActual, xChoked);
    const Y = Math.max(2 / 3, 1 - x / (3 * Fgamma * xT));
    const W = N8_CV_BAR_KGHR * Fp * cv * P1 * Y * Math.sqrt((x * M) / (T * Z));

    trace.push(step('Pressure-drop ratio and choking limit (IEC 60534-2-1)', 'Fγ = k/1.4 ;  x = (P₁ − P₂)/P₁ ;  x_choked = Fγ·x_T',
      `Fγ = ${f(k, 3)}/1.4 = ${f(Fgamma, 4)} ;  x = (${f(P1)} − ${f(P2)})/${f(P1)} = ${f(xActual, 4)} ;  x_choked = ${f(Fgamma, 4)}·${f(xT, 3)} = ${f(xChoked, 4)}`,
      choked ? `x ≥ x_choked → choked, x limited to ${f(x, 4)}` : `x < x_choked → sub-critical, x = ${f(x, 4)}`));
    trace.push(step('Expansion factor', 'Y = 1 − x/(3·Fγ·x_T)  (≥ 2/3)', `Y = 1 − ${f(x, 4)}/(3·${f(Fgamma, 4)}·${f(xT, 3)})`, `Y = ${f(Y, 4)}`));
    trace.push(step('Gas mass flow', 'W = N₈·Fp·Cv·P₁·Y·√(x·M/(T·Z)),  N₈ = 94.8',
      `W = 94.8·${f(Fp, 2)}·${f(cv, 2)}·${f(P1)}·${f(Y, 4)}·√(${f(x, 4)}·${f(M, 2)}/(${f(T, 2)}·${f(Z, 3)}))`, `W = ${f(W, 1)} kg/h (${f(kgHrToLbHr(W), 1)} lb/h)`));

    return { W_kgHr: W, W_lbHr: kgHrToLbHr(W), choked, x, xActual, xChoked, Y, Fgamma, xT, xTSource: xTGiven ? 'input' : `typical ${valveType}`, Fp, warnings, trace };
  }

  /**
   * Liquid mass flow through a control valve (IEC 60534-2-1, turbulent, Fp = 1):
   *   Q [m³/h] = N1·Cv·√(ΔP_sizing/(ρ/ρ₀)),  ΔP_max = FL²·(P1 − FF·Pv),  FF = 0.96 − 0.28·√(Pv/Pc)
   */
  function calcControlValveFlowLiquid(params = {}) {
    const warnings = [];
    const trace = [];
    const cv = Math.max(0, fin(params.cv, 0));
    const P1 = fin(params.P1_bara, NaN);
    const P2 = fin(params.P2_bara, NaN);
    const rho = fin(params.rhoLiqKgM3, NaN);
    const FL = fin(params.FL, 0.9);
    const Pv = num(params.pvBara);
    const Pc = num(params.pcBara);
    if (![P1, P2, rho].every(Number.isFinite) || rho <= 0) {
      warnings.push('Invalid inputs: P1, P2 and liquid density must be finite and positive.');
      return { W_kgHr: 0, W_lbHr: 0, Q_m3Hr: 0, choked: false, dPBar: 0, dPSizingBar: 0, dPMaxBar: null, FF: null, FL, warnings, trace };
    }
    const dP = Math.max(0, P1 - P2);
    if (P2 >= P1) warnings.push('Downstream pressure ≥ upstream pressure — no forward flow.');

    let FF = null;
    let dPMax = null;
    let choked = false;
    let dPSizing = dP;
    if (Number.isFinite(Pv) && Pv >= 0) {
      FF = Number.isFinite(Pc) && Pc > 0 ? 0.96 - 0.28 * Math.sqrt(Math.min(1, Pv / Pc)) : 0.96;
      dPMax = FL * FL * (P1 - FF * Pv);
      choked = dP >= dPMax;
      if (choked) dPSizing = Math.max(0, dPMax);
      trace.push(step('Choked-liquid check', 'FF = 0.96 − 0.28·√(Pv/Pc) ;  ΔP_max = FL²·(P₁ − FF·Pv)',
        `FF = ${f(FF, 3)} ;  ΔP_max = ${f(FL, 2)}²·(${f(P1)} − ${f(FF, 3)}·${f(Pv)}) = ${f(dPMax)} bar vs ΔP = ${f(dP)} bar`,
        choked ? `ΔP ≥ ΔP_max → choked (cavitating/flashing), ΔP_sizing = ${f(dPSizing)} bar` : `ΔP < ΔP_max → not choked`));
    } else {
      warnings.push('Vapour pressure not supplied — choked-liquid (ΔP_max) check skipped.');
    }
    const relDensity = rho / RHO_WATER_REF;
    const Q = N1_CV_BAR_M3HR * cv * Math.sqrt(dPSizing / relDensity);
    const W = Q * rho;
    trace.push(step('Liquid flow (IEC 60534-2-1)', 'Q = N₁·Cv·√(ΔP_sizing/(ρ/ρ₀)),  N₁ = 0.865 ;  W = Q·ρ',
      `Q = 0.865·${f(cv, 2)}·√(${f(dPSizing)}/${f(relDensity, 4)}) = ${f(Q, 2)} m³/h ;  W = ${f(Q, 2)}·${f(rho, 1)}`, `W = ${f(W, 1)} kg/h`));
    return { W_kgHr: W, W_lbHr: kgHrToLbHr(W), Q_m3Hr: Q, choked, dPBar: dP, dPSizingBar: dPSizing, dPMaxBar: dPMax, FF, FL, warnings, trace };
  }

  // -------------------------------------------------------------------------
  // 3. RATED-Cv ESTIMATION
  // -------------------------------------------------------------------------
  // Typical fully-open Cv ≈ Cd·d² (d = nominal size in inches). Cd is a typical catalogue
  // magnitude per valve style — confirm with vendor data.
  const TYPICAL_CD = {
    globe_single: 10,
    globe_cage: 10,
    ball_segmented: 25,
    ball_full: 32,
    butterfly: 22,
    eccentric_plug: 15
  };
  const CV_TABLE_SIZES_NPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10, 12];
  const CV_SIZE_TABLE = {};
  for (const type of Object.keys(TYPICAL_CD)) {
    CV_SIZE_TABLE[type] = {};
    for (const d of CV_TABLE_SIZES_NPS) CV_SIZE_TABLE[type][d] = Math.round(TYPICAL_CD[type] * d * d * 10) / 10;
  }

  function estimateControlValveCv(params = {}) {
    const method = params.method || 'size_table';
    const assumptions = [];
    const trace = [];
    const warnings = [];

    if (method === 'size_table') {
      const valveType = Object.prototype.hasOwnProperty.call(TYPICAL_CD, params.valveType) ? params.valveType : 'globe_single';
      if (valveType !== params.valveType) warnings.push(`Unknown valveType '${params.valveType}' — globe_single assumed.`);
      const sizeNps = fin(params.sizeNps, 2);
      const Cd = TYPICAL_CD[valveType];
      const ratedCv = Cd * sizeNps * sizeNps;
      assumptions.push('typical catalogue magnitude — confirm with vendor data');
      assumptions.push(`Cv ≈ Cd·d² with typical Cd = ${Cd} for ${valveType}`);
      trace.push(step('Typical rated Cv from valve size', 'Cv_rated ≈ Cd·d²', `Cv_rated ≈ ${Cd}·${f(sizeNps, 2)}²`, `Cv_rated ≈ ${f(ratedCv, 1)} (typical ${valveType}, NPS ${sizeNps})`));
      return { ratedCv, method, valveType, sizeNps, Cd, assumptions, warnings, trace, table: CV_SIZE_TABLE[valveType] };
    }

    // method 'normal_flow': back-calculate Cv at the normal operating point, then scale to fully open.
    const fluidPhase = params.fluidPhase === 'liquid' ? 'liquid' : 'gas';
    const Wn = fin(params.normalFlowKgHr, NaN);
    const P1 = fin(params.normalInletBara, NaN);
    const P2 = fin(params.normalOutletBara, NaN);
    const opening = fin(params.normalOpeningPct, 60);
    const characteristic = params.characteristic === 'linear' ? 'linear' : 'equal_pct';
    const R = Math.max(1.01, fin(params.rangeability, 50));
    if (!Number.isFinite(Wn) || Wn <= 0 || !Number.isFinite(P1) || !Number.isFinite(P2) || P2 >= P1) {
      warnings.push('normal_flow method needs a positive normal flow and inlet pressure > outlet pressure.');
      return { ratedCv: 0, cvNormal: 0, method, assumptions, warnings, trace };
    }
    const flowAt = (cvTrial) => {
      if (fluidPhase === 'liquid') {
        return calcControlValveFlowLiquid({ cv: cvTrial, P1_bara: P1, P2_bara: P2, rhoLiqKgM3: params.rhoLiq, FL: params.FL, pvBara: params.pvBara, pcBara: params.pcBara }).W_kgHr;
      }
      return calcControlValveFlowGas({ cv: cvTrial, P1_bara: P1, P2_bara: P2, tempC: params.tempC, mw: params.mw, z: params.z, k: params.k, xT: params.xT, valveType: params.valveType }).W_kgHr;
    };
    const wUnit = flowAt(1.0);
    if (!(wUnit > 0)) {
      warnings.push('Forward flow model returned zero — check fluid properties.');
      return { ratedCv: 0, cvNormal: 0, method, assumptions, warnings, trace };
    }
    // Flow is monotonic in Cv; bisection on log-spaced bracket.
    const cvNormal = bisect((cvT) => flowAt(cvT) - Wn, 1e-4, 1e6, 300, 1e-12);
    const fOpen = Math.min(1, Math.max(0.01, opening / 100));
    let ratedCv;
    let scaleSymbolic;
    let scaleSub;
    if (characteristic === 'linear') {
      ratedCv = cvNormal / fOpen;
      scaleSymbolic = 'Cv_rated = Cv_norm/(opening/100)  (linear characteristic)';
      scaleSub = `Cv_rated = ${f(cvNormal, 2)}/${f(fOpen, 3)}`;
    } else {
      ratedCv = cvNormal * Math.pow(R, 1 - fOpen);
      scaleSymbolic = 'Cv_rated = Cv_norm·R^(1 − opening/100)  (equal-percentage, R = rangeability)';
      scaleSub = `Cv_rated = ${f(cvNormal, 2)}·${R}^(1 − ${f(fOpen, 3)})`;
    }
    assumptions.push(`inherent ${characteristic} characteristic assumed with normal opening ${f(opening, 1)} %`);
    if (characteristic === 'equal_pct') assumptions.push(`rangeability R = ${R} (typical 30–50 for globe valves)`);
    assumptions.push('installed characteristic equals inherent characteristic (Fp = 1, no pipe-reducer effect)');
    trace.push(step('Back-calculated Cv at normal operation', `W_normal = W(Cv) by IEC 60534-2-1 ${fluidPhase} equation — inverted by bisection on Cv`,
      `W_normal = ${f(Wn, 1)} kg/h at P₁ = ${f(P1)} bara, P₂ = ${f(P2)} bara`, `Cv_norm = ${f(cvNormal, 2)}`));
    trace.push(step('Scale to fully open', scaleSymbolic, scaleSub, `Cv_rated = ${f(ratedCv, 1)}`));
    return { ratedCv, cvNormal, method, fluidPhase, characteristic, rangeability: R, normalOpeningPct: opening, assumptions, warnings, trace };
  }

  // -------------------------------------------------------------------------
  // 4. GAS BLOW-BY (API 521 — loss of liquid seal, HP → LP via level control valve)
  // -------------------------------------------------------------------------
  function calcGasBlowby(params = {}) {
    const warnings = [];
    const trace = [];
    const levelValveCv = Math.max(0, fin(params.levelValveCv, 0));
    const bypassCv = Math.max(0, fin(params.bypassCv, 0));
    const atm = fin(params.atmPressureBara, 1.01325);
    const hpBarg = fin(params.hpPressBarg, NaN);
    const lpSetBarg = fin(params.lpSetPressureBarg, NaN);
    const credit = Math.max(0, fin(params.normalOutflowCreditKgHr, 0));
    const totalCv = levelValveCv + bypassCv;
    const P1 = hpBarg + atm;
    const P2 = lpSetBarg * 1.10 + atm;

    trace.push(step('Relieving pressures', 'P₁ = P_HP,op + P_atm ;  P₂ = 1.10·P_set,LP + P_atm',
      `P₁ = ${f(hpBarg)} + ${f(atm)} = ${f(P1)} bara ;  P₂ = 1.10·${f(lpSetBarg)} + ${f(atm)} = ${f(P2)} bara`, `Total Cv = ${f(levelValveCv, 1)} + ${f(bypassCv, 1)} = ${f(totalCv, 1)}`));

    let gas = { W_kgHr: 0, choked: false, x: 0, xChoked: 0, Y: 1, Fgamma: NaN, xT: NaN, warnings: [], trace: [] };
    if (!Number.isFinite(P1) || !Number.isFinite(P2)) {
      warnings.push('HP operating pressure and LP set pressure are required.');
    } else if (P2 >= P1) {
      warnings.push('LP relieving pressure ≥ HP operating pressure — gas blow-by cannot pressurise the LP system above its relieving pressure (no relief load).');
    } else {
      gas = calcControlValveFlowGas({ cv: totalCv, P1_bara: P1, P2_bara: P2, tempC: params.gasTempC, mw: params.mw, z: params.z, k: params.k, xT: params.xT, valveType: params.valveType || 'globe_single' });
      warnings.push(...gas.warnings);
      trace.push(...gas.trace);
    }
    const Wgas = gas.W_kgHr;
    const reliefRateKgHr = Math.max(0, Wgas - credit);
    trace.push(step('Relief load', 'W_relief = max(0, W_gas − W_credit)', `W_relief = max(0, ${f(Wgas, 1)} − ${f(credit, 1)})`, `W_relief = ${f(reliefRateKgHr, 1)} kg/h`));
    if (credit > 0) warnings.push('Normal outflow credit applied — only valid if the LP outlet is independent of the initiating failure and cannot be blocked simultaneously.');

    // Optional: time to lose the liquid seal in the HP vessel
    let liquidSeal = null;
    const Vliq = num(params.hpLiquidInventoryM3);
    const Win = num(params.hpLiquidInflowKgHr);
    const rhoL = num(params.rhoLiqKgM3);
    if (Number.isFinite(Vliq) && Number.isFinite(rhoL) && rhoL > 0 && Number.isFinite(P1) && Number.isFinite(P2) && P2 < P1) {
      const WinUse = Number.isFinite(Win) ? Math.max(0, Win) : 0;
      const lpNormalBarg = fin(params.lpNormalPressBarg, lpSetBarg);
      const liq = calcControlValveFlowLiquid({ cv: totalCv, P1_bara: P1, P2_bara: lpNormalBarg + atm, rhoLiqKgM3: rhoL, FL: params.FL, pvBara: params.pvBara, pcBara: params.pcBara });
      const WoutValve = Number.isFinite(num(params.hpLiquidOutflowKgHr)) ? num(params.hpLiquidOutflowKgHr) : liq.W_kgHr;
      const netOut = WoutValve - WinUse;
      const tHr = netOut > 0 ? (rhoL * Vliq) / netOut : Infinity;
      liquidSeal = { valveLiquidCapacityKgHr: liq.W_kgHr, outflowUsedKgHr: WoutValve, inflowKgHr: WinUse, inventoryKg: rhoL * Vliq, timeToLoseSealS: Number.isFinite(tHr) ? tHr * 3600 : null, timeToLoseSealMin: Number.isFinite(tHr) ? tHr * 60 : null };
      trace.push(step('Time to lose liquid seal (optional)', 't = ρ_L·V_liq/(W_out,valve − W_in)',
        `t = ${f(rhoL, 1)}·${f(Vliq, 2)}/(${f(WoutValve, 1)} − ${f(WinUse, 1)}) h`, Number.isFinite(tHr) ? `t = ${f(tHr * 60, 1)} min` : 'W_out ≤ W_in → level does not fall; blow-by only on loss of level by other causes'));
      if (!Number.isFinite(tHr)) warnings.push('Liquid outflow through the open valve does not exceed inflow — seal is not lost by this mechanism alone.');
      else if (tHr * 60 < 5) warnings.push(`Liquid seal lost in ≈ ${f(tHr * 60, 1)} min — insufficient time for operator intervention; do not credit operator response.`);
    }

    return {
      scenarioKey: 'gas_blowby',
      scenarioName: 'Gas Blow-by — HP→LP Level Valve Fail-Open (API 521)',
      allowedOverpressurePct: 10.0,
      sizingPhase: 'gas',
      totalCv, levelValveCv, bypassCv,
      P1_bara: P1, P2_bara: P2, hpPressBarg: hpBarg, lpSetPressureBarg: lpSetBarg, dPBar: P1 - P2,
      gasFlowKgHr: Wgas, choked: gas.choked, x: gas.x, xChoked: gas.xChoked, Y: gas.Y, Fgamma: gas.Fgamma, xT: gas.xT,
      normalOutflowCreditKgHr: credit,
      reliefRateKgHr, reliefRateLbHr: kgHrToLbHr(reliefRateKgHr),
      liquidSeal, warnings, trace
    };
  }

  // -------------------------------------------------------------------------
  // 5. DIERS LEVEL SWELL / TWO-PHASE VENTING SCREEN
  // -------------------------------------------------------------------------
  // Drift-flux constants (DIERS Project Manual, Fisher et al. 1992; Leung 1987 "Simplified
  // vent sizing"): bubble-rise velocity coefficient 1.53 (Wallis / Zuber-Findlay form for the
  // churn-turbulent and bubbly regimes) and distribution parameters C0 = 1.5 (churn-turbulent),
  // C0 = 1.2 (bubbly). Some references use 1.18 for the churn-turbulent coefficient.
  const DIERS_UINF_COEFF = 1.53;
  const DIERS_C0 = { churn: 1.5, bubbly: 1.2 };

  /** Horizontal-cylinder liquid segment: chord width and segment area at height h in a circle of diameter D. */
  function circularSegment(D, h) {
    const R = D / 2;
    const hh = Math.max(0, Math.min(D, h));
    const chord = 2 * Math.sqrt(Math.max(0, R * R - (hh - R) * (hh - R)));
    const theta = 2 * Math.acos(Math.max(-1, Math.min(1, (R - hh) / R)));
    const segArea = 0.5 * R * R * (theta - Math.sin(theta));
    return { chord, segArea };
  }

  function bubblyPsi(a, C0) { return (a * (1 - a) * (1 - a)) / ((1 - a * a * a) * (1 - C0 * a)); }

  function calcSwellEntrainment(params = {}) {
    const warnings = [];
    const trace = [];
    const orientation = params.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const D = fin(params.diameterM, NaN);
    const L = fin(params.lengthM, NaN);
    const hLiq = fin(params.liquidLevelM, NaN);
    const W = Math.max(0, fin(params.vaporRateKgHr, 0));
    const rhoV = fin(params.rhoVapKgM3, NaN);
    const rhoL = fin(params.rhoLiqKgM3, NaN);
    const sigma = fin(params.surfaceTensionNm, 0.015);
    const regime = params.regime === 'bubbly' ? 'bubbly' : 'churn';
    const foamy = params.fluidType === 'foamy';
    const vesselHeight = orientation === 'vertical' ? L : D;
    const nozzleElev = Number.isFinite(num(params.nozzleElevM)) ? num(params.nozzleElevM) : vesselHeight;

    if (![D, L, hLiq, rhoV, rhoL].every(Number.isFinite) || D <= 0 || L <= 0 || rhoV <= 0 || rhoL <= rhoV) {
      warnings.push('Invalid geometry or densities (need D, L > 0, ρ_L > ρ_V > 0).');
      return { scenarioKey: 'swell_screen', warnings, trace, twoPhaseVentingLikely: false };
    }
    const hL = Math.max(0, Math.min(vesselHeight, hLiq));
    if (hL !== hLiq) warnings.push('Liquid level clipped to the vessel height.');

    // Flow area for vapour and vessel/liquid volumes
    let areaM2;
    let vVessel;
    let vLiq;
    if (orientation === 'vertical') {
      areaM2 = (Math.PI / 4) * D * D;
      vVessel = areaM2 * L;
      vLiq = areaM2 * hL;
      trace.push(step('Vapour flow area (vertical vessel)', 'A = π·D²/4', `A = π·${f(D)}²/4`, `A = ${f(areaM2, 4)} m²`));
    } else {
      const seg = circularSegment(D, hL);
      areaM2 = seg.chord * L;
      vVessel = (Math.PI / 4) * D * D * L;
      vLiq = seg.segArea * L;
      trace.push(step('Vapour flow area (horizontal vessel, free surface)', 'c = 2·√(R² − (h − R)²) ;  A = c·L_TT',
        `c = 2·√(${f(D / 2)}² − (${f(hL)} − ${f(D / 2)})²) = ${f(seg.chord)} m ;  A = ${f(seg.chord)}·${f(L)}`, `A = ${f(areaM2, 4)} m²`));
      if (areaM2 <= 0) warnings.push('Free-surface chord is zero (empty or liquid-full) — swell not meaningful.');
    }
    const alpha0 = vVessel > 0 ? Math.max(0, 1 - vLiq / vVessel) : 0;

    const jg = areaM2 > 0 ? W / 3600 / (rhoV * areaM2) : Infinity;
    const Uinf = DIERS_UINF_COEFF * Math.pow((sigma * G_ACCEL * (rhoL - rhoV)) / (rhoL * rhoL), 0.25);
    const psi = Uinf > 0 ? jg / Uinf : Infinity;
    const C0 = DIERS_C0[regime];

    trace.push(step('Superficial vapour velocity', 'j_g = W/(ρ_V·A)', `j_g = (${f(W, 1)}/3600)/(${f(rhoV, 3)}·${f(areaM2, 4)})`, `j_g = ${f(jg, 4)} m/s`));
    trace.push(step('Bubble-rise velocity (DIERS)', 'U∞ = 1.53·[σ·g·(ρ_L − ρ_V)/ρ_L²]^0.25',
      `U∞ = 1.53·[${f(sigma, 4)}·9.80665·(${f(rhoL, 1)} − ${f(rhoV, 3)})/${f(rhoL, 1)}²]^0.25`, `U∞ = ${f(Uinf, 4)} m/s`));
    trace.push(step('Dimensionless superficial velocity', 'ψ = j_g/U∞', `ψ = ${f(jg, 4)}/${f(Uinf, 4)}`, `ψ = ${f(psi, 4)}`));

    // Vessel-average void fraction
    let alphaBar;
    if (!Number.isFinite(psi)) {
      alphaBar = 1 / C0 - 1e-9;
    } else if (regime === 'churn') {
      alphaBar = psi / (2 + C0 * psi);
      trace.push(step('Average void fraction (churn-turbulent, C₀ = 1.5)', 'ψ = 2·ᾱ/(1 − C₀·ᾱ)  →  ᾱ = ψ/(2 + C₀·ψ)', `ᾱ = ${f(psi, 4)}/(2 + 1.5·${f(psi, 4)})`, `ᾱ = ${f(alphaBar, 4)}`));
    } else {
      const aMax = 1 / C0 - 1e-9;
      alphaBar = psi <= 0 ? 0 : (bubblyPsi(aMax, C0) <= psi ? aMax : bisect((a) => bubblyPsi(a, C0) - psi, 0, aMax, 200, 1e-14));
      trace.push(step('Average void fraction (bubbly, C₀ = 1.2)', 'ψ = ᾱ·(1 − ᾱ)²/[(1 − ᾱ³)·(1 − C₀·ᾱ)]  (solved by bisection)', `ψ = ${f(psi, 4)}`, `ᾱ = ${f(alphaBar, 4)}`));
    }

    const hSwellUncapped = alphaBar < 1 ? hL / (1 - alphaBar) : Infinity;
    const hSwellM = Math.min(vesselHeight, hSwellUncapped);
    const reachesNozzle = hSwellUncapped >= nozzleElev - 1e-12;
    const voidBasis = alphaBar >= alpha0 - 1e-12;
    const twoPhaseVentingLikely = foamy || voidBasis;
    trace.push(step('Swelled liquid height', 'H_swell = H_liq/(1 − ᾱ)  (capped at vessel height)', `H_swell = ${f(hL)}/(1 − ${f(alphaBar, 4)}) = ${f(hSwellUncapped)} m`, `H_swell = ${f(hSwellM)} m vs nozzle at ${f(nozzleElev)} m`));
    trace.push(step('Two-phase venting criterion', 'α₀ = 1 − V_liq/V_vessel ;  two-phase if ᾱ ≥ α₀ (swell reaches nozzle) or fluid is foamy',
      `α₀ = 1 − ${f(vLiq, 3)}/${f(vVessel, 3)} = ${f(alpha0, 4)} ;  ᾱ = ${f(alphaBar, 4)}${foamy ? ' ; foamy fluid' : ''}`,
      twoPhaseVentingLikely ? 'TWO-PHASE venting likely' : 'Vapour-only venting (disengagement) expected'));

    let ventQualityEstimate = null;
    if (twoPhaseVentingLikely) {
      ventQualityEstimate = (alpha0 * rhoV) / (alpha0 * rhoV + (1 - alpha0) * rhoL);
      trace.push(step('Inlet quality for two-phase sizing (homogeneous vessel basis)', 'x₀ ≈ α₀·ρ_V/(α₀·ρ_V + (1 − α₀)·ρ_L)',
        `x₀ ≈ ${f(alpha0, 4)}·${f(rhoV, 3)}/(${f(alpha0, 4)}·${f(rhoV, 3)} + ${f(1 - alpha0, 4)}·${f(rhoL, 1)})`, `x₀ ≈ ${ventQualityEstimate.toExponential(3)}`));
    }
    if (foamy) warnings.push('Foamy / viscous fluid: homogeneous two-phase venting assumed regardless of swell calculation (DIERS guidance).');
    if (twoPhaseVentingLikely && !foamy) warnings.push('Swelled level reaches the relief nozzle — size the device for two-phase flow (API 520 Annex C omega method).');
    if (hL >= 0.9 * vesselHeight) warnings.push('Initial liquid level is above 90 % of vessel height — very little disengagement volume.');

    return {
      scenarioKey: 'swell_screen',
      scenarioName: 'DIERS Level Swell / Two-Phase Venting Screen',
      orientation, regime, fluidType: foamy ? 'foamy' : 'nonfoamy',
      areaM2, vesselVolumeM3: vVessel, liquidVolumeM3: vLiq,
      jg, Uinf, psi, C0, alphaBar, alpha0,
      hLiqM: hL, hSwellM, hSwellUncappedM: hSwellUncapped, nozzleElevM: nozzleElev,
      reachesNozzle, twoPhaseVentingLikely, ventQualityEstimate,
      warnings, trace
    };
  }

  // -------------------------------------------------------------------------
  // 6. DISTILLATION COLUMN — UNBALANCED HEAT
  // -------------------------------------------------------------------------
  function calcColumnUnbalancedHeat(params = {}) {
    const warnings = [];
    const trace = [];
    const upset = ['loss_reflux', 'loss_cooling', 'power_failure', 'reboiler_control_fail', 'feed_preheat_fail_high'].includes(params.upset) ? params.upset : 'loss_cooling';
    const Qreb = Math.max(0, fin(params.reboilerDutyKw, 0));
    const Qcond = Math.max(0, fin(params.condenserDutyKw, 0));
    const Qpa = Math.max(0, fin(params.pumparoundDutyKw, 0));
    const Qfp = Math.max(0, fin(params.feedPreheatDutyKw, 0));
    const Qpc = Math.max(0, fin(params.productCoolerDutyKw, 0));
    const reflux = Math.max(0, fin(params.refluxRateKgHr, 0));
    const netOvhd = Math.max(0, fin(params.netOverheadKgHr, 0));
    const lambda = fin(params.topLatentHeatKjKg, NaN);
    const surge = Math.max(1.0, fin(params.reboilerSurgeFactor, 1.0));
    const pumparoundOnCW = params.pumparoundOnCoolingWater === true;
    const feedPreheatMaxKw = Number.isFinite(num(params.feedPreheatMaxDutyKw)) ? Math.max(0, num(params.feedPreheatMaxDutyKw)) : Qfp * surge;

    if (!Number.isFinite(lambda) || lambda <= 0) warnings.push('Overhead latent heat at relieving pressure is required (kJ/kg).');

    // Reboiler pinch credit
    let pinchRatio = 1.0;
    const Tm = num(params.heatingMediumTempC);
    const TbN = num(params.normalBottomTempC);
    const TbR = num(params.relievingBottomTempC);
    if (params.reboilerPinchCredit === true) {
      if ([Tm, TbN, TbR].every(Number.isFinite) && Tm - TbN > 0) {
        pinchRatio = Math.max(0, (Tm - TbR) / (Tm - TbN));
        trace.push(step('Reboiler pinch credit', 'Q_reb,relief = Q_reb,normal·(T_medium − T_bottom,relief)/(T_medium − T_bottom,normal)',
          `ratio = (${f(Tm, 1)} − ${f(TbR, 1)})/(${f(Tm, 1)} − ${f(TbN, 1)})`, `ratio = ${f(pinchRatio, 4)}`));
        if (pinchRatio < 0.5) warnings.push('Pinch credit reduces reboiler duty by more than 50 % — confirm with rigorous relieving-condition simulation.');
      } else {
        warnings.push('Reboiler pinch credit requested but heating-medium / bottom temperatures are incomplete — no credit taken.');
      }
    }

    // Duties IN and OUT at relieving conditions, per upset
    let QrebRel = Qreb * pinchRatio;
    let QfpRel = Qfp;
    let QcondRel = Qcond;
    let QpaRel = Qpa;
    let QpcRel = Qpc;
    let vapourBasisApplies = false;
    let description = '';
    switch (upset) {
      case 'loss_cooling':
        QcondRel = 0;
        if (pumparoundOnCW) QpaRel = 0;
        description = 'Loss of condenser cooling: condenser duty → 0; reboiler and feed preheat continue.';
        break;
      case 'loss_reflux':
        QcondRel = 0; // once the accumulator floods, no net condensing credit remains
        vapourBasisApplies = true;
        description = 'Reflux failure: reflux not returned; accumulator floods the condenser, so net condensing is lost. Classic basis = total overhead vapour (reflux + net overhead).';
        break;
      case 'power_failure':
        QcondRel = 0; QpaRel = 0; QpcRel = 0;
        vapourBasisApplies = true;
        description = 'Power failure: condenser (fans / CW pumps), pumparound and reflux pumps lost; steam/hot-oil reboiler continues.';
        break;
      case 'reboiler_control_fail':
        QrebRel = Qreb * surge * pinchRatio;
        description = `Reboiler control failure: reboiler duty × surge factor ${f(surge, 2)}; condenser retained.`;
        break;
      case 'feed_preheat_fail_high':
        QfpRel = feedPreheatMaxKw;
        description = 'Feed preheater control failure to maximum duty; condenser retained.';
        break;
      default:
        break;
    }
    const sumIn = QrebRel + QfpRel;
    const sumOut = QcondRel + QpaRel + QpcRel;
    const Qunbalanced = Math.max(0, sumIn - sumOut);
    const Wheat = Number.isFinite(lambda) && lambda > 0 ? (3600 * Qunbalanced) / lambda : 0;
    const Wvapour = vapourBasisApplies ? reflux + netOvhd : 0;

    trace.push(step('Upset definition', upset, description, `Σ Q_in = ${f(QrebRel, 1)} (reboiler) + ${f(QfpRel, 1)} (feed preheat) kW ;  Σ Q_out = ${f(QcondRel, 1)} (condenser) + ${f(QpaRel, 1)} (pumparound) + ${f(QpcRel, 1)} (product cooler) kW`));
    trace.push(step('Unbalanced heat', 'Q_unbalanced = Σ Q_in,relief − Σ Q_out,relief', `Q = ${f(sumIn, 1)} − ${f(sumOut, 1)}`, `Q_unbalanced = ${f(Qunbalanced, 1)} kW`));
    trace.push(step('Heat-balance relief rate', 'W_heat = 3600·Q_unbalanced/λ_top', `W_heat = 3600·${f(Qunbalanced, 1)}/${f(lambda, 1)}`, `W_heat = ${f(Wheat, 1)} kg/h`));
    if (vapourBasisApplies) {
      trace.push(step('Total overhead vapour basis (API 521 reflux failure)', 'W_vapour = W_reflux + W_net overhead', `W_vapour = ${f(reflux, 1)} + ${f(netOvhd, 1)}`, `W_vapour = ${f(Wvapour, 1)} kg/h`));
      if (Wvapour <= 0) warnings.push('Reflux and net overhead rates not supplied — vapour basis is zero; only the heat-balance basis is available.');
    }
    const bases = [{ key: 'heat_balance', label: 'Unbalanced heat ÷ latent heat', reliefRateKgHr: Wheat }];
    if (vapourBasisApplies) bases.push({ key: 'overhead_vapour', label: 'Total overhead vapour (reflux + net overhead)', reliefRateKgHr: Wvapour });
    const governing = bases.reduce((a, b) => (b.reliefRateKgHr > a.reliefRateKgHr ? b : a), bases[0]);
    const reliefRateKgHr = governing.reliefRateKgHr;
    trace.push(step('Governing relief rate', 'W_relief = max(applicable bases)', bases.map((b) => `${b.label}: ${f(b.reliefRateKgHr, 1)} kg/h`).join(' ; '), `W_relief = ${f(reliefRateKgHr, 1)} kg/h (${governing.label})`));
    if (upset === 'loss_cooling' && Qpa > 0 && !pumparoundOnCW) warnings.push('Pumparound heat removal retained — set pumparoundOnCoolingWater = true if the pumparound cooler shares the failed cooling medium.');
    warnings.push('Latent heat and composition of the overhead shift at relieving pressure; use λ at relieving conditions (heavier overhead typically lowers W).');

    return {
      scenarioKey: 'column_unbalanced',
      scenarioName: 'Distillation Column — Unbalanced Heat (Reflux / Cooling / Power Failure)',
      allowedOverpressurePct: 10.0,
      sizingPhase: 'gas',
      upset, description,
      dutiesKw: { reboilerNormal: Qreb, reboilerRelief: QrebRel, feedPreheatRelief: QfpRel, condenserRelief: QcondRel, pumparoundRelief: QpaRel, productCoolerRelief: QpcRel, sumIn, sumOut },
      pinchRatio, reboilerSurgeFactor: surge, QunbalancedKw: Qunbalanced, topLatentHeatKjKg: lambda,
      W_heatKgHr: Wheat, W_vapourKgHr: Wvapour, vapourBasisApplies, bases, governingBasis: governing.key,
      reliefRateKgHr, reliefRateLbHr: kgHrToLbHr(reliefRateKgHr),
      warnings, trace
    };
  }

  // -------------------------------------------------------------------------
  // 7. API 520 PART I ANNEX C — SUBCOOLED-LIQUID OMEGA METHOD + OMEGA HELPERS
  // -------------------------------------------------------------------------
  /**
   * Transcendental equation for the critical pressure ratio of a subcooled (low-subcooling)
   * inlet, API 520 Pt I Annex C (Leung form):
   *   [(ω_s + 1/ω_s − 2)/(2η_s)]·η_c² − 2(ω_s − 1)·η_c + ω_s·η_s·ln(η_c/η_s) + 1.5·ω_s·η_s − 1 = 0
   * (reduces to the saturated-inlet equation at η_s = 1 and gives η_c = η_s at η_s = η_st).
   */
  function solveSubcooledEtaC(omegaS, etaS) {
    const fn = (eta) => ((omegaS + 1 / omegaS - 2) / (2 * etaS)) * eta * eta - 2 * (omegaS - 1) * eta + omegaS * etaS * Math.log(eta / etaS) + 1.5 * omegaS * etaS - 1;
    // fn(η→0⁺) → −∞ (log term); fn(η_s) = η_s(1 + 2ω)/(2ω) − 1 ≥ 0 when η_s ≥ η_st.
    return bisect(fn, 1e-9, etaS, 300, 1e-14);
  }

  function calcSubcooledOmegaSizing(params = {}) {
    const warnings = [];
    const trace = [];
    const W = fin(params.flowRateKgHr, NaN);
    const P0 = fin(params.P0_bara, NaN);
    const Ps = fin(params.Ps_bara, NaN);
    const rhoL = fin(params.rhoLiq0KgM3, NaN);
    const omegaS = fin(params.omegaS, NaN);
    const Pb = fin(params.backPressureBara, 1.01325);
    const Kb = fin(params.Kb, 1);
    const Kc = fin(params.Kc, 1);
    const Kv = fin(params.Kv, 1);

    if (![W, P0, Ps, rhoL, omegaS].every(Number.isFinite) || P0 <= 0 || rhoL <= 0 || omegaS <= 0) {
      warnings.push('Inputs required: flow, P0 (bara), Ps (bara), liquid density and saturated ω_s (all positive).');
      return { scenarioKey: 'subcooled_omega', warnings, trace, areaMm2: 0, areaIn2: 0 };
    }
    if (Ps > P0) warnings.push('Ps > P0: inlet is already two-phase — use the saturated/two-phase omega method (engine.js case 4) instead. Ps clipped to P0.');
    const PsUse = Math.min(Ps, P0);
    const etaS = PsUse / P0;
    const etaB = Math.max(0, Math.min(1, Pb / P0));
    const etaSt = (2 * omegaS) / (1 + 2 * omegaS);
    const P0Pa = P0 * 1e5;
    const PsPa = PsUse * 1e5;
    const PbPa = Pb * 1e5;

    trace.push(step('Subcooling classification (API 520 Pt I Annex C)', 'η_st = 2ω_s/(1 + 2ω_s) ;  η_s = P_s/P₀ ;  η_b = P_b/P₀',
      `η_st = 2·${f(omegaS, 3)}/(1 + 2·${f(omegaS, 3)}) = ${f(etaSt, 4)} ;  η_s = ${f(PsUse)}/${f(P0)} = ${f(etaS, 4)} ;  η_b = ${f(etaB, 4)}`,
      etaS >= etaSt ? 'η_s ≥ η_st → LOW subcooling (flashing upstream of the throat)' : 'η_s < η_st → HIGH subcooling (flashing at/after the throat)'));

    let region;
    let etaC = null;
    let etaUsed;
    let G;
    let KdDefault;
    let choked = false;
    if (etaS >= etaSt) {
      region = 'low_subcooling';
      KdDefault = 0.85;
      etaC = solveSubcooledEtaC(omegaS, etaS);
      choked = etaB <= etaC;
      etaUsed = Math.max(etaC, etaB);
      trace.push(step('Critical pressure ratio (subcooled, Annex C transcendental equation)',
        '[(ω_s + 1/ω_s − 2)/(2η_s)]·η_c² − 2(ω_s − 1)·η_c + ω_s·η_s·ln(η_c/η_s) + 1.5·ω_s·η_s − 1 = 0',
        `solved by bisection for ω_s = ${f(omegaS, 3)}, η_s = ${f(etaS, 4)}`, `η_c = ${f(etaC, 4)} ;  η_used = max(η_c, η_b) = ${f(etaUsed, 4)} (${choked ? 'critical' : 'sub-critical'})`));
      if (etaB >= etaS) {
        // Back pressure above saturation pressure: fluid stays liquid through the throat
        G = Math.sqrt(2 * rhoL * Math.max(0, P0Pa - PbPa));
        region = 'low_subcooling_no_flash';
        KdDefault = 0.65;
        warnings.push('Back pressure ≥ saturation pressure: no flashing through the valve — treated as all-liquid flow with ΔP = P0 − Pb.');
        trace.push(step('Mass flux (all liquid, P_b ≥ P_s)', 'G = √(2·ρ_l0·(P₀ − P_b))', `G = √(2·${f(rhoL, 1)}·(${f(P0Pa, 0)} − ${f(PbPa, 0)}))`, `G = ${f(G, 1)} kg/(m²·s)`));
      } else {
        const eta = etaUsed;
        const numTerm = 2 * (1 - etaS) + 2 * (omegaS * etaS * Math.log(etaS / eta) - (omegaS - 1) * (etaS - eta));
        const den = omegaS * (etaS / eta - 1) + 1;
        G = (Math.sqrt(Math.max(0, numTerm)) * Math.sqrt(P0Pa * rhoL)) / den;
        trace.push(step('Mass flux (low subcooling, Annex C)',
          'G = √{2(1 − η_s) + 2[ω_s·η_s·ln(η_s/η) − (ω_s − 1)(η_s − η)]}·√(P₀·ρ_l0) / [ω_s(η_s/η − 1) + 1]',
          `G = √{2(1 − ${f(etaS, 4)}) + 2[${f(omegaS, 3)}·${f(etaS, 4)}·ln(${f(etaS, 4)}/${f(eta, 4)}) − (${f(omegaS, 3)} − 1)(${f(etaS, 4)} − ${f(eta, 4)})]}·√(${f(P0Pa, 0)}·${f(rhoL, 1)}) / ${f(den, 4)}`,
          `G = ${f(G, 1)} kg/(m²·s)`));
      }
    } else {
      region = 'high_subcooling';
      KdDefault = 0.65;
      // Throat pressure = greater of Ps and Pb (flashing at the throat if Pb ≤ Ps, otherwise all liquid)
      const PtPa = Math.max(PsPa, PbPa);
      etaUsed = PtPa / P0Pa;
      choked = PbPa <= PsPa;
      G = Math.sqrt(2 * rhoL * Math.max(0, P0Pa - PtPa));
      trace.push(step('Mass flux (high subcooling, Annex C)', 'G = 1.414·√(ρ_l0·(P₀ − P_t)),  P_t = max(P_s, P_b)',
        `G = 1.414·√(${f(rhoL, 1)}·(${f(P0Pa, 0)} − ${f(PtPa, 0)}))`, `G = ${f(G, 1)} kg/(m²·s) (${choked ? 'flashing at the throat, P_t = P_s' : 'all liquid, P_t = P_b'})`));
    }

    const Kd = Number.isFinite(num(params.Kd)) ? num(params.Kd) : KdDefault;
    const denom = 3600 * G * Kd * Kb * Kc * Kv;
    const areaM2 = denom > 0 ? W / denom : Infinity;
    const areaMm2 = areaM2 * 1e6;
    const areaIn2 = areaMm2 / MM2_PER_IN2;
    trace.push(step('Required area', 'A = W/(3600·G·Kd·Kb·Kc·Kv)', `A = ${f(W, 1)}/(3600·${f(G, 1)}·${f(Kd, 3)}·${f(Kb, 3)}·${f(Kc, 2)}·${f(Kv, 3)})`, `A = ${f(areaMm2, 1)} mm² (${f(areaIn2, 4)} in²)`));
    if (!Number.isFinite(areaM2)) warnings.push('Mass flux is zero (no driving pressure) — area undefined.');
    if (!Number.isFinite(num(params.Kd))) warnings.push(`Kd defaulted to ${KdDefault} (${region.startsWith('high') || region.endsWith('no_flash') ? 'liquid-like' : 'flashing'}) per Annex C guidance; use the certified value for the selected valve.`);

    const base = baseEngine();
    const selectedOrifice = base && typeof base.selectApi526Orifice === 'function' && Number.isFinite(areaMm2) ? base.selectApi526Orifice(areaMm2) : null;

    return {
      scenarioKey: 'subcooled_omega',
      scenarioName: 'Subcooled Liquid Inlet — Omega Method (API 520 Pt I Annex C)',
      region, etaSt, etaS, etaB, etaC, etaUsed, choked, G_kgM2s: G, Kd, Kb, Kc, Kv,
      P0_bara: P0, Ps_bara: PsUse, backPressureBara: Pb, rhoLiq0KgM3: rhoL, omegaS, flowRateKgHr: W,
      areaMm2, areaIn2, selectedOrifice, warnings, trace
    };
  }

  /**
   * Omega parameter for a saturated / flashing two-phase inlet (API 520 Pt I Annex C eq. C.1 form):
   *   ω = α₀/k + ρ₀·Cp·T₀·P₀·((v_g0 − v_l0)/h_fg)²   with v₀ = x₀·v_g0 + (1 − x₀)·v_l0, α₀ = x₀·v_g0/v₀
   * SI: P₀ in Pa, Cp in J/(kg·K), h_fg in J/kg.
   */
  function calcOmegaSaturated(params = {}) {
    const warnings = [];
    const trace = [];
    const x0 = Math.max(0, Math.min(1, fin(params.x0, 0)));
    const vl = fin(params.vLiq0M3Kg, NaN);
    const vg = fin(params.vVap0M3Kg, NaN);
    const cp = fin(params.cpLiqKjKgK, NaN) * 1000;
    const T0 = fin(params.T0_C, NaN) + 273.15;
    const P0 = fin(params.P0_bara, NaN) * 1e5;
    const hfg = fin(params.hfgKjKg, NaN) * 1000;
    const k = Math.max(1e-6, fin(params.k, 1.0));
    if (![vl, vg, cp, T0, P0, hfg].every(Number.isFinite) || vl <= 0 || vg <= vl || hfg <= 0 || T0 <= 0) {
      warnings.push('Inputs required: v_l0 < v_g0, Cp, T0, P0, h_fg (positive).');
      return { omega: NaN, warnings, trace };
    }
    const v0 = x0 * vg + (1 - x0) * vl;
    const rho0 = 1 / v0;
    const alpha0 = (x0 * vg) / v0;
    const termFlash = rho0 * cp * T0 * P0 * Math.pow((vg - vl) / hfg, 2);
    const omega = alpha0 / k + termFlash;
    trace.push(step('Inlet specific volume and void fraction', 'v₀ = x₀·v_g0 + (1 − x₀)·v_l0 ;  α₀ = x₀·v_g0/v₀', `v₀ = ${f(x0, 4)}·${vg} + ${f(1 - x0, 4)}·${vl} = ${v0.toExponential(4)} m³/kg`, `α₀ = ${f(alpha0, 4)}, ρ₀ = ${f(rho0, 2)} kg/m³`));
    trace.push(step('Omega parameter (API 520 Annex C eq. C.1)', 'ω = α₀/k + ρ₀·Cp·T₀·P₀·((v_g0 − v_l0)/h_fg)²',
      `ω = ${f(alpha0, 4)}/${f(k, 2)} + ${f(rho0, 2)}·${f(cp, 0)}·${f(T0, 2)}·${f(P0, 0)}·((${vg} − ${vl})/${f(hfg, 0)})²`, `ω = ${f(omega, 4)} (flashing term ${f(termFlash, 4)})`));
    return { omega, alpha0, v0, rho0, flashingTerm: termFlash, warnings, trace };
  }

  /** Two-point omega (API 520 Annex C): ω = 9·(v₉/v₀ − 1) with v₉ at 90 % of P₀ after isentropic flash. */
  function calcOmegaTwoPoint(params = {}) {
    const warnings = [];
    const trace = [];
    const v0 = fin(params.v0, NaN);
    const v9 = fin(params.v9, NaN);
    if (!(v0 > 0) || !(v9 > 0)) {
      warnings.push('v0 and v9 must be positive specific volumes (m³/kg).');
      return { omega: NaN, warnings, trace };
    }
    const omega = 9 * (v9 / v0 - 1);
    if (omega < 0) warnings.push('v9 < v0 gives negative ω — check the flash calculation.');
    trace.push(step('Two-point omega', 'ω = 9·(v₉/v₀ − 1)', `ω = 9·(${v9}/${v0} − 1)`, `ω = ${f(omega, 4)}`));
    return { omega, warnings, trace };
  }

  return {
    API521_CAUSES,
    LINKED_SCENARIO_KEYS,
    checklistSummary,
    TYPICAL_XT,
    TYPICAL_CD,
    CV_SIZE_TABLE,
    DIERS_C0,
    DIERS_UINF_COEFF,
    calcControlValveFlowGas,
    calcControlValveFlowLiquid,
    estimateControlValveCv,
    calcGasBlowby,
    calcSwellEntrainment,
    circularSegment,
    calcColumnUnbalancedHeat,
    calcSubcooledOmegaSizing,
    solveSubcooledEtaC,
    calcOmegaSaturated,
    calcOmegaTwoPoint
  };
})();

// Expose globally for the browser (top-level const is not a window property) and for Node tests
if (typeof window !== 'undefined') {
  window.PSVEngineExt = PSVEngineExt;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PSVEngineExt;
}
