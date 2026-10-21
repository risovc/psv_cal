/**
 * PSVCalc Pro — Step 7 toolkit module "api2000":
 * Atmospheric & low-pressure storage tank venting per API Std 2000 7th Ed. (2014) / ISO 28300:2008.
 *
 *  Normal venting (§3.3.2, non-refrigerated aboveground tanks)
 *    Liquid movement (§3.3.2.2):  V_op = V_pf (×2.0 if flash point < 37.8 °C or NBP < 149 °C), V_ip = V_pe
 *    Thermal (§3.3.2.3):          V_OT = Y·V_tk^0.9·R_i   V_IT = C·V_tk^0.7·R_i   [Nm³/h air, V_tk in m³]
 *    Insulation:                  R_in = 1/(1 + h·l_in/λ_in), h = 4 W/(m²·K);  R_inp = f·R_in + (1 − f)
 *  Emergency (fire) venting (§3.3.3)
 *    Wetted area: vertical tank shell up to 9.14 m (30 ft) above grade
 *    Heat input Q: Table 7 piecewise (SI W / USC BTU/h)
 *    Environmental factor F: Table 9 (bare 1.0, impoundment 0.5, earth-covered 0.03, underground 0,
 *                            insulated F = U·(1660 − T_f)/21 000 USC ≡ U·(904 − T_f)/66 245 SI)
 *    q = 906.6·Q·F/L·√(T/M)  [SI: Nm³/h air, Q kW (=W with L in J/kg), L kJ/kg, T K]
 *    q = 3.091·Q·F/L·√(T/M)  [USC: SCFH air, Q BTU/h, L BTU/lb, T °R]
 *  All internal state is SI canonical (m, m³, m³/h, °C, mbarg, kJ/kg, mm, W/(m·K)).
 */
(function () {
  const WET_LIMIT_M = 9.144;           // 30 ft above grade (API 2000 §3.3.3, vertical tanks)
  const H_IN = 4;                      // W/(m²·K) inside heat-transfer coefficient for R_in
  const NM3_TO_SCF = 35.3146667 * (288.706 / 273.15); // 1 Nm³ (0 °C, 1 atm) = 37.326 SCF (60 °F, 14.696 psia)
  const RHO_AIR = 1.225, RHO_AIR_N = 1.2929;          // kg/m³ at 15 °C / at 0 °C, 1 atm
  const KD_EFF = 0.5;                  // indicative effective discharge coefficient (screening only)
  const PV_DN = [50, 80, 100, 150, 200, 250, 300];
  const EV_DN = [500, 600];

  const Y_FACTOR = { lt42: 0.32, '42to58': 0.25, gt58: 0.20 };
  // C-factor: [hexane-like VP & avg storage T < 25 °C, hexane-like & T ≥ 25 °C, VP higher than hexane / unknown]
  const C_FACTOR = { lt42: [4, 6.5, 6.5], '42to58': [3, 5, 5], gt58: [2.5, 4, 4] };
  const LAT_LABEL = { lt42: 'Below 42°', '42to58': '42° – 58°', gt58: 'Above 58°' };
  const F_LABEL = { bare: 'Bare metal tank', insulated: 'Fire-proof insulation (U-based)', impound: 'Remote impoundment (drainage away)', earth: 'Earth-covered', underground: 'Underground' };

  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const pick = (v, list, d) => (list.includes(v) ? v : d);

  function defaultState() {
    return {
      geomMode: 'dims', diameterM: 20, heightM: 14.6, capacityM3: 4587,
      pumpInM3h: 400, pumpOutM3h: 350, designPmbarg: 20, designVacMbarg: 6, latBand: 'lt42',
      flashPointC: -40, nbpC: 35, storageTempC: 28, vpClass: 'higher', latentKjKg: 334.9, mw: 86.17,
      insulThkMm: 0, insulLambda: 0.04, insulFracPct: 100, fireCredit: 'bare', frangibleRoof: false
    };
  }

  function sanitize(inp) {
    const d = defaultState(), s = Object.assign({}, d, inp || {});
    return {
      geomMode: pick(s.geomMode, ['dims', 'capacity'], d.geomMode),
      diameterM: num(s.diameterM, d.diameterM, 0.5, 120), heightM: num(s.heightM, d.heightM, 0.5, 40),
      capacityM3: num(s.capacityM3, d.capacityM3, 0.1, 300000),
      pumpInM3h: num(s.pumpInM3h, d.pumpInM3h, 0, 50000), pumpOutM3h: num(s.pumpOutM3h, d.pumpOutM3h, 0, 50000),
      designPmbarg: num(s.designPmbarg, d.designPmbarg, 1, 2000), designVacMbarg: num(s.designVacMbarg, d.designVacMbarg, 0.5, 500),
      latBand: pick(s.latBand, Object.keys(Y_FACTOR), d.latBand),
      flashPointC: num(s.flashPointC, d.flashPointC, -100, 400), nbpC: num(s.nbpC, d.nbpC, -50, 600),
      storageTempC: num(s.storageTempC, d.storageTempC, -50, 300), vpClass: pick(s.vpClass, ['hexane', 'higher'], d.vpClass),
      latentKjKg: num(s.latentKjKg, d.latentKjKg, 20, 3000), mw: num(s.mw, d.mw, 2, 1000),
      insulThkMm: num(s.insulThkMm, d.insulThkMm, 0, 500), insulLambda: num(s.insulLambda, d.insulLambda, 0.01, 2),
      insulFracPct: num(s.insulFracPct, d.insulFracPct, 0, 100),
      fireCredit: pick(s.fireCredit, Object.keys(F_LABEL), d.fireCredit), frangibleRoof: !!s.frangibleRoof
    };
  }

  /** API 2000 Table 7 heat input, SI form. A in m², design pressure in kPa(g). Returns { Q (W), eq }. */
  function heatInputSI(A, pKpa) {
    if (A < 18.6) return { Q: 63150 * A, eq: 'Q = 63 150·A', branch: 'A < 18.6 m²' };
    if (A < 93) return { Q: 224200 * Math.pow(A, 0.566), eq: 'Q = 224 200·A^0.566', branch: '18.6 ≤ A < 93 m²' };
    if (A < 260) return { Q: 630400 * Math.pow(A, 0.338), eq: 'Q = 630 400·A^0.338', branch: '93 ≤ A < 260 m²' };
    if (pKpa <= 7) return { Q: 4129700, eq: 'Q = 4 129 700 (constant)', branch: 'A ≥ 260 m², P ≤ 7 kPa' };
    return { Q: 43200 * Math.pow(A, 0.82), eq: 'Q = 43 200·A^0.82', branch: 'A ≥ 260 m², 7 < P ≤ 103.4 kPa' };
  }
  /** API 2000 Table 7 heat input, USC form. A in ft², design pressure in psig. Returns Q in BTU/h. */
  function heatInputUSC(A, pPsig) {
    if (A < 200) return 20000 * A;
    if (A < 1000) return 199300 * Math.pow(A, 0.566);
    if (A < 2800) return 963400 * Math.pow(A, 0.338);
    return pPsig <= 1 ? 14090000 : 21000 * Math.pow(A, 0.82);
  }
  /** API 2000 §3.3.3 emergency venting, SI: Nm³/h air. Q in W, L in kJ/kg, T in K. */
  const emergencySI = (Qw, F, L, T, M) => 906.6 * (Qw / 1000) * F / L * Math.sqrt(T / M);
  /** API 2000 §3.3.3 emergency venting, USC: SCFH air. Q in BTU/h, L in BTU/lb, T in °R. */
  const emergencyUSC = (Q, F, L, T, M) => 3.091 * Q * F / L * Math.sqrt(T / M);

  /** Indicative vent capacity (Nm³/h air) of one DN opening at ΔP (mbar): incompressible orifice, Kd_eff = 0.5. */
  function ventCapacity(dnMm, dpMbar) {
    const A = Math.PI * Math.pow(dnMm / 1000, 2) / 4;
    return KD_EFF * A * Math.sqrt(2 * dpMbar * 100 * RHO_AIR) * 3600 / RHO_AIR_N;
  }

  function calc(input) {
    const s = sanitize(input);
    const D = s.diameterM, Ax = Math.PI * D * D / 4;
    const H = s.geomMode === 'capacity' ? Math.min(200, s.capacityM3 / Ax) : s.heightM;
    const V = Ax * H;
    // --- Normal venting (§3.3.2) ---
    const volatile = s.flashPointC < 37.8 || s.nbpC < 149;
    const outPump = s.pumpInM3h * (volatile ? 2 : 1);
    const inPump = s.pumpOutM3h;
    const insulated = s.insulThkMm > 0 && s.insulFracPct > 0;
    const Rin = insulated ? 1 / (1 + H_IN * (s.insulThkMm / 1000) / s.insulLambda) : 1;
    const f = insulated ? s.insulFracPct / 100 : 0;
    const Ri = insulated ? f * Rin + (1 - f) : 1;
    const Y = Y_FACTOR[s.latBand];
    const cIdx = s.vpClass === 'higher' ? 2 : (s.storageTempC < 25 ? 0 : 1);
    const C = C_FACTOR[s.latBand][cIdx];
    const outTherm = Y * Math.pow(V, 0.9) * Ri, inTherm = C * Math.pow(V, 0.7) * Ri;
    const outTotal = outPump + outTherm, inTotal = inPump + inTherm;
    // --- Emergency venting (§3.3.3) ---
    const hWet = Math.min(H, WET_LIMIT_M), Awet = Math.PI * D * hWet;
    const pKpa = s.designPmbarg / 10;
    const heat = heatInputSI(Awet, pKpa);
    const Tf = s.nbpC, TK = s.nbpC + 273.15;
    const U = insulated ? s.insulLambda / (s.insulThkMm / 1000) : 0;
    let F = 1, Fnote = 'F = 1.0 (bare metal, Table 9)';
    if (s.fireCredit === 'impound') { F = 0.5; Fnote = 'F = 0.5 (impoundment away from tank, Table 9)'; }
    else if (s.fireCredit === 'earth') { F = 0.03; Fnote = 'F = 0.03 (earth-covered storage, Table 9)'; }
    else if (s.fireCredit === 'underground') { F = 0; Fnote = 'F = 0 (underground storage, Table 9)'; }
    else if (s.fireCredit === 'insulated') {
      if (insulated && s.insulFracPct >= 100) { F = Math.min(1, Math.max(0.025, U * (904 - Tf) / 66245)); Fnote = `F = max(0.025, U·(904 − T_f)/66 245) with U = λ/l = ${U.toFixed(3)} W/m²K, T_f = ${Tf.toFixed(1)} °C (floor = lowest Table 9 insulation entry)`; }
      else Fnote = 'F = 1.0 — insulation credit needs 100 % fire-proof coverage';
    }
    const Wkgh = s.frangibleRoof ? 0 : heat.Q * F * 3.6 / s.latentKjKg;
    const qEm = s.frangibleRoof ? 0 : emergencySI(heat.Q, F, s.latentKjKg, TK, s.mw);
    const qHexane = s.frangibleRoof ? 0 : emergencySI(heat.Q, F, 334.9, 288.7, 86.17);
    // --- Indicative device screening ---
    let pv = null;
    for (const dn of PV_DN) {
      const capP = ventCapacity(dn, s.designPmbarg), capV = ventCapacity(dn, s.designVacMbarg);
      const n = Math.max(1, Math.ceil(outTotal / capP), Math.ceil(inTotal / capV));
      pv = { dn, n, capP, capV };
      if (n <= 2) break;
    }
    const pvCredit = pv.n * pv.capP;
    const evNeed = Math.max(0, qEm - pvCredit);
    let ev = { dn: 0, n: 0, cap: 0 };
    if (evNeed > 0) for (const dn of EV_DN) { const cap = ventCapacity(dn, s.designPmbarg); ev = { dn, n: Math.max(1, Math.ceil(evNeed / cap)), cap }; if (ev.n <= 2) break; }
    const inScope = s.designPmbarg <= 1034;
    return {
      input: s, D, H, V, volatile, outPump, inPump, Rin, Ri, Y, C, cIdx, outTherm, inTherm, outTotal, inTotal,
      hWet, Awet, heatQ: heat.Q, heatEq: heat.eq, heatBranch: heat.branch, U, F, Fnote, TK, Wkgh, qEm, qHexane,
      pv, pvCredit, evNeed, ev, inScope
    };
  }

  // ---------------------------------------------------------------- units (DOM boundary only)
  const KIND = {
    len: ['m', 'ft', 3.280839895], vol: ['m³', 'bbl', 6.28981077], vflow: ['m³/h', 'bbl/h', 6.28981077],
    pmb: ['mbarg', 'inH₂O', 0.401463], thk: ['mm', 'in', 1 / 25.4], lam: ['W/m·K', 'BTU·in/h·ft²·°F', 6.933472],
    lat: ['kJ/kg', 'BTU/lb', 0.4299226], air: ['Nm³/h', 'SCFH', NM3_TO_SCF], area: ['m²', 'ft²', 10.7639104],
    heat: ['kW', 'MMBTU/h', 0.00341214], kgh: ['kg/h', 'lb/h', 2.20462262], pct: ['%', '%', 1], none: ['', '', 1]
  };
  let ctxRef = null, root = null, state = defaultState(), lastMsg = '';
  const usc = () => !!(ctxRef && ctxRef.isUSC && ctxRef.isUSC());
  const toDisp = (k, v) => (k === 'temp' ? (usc() ? v * 1.8 + 32 : v) : (usc() ? v * KIND[k][2] : v));
  const fromDisp = (k, v) => (k === 'temp' ? (usc() ? (v - 32) / 1.8 : v) : (usc() ? v / KIND[k][2] : v));
  const unit = (k) => (k === 'temp' ? (usc() ? '°F' : '°C') : KIND[k][usc() ? 1 : 0]);
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
  const show = (k, v, d = 1) => `${fmt(toDisp(k, v), d)} ${unit(k)}`.trim();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const presets = [
    { id: 'tk101', label: 'TK-101 Naphtha fixed-roof tank (Ø20 × 14.6 m, tropics)', state: defaultState() },
    { id: 'tk305', label: 'TK-305 Insulated heated fuel-oil tank (Ø8 × 10 m, >58°)', state: Object.assign(defaultState(), {
      diameterM: 8, heightM: 10, pumpInM3h: 60, pumpOutM3h: 80, designPmbarg: 50, designVacMbarg: 5, latBand: 'gt58',
      flashPointC: 95, nbpC: 300, storageTempC: 70, vpClass: 'hexane', latentKjKg: 230, mw: 250,
      insulThkMm: 100, insulLambda: 0.045, insulFracPct: 100, fireCredit: 'insulated' }) },
    { id: 'tk410', label: 'TK-410 Methanol day tank (Ø4 × 6 m, remote impounding)', state: Object.assign(defaultState(), {
      diameterM: 4, heightM: 6, pumpInM3h: 40, pumpOutM3h: 30, designPmbarg: 75, designVacMbarg: 8, latBand: 'lt42',
      flashPointC: 11, nbpC: 64.7, storageTempC: 30, vpClass: 'higher', latentKjKg: 1100, mw: 32.04, fireCredit: 'impound' }) },
    { id: 'tk201', label: 'TK-201 Diesel tank, frangible roof (Ø30 × 18 m, 42–58°)', state: Object.assign(defaultState(), {
      diameterM: 30, heightM: 18, pumpInM3h: 600, pumpOutM3h: 500, designPmbarg: 7.5, designVacMbarg: 2.5, latBand: '42to58',
      flashPointC: 62, nbpC: 180, storageTempC: 15, vpClass: 'hexane', latentKjKg: 250, mw: 170, frangibleRoof: true }) }
  ];

  const FIELDS = [
    ['Tank geometry', 'API 650', [
      ['diameterM', 'Shell diameter', 'D', 'len', 0.1], ['heightM', 'Shell height', 'H', 'len', 0.1],
      ['capacityM3', 'Geometric capacity', 'V_tk', 'vol', 1]]],
    ['Operation & design', 'API 2000 §3.3.2.2', [
      ['pumpInM3h', 'Max pump-in rate', 'V̇_pf', 'vflow', 1], ['pumpOutM3h', 'Max pump-out rate', 'V̇_pe', 'vflow', 1],
      ['designPmbarg', 'Design pressure', 'P_d', 'pmb', 0.5], ['designVacMbarg', 'Design vacuum', 'P_v', 'pmb', 0.5]]],
    ['Stored liquid', 'API 2000 §3.3.2 / §3.3.3', [
      ['flashPointC', 'Flash point', 'T_FP', 'temp', 1], ['nbpC', 'Normal boiling point (= T relief)', 'T_b', 'temp', 1],
      ['storageTempC', 'Avg. storage temperature', 'T_st', 'temp', 1], ['latentKjKg', 'Latent heat at relief', 'L', 'lat', 1],
      ['mw', 'Vapour molecular weight', 'M', 'none', 0.1]]],
    ['Insulation & fire credits', 'API 2000 §3.3.2.3 / Table 9', [
      ['insulThkMm', 'Insulation thickness (0 = none)', 'l_in', 'thk', 5], ['insulLambda', 'Insulation conductivity', 'λ_in', 'lam', 0.005],
      ['insulFracPct', 'Insulated fraction of shell+roof', 'f', 'pct', 5]]]
  ];
  const SELECTS = {
    geomMode: [['dims', 'D × H given'], ['capacity', 'D + capacity given']],
    latBand: Object.entries(LAT_LABEL),
    vpClass: [['hexane', 'Hexane-like or lower VP'], ['higher', 'VP higher than hexane / unknown']],
    fireCredit: Object.entries(F_LABEL)
  };

  function selectHtml(key, label) {
    return `<div class="field-group"><label class="field-label" for="api2000-${key}"><span>${esc(label)}</span></label>
      <div class="input-with-unit"><select id="api2000-${key}" data-key="${key}">${SELECTS[key].map(([v, t]) =>
        `<option value="${esc(v)}" ${state[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div></div>`;
  }

  function renderInputs() {
    const host = root && root.querySelector('#api2000-inputs');
    if (!host) return;
    const extra = { 0: selectHtml('geomMode', 'Geometry basis'), 1: selectHtml('latBand', 'Latitude band (Y, C factors)'),
      2: selectHtml('vpClass', 'Vapour-pressure class (C factor)'),
      3: selectHtml('fireCredit', 'Environmental factor F (Table 9)') + `<div class="field-group api2000-span2"><label class="field-label" for="api2000-frangibleRoof">
        <span><input type="checkbox" id="api2000-frangibleRoof" data-key="frangibleRoof" ${state.frangibleRoof ? 'checked' : ''}/> Frangible (weak) roof-to-shell seam (API 650)</span></label></div>` };
    host.innerHTML = FIELDS.map(([title, ref, fields], i) => `
      <div class="panel" style="margin-bottom:1rem;"><div class="panel-header"><div class="panel-title">${i + 1}. ${esc(title)}</div><span class="panel-std-ref">${esc(ref)}</span></div>
      <div class="panel-body"><div class="form-grid-2">${extra[i]}${fields.map(([key, label, sym, kind, step]) => `
        <div class="field-group"><label class="field-label" for="api2000-${key}"><span>${esc(label)}</span><span class="field-sym">${esc(sym)}</span></label>
          <div class="input-with-unit"><input type="number" id="api2000-${key}" data-key="${key}" data-kind="${kind}" step="${step}" value="${+toDisp(kind, state[key]).toFixed(kind === 'lam' ? 4 : 2)}"/>
          ${unit(kind) ? `<span class="unit-addon">${esc(unit(kind))}</span>` : ''}</div></div>`).join('')}</div></div></div>`).join('');
    syncDerivedInput(calc(state));
  }

  function syncDerivedInput(r) {
    const derived = state.geomMode === 'capacity' ? ['heightM', 'len', r.H] : ['capacityM3', 'vol', r.V];
    const other = state.geomMode === 'capacity' ? 'capacityM3' : 'heightM';
    const el = root.querySelector(`#api2000-${derived[0]}`), o = root.querySelector(`#api2000-${other}`);
    if (el) { el.readOnly = true; el.title = 'Derived'; el.style.opacity = '0.6'; el.value = +toDisp(derived[1], derived[2]).toFixed(2); }
    if (o) { o.readOnly = false; o.title = ''; o.style.opacity = ''; }
  }

  function badge(cls, text) { return `<span class="status-badge status-${cls}">${esc(text)}</span>`; }

  function tankSvg(r) {
    const s = r.input, G = 282, sc = Math.min(185 / r.H, 250 / r.D);
    const w = Math.max(70, r.D * sc), h = Math.max(50, r.H * sc), x0 = 280 - w / 2, top = G - h, roof = Math.max(10, w * 0.09);
    const hw = h * r.hWet / r.H, t = 'style="fill:var(--text-secondary)"', tp = 'style="fill:var(--text-primary)"';
    const flames = Array.from({ length: 7 }, (_, i) => { const fx = x0 - 20 + i * (w + 40) / 6;
      return `<path d="M${fx - 7},${G} Q${fx - 6},${G - 14} ${fx},${G - 22} Q${fx + 6},${G - 12} ${fx + 7},${G} Z" fill="rgba(249,115,22,0.55)"/>`; }).join('');
    const cut = r.H > WET_LIMIT_M ? `<line x1="${x0 - 14}" y1="${G - hw}" x2="${x0 + w + 14}" y2="${G - hw}" stroke="rgba(220,38,38,0.9)" stroke-dasharray="5 4"/>
      <text x="${x0 + w - 4}" y="${G - hw - 4}" font-size="9.5" text-anchor="end" style="fill:var(--fail-text)">9.14 m (30 ft) fire-zone limit</text>` : '';
    const pvTxt = `PV ${r.pv.n}× DN${r.pv.dn}`, evTxt = s.frangibleRoof ? 'Frangible seam' : (r.ev.n ? `EV ${r.ev.n}× DN${r.ev.dn}` : 'EV: PV credit');
    const arrow = (x1, y, x2, col) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${col}" stroke-width="3" marker-end="url(#api2000-ah)"/>`;
    return `<svg id="api2000-tank-svg" viewBox="0 0 560 320" width="100%" role="img" aria-label="Tank venting schematic" style="max-height:330px;color:var(--text-primary);">
      <defs><marker id="api2000-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>
      <circle cx="38" cy="34" r="13" fill="rgba(234,179,8,0.55)"/><text x="58" y="30" font-size="10" ${t}>Thermal (Y/C)</text>
      <text x="58" y="43" font-size="10" ${t}>out ${esc(show('air', r.outTherm, 0))} · in ${esc(show('air', r.inTherm, 0))}</text>
      <line x1="20" y1="${G}" x2="540" y2="${G}" stroke="currentColor" stroke-width="1.5"/>
      ${flames}
      <rect x="${x0}" y="${top}" width="${w}" height="${h}" fill="rgba(2,132,199,0.10)" stroke="currentColor" stroke-width="1.5"/>
      <rect x="${x0}" y="${G - hw}" width="${w}" height="${hw}" fill="rgba(220,38,38,0.20)"/>
      <text x="${x0 + w / 2}" y="${G - hw / 2 + 4}" font-size="10" text-anchor="middle" ${tp}>A_ws = ${esc(show('area', r.Awet, 0))}</text>
      ${cut}
      <polygon points="${x0},${top} ${x0 + w / 2},${top - roof} ${x0 + w},${top}" fill="rgba(2,132,199,0.18)" stroke="currentColor" stroke-width="1.5"/>
      <rect x="${x0 + w * 0.22 - 7}" y="${top - roof * 0.45 - 14}" width="14" height="12" fill="rgba(22,163,74,0.55)" stroke="currentColor"/>
      <line x1="${x0 + w * 0.22 - 3}" y1="${top - roof * 0.45 - 16}" x2="${x0 + w * 0.22 - 3}" y2="${top - roof * 0.45 - 44}" stroke="rgba(220,38,38,0.85)" stroke-width="2.5" marker-end="url(#api2000-ah)"/>
      <line x1="${x0 + w * 0.22 + 4}" y1="${top - roof * 0.45 - 44}" x2="${x0 + w * 0.22 + 4}" y2="${top - roof * 0.45 - 16}" stroke="rgba(2,132,199,0.9)" stroke-width="2.5" marker-end="url(#api2000-ah)"/>
      <text x="${x0 + w * 0.22 - 12}" y="${top - roof * 0.45 - 34}" font-size="10" text-anchor="end" ${tp}>${esc(pvTxt)}</text>
      <text x="${x0 + w * 0.22 - 12}" y="${top - roof * 0.45 - 22}" font-size="9.5" text-anchor="end" ${t}>↑ ${esc(show('air', r.outTotal, 0))} ↓ ${esc(show('air', r.inTotal, 0))}</text>
      <rect x="${x0 + w * 0.72 - 10}" y="${top - roof * 0.45 - 12}" width="20" height="8" fill="rgba(249,115,22,0.6)" stroke="currentColor"/>
      <text x="${x0 + w * 0.72 + 14}" y="${top - roof * 0.45 - 18}" font-size="10" ${tp}>${esc(evTxt)}</text>
      <text x="${x0 + w * 0.72 + 14}" y="${top - roof * 0.45 - 6}" font-size="9.5" ${t}>${esc(s.frangibleRoof ? 'no EV device req.' : 'q = ' + show('air', r.qEm, 0))}</text>
      ${arrow(24, G - 24, x0 - 2, 'rgba(2,132,199,0.9)')}<text x="24" y="${G - 32}" font-size="10" ${tp}>Pump-in ${esc(show('vflow', s.pumpInM3h, 0))}</text>
      ${arrow(x0 + w + 2, G - 24, 536, 'rgba(22,163,74,0.9)')}<text x="536" y="${G - 32}" font-size="10" text-anchor="end" ${tp}>Pump-out ${esc(show('vflow', s.pumpOutM3h, 0))}</text>
      <text x="${x0 + w / 2}" y="${G + 16}" font-size="10" text-anchor="middle" ${t}>D = ${esc(show('len', r.D, 1))} · H = ${esc(show('len', r.H, 1))} · V_tk = ${esc(show('vol', r.V, 0))}</text>
      <text x="${x0 + w / 2}" y="${G + 30}" font-size="9.5" text-anchor="middle" ${t}>${esc(s.frangibleRoof ? 'Pool fire (frangible roof relieves emergency)' : 'Pool fire · heat to wetted shell ≤ 9.14 m')}</text>
    </svg>`;
  }

  function barSvg(r) {
    const rows = [['Outbreathing', [[r.outPump, 'rgba(2,132,199,0.75)'], [r.outTherm, 'rgba(234,179,8,0.75)']]],
      ['Inbreathing', [[r.inPump, 'rgba(22,163,74,0.75)'], [r.inTherm, 'rgba(234,179,8,0.75)']]],
      ['Emergency (fire)', [[r.qEm, 'rgba(220,38,38,0.7)']]]];
    const max = Math.max(1, ...rows.map(([, seg]) => seg.reduce((a, [v]) => a + v, 0))), X0 = 130, W = 290;
    const t = 'style="fill:var(--text-secondary)"';
    return `<svg id="api2000-bar-svg" viewBox="0 0 560 175" width="100%" role="img" aria-label="Venting contributions" style="max-height:200px;color:var(--text-primary);">
      ${rows.map(([lab, seg], i) => { let x = X0; const y = 14 + i * 40, tot = seg.reduce((a, [v]) => a + v, 0);
        return `<text x="${X0 - 8}" y="${y + 16}" font-size="11" text-anchor="end" style="fill:var(--text-primary)">${lab}</text>
        <rect x="${X0}" y="${y}" width="${W}" height="24" fill="rgba(127,127,127,0.08)"/>` +
        seg.map(([v, c]) => { const ww = W * v / max; const out = `<rect x="${x}" y="${y}" width="${Math.max(0, ww)}" height="24" fill="${c}"/>`; x += ww; return out; }).join('') +
        `<text x="${X0 + W + 8}" y="${y + 16}" font-size="11" ${t}>${esc(i === 2 && r.input.frangibleRoof ? 'N/A (frangible)' : show('air', tot, 0))}</text>`; }).join('')}
      ${[['Pump-in (out)', 'rgba(2,132,199,0.75)'], ['Pump-out (in)', 'rgba(22,163,74,0.75)'], ['Thermal', 'rgba(234,179,8,0.75)'], ['Fire', 'rgba(220,38,38,0.7)']].map(([l, c], i) =>
        `<rect x="${X0 + i * 100}" y="148" width="11" height="11" fill="${c}"/><text x="${X0 + 15 + i * 100}" y="158" font-size="10" ${t}>${l}</text>`).join('')}
    </svg>`;
  }

  function renderOutputs() {
    if (!root) return;
    const r = calc(state), s = r.input;
    syncDerivedInput(r);
    const pvOk = r.pv.n <= 2;
    root.querySelector('#api2000-metrics').innerHTML = `
      <div class="metric-box"><span class="metric-box-label">Normal outbreathing</span><span class="metric-box-main">${show('air', r.outTotal, 0)}</span>
        <span class="metric-box-sub">pump ${show('air', r.outPump, 0)} + thermal ${show('air', r.outTherm, 0)}</span>
        <span style="margin-top:0.35rem;">${badge(r.inScope ? 'pass' : 'fail', r.inScope ? 'API 2000 scope' : 'P_d > 1034 mbarg: outside API 2000')}</span></div>
      <div class="metric-box"><span class="metric-box-label">Normal inbreathing</span><span class="metric-box-main">${show('air', r.inTotal, 0)}</span>
        <span class="metric-box-sub">pump ${show('air', r.inPump, 0)} + thermal ${show('air', r.inTherm, 0)}</span>
        <span style="margin-top:0.35rem;">${badge(pvOk ? 'pass' : 'warn', pvOk ? `PV ${r.pv.n}× DN${r.pv.dn} (indicative)` : `>2 PV valves (${r.pv.n}× DN${r.pv.dn})`)}</span></div>
      <div class="metric-box"><span class="metric-box-label">Emergency venting</span><span class="metric-box-main">${s.frangibleRoof ? 'Not required' : show('air', r.qEm, 0)}</span>
        <span class="metric-box-sub">${s.frangibleRoof ? 'frangible roof-to-shell seam' : `vapour ${show('kgh', r.Wkgh, 0)} · F = ${fmt(r.F, 3)}`}</span>
        <span style="margin-top:0.35rem;">${s.frangibleRoof ? badge('pass', 'Roof seam relieves') : (r.ev.n ? badge('warn', `EV ${r.ev.n}× DN${r.ev.dn} needed`) : badge('pass', 'Covered by PV valves'))}</span></div>
      <div class="metric-box"><span class="metric-box-label">Wetted area & fire heat</span><span class="metric-box-main">${show('area', r.Awet, 1)}</span>
        <span class="metric-box-sub">Q = ${show('heat', r.heatQ / 1000, usc() ? 2 : 0)} · h_w = ${show('len', r.hWet, 2)}</span></div>`;
    root.querySelector('#api2000-tank').innerHTML = tankSvg(r);
    root.querySelector('#api2000-bars').innerHTML = barSvg(r);
    root.querySelector('#api2000-sizing').innerHTML = `
      <table class="eng-table"><thead><tr><th>Device</th><th>Required</th><th>Basis ΔP</th><th>Suggested</th><th>Indicative cap.</th></tr></thead><tbody>
        <tr class="row-governing"><td>PV valve — pressure</td><td class="mono">${show('air', r.outTotal, 0)}</td><td class="mono">${show('pmb', s.designPmbarg, 1)}</td>
          <td class="mono" rowspan="2">${r.pv.n}× DN${r.pv.dn}</td><td class="mono">${show('air', r.pv.n * r.pv.capP, 0)}</td></tr>
        <tr class="row-governing"><td>PV valve — vacuum</td><td class="mono">${show('air', r.inTotal, 0)}</td><td class="mono">${show('pmb', s.designVacMbarg, 1)}</td>
          <td class="mono">${show('air', r.pv.n * r.pv.capV, 0)}</td></tr>
        <tr><td>Emergency vent (net of PV credit)</td><td class="mono">${s.frangibleRoof ? 'N/A' : show('air', r.evNeed, 0)}</td><td class="mono">${show('pmb', s.designPmbarg, 1)}</td>
          <td class="mono">${s.frangibleRoof ? 'Frangible roof' : (r.ev.n ? `${r.ev.n}× DN${r.ev.dn}` : 'None (PV credit)')}</td><td class="mono">${r.ev.n ? show('air', r.ev.n * r.ev.cap, 0) : '—'}</td></tr>
      </tbody></table>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.45rem;">Screening only: capacities assume a full-open orifice with effective K<sub>d</sub> = ${KD_EFF} at ΔP = design pressure / vacuum
        (incompressible air, ρ = ${RHO_AIR} kg/m³). Final selection must use certified vendor flow curves (API 2000 §4 / ISO 28300 §7) incl. set pressure and overpressure.</div>`;
    const lat = LAT_LABEL[s.latBand], cCol = ['hexane-like, T_st < 25 °C', 'hexane-like, T_st ≥ 25 °C', 'VP > hexane / unknown'][r.cIdx];
    const qUSC = emergencyUSC(r.heatQ * 3.412142, r.F, s.latentKjKg * 0.4299226, r.TK * 1.8, s.mw);
    root.querySelector('#api2000-trace').innerHTML = `
      <div class="eq-step-card"><div class="eq-step-header">1. Liquid movement — API 2000 §3.3.2.2</div>
        <div class="eq-symbolic">V̇_op = ${r.volatile ? '2.0·' : ''}V̇_pf  |  V̇_ip = V̇_pe   (1 m³/h liquid ≡ 1 Nm³/h air)</div>
        <div class="eq-substitution">${r.volatile ? `Volatile: T_FP = ${show('temp', s.flashPointC, 1)} < 37.8 °C or T_b = ${show('temp', s.nbpC, 1)} < 149 °C → ×2.0 for vapour generation` : 'Non-volatile: T_FP ≥ 37.8 °C and T_b ≥ 149 °C → ×1.0'}. (Annex A equivalents: 1.01 / 2.02 / 0.94 Nm³/h per m³/h.)</div>
        <div class="eq-result">V̇_op = ${show('air', r.outPump, 1)} · V̇_ip = ${show('air', r.inPump, 1)}</div></div>
      <div class="eq-step-card"><div class="eq-step-header">2. Thermal outbreathing — API 2000 §3.3.2.3.2 (Y-factor table)</div>
        <div class="eq-symbolic">V̇_OT = Y · V_tk^0.9 · R_i     R_in = 1/(1 + h·l_in/λ_in), h = 4 W/m²K;  R_inp = f·R_in + (1 − f)</div>
        <div class="eq-substitution">Y = ${r.Y} (${esc(lat)}), V_tk = ${fmt(r.V, 1)} m³, R_in = ${fmt(r.Rin, 4)}, R_i = ${fmt(r.Ri, 4)} → ${r.Y} × ${fmt(r.V, 1)}^0.9 × ${fmt(r.Ri, 4)}</div>
        <div class="eq-result">V̇_OT = ${show('air', r.outTherm, 1)} · Total outbreathing = ${show('air', r.outTotal, 1)}</div></div>
      <div class="eq-step-card"><div class="eq-step-header">3. Thermal inbreathing — API 2000 §3.3.2.3.3 (C-factor table)</div>
        <div class="eq-symbolic">V̇_IT = C · V_tk^0.7 · R_i</div>
        <div class="eq-substitution">C = ${r.C} (${esc(lat)}, ${esc(cCol)}) → ${r.C} × ${fmt(r.V, 1)}^0.7 × ${fmt(r.Ri, 4)}</div>
        <div class="eq-result">V̇_IT = ${show('air', r.inTherm, 1)} · Total inbreathing = ${show('air', r.inTotal, 1)}</div></div>
      <div class="eq-step-card"><div class="eq-step-header">4. Wetted area & fire heat input — API 2000 §3.3.3, Table 7</div>
        <div class="eq-symbolic">A_TWS = π·D·min(H, 9.14 m)  |  ${esc(r.heatEq)}  [${esc(r.heatBranch)}, Q in W]</div>
        <div class="eq-substitution">A_TWS = π × ${fmt(r.D, 2)} × ${fmt(r.hWet, 2)} = ${fmt(r.Awet, 1)} m²; P_d = ${fmt(s.designPmbarg / 10, 2)} kPa(g)${r.inScope ? '' : ' — above 103.4 kPa: use API 521 instead'}</div>
        <div class="eq-result">Q = ${fmt(r.heatQ / 1000, 1)} kW (${fmt(r.heatQ * 3.412142 / 1e6, 3)} MMBTU/h)</div></div>
      <div class="eq-step-card"><div class="eq-step-header">5. Emergency venting capacity — API 2000 §3.3.3 (Table 9 F)</div>
        <div class="eq-symbolic">q = 906.6 · Q·F / L · (T/M)^0.5   [Nm³/h air; Q kW, L kJ/kg, T K]   (USC: q = 3.091·Q·F/L·(T/M)^0.5 SCFH)</div>
        <div class="eq-substitution">${esc(r.Fnote)} → F = ${fmt(r.F, 3)}; q = 906.6 × ${fmt(r.heatQ / 1000, 1)} × ${fmt(r.F, 3)} / ${fmt(s.latentKjKg, 1)} × (${fmt(r.TK, 1)}/${fmt(s.mw, 2)})^0.5${s.frangibleRoof ? ' — not required: frangible roof-to-shell seam (API 650)' : ''}</div>
        <div class="eq-substitution">Cross-check USC form: ${fmt(qUSC, 0)} SCFH = ${fmt(qUSC / NM3_TO_SCF, 0)} Nm³/h (60 °F air basis; SI form is ${fmt(Math.sqrt(288.706 / 273.15) * 100 - 100, 1)} % higher due to 0 °C air reference). Hexane basis (Table 8: L = 334.9 kJ/kg, M = 86.17, 15.6 °C): ${s.frangibleRoof ? 'N/A' : fmt(r.qHexane, 0) + ' Nm³/h'}.</div>
        <div class="eq-result">q = ${s.frangibleRoof ? 'not required' : show('air', r.qEm, 0)} · PV credit ${show('air', r.pvCredit, 0)} → net EV ${s.frangibleRoof ? 'N/A' : show('air', r.evNeed, 0)}</div></div>`;
    const msg = root.querySelector('#api2000-msg'); if (msg) msg.textContent = lastMsg;
    if (ctxRef && ctxRef.notifyChanged) ctxRef.notifyChanged();
  }

  function onInput(ev) {
    const el = ev.target, key = el && el.dataset && el.dataset.key;
    if (!key) return;
    if (el.type === 'checkbox') state[key] = el.checked;
    else if (el.tagName === 'SELECT') {
      if (key === 'geomMode' && el.value !== state.geomMode) { const r = calc(state); state.heightM = +r.H.toFixed(4); state.capacityM3 = +r.V.toFixed(3); }
      state[key] = el.value;
    } else {
      if (el.readOnly) return;
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      state[key] = sanitize({ [key]: fromDisp(el.dataset.kind, v) })[key];
    }
    lastMsg = '';
    renderOutputs();
  }

  function applyState(st) { state = sanitize(st); if (root) { renderInputs(); renderOutputs(); } }

  function mount(container, ctx) {
    ctxRef = ctx; root = container;
    if (typeof document !== 'undefined' && !document.getElementById('style-api2000')) {
      const st = document.createElement('style'); st.id = 'style-api2000';
      st.textContent = `#toolPane-api2000 .api2000-svgbox{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0.6rem;margin-bottom:0.9rem;}
        #toolPane-api2000 svg text{font-family:var(--font-mono);}
        #toolPane-api2000 .api2000-note{font-size:0.72rem;color:var(--text-muted);margin-top:0.5rem;line-height:1.45;}
        #toolPane-api2000 .metric-box .status-badge{white-space:normal;}
        #toolPane-api2000 .form-grid-2>*{min-width:0;}
        #toolPane-api2000 .field-label span:first-child{min-width:0;overflow-wrap:anywhere;}
        #toolPane-api2000 .api2000-span2{grid-column:1/-1;}`;
      document.head.appendChild(st);
    }
    container.innerHTML = `
      <div class="panel" style="margin-bottom:1.25rem;"><div class="panel-header"><div>
          <div class="panel-title">Atmospheric & Low-Pressure Storage Tank Venting — Normal & Emergency</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">API Std 2000 7th Ed. (2014) / ISO 28300 — non-refrigerated aboveground vertical tanks, design pressure ≤ 103.4 kPa(g)</div></div>
        <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
          <label for="api2000-preset" style="font-size:0.76rem;font-weight:700;color:var(--text-secondary);">Tank preset:</label>
          <select id="api2000-preset" class="header-select">${presets.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select>
          <button type="button" id="api2000-pull" class="btn btn-secondary" title="Pull vapour MW and fire latent heat from the active PSV tag">← Pull MW & λ from PSV tag</button>
        </div></div>
        <div class="panel-body" style="padding-top:0.5rem;"><span id="api2000-msg" style="font-size:0.75rem;color:var(--text-secondary);"></span></div></div>
      <div class="workbench-grid"><div id="api2000-inputs"></div><div>
        <div class="panel" style="margin-bottom:1rem;"><div class="panel-header"><div class="panel-title">Required Venting Capacities (air equivalent)</div><span class="panel-std-ref">API 2000 §3.3</span></div>
          <div class="panel-body"><div id="api2000-metrics" class="metrics-summary-grid"></div></div></div>
        <div class="panel" style="margin-bottom:1rem;"><div class="panel-header"><div class="panel-title">Tank Schematic & Contribution Chart</div><span class="panel-std-ref">Live</span></div>
          <div class="panel-body"><div id="api2000-tank" class="api2000-svgbox"></div><div id="api2000-bars" class="api2000-svgbox"></div></div></div>
        <div class="panel" style="margin-bottom:1rem;"><div class="panel-header"><div class="panel-title">Indicative PV Valve & Emergency Vent Screening</div><span class="panel-std-ref">Screening</span></div>
          <div class="panel-body"><div id="api2000-sizing" class="table-responsive"></div></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Whitebox Calculation Trace</div><span class="panel-std-ref">API 2000 7th Ed.</span></div>
          <div class="panel-body"><div id="api2000-trace" style="display:flex;flex-direction:column;gap:0.75rem;"></div>
          <div class="api2000-note">Assumptions: Y = 0.32/0.25/0.20 and C = 4/6.5/6.5 (&lt;42°), 3/5/5 (42–58°), 2.5/4/4 (&gt;58°) per API 2000 7th Ed. normal-venting tables — verify against your licensed copy.
          Relieving vapour temperature T and fire liquid temperature T_f are taken as the normal boiling point. Wetted area counts the shell only (tank bottom on grade excluded).
          Water-spray gives no F credit (F = 1.0); insulation credit requires fire-resistant insulation withstanding hose streams. Refrigerated tanks, floating-roof tanks and design pressure &gt; 103.4 kPa(g) are outside this module.</div></div></div>
      </div></div>`;
    container.addEventListener('input', onInput);
    container.addEventListener('change', onInput);
    container.querySelector('#api2000-preset').addEventListener('change', (e) => {
      e.stopPropagation();
      const p = presets.find(x => x.id === e.target.value); if (p) { lastMsg = ''; applyState(JSON.parse(JSON.stringify(p.state))); }
    });
    container.querySelector('#api2000-pull').addEventListener('click', () => {
      const tag = ctxRef && ctxRef.getPsvTag ? ctxRef.getPsvTag() : null;
      const lam = tag && tag.scenarios && tag.scenarios.fireLiquid && Number(tag.scenarios.fireLiquid.latentHeatKjKg);
      if (tag && Number(tag.mw) > 0) state.mw = sanitize({ mw: tag.mw }).mw;
      if (lam > 0) state.latentKjKg = sanitize({ latentKjKg: lam }).latentKjKg;
      lastMsg = tag ? `Pulled from ${tag.tagNumber || 'PSV tag'}: M = ${fmt(state.mw, 2)}, L = ${show('lat', state.latentKjKg, 1)}` : 'No active PSV tag available.';
      renderInputs(); renderOutputs();
    });
    if (ctx && ctx.onUnitChange) ctx.onUnitChange(() => { renderInputs(); renderOutputs(); });
    renderInputs(); renderOutputs();
  }

  function summaryRows() {
    const r = calc(state), s = r.input;
    return [
      ['Tank geometry (D × H / V_tk)', `${show('len', r.D, 1)} × ${show('len', r.H, 1)} / ${show('vol', r.V, 0)}`, 'Vertical cylinder'],
      ['Normal outbreathing (pump + thermal)', show('air', r.outTotal, 0), `API 2000 §3.3.2: ${fmt(r.outPump, 0)} + ${fmt(r.outTherm, 0)} Nm³/h (Y = ${r.Y})`],
      ['Normal inbreathing (pump + thermal)', show('air', r.inTotal, 0), `API 2000 §3.3.2: ${fmt(r.inPump, 0)} + ${fmt(r.inTherm, 0)} Nm³/h (C = ${r.C})`],
      ['Wetted area / fire heat input Q', `${show('area', r.Awet, 1)} / ${fmt(r.heatQ / 1000, 0)} kW`, `API 2000 Table 7: ${r.heatEq}`],
      ['Emergency venting capacity', s.frangibleRoof ? 'Not required' : show('air', r.qEm, 0), s.frangibleRoof ? 'Frangible roof-to-shell seam' : `API 2000 §3.3.3, F = ${fmt(r.F, 3)}`],
      ['Indicative PV valve / EV', `${r.pv.n}× DN${r.pv.dn} / ${s.frangibleRoof ? 'frangible roof' : (r.ev.n ? `${r.ev.n}× DN${r.ev.dn}` : 'PV credit')}`, 'Screening only — size per vendor flow curves'],
      ['Design pressure / vacuum', `${show('pmb', s.designPmbarg, 1)} / ${show('pmb', s.designVacMbarg, 1)}`, r.inScope ? 'Within API 2000 scope' : 'Outside API 2000 scope (> 103.4 kPa)']
    ];
  }

  const tool = {
    id: 'api2000', title: 'Tank Venting (API 2000)', std: 'API Std 2000 7th Ed. · ISO 28300',
    calc, defaultState, presets, mount, summaryRows,
    getState: () => JSON.parse(JSON.stringify(state)),
    setState: (st) => applyState(st),
    // pure helpers exposed for tests
    heatInputSI, heatInputUSC, emergencySI, emergencyUSC, ventCapacity, sanitize,
    constants: { WET_LIMIT_M, H_IN, NM3_TO_SCF, Y_FACTOR, C_FACTOR }
  };

  if (typeof window !== 'undefined' && window.PSVTools) window.PSVTools.register(tool);
  if (typeof module !== 'undefined' && module.exports) module.exports = tool;
})();
