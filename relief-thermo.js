/**
 * PSVCalc Pro — Rigorous thermodynamic relief methods (Peng-Robinson based).
 *
 *  - calcHdiMassFlux        API 520 Part I Annex C "direct integration" (HDI / HEM): isentropic expansion path
 *                           from stagnation, G(P) = √(2·(h0 − h(P))) / v(P), critical mass flux = max G.
 *  - requiredAreaMm2FromG   A = W / (Kd·Kb·Kc·Kv·G).
 *  - calcOmegaTwoPointEos   Two-point omega: ω = 9·(v9/v0 − 1) with v9 from an isentropic flash to 0.9·P0.
 *  - calcOmegaSaturatedEos  Saturated omega (API 520 Pt I Annex C Eq. C.1 form, Leung 1986):
 *                           ω = α0/k + ρ0·Cp,l0·T0·P0·(v_g0 − v_l0)²/h_fg0².
 *  - calcSupercriticalFire  Fire exposure of a supercritical / dense single-phase fluid at constant relieving
 *                           pressure: W = Q·β_T/Cp with β_T = (1/v)(∂v/∂T)_P from the EOS, stepped in T, each step
 *                           sized with the API 520 Pt I critical-flow gas equation (SI form); governing = max area.
 *
 * All inputs SI: bara, °C, kg/h, kW. Pure functions, no DOM. Every result: {ok, warnings:[], trace:[{title,
 * symbolic, substitution, result}]} with plain-text (unicode) strings.
 *
 * `fluid` is the same object tools/fluid-props.js calc() accepts:
 *   {comps:{C1:0.9,...}, kijMode, kijScale, kijOverrides, pseudo}   (temperatureC / pressureBara are overridden here;
 *   for PURE components an optional `quality` = vapour mass fraction selects a saturated two-phase stagnation state).
 */
(function () {
  'use strict';
  const R = 8.314462618;

  function getFP() {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('./tools/fluid-props.js'); } catch (e) { /* fall through */ }
    }
    if (typeof window !== 'undefined' && window.PSVTools) {
      if (typeof window.PSVTools.get === 'function') { const t = window.PSVTools.get('fluid-props'); if (t) return t; }
      if (Array.isArray(window.PSVTools.tools)) { const t = window.PSVTools.tools.find(x => x && x.id === 'fluid-props'); if (t) return t; }
    }
    return null;
  }
  function fpOrError() {
    const FP = getFP();
    if (!FP || typeof FP.thermoTP !== 'function' || typeof FP.flashPS !== 'function') {
      return { FP: null, err: { ok: false, error: 'fluid-props tool (with thermoTP/flashPS) is not available — load tools/registry.js and tools/fluid-props.js first.', warnings: [], trace: [] } };
    }
    return { FP, err: null };
  }

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const f = (v, d = 3) => (Number.isFinite(v) ? Number(v).toFixed(d) : 'n/a');
  const g = (v, d = 4) => (Number.isFinite(v) ? Number(v).toPrecision(d) : 'n/a');
  const step = (title, symbolic, substitution, result) => ({ title, symbolic, substitution, result });
  const fluidAt = (fluid, pBar, tC, extra) => {
    const o = Object.assign({}, fluid || {}, { pressureBara: pBar, temperatureC: tC });
    delete o.quality;
    return Object.assign(o, extra || {});
  };
  const compStr = (fluid) => Object.keys((fluid && fluid.comps) || {}).filter(k => Number(fluid.comps[k]) > 0)
    .map(k => `${k}:${Number(fluid.comps[k])}`).join(' ');

  // ---------------------------------------------------------------------------
  // 1) HDI / direct integration (API 520 Pt I Annex C, homogeneous equilibrium)
  // ---------------------------------------------------------------------------
  function calcHdiMassFlux(args) {
    args = args || {};
    const { FP, err } = fpOrError(); if (err) return err;
    const fluid = args.fluid || {};
    const P0 = num(args.P0_bara, NaN), T0 = num(args.T0_C, NaN);
    const Pb = Math.max(0.05, num(args.backPressureBara, 1.01325));
    const nSteps = Math.max(10, Math.min(400, Math.round(num(args.nSteps, 60))));
    const warnings = [], trace = [];
    if (!(P0 > 0) || !Number.isFinite(T0)) return { ok: false, error: 'P0_bara and T0_C are required.', warnings, trace };
    if (!(Pb < P0)) return { ok: false, error: `Back pressure ${Pb} bara must be below stagnation pressure ${P0} bara.`, warnings, trace };

    const stagIn = Object.assign({}, fluid, { pressureBara: P0, temperatureC: T0 });
    const st0 = FP.thermoTP(stagIn);
    if (!st0.ok) return { ok: false, error: 'Stagnation flash failed: ' + st0.error, warnings, trace };
    warnings.push(...(st0.warnings || []));
    const h0 = st0.mix.hMass, s0 = st0.mix.sMass, v0 = st0.mix.v;

    const evalG = (P) => {
      const fs = FP.flashPS(fluidAt(fluid, P, T0), s0, { tMinC: -200, tMaxC: Math.max(T0 + 50, 300) });
      if (!fs.ok) return null;
      const h = fs.mix.hMass, v = fs.mix.v;
      const dh = h0 - h;
      const G = dh > 0 && v > 0 ? Math.sqrt(2 * dh) / v : 0;
      return { P_bara: P, T_C: fs.tC, beta: fs.betaMass, betaMol: fs.beta, phase: fs.phase, v, h, s: fs.mix.sMass, rho: 1 / v, G, converged: fs.converged };
    };

    const points = [];
    let unconverged = 0;
    for (let i = 0; i <= nSteps; i++) {
      const P = P0 - (P0 - Pb) * i / nSteps;
      const pt = evalG(P);
      if (!pt) { warnings.push(`Isentropic flash failed at P = ${f(P, 3)} bara — point skipped.`); continue; }
      if (!pt.converged) unconverged++;
      points.push(pt);
    }
    if (points.length < 3) return { ok: false, error: 'Too few converged isentropic points.', warnings, trace };
    if (unconverged) warnings.push(`${unconverged} isentropic flash point(s) did not fully converge (near-critical?) — G profile approximate.`);

    let iMax = 0;
    points.forEach((p, i) => { if (p.G > points[iMax].G) iMax = i; });
    let best = points[iMax];
    const interior = iMax > 0 && iMax < points.length - 1;
    if (interior) {
      // golden-section refinement of the maximum between the neighbouring grid points
      let a = points[iMax + 1].P_bara, b = points[iMax - 1].P_bara; // a < b (P decreasing with index)
      const gr = (Math.sqrt(5) - 1) / 2;
      let x1 = b - gr * (b - a), x2 = a + gr * (b - a);
      let f1 = evalG(x1), f2 = evalG(x2);
      for (let k = 0; k < 18 && f1 && f2; k++) {
        if (f1.G > f2.G) { b = x2; x2 = x1; f2 = f1; x1 = b - gr * (b - a); f1 = evalG(x1); }
        else { a = x1; x1 = x2; f1 = f2; x2 = a + gr * (b - a); f2 = evalG(x2); }
      }
      [f1, f2].forEach(p => { if (p && p.G > best.G) best = p; });
    }
    const choked = interior;
    const G = best.G, Pt = best.P_bara;
    const phase0 = st0.phase;

    trace.push(step('1. Stagnation state (P0, T0) — PR EOS flash',
      'h0 = h(P0, T0),  s0 = s(P0, T0),  v0 = 1/ρ0',
      `P0 = ${f(P0, 3)} bara, T0 = ${f(T0, 2)} °C, composition ${compStr(fluid)}${Number.isFinite(fluid.quality) ? `, quality x0 = ${fluid.quality}` : ''} → phase: ${phase0}` +
      (phase0 === 'two-phase' ? `, vapour mass fraction x0 = ${f(st0.betaMass, 4)}` : ''),
      `h0 = ${f(h0 / 1e3, 3)} kJ/kg, s0 = ${f(s0 / 1e3, 5)} kJ/(kg·K), v0 = ${g(v0, 5)} m³/kg (ρ0 = ${f(1 / v0, 2)} kg/m³)`));
    trace.push(step('2. Isentropic expansion path (homogeneous equilibrium, s = s0)',
      'For each P in [P0 → Pb]: solve T(P) with s(T, P) = s0 (two-phase: equilibrium flash) → h(P), v(P)',
      `${points.length} pressure points from ${f(P0, 3)} to ${f(Pb, 3)} bara, ΔP = ${f((P0 - Pb) / nSteps, 4)} bar`,
      `End point: T = ${f(points[points.length - 1].T_C, 2)} °C, x = ${f(points[points.length - 1].beta, 4)}, v = ${g(points[points.length - 1].v, 5)} m³/kg`));
    trace.push(step('3. Mass flux along the path (API 520 Pt I Annex C, direct integration)',
      'G(P) = √(2·(h0 − h(P))) / v(P)      [kg/(m²·s)]  (SI: h in J/kg, v in m³/kg)',
      `At P = ${f(Pt, 3)} bara: h = ${f(best.h / 1e3, 3)} kJ/kg, v = ${g(best.v, 5)} m³/kg → G = √(2·(${f(h0 / 1e3, 3)} − ${f(best.h / 1e3, 3)})·10³) / ${g(best.v, 5)}`,
      `G = ${f(G, 1)} kg/(m²·s)`));
    trace.push(step('4. Critical (choked) condition',
      'G_c = max G(P);  choked if the maximum is interior (P_throat > Pb), otherwise G = G(Pb)',
      choked ? `Maximum at P_throat = ${f(Pt, 3)} bara > Pb = ${f(Pb, 3)} bara (η_c = P_throat/P0 = ${f(Pt / P0, 4)})`
        : `G increases monotonically down to Pb = ${f(Pb, 3)} bara — subcritical (no interior maximum)`,
      `${choked ? 'CHOKED' : 'SUBCRITICAL'}: G = ${f(G, 1)} kg/(m²·s), T_throat = ${f(best.T_C, 2)} °C, x_throat = ${f(best.beta, 4)}`));

    return { ok: true, G_kgM2s: G, P_throat_bara: Pt, T_throat_C: best.T_C, etaCrit: Pt / P0, choked, h0, s0, v0, rho0: 1 / v0,
      phase0, x0: st0.betaMass, backPressureBara: Pb, points, warnings, trace };
  }

  /** Required orifice area [mm²] from a mass flux: A = W/(Kd·Kb·Kc·Kv·G). */
  function requiredAreaMm2FromG(args) {
    args = args || {};
    const W = num(args.flowRateKgHr, NaN), G = num(args.G_kgM2s, NaN);
    const Kd = num(args.Kd, 0.85), Kb = num(args.Kb, 1), Kc = num(args.Kc, 1), Kv = num(args.Kv, 1);
    const trace = [], warnings = [];
    if (!(W >= 0) || !(G > 0)) return { ok: false, error: 'flowRateKgHr ≥ 0 and G_kgM2s > 0 are required.', warnings, trace };
    const A_m2 = (W / 3600) / (Kd * Kb * Kc * Kv * G), A_mm2 = A_m2 * 1e6;
    trace.push(step('Required effective discharge area (API 520 Pt I Annex C, C.2.3)',
      'A = W / (Kd·Kb·Kc·Kv·G)      [m²] with W in kg/s, G in kg/(m²·s)',
      `A = (${f(W, 1)}/3600) / (${Kd}·${Kb}·${Kc}·${Kv}·${f(G, 1)})`,
      `A = ${f(A_mm2, 2)} mm² (${f(A_mm2 / 645.16, 4)} in²)`));
    return { ok: true, areaMm2: A_mm2, areaIn2: A_mm2 / 645.16, Kd, Kb, Kc, Kv, warnings, trace };
  }

  // ---------------------------------------------------------------------------
  // 2) Omega parameter from the EOS
  // ---------------------------------------------------------------------------
  function calcOmegaTwoPointEos(args) {
    args = args || {};
    const { FP, err } = fpOrError(); if (err) return err;
    const fluid = args.fluid || {};
    const P0 = num(args.P0_bara, NaN), T0 = num(args.T0_C, NaN);
    const warnings = [], trace = [];
    if (!(P0 > 0) || !Number.isFinite(T0)) return { ok: false, error: 'P0_bara and T0_C are required.', warnings, trace };
    const st0 = FP.thermoTP(Object.assign({}, fluid, { pressureBara: P0, temperatureC: T0 }));
    if (!st0.ok) return { ok: false, error: 'Stagnation flash failed: ' + st0.error, warnings, trace };
    warnings.push(...(st0.warnings || []));
    const P9 = 0.9 * P0;
    const st9 = FP.flashPS(fluidAt(fluid, P9, T0), st0.mix.sMass, { tMinC: -200, tMaxC: Math.max(T0 + 50, 300) });
    if (!st9.ok) return { ok: false, error: 'Isentropic flash to 0.9·P0 failed: ' + st9.error, warnings, trace };
    if (!st9.converged) warnings.push('Isentropic flash to 0.9·P0 did not fully converge — ω approximate.');
    const v0 = st0.mix.v, v9 = st9.mix.v;
    const omega = 9 * (v9 / v0 - 1);
    if (!(omega > 0)) warnings.push('ω ≤ 0: the fluid does not expand along the isentrope (check state / EOS roots).');
    if (st0.phase === 'liquid' && st9.phase === 'liquid') warnings.push('Both points are subcooled liquid — ω reflects liquid compressibility only (non-flashing); use the liquid sizing equation instead.');
    trace.push(step('1. Stagnation specific volume v0 (PR EOS)',
      'v0 = 1/ρ0 at (P0, T0)',
      `P0 = ${f(P0, 3)} bara, T0 = ${f(T0, 2)} °C → phase ${st0.phase}, x0 = ${f(st0.betaMass, 4)}`,
      `v0 = ${g(v0, 5)} m³/kg (ρ0 = ${f(1 / v0, 2)} kg/m³), s0 = ${f(st0.mix.sMass / 1e3, 5)} kJ/(kg·K)`));
    trace.push(step('2. Isentropic flash to P9 = 0.9·P0',
      'Solve T9: s(T9, 0.9·P0) = s0 (equilibrium flash) → v9',
      `P9 = ${f(P9, 3)} bara → T9 = ${f(st9.tC, 2)} °C, phase ${st9.phase}, x9 = ${f(st9.betaMass, 4)}`,
      `v9 = ${g(v9, 5)} m³/kg`));
    trace.push(step('3. Two-point omega parameter (API 520 Pt I Annex C, C.2.1)',
      'ω = 9·(v9/v0 − 1)',
      `ω = 9·(${g(v9, 5)}/${g(v0, 5)} − 1)`,
      `ω = ${f(omega, 4)}`));
    return { ok: true, omega, v0, v9, rho0: 1 / v0, P9_bara: P9, T9_C: st9.tC, x0: st0.betaMass, x9: st9.betaMass,
      phase0: st0.phase, phase9: st9.phase, s0: st0.mix.sMass, h0: st0.mix.hMass, warnings, trace };
  }

  function calcOmegaSaturatedEos(args) {
    args = args || {};
    const { FP, err } = fpOrError(); if (err) return err;
    const fluid = args.fluid || {};
    const P0 = num(args.P0_bara, NaN), T0 = num(args.T0_C, NaN);
    const warnings = [], trace = [];
    if (!(P0 > 0) || !Number.isFinite(T0)) return { ok: false, error: 'P0_bara and T0_C are required.', warnings, trace };
    const st0 = FP.thermoTP(Object.assign({}, fluid, { pressureBara: P0, temperatureC: T0 }));
    if (!st0.ok) return { ok: false, error: 'Stagnation flash failed: ' + st0.error, warnings, trace };
    warnings.push(...(st0.warnings || []));
    if (st0.phase !== 'two-phase' || !st0.vap || !st0.liq) {
      return { ok: false, error: `Saturated-ω form requires a two-phase inlet state; (P0, T0) is single-phase ${st0.phase}. Use the two-point method, or set quality (0..1) for a pure component.`, warnings, trace, phase0: st0.phase };
    }
    const vg = st0.vap.v, vl = st0.liq.v, v0 = st0.mix.v, rho0 = 1 / v0, x0 = st0.betaMass;
    const alpha0 = x0 * vg / v0;                         // void fraction
    const kV = Number.isFinite(st0.vap.nIsen) && st0.vap.nIsen > 1 ? st0.vap.nIsen : st0.vap.kIdeal;
    const cpl = st0.liq.cpMass;
    const hfg = st0.vap.hMass - st0.liq.hMass;
    const T0K = st0.T, P0Pa = P0 * 1e5;
    const term1 = alpha0 / kV;
    const term2 = rho0 * cpl * T0K * P0Pa * Math.pow((vg - vl) / hfg, 2);
    const omega = term1 + term2;
    if (!(hfg > 0)) warnings.push('h_fg ≤ 0 — invalid saturated state.');
    if (st0.saturated === false && st0.mwFeed && Object.keys(fluid.comps || {}).length > 1) warnings.push('Multicomponent two-phase inlet: Eq. C.1 is strictly for a single-component (or narrow-boiling) fluid; compare with the two-point ω.');
    trace.push(step('1. Saturated inlet properties (PR EOS)',
      'x0 (vapour mass fraction), v_g0, v_l0, v0 = x0·v_g0 + (1−x0)·v_l0, α0 = x0·v_g0/v0, h_fg0 = h_g0 − h_l0, Cp,l0, k = n_s(vapour)',
      `P0 = ${f(P0, 3)} bara, T0 = ${f(T0K - 273.15, 2)} °C, x0 = ${f(x0, 4)}, v_g0 = ${g(vg, 5)} m³/kg, v_l0 = ${g(vl, 5)} m³/kg, ρ0 = ${f(rho0, 2)} kg/m³`,
      `α0 = ${f(alpha0, 4)}, h_fg0 = ${f(hfg / 1e3, 2)} kJ/kg, Cp,l0 = ${f(cpl, 1)} J/(kg·K), k = ${f(kV, 4)}`));
    trace.push(step('2. Saturated omega parameter (API 520 Pt I Annex C Eq. C.1; Leung 1986)',
      'ω = α0/k + ρ0·Cp,l0·T0·P0·(v_g0 − v_l0)²/h_fg0²      [all SI: ρ0 kg/m³, Cp J/(kg·K), T0 K, P0 Pa, v m³/kg, h J/kg → dimensionless]',
      `ω = ${f(alpha0, 4)}/${f(kV, 4)} + ${f(rho0, 2)}·${f(cpl, 1)}·${f(T0K, 2)}·${f(P0Pa, 0)}·(${g(vg - vl, 5)})²/(${f(hfg, 0)})²  = ${f(term1, 4)} + ${f(term2, 4)}`,
      `ω = ${f(omega, 4)}`));
    return { ok: true, omega, term_alpha_k: term1, term_flash: term2, alpha0, x0, v0, vg0: vg, vl0: vl, rho0, hfg0: hfg, cpl0: cpl, kVap: kV, T0_K: T0K, warnings, trace };
  }

  // ---------------------------------------------------------------------------
  // 3) Supercritical / dense single-phase fire exposure
  // ---------------------------------------------------------------------------
  /** API 520 Pt I critical-flow gas sizing (SI form): A = W / (Kd·Kb·Kc·G), G = P1·√(k·M/(Z·R·T))·(2/(k+1))^((k+1)/(2(k−1))). */
  function gasCriticalAreaMm2(W_kgHr, P1_bara, T_K, Z, M_gmol, k, Kd, Kb, Kc) {
    const kk = Math.max(1.0001, k);
    const Cstar = Math.sqrt(kk) * Math.pow(2 / (kk + 1), (kk + 1) / (2 * (kk - 1)));
    const G = P1_bara * 1e5 * Cstar * Math.sqrt((M_gmol * 1e-3) / (Z * R * T_K));
    const A = (W_kgHr / 3600) / (Kd * Kb * Kc * G) * 1e6;
    return { A_mm2: A, G, Cstar };
  }

  function calcSupercriticalFire(args) {
    args = args || {};
    const { FP, err } = fpOrError(); if (err) return err;
    const fluid = args.fluid || {};
    const P1 = num(args.P1_bara, NaN), T0 = num(args.T0_C, NaN), Q = num(args.fireHeatKw, NaN);
    const tMaxC = num(args.tMaxC, 593), dT = Math.max(0.5, num(args.dT_C, 10));
    const m0 = Number.isFinite(Number(args.fluidMassKg)) && Number(args.fluidMassKg) > 0 ? Number(args.fluidMassKg) : null;
    const Kd = num(args.Kd, 0.975), Kb = num(args.Kb, 1), Kc = num(args.Kc, 1);
    const warnings = [], trace = [];
    if (!(P1 > 0) || !Number.isFinite(T0) || !(Q > 0)) return { ok: false, error: 'P1_bara, T0_C and fireHeatKw > 0 are required.', warnings, trace };
    if (!(tMaxC > T0)) return { ok: false, error: 'tMaxC must exceed T0_C.', warnings, trace };
    const pc = FP.pseudoCritical(fluid);
    if (!pc.ok) return { ok: false, error: pc.error, warnings, trace };
    const isSupercritical = P1 >= pc.ppcBar;
    if (!isSupercritical) warnings.push(`P1 = ${f(P1, 2)} bara is below the pseudo-critical pressure ${f(pc.ppcBar, 2)} bar (Kay's rule) — fluid may be a subcritical gas/liquid; latent-heat (wetted) method may govern if a two-phase state exists.`);

    const QW = Q * 1e3;
    const steps = [];
    let twoPhaseAt = null, rho0 = null, tCum = 0, prevPhase = null;
    const dTfd = 0.5;
    const stateAt = (tC) => FP.thermoTP(fluidAt(fluid, P1, tC));
    for (let tC = T0; tC <= tMaxC + 1e-9; tC += dT) {
      const st = stateAt(tC);
      if (!st.ok) { warnings.push(`EOS evaluation failed at ${f(tC, 1)} °C: ${st.error}`); break; }
      if (st.phase === 'two-phase' || (prevPhase && st.phase !== prevPhase)) { twoPhaseAt = tC; break; }
      prevPhase = st.phase;
      const sp = stateAt(tC + dTfd), sm = stateAt(tC - dTfd);
      if (!sp.ok || !sm.ok || sp.phase === 'two-phase' || sm.phase === 'two-phase' || sp.phase !== sm.phase) { twoPhaseAt = tC; break; }
      const ph = st.vap || st.liq;
      const v = st.mix.v, rho = st.mix.rho, cp = st.mix.cpMass;
      const betaT = (sp.mix.v - sm.mix.v) / (2 * dTfd) / v;      // 1/K (central difference)
      if (!(cp > 0) || !Number.isFinite(betaT)) { warnings.push(`Non-physical Cp/β_T at ${f(tC, 1)} °C — stepping stopped.`); break; }
      const W = QW * betaT / cp;                                 // kg/s
      const W_kgHr = W * 3600;
      const T_K = tC + 273.15, Z = ph.Z, M = ph.mw;
      const k = Number.isFinite(ph.nIsen) && ph.nIsen > 1 ? ph.nIsen : ph.kIdeal;
      const sz = gasCriticalAreaMm2(W_kgHr, P1, T_K, Z, M, k, Kd, Kb, Kc);
      if (rho0 === null) rho0 = rho;
      let dt_s = null, m_kg = null;
      if (m0) { m_kg = m0 * rho / rho0; dt_s = m_kg * cp * dT / QW; }
      steps.push({ T_C: tC, T_K, phase: st.phase, rho, v, cpMass: cp, betaT_perK: betaT, W_kgHr, mw: M, Z, kReal: ph.kReal, nIsen: ph.nIsen, kIdeal: ph.kIdeal, kUsed: k,
        G_kgM2s: sz.G, Cstar: sz.Cstar, areaMm2: sz.A_mm2, massKg: m_kg, dt_s, tCum_s: m0 ? (tCum += dt_s) : null, cpBetaRatio: cp / betaT });
    }
    if (twoPhaseAt !== null) warnings.push(`Two-phase (or phase-change) state encountered at ${f(twoPhaseAt, 1)} °C, ${f(P1, 2)} bara — stepping stopped; the latent-heat (wetted-vessel) method applies for that region.`);
    if (!steps.length) return { ok: false, error: 'No single-phase step could be evaluated.', warnings, trace, isSupercritical, pseudoCritical: pc };
    let gi = 0; steps.forEach((s, i) => { if (s.areaMm2 > steps[gi].areaMm2) gi = i; });
    const gov = steps[gi];
    const first = steps[0];

    trace.push(step('1. Pseudo-critical check (Kay\'s rule)',
      'P_pc = Σ z_i·P_c,i,  T_pc = Σ z_i·T_c,i;  supercritical / dense-phase if P1 ≥ P_pc',
      `P_pc = ${f(pc.ppcBar, 2)} bar, T_pc = ${f(pc.tpcK - 273.15, 2)} °C, P1 = ${f(P1, 2)} bara`,
      isSupercritical ? 'P1 ≥ P_pc → supercritical / dense single-phase fluid (no latent heat; expansion-driven relief)' : 'P1 < P_pc → subcritical pressure (check for two-phase states)'));
    trace.push(step('2. Relief rate from isobaric thermal expansion (energy balance at constant P)',
      'W = Q·β_T / Cp,   β_T = (1/v)·(∂v/∂T)_P  (central difference, ±0.5 K, PR EOS),  Cp = isobaric mass heat capacity (PR)',
      `At T0 = ${f(first.T_C, 1)} °C: β_T = ${g(first.betaT_perK, 5)} 1/K, Cp = ${f(first.cpMass, 1)} J/(kg·K), Q = ${f(Q, 1)} kW → W = ${f(QW, 0)}·${g(first.betaT_perK, 5)}/${f(first.cpMass, 1)}`,
      `W(T0) = ${f(first.W_kgHr, 1)} kg/h;  stepped every ${dT} K from ${f(T0, 1)} to ${f(steps[steps.length - 1].T_C, 1)} °C (${steps.length} steps)`));
    trace.push(step('3. API 520 Pt I critical-flow gas sizing at each step (SI form)',
      'A = W / (Kd·Kb·Kc·G),  G = P1·√(k·M/(Z·R·T))·(2/(k+1))^((k+1)/(2(k−1)))   [W kg/s, P1 Pa, M kg/mol, R = 8.314 J/(mol·K)]',
      `Governing step T = ${f(gov.T_C, 1)} °C: W = ${f(gov.W_kgHr, 1)} kg/h, M = ${f(gov.mw, 2)} g/mol, Z = ${f(gov.Z, 4)}, k = ${f(gov.kUsed, 4)} (n_s real), Kd = ${Kd}, Kb = ${Kb}, Kc = ${Kc}`,
      `G = ${f(gov.G_kgM2s, 1)} kg/(m²·s) → A_req = ${f(gov.areaMm2, 2)} mm² (${f(gov.areaMm2 / 645.16, 4)} in²)  — governing (max over steps)`));
    if (m0) trace.push(step('4. Heat-up time estimate',
      'Δt_i = m_i·Cp_i·ΔT / Q,  m_i = m0·ρ_i/ρ0 (constant-pressure vessel inventory)',
      `m0 = ${f(m0, 1)} kg, ρ0 = ${f(rho0, 2)} kg/m³, Q = ${f(Q, 1)} kW`,
      `Time to reach ${f(steps[steps.length - 1].T_C, 1)} °C ≈ ${f(steps[steps.length - 1].tCum_s / 60, 1)} min; time to governing step ≈ ${f(gov.tCum_s / 60, 1)} min`));

    return { ok: true, isSupercritical, pseudoCritical: pc, steps, governing: Object.assign({ index: gi }, gov), Kd, Kb, Kc, fireHeatKw: Q, P1_bara: P1,
      stoppedTwoPhaseAtC: twoPhaseAt, warnings, trace };
  }

  const api = { calcHdiMassFlux, requiredAreaMm2FromG, calcOmegaTwoPointEos, calcOmegaSaturatedEos, calcSupercriticalFire, gasCriticalAreaMm2 };
  if (typeof window !== 'undefined') window.PSVReliefThermo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
