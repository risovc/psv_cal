/**
 * PSVCalc Pro — Step 7 toolkit module "twophase": Gas-Liquid Two-Phase Line Sizing.
 *
 * Methods (all internal math in SI):
 *  (a) Homogeneous no-slip model — rho_m = no-slip density, Dukler (1964) volumetric mixture viscosity,
 *      Churchill (1977) explicit Darcy friction factor (matches Colebrook over the full range).
 *  (b) Beggs & Brill (1973), revised flow-pattern map (Payne et al. 1979 / Brill & Beggs 1991) with
 *      Payne et al. (1979) holdup corrections (x0.924 uphill, x0.685 downhill) and rough-pipe friction.
 *      Equations as tabulated in Brill & Mukherjee, "Multiphase Flow in Wells", SPE Monograph 17 (1999), §4.2.3.
 *  (c) API RP 14E (5th ed., 1991) §2.5a: Ve = C/sqrt(rho_m) [ft/s, lb/ft³]; minimum ~10 ft/s to limit slugging.
 * Screening tool: single-segment evaluation with fluid properties at inlet conditions.
 */
(function () {
  const G = 9.80665;
  const ATM = 1.01325;
  const K = { lb: 2.20462262, ft: 3.2808399, lbft3: 0.06242796, psi: 14.5037738, inch: 1 / 25.4, paUsc: 0.671968975 };
  const C_FACTORS = [
    { c: 100, note: '100 — continuous service, corrosive or unknown (API 14E base)' },
    { c: 125, note: '125 — intermittent service' },
    { c: 150, note: '150 — continuous, non-corrosive / corrosion-controlled' },
    { c: 200, note: '200 — continuous, non-corrosive or CRA, solids-free' }
  ];
  // Typical separator inlet-nozzle momentum limits (industry practice, e.g. Shell DEP 31.22.05.11) — screening only.
  const NOZZLE_LIMITS = [
    { label: 'No inlet device', pa: 1400 },
    { label: 'Half-open pipe / diverter', pa: 2100 },
    { label: 'Vane-type (Schoepentoeter)', pa: 6000 },
    { label: 'Inlet cyclones', pa: 8000 }
  ];
  const FALLBACK_PIPES = [{ nps: '6"', dn: 150, idMm: { 'Sch 40 (Std)': 154.05, 'Sch 80 (XS)': 146.33 } }];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fx = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const fe = (v, d = 3) => (Number.isFinite(v) ? (Math.abs(v) >= 1e-3 && Math.abs(v) < 1e5 ? String(Number(v.toPrecision(d))) : v.toExponential(d - 1)) : '—');

  function getPipes() {
    const E = (typeof window !== 'undefined' && window.PSVEngine) ||
      (typeof require === 'function' ? (() => { try { return require('../engine.js'); } catch (_) { return null; } })() : null);
    return (E && E.PIPE_SCHEDULES) || FALLBACK_PIPES;
  }
  const pipeId = (p, sch) => (p.idMm[sch] || p.idMm['Sch 40 (Std)']);

  /** Churchill (1977) explicit Darcy friction factor, valid laminar → fully rough. */
  function churchill(Re, relRough) {
    const re = Math.max(1e-6, Re);
    const A = Math.pow(2.457 * Math.log(1 / (Math.pow(7 / re, 0.9) + 0.27 * Math.max(0, relRough))), 16);
    const B = Math.pow(37530 / re, 16);
    return 8 * Math.pow(Math.pow(8 / re, 12) + Math.pow(A + B, -1.5), 1 / 12);
  }

  /** Beggs-Brill revised map boundaries (Brill & Mukherjee 1999, Eqs. 4.110–4.113). */
  function bbBoundaries(lam) {
    const l = clamp(lam, 1e-9, 1);
    return { L1: 316 * Math.pow(l, 0.302), L2: 0.0009252 * Math.pow(l, -2.4684), L3: 0.10 * Math.pow(l, -1.4516), L4: 0.5 * Math.pow(l, -6.738) };
  }

  /** Flow pattern from no-slip holdup and mixture Froude number (revised map, Brill & Beggs 1991). */
  function bbRegime(lam, NFr) {
    const { L1, L2, L3, L4 } = bbBoundaries(lam);
    if ((lam < 0.01 && NFr < L1) || (lam >= 0.01 && NFr < L2)) return 'Segregated';
    if (lam >= 0.01 && NFr >= L2 && NFr <= L3) return 'Transition';
    if ((lam >= 0.01 && lam < 0.4 && NFr > L3 && NFr <= L1) || (lam >= 0.4 && NFr > L3 && NFr <= L4)) return 'Intermittent';
    return 'Distributed';
  }

  const HL0_COEF = { Segregated: [0.98, 0.4846, 0.0868], Intermittent: [0.845, 0.5351, 0.0173], Distributed: [1.065, 0.5824, 0.0609] };
  const C_UP = { Segregated: [0.011, -3.768, 3.539, -1.614], Intermittent: [2.96, 0.305, -0.4473, 0.0978], Distributed: null };
  const C_DOWN = [4.70, -0.3692, 0.1244, -0.5056];

  /**
   * Beggs & Brill with Payne corrections. SI inputs: velocities m/s, D m, rho kg/m³, mu cP, sigma N/m,
   * theta rad (+ uphill), eps m, pAbsPa Pa. Returns holdup, regime and pressure gradients in Pa/m.
   */
  function beggsBrill(p) {
    const vSL = Math.max(1e-9, p.vSL), vSG = Math.max(0, p.vSG), D = Math.max(1e-4, p.D);
    const vm = vSL + vSG;
    const lam = clamp(vSL / vm, 1e-9, 1);
    const NFr = vm * vm / (G * D);
    const NLv = vSL * Math.pow(p.rhoL / (G * Math.max(1e-5, p.sigma)), 0.25);
    const th = clamp(p.theta || 0, -Math.PI / 2, Math.PI / 2);
    const bnd = bbBoundaries(lam);
    const regime = bbRegime(lam, NFr);
    const s18 = Math.sin(1.8 * th);
    const holdup = (reg) => {
      const [a, b, c] = HL0_COEF[reg];
      const HL0 = clamp(a * Math.pow(lam, b) / Math.pow(NFr, c), lam, 1);
      const co = th < 0 ? C_DOWN : C_UP[reg];
      let C = 0;
      if (co && th !== 0) C = Math.max(0, (1 - lam) * Math.log(co[0] * Math.pow(lam, co[1]) * Math.pow(Math.max(1e-9, NLv), co[2]) * Math.pow(NFr, co[3])));
      const psi = 1 + C * (s18 - 0.333 * Math.pow(s18, 3));
      return { HL0, C, psi, HLth: clamp(HL0 * psi, 0, 1) };
    };
    let h, A = null;
    if (regime === 'Transition') {
      const hs = holdup('Segregated'), hi = holdup('Intermittent');
      A = (bnd.L3 - NFr) / Math.max(1e-12, bnd.L3 - bnd.L2);
      h = { HL0: A * hs.HL0 + (1 - A) * hi.HL0, C: NaN, psi: NaN, HLth: A * hs.HLth + (1 - A) * hi.HLth };
    } else h = holdup(regime);
    // Payne et al. (1979): x0.924 uphill, x0.685 downhill (uphill result kept >= lambda_L).
    const payne = th > 0 ? 0.924 : th < 0 ? 0.685 : 1;
    let HL = h.HLth * payne;
    HL = th >= 0 ? clamp(HL, lam, 1) : clamp(HL, 1e-6, 1);
    const rhoN = p.rhoL * lam + p.rhoG * (1 - lam);
    const muN = p.muL * lam + p.muG * (1 - lam); // cP
    const rhoS = p.rhoL * HL + p.rhoG * (1 - HL);
    const ReN = rhoN * vm * D / (muN * 1e-3);
    const fn = churchill(ReN, (p.eps || 0) / D);
    const y = lam / (HL * HL);
    const ly = Math.log(y);
    const S = (y > 1 && y < 1.2) ? Math.log(2.2 * y - 1.2) : ly / (-0.0523 + 3.182 * ly - 0.8725 * ly * ly + 0.01853 * Math.pow(ly, 4));
    const ftp = fn * Math.exp(S);
    const gradF = ftp * rhoN * vm * vm / (2 * D);
    const gradEl = rhoS * G * Math.sin(th);
    const Ek = clamp(rhoS * vm * vSG / Math.max(1e3, p.pAbsPa || 1e5), 0, 0.9);
    const gradTot = (gradF + gradEl) / (1 - Ek);
    return { vSL, vSG, vm, lam, NFr, NLv, ...bnd, regime, HL0: h.HL0, C: h.C, psi: h.psi, HLth: h.HLth, A, payne, HL, rhoN, muN, rhoS, ReN, fn, y, S, ftp, gradF, gradEl, Ek, gradTot };
  }

  /** API RP 14E §2.5a Eq. 2.14: Ve [ft/s] = C / sqrt(rho_m [lb/ft³]). */
  const erosionalVelocityFtS = (C, rhoLbFt3) => C / Math.sqrt(Math.max(1e-6, rhoLbFt3));

  function sanitize(inp) {
    const d = defaultState();
    const s = Object.assign({}, d, inp || {});
    const o = {
      wGasKgHr: clamp(num(s.wGasKgHr, d.wGasKgHr), 0.01, 1e8),
      wLiqKgHr: clamp(num(s.wLiqKgHr, d.wLiqKgHr), 0.01, 1e8),
      rhoG: clamp(num(s.rhoG, d.rhoG), 0.05, 600),
      rhoL: clamp(num(s.rhoL, d.rhoL), 100, 2500),
      muG: clamp(num(s.muG, d.muG), 1e-3, 1),
      muL: clamp(num(s.muL, d.muL), 0.01, 1e4),
      sigma: clamp(num(s.sigma, d.sigma), 0.1, 100),
      pInBarg: clamp(num(s.pInBarg, d.pInBarg), 0, 1000),
      lengthM: clamp(num(s.lengthM, d.lengthM), 0.1, 1e6),
      roughMm: clamp(num(s.roughMm, d.roughMm), 0, 10),
      cFactor: C_FACTORS.some(c => c.c === Number(s.cFactor)) ? Number(s.cFactor) : 100,
      nps: String(s.nps), schedule: String(s.schedule),
      idMm: clamp(num(s.idMm, 0), 0, 3000)
    };
    o.rhoG = Math.min(o.rhoG, o.rhoL * 0.95);
    o.elevM = clamp(num(s.elevM, d.elevM), -o.lengthM, o.lengthM);
    return o;
  }

  function lineCalc(s, D) {
    const A = Math.PI * D * D / 4;
    const vSG = s.wGasKgHr / 3600 / s.rhoG / A;
    const vSL = s.wLiqKgHr / 3600 / s.rhoL / A;
    const theta = Math.asin(s.elevM / s.lengthM);
    const pAbsBar = s.pInBarg + ATM;
    const bb = beggsBrill({ vSL, vSG, D, rhoL: s.rhoL, rhoG: s.rhoG, muL: s.muL, muG: s.muG, sigma: s.sigma * 1e-3, theta, eps: s.roughMm / 1000, pAbsPa: pAbsBar * 1e5 });
    const rhoLb = bb.rhoN * K.lbft3;
    const veFtS = erosionalVelocityFtS(s.cFactor, rhoLb);
    const veMS = veFtS / K.ft;
    return { D, A, theta, pAbsBar, bb, rhoLb, veFtS, veMS, veRatio: bb.vm / veMS, dp100Bar: bb.gradTot * 100 / 1e5 };
  }

  /** Pure calculation. Input: canonical SI state (optional idMm overrides the NPS/schedule lookup). */
  function calc(input) {
    const s = sanitize(input);
    const pipes = getPipes();
    const pipe = pipes.find(p => p.nps === s.nps) || pipes.find(p => p.nps === '6"') || pipes[0];
    const idMm = s.idMm > 0 ? s.idMm : pipeId(pipe, s.schedule);
    const L = lineCalc(s, idMm / 1000);
    const bb = L.bb;
    const fac = s.lengthM / (1 - bb.Ek);
    const dpFBar = bb.gradF * fac / 1e5, dpElBar = bb.gradEl * fac / 1e5;
    const dpTotBar = bb.gradTot * s.lengthM / 1e5;
    const dpAccBar = dpTotBar - (bb.gradF + bb.gradEl) * s.lengthM / 1e5;
    const pct = (v) => 100 * v / L.pAbsBar;
    // Homogeneous no-slip model
    const muM = bb.muN;
    const ReM = bb.rhoN * bb.vm * L.D / (muM * 1e-3);
    const fM = churchill(ReM, s.roughMm / 1000 / L.D);
    const hDpF = fM * s.lengthM / L.D * bb.rhoN * bb.vm * bb.vm / 2 / 1e5;
    const hDpEl = bb.rhoN * G * s.elevM / 1e5;
    const rhoV2 = bb.rhoN * bb.vm * bb.vm;
    const vMinMS = 10 / K.ft;
    const erosionPass = bb.vm <= L.veMS;
    const minVelOk = bb.vm >= vMinMS;
    const dpPct = pct(dpTotBar);
    const dpStatus = dpPct > 50 ? 'fail' : dpPct > 10 ? 'warn' : 'pass';
    const scan = pipes.filter(p => p.dn >= 50).map(p => {
      const id = pipeId(p, s.schedule);
      const r = lineCalc(s, id / 1000);
      return { nps: p.nps, idMm: id, vmMS: r.bb.vm, veRatio: r.veRatio, dp100Bar: r.dp100Bar, regime: r.bb.regime, HL: r.bb.HL, lam: r.bb.lam, NFr: r.bb.NFr, selected: p.nps === pipe.nps && !(s.idMm > 0) };
    });
    const warnings = [];
    if (!erosionPass) warnings.push(`Mixture velocity exceeds API RP 14E erosional velocity (C = ${s.cFactor}).`);
    if (!minVelOk) warnings.push('Mixture velocity below ~10 ft/s (3.05 m/s): API RP 14E §2.5a guidance — risk of slugging / liquid accumulation.');
    if (bb.regime === 'Intermittent') warnings.push('Intermittent (slug/plug) regime: check slug loads on supports and separator inlet surge.');
    if (dpStatus !== 'pass') warnings.push(`ΔP is ${fx(dpPct, 1)}% of inlet pressure: single-segment evaluation at inlet properties is inaccurate — split the line into segments.`);
    return {
      input: s, nps: pipe.nps, schedule: s.schedule, idMm, ...L,
      dpFBar, dpElBar, dpAccBar, dpTotBar, dpFPct: pct(dpFBar), dpElPct: pct(dpElBar), dpTotPct: dpPct, dpStatus,
      homog: { rhoM: bb.rhoN, muM, ReM, fM, dpFBar: hDpF, dpElBar: hDpEl, dpTotBar: hDpF + hDpEl, dpTotPct: pct(hDpF + hDpEl) },
      rhoV2, nozzle: NOZZLE_LIMITS.map(n => ({ ...n, pass: rhoV2 <= n.pa })),
      vMinMS, erosionPass, minVelOk, scan, warnings
    };
  }

  function defaultState() {
    return { wGasKgHr: 45000, wLiqKgHr: 120000, rhoG: 55, rhoL: 720, muG: 0.014, muL: 0.9, sigma: 12, nps: '10"', schedule: 'Sch 80 (XS)', lengthM: 60, elevM: 3, roughMm: 0.046, pInBarg: 70, cFactor: 125 };
  }

  const presets = [
    { id: 'sep-inlet', label: 'V-1001 HP separator inlet line (70 barg, 10")', state: defaultState() },
    { id: 'flowline', label: 'Wellhead → manifold flowline, uphill 1.5 km (35 barg, 8")',
      state: { wGasKgHr: 15000, wLiqKgHr: 50000, rhoG: 25, rhoL: 800, muG: 0.012, muL: 3, sigma: 20, nps: '8"', schedule: 'Sch 80 (XS)', lengthM: 1500, elevM: 15, roughMm: 0.046, pInBarg: 35, cFactor: 100 } },
    { id: 'psv-outlet', label: 'PSV two-phase discharge → flare KO drum (2.5 barg, 12")',
      state: { wGasKgHr: 30000, wLiqKgHr: 15000, rhoG: 3.5, rhoL: 650, muG: 0.011, muL: 0.3, sigma: 8, nps: '12"', schedule: 'Sch 40 (Std)', lengthM: 80, elevM: -2, roughMm: 0.046, pInBarg: 2.5, cFactor: 150 } }
  ];

  let state = defaultState();
  let pane = null, ctx = null;

  const FIELDS = [
    { k: 'wGasKgHr', label: 'Gas mass flow', sym: 'W_G', si: 'kg/h', usc: 'lb/h', f: K.lb },
    { k: 'wLiqKgHr', label: 'Liquid mass flow', sym: 'W_L', si: 'kg/h', usc: 'lb/h', f: K.lb },
    { k: 'rhoG', label: 'Gas density @ P_in', sym: 'ρ_G', si: 'kg/m³', usc: 'lb/ft³', f: K.lbft3 },
    { k: 'rhoL', label: 'Liquid density', sym: 'ρ_L', si: 'kg/m³', usc: 'lb/ft³', f: K.lbft3 },
    { k: 'muG', label: 'Gas viscosity', sym: 'μ_G', si: 'cP', usc: 'cP', f: 1 },
    { k: 'muL', label: 'Liquid viscosity', sym: 'μ_L', si: 'cP', usc: 'cP', f: 1 },
    { k: 'sigma', label: 'Surface tension', sym: 'σ', si: 'mN/m', usc: 'dyn/cm', f: 1 },
    { k: 'pInBarg', label: 'Inlet pressure', sym: 'P_in', si: 'barg', usc: 'psig', f: K.psi },
    { k: 'lengthM', label: 'Equivalent length', sym: 'L', si: 'm', usc: 'ft', f: K.ft },
    { k: 'elevM', label: 'Elevation change (out − in)', sym: 'Δz', si: 'm', usc: 'ft', f: K.ft },
    { k: 'roughMm', label: 'Absolute roughness', sym: 'ε', si: 'mm', usc: 'in', f: K.inch }
  ];

  const usc = () => !!(ctx && ctx.isUSC && ctx.isUSC());
  const U = {
    v: (ms) => usc() ? `${fx(ms * K.ft, 1)} ft/s` : `${fx(ms, 2)} m/s`,
    dp: (bar, d = 3) => usc() ? `${fx(bar * K.psi, d - 1)} psi` : `${fx(bar, d)} bar`,
    rho: (k) => usc() ? `${fx(k * K.lbft3, 2)} lb/ft³` : `${fx(k, 1)} kg/m³`,
    j: (pa) => usc() ? `${fx(pa * K.paUsc, 0)} lb/ft·s²` : `${fx(pa, 0)} Pa`
  };
  const disp = (fd) => { const v = Number(state[fd.k]) * (usc() ? fd.f : 1); return Number.isFinite(v) ? String(Number(v.toPrecision(6))) : ''; };

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById('style-twophase')) return;
    const st = document.createElement('style');
    st.id = 'style-twophase';
    st.textContent = `
#toolPane-twophase .tp-grid{display:grid;grid-template-columns:minmax(320px,430px) 1fr;gap:1.25rem;align-items:start;margin-bottom:1.25rem;}
@media (max-width:1120px){#toolPane-twophase .tp-grid{grid-template-columns:1fr;}}
#toolPane-twophase .tp-svg-box{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0.5rem;margin-top:0.85rem;}
#toolPane-twophase .tp-svg-box svg{width:100%;height:auto;display:block;color:var(--text-secondary);font-family:var(--font-mono);}
#toolPane-twophase .tp-scan tbody tr{cursor:pointer;}
#toolPane-twophase .tp-note{font-size:0.74rem;color:var(--text-muted);margin-top:0.5rem;line-height:1.5;}
#toolPane-twophase .tp-warn{font-size:0.76rem;color:var(--warn-text);margin:0.25rem 0;}
#toolPane-twophase .tp-hdr-ctl{display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;}
#toolPane-twophase .tp-hdr-ctl select{max-width:380px;}
#toolPane-twophase .eq-step-list{display:flex;flex-direction:column;gap:0.75rem;}
#toolPane-twophase .metric-box-main .status-badge{font-size:0.66rem;vertical-align:middle;margin-left:0.3rem;}`;
    document.head.appendChild(st);
  }

  function renderInputs() {
    const host = pane && pane.querySelector('#twophase-inputs');
    if (!host) return;
    const pipes = getPipes();
    const schedules = Object.keys(pipes[0].idMm);
    const field = (fd) => `
      <div class="field-group">
        <label class="field-label" for="twophase-${fd.k}"><span>${esc(fd.label)}</span><span class="field-sym">${esc(fd.sym)}</span></label>
        <div class="input-with-unit"><input type="number" id="twophase-${fd.k}" data-key="${fd.k}" step="any" value="${esc(disp(fd))}" /><span class="unit-addon">${esc(usc() ? fd.usc : fd.si)}</span></div>
      </div>`;
    const sel = (id, label, sym, opts) => `
      <div class="field-group">
        <label class="field-label" for="twophase-${id}"><span>${esc(label)}</span><span class="field-sym">${esc(sym)}</span></label>
        <div class="input-with-unit"><select id="twophase-${id}" data-key="${id}">${opts}</select></div>
      </div>`;
    host.innerHTML = `
      <div class="form-grid-2">
        ${FIELDS.slice(0, 7).map(field).join('')}
        ${sel('nps', 'Pipe size', 'NPS', pipes.map(p => `<option value="${esc(p.nps)}" ${p.nps === state.nps ? 'selected' : ''}>${esc(p.nps)} (DN ${esc(p.dn)})</option>`).join(''))}
        ${sel('schedule', 'Schedule', 'Sch', schedules.map(s => `<option value="${esc(s)}" ${s === state.schedule ? 'selected' : ''}>${esc(s)}</option>`).join(''))}
        ${FIELDS.slice(7).map(field).join('')}
      </div>
      <div style="margin-top:0.75rem;">${sel('cFactor', 'API RP 14E C-factor', 'C', C_FACTORS.map(c => `<option value="${c.c}" ${c.c === Number(state.cFactor) ? 'selected' : ''}>${esc(c.note)}</option>`).join(''))}</div>
      <div class="tp-note">Fluid properties are taken at inlet conditions (single segment); gas density must be at the line inlet P/T.
        API RP 14E §2.5a: C = 100 continuous / 125 intermittent; 150–200 may be used for continuous service where corrosion is controlled or absent and no solids are produced.</div>`;
    host.querySelectorAll('input[type=number]').forEach(inp => {
      const fd = FIELDS.find(f => f.k === inp.dataset.key);
      const h = () => { const v = parseFloat(inp.value); if (!Number.isFinite(v)) return; state[fd.k] = v / (usc() ? fd.f : 1); recompute(); };
      inp.addEventListener('input', h); inp.addEventListener('change', h);
    });
    host.querySelectorAll('select').forEach(s => s.addEventListener('change', () => {
      state[s.dataset.key] = s.dataset.key === 'cFactor' ? Number(s.value) : s.value;
      delete state.idMm; recompute();
    }));
  }

  // ---------- SVG: Beggs-Brill horizontal flow-pattern map ----------
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴' };
  const pow10 = (e) => (e === 0 ? '1' : '10' + String(e).split('').map(ch => SUP[ch] || ch).join(''));

  function mapSvg(r) {
    const W = 560, H = 340, ml = 58, mr = 14, mt = 14, mb = 44;
    const x0 = -4, x1 = 0, y0 = -3, y1 = 4;
    const X = (lam) => ml + (clamp(Math.log10(Math.max(1e-12, lam)), x0, x1) - x0) / (x1 - x0) * (W - ml - mr);
    const Y = (fr) => mt + (y1 - clamp(Math.log10(Math.max(1e-12, fr)), y0, y1)) / (y1 - y0) * (H - mt - mb);
    const samp = (fn, a, b, n = 40) => { const out = []; for (let i = 0; i <= n; i++) { const l = Math.pow(10, Math.log10(a) + (Math.log10(b) - Math.log10(a)) * i / n); out.push([l, fn(l)]); } return out; };
    const B = (k) => (l) => bbBoundaries(l)[k];
    const pts = (arr) => arr.map(([l, f]) => `${X(l).toFixed(1)},${Y(f).toFixed(1)}`).join(' ');
    const lo = Math.pow(10, x0), top = Math.pow(10, y1), bot = Math.pow(10, y0);
    const seg = [...samp(B('L1'), lo, 0.01), ...samp(B('L2'), 0.01, 1), [1, bot], [lo, bot]];
    const tra = [...samp(B('L2'), 0.01, 1), ...samp(B('L3'), 0.01, 1).reverse()];
    const inter = [...samp(B('L3'), 0.01, 1), ...samp(B('L4'), 0.4, 1).reverse(), ...samp(B('L1'), 0.01, 0.4).reverse()];
    const dist = [...samp(B('L1'), lo, 0.4), ...samp(B('L4'), 0.4, 1), [1, top], [lo, top]];
    const grid = [];
    for (let e = x0; e <= x1; e++) grid.push(`<line x1="${X(10 ** e)}" y1="${mt}" x2="${X(10 ** e)}" y2="${H - mb}" style="stroke:var(--border-strong);stroke-width:0.6" stroke-dasharray="2 3"/><text x="${X(10 ** e)}" y="${H - mb + 15}" text-anchor="middle" font-size="10" fill="currentColor">${pow10(e)}</text>`);
    for (let e = y0; e <= y1; e++) grid.push(`<line x1="${ml}" y1="${Y(10 ** e)}" x2="${W - mr}" y2="${Y(10 ** e)}" style="stroke:var(--border-strong);stroke-width:0.6" stroke-dasharray="2 3"/><text x="${ml - 6}" y="${Y(10 ** e) + 3}" text-anchor="end" font-size="10" fill="currentColor">${pow10(e)}</text>`);
    const curve = (k, a, b, lx) => `<polyline points="${pts(samp(B(k), a, b))}" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="${X(lx) + 4}" y="${Y(B(k)(lx)) - 4}" font-size="10" font-weight="700" fill="currentColor">${k}</text>`;
    const scanPts = r.scan.map(s => [s.lam, s.NFr]);
    const ox = X(r.bb.lam), oy = Y(r.bb.NFr);
    const lblRight = ox < W - 170;
    const lbl = `NPS ${r.nps} · ${r.bb.regime}`;
    // operating-point label box (approx. 6.7 px/char at 11 px mono) — region labels are nudged away from it
    const lx0 = lblRight ? ox + 10 : ox - 10 - lbl.length * 6.7, ly = oy < mt + 20 ? oy + 18 : oy - 9;
    const opBox = [Math.min(lx0, ox - 8), ly - 12, Math.max(lx0 + lbl.length * 6.7, ox + 8), Math.max(ly + 3, oy + 8)];
    const lab = (x, y, t, fs = 12) => {
      const w = t.length * fs * 0.62;
      const hit = (yy) => x < opBox[2] && x + w > opBox[0] && yy - fs < opBox[3] && yy > opBox[1];
      let yy = y;
      if (hit(yy)) yy = (y - fs - 6 > mt + fs && !hit(opBox[1] - 4)) ? opBox[1] - 4 : opBox[3] + fs + 4;
      return `<text x="${x}" y="${yy.toFixed(1)}" font-size="${fs}" font-weight="700" style="fill:var(--text-primary);opacity:0.8">${t}</text>`;
    };
    return `<svg id="twophase-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Beggs-Brill horizontal flow pattern map">
      <polygon points="${pts(seg)}" fill="rgba(56,189,248,0.16)"/>
      <polygon points="${pts(tra)}" fill="rgba(250,204,21,0.28)"/>
      <polygon points="${pts(inter)}" fill="rgba(249,115,22,0.16)"/>
      <polygon points="${pts(dist)}" fill="rgba(167,139,250,0.18)"/>
      ${grid.join('')}
      <rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" fill="none" stroke="currentColor" stroke-width="1"/>
      ${curve('L1', lo, 0.4, 2e-4)}${curve('L2', 0.01, 1, 0.03)}${curve('L3', 0.01, 1, 0.012)}${curve('L4', 0.4, 1, 0.62)}
      ${lab(X(2.5e-4), Y(0.2), 'SEGREGATED')}${lab(X(1.5e-3), Y(1500), 'DISTRIBUTED')}${lab(X(0.03), Y(25), 'INTERMITTENT')}${lab(X(0.12), Y(0.06), 'TRANSITION', 10)}
      <polyline points="${pts(scanPts)}" fill="none" style="stroke:var(--accent-primary)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
      ${scanPts.map(([l, f]) => `<circle cx="${X(l).toFixed(1)}" cy="${Y(f).toFixed(1)}" r="2.6" style="fill:var(--accent-primary)" opacity="0.55"/>`).join('')}
      <circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="6.5" style="fill:var(--accent-primary);stroke:var(--text-primary)" stroke-width="1.5"/>
      <text x="${(lblRight ? ox + 10 : ox - 10).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${lblRight ? 'start' : 'end'}" font-size="11" font-weight="700" style="fill:var(--text-primary);paint-order:stroke;stroke:var(--bg-elevated);stroke-width:3px">${esc(lbl)}</text>
      <text x="${(ml + W - mr) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor">No-slip liquid holdup λL = vSL / vm (log)</text>
      <text transform="translate(14 ${(mt + H - mb) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="currentColor">Froude NFr = vm² / gD (log)</text>
    </svg>`;
  }

  function velSvg(r) {
    const W = 560, H = 80, ml = 14, mr = 14, by = 30, bh = 16;
    const vmax = Math.max(r.veMS * 1.25, r.bb.vm * 1.1, r.vMinMS * 1.5);
    const X = (v) => ml + clamp(v / vmax, 0, 1) * (W - ml - mr);
    const col = r.erosionPass ? (r.minVelOk ? 'var(--pass-text)' : 'var(--warn-text)') : 'var(--fail-text)';
    const anchor = (x) => (x > W - 130 ? 'end' : x < 130 ? 'start' : 'middle');
    const mk = (v, label, above) => `<line x1="${X(v).toFixed(1)}" y1="${by - 6}" x2="${X(v).toFixed(1)}" y2="${by + bh + 6}" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"/>
      <text x="${X(v).toFixed(1)}" y="${above ? by - 10 : by + bh + 19}" text-anchor="${anchor(X(v))}" font-size="10.5" font-weight="700" style="fill:var(--text-primary)">${esc(label)}</text>`;
    const vx = X(r.bb.vm);
    return `<svg id="twophase-velbar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mixture velocity versus erosional velocity">
      <rect x="${ml}" y="${by}" width="${W - ml - mr}" height="${bh}" rx="3" fill="rgba(148,163,184,0.18)" stroke="currentColor" stroke-width="0.6"/>
      <rect x="${ml}" y="${by}" width="${Math.max(2, vx - ml).toFixed(1)}" height="${bh}" rx="3" style="fill:${col}" opacity="0.75"/>
      ${mk(r.veMS, `Ve (C=${r.input.cFactor}) = ${U.v(r.veMS)}`, true)}
      ${mk(r.vMinMS, `v_min ≈ ${U.v(r.vMinMS)}`, false)}
      <text x="${(vx > W - 150 ? vx - 6 : vx + 6).toFixed(1)}" y="${by + bh - 4}" text-anchor="${vx > W - 150 ? 'end' : 'start'}" font-size="10.5" font-weight="700" style="fill:var(--text-primary);paint-order:stroke;stroke:var(--bg-elevated);stroke-width:3px">vm = ${esc(U.v(r.bb.vm))}</text>
    </svg>`;
  }

  const badge = (st, txt) => `<span class="status-badge status-${st}">${esc(txt)}</span>`;

  function traceHtml(r) {
    const b = r.bb, s = r.input;
    const card = (h, sym, sub, res) => `<div class="eq-step-card"><div class="eq-step-header">${h}</div><div class="eq-symbolic">${sym}</div><div class="eq-substitution">${sub}</div><div class="eq-result">${res}</div></div>`;
    const thDeg = r.theta * 180 / Math.PI;
    const coefs = b.regime === 'Transition' ? `Transition: HL = A·HL(seg) + (1−A)·HL(int), A = (L3 − NFr)/(L3 − L2) = ${fx(b.A, 3)}` : `a, b, c = ${HL0_COEF[b.regime].join(', ')} (${b.regime})`;
    return [
      card('1. Superficial velocities &amp; no-slip holdup — Beggs &amp; Brill (1973)',
        'vSG = W_G/(3600·ρ_G·A) ; vSL = W_L/(3600·ρ_L·A) ; vm = vSL + vSG ; λL = vSL/vm',
        `D = ${fx(r.idMm, 2)} mm (NPS ${esc(r.nps)} ${esc(r.schedule)}), A = ${fe(r.A, 4)} m² ; vSG = ${fx(b.vSG, 3)} m/s ; vSL = ${fx(b.vSL, 3)} m/s`,
        `vm = ${fx(b.vm, 3)} m/s (${fx(b.vm * K.ft, 2)} ft/s) ; λL = ${fx(b.lam, 4)}`),
      card('2. Dimensionless groups &amp; revised map boundaries — Brill &amp; Mukherjee (1999) Eqs. 4.110–4.113',
        'NFr = vm²/(g·D) ; NLv = vSL·(ρL/(g·σ))^0.25 ; L1 = 316λ^0.302 ; L2 = 0.0009252λ^−2.4684 ; L3 = 0.10λ^−1.4516 ; L4 = 0.5λ^−6.738',
        `NFr = ${fx(b.vm, 3)}²/(9.80665 × ${fx(r.D, 4)}) ; NLv = ${fx(b.NLv, 3)} ; L1 = ${fe(b.L1)} ; L2 = ${fe(b.L2)} ; L3 = ${fe(b.L3)} ; L4 = ${fe(b.L4)}`,
        `NFr = ${fe(b.NFr, 4)} → flow pattern: ${esc(b.regime)}`),
      card('3. Horizontal holdup &amp; inclination correction — Beggs &amp; Brill (1973), Payne et al. (1979)',
        'HL(0) = a·λL^b / NFr^c ≥ λL ; C = (1−λL)·ln(e·λL^f·NLv^g·NFr^h) ≥ 0 ; ψ = 1 + C[sin1.8θ − 0.333 sin³1.8θ] ; HL = HL(0)·ψ × (0.924 uphill | 0.685 downhill)',
        `${coefs} ; θ = ${fx(thDeg, 2)}° ; HL(0) = ${fx(b.HL0, 4)} ; C = ${Number.isFinite(b.C) ? fx(b.C, 4) : 'per sub-pattern'} ; HL(θ) = ${fx(b.HLth, 4)} ; Payne factor = ${b.payne}`,
        `HL = ${fx(b.HL, 4)} ; ρs = ρL·HL + ρG·(1−HL) = ${fx(b.rhoS, 2)} kg/m³`),
      card('4. Two-phase friction factor — Beggs &amp; Brill (1973); Churchill (1977) rough-pipe f_n per Payne et al.',
        'ρn = ρLλL + ρG(1−λL) ; μn = μLλL + μG(1−λL) ; Re_n = ρn·vm·D/μn ; y = λL/HL² ; S = ln y / (−0.0523 + 3.182 ln y − 0.8725 ln²y + 0.01853 ln⁴y) [1&lt;y&lt;1.2: S = ln(2.2y − 1.2)] ; f_tp = f_n·e^S',
        `ρn = ${fx(b.rhoN, 2)} kg/m³ ; μn = ${fe(b.muN)} cP ; Re_n = ${fe(b.ReN, 4)} ; ε/D = ${fe(s.roughMm / r.idMm)} ; f_n = ${fx(b.fn, 5)} ; y = ${fx(b.y, 4)} ; S = ${fx(b.S, 4)}`,
        `f_tp = ${fx(b.ftp, 5)} (Darcy)`),
      card('5. Pressure gradient &amp; line ΔP — Brill &amp; Beggs (1991)',
        '(dp/dL)_f = f_tp·ρn·vm²/(2D) ; (dp/dL)_el = ρs·g·sinθ ; E_k = ρs·vm·vSG/P ; dp/dL = [(dp/dL)_f + (dp/dL)_el]/(1 − E_k) ; ΔP = dp/dL × L',
        `(dp/dL)_f = ${fx(b.gradF, 1)} Pa/m ; (dp/dL)_el = ${fx(b.gradEl, 1)} Pa/m ; E_k = ${fe(b.Ek)} ; P = ${fx(r.pAbsBar, 3)} bara ; L = ${fx(s.lengthM, 1)} m`,
        `ΔP = ${fx(r.dpTotBar, 4)} bar (friction ${fx(r.dpFBar, 4)}, elevation ${fx(r.dpElBar, 4)}, accel. ${fx(r.dpAccBar, 4)}) = ${fx(r.dpTotPct, 2)}% of P_in,abs`),
      card('6. Homogeneous no-slip model — Dukler (1964) mixture viscosity, Churchill (1977), Darcy-Weisbach',
        'ρm = (W_G + W_L)/(Q_G + Q_L) ; μm = μLλL + μG(1−λL) ; ΔP = f·(L/D)·ρm·vm²/2 + ρm·g·Δz',
        `ρm = ${fx(r.homog.rhoM, 2)} kg/m³ ; Re_m = ${fe(r.homog.ReM, 4)} ; f = ${fx(r.homog.fM, 5)} ; ΔP_f = ${fx(r.homog.dpFBar, 4)} bar ; ΔP_el = ${fx(r.homog.dpElBar, 4)} bar`,
        `ΔP_homog = ${fx(r.homog.dpTotBar, 4)} bar (${fx(r.homog.dpTotPct, 2)}% of P_in,abs) — no slip: under-predicts holdup and elevation ΔP in uphill lines`),
      card('7. Erosional velocity — API RP 14E (5th ed.) §2.5a Eq. 2.14 (USC form) &amp; inlet momentum',
        'Ve = C / √ρm  [ft/s, lb/ft³] ; v_min ≈ 10 ft/s (slug mitigation) ; J = ρm·vm²',
        `ρm = ${fx(r.rhoLb, 3)} lb/ft³ ; Ve = ${s.cFactor} / √${fx(r.rhoLb, 3)} = ${fx(r.veFtS, 2)} ft/s = ${fx(r.veMS, 2)} m/s ; vm/Ve = ${fx(r.veRatio, 3)}`,
        `vm = ${fx(b.vm, 2)} m/s ${r.erosionPass ? '≤' : '&gt;'} Ve → ${r.erosionPass ? 'PASS' : 'FAIL'} ; ρv² = ${fx(r.rhoV2, 0)} Pa (${fx(r.rhoV2 * K.paUsc, 0)} lb/ft·s²)`)
    ].join('');
  }

  function renderOutputs(r) {
    const out = pane && pane.querySelector('#twophase-outputs');
    if (!out) return;
    const b = r.bb;
    const veSt = r.erosionPass ? (r.minVelOk ? 'pass' : 'warn') : 'fail';
    const veTxt = r.erosionPass ? (r.minVelOk ? 'PASS' : 'LOW') : 'FAIL';
    const regSt = b.regime === 'Intermittent' ? 'warn' : 'pass';
    out.innerHTML = `
      <div class="metrics-summary-grid">
        <div class="metric-box" id="twophase-m-vel"><span class="metric-box-label">Mixture velocity vs API 14E Ve</span>
          <span class="metric-box-main" style="color:var(--${veSt}-text);">${U.v(b.vm)} ${badge(veSt, veTxt)}</span>
          <span class="metric-box-sub">Ve = ${U.v(r.veMS)} (C=${r.input.cFactor}) · vm/Ve = ${fx(r.veRatio, 2)}</span></div>
        <div class="metric-box" id="twophase-m-reg"><span class="metric-box-label">Flow regime (Beggs-Brill)</span>
          <span class="metric-box-main">${esc(b.regime)} ${badge(regSt, b.regime === 'Intermittent' ? 'SLUG' : 'OK')}</span>
          <span class="metric-box-sub">HL = ${fx(b.HL, 3)} · λL = ${fx(b.lam, 3)} · NFr = ${fe(b.NFr)}</span></div>
        <div class="metric-box" id="twophase-m-dp"><span class="metric-box-label">ΔP total (Beggs-Brill)</span>
          <span class="metric-box-main">${U.dp(r.dpTotBar)} ${badge(r.dpStatus, fx(r.dpTotPct, 1) + '%')}</span>
          <span class="metric-box-sub">fric ${U.dp(r.dpFBar)} (${fx(r.dpFPct, 1)}%) · elev ${U.dp(r.dpElBar)} (${fx(r.dpElPct, 1)}%) of P_in,abs</span></div>
        <div class="metric-box" id="twophase-m-hom"><span class="metric-box-label">Homogeneous ΔP · ρv²</span>
          <span class="metric-box-main">${U.dp(r.homog.dpTotBar)}</span>
          <span class="metric-box-sub">ρm = ${U.rho(r.homog.rhoM)} · ρv² = ${U.j(r.rhoV2)}</span></div>
      </div>
      <div style="margin-top:0.5rem;">${r.warnings.map(w => `<div class="tp-warn">⚠ ${esc(w)}</div>`).join('')}</div>
      <div class="tp-svg-box">${mapSvg(r)}</div>
      <div class="tp-svg-box">${velSvg(r)}</div>
      <div class="tp-note"><strong>Inlet-nozzle momentum ρv² = ${esc(U.j(r.rhoV2))}</strong> vs typical limits:
        ${r.nozzle.map(n => `${esc(n.label)} ≤ ${esc(U.j(n.pa))} ${badge(n.pass ? 'pass' : 'fail', n.pass ? 'OK' : 'EXCEEDS')}`).join(' · ')}.
        Screening values from common industry practice (e.g. Shell DEP 31.22.05.11) — confirm with the inlet-device vendor.</div>`;
    const scanHost = pane.querySelector('#twophase-scan');
    if (scanHost) {
      scanHost.innerHTML = `<div class="table-responsive"><table class="eng-table tp-scan"><thead><tr>
        <th>NPS</th><th>ID (${usc() ? 'in' : 'mm'})</th><th>vm (${usc() ? 'ft/s' : 'm/s'})</th><th>vm / Ve</th><th>ΔP / 100 ${usc() ? 'ft (psi)' : 'm (bar)'}</th><th>Regime</th><th>HL</th></tr></thead><tbody>
        ${r.scan.map(row => {
          const st = row.veRatio > 1 ? 'fail' : row.vmMS < r.vMinMS ? 'warn' : 'pass';
          return `<tr class="${row.selected ? 'row-governing' : ''}" data-nps="${esc(row.nps)}" title="Click to select this size">
            <td class="mono" style="font-weight:700;">${esc(row.nps)}</td>
            <td class="mono">${usc() ? fx(row.idMm * K.inch, 3) : fx(row.idMm, 1)}</td>
            <td class="mono">${usc() ? fx(row.vmMS * K.ft, 1) : fx(row.vmMS, 2)}</td>
            <td>${badge(st, fx(row.veRatio, 2))}</td>
            <td class="mono">${usc() ? fx(row.dp100Bar * K.psi / K.ft, 3) : fx(row.dp100Bar, 4)}</td>
            <td>${esc(row.regime)}</td><td class="mono">${fx(row.HL, 3)}</td></tr>`;
        }).join('')}</tbody></table></div>
        <div class="tp-note">Same fluids, length, Δz and schedule for every row. ${badge('pass', 'OK')} 10 ft/s ≤ vm ≤ Ve · ${badge('warn', 'LOW')} vm &lt; 10 ft/s (slugging risk) · ${badge('fail', '&gt;1')} vm &gt; Ve. Click a row to select that size.</div>`;
      scanHost.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => {
        state.nps = tr.dataset.nps; delete state.idMm; renderInputs(); recompute();
      }));
    }
    const tr = pane.querySelector('#twophase-trace');
    if (tr) tr.innerHTML = traceHtml(r);
  }

  function recompute() {
    if (!pane) return;
    renderOutputs(calc(state));
    if (ctx && ctx.notifyChanged) ctx.notifyChanged();
  }

  function pullVessel() {
    const msg = pane.querySelector('#twophase-pull-msg');
    let v = null;
    try { v = ctx && ctx.getVesselResult ? ctx.getVesselResult() : null; } catch (_) { v = null; }
    const f = v && v.flows;
    if (!f || !(f.W_vapKgHr > 0) || !(f.rhoV > 0)) { if (msg) msg.textContent = 'No Step 0 vessel result available.'; return; }
    const wO = Number(f.W_liqKgHr) || 0, wW = Number(f.W_watKgHr) || 0;
    const wL = wO + wW;
    const qL = wO / (Number(f.rhoL) || 800) + wW / (Number(f.rhoW) || 1000);
    Object.assign(state, { wGasKgHr: f.W_vapKgHr, rhoG: f.rhoV, wLiqKgHr: Math.max(0.01, wL), rhoL: wL > 0 && qL > 0 ? wL / qL : (Number(f.rhoL) || state.rhoL) });
    if (Number.isFinite(Number(v.operatingPressureBarg))) state.pInBarg = Number(v.operatingPressureBarg);
    if (msg) msg.textContent = `Pulled vapour/liquid flows, densities and operating pressure from ${v.vesselTag || 'Step 0 vessel'} (liquid includes any water phase; viscosities and σ unchanged).`;
    renderInputs(); recompute();
  }

  function mount(container, c) {
    pane = container; ctx = c;
    injectStyle();
    container.innerHTML = `
      <div class="panel" style="margin-bottom:1.25rem;">
        <div class="panel-header">
          <div><div class="panel-title">Two-Phase Gas-Liquid Line Sizing</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">Beggs &amp; Brill (1973) + Payne et al. (1979) · Homogeneous no-slip · API RP 14E erosional velocity — screening, single segment</div></div>
          <div class="tp-hdr-ctl">
            <label for="twophase-preset" style="font-size:0.76rem;font-weight:700;color:var(--text-secondary);">Preset:</label>
            <select id="twophase-preset" class="header-select" style="background:var(--bg-surface);color:var(--text-primary);border-color:var(--border-strong);">
              <option value="">— select —</option>${presets.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select>
            <button type="button" id="twophase-pull" class="btn btn-secondary" title="Use Step 0 vessel vapour/liquid flows and densities for the separator inlet line">Pull from Step 0 vessel</button>
          </div>
        </div>
        <div id="twophase-pull-msg" class="tp-note" style="margin:0;padding:0 1rem;"></div>
      </div>
      <div class="tp-grid">
        <div class="panel"><div class="panel-header"><div class="panel-title">1. Fluids, Line &amp; Criteria</div><span class="panel-std-ref">API RP 14E</span></div>
          <div class="panel-body" id="twophase-inputs"></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">2. Results &amp; Beggs-Brill Flow-Pattern Map</div><span class="panel-std-ref">Beggs-Brill</span></div>
          <div class="panel-body" id="twophase-outputs"></div></div>
      </div>
      <div class="panel" style="margin-bottom:1.25rem;"><div class="panel-header"><div class="panel-title">3. NPS Scan (2"–24")</div><span class="panel-std-ref">Click row to select</span></div>
        <div class="panel-body" id="twophase-scan"></div></div>
      <div class="panel"><div class="panel-header"><div class="panel-title">4. Whitebox Calculation Trace</div><span class="panel-std-ref">B&amp;B 1973 · Brill &amp; Mukherjee 1999 · API RP 14E</span></div>
        <div class="panel-body"><div class="eq-step-list" id="twophase-trace"></div></div></div>`;
    container.querySelector('#twophase-preset').addEventListener('change', (e) => {
      const p = presets.find(x => x.id === e.target.value);
      if (p) setState(JSON.parse(JSON.stringify(p.state)));
    });
    container.querySelector('#twophase-pull').addEventListener('click', pullVessel);
    if (c && c.onUnitChange) c.onUnitChange(() => { renderInputs(); recompute(); });
    renderInputs();
    recompute();
  }

  function getState() { return JSON.parse(JSON.stringify(state)); }
  function setState(s) {
    state = Object.assign(defaultState(), s || {});
    if (pane) { renderInputs(); recompute(); }
  }

  function summaryRows() {
    const r = calc(state), b = r.bb;
    return [
      ['Line size', `NPS ${r.nps} ${r.schedule}`, `ID ${fx(r.idMm, 1)} mm, L = ${fx(r.input.lengthM, 1)} m, Δz = ${fx(r.input.elevM, 1)} m`],
      ['Flow regime (Beggs-Brill)', b.regime, `λL = ${fx(b.lam, 3)}, NFr = ${fe(b.NFr)}`],
      ['Liquid holdup HL (Payne-corrected)', fx(b.HL, 3), '-'],
      ['ΔP total (Beggs-Brill)', fx(r.dpTotBar, 4), `bar (${fx(r.dpTotPct, 1)}% of inlet abs.)`],
      ['ΔP friction / elevation', `${fx(r.dpFBar, 4)} / ${fx(r.dpElBar, 4)}`, 'bar'],
      ['ΔP homogeneous model', fx(r.homog.dpTotBar, 4), 'bar'],
      ['Mixture velocity vm', fx(b.vm, 2), 'm/s'],
      ['API RP 14E erosional velocity Ve', fx(r.veMS, 2), `m/s (C = ${r.input.cFactor}) — ${r.erosionPass ? 'PASS' : 'FAIL'}`],
      ['Mixture momentum ρv²', fx(r.rhoV2, 0), 'Pa']
    ];
  }

  const tool = {
    id: 'twophase',
    title: 'Two-Phase Line Sizing',
    std: 'Beggs-Brill · API RP 14E',
    presets, calc, defaultState, mount, getState, setState, summaryRows,
    // pure helpers exposed for tests
    beggsBrill, bbBoundaries, bbRegime, churchill, erosionalVelocityFtS
  };

  if (typeof window !== 'undefined' && window.PSVTools) window.PSVTools.register(tool);
  if (typeof module !== 'undefined' && module.exports) module.exports = tool;
})();
