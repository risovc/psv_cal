/**
 * PSVCalc Pro — Step 7 toolkit module: Flare / Relief Header Network Backpressure.
 *
 * Method (screening-level network hydraulics, API 521 §5.5 / API 520 Pt II):
 *  - Tree topology: PSV tailpipes → (optional) sub-headers → main header → flare KO drum / seal drum / stack.
 *  - Flare stack-base pressure P_base = P_atm + ΔP_KO + ΔP_seal + ΔP_tip (fixed user inputs).
 *  - March UPSTREAM from P_base, segment by segment, solving the isothermal compressible-flow equation
 *      P1² − P2² = G²·(Z·R·T/M)·[f·L/D + ΣK + 2·ln(P1/P2)]           (Crane TP-410 Eq. 1-6, SI form)
 *    by Newton iteration for P1 (unique root for P1 > P2 ≥ P*).
 *  - Isothermal choking: limiting exit pressure P* = G·√(ZRT/M) (v = isothermal sound speed, Ma = 1/√k).
 *    If the downstream pressure is below P*, the segment exit is choked and P_exit = P*.
 *  - Junction mixing: M_mix = Σṁ / Σ(ṁ/M) (molar), T_mix from an ideal-gas enthalpy balance
 *    (c_p,i = k_i/(k_i−1)·R/M_i), k from molar-average C_p, Z mole-averaged.
 * Canonical SI state; USC conversion only at the DOM boundary.
 */
(function () {
  'use strict';
  const ID = 'flare-network';
  const R_U = 8314.462618; // J/(kmol·K)
  const MAX_SRC = 8, MAX_SEG = 8;

  // ASME B36.10M standard-wall (STD) pipe: [NPS, OD mm, wall mm]
  const NPS_TABLE = [
    ['1"', 33.4, 3.38], ['1.5"', 48.3, 3.68], ['2"', 60.3, 3.91], ['3"', 88.9, 5.49], ['4"', 114.3, 6.02],
    ['6"', 168.3, 7.11], ['8"', 219.1, 8.18], ['10"', 273.1, 9.27], ['12"', 323.9, 9.53], ['14"', 355.6, 9.53],
    ['16"', 406.4, 9.53], ['18"', 457.2, 9.53], ['20"', 508.0, 9.53], ['24"', 609.6, 9.53], ['30"', 762.0, 9.53],
    ['36"', 914.4, 9.53], ['42"', 1066.8, 9.53], ['48"', 1219.2, 9.53]
  ];
  const NPS_OPTIONS = NPS_TABLE.map(r => r[0]);
  const pipeIdMm = (nps) => { const p = NPS_TABLE.find(r => r[0] === nps) || NPS_TABLE[5]; return p[1] - 2 * p[2]; };

  const num = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  const LIMITS = {
    flowKgHr: [0, 1e7], mw: [2, 200], tempC: [-200, 800], k: [1.01, 2], z: [0.2, 1.5], setBarg: [0.1, 500],
    tailLenM: [0, 2000], tailK: [0, 200], lengthM: [0, 20000], sumK: [0, 200],
    patmBara: [0.5, 1.1], dpKoBar: [0, 10], dpSealBar: [0, 10], dpTipBar: [0, 10], roughnessMm: [0, 5], viscCp: [0.001, 1],
    allowConvPct: [1, 100], allowBellowsPct: [1, 100], allowPilotPct: [1, 100],
    machTailLimit: [0.05, 1], machHeaderLimit: [0.05, 1], rhoV2Limit: [1000, 1e7]
  };
  const clampField = (key, v) => (LIMITS[key] ? num(v, LIMITS[key][0], LIMITS[key][0], LIMITS[key][1]) : v);

  // ---------------------------------------------------------------- pure helpers
  /** Darcy friction factor: Colebrook-White (basis of the Moody diagram, Crane TP-410 Ch. 1), laminar 64/Re below Re 2000. */
  function darcyFriction(Re, relRough) {
    if (!(Re > 0)) return 0.02;
    if (Re < 2000) return 64 / Re;
    const e = Math.max(0, relRough);
    let f = 0.25 / Math.pow(Math.log10(e / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2); // Swamee-Jain seed
    for (let i = 0; i < 60; i++) {
      const fn = Math.pow(-2 * Math.log10(e / 3.7 + 2.51 / (Re * Math.sqrt(f))), -2);
      if (Math.abs(fn - f) < 1e-13) { f = fn; break; }
      f = fn;
    }
    return f;
  }

  /**
   * Solve the isothermal equation for P1 (Pa abs) given downstream P2 (Pa abs), mass flux G (kg/m²s),
   * c² = ZRT/M (m²/s²) and total resistance Kt = fL/D + ΣK. Applies the isothermal choke limit P* = G·c.
   */
  function isothermalP1(P2, G, c2, Kt) {
    const Pcrit = G * Math.sqrt(c2);
    let Pout = P2, choked = false;
    if (Pout < Pcrit) { Pout = Pcrit; choked = true; }
    if (!(G > 0) || !(Kt > 0)) return { P1: Pout, Pout, Pcrit, choked };
    const B = G * G * c2;
    const F = (P) => P * P - Pout * Pout - B * (Kt + 2 * Math.log(P / Pout));
    let P = Math.sqrt(Pout * Pout + B * Kt); // F(P) ≤ 0 here, F convex & increasing above Pcrit → Newton converges
    for (let i = 0; i < 100; i++) {
      const step = F(P) / (2 * P - 2 * B / P);
      P -= step;
      if (!Number.isFinite(P)) { P = Pout; break; }
      if (Math.abs(step) < 1e-11 * P) break;
    }
    return { P1: P, Pout, Pcrit, choked };
  }

  /** Isothermal pipe segment: march from downstream P2 to upstream P1. */
  function pipeFlow({ wKgH, idMm, lengthM, sumK, M, T_K, z, k, P2, roughnessMm, viscCp }) {
    const D = Math.max(0.005, idMm / 1000), A = Math.PI * D * D / 4;
    const W = Math.max(0, wKgH) / 3600, G = W / A;
    const c2 = z * R_U * T_K / M, a = Math.sqrt(k * c2);
    const Re = G * D / (viscCp * 1e-3);
    const f = darcyFriction(Re, roughnessMm / 1000 / D);
    const fLD = f * lengthM / D, Kt = fLD + sumK;
    const sol = isothermalP1(P2, G, c2, Kt);
    const v1 = G * c2 / sol.P1, v2 = G * c2 / sol.Pout;
    return {
      D, A, W, G, c2, a, Re, f, fLD, sumK, Kt, P1: sol.P1, P2, Pout: sol.Pout, Pcrit: sol.Pcrit, choked: sol.choked && W > 0,
      rho1: sol.P1 / c2, rho2: sol.Pout / c2, v1, v2, Ma1: v1 / a, Ma2: v2 / a, rhoV2: G * v2, MaChoke: 1 / Math.sqrt(k)
    };
  }

  /** Junction mixing of ideal-gas streams [{w kg/h, M, T_K, k, z}]. */
  function mixStreams(streams) {
    let list = streams.filter(s => s && s.w > 0);
    const weighted = list.length > 0;
    if (!weighted) list = streams.map(s => ({ ...s, w: 1 })); // property display for idle segments
    if (!list.length) return { w: 0, M: 20, T_K: 300, k: 1.3, z: 1 };
    let w = 0, n = 0, hNum = 0, hDen = 0, CpN = 0, zN = 0;
    list.forEach(s => {
      const ni = s.w / s.M, CpMol = s.k / (s.k - 1) * R_U, cpMass = CpMol / s.M;
      w += s.w; n += ni; hNum += s.w * cpMass * s.T_K; hDen += s.w * cpMass; CpN += ni * CpMol; zN += ni * s.z;
    });
    const Cp = CpN / n;
    return { w: weighted ? w : 0, M: w / n, T_K: hNum / hDen, k: Cp / (Cp - R_U), z: zN / n };
  }

  // ---------------------------------------------------------------- state
  function defaultState() { return JSON.parse(JSON.stringify(PRESETS[0].state)); }

  function normalizeSource(s, i) {
    s = s || {};
    const vt = ['conventional', 'bellows', 'pilot'].includes(s.valveType) ? s.valveType : 'conventional';
    return {
      tag: String(s.tag == null ? `PSV-${i + 1}` : s.tag).slice(0, 40),
      flowKgHr: clampField('flowKgHr', num(s.flowKgHr, 10000, -Infinity, Infinity)),
      mw: clampField('mw', num(s.mw, 20, -Infinity, Infinity)),
      tempC: clampField('tempC', num(s.tempC, 40, -Infinity, Infinity)),
      k: clampField('k', num(s.k, 1.3, -Infinity, Infinity)),
      z: clampField('z', num(s.z, 0.95, -Infinity, Infinity)),
      setBarg: clampField('setBarg', num(s.setBarg, 10, -Infinity, Infinity)),
      valveType: vt,
      tailNps: NPS_OPTIONS.includes(s.tailNps) ? s.tailNps : '6"',
      tailLenM: clampField('tailLenM', num(s.tailLenM, 10, -Infinity, Infinity)),
      tailK: clampField('tailK', num(s.tailK, 1.5, -Infinity, Infinity)),
      header: typeof s.header === 'string' ? s.header : ''
    };
  }
  function normalizeSegment(g, i) {
    g = g || {};
    return {
      id: String(g.id || `S${i + 1}`).slice(0, 12),
      name: String(g.name == null ? `Header-${i + 1}` : g.name).slice(0, 30),
      nps: NPS_OPTIONS.includes(g.nps) ? g.nps : '12"',
      lengthM: clampField('lengthM', num(g.lengthM, 50, -Infinity, Infinity)),
      sumK: clampField('sumK', num(g.sumK, 1.5, -Infinity, Infinity)),
      downstream: typeof g.downstream === 'string' ? g.downstream : ''
    };
  }
  function normalize(inp) {
    const d = (inp && typeof inp === 'object') ? inp : {};
    const out = {};
    const G = { patmBara: 1.01325, dpKoBar: 0.1, dpSealBar: 0.15, dpTipBar: 0.2, roughnessMm: 0.0457, viscCp: 0.011,
      allowConvPct: 10, allowBellowsPct: 30, allowPilotPct: 50, machTailLimit: 0.7, machHeaderLimit: 0.5, rhoV2Limit: 200000 };
    Object.keys(G).forEach(k => { out[k] = clampField(k, num(d[k], G[k], -Infinity, Infinity)); });
    out.sources = (Array.isArray(d.sources) && d.sources.length ? d.sources : [{}]).slice(0, MAX_SRC).map(normalizeSource);
    out.segments = (Array.isArray(d.segments) ? d.segments : []).slice(0, MAX_SEG).map(normalizeSegment);
    out.scenario = (Number.isInteger(d.scenario) && d.scenario >= 0 && d.scenario < out.sources.length) ? d.scenario : 'all';
    out.sendIdx = (Number.isInteger(d.sendIdx) && d.sendIdx >= 0 && d.sendIdx < out.sources.length) ? d.sendIdx : 0;
    return out;
  }

  // ---------------------------------------------------------------- calculation
  function calc(input) {
    const s = normalize(input);
    const Patm = s.patmBara * 1e5;
    const Pbase = Patm + (s.dpKoBar + s.dpSealBar + s.dpTipBar) * 1e5;
    const segs = s.segments, ids = new Set(segs.map(g => g.id));
    const down = {};
    segs.forEach(g => { down[g.id] = (g.downstream && g.downstream !== g.id && ids.has(g.downstream)) ? g.downstream : ''; });
    segs.forEach(g => { // break any loop so the tree always terminates at the stack
      let cur = g.id, n = 0;
      while (down[cur] && n <= segs.length) { cur = down[cur]; n++; }
      if (n > segs.length) down[g.id] = '';
    });
    const chain = (id) => { const c = []; let cur = id; while (cur) { c.push(cur); cur = down[cur]; } return c; };
    const active = s.sources.map((_, i) => s.scenario === 'all' || s.scenario === i);
    const stream = (src, i) => ({ w: active[i] ? src.flowKgHr : 0, M: src.mw, T_K: src.tempC + 273.15, k: src.k, z: src.z });
    const hdrOf = src => (ids.has(src.header) ? src.header : '');
    const carried = {}; segs.forEach(g => { carried[g.id] = []; });
    s.sources.forEach((src, i) => chain(hdrOf(src)).forEach(id => carried[id].push(i)));
    const common = { roughnessMm: s.roughnessMm, viscCp: s.viscCp };

    const segRes = {};
    segs.map(g => ({ g, depth: chain(g.id).length })).sort((a, b) => a.depth - b.depth).forEach(({ g, depth }) => {
      const P2 = down[g.id] ? segRes[down[g.id]].flow.P1 : Pbase;
      const mix = mixStreams(carried[g.id].map(i => stream(s.sources[i], i)));
      const idMm = pipeIdMm(g.nps);
      const flow = pipeFlow({ wKgH: mix.w, idMm, lengthM: g.lengthM, sumK: g.sumK, M: mix.M, T_K: mix.T_K, z: mix.z, k: mix.k, P2, ...common });
      const nActive = carried[g.id].filter(i => active[i]).length;
      const machStatus = flow.W <= 0 ? 'idle' : flow.choked ? 'fail' : (flow.Ma2 > s.machHeaderLimit || flow.rhoV2 > s.rhoV2Limit) ? 'warn' : 'pass';
      segRes[g.id] = { id: g.id, name: g.name, nps: g.nps, idMm, lengthM: g.lengthM, sumK: g.sumK, down: down[g.id], depth,
        carried: carried[g.id].slice(), nActive, mix, flow, status: machStatus };
    });

    const sources = s.sources.map((src, i) => {
      const header = hdrOf(src);
      const P2 = header ? segRes[header].flow.P1 : Pbase;
      const st = stream(src, i);
      const idMm = pipeIdMm(src.tailNps);
      const flow = pipeFlow({ wKgH: st.w, idMm, lengthM: src.tailLenM, sumK: src.tailK, M: st.M, T_K: st.T_K, z: st.z, k: st.k, P2, ...common });
      const PbBarg = (flow.P1 - Patm) / 1e5;                // total backpressure at PSV outlet during relief
      const builtUpBarg = Math.max(0, PbBarg - s.dpSealBar); // minus constant superimposed (liquid seal static head)
      const conv = src.valveType === 'conventional';
      const allowPct = conv ? s.allowConvPct : (src.valveType === 'bellows' ? s.allowBellowsPct : s.allowPilotPct);
      const checkBarg = conv ? builtUpBarg : PbBarg;
      const checkPct = checkBarg / src.setBarg * 100;
      const relieving = active[i] && src.flowKgHr > 0;
      const bpPass = checkPct <= allowPct + 1e-9;
      let status = 'idle';
      if (relieving) status = (!bpPass || flow.choked) ? 'fail' : (flow.Ma2 > s.machTailLimit || flow.rhoV2 > s.rhoV2Limit) ? 'warn' : 'pass';
      return { i, tag: src.tag, valveType: src.valveType, setBarg: src.setBarg, flowKgHr: st.w, header, tailNps: src.tailNps, idMm,
        lengthM: src.tailLenM, sumK: src.tailK, relieving, flow, PbBarg, builtUpBarg, checkBasis: conv ? 'built-up' : 'total',
        checkBarg, checkPct, pctOfSet: PbBarg / src.setBarg * 100, allowPct, allowBarg: allowPct / 100 * src.setBarg, bpPass, status,
        mix: { w: st.w, M: st.M, T_K: st.T_K, k: st.k, z: st.z } };
    });

    // Governing PSV = highest utilisation of its allowable backpressure.
    let gov = null;
    sources.forEach(r => { if (r.relieving && (!gov || r.checkPct / r.allowPct > gov.checkPct / gov.allowPct)) gov = r; });
    const path = [];
    if (gov) {
      path.push({ kind: 'tail', label: `${gov.tag} tailpipe`, nps: gov.tailNps, idMm: gov.idMm, lengthM: gov.lengthM, sumK: gov.sumK, flow: gov.flow, mix: gov.mix });
      chain(gov.header).forEach(id => { const g = segRes[id]; path.push({ kind: 'seg', label: g.name, nps: g.nps, idMm: g.idMm, lengthM: g.lengthM, sumK: g.sumK, flow: g.flow, mix: g.mix, nActive: g.nActive }); });
    }
    // Pressure profile along the governing path (PSV outlet → stack base); inner points solve with the remaining K.
    const profile = [];
    let x = 0;
    path.forEach(p => {
      const f = p.flow;
      for (let j = 0; j <= 6; j++) {
        const fr = j / 6;
        const P = j === 6 ? f.Pout : isothermalP1(f.Pout, f.G, f.c2, f.Kt * (1 - fr)).P1;
        profile.push({ x: x + fr * p.lengthM, barg: (P - Patm) / 1e5, node: j === 0 ? p.label : '' });
      }
      if (f.choked && f.Pout > f.P2) profile.push({ x: x + p.lengthM, barg: (f.P2 - Patm) / 1e5, node: '' });
      x += p.lengthM;
    });
    if (path.length) profile.push({ x, barg: (Pbase - Patm) / 1e5, node: 'Stack base' });

    const segList = segs.map(g => segRes[g.id]);
    const flowing = segList.filter(g => g.flow.W > 0);
    const rel = sources.filter(r => r.relieving);
    const totals = {
      wKgHr: rel.reduce((a, r) => a + r.flowKgHr, 0),
      nRelieving: rel.length,
      nPass: rel.filter(r => r.bpPass && !r.flow.choked).length,
      maxHeaderMach: flowing.reduce((a, g) => Math.max(a, g.flow.Ma2), 0),
      maxHeaderMachSeg: flowing.reduce((a, g) => (!a || g.flow.Ma2 > a.flow.Ma2 ? g : a), null),
      maxRhoV2: [...flowing.map(g => g.flow.rhoV2), ...rel.map(r => r.flow.rhoV2)].reduce((a, v) => Math.max(a, v), 0),
      anyChoked: flowing.some(g => g.flow.choked) || rel.some(r => r.flow.choked)
    };
    const hs = totals.maxHeaderMachSeg;
    totals.headerStatus = !hs ? 'idle' : hs.flow.choked || flowing.some(g => g.flow.choked) ? 'fail' : totals.maxHeaderMach > s.machHeaderLimit ? 'warn' : 'pass';
    totals.rhoV2Status = totals.maxRhoV2 > s.rhoV2Limit ? 'warn' : 'pass';
    return { input: s, PatmBara: s.patmBara, PbaseBara: Pbase / 1e5, segments: segList, sources, governing: gov, path, profile, totals };
  }

  // ---------------------------------------------------------------- presets
  const PRESETS = [
    {
      id: 'gasplant-hp', label: 'Gas plant HP flare — 4 PSVs, 2 sub-headers + 24" main (global power failure)',
      state: {
        scenario: 'all', sendIdx: 0, patmBara: 1.01325, dpKoBar: 0.12, dpSealBar: 0.15, dpTipBar: 0.25, roughnessMm: 0.0457, viscCp: 0.011,
        allowConvPct: 10, allowBellowsPct: 30, allowPilotPct: 50, machTailLimit: 0.7, machHeaderLimit: 0.5, rhoV2Limit: 200000,
        sources: [
          { tag: 'PSV-1001A', flowKgHr: 28450, mw: 38.5, tempC: 68, k: 1.29, z: 0.88, setBarg: 22.5, valveType: 'bellows', tailNps: '6"', tailLenM: 16.5, tailK: 2.1, header: 'S1' },
          { tag: 'PSV-2004', flowKgHr: 42000, mw: 42.1, tempC: 95, k: 1.15, z: 0.82, setBarg: 18.5, valveType: 'conventional', tailNps: '10"', tailLenM: 12, tailK: 1.8, header: 'S1' },
          { tag: 'PSV-6101', flowKgHr: 35000, mw: 19.5, tempC: 120, k: 1.25, z: 0.95, setBarg: 45, valveType: 'pilot', tailNps: '6"', tailLenM: 20, tailK: 2.4, header: 'S2' },
          { tag: 'PSV-6202', flowKgHr: 18000, mw: 22.0, tempC: 50, k: 1.27, z: 0.9, setBarg: 12, valveType: 'conventional', tailNps: '6"', tailLenM: 10, tailK: 1.5, header: 'S2' }
        ],
        segments: [
          { id: 'S1', name: 'SH-100', nps: '16"', lengthM: 120, sumK: 3.0, downstream: 'S3' },
          { id: 'S2', name: 'SH-600', nps: '14"', lengthM: 90, sumK: 2.5, downstream: 'S3' },
          { id: 'S3', name: 'MH-01', nps: '24"', lengthM: 400, sumK: 4.0, downstream: '' }
        ]
      }
    },
    {
      id: 'lp-unit', label: 'Refinery LP flare — 3 PSVs on a 12" unit header (conventional valves)',
      state: {
        scenario: 'all', sendIdx: 0, patmBara: 1.01325, dpKoBar: 0.05, dpSealBar: 0.1, dpTipBar: 0.1, roughnessMm: 0.0457, viscCp: 0.010,
        allowConvPct: 10, allowBellowsPct: 30, allowPilotPct: 50, machTailLimit: 0.7, machHeaderLimit: 0.5, rhoV2Limit: 200000,
        sources: [
          { tag: 'PSV-3101', flowKgHr: 9000, mw: 44.0, tempC: 60, k: 1.13, z: 0.9, setBarg: 8.0, valveType: 'conventional', tailNps: '6"', tailLenM: 8, tailK: 1.5, header: 'S1' },
          { tag: 'PSV-3102', flowKgHr: 6500, mw: 58.1, tempC: 75, k: 1.09, z: 0.88, setBarg: 6.5, valveType: 'conventional', tailNps: '4"', tailLenM: 12, tailK: 1.8, header: 'S1' },
          { tag: 'PSV-3105', flowKgHr: 12000, mw: 30.0, tempC: 40, k: 1.2, z: 0.93, setBarg: 10.0, valveType: 'bellows', tailNps: '6"', tailLenM: 6, tailK: 1.2, header: 'S2' }
        ],
        segments: [
          { id: 'S1', name: 'UH-300', nps: '12"', lengthM: 150, sumK: 2.5, downstream: 'S2' },
          { id: 'S2', name: 'LP-MAIN', nps: '18"', lengthM: 300, sumK: 3.5, downstream: '' }
        ]
      }
    }
  ];

  // ---------------------------------------------------------------- UI
  let st = defaultState();
  let root = null, ctxRef = null, msg = '', msgKind = 'info';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isUSC = () => !!(ctxRef && typeof ctxRef.isUSC === 'function' && ctxRef.isUSC());
  const CONV = {
    flow: [v => v * 2.20462262, v => v / 2.20462262, 'kg/h', 'lb/h'],
    temp: [v => v * 1.8 + 32, v => (v - 32) / 1.8, '°C', '°F'],
    pg: [v => v * 14.5037738, v => v / 14.5037738, 'barg', 'psig'],
    pa: [v => v * 14.5037738, v => v / 14.5037738, 'bara', 'psia'],
    dp: [v => v * 14.5037738, v => v / 14.5037738, 'bar', 'psi'],
    len: [v => v * 3.2808399, v => v / 3.2808399, 'm', 'ft'],
    rough: [v => v / 25.4, v => v * 25.4, 'mm', 'in'],
    vel: [v => v * 3.2808399, v => v / 3.2808399, 'm/s', 'ft/s'],
    rv2: [v => v * 0.67196897, v => v / 0.67196897, 'Pa', 'lb/ft·s²']
  };
  const unitOf = (u) => (CONV[u] ? CONV[u][isUSC() ? 3 : 2] : (u || ''));
  const toDisp = (v, u) => (CONV[u] && isUSC() ? CONV[u][0](v) : v);
  const fromDisp = (v, u) => (CONV[u] && isUSC() ? CONV[u][1](v) : v);
  const dv = (v, u) => { const x = toDisp(v, u); return Number.isFinite(x) ? String(Number(x.toPrecision(6))) : ''; };
  const fx = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const fq = (v, u, dSI, dUSC) => `${fx(toDisp(v, u), isUSC() ? dUSC : dSI)} ${unitOf(u)}`;
  const fFlow = (v) => (Number.isFinite(v) ? `${Math.round(toDisp(v, 'flow')).toLocaleString('en-US')} ${unitOf('flow')}` : '—');
  const fT = (TK) => fq(TK - 273.15, 'temp', 1, 1);
  const badge = (status, text) => `<span class="status-badge status-${status === 'idle' ? 'warn' : status}">${esc(text)}</span>`;
  const statusText = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', idle: 'IDLE' };
  const COL = {
    pass: ['rgba(16,185,129,0.14)', 'var(--pass-dot)', 'var(--pass-text)'],
    warn: ['rgba(245,158,11,0.16)', 'var(--warn-dot)', 'var(--warn-text)'],
    fail: ['rgba(239,68,68,0.16)', 'var(--fail-dot)', 'var(--fail-text)'],
    idle: ['rgba(148,163,184,0.14)', 'var(--text-muted)', 'var(--text-muted)']
  };

  const STYLE = `
#toolPane-${ID} .fn-sub{font-size:.73rem;color:var(--text-muted);}
#toolPane-${ID} .fn-toolbar{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-bottom:.6rem;}
#toolPane-${ID} .fn-toolbar label{font-size:.75rem;color:var(--text-secondary);display:flex;gap:.35rem;align-items:center;font-weight:600;}
#toolPane-${ID} .fn-ctl{background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-strong);border-radius:4px;padding:.28rem .4rem;font-family:var(--font-mono);font-size:.74rem;}
#toolPane-${ID} .fn-in td{padding:.28rem .3rem;}
#toolPane-${ID} .fn-in th{padding:.4rem .3rem;font-size:.66rem;}
#toolPane-${ID} .fn-in input[type=number]{width:5.4rem;}
#toolPane-${ID} .fn-in input.fn-short{width:3.9rem;}
#toolPane-${ID} .fn-in input.fn-name{width:7.2rem;}
#toolPane-${ID} .fn-btn{font-size:.74rem;padding:.38rem .7rem;}
#toolPane-${ID} .fn-del{background:transparent;border:1px solid var(--border-strong);color:var(--fail-text);border-radius:4px;cursor:pointer;padding:.15rem .45rem;}
#toolPane-${ID} .fn-svg{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:.4rem;margin-bottom:.8rem;}
#toolPane-${ID} .fn-svg svg{width:100%;height:auto;display:block;}
#toolPane-${ID} .fn-svg-title{font-size:.74rem;font-weight:700;color:var(--text-secondary);margin:.1rem .2rem .3rem;}
#toolPane-${ID} .fn-note{font-size:.74rem;color:var(--text-secondary);border:1px solid var(--border-subtle);border-left:3px solid var(--warn-dot);background:var(--bg-elevated);border-radius:var(--radius-sm);padding:.5rem .7rem;margin-top:.7rem;line-height:1.45;}
#toolPane-${ID} .fn-msg{font-size:.76rem;margin:.2rem 0 .6rem;font-weight:600;}
#toolPane-${ID} .fn-couple{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;border:1px solid var(--border-strong);background:var(--accent-soft);border-radius:var(--radius-sm);padding:.6rem .75rem;margin:.8rem 0;}
#toolPane-${ID} .fn-couple .fn-ctext{font-size:.75rem;color:var(--text-secondary);flex:1 1 280px;}
#toolPane-${ID} .fn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.7rem;margin-bottom:.8rem;}
#toolPane-${ID} .eng-table td.mono{font-family:var(--font-mono);font-size:.76rem;white-space:nowrap;}
`;

  function fld(key, label, sym, u, unitText) {
    return `<div class="field-group"><label class="field-label" for="${ID}-g-${key}"><span>${label}</span><span class="field-sym">${sym}</span></label>
      <div class="input-with-unit"><input type="number" step="any" id="${ID}-g-${key}" data-g="${key}" data-u="${u || ''}" value="${dv(st[key], u)}"><span class="unit-label">${esc(unitText || unitOf(u))}</span></div></div>`;
  }
  const numCell = (kind, i, f, u, cls) => `<td><input type="number" step="any" class="fn-ctl ${cls || ''}" id="${ID}-${kind}${i}-${f}" data-${kind}="${i}" data-f="${f}" data-u="${u || ''}" value="${dv(kind === 's' ? st.sources[i][f] : st.segments[i][f], u)}"></td>`;
  const selCell = (kind, i, f, opts, cur) => `<td><select class="fn-ctl" id="${ID}-${kind}${i}-${f}" data-${kind}="${i}" data-f="${f}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></td>`;

  function renderAll() {
    if (!root) return;
    const segOpts = st.segments.map(g => [g.id, g.name]);
    const npsOpts = NPS_OPTIONS.map(n => [n, n]);
    const srcRows = st.sources.map((s, i) => `<tr>
      <td><input type="text" class="fn-ctl fn-name" id="${ID}-s${i}-tag" data-s="${i}" data-f="tag" value="${esc(s.tag)}"></td>
      ${numCell('s', i, 'flowKgHr', 'flow')}${numCell('s', i, 'mw', '', 'fn-short')}${numCell('s', i, 'tempC', 'temp', 'fn-short')}
      ${numCell('s', i, 'k', '', 'fn-short')}${numCell('s', i, 'z', '', 'fn-short')}${numCell('s', i, 'setBarg', 'pg')}
      ${selCell('s', i, 'valveType', [['conventional', 'Conventional'], ['bellows', 'Bellows'], ['pilot', 'Pilot']], s.valveType)}
      ${selCell('s', i, 'tailNps', npsOpts, s.tailNps)}${numCell('s', i, 'tailLenM', 'len', 'fn-short')}${numCell('s', i, 'tailK', '', 'fn-short')}
      ${selCell('s', i, 'header', [...segOpts, ['', '→ KO drum / stack']], s.header)}
      <td><button type="button" class="fn-del" data-act="delSrc" data-i="${i}" title="Remove source">✕</button></td></tr>`).join('');
    const segRows = st.segments.map((g, j) => `<tr>
      <td><input type="text" class="fn-ctl fn-name" id="${ID}-seg${j}-name" data-seg="${j}" data-f="name" value="${esc(g.name)}"></td>
      ${selCell('seg', j, 'nps', npsOpts, g.nps)}${numCell('seg', j, 'lengthM', 'len')}${numCell('seg', j, 'sumK', '', 'fn-short')}
      ${selCell('seg', j, 'downstream', [...segOpts.filter(o => o[0] !== g.id), ['', '→ KO drum / stack']], g.downstream)}
      <td class="mono" id="${ID}-carries-${j}" style="font-size:.72rem;color:var(--text-secondary);"></td>
      <td><button type="button" class="fn-del" data-act="delSeg" data-i="${j}" title="Remove segment">✕</button></td></tr>`).join('');
    const scenOpts = [['all', 'All sources relieving simultaneously (global fire / power failure)'], ...st.sources.map((s, i) => [String(i), `Single source: ${s.tag}`])];
    root.innerHTML = `
<div class="panel">
  <div class="panel-header"><div><div class="panel-title">Flare Header Network — Built-up Backpressure</div>
    <div class="fn-sub">Isothermal compressible flow marched upstream from the flare tip · tailpipes → sub-headers → main header → KO drum / seal drum / stack</div></div>
    <span class="panel-std-ref">API 521 §5.5 · API 520 Pt I/II · Crane TP-410</span></div>
  <div class="panel-body">
    <div class="fn-toolbar">
      <label>Preset <select class="fn-ctl" id="${ID}-preset"><option value="">— select preset —</option>${PRESETS.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label>
      <label>Scenario <select class="fn-ctl" id="${ID}-scenario" data-g="scenario">${scenOpts.map(([v, l]) => `<option value="${esc(v)}"${String(st.scenario) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    </div>
    <div class="fn-toolbar">
      <button type="button" class="btn btn-primary fn-btn" id="${ID}-import" data-act="import">⇩ Import tags from Tag Register</button>
      <button type="button" class="btn btn-secondary fn-btn" id="${ID}-addSrc" data-act="addSrc"${st.sources.length >= MAX_SRC ? ' disabled' : ''}>+ PSV source</button>
      <button type="button" class="btn btn-secondary fn-btn" id="${ID}-addSeg" data-act="addSeg"${st.segments.length >= MAX_SEG ? ' disabled' : ''}>+ Header segment</button>
    </div>
    <div class="fn-msg" id="${ID}-msg" style="color:${msgKind === 'warn' ? 'var(--warn-text)' : 'var(--pass-text)'};">${esc(msg)}</div>
    <div class="form-section-title">1. Relief sources — PSV relieving conditions &amp; tailpipe (max ${MAX_SRC})</div>
    <div class="table-responsive"><table class="eng-table fn-in"><thead><tr>
      <th>Tag</th><th>W (${unitOf('flow')})</th><th>MW</th><th>T (${unitOf('temp')})</th><th>k</th><th>Z</th><th>P_set (${unitOf('pg')})</th><th>Valve</th>
      <th>Tail NPS</th><th>L (${unitOf('len')})</th><th>ΣK</th><th>Discharges to</th><th></th></tr></thead><tbody>${srcRows}</tbody></table></div>
    <div class="form-section-title">2. Header segments (ASME B36.10M STD wall)</div>
    <div class="table-responsive"><table class="eng-table fn-in"><thead><tr>
      <th>Segment</th><th>NPS</th><th>L (${unitOf('len')})</th><th>ΣK fittings</th><th>Flows into</th><th>Carries</th><th></th></tr></thead><tbody>${segRows}</tbody></table></div>
    <div class="form-section-title">3. Flare system boundary &amp; acceptance criteria</div>
    <div class="form-grid-3">
      ${fld('patmBara', 'Atmospheric pressure', 'P_atm', 'pa')}${fld('dpKoBar', 'KO drum ΔP', 'ΔP_KO', 'dp')}${fld('dpSealBar', 'Seal drum ΔP (static seal)', 'ΔP_seal', 'dp')}
      ${fld('dpTipBar', 'Stack + tip ΔP', 'ΔP_tip', 'dp')}${fld('roughnessMm', 'Pipe roughness', 'ε', 'rough')}${fld('viscCp', 'Gas viscosity', 'μ', '', 'cP')}
      ${fld('allowConvPct', 'Allowable — conventional (built-up)', '% P_set', '', '%')}${fld('allowBellowsPct', 'Allowable — bellows (total)', '% P_set', '', '%')}${fld('allowPilotPct', 'Allowable — pilot (total)', '% P_set', '', '%')}
      ${fld('machTailLimit', 'Tailpipe Mach limit', 'Ma', '', '—')}${fld('machHeaderLimit', 'Header Mach limit', 'Ma', '', '—')}${fld('rhoV2Limit', 'ρv² screening limit', 'ρv²', 'rv2')}
    </div>
    <div class="fn-note"><strong>Screening method — read before use.</strong> Each segment is isothermal at the mixed junction temperature (no Joule-Thomson or heat-loss
      correction; PSV discharge taken at relieving T, ideal-gas isenthalpic). KO drum, seal drum and tip ΔP are fixed at the entered (design-flow) values —
      conservative for single-source cases. Junction/branch losses must be included in ΣK. Conventional valves are checked on built-up backpressure
      (P_b − constant seal-drum superimposed, i.e. built-up + variable superimposed from other valves) vs 10 % of set for 10 % overpressure
      (API 520 Pt I §5.3; use 16 % / 21 % for multiple-valve / fire cases). Bellows (30 %) and pilot (50 %) limits are typical defaults — confirm with the
      manufacturer K_b curve. Final flare network design requires a rigorous network solver (API 521 §5.5).</div>
  </div>
</div>
<div class="panel">
  <div class="panel-header"><div class="panel-title">Network Results — Backpressure, Mach &amp; ρv²</div><span class="panel-std-ref" id="${ID}-scenTag"></span></div>
  <div class="panel-body" id="${ID}-out"></div>
</div>
<div class="panel">
  <div class="panel-header"><div class="panel-title">Whitebox Calculation Trace — Governing Path</div><span class="panel-std-ref">Crane TP-410 Eq. 1-6 · API 521 §5.5</span></div>
  <div class="panel-body"><div class="equation-step-list" id="${ID}-trace"></div></div>
</div>`;
    renderOutputs();
  }

  function svgNetwork(r) {
    const W = 980, srcs = r.sources, segs = r.segments;
    const kids = id => segs.filter(g => g.down === id), on = id => srcs.filter(s => s.header === id);
    const srcRow = {}, segSlot = {}; let row = 0;
    const visit = (g) => { kids(g.id).forEach(visit); on(g.id).forEach(s => { srcRow[s.i] = row++; }); if (!kids(g.id).length && !on(g.id).length) segSlot[g.id] = row++; };
    segs.filter(g => !g.down).forEach(visit);
    on('').forEach(s => { srcRow[s.i] = row++; });
    const rowH = 56, top = 34, H = Math.max(240, top + Math.max(row, 1) * rowH + 30);
    const yRow = n => top + n * rowH + rowH / 2;
    const segY = {};
    const yOf = (g) => {
      if (segY[g.id] != null) return segY[g.id];
      const ys = [...kids(g.id).map(yOf), ...on(g.id).map(s => yRow(srcRow[s.i]))];
      return (segY[g.id] = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : yRow(segSlot[g.id] || 0));
    };
    segs.forEach(yOf);
    const rootsY = [...segs.filter(g => !g.down).map(g => segY[g.id]), ...on('').map(s => yRow(srcRow[s.i]))];
    const yS = rootsY.length ? rootsY.reduce((a, b) => a + b, 0) / rootsY.length : H / 2;
    const maxD = segs.reduce((a, g) => Math.max(a, g.depth - 1), 0);
    const koX = 842, xr = koX - 100, xl = 380;
    const cx = d => (maxD === 0 ? (xl + xr) / 2 : xr - d * (xr - xl) / maxD);
    const segX = {}; segs.forEach(g => { segX[g.id] = cx(g.depth - 1); });
    const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs || 10}" text-anchor="${o.a || 'start'}" font-weight="${o.w || 400}" font-family="var(--font-mono), monospace" style="fill:${o.c || 'var(--text-primary)'}">${esc(s)}</text>`;
    const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    let out = '';
    // edges segment → downstream
    segs.forEach(g => {
      const x1 = segX[g.id] + 64, y1 = segY[g.id];
      const tx = g.down ? segX[g.down] - 64 : koX, ty = g.down ? segY[g.down] : yS;
      const xm = tx - 16;
      out += `<path d="M${x1},${y1} H${xm} V${ty} H${tx}" fill="none" style="stroke:${COL[g.status][1]}" stroke-width="${g.flow.W > 0 ? 4 : 2}" stroke-linejoin="round"/>`;
    });
    // tailpipes
    srcs.forEach(s => {
      const y = yRow(srcRow[s.i]);
      const tx = s.header ? segX[s.header] - 64 : koX, ty = s.header ? segY[s.header] : yS, xm = tx - 22;
      out += `<path d="M168,${y} H${xm} V${ty} H${tx}" fill="none" style="stroke:${COL[s.status][1]}" stroke-width="${s.relieving ? 2.5 : 1.5}" ${s.relieving ? '' : 'stroke-dasharray="4 3"'}/>`;
      out += t(176, y - 6, `${s.tailNps} · Ma ${fx(s.flow.Ma2, 2)}`, { c: COL[s.status][2], fs: 9.5 });
    });
    // source boxes
    srcs.forEach(s => {
      const y = yRow(srcRow[s.i]), c = COL[s.status];
      out += `<rect x="10" y="${y - 20}" width="158" height="40" rx="5" style="fill:${c[0]};stroke:${c[1]}" stroke-width="1.4"/>`;
      out += t(18, y - 5, cut(s.tag, 15), { w: 700 }) + t(162, y - 5, s.valveType === 'conventional' ? 'CONV' : s.valveType.toUpperCase(), { a: 'end', fs: 8.5, c: 'var(--text-muted)' });
      out += t(18, y + 11, s.relieving ? `Pb ${fq(s.PbBarg, 'pg', 2, 1)} · ${fx(s.checkPct, 1)}%` : `idle · sees ${fq(s.PbBarg, 'pg', 2, 1)}`, { c: c[2], fs: 9.5, w: 600 });
    });
    // segment nodes
    segs.forEach(g => {
      const x = segX[g.id], y = segY[g.id], c = COL[g.status];
      out += `<rect x="${x - 64}" y="${y - 21}" width="128" height="42" rx="5" style="fill:${c[0]};stroke:${c[1]}" stroke-width="1.6"/>`;
      out += t(x, y - 6, `${cut(g.name, 10)} · ${g.nps}`, { a: 'middle', w: 700 });
      out += t(x, y + 11, g.flow.W > 0 ? `Ma ${fx(g.flow.Ma2, 2)} · ${fq((g.flow.P1 - r.PatmBara * 1e5) / 1e5, 'pg', 2, 1)}` : 'no flow', { a: 'middle', fs: 9.5, c: c[2], w: 600 });
    });
    // KO drum + stack
    out += `<rect x="${koX}" y="${yS - 15}" width="56" height="30" rx="14" style="fill:rgba(56,189,248,0.14);stroke:var(--accent-primary)" stroke-width="1.5"/>` + t(koX + 28, yS + 4, 'KO', { a: 'middle', w: 700, fs: 10 });
    out += `<path d="M${koX + 56},${yS} H${koX + 80}" style="stroke:var(--accent-primary)" stroke-width="3"/>`;
    out += `<rect x="${koX + 80}" y="30" width="14" height="${Math.max(20, yS + 15 - 30)}" style="fill:rgba(148,163,184,0.25);stroke:var(--text-muted)" stroke-width="1.2"/>`;
    out += `<path d="M${koX + 87},6 C${koX + 76},18 ${koX + 82},26 ${koX + 80},30 H${koX + 94} C${koX + 95},22 ${koX + 99},16 ${koX + 87},6 Z" style="fill:rgba(249,115,22,0.55);stroke:rgba(234,88,12,0.9)"/>`;
    out += t(koX + 30, yS + 30, 'Stack base', { a: 'middle', fs: 9, c: 'var(--text-muted)' }) + t(koX + 30, yS + 42, fq(r.PbaseBara - r.PatmBara, 'pg', 3, 2), { a: 'middle', fs: 9.5, w: 700 });
    // legend
    const leg = [['pass', 'PASS'], ['warn', 'WARN (Ma/ρv²)'], ['fail', 'FAIL (BP/choked)'], ['idle', 'idle']];
    leg.forEach(([k, l], n) => { const x = 12 + n * 130; out += `<rect x="${x}" y="8" width="11" height="11" rx="2" style="fill:${COL[k][0]};stroke:${COL[k][1]}"/>` + t(x + 16, 17, l, { fs: 9.5, c: 'var(--text-secondary)' }); });
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Flare network schematic">${out}</svg>`;
  }

  function svgProfile(r) {
    const W = 980, H = 270, mL = 64, mR = 24, mT = 22, mB = 42;
    const g = r.governing;
    if (!g || r.profile.length < 2) return `<svg viewBox="0 0 ${W} 80" xmlns="http://www.w3.org/2000/svg"><text x="20" y="45" font-size="12" style="fill:var(--text-secondary)">No relieving source in the selected scenario.</text></svg>`;
    const pts = r.profile.map(p => ({ x: toDisp(p.x, 'len'), y: toDisp(p.barg, 'pg'), node: p.node }));
    const limBarg = (g.checkBasis === 'built-up' ? r.input.dpSealBar : 0) + g.allowBarg;
    const lim = toDisp(limBarg, 'pg');
    const xMax = Math.max(1e-6, pts[pts.length - 1].x);
    const yMax = Math.max(lim, ...pts.map(p => p.y)) * 1.12 || 1;
    const X = x => mL + (x / xMax) * (W - mL - mR), Y = y => H - mB - (y / yMax) * (H - mT - mB);
    let out = '';
    for (let n = 0; n <= 5; n++) {
      const yv = yMax * n / 5, xv = xMax * n / 5;
      out += `<line x1="${mL}" x2="${W - mR}" y1="${Y(yv)}" y2="${Y(yv)}" style="stroke:var(--border-strong)" stroke-width="0.6" stroke-dasharray="3 3"/>`;
      out += `<text x="${mL - 6}" y="${Y(yv) + 3}" font-size="9.5" text-anchor="end" style="fill:var(--text-muted)">${fx(yv, 2)}</text>`;
      out += `<text x="${X(xv)}" y="${H - mB + 14}" font-size="9.5" text-anchor="middle" style="fill:var(--text-muted)">${fx(xv, 0)}</text>`;
    }
    out += `<line x1="${mL}" x2="${W - mR}" y1="${Y(lim)}" y2="${Y(lim)}" style="stroke:var(--fail-dot)" stroke-width="1.4" stroke-dasharray="6 4"/>`;
    out += `<text x="${W - mR - 4}" y="${Y(lim) - 5}" font-size="10" text-anchor="end" font-weight="700" style="fill:var(--fail-text)">Allowable at ${esc(g.tag)} outlet: ${fx(lim, 2)} ${unitOf('pg')}</text>`;
    out += `<polyline points="${pts.map(p => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}" fill="none" style="stroke:var(--accent-primary)" stroke-width="2.4"/>`;
    let k = 0;
    pts.forEach(p => {
      if (!p.node) return;
      const up = k++ % 2 === 0;
      out += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.6" style="fill:var(--accent-primary)"/>`;
      const anchor = X(p.x) > W - 140 ? 'end' : (X(p.x) < mL + 60 ? 'start' : 'middle');
      out += `<text x="${X(p.x)}" y="${Y(p.y) + (up ? -9 : 16)}" font-size="9.5" text-anchor="${anchor}" font-weight="600" style="fill:var(--text-primary)">${esc(p.node)} ${fx(p.y, 2)}</text>`;
    });
    out += `<text x="${(mL + W - mR) / 2}" y="${H - 6}" font-size="10" text-anchor="middle" style="fill:var(--text-secondary)">Distance from ${esc(g.tag)} outlet along governing path (${unitOf('len')})</text>`;
    out += `<text x="14" y="${(mT + H - mB) / 2}" font-size="10" text-anchor="middle" transform="rotate(-90 14 ${(mT + H - mB) / 2})" style="fill:var(--text-secondary)">P (${unitOf('pg')})</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pressure profile">${out}</svg>`;
  }

  function traceHtml(r) {
    const s = r.input, g = r.governing;
    const bara = P => `${fx(P / 1e5, 4)} bara`;
    const card = (h, sym, sub, res, status) => `<div class="eq-step-card"><div class="eq-step-header"><span>${h}</span>${status ? badge(status, statusText[status]) : ''}</div>
      <div class="eq-symbolic">${sym}</div><div class="eq-substitution">${sub}</div><div class="eq-result">${res}</div></div>`;
    let html = card('1. Flare stack-base (header outlet) pressure — boundary condition',
      'P_base = P_atm + ΔP_KO + ΔP_seal + ΔP_stack+tip     (API 521 §5.5 — flare system ΔP built up from the tip)',
      `P_base = ${fx(s.patmBara, 5)} + ${fx(s.dpKoBar, 3)} + ${fx(s.dpSealBar, 3)} + ${fx(s.dpTipBar, 3)} bar`,
      `⇒ P_base = ${fx(r.PbaseBara, 4)} bara (${fq(r.PbaseBara - r.PatmBara, 'pg', 3, 2)})`);
    if (!g) return html + card('2. No relieving source', '—', 'Select a scenario with at least one PSV relieving at W > 0.', '⇒ nothing to evaluate');
    const last = r.path[r.path.length - 1];
    const m = last.mix;
    html += card(`2. Junction mixing into ${esc(last.label)} (${last.kind === 'seg' ? last.nActive : 1} stream${last.kind === 'seg' && last.nActive > 1 ? 's' : ''})`,
      'ṁ = Σṁᵢ ;  M_mix = Σṁᵢ / Σ(ṁᵢ/Mᵢ) ;  T_mix = Σṁᵢ·c_p,ᵢ·Tᵢ / Σṁᵢ·c_p,ᵢ  with c_p,ᵢ = kᵢ/(kᵢ−1)·R/Mᵢ (ideal gas energy balance)',
      `ṁ = ${fFlow(m.w)} ; k_mix = ${fx(m.k, 3)} ; Z_mix = ${fx(m.z, 3)} (mole-averaged)`,
      `⇒ M_mix = ${fx(m.M, 2)} kg/kmol ; T_mix = ${fT(m.T_K)}`);
    const rev = r.path.slice().reverse();
    rev.forEach((p, n) => {
      const f = p.flow;
      html += card(`${3 + n}. Isothermal flow — ${esc(p.label)} (${p.nps}, ID ${fx(p.idMm, 1)} mm, L ${fq(p.lengthM, 'len', 1, 0)})`,
        'P₁² − P₂² = G²·(Z·R·T/M)·[ f·L/D + ΣK + 2·ln(P₁/P₂) ]     (Crane TP-410 Eq. 1-6, SI; f = Colebrook-White Darcy, Re = G·D/μ)',
        `G = ${fx(f.G, 2)} kg/m²s ; ZRT/M = ${fx(f.c2, 0)} m²/s² ; Re = ${f.Re > 0 ? f.Re.toExponential(3) : '0'} ; f = ${fx(f.f, 5)} ; fL/D = ${fx(f.fLD, 3)} ; ΣK = ${fx(f.sumK, 2)} ; P₂ = ${bara(f.Pout)}${f.choked ? ` (choked: P* = G·√(ZRT/M) > downstream ${bara(f.P2)})` : ''}`,
        `⇒ P₁ = ${bara(f.P1)} (${fq((f.P1 - s.patmBara * 1e5) / 1e5, 'pg', 3, 2)}) ; v₂ = ${fq(f.v2, 'vel', 1, 1)} ; Ma₂ = ${fx(f.Ma2, 3)} ; ρv²₂ = ${fq(f.rhoV2, 'rv2', 0, 0)}`,
        f.W <= 0 ? null : f.choked ? 'fail' : (f.Ma2 > (p.kind === 'tail' ? s.machTailLimit : s.machHeaderLimit) || f.rhoV2 > s.rhoV2Limit) ? 'warn' : 'pass');
    });
    const worst = r.path.reduce((a, p) => (p.flow.Ma2 > a.flow.Ma2 ? p : a), r.path[0]);
    const nn = 3 + rev.length;
    html += card(`${nn}. Choked-flow / Mach check — worst element on path: ${esc(worst.label)}`,
      'a = √(k·Z·R·T/M) ;  Ma = v/a ;  isothermal choke at v = √(ZRT/M) ⇒ Ma* = 1/√k ;  guidance Ma ≤ 0.7 tailpipe, ≤ 0.5 header (API 521 §5.5) ; ρv² ≤ 200 000 Pa (noise/vibration screening)',
      `a = ${fq(worst.flow.a, 'vel', 1, 1)} ; Ma₂ = ${fx(worst.flow.Ma2, 3)} ; Ma* = 1/√${fx(worst.mix.k, 3)} = ${fx(worst.flow.MaChoke, 3)} ; ρv² = ${fq(worst.flow.rhoV2, 'rv2', 0, 0)}`,
      worst.flow.choked ? '⇒ CHOKED at segment exit — upstream pressure no longer depends on downstream; enlarge line' : `⇒ Ma/Ma* = ${fx(worst.flow.Ma2 / worst.flow.MaChoke, 2)} — not choked`,
      worst.flow.choked ? 'fail' : (worst.flow.Ma2 > (worst.kind === 'tail' ? s.machTailLimit : s.machHeaderLimit) ? 'warn' : 'pass'));
    html += card(`${nn + 1}. Backpressure acceptance — ${esc(g.tag)} (${g.valveType})`,
      g.checkBasis === 'built-up'
        ? 'P_b,built-up = P_b − P_superimposed,const(seal) ≤ 10 % · P_set   (conventional, 10 % overpressure — API 520 Pt I §5.3)'
        : `P_b,total ≤ ${fx(g.allowPct, 0)} % · P_set   (${g.valveType} valve — API 520 Pt I §5.3; confirm with manufacturer K_b)`,
      `P_b = ${fq(g.PbBarg, 'pg', 3, 2)} ; built-up = ${fq(g.builtUpBarg, 'pg', 3, 2)} ; P_set = ${fq(g.setBarg, 'pg', 2, 1)} ; allowable = ${fx(g.allowPct, 1)} % = ${fq(g.allowBarg, 'pg', 3, 2)}`,
      `⇒ ${g.checkBasis} backpressure = ${fx(g.checkPct, 2)} % of set — ${g.bpPass ? 'WITHIN' : 'EXCEEDS'} allowable`, g.bpPass ? 'pass' : 'fail');
    return html;
  }

  function renderOutputs() {
    if (!root) return;
    const r = calc(st);
    const out = root.querySelector(`#${ID}-out`);
    if (!out) return;
    const T = r.totals, g = r.governing, s = r.input;
    root.querySelectorAll(`[id^="${ID}-carries-"]`).forEach(td => {
      const seg = r.segments[Number(td.id.split('-').pop())];
      td.textContent = seg ? (seg.carried.map(i => r.sources[i].tag).join(', ') || '—') : '';
    });
    const scenTag = root.querySelector(`#${ID}-scenTag`);
    if (scenTag) scenTag.textContent = s.scenario === 'all' ? 'Scenario: all sources relieving' : `Scenario: single source ${r.sources[s.scenario].tag}`;
    const tagNow = ctxRef && ctxRef.getPsvTag ? ctxRef.getPsvTag() : null;
    const step2Tag = tagNow && tagNow.tagNumber ? String(tagNow.tagNumber) : '';
    const sel = r.sources[s.sendIdx] || r.sources[0];
    out.innerHTML = `
      <div class="fn-grid">
        <div class="metric-box"><span class="metric-box-label">Governing PSV backpressure</span>
          <span class="metric-box-main" style="color:${g ? COL[g.status][2] : 'var(--text-muted)'};">${g ? `${esc(g.tag)}: ${fq(g.PbBarg, 'pg', 3, 2)}` : 'none relieving'}</span>
          <span class="metric-box-sub">${g ? `${g.checkBasis} ${fx(g.checkPct, 1)} % of set · allow ${fx(g.allowPct, 0)} %` : '—'}</span>
          <span style="margin-top:.35rem;">${g ? badge(g.bpPass ? 'pass' : 'fail', g.bpPass ? 'PASS backpressure' : 'FAIL backpressure') : ''}</span></div>
        <div class="metric-box"><span class="metric-box-label">Stack-base pressure &amp; load</span>
          <span class="metric-box-main">${fq(r.PbaseBara - r.PatmBara, 'pg', 3, 2)}</span>
          <span class="metric-box-sub">${fFlow(T.wKgHr)} from ${T.nRelieving} PSV${T.nRelieving === 1 ? '' : 's'}</span></div>
        <div class="metric-box"><span class="metric-box-label">Max header Mach (segment exit)</span>
          <span class="metric-box-main" style="color:${COL[T.headerStatus][2]};">Ma ${fx(T.maxHeaderMach, 3)}</span>
          <span class="metric-box-sub">${T.maxHeaderMachSeg ? esc(T.maxHeaderMachSeg.name) : '—'} · limit ${fx(s.machHeaderLimit, 2)} · choke 1/√k</span>
          <span style="margin-top:.35rem;">${badge(T.headerStatus, T.headerStatus === 'fail' ? 'CHOKED' : statusText[T.headerStatus])}</span></div>
        <div class="metric-box"><span class="metric-box-label">Max ρv² (network)</span>
          <span class="metric-box-main" style="color:${COL[T.rhoV2Status][2]};">${fq(T.maxRhoV2, 'rv2', 0, 0)}</span>
          <span class="metric-box-sub">screening limit ${fq(s.rhoV2Limit, 'rv2', 0, 0)}</span>
          <span style="margin-top:.35rem;">${badge(T.rhoV2Status, statusText[T.rhoV2Status])}</span></div>
        <div class="metric-box"><span class="metric-box-label">PSVs within allowable</span>
          <span class="metric-box-main" style="color:${T.nPass === T.nRelieving ? 'var(--pass-text)' : 'var(--fail-text)'};">${T.nPass} / ${T.nRelieving}</span>
          <span class="metric-box-sub">${T.anyChoked ? 'choked element present' : 'no choked elements'}</span>
          <span style="margin-top:.35rem;">${badge(T.nPass === T.nRelieving && !T.anyChoked ? 'pass' : 'fail', T.nPass === T.nRelieving && !T.anyChoked ? 'PASS' : 'FAIL')}</span></div>
      </div>
      <div class="fn-svg"><div class="fn-svg-title">Network schematic — PSVs → tailpipes → headers → KO drum / flare stack (colour = status; labels = exit Mach, backpressure)</div><div id="${ID}-svgNet">${svgNetwork(r)}</div></div>
      <div class="fn-svg"><div class="fn-svg-title">Pressure profile along governing path${g ? ` (${esc(g.tag)} → stack base)` : ''}</div><div id="${ID}-svgProf">${svgProfile(r)}</div></div>
      <div class="form-section-title">PSV outlet backpressure</div>
      <div class="table-responsive"><table class="eng-table"><thead><tr><th>Tag</th><th>Valve</th><th>W (${unitOf('flow')})</th><th>P_set</th><th>P_b total (${unitOf('pg')})</th>
        <th>Built-up (${unitOf('pg')})</th><th>Check % set</th><th>Allow %</th><th>Tail Ma</th><th>ρv² (${unitOf('rv2')})</th><th>Status</th></tr></thead><tbody>
        ${r.sources.map(x => `<tr${g && x.i === g.i ? ' class="row-governing"' : ''}><td class="mono" style="font-weight:700;">${esc(x.tag)}</td><td>${x.valveType}</td>
          <td class="mono">${x.relieving ? fFlow(x.flowKgHr).replace(/ .*/, '') : 'idle'}</td><td class="mono">${fx(toDisp(x.setBarg, 'pg'), 2)}</td>
          <td class="mono">${fx(toDisp(x.PbBarg, 'pg'), 3)} <span style="color:var(--text-muted);">(${fx(x.pctOfSet, 1)}%)</span></td>
          <td class="mono">${x.relieving ? fx(toDisp(x.builtUpBarg, 'pg'), 3) : '—'}</td><td class="mono">${x.relieving ? fx(x.checkPct, 1) + ' (' + x.checkBasis + ')' : '—'}</td>
          <td class="mono">${fx(x.allowPct, 0)}</td><td class="mono">${x.relieving ? fx(x.flow.Ma2, 3) + (x.flow.choked ? ' CHOKED' : '') : '—'}</td>
          <td class="mono">${x.relieving ? fx(toDisp(x.flow.rhoV2, 'rv2'), 0) : '—'}</td><td>${badge(x.status, statusText[x.status])}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="form-section-title">Header segments</div>
      <div class="table-responsive"><table class="eng-table"><thead><tr><th>Segment</th><th>NPS / ID mm</th><th>W (${unitOf('flow')})</th><th>M_mix / T_mix</th>
        <th>P in (${unitOf('pg')})</th><th>P out (${unitOf('pg')})</th><th>v out (${unitOf('vel')})</th><th>Ma out</th><th>ρv² (${unitOf('rv2')})</th><th>Status</th></tr></thead><tbody>
        ${r.segments.map(x => `<tr><td class="mono" style="font-weight:700;">${esc(x.name)}</td><td class="mono">${x.nps} / ${fx(x.idMm, 1)}</td><td class="mono">${fFlow(x.flow.W * 3600).replace(/ .*/, '')}</td>
          <td class="mono">${fx(x.mix.M, 1)} / ${fT(x.mix.T_K)}</td><td class="mono">${fx(toDisp((x.flow.P1 - s.patmBara * 1e5) / 1e5, 'pg'), 3)}</td>
          <td class="mono">${fx(toDisp((x.flow.Pout - s.patmBara * 1e5) / 1e5, 'pg'), 3)}</td><td class="mono">${fx(toDisp(x.flow.v2, 'vel'), 1)}</td>
          <td class="mono">${fx(x.flow.Ma2, 3)}${x.flow.choked ? ' CHOKED' : ''}</td><td class="mono">${fx(toDisp(x.flow.rhoV2, 'rv2'), 0)}</td><td>${badge(x.status, statusText[x.status])}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="fn-couple">
        <div class="fn-ctext"><strong>1-click coupling → Step 2 PSV sizing.</strong> Sends the selected PSV's built-up backpressure
          (P_b − seal-drum superimposed ${fq(s.dpSealBar, 'dp', 3, 2)}) as <span class="mono">builtUpBackBarg</span>. Current Step 2 tag:
          <strong>${esc(step2Tag || 'n/a')}</strong>${sel && step2Tag && step2Tag !== sel.tag ? ' — <span style="color:var(--warn-text);">does not match the selected PSV</span>' : ''}.</div>
        <select class="fn-ctl" id="${ID}-sendSel">${r.sources.map(x => `<option value="${x.i}"${x.i === s.sendIdx ? ' selected' : ''}>${esc(x.tag)}${x.relieving ? ` — ${fq(x.builtUpBarg, 'pg', 3, 2)}` : ' (idle)'}</option>`).join('')}</select>
        <button type="button" class="btn btn-primary fn-btn" id="${ID}-send" data-act="send">⚡ Send built-up backpressure → Step 2</button>
      </div>`;
    const tr = root.querySelector(`#${ID}-trace`);
    if (tr) tr.innerHTML = traceHtml(r);
    if (ctxRef && ctxRef.notifyChanged) ctxRef.notifyChanged();
  }

  function setMsg(text, kind) {
    msg = text; msgKind = kind || 'info';
    const el = root && root.querySelector(`#${ID}-msg`);
    if (el) { el.textContent = text; el.style.color = msgKind === 'warn' ? 'var(--warn-text)' : 'var(--pass-text)'; }
  }

  function onEdit(e) {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.id === `${ID}-preset`) { if (e.type === 'change' && t.value) { const p = PRESETS.find(x => x.id === t.value); if (p) { msg = ''; tool.setState(JSON.parse(JSON.stringify(p.state))); } } return; }
    if (t.id === `${ID}-sendSel`) { if (e.type === 'change') { st.sendIdx = Number(t.value) || 0; renderOutputs(); } return; }
    const isNum = t.type === 'number';
    let val = t.value;
    if (isNum) { const n = parseFloat(val); if (!Number.isFinite(n)) return; val = fromDisp(n, t.dataset.u); }
    const f = t.dataset.f;
    if (t.dataset.g) {
      if (t.dataset.g === 'scenario') st.scenario = val === 'all' ? 'all' : Number(val);
      else st[t.dataset.g] = clampField(t.dataset.g, val);
    } else if (t.dataset.s != null) {
      const src = st.sources[Number(t.dataset.s)]; if (!src) return;
      src[f] = isNum ? clampField(f, val) : (f === 'tag' ? String(val).slice(0, 40) : val);
    } else if (t.dataset.seg != null) {
      const seg = st.segments[Number(t.dataset.seg)]; if (!seg) return;
      seg[f] = isNum ? clampField(f, val) : (f === 'name' ? String(val).slice(0, 30) : val);
    } else return;
    if (e.type === 'change' && (f === 'tag' || f === 'name')) renderAll(); else renderOutputs();
  }

  function onClick(e) {
    const b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act, i = Number(b.dataset.i);
    if (act === 'addSrc' && st.sources.length < MAX_SRC) {
      const last = st.sources[st.sources.length - 1] || {};
      st.sources.push(normalizeSource({ ...last, tag: `PSV-NEW-${st.sources.length + 1}` }, st.sources.length));
    } else if (act === 'delSrc' && st.sources.length > 1) {
      st.sources.splice(i, 1);
      if (st.scenario === i) st.scenario = 'all'; else if (Number.isInteger(st.scenario) && st.scenario > i) st.scenario--;
      st.sendIdx = 0;
    } else if (act === 'addSeg' && st.segments.length < MAX_SEG) {
      let n = 1; while (st.segments.some(g => g.id === `S${n}`)) n++;
      const rootSeg = st.segments.find(g => !g.downstream);
      st.segments.push(normalizeSegment({ id: `S${n}`, name: `SH-${n}`, nps: '12"', lengthM: 50, sumK: 1.5, downstream: rootSeg ? rootSeg.id : '' }, n - 1));
    } else if (act === 'delSeg' && st.segments.length > 1) {
      const gone = st.segments[i]; if (!gone) return;
      st.segments.splice(i, 1);
      st.segments.forEach(g => { if (g.downstream === gone.id) g.downstream = gone.downstream; });
      st.sources.forEach(s => { if (s.header === gone.id) s.header = gone.downstream; });
    } else if (act === 'import') { importRegister(); return; } else if (act === 'send') { sendToStep2(); return; } else return;
    st = normalize(st);
    renderAll();
  }

  function importRegister() {
    const reg = (typeof window !== 'undefined' && window.PSVApp && window.PSVApp.getRegister) ? window.PSVApp.getRegister() : [];
    const list = Array.isArray(reg) ? reg : [];
    const gas = list.filter(t => t && (t.fluidPhase === 'gas' || t.fluidPhase === 'steam' || t.fluidPhase == null));
    if (!gas.length) { setMsg(`Tag Register has no vapour-service tags to import (${list.length} entries; liquid/two-phase tags are skipped).`, 'warn'); return; }
    const leaf = st.segments.find(g => !st.segments.some(o => o.downstream === g.id)) || st.segments[0];
    st.sources = gas.slice(0, MAX_SRC).map((t, i) => normalizeSource({
      tag: t.tagNumber || t.id, flowKgHr: t.flowRateKgHr, mw: t.fluidPhase === 'steam' && !t.mw ? 18.015 : t.mw, tempC: t.relievingTempC,
      k: t.k, z: t.z, setBarg: t.setPressureBarg, valveType: t.valveType, tailNps: t.outletNps, tailLenM: t.outletLengthM,
      tailK: t.outletFittingsK, header: leaf ? leaf.id : ''
    }, i));
    st.scenario = 'all'; st.sendIdx = 0;
    st = normalize(st);
    msg = `Imported ${st.sources.length} vapour-service tag(s) from the Tag Register into ${leaf ? leaf.name : 'the stack'}; skipped ${list.length - st.sources.length} (liquid/two-phase or > ${MAX_SRC}). Review header assignments.`;
    msgKind = 'info';
    renderAll();
  }

  function sendToStep2() {
    const r = calc(st), x = r.sources[st.sendIdx];
    const tag = ctxRef && ctxRef.getPsvTag ? ctxRef.getPsvTag() : null;
    if (!x || !x.relieving) { setMsg('Selected PSV is not relieving in this scenario — nothing sent.', 'warn'); return; }
    if (!tag || String(tag.tagNumber) !== x.tag) { setMsg(`Step 2 tag is "${tag && tag.tagNumber ? tag.tagNumber : 'n/a'}" — load ${x.tag} in Step 2 first (tags must match). Nothing sent.`, 'warn'); return; }
    ctxRef.applyToPsvTag({ builtUpBackBarg: Number(x.builtUpBarg.toFixed(4)) }, 'tab-sizing');
    msg = `Sent built-up backpressure ${x.builtUpBarg.toFixed(3)} barg for ${x.tag} to Step 2.`; msgKind = 'info';
  }

  function summaryRows() {
    const r = calc(st), T = r.totals, g = r.governing;
    const rows = [
      ['Scenario', r.input.scenario === 'all' ? 'All sources relieving' : `Single source ${r.sources[r.input.scenario].tag}`, 'API 521 §4 / §5.5'],
      ['Total relief load to flare', String(Math.round(T.wKgHr)), `kg/h from ${T.nRelieving} PSV(s)`],
      ['Flare stack-base pressure', r.PbaseBara.toFixed(4), 'bara (P_atm + KO + seal + tip ΔP)'],
      ['Governing PSV', g ? g.tag : 'none', g ? `${g.valveType}, set ${g.setBarg.toFixed(2)} barg` : '—'],
      ['Governing PSV backpressure', g ? g.PbBarg.toFixed(3) : '—', g ? `barg total; ${g.checkBasis} ${g.checkPct.toFixed(1)} % of set vs ${g.allowPct.toFixed(0)} % — ${g.bpPass ? 'PASS' : 'FAIL'}` : '—'],
      ['PSVs within allowable backpressure', `${T.nPass} / ${T.nRelieving}`, T.anyChoked ? 'choked element present' : 'no choked elements'],
      ['Max header Mach (segment exit)', T.maxHeaderMach.toFixed(3), `limit ${r.input.machHeaderLimit}; isothermal choke Ma = 1/√k`],
      ['Max ρv² in network', String(Math.round(T.maxRhoV2)), `Pa (screening limit ${r.input.rhoV2Limit})`]
    ];
    return rows.map(row => row.map(String));
  }

  const tool = {
    id: ID,
    title: 'Flare Header Network',
    std: 'API 521 §5.5 · API 520 Pt II · Crane TP-410',
    presets: PRESETS,
    calc, defaultState, summaryRows,
    // pure helpers exposed for tests
    isothermalP1, pipeFlow, mixStreams, darcyFriction, pipeIdMm, R_U,
    mount(container, ctx) {
      root = container; ctxRef = ctx || null;
      if (typeof document !== 'undefined' && !document.getElementById(`style-${ID}`)) {
        const el = document.createElement('style'); el.id = `style-${ID}`; el.textContent = STYLE; document.head.appendChild(el);
      }
      const tag = ctxRef && ctxRef.getPsvTag ? ctxRef.getPsvTag() : null;
      const idx = tag ? st.sources.findIndex(s => s.tag === tag.tagNumber) : -1;
      if (idx >= 0) st.sendIdx = idx;
      root.addEventListener('input', onEdit);
      root.addEventListener('change', onEdit);
      root.addEventListener('click', onClick);
      if (ctxRef && ctxRef.onUnitChange) ctxRef.onUnitChange(() => renderAll());
      renderAll();
    },
    getState() { return JSON.parse(JSON.stringify(st)); },
    setState(s) { st = normalize(s); if (root) renderAll(); }
  };

  if (typeof window !== 'undefined' && window.PSVTools) window.PSVTools.register(tool);
  if (typeof module !== 'undefined' && module.exports) module.exports = tool;
})();
