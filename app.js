/**
 * PSVCalc Pro — Interactive Engineering Workbench Controller
 * Connects API 521 Overpressure Scenarios, API 520 Part I Orifice Sizing,
 * API 520 Part II Line Hydraulics, Formal IPDS Datasheet, and Project Register.
 */

/**
 * PSVExport — pure, dependency-free deliverable helpers (browser + Node `require()`):
 *   crc32 (ISO-HDLC / zlib polynomial 0xEDB88320), store-only ZIP writer (PKWARE APPNOTE 6.3.x
 *   §4.3.7 local header, §4.3.12 central directory, §4.3.16 end-of-central-directory),
 *   minimal SpreadsheetML (ECMA-376 / Office Open XML) .xlsx builder, base64url codec.
 */
(function (root) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  const utf8 = (s) => new TextEncoder().encode(String(s));

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** files: [{ name, data: string | Uint8Array }] -> Uint8Array (method 0 = stored, UTF-8 names). */
  function zipStore(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const dosTime = 0;
    const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1; // fixed timestamp => reproducible output
    for (const f of files) {
      const name = utf8(f.name);
      const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  const xmlEsc = (s) => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function colName(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  // Plain decimal strings become numeric cells; leading-zero codes ("007") stay text.
  const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;
  function cellXml(v, ref, bold) {
    if (v === null || v === undefined || v === '') return '';
    const s = bold ? ' s="1"' : '';
    if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : '';
    const str = String(v);
    if (NUM_RE.test(str) && str.length < 16) return `<c r="${ref}"${s}><v>${Number(str)}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(str)}</t></is></c>`;
  }
  function sheetXml(sheet) {
    const rows = sheet.rows || [];
    const bold = new Set(sheet.boldRows || [0]);
    const nCols = rows.reduce((m, r) => Math.max(m, r.length), 1);
    const widths = [];
    for (let c = 0; c < nCols; c++) {
      const w = sheet.widths && sheet.widths[c];
      const auto = rows.reduce((m, r) => Math.max(m, r[c] == null ? 0 : String(r[c]).length), 0) + 2;
      widths.push(Math.min(60, Math.max(8, w || auto)));
    }
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cellXml(v, colName(ci) + (ri + 1), bold.has(ri))).join('')}</row>`).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
  }

  /** sheets: [{ name, rows: any[][], boldRows?: number[], widths?: number[] }] -> Uint8Array (.xlsx) */
  function buildXlsx(sheets) {
    const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const safeName = (n, i) => (String(n || `Sheet${i + 1}`).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || `Sheet${i + 1}`);
    const files = [
      { name: '[Content_Types].xml', data: head +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>' },
      { name: '_rels/.rels', data: head + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: head +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}"><sheets>` +
        sheets.map((s, i) => `<sheet name="${xmlEsc(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: head + `<Relationships xmlns="${NS_PKG}">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: head +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
    ];
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
    return zipStore(files);
  }

  function bytesToB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(str) {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4);
    const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const PSVExport = { crc32, zipStore, buildXlsx, bytesToB64url, b64urlToBytes };
  if (typeof window !== 'undefined') window.PSVExport = PSVExport;
  if (typeof module !== 'undefined' && module.exports) module.exports = PSVExport;
  void root;
})(typeof window !== 'undefined' ? window : globalThis);

(() => {
  // Node `require('./app.js')` only loads the pure PSVExport helpers above.
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.PSVEngine) return;
  const E = window.PSVEngine;
  const U = E.Units;

  const STORAGE_KEY = 'psvcalc_pro_register_v1';

  // Application State
  let state = {
    unitSystem: 'SI', // 'SI' or 'USC'
    activeTab: 'tab-sizing',
    activeScenarioKey: 'fire_liquid',
    flowBasis: 'rated',
    autoKb: true,
    manualKb: 1.0,
    ipdsMode: 'psv', // 'psv', 'pump', or 'vessel'
    tag: JSON.parse(JSON.stringify(E.EPC_TAG_PRESETS[0])),
    pumpLoop: JSON.parse(JSON.stringify(E.PUMP_LOOP_PRESETS[0])),
    vessel: JSON.parse(JSON.stringify(E.VESSEL_SIZING_PRESETS[0])),
    pidSystem: JSON.parse(JSON.stringify((E.PID_SYSTEM_PRESETS && E.PID_SYSTEM_PRESETS[0]) || {})),
    pidAttachment: null,
    pidAiAnalysis: null,
    register: [],
    cases: [],        // named workspace snapshots for Step 6 case comparison
    caseSel: [],      // ids of the 2–3 cases selected for comparison
    report: null      // calculation report title-block metadata (doc no, rev, signatures)
  };

  // =========================================================================
  // 1. INITIALIZATION & LOCALSTORAGE PERSISTENCE
  // =========================================================================

  function loadRegisterFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.register = parsed;
          return;
        }
      }
    } catch (err) {
      console.warn('LocalStorage unavailable, using default presets:', err);
    }
    state.register = JSON.parse(JSON.stringify(E.EPC_TAG_PRESETS));
    saveRegisterToStorage();
  }

  function saveRegisterToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.register));
    } catch (err) {
      console.warn('Could not persist register to LocalStorage:', err);
    }
    const badge = document.getElementById('registerCountBadge');
    if (badge) badge.textContent = String(state.register.length);
  }

  // =========================================================================
  // 2. UNIT FORMATTING & CONVERSION HELPERS
  // =========================================================================

  function isUSC() {
    return state.unitSystem === 'USC';
  }

  function fmtFlow(kgHr, digits = 0) {
    const val = isUSC() ? U.kgHrToLbHr(kgHr) : kgHr;
    const unit = isUSC() ? 'lb/hr' : 'kg/h';
    return `${Number(val).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${unit}`;
  }

  function fmtVolFlow(m3Hr, digits = 1) {
    const val = isUSC() ? U.m3HrToGpm(m3Hr) : m3Hr;
    const unit = isUSC() ? 'gpm' : 'm³/h';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtHead(m, digits = 1) {
    const val = isUSC() ? U.mToFt(m) : m;
    const unit = isUSC() ? 'ft' : 'm';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtPressG(barg, digits = 2) {
    const val = isUSC() ? U.barToPsi(barg) : barg;
    const unit = isUSC() ? 'psig' : 'barg';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtPressA(bara, digits = 2) {
    const val = isUSC() ? U.barToPsi(bara) : bara;
    const unit = isUSC() ? 'psia' : 'bara';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtTemp(tempC, digits = 1) {
    const val = isUSC() ? U.cToF(tempC) : tempC;
    const unit = isUSC() ? '°F' : '°C';
    return `${Number(val).toFixed(digits)} ${unit}`;
  }

  function fmtArea(mm2) {
    if (isUSC()) {
      return `${U.mm2ToIn2(mm2).toFixed(4)} in² (${mm2.toFixed(1)} mm²)`;
    }
    return `${mm2.toFixed(1)} mm² (${U.mm2ToIn2(mm2).toFixed(4)} in²)`;
  }

  // Differential pressure (no gauge/absolute suffix)
  function fmtDP(bar, digits = 3) {
    const val = isUSC() ? U.barToPsi(bar) : bar;
    return `${Number(val).toFixed(digits)} ${isUSC() ? 'psi' : 'bar'}`;
  }

  // Read a numeric input; fall back to default only when empty/invalid (0 is a valid value)
  function num(id, def) {
    const el = document.getElementById(id);
    if (!el) return def;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : def;
  }

  // Escape user-provided text before inserting into innerHTML / SVG
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Single source of truth for sizing + hydraulics of any tag
  function computeForTag(tag) {
    const autoKb = tag === state.tag ? state.autoKb : (tag.autoKb ?? true);
    const manualKb = tag === state.tag ? state.manualKb : (tag.manualKb ?? 1.0);
    const flowBasis = tag === state.tag ? state.flowBasis : (tag.flowBasis || 'rated');
    const sizing = E.sizeOrificeApi520({ ...tag, autoKb, manualKb });
    const hyd = E.calcLineHydraulicsApi520Part2(sizing, { ...tag, flowBasis });
    return { sizing, hyd };
  }

  function updateUnitAddonLabels() {
    document.querySelectorAll('[data-unit-type]').forEach(el => {
      const t = el.getAttribute('data-unit-type');
      if (t === 'massFlow' || t === 'flow') el.textContent = isUSC() ? 'lb/hr' : 'kg/h';
      else if (t === 'volFlow') el.textContent = isUSC() ? 'gpm' : 'm³/h';
      else if (t === 'pressGauge') el.textContent = isUSC() ? 'psig' : 'barg';
      else if (t === 'pressAbs') el.textContent = isUSC() ? 'psia' : 'bara';
      else if (t === 'pressDiff') el.textContent = isUSC() ? 'psi' : 'bar';
      else if (t === 'temp') el.textContent = isUSC() ? '°F' : '°C';
      else if (t === 'tempDiff') el.textContent = isUSC() ? '°F' : '°C';
      else if (t === 'density') el.textContent = isUSC() ? 'lb/ft³' : 'kg/m³';
      else if (t === 'length') el.textContent = isUSC() ? 'ft' : 'm';
      else if (t === 'latent') el.textContent = isUSC() ? 'BTU/lb' : 'kJ/kg';
    });
  }

  // Sync canonical state.tag values into DOM inputs according to current unit system
  function syncTagToDomInputs() {
    const t = state.tag;
    const presetSel = document.getElementById('presetTagSelect');
    if ([...presetSel.options].some(o => o.value === t.tagNumber)) presetSel.value = t.tagNumber;
    document.getElementById('ctxTagNumber').value = t.tagNumber || '';
    document.getElementById('ctxService').value = t.service || '';
    document.getElementById('ctxEquipment').value = t.equipmentProtected || '';
    document.getElementById('ctxProject').value = t.projectTitle || '';
    document.getElementById('ctxClient').value = t.clientName || '';
    document.getElementById('ctxPid').value = t.pidNumber || '';

    // Phase segmented buttons
    document.querySelectorAll('#phaseSelectorGroup .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.phase === t.fluidPhase);
    });

    // Show/hide phase-specific fields
    const isGasOrSteam = t.fluidPhase === 'gas' || t.fluidPhase === 'steam';
    document.getElementById('fgMw').style.display = t.fluidPhase === 'liquid' ? 'none' : '';
    document.getElementById('fgK').style.display = isGasOrSteam ? '' : 'none';
    document.getElementById('fgZ').style.display = isGasOrSteam ? '' : 'none';
    document.getElementById('fgSteamSh').style.display = t.fluidPhase === 'steam' ? '' : 'none';
    document.getElementById('fgOmega').style.display = t.fluidPhase === 'twophase' ? '' : 'none';

    document.getElementById('fluidPresetSelect').value = t.fluidPresetKey || 'custom';
    document.getElementById('inpMw').value = Number(t.mw).toFixed(2);
    document.getElementById('inpK').value = Number(t.k).toFixed(2);
    document.getElementById('inpZ').value = Number(t.z).toFixed(2);
    document.getElementById('inpRhoLiq').value = isUSC()
      ? U.kgm3ToLbft3(t.rhoLiqKgM3).toFixed(2)
      : Number(t.rhoLiqKgM3).toFixed(1);
    document.getElementById('inpVisc').value = Number(t.viscCp);
    document.getElementById('inpSteamSh').value = isUSC()
      ? (t.steamSuperheatC * 1.8).toFixed(1)
      : Number(t.steamSuperheatC).toFixed(1);
    document.getElementById('inpOmega').value = Number(t.omegaParam || 0.65).toFixed(2);

    // Process conditions
    document.getElementById('inpFlowRate').value = isUSC()
      ? Math.round(U.kgHrToLbHr(t.flowRateKgHr))
      : Math.round(t.flowRateKgHr);
    document.getElementById('inpRelievingTemp').value = isUSC()
      ? U.cToF(t.relievingTempC).toFixed(1)
      : Number(t.relievingTempC).toFixed(1);
    document.getElementById('inpOpPressure').value = isUSC()
      ? U.barToPsi(t.operatingPressureBarg).toFixed(1)
      : Number(t.operatingPressureBarg).toFixed(2);
    document.getElementById('inpSetPressure').value = isUSC()
      ? U.barToPsi(t.setPressureBarg).toFixed(1)
      : Number(t.setPressureBarg).toFixed(2);
    document.getElementById('inpOverpressurePct').value = String(t.overpressurePct);
    document.getElementById('inpAtmPressure').value = isUSC()
      ? U.barToPsi(t.atmPressureBara).toFixed(2)
      : Number(t.atmPressureBara).toFixed(3);
    document.getElementById('inpSuperBack').value = isUSC()
      ? U.barToPsi(t.superimposedBackBarg).toFixed(2)
      : Number(t.superimposedBackBarg).toFixed(2);
    document.getElementById('inpBuiltUpBack').value = isUSC()
      ? U.barToPsi(t.builtUpBackBarg).toFixed(2)
      : Number(t.builtUpBackBarg).toFixed(2);

    // Valve Type
    document.querySelectorAll('#valveTypeGroup .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.vtype === t.valveType);
    });
    document.getElementById('inpRuptureDisc').value = String(Boolean(t.ruptureDiscUpstream));
    state.autoKb = t.autoKb ?? true;
    state.manualKb = t.manualKb ?? 1.0;
    state.flowBasis = t.flowBasis || 'rated';
    document.getElementById('inpAutoKb').value = String(state.autoKb);
    document.getElementById('inpManualKb').value = Number(state.manualKb).toFixed(2);
    document.getElementById('fgManualKb').style.display = state.autoKb ? 'none' : '';
    document.getElementById('inpHydFlowBasis').value = state.flowBasis;

    // Line Sizing Inputs
    document.getElementById('inpInletNps').value = t.inletNps;
    document.getElementById('inpInletSch').value = t.inletSch;
    document.getElementById('inpInletLength').value = isUSC()
      ? U.mToFt(t.inletLengthM).toFixed(1)
      : Number(t.inletLengthM).toFixed(1);
    document.getElementById('inpInletFittingsK').value = Number(t.inletFittingsK).toFixed(2);

    document.getElementById('inpOutletNps').value = t.outletNps;
    document.getElementById('inpOutletSch').value = t.outletSch;
    document.getElementById('inpOutletLength').value = isUSC()
      ? U.mToFt(t.outletLengthM).toFixed(1)
      : Number(t.outletLengthM).toFixed(1);
    document.getElementById('inpOutletFittingsK').value = Number(t.outletFittingsK).toFixed(2);

    updateUnitAddonLabels();
  }

  // Read DOM inputs back into canonical SI state.tag
  function readDomInputsToTag() {
    const t = state.tag;
    t.tagNumber = document.getElementById('ctxTagNumber').value.trim() || 'PSV-NEW';
    t.service = document.getElementById('ctxService').value.trim();
    t.equipmentProtected = document.getElementById('ctxEquipment').value.trim();
    t.projectTitle = document.getElementById('ctxProject').value.trim();
    t.clientName = document.getElementById('ctxClient').value.trim();
    t.pidNumber = document.getElementById('ctxPid').value.trim();

    t.mw = num('inpMw', 20.0);
    t.k = num('inpK', 1.25);
    t.z = num('inpZ', 0.90);

    const rawRho = num('inpRhoLiq', 800);
    t.rhoLiqKgM3 = isUSC() ? U.lbft3ToKgm3(rawRho) : rawRho;

    t.viscCp = num('inpVisc', 0.015);

    const rawSh = num('inpSteamSh', 0);
    t.steamSuperheatC = isUSC() ? rawSh / 1.8 : rawSh;

    t.omegaParam = num('inpOmega', 0.65);

    const rawFlow = num('inpFlowRate', 1000);
    t.flowRateKgHr = isUSC() ? U.lbHrToKgHr(rawFlow) : rawFlow;

    const rawTemp = num('inpRelievingTemp', 50);
    t.relievingTempC = isUSC() ? U.fToC(rawTemp) : rawTemp;

    const rawOpP = num('inpOpPressure', 10);
    t.operatingPressureBarg = isUSC() ? U.psiToBar(rawOpP) : rawOpP;

    const rawSetP = num('inpSetPressure', 15);
    t.setPressureBarg = isUSC() ? U.psiToBar(rawSetP) : rawSetP;
    t.mawpBarg = t.setPressureBarg;

    t.overpressurePct = num('inpOverpressurePct', 10);

    const rawAtmP = num('inpAtmPressure', 1.01325);
    t.atmPressureBara = isUSC() ? U.psiToBar(rawAtmP) : rawAtmP;

    const rawSuperBack = num('inpSuperBack', 0);
    t.superimposedBackBarg = isUSC() ? U.psiToBar(rawSuperBack) : rawSuperBack;

    const rawBuiltBack = num('inpBuiltUpBack', 0);
    t.builtUpBackBarg = isUSC() ? U.psiToBar(rawBuiltBack) : rawBuiltBack;

    t.ruptureDiscUpstream = document.getElementById('inpRuptureDisc').value === 'true';
    state.autoKb = document.getElementById('inpAutoKb').value === 'true';
    state.manualKb = num('inpManualKb', 1.0);
    t.autoKb = state.autoKb;
    t.manualKb = state.manualKb;

    // Hydraulics
    t.inletNps = document.getElementById('inpInletNps').value;
    t.inletSch = document.getElementById('inpInletSch').value;
    const rawInLen = num('inpInletLength', 2.0);
    t.inletLengthM = isUSC() ? U.ftToM(rawInLen) : rawInLen;
    t.inletFittingsK = num('inpInletFittingsK', 0.95);

    t.outletNps = document.getElementById('inpOutletNps').value;
    t.outletSch = document.getElementById('inpOutletSch').value;
    const rawOutLen = num('inpOutletLength', 12.0);
    t.outletLengthM = isUSC() ? U.ftToM(rawOutLen) : rawOutLen;
    t.outletFittingsK = num('inpOutletFittingsK', 1.80);
    state.flowBasis = document.getElementById('inpHydFlowBasis').value;
    t.flowBasis = state.flowBasis;
  }

  function syncPumpToDomInputs() {
    const p = state.pumpLoop;
    if (!p || !document.getElementById('inpPumpTag')) return;
    const presetSel = document.getElementById('pumpPresetSelect');
    if (presetSel && [...presetSel.options].some(o => o.value === p.pumpTag)) {
      presetSel.value = p.pumpTag;
    }
    document.getElementById('inpPumpTag').value = p.pumpTag || 'P-3102A/B';
    document.getElementById('inpPumpService').value = p.service || '';
    document.getElementById('inpPumpNormFlow').value = isUSC()
      ? U.m3HrToGpm(p.normalFlowM3Hr).toFixed(1)
      : Number(p.normalFlowM3Hr).toFixed(1);
    document.getElementById('inpPumpRatedMargin').value = Number(p.ratedMarginPct).toFixed(0);
    document.getElementById('inpPumpRho').value = isUSC()
      ? U.kgm3ToLbft3(p.rhoKgM3).toFixed(2)
      : Number(p.rhoKgM3).toFixed(1);
    document.getElementById('inpPumpVisc').value = Number(p.viscCp);
    document.getElementById('inpPumpVaporPress').value = isUSC()
      ? U.barToPsi(p.vaporPressBara).toFixed(2)
      : Number(p.vaporPressBara).toFixed(2);
    document.getElementById('inpPumpTemp').value = isUSC()
      ? U.cToF(p.tempC).toFixed(1)
      : Number(p.tempC).toFixed(1);

    document.getElementById('inpPumpSucPress').value = isUSC()
      ? U.barToPsi(p.suctionVesselBarg).toFixed(1)
      : Number(p.suctionVesselBarg).toFixed(2);
    document.getElementById('inpPumpSucHead').value = isUSC()
      ? U.mToFt(p.suctionStaticHeadM).toFixed(1)
      : Number(p.suctionStaticHeadM).toFixed(2);
    document.getElementById('inpPumpSucNps').value = p.suctionNps || '6"';
    document.getElementById('inpPumpSucLength').value = isUSC()
      ? U.mToFt(p.suctionLengthM).toFixed(1)
      : Number(p.suctionLengthM).toFixed(1);
    document.getElementById('inpPumpSucK').value = Number(p.suctionFittingsK).toFixed(2);
    document.getElementById('inpPumpNpshr').value = isUSC()
      ? U.mToFt(p.npshrM).toFixed(1)
      : Number(p.npshrM).toFixed(2);

    document.getElementById('inpPumpDestPress').value = isUSC()
      ? U.barToPsi(p.destVesselBarg).toFixed(1)
      : Number(p.destVesselBarg).toFixed(2);
    document.getElementById('inpPumpDisHead').value = isUSC()
      ? U.mToFt(p.dischargeStaticHeadM).toFixed(1)
      : Number(p.dischargeStaticHeadM).toFixed(1);
    document.getElementById('inpPumpDisNps').value = p.dischargeNps || '4"';
    document.getElementById('inpPumpDisLength').value = isUSC()
      ? U.mToFt(p.dischargeLengthM).toFixed(1)
      : Number(p.dischargeLengthM).toFixed(1);
    document.getElementById('inpPumpDisK').value = Number(p.dischargeFittingsK).toFixed(2);
    document.getElementById('inpPumpEquipDp').value = isUSC()
      ? U.barToPsi(p.equipmentDpBar).toFixed(1)
      : Number(p.equipmentDpBar).toFixed(2);
    document.getElementById('inpPumpCvMinDp').value = isUSC()
      ? U.barToPsi(p.cvMinDpBar).toFixed(1)
      : Number(p.cvMinDpBar).toFixed(2);
    document.getElementById('inpPumpCvMax').value = Number(p.cvRatedMaxCv).toFixed(1);
    document.getElementById('inpPumpEff').value = Number(p.pumpEfficiencyPct).toFixed(1);
    document.getElementById('inpPumpShutoffRise').value = Number(p.shutoffRisePct).toFixed(0);
  }

  function readDomInputsToPump() {
    const p = state.pumpLoop;
    if (!p || !document.getElementById('inpPumpTag')) return;
    p.pumpTag = document.getElementById('inpPumpTag').value.trim() || 'P-NEW';
    p.service = document.getElementById('inpPumpService').value.trim();

    const rawQ = num('inpPumpNormFlow', 100);
    p.normalFlowM3Hr = isUSC() ? U.gpmToM3Hr(rawQ) : rawQ;
    p.ratedMarginPct = num('inpPumpRatedMargin', 10);

    const rawRho = num('inpPumpRho', 1000);
    p.rhoKgM3 = isUSC() ? U.lbft3ToKgm3(rawRho) : rawRho;
    p.viscCp = num('inpPumpVisc', 1.0);

    const rawPv = num('inpPumpVaporPress', 0.2);
    p.vaporPressBara = isUSC() ? U.psiToBar(rawPv) : rawPv;

    const rawT = num('inpPumpTemp', 50);
    p.tempC = isUSC() ? U.fToC(rawT) : rawT;

    const rawPs = num('inpPumpSucPress', 1.0);
    p.suctionVesselBarg = isUSC() ? U.psiToBar(rawPs) : rawPs;

    const rawZs = num('inpPumpSucHead', 4.0);
    p.suctionStaticHeadM = isUSC() ? U.ftToM(rawZs) : rawZs;

    p.suctionNps = document.getElementById('inpPumpSucNps').value;
    const rawLs = num('inpPumpSucLength', 12.0);
    p.suctionLengthM = isUSC() ? U.ftToM(rawLs) : rawLs;
    p.suctionFittingsK = num('inpPumpSucK', 2.2);

    const rawNpshr = num('inpPumpNpshr', 3.0);
    p.npshrM = isUSC() ? U.ftToM(rawNpshr) : rawNpshr;

    const rawPd = num('inpPumpDestPress', 10.0);
    p.destVesselBarg = isUSC() ? U.psiToBar(rawPd) : rawPd;

    const rawZd = num('inpPumpDisHead', 20.0);
    p.dischargeStaticHeadM = isUSC() ? U.ftToM(rawZd) : rawZd;

    p.dischargeNps = document.getElementById('inpPumpDisNps').value;
    const rawLd = num('inpPumpDisLength', 80.0);
    p.dischargeLengthM = isUSC() ? U.ftToM(rawLd) : rawLd;
    p.dischargeFittingsK = num('inpPumpDisK', 5.8);

    const rawEqDp = num('inpPumpEquipDp', 0.65);
    p.equipmentDpBar = isUSC() ? U.psiToBar(rawEqDp) : rawEqDp;

    const rawCvDp = num('inpPumpCvMinDp', 0.70);
    p.cvMinDpBar = isUSC() ? U.psiToBar(rawCvDp) : rawCvDp;

    p.cvRatedMaxCv = num('inpPumpCvMax', 145);
    p.pumpEfficiencyPct = num('inpPumpEff', 75);
    p.shutoffRisePct = num('inpPumpShutoffRise', 20);
  }

  function syncVesselToDomInputs() {
    const v = state.vessel;
    if (!v || !document.getElementById('inpVesselTag')) return;
    const presetSel = document.getElementById('vesselPresetSelect');
    if (presetSel && [...presetSel.options].some(o => o.value === v.vesselTag)) {
      presetSel.value = v.vesselTag;
    }
    document.getElementById('inpVesselTag').value = v.vesselTag || 'V-1001';
    document.getElementById('inpVesselService').value = v.service || '';
    document.getElementById('inpVesselServiceType').value = v.vesselServiceType || 'vertical_ko';
    document.getElementById('inpVesselOrientation').value = v.orientation || 'vertical';
    document.getElementById('inpVesselInternals').value = v.internalsType || 'demister';
    document.getElementById('inpVesselInletDevice').value = v.inletDevice || 'half_pipe';

    document.getElementById('inpVesselOpPress').value = isUSC()
      ? U.barToPsi(v.operatingPressureBarg).toFixed(1)
      : Number(v.operatingPressureBarg).toFixed(2);
    document.getElementById('inpVesselDesPress').value = isUSC()
      ? U.barToPsi(v.designPressureBarg).toFixed(1)
      : Number(v.designPressureBarg).toFixed(2);

    document.getElementById('inpVesselVapFlow').value = isUSC()
      ? Math.round(U.kgHrToLbHr(v.vaporFlowKgHr))
      : Math.round(v.vaporFlowKgHr);
    document.getElementById('inpVesselVapRho').value = isUSC()
      ? U.kgm3ToLbft3(v.vaporDensityKgM3).toFixed(2)
      : Number(v.vaporDensityKgM3).toFixed(2);

    document.getElementById('inpVesselLiqFlow').value = isUSC()
      ? Math.round(U.kgHrToLbHr(v.liquidFlowKgHr))
      : Math.round(v.liquidFlowKgHr);
    document.getElementById('inpVesselLiqRho').value = isUSC()
      ? U.kgm3ToLbft3(v.liquidDensityKgM3).toFixed(2)
      : Number(v.liquidDensityKgM3).toFixed(1);

    document.getElementById('inpVesselWaterFlow').value = isUSC()
      ? Math.round(U.kgHrToLbHr(v.waterFlowKgHr || 0))
      : Math.round(v.waterFlowKgHr || 0);
    document.getElementById('inpVesselLatent').value = isUSC()
      ? U.kjKgToBtuLb(v.latentHeatKjKg || 320).toFixed(1)
      : Number(v.latentHeatKjKg || 320).toFixed(1);

    document.getElementById('inpVesselHoldupMin').value = Number(v.holdupTimeMin).toFixed(1);
    document.getElementById('inpVesselSurgeMin').value = Number(v.surgeTimeMin).toFixed(1);
    document.getElementById('inpVesselTargetLd').value = Number(v.targetLdRatio).toFixed(2);
    document.getElementById('inpVesselElevGrade').value = isUSC()
      ? U.mToFt(v.elevAboveGradeM).toFixed(1)
      : Number(v.elevAboveGradeM).toFixed(2);

    document.getElementById('inpVesselMaterial').value = v.materialCode || 'SA-516-70';
    document.getElementById('inpVesselHeadType').value = v.headType || 'ellipsoidal';
    const jeSel = document.getElementById('inpVesselJointEff');
    const jeTarget = Number(v.jointEfficiencyE ?? 1.0);
    const jeOpt = [...jeSel.options].find(o => Math.abs(Number(o.value) - jeTarget) < 1e-6);
    jeSel.value = jeOpt ? jeOpt.value : '1.0';
    document.getElementById('inpVesselCorrosionMm').value = Number(v.corrosionAllowanceMm ?? 3.0).toFixed(1);

    const waterFg = document.getElementById('vesselWaterFlowFieldGroup');
    if (waterFg) {
      waterFg.style.opacity = v.vesselServiceType === 'three_phase' ? '1.0' : '0.68';
    }
  }

  function readDomInputsToVessel() {
    const v = state.vessel;
    if (!v || !document.getElementById('inpVesselTag')) return;
    v.vesselTag = document.getElementById('inpVesselTag').value.trim() || 'V-NEW';
    v.service = document.getElementById('inpVesselService').value.trim();
    v.vesselServiceType = document.getElementById('inpVesselServiceType').value;
    v.orientation = document.getElementById('inpVesselOrientation').value;
    v.internalsType = document.getElementById('inpVesselInternals').value;
    v.inletDevice = document.getElementById('inpVesselInletDevice').value;

    const rawOpP = num('inpVesselOpPress', 10.0);
    v.operatingPressureBarg = isUSC() ? U.psiToBar(rawOpP) : rawOpP;

    const rawDesP = num('inpVesselDesPress', 15.0);
    v.designPressureBarg = isUSC() ? U.psiToBar(rawDesP) : rawDesP;

    const rawWv = num('inpVesselVapFlow', 20000);
    v.vaporFlowKgHr = isUSC() ? U.lbHrToKgHr(rawWv) : rawWv;

    const rawRhoV = num('inpVesselVapRho', 15.0);
    v.vaporDensityKgM3 = isUSC() ? U.lbft3ToKgm3(rawRhoV) : rawRhoV;

    const rawWl = num('inpVesselLiqFlow', 30000);
    v.liquidFlowKgHr = isUSC() ? U.lbHrToKgHr(rawWl) : rawWl;

    const rawRhoL = num('inpVesselLiqRho', 800);
    v.liquidDensityKgM3 = isUSC() ? U.lbft3ToKgm3(rawRhoL) : rawRhoL;

    const rawWw = num('inpVesselWaterFlow', 0);
    v.waterFlowKgHr = isUSC() ? U.lbHrToKgHr(rawWw) : rawWw;

    const rawLat = num('inpVesselLatent', 320);
    v.latentHeatKjKg = isUSC() ? U.btuLbToKjKg(rawLat) : rawLat;

    v.holdupTimeMin = num('inpVesselHoldupMin', 5.0);
    v.surgeTimeMin = num('inpVesselSurgeMin', 3.0);
    v.targetLdRatio = num('inpVesselTargetLd', 3.2);

    const rawElev = num('inpVesselElevGrade', 2.0);
    v.elevAboveGradeM = isUSC() ? U.ftToM(rawElev) : rawElev;

    v.materialCode = document.getElementById('inpVesselMaterial').value;
    v.headType = document.getElementById('inpVesselHeadType').value;
    v.jointEfficiencyE = parseFloat(document.getElementById('inpVesselJointEff').value) || 1.0;
    v.corrosionAllowanceMm = num('inpVesselCorrosionMm', 3.0);
  }

  // =========================================================================
  // 3. STEP 1: API 521 OVERPRESSURE SCENARIOS & P&ID SCENARIO IDENTIFICATION
  // =========================================================================

  function syncPidSystemToDomInputs(updateNotes = false) {
    const p = state.pidSystem;
    if (!p || !document.getElementById('pidInpMawp')) return;
    const presetSel = document.getElementById('pidSystemPresetSelect');
    if (presetSel && p.id && [...presetSel.options].some(o => o.value === p.id)) {
      presetSel.value = p.id;
    }
    document.getElementById('pidInpMawp').value = isUSC()
      ? U.barToPsi(p.mawpBarg).toFixed(1)
      : Number(p.mawpBarg).toFixed(2);
    document.getElementById('pidInpUpSourcePress').value = isUSC()
      ? U.barToPsi(p.upstreamMaxSourceBarg).toFixed(1)
      : Number(p.upstreamMaxSourceBarg).toFixed(2);
    document.getElementById('pidInpUpInflow').value = isUSC()
      ? Math.round(U.kgHrToLbHr(p.maxSourceInflowKgHr))
      : Math.round(p.maxSourceInflowKgHr);
    document.getElementById('pidInpOutletBlock').value = String(Boolean(p.hasOutletBlockValve));
    document.getElementById('pidInpCvUpPress').value = isUSC()
      ? U.barToPsi(p.cvUpstreamPressBarg).toFixed(1)
      : Number(p.cvUpstreamPressBarg).toFixed(2);
    document.getElementById('pidInpCvRated').value = Number(p.cvRatedMaxCv || 0).toFixed(1);
    document.getElementById('pidInpReboilerDuty').value = Number(p.reboilerNormalDutyKw || 0).toFixed(0);
    document.getElementById('pidInpReboilerSurge').value = Number(p.reboilerSurgeFactor || 1.5).toFixed(2);
    document.getElementById('pidInpExchHpPress').value = isUSC()
      ? U.barToPsi(p.exchangerHpBarg || 0).toFixed(1)
      : Number(p.exchangerHpBarg || 0).toFixed(1);
    document.getElementById('pidInpFireZone').value = p.inFireZone === false
      ? 'none'
      : (p.fireZone && p.fireZone.liquidInventoryPresent === false ? 'unwetted' : 'wetted');
    if (updateNotes && document.getElementById('inpPidNotesText')) {
      document.getElementById('inpPidNotesText').value = p.pidSummaryNotes || '';
    }
  }

  function readDomInputsToPidSystem() {
    const p = state.pidSystem;
    if (!p || !document.getElementById('pidInpMawp')) return;
    const rawMawp = num('pidInpMawp', 16.0);
    p.mawpBarg = isUSC() ? U.psiToBar(rawMawp) : rawMawp;
    p.setPressureBarg = p.mawpBarg;

    const rawUpP = num('pidInpUpSourcePress', 28.0);
    p.upstreamMaxSourceBarg = isUSC() ? U.psiToBar(rawUpP) : rawUpP;

    const rawInflow = num('pidInpUpInflow', 18000);
    p.maxSourceInflowKgHr = isUSC() ? U.lbHrToKgHr(rawInflow) : rawInflow;

    p.hasOutletBlockValve = document.getElementById('pidInpOutletBlock').value === 'true';

    const rawCvP = num('pidInpCvUpPress', 35.0);
    p.cvUpstreamPressBarg = isUSC() ? U.psiToBar(rawCvP) : rawCvP;
    p.cvRatedMaxCv = num('pidInpCvRated', 48);
    p.hasUpstreamControlValve = p.cvRatedMaxCv > 0 && p.cvUpstreamPressBarg > 0;

    p.reboilerNormalDutyKw = num('pidInpReboilerDuty', 0);
    p.reboilerSurgeFactor = num('pidInpReboilerSurge', 1.5);
    p.hasReboilerOrHeater = p.reboilerNormalDutyKw > 0;

    const rawExP = num('pidInpExchHpPress', 0);
    p.exchangerHpBarg = isUSC() ? U.psiToBar(rawExP) : rawExP;
    p.hasHeatExchanger = p.exchangerHpBarg > 0;

    const fireSel = document.getElementById('pidInpFireZone').value;
    p.inFireZone = fireSel !== 'none';
    p.fireZone = { ...(p.fireZone || {}), inFireZone: p.inFireZone, liquidInventoryPresent: fireSel !== 'unwetted' };
  }

  function renderPidTopologySvg(pidEval) {
    const container = document.getElementById('pidTopologySvgContainer');
    if (!container || !pidEval) return;
    const p = state.pidSystem;
    const mawp = pidEval.mawpBarg;
    const upCred = p.upstreamMaxSourceBarg > mawp && p.hasOutletBlockValve;
    const cvCred = p.hasUpstreamControlValve && p.cvUpstreamPressBarg > mawp;
    const rebCred = p.hasReboilerOrHeater && p.reboilerNormalDutyKw > 0;
    const trCred = p.hasHeatExchanger && p.exchangerHpBarg > mawp;
    const fireCred = p.inFireZone !== false;

    container.innerHTML = `
      <svg viewBox="0 0 460 158" width="100%" height="158" role="img" aria-label="P&ID System Boundary and Pressure Source Topology">
        <!-- Upstream Source Box -->
        <rect x="10" y="14" width="118" height="44" rx="6" fill="${upCred ? 'rgba(220,38,38,0.12)' : 'rgba(148,163,184,0.12)'}" stroke="${upCred ? '#dc2626' : '#64748b'}" stroke-width="1.8" />
        <text x="69" y="30" text-anchor="middle" font-size="8.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">${escapeHtml(String(p.upstreamSourceDesc || 'UPSTREAM SOURCE').slice(0, 18))}</text>
        <text x="69" y="43" text-anchor="middle" font-size="8.5" font-weight="800" fill="${upCred ? '#dc2626' : '#059669'}" font-family="JetBrains Mono">P_src = ${fmtPressG(p.upstreamMaxSourceBarg)}</text>
        <text x="69" y="53" text-anchor="middle" font-size="7.5" fill="#475569" font-family="JetBrains Mono">${fmtFlow(p.maxSourceInflowKgHr)}</text>

        <!-- Upstream Control Valve Loop -->
        <rect x="10" y="68" width="118" height="42" rx="6" fill="${cvCred ? 'rgba(217,119,6,0.14)' : 'rgba(148,163,184,0.10)'}" stroke="${cvCred ? '#d97706' : '#94a3b8'}" stroke-width="1.6" />
        <text x="69" y="83" text-anchor="middle" font-size="8.2" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">CV ${escapeHtml(String(p.cvTag || 'PCV/LV').split(/[\s(]/)[0].slice(0, 10))} · Cv ${Number(p.cvRatedMaxCv || 0).toFixed(0)}</text>
        <text x="69" y="96" text-anchor="middle" font-size="8.2" font-weight="700" fill="${cvCred ? '#d97706' : '#64748b'}" font-family="JetBrains Mono">P_up = ${fmtPressG(p.cvUpstreamPressBarg)}</text>

        <!-- Exchanger / Reboiler Node -->
        <rect x="10" y="116" width="118" height="36" rx="6" fill="${rebCred || trCred ? 'rgba(2,132,199,0.12)' : 'rgba(148,163,184,0.08)'}" stroke="${rebCred || trCred ? '#0284c7' : '#cbd5e1'}" stroke-width="1.5" />
        <text x="69" y="131" text-anchor="middle" font-size="8" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">Reb: ${p.reboilerNormalDutyKw}kW × ${p.reboilerSurgeFactor}</text>
        <text x="69" y="144" text-anchor="middle" font-size="7.8" font-weight="700" fill="${trCred ? '#dc2626' : '#475569'}" font-family="JetBrains Mono">Tube P_HP: ${fmtPressG(p.exchangerHpBarg)}</text>

        <!-- Feed Arrows into Protected Equipment -->
        <line x1="128" y1="36" x2="178" y2="62" stroke="${upCred ? '#dc2626' : '#64748b'}" stroke-width="2.2" />
        <line x1="128" y1="88" x2="178" y2="82" stroke="${cvCred ? '#d97706' : '#94a3b8'}" stroke-width="2.2" />
        <line x1="128" y1="134" x2="178" y2="104" stroke="${rebCred || trCred ? '#0284c7' : '#cbd5e1'}" stroke-width="2" />

        <!-- Protected Vessel Center -->
        <rect x="178" y="34" width="136" height="92" rx="16" fill="rgba(2,132,199,0.14)" stroke="#0369a1" stroke-width="2.5" />
        <text x="246" y="54" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">${escapeHtml(String(p.equipmentTag || state.tag.equipmentProtected).slice(0, 16))}</text>
        <text x="246" y="70" text-anchor="middle" font-size="9" font-weight="800" fill="#0369a1" font-family="JetBrains Mono">MAWP: ${fmtPressG(mawp)}</text>
        <text x="246" y="85" text-anchor="middle" font-size="8.3" fill="#334155" font-family="JetBrains Mono">P_op: ${fmtPressG(p.operatingPressureBarg)}</text>
        <text x="246" y="100" text-anchor="middle" font-size="8" font-weight="700" fill="${fireCred ? '#dc2626' : '#64748b'}" font-family="JetBrains Mono">${fireCred ? '🔥 Fire Zone Active' : 'No Fire Zone'}</text>
        <text x="246" y="115" text-anchor="middle" font-size="8" font-weight="800" fill="#059669" font-family="JetBrains Mono">Gov: Orifice "${pidEval.governingScenario.orifice.letter}"</text>

        <!-- Top Relief Line to PSV -->
        <path d="M246,34 L246,14 L356,14" fill="none" stroke="#059669" stroke-width="3" class="svg-flow-anim" />
        <rect x="356" y="4" width="94" height="24" rx="4" fill="#0f172a" />
        <text x="403" y="19" text-anchor="middle" font-size="8.5" font-weight="800" fill="#38bdf8" font-family="JetBrains Mono">${escapeHtml(p.psvTag || state.tag.tagNumber)} (${pidEval.governingScenario.orifice.letter})</text>

        <!-- Outlet Line & Isolation Valve -->
        <line x1="314" y1="82" x2="445" y2="82" stroke="${p.hasOutletBlockValve ? '#dc2626' : '#059669'}" stroke-width="3.5" />
        <rect x="342" y="92" width="102" height="36" rx="5" fill="#ffffff" stroke="${p.hasOutletBlockValve ? '#fca5a5' : '#6ee7b7'}" />
        <text x="393" y="107" text-anchor="middle" font-size="8" font-weight="800" fill="${p.hasOutletBlockValve ? '#dc2626' : '#059669'}" font-family="JetBrains Mono">${p.hasOutletBlockValve ? '⛔ OUTLET BLOCKABLE' : '✓ OPEN OUTLET PATH'}</text>
        <text x="393" y="120" text-anchor="middle" font-size="7.6" fill="#475569" font-family="JetBrains Mono">${pidEval.credibleCount}/${pidEval.scenarios.length} Credible</text>
      </svg>
    `;
  }

  function renderPidScenarioIdentifier() {
    const tbody = document.getElementById('pidScenarioMatrixTbody');
    if (!tbody || typeof E.evaluatePidScenarioIdentification !== 'function') return;

    const pidEval = E.evaluatePidScenarioIdentification(state.pidSystem, state.tag);
    renderPidTopologySvg(pidEval);

    const govLbl = document.getElementById('pidGoverningSummaryLabel');
    if (govLbl && pidEval.governingScenario) {
      govLbl.textContent = `Governing: ${pidEval.governingScenario.scenarioName} → Orifice "${pidEval.governingScenario.orifice.letter}" (${fmtFlow(pidEval.governingScenario.reliefRateKgHr)})`;
    }
    const refBadge = document.getElementById('pidActiveRefBadge');
    if (refBadge && state.pidSystem) {
      refBadge.textContent = `${state.pidSystem.id || state.pidSystem.pidNumber || 'P&ID'} Active (${pidEval.credibleCount}/7 Credible)`;
    }

    // Map optional AI scenario notes if Gemini analysis ran
    const aiScenMap = {};
    if (state.pidAiAnalysis && Array.isArray(state.pidAiAnalysis.scenarios)) {
      state.pidAiAnalysis.scenarios.forEach(s => {
        if (s && s.scenarioKey) aiScenMap[s.scenarioKey] = s;
      });
    }

    tbody.innerHTML = pidEval.scenarios.map(sc => {
      const isGov = sc.scenarioKey === pidEval.governingScenarioKey && sc.credible;
      const aiNote = aiScenMap[sc.scenarioKey];
      const credBadge = sc.credible
        ? `<span class="status-badge status-pass">CREDIBLE (${sc.credibilityLevel})</span>`
        : `<span class="status-badge" style="background:rgba(148,163,184,0.18);color:var(--text-muted);border:1px solid var(--border-subtle);">NOT CREDIBLE</span>`;
      return `
        <tr class="${isGov ? 'row-governing' : ''}" style="${sc.credible ? '' : 'opacity:0.68;'}">
          <td>
            <div style="font-weight:700;">${escapeHtml(sc.scenarioName)}</div>
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-top:2px;">
              ${isGov ? '<span class="status-badge status-pass">★ GOVERNING ON P&amp;ID</span>' : ''}
              <span class="mono" style="font-size:0.68rem;color:var(--text-muted);">OP ${sc.allowedOverpressurePct}%</span>
            </div>
          </td>
          <td>${credBadge}</td>
          <td class="mono" style="font-size:0.73rem;">${escapeHtml(aiNote && aiNote.pressureSourceVsMawp ? aiNote.pressureSourceVsMawp : sc.pressureComparison)}</td>
          <td style="font-size:0.74rem;max-width:360px;">
            <div><strong>${escapeHtml(sc.api521Clause)}:</strong> ${escapeHtml(sc.rationale)}</div>
            ${aiNote && aiNote.rationale ? `<div style="margin-top:3px;color:var(--accent-primary);font-size:0.72rem;"><strong>Gemini P&amp;ID Note:</strong> ${escapeHtml(aiNote.rationale)}</div>` : ''}
          </td>
          <td class="mono" style="font-weight:700;">${sc.credible ? fmtFlow(sc.reliefRateKgHr) : '0 kg/h'}</td>
          <td class="mono" style="font-weight:700;color:${sc.credible ? 'var(--accent-primary)' : 'var(--text-muted)'};">
            ${sc.credible ? `${sc.reqAreaMm2.toFixed(1)} mm² → Orifice "${sc.orifice.letter}"` : '—'}
          </td>
          <td>
            <button type="button" class="btn btn-secondary btn-load-pid-scen" data-skey="${sc.scenarioKey}" style="padding:0.22rem 0.5rem;font-size:0.72rem;">
              Load →
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-load-pid-scen').forEach(btn => {
      btn.addEventListener('click', () => {
        syncPidResultsToWorkbench(btn.dataset.skey, false);
      });
    });
  }

  function syncPidResultsToWorkbench(targetScenarioKey, sendToStep2 = false) {
    readDomInputsToPidSystem();
    const p = state.pidSystem;
    const pidEval = E.evaluatePidScenarioIdentification(p, state.tag);
    const chosenKey = targetScenarioKey || pidEval.governingScenarioKey || 'blocked_outlet';

    // Update active tag metadata & pressure boundary from P&ID
    if (p.pidNumber) state.tag.pidNumber = p.pidNumber;
    if (p.equipmentTag) {
      state.tag.equipmentProtected = p.equipmentService
        ? `${p.equipmentTag} (${p.equipmentService})`
        : p.equipmentTag;
    }
    state.tag.setPressureBarg = Number(p.mawpBarg.toFixed(2));
    state.tag.mawpBarg = state.tag.setPressureBarg;
    state.tag.operatingPressureBarg = Number(Math.min(p.mawpBarg * 0.9, p.operatingPressureBarg || p.mawpBarg * 0.78).toFixed(2));

    // Populate Step 1 scenario objects from P&ID boundary
    const sc = state.tag.scenarios;
    sc.blockedOutlet.sourceType = p.upstreamMaxSourceBarg > p.mawpBarg * 1.25 ? 'pump_compressor' : 'upstream_header';
    sc.blockedOutlet.maxInflowKgHr = Math.round(p.maxSourceInflowKgHr || 0);
    sc.blockedOutlet.creditedOutflowKgHr = 0;

    sc.cvFailure.fluidPhase = p.cvFluidPhase || (state.tag.fluidPhase === 'liquid' ? 'liquid' : 'gas');
    sc.cvFailure.ratedCv = Number(p.cvRatedMaxCv || 48);
    sc.cvFailure.bypassCv = Number(p.cvBypassCv || 0);
    sc.cvFailure.upstreamPressBarg = Number(p.cvUpstreamPressBarg || 30);
    sc.cvFailure.normalFlowCreditKgHr = Number(p.cvNormalFlowCreditKgHr || 0);

    if (!sc.abnormalHeat) sc.abnormalHeat = {};
    sc.abnormalHeat.heatSourceType = p.reboilerSourceType || 'steam_reboiler';
    sc.abnormalHeat.normalDutyKw = Number(p.reboilerNormalDutyKw || 850);
    sc.abnormalHeat.abnormalSurgeFactor = Number(p.reboilerSurgeFactor || 1.5);
    sc.abnormalHeat.condenserCreditKw = Number(p.condenserCreditKw || 0);
    sc.abnormalHeat.latentHeatKjKg = Number(p.latentHeatKjKg || sc.fireLiquid.latentHeatKjKg || 320);

    sc.tubeRupture.hpFluidPhase = p.exchangerHpPhase || 'liquid';
    sc.tubeRupture.tubeIdMm = Number(p.exchangerTubeIdMm || 15.7);
    sc.tubeRupture.hpPressureBarg = Number(Math.max(5, p.exchangerHpBarg || 45));

    if (p.fireDiameterM) sc.fireLiquid.diameterM = Number(p.fireDiameterM);
    if (p.fireLengthM) sc.fireLiquid.lengthM = Number(p.fireLengthM);
    if (p.fireNllM) sc.fireLiquid.nllM = Number(p.fireNllM);
    if (p.latentHeatKjKg) sc.fireLiquid.latentHeatKjKg = Number(p.latentHeatKjKg);

    state.activeScenarioKey = chosenKey;
    state.tag.governingScenarioKey = pidEval.governingScenarioKey;

    document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.scenario === state.activeScenarioKey);
    });

    syncTagToDomInputs();
    renderScenarioForm();
    recomputeAll();

    if (sendToStep2) {
      const bundle = evaluateAllScenariosForTag(state.tag);
      const targetEv = bundle.map[chosenKey] || bundle.governing;
      applyScenarioToStep2(targetEv);
      showToast(`Synced P&ID (${p.pidNumber}) & Governing Scenario "${targetEv.scenarioName}" to Step 2 Orifice Sizing.`, 'ok');
    } else {
      showToast(`Loaded P&ID Scenario "${chosenKey}" into Step 1 workbench.`, 'ok');
    }
  }

  function applyUploadedPidJson(obj, fname) {
    if (!obj || typeof obj !== 'object') return;
    const p = state.pidSystem;
    if (obj.pidNumber) p.pidNumber = String(obj.pidNumber);
    if (obj.equipmentTag) p.equipmentTag = String(obj.equipmentTag);
    if (obj.equipmentService) p.equipmentService = String(obj.equipmentService);
    if (obj.psvTag) p.psvTag = String(obj.psvTag);

    // Support both flat pidSystem schema and nested sample_pid_boundary_v1 schema
    const eq = obj.protectedEquipment || obj;
    if (Number.isFinite(Number(eq.mawpBarg)) && Number(eq.mawpBarg) > 0) p.mawpBarg = Number(eq.mawpBarg);
    if (Number.isFinite(Number(eq.operatingPressureBarg))) p.operatingPressureBarg = Number(eq.operatingPressureBarg);
    if (typeof eq.inFireZone === 'boolean') p.inFireZone = eq.inFireZone;
    if (Number.isFinite(Number(eq.diameterM))) p.fireDiameterM = Number(eq.diameterM);
    if (Number.isFinite(Number(eq.lengthM))) p.fireLengthM = Number(eq.lengthM);
    if (Number.isFinite(Number(eq.nllM))) p.fireNllM = Number(eq.nllM);

    const up = obj.upstreamPressureSources || obj;
    if (up.upstreamSourceDesc) p.upstreamSourceDesc = String(up.upstreamSourceDesc);
    if (Number.isFinite(Number(up.upstreamMaxSourceBarg))) p.upstreamMaxSourceBarg = Number(up.upstreamMaxSourceBarg);
    if (Number.isFinite(Number(up.maxSourceInflowKgHr))) p.maxSourceInflowKgHr = Number(up.maxSourceInflowKgHr);
    if (typeof up.hasOutletBlockValve === 'boolean') p.hasOutletBlockValve = up.hasOutletBlockValve;

    const cv = obj.controlValves || obj;
    if (cv.cvTag) p.cvTag = String(cv.cvTag);
    if (Number.isFinite(Number(cv.cvUpstreamPressBarg))) p.cvUpstreamPressBarg = Number(cv.cvUpstreamPressBarg);
    if (Number.isFinite(Number(cv.cvRatedMaxCv))) p.cvRatedMaxCv = Number(cv.cvRatedMaxCv);
    if (Number.isFinite(Number(cv.cvBypassCv))) p.cvBypassCv = Number(cv.cvBypassCv);
    if (Number.isFinite(Number(cv.cvNormalFlowCreditKgHr))) p.cvNormalFlowCreditKgHr = Number(cv.cvNormalFlowCreditKgHr);
    if (cv.cvFluidPhase) p.cvFluidPhase = String(cv.cvFluidPhase);
    p.hasUpstreamControlValve = p.cvRatedMaxCv > 0 && p.cvUpstreamPressBarg > 0;

    const ht = obj.heatInputsAndExchangers || obj;
    if (Number.isFinite(Number(ht.reboilerNormalDutyKw))) p.reboilerNormalDutyKw = Number(ht.reboilerNormalDutyKw);
    if (Number.isFinite(Number(ht.reboilerSurgeFactor))) p.reboilerSurgeFactor = Number(ht.reboilerSurgeFactor);
    if (Number.isFinite(Number(ht.condenserCreditKw))) p.condenserCreditKw = Number(ht.condenserCreditKw);
    if (Number.isFinite(Number(ht.latentHeatKjKg))) p.latentHeatKjKg = Number(ht.latentHeatKjKg);
    if (Number.isFinite(Number(ht.exchangerHpBarg))) p.exchangerHpBarg = Number(ht.exchangerHpBarg);
    if (Number.isFinite(Number(ht.exchangerTubeIdMm))) p.exchangerTubeIdMm = Number(ht.exchangerTubeIdMm);
    p.hasReboilerOrHeater = p.reboilerNormalDutyKw > 0;
    p.hasHeatExchanger = p.exchangerHpBarg > 0;

    if (obj.pidSummaryNotes) {
      p.pidSummaryNotes = String(obj.pidSummaryNotes);
    }
    state.pidAttachment = {
      name: fname || 'pid_spec.json',
      mimeType: 'application/json',
      base64Data: '',
      extractedText: JSON.stringify(obj, null, 2).slice(0, 12000)
    };
    syncPidSystemToDomInputs(true);
    renderPidScenarioIdentifier();
  }

  function extractPrintableTextFromPdfBase64(b64) {
    try {
      const bin = atob(b64);
      const chunks = [];
      // Extract parenthesized PDF text literals (...) and readable ASCII runs
      const litRe = /\(([^()\\]{3,160})\)/g;
      let m;
      while ((m = litRe.exec(bin)) !== null && chunks.length < 180) {
        const s = m[1].replace(/[^\x20-\x7E]/g, ' ').trim();
        if (/[A-Za-z]{2,}/.test(s)) chunks.push(s);
      }
      if (chunks.length > 0) return chunks.join(' · ').slice(0, 6000);
      const asciiRuns = bin.match(/[A-Za-z0-9_.,:/\-()°% ]{8,120}/g) || [];
      return asciiRuns.slice(0, 80).join(' ').slice(0, 4000);
    } catch (_) {
      return '';
    }
  }

  function parseTextHintsIntoPidSystem(text) {
    if (!text) return;
    const p = state.pidSystem;
    const mawpM = /MAWP\s*[:=]?\s*(\d+(?:\.\d+)?)\s*barg/i.exec(text);
    if (mawpM) p.mawpBarg = parseFloat(mawpM[1]);
    const srcM = /(?:upstream|source|manifold|shutoff)[^.\n]*?(\d+(?:\.\d+)?)\s*barg/i.exec(text);
    if (srcM) p.upstreamMaxSourceBarg = parseFloat(srcM[1]);
    const cvM = /Cv\s*[:=]?\s*(\d+(?:\.\d+)?)/i.exec(text);
    if (cvM) {
      p.cvRatedMaxCv = parseFloat(cvM[1]);
      p.hasUpstreamControlValve = true;
    }
    const rebM = /(?:reboiler|heater|duty)[^.\n]*?(\d+(?:\.\d+)?)\s*kW/i.exec(text);
    if (rebM) {
      p.reboilerNormalDutyKw = parseFloat(rebM[1]);
      p.hasReboilerOrHeater = true;
    }
    const tubeM = /(?:HP\s*tube|tube\s*side|exchanger\s*HP)[^.\n]*?(\d+(?:\.\d+)?)\s*barg/i.exec(text);
    if (tubeM) {
      p.exchangerHpBarg = parseFloat(tubeM[1]);
      p.hasHeatExchanger = true;
    }
    syncPidSystemToDomInputs(false);
    renderPidScenarioIdentifier();
  }

  function renderPidAiAnalysisBanner(aiData, modeLabel) {
    const banner = document.getElementById('pidAiAnalysisBanner');
    if (!banner || !aiData) return;
    banner.style.display = 'block';
    const notesHtml = Array.isArray(aiData.engineeringNotes) && aiData.engineeringNotes.length
      ? `<ul style="margin:0.35rem 0 0 1.1rem;padding:0;">${aiData.engineeringNotes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
      : '';
    banner.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.3rem;">
        <div style="font-weight:800;color:var(--accent-primary);">
          🤖 P&amp;ID Scenario Identification Report (${escapeHtml(modeLabel || 'gemini-flash-latest')})
        </div>
        <span class="status-badge status-pass">API 521 §4 Verified</span>
      </div>
      <div style="margin-bottom:0.28rem;"><strong>System Boundary Summary:</strong> ${escapeHtml(aiData.pidSummary || '')}</div>
      <div style="color:var(--pass-text);font-weight:700;"><strong>Governing Recommendation:</strong> ${escapeHtml(aiData.governingRecommendation || '')}</div>
      ${notesHtml}
    `;
  }

  async function analyzePidWithGemini() {
    readDomInputsToPidSystem();
    const btn = document.getElementById('btnAnalyzePidGemini');
    const origText = btn ? btn.textContent : '🤖 Analyze P&ID with Gemini';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Analyzing P&ID with Gemini...';
    }

    const notesText = document.getElementById('inpPidNotesText') ? document.getElementById('inpPidNotesText').value : '';
    const combinedRefText = [
      notesText,
      state.pidAttachment && state.pidAttachment.extractedText ? state.pidAttachment.extractedText : ''
    ].filter(Boolean).join('\n\n').slice(0, 14000);

    let aiResult = null;
    let modeLabel = 'gemini-flash-latest · Live P&ID Analysis';

    try {
      const payload = {
        mode: 'pid_scenario_id',
        pidSpec: state.pidSystem,
        referenceText: combinedRefText
      };
      if (state.pidAttachment && state.pidAttachment.base64Data) {
        payload.fileAttachment = {
          name: state.pidAttachment.name,
          mimeType: state.pidAttachment.mimeType,
          base64Data: state.pidAttachment.base64Data
        };
      }
      const resp = await fetch('/api/ask-psv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok && data.pidAnalysis) {
          aiResult = data.pidAnalysis;
          modeLabel = `${data.model || 'gemini-flash-latest'} · Multimodal P&ID Engine`;
        }
      }
    } catch (_) {
      // Offline fallback to deterministic API 521 §4 P&ID Topology Engine
    }

    if (aiResult && aiResult.extractedTopology && typeof aiResult.extractedTopology === 'object') {
      const ext = aiResult.extractedTopology;
      const p = state.pidSystem;
      if (Number.isFinite(Number(ext.mawpBarg)) && Number(ext.mawpBarg) > 0) p.mawpBarg = Number(ext.mawpBarg);
      if (Number.isFinite(Number(ext.upstreamMaxSourceBarg)) && Number(ext.upstreamMaxSourceBarg) > 0) p.upstreamMaxSourceBarg = Number(ext.upstreamMaxSourceBarg);
      if (Number.isFinite(Number(ext.maxSourceInflowKgHr)) && Number(ext.maxSourceInflowKgHr) > 0) p.maxSourceInflowKgHr = Number(ext.maxSourceInflowKgHr);
      if (typeof ext.hasOutletBlockValve === 'boolean') p.hasOutletBlockValve = ext.hasOutletBlockValve;
      if (Number.isFinite(Number(ext.cvUpstreamPressBarg)) && Number(ext.cvUpstreamPressBarg) > 0) p.cvUpstreamPressBarg = Number(ext.cvUpstreamPressBarg);
      if (Number.isFinite(Number(ext.cvRatedMaxCv)) && Number(ext.cvRatedMaxCv) >= 0) p.cvRatedMaxCv = Number(ext.cvRatedMaxCv);
      if (Number.isFinite(Number(ext.reboilerNormalDutyKw)) && Number(ext.reboilerNormalDutyKw) >= 0) p.reboilerNormalDutyKw = Number(ext.reboilerNormalDutyKw);
      if (Number.isFinite(Number(ext.reboilerSurgeFactor)) && Number(ext.reboilerSurgeFactor) >= 1) p.reboilerSurgeFactor = Number(ext.reboilerSurgeFactor);
      if (Number.isFinite(Number(ext.exchangerHpBarg)) && Number(ext.exchangerHpBarg) >= 0) p.exchangerHpBarg = Number(ext.exchangerHpBarg);
      if (typeof ext.inFireZone === 'boolean') p.inFireZone = ext.inFireZone;
      p.hasUpstreamControlValve = p.cvRatedMaxCv > 0 && p.cvUpstreamPressBarg > 0;
      p.hasReboilerOrHeater = p.reboilerNormalDutyKw > 0;
      p.hasHeatExchanger = p.exchangerHpBarg > 0;
      syncPidSystemToDomInputs(false);
    }

    const pidEval = E.evaluatePidScenarioIdentification(state.pidSystem, state.tag);
    if (!aiResult) {
      modeLabel = 'Built-in API 521 §4 P&ID Topology Engine';
      aiResult = {
        pidSummary: `Evaluated P&ID ${state.pidSystem.pidNumber || 'Boundary'} protecting ${state.pidSystem.equipmentTag || state.tag.equipmentProtected} (MAWP = ${fmtPressG(pidEval.mawpBarg)}). Identified ${pidEval.credibleCount} credible overpressure scenarios out of ${pidEval.scenarios.length} screened causes.`,
        governingRecommendation: `${pidEval.governingScenario.scenarioName} governs with W = ${fmtFlow(pidEval.governingScenario.reliefRateKgHr)} and A_req = ${pidEval.governingScenario.reqAreaMm2.toFixed(1)} mm² (API 526 Orifice "${pidEval.governingScenario.orifice.letter}").`,
        scenarios: pidEval.scenarios,
        engineeringNotes: [
          `Upstream source pressure (${fmtPressG(state.pidSystem.upstreamMaxSourceBarg)}) vs MAWP (${fmtPressG(pidEval.mawpBarg)}) determines Blocked Outlet credibility per API 521 §4.4.2.`,
          `Upstream CV (${state.pidSystem.cvTag || 'PCV'}, Cv=${state.pidSystem.cvRatedMaxCv}) fail-open evaluated per API 521 §4.4.8 / IEC 60534.`
        ]
      };
    }

    state.pidAiAnalysis = aiResult;
    renderPidAiAnalysisBanner(aiResult, modeLabel);
    renderPidScenarioIdentifier();

    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function scenarioPhase(t, scenarioKey) {
    if (scenarioKey === 'thermal_expansion') return 'liquid';
    if (scenarioKey === 'fire_liquid' || scenarioKey === 'fire_gas' || scenarioKey === 'abnormal_heat') {
      // Fire and Abnormal Heat generate vapor: size on the vapor phase (steam service stays steam)
      return t.fluidPhase === 'steam' ? 'steam' : 'gas';
    }
    return t.fluidPhase;
  }

  function evaluateAllScenariosForTag(t) {
    const sc = t.scenarios;
    const fireLiq = E.calcFireLiquidVessel(sc.fireLiquid);
    const fireGas = E.calcFireGasVessel({
      ...sc.fireGas,
      setPressureBarg: t.setPressureBarg,
      operatingPressureBarg: t.operatingPressureBarg,
      atmPressureBara: t.atmPressureBara,
      mw: t.mw
    });
    const blocked = E.calcBlockedOutlet(sc.blockedOutlet);
    const cvFail = E.calcControlValveFailure({
      ...sc.cvFailure,
      setPressureBarg: t.setPressureBarg,
      atmPressureBara: t.atmPressureBara,
      tempC: t.relievingTempC,
      mw: t.mw,
      z: t.z,
      rhoLiqKgM3: t.rhoLiqKgM3
    });
    const thermal = E.calcThermalExpansion({
      ...sc.thermalExpansion,
      rhoLiqKgM3: t.rhoLiqKgM3
    });
    const tubeRup = E.calcTubeRupture({
      ...sc.tubeRupture,
      lpSetPressureBarg: t.setPressureBarg,
      atmPressureBara: t.atmPressureBara,
      rhoHpKgM3: t.rhoLiqKgM3,
      mwHp: t.mw,
      kHp: t.k,
      zHp: t.z,
      tempHpC: t.relievingTempC
    });
    const abnHeat = E.calcAbnormalHeatInput({
      heatSourceType: 'steam_reboiler',
      normalDutyKw: 950,
      abnormalSurgeFactor: 1.5,
      condenserCreditKw: 0,
      latentHeatKjKg: sc.fireLiquid ? sc.fireLiquid.latentHeatKjKg : 320,
      ...(sc.abnormalHeat || {})
    });

    const list = [fireLiq, fireGas, blocked, cvFail, thermal, tubeRup, abnHeat];

    // Estimate required orifice area for each scenario using Step 2 engine
    const evaluated = list.map(item => {
      const phaseForScen = scenarioPhase(t, item.scenarioKey);
      const sizing = E.sizeOrificeApi520({
        ...t,
        autoKb: state.autoKb,
        manualKb: state.manualKb,
        fluidPhase: phaseForScen,
        flowRateKgHr: Math.max(1, item.reliefRateKgHr),
        overpressurePct: item.allowedOverpressurePct
      });
      return {
        ...item,
        phaseForScen,
        P1_bara: sizing.P1_bara,
        reqAreaMm2: sizing.reqAreaMm2,
        reqAreaIn2: sizing.reqAreaIn2,
        orifice: sizing.selectedOrifice
      };
    });

    // Find governing scenario (maximum required orifice area)
    let governing = evaluated[0];
    for (const ev of evaluated) {
      if (ev.reqAreaMm2 > governing.reqAreaMm2) {
        governing = ev;
      }
    }

    return { evaluated, governing, map: Object.fromEntries(evaluated.map(e => [e.scenarioKey, e])) };
  }

  function renderScenarioForm() {
    const container = document.getElementById('scenarioInputContainer');
    const titleEl = document.getElementById('activeScenarioFormTitle');
    const stdEl = document.getElementById('activeScenarioStdBadge');
    const sc = state.tag.scenarios;
    const key = state.activeScenarioKey;

    if (key === 'fire_liquid') {
      const f = sc.fireLiquid;
      titleEl.textContent = '1A. External Fire — Liquid-Wetted Vessel';
      stdEl.textContent = 'API 521 §4.4.13.2.4';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group">
            <label class="field-label"><span>Vessel Orientation</span><span class="field-sym">Geom</span></label>
            <div class="input-with-unit">
              <select id="scFireOrientation">
                <option value="horizontal" ${f.orientation === 'horizontal' ? 'selected' : ''}>Horizontal Cylinder</option>
                <option value="vertical" ${f.orientation === 'vertical' ? 'selected' : ''}>Vertical Column / Vessel</option>
                <option value="spherical" ${f.orientation === 'spherical' ? 'selected' : ''}>Spherical Vessel</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Head Type</span><span class="field-sym">2:1 / Hemi</span></label>
            <div class="input-with-unit">
              <select id="scFireHeadType">
                <option value="ellipsoidal" ${f.headType === 'ellipsoidal' ? 'selected' : ''}>2:1 Ellipsoidal Heads</option>
                <option value="hemispherical" ${f.headType === 'hemispherical' ? 'selected' : ''}>Hemispherical Heads</option>
                <option value="flat" ${f.headType === 'flat' ? 'selected' : ''}>Flat Heads</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Vessel Inside Diameter (D)</span><span class="field-sym">D</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireDiam" step="0.1" min="0.2" value="${f.diameterM}" />
              <span class="unit-addon">m</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Tangent-to-Tangent Length (L)</span><span class="field-sym">L</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireLen" step="0.5" min="0.5" value="${f.lengthM}" />
              <span class="unit-addon">m</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Normal Liquid Level (NLL)</span><span class="field-sym">H_liq</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireNll" step="0.1" min="0.05" value="${f.nllM}" />
              <span class="unit-addon">m</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Vessel Bottom Above Grade</span><span class="field-sym">Z_bot</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireElev" step="0.1" min="0" value="${f.elevAboveGradeM}" />
              <span class="unit-addon">m</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Drainage &amp; Firefighting</span><span class="field-sym">C_fire</span></label>
            <div class="input-with-unit">
              <select id="scFireDrainage">
                <option value="true" ${f.drainageAdequate ? 'selected' : ''}>Adequate (Q = 43,200·F·A^0.82)</option>
                <option value="false" ${!f.drainageAdequate ? 'selected' : ''}>Inadequate (Q = 70,900·F·A^0.82)</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Environmental / Insulation Factor</span><span class="field-sym">F</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireFactorF" step="0.05" min="0.05" max="1.0" value="${f.envFactorF}" />
              <span class="unit-addon">0.05–1.0</span>
            </div>
          </div>
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Latent Heat of Vaporization at P₁ (λ)</span><span class="field-sym">λ</span></label>
            <div class="input-with-unit">
              <input type="number" id="scFireLatent" step="5" min="20" value="${f.latentHeatKjKg}" />
              <span class="unit-addon">kJ/kg</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'fire_gas') {
      const fg = sc.fireGas;
      titleEl.textContent = '1B. External Fire — Unwetted / Gas Vessel';
      stdEl.textContent = 'API 521 §4.4.13.2.7';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Total Exposed Vessel Surface Area</span><span class="field-sym">A'</span></label>
            <div class="input-with-unit">
              <input type="number" id="scGasArea" step="1" min="1" value="${fg.exposedAreaM2}" />
              <span class="unit-addon">m²</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Normal Operating Gas Temp (T_n)</span><span class="field-sym">T_n</span></label>
            <div class="input-with-unit">
              <input type="number" id="scGasTemp" step="1" value="${fg.normalGasTempC}" />
              <span class="unit-addon">°C</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Max Fire Wall Temperature (T_w)</span><span class="field-sym">T_w</span></label>
            <div class="input-with-unit">
              <input type="number" id="scGasWallTemp" step="5" value="${fg.maxWallTempC}" />
              <span class="unit-addon">°C (CS=593)</span>
            </div>
          </div>
        </div>
        <p style="font-size:0.74rem;color:var(--text-muted);margin-top:0.6rem;">Uninsulated vessel basis. T₁ = T_n × P₁/P_n uses the operating and set pressures from Step 2.</p>
      `;
    } else if (key === 'blocked_outlet') {
      const b = sc.blockedOutlet;
      titleEl.textContent = '1C. Blocked Outlet — Max Source Inflow';
      stdEl.textContent = 'API 521 §4.4.2';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Upstream Pressure Source Type</span><span class="field-sym">Source</span></label>
            <div class="input-with-unit">
              <select id="scBlockedType">
                <option value="upstream_header" ${b.sourceType === 'upstream_header' ? 'selected' : ''}>Upstream High-Pressure Process Header / Feed</option>
                <option value="pump_compressor" ${b.sourceType === 'pump_compressor' ? 'selected' : ''}>Centrifugal / PD Pump or Compressor Max Runout</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Max Upstream Source Inflow</span><span class="field-sym">W_in,max</span></label>
            <div class="input-with-unit">
              <input type="number" id="scBlockedInflow" step="100" min="0" value="${b.maxInflowKgHr}" />
              <span class="unit-addon">kg/h</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Credited Outflow (if any)</span><span class="field-sym">W_credit</span></label>
            <div class="input-with-unit">
              <input type="number" id="scBlockedCredit" step="100" min="0" value="${b.creditedOutflowKgHr}" />
              <span class="unit-addon">kg/h</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'cv_failure') {
      const c = sc.cvFailure;
      titleEl.textContent = '1D. Control Valve Failure (Fail-Open Cv)';
      stdEl.textContent = 'API 521 §4.4.8 / IEC 60534';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group">
            <label class="field-label"><span>Fluid Phase Across CV</span><span class="field-sym">Phase</span></label>
            <div class="input-with-unit">
              <select id="scCvPhase">
                <option value="gas" ${c.fluidPhase === 'gas' ? 'selected' : ''}>Gas / Vapor / Steam</option>
                <option value="liquid" ${c.fluidPhase === 'liquid' ? 'selected' : ''}>Liquid</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Control Valve Max Rated Cv</span><span class="field-sym">Cv_max</span></label>
            <div class="input-with-unit">
              <input type="number" id="scCvRated" step="1" min="0.5" value="${c.ratedCv}" />
              <span class="unit-addon">US gpm/√psi</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Credited Open Bypass Cv</span><span class="field-sym">Cv_byp</span></label>
            <div class="input-with-unit">
              <input type="number" id="scCvBypass" step="1" min="0" value="${c.bypassCv}" />
              <span class="unit-addon">Cv</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Upstream Header Pressure</span><span class="field-sym">P_up</span></label>
            <div class="input-with-unit">
              <input type="number" id="scCvUpPress" step="0.5" min="1" value="${c.upstreamPressBarg}" />
              <span class="unit-addon">barg</span>
            </div>
          </div>
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Normal Downstream Flow Credit (API 521)</span><span class="field-sym">W_norm</span></label>
            <div class="input-with-unit">
              <input type="number" id="scCvCredit" step="100" min="0" value="${c.normalFlowCreditKgHr}" />
              <span class="unit-addon">kg/h</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'thermal_expansion') {
      const th = sc.thermalExpansion;
      titleEl.textContent = '1E. Thermal / Hydraulic Expansion';
      stdEl.textContent = 'API 521 §4.4.12';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group">
            <label class="field-label"><span>Heat Input / Exchanger Duty (Q)</span><span class="field-sym">Q</span></label>
            <div class="input-with-unit">
              <input type="number" id="scThHeatKw" step="10" min="1" value="${th.heatInputKw}" />
              <span class="unit-addon">kW</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Cubic Thermal Expansion (α_v)</span><span class="field-sym">α_v</span></label>
            <div class="input-with-unit">
              <input type="number" id="scThAlpha" step="0.0001" min="0.0001" value="${th.alphaVPerC}" />
              <span class="unit-addon">1/°C</span>
            </div>
          </div>
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Liquid Specific Heat Capacity (Cp)</span><span class="field-sym">Cp</span></label>
            <div class="input-with-unit">
              <input type="number" id="scThCp" step="0.05" min="0.5" value="${th.cpLiqKjKgK}" />
              <span class="unit-addon">kJ/(kg·K)</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'tube_rupture') {
      const tr = sc.tubeRupture;
      titleEl.textContent = '1F. Heat Exchanger Tube Rupture (2 × A_tube)';
      stdEl.textContent = 'API 521 §4.4.14';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group">
            <label class="field-label"><span>High-Pressure Side Fluid Phase</span><span class="field-sym">Phase_HP</span></label>
            <div class="input-with-unit">
              <select id="scTrPhase">
                <option value="liquid" ${tr.hpFluidPhase === 'liquid' ? 'selected' : ''}>Liquid / Flashing Condensate</option>
                <option value="gas" ${tr.hpFluidPhase === 'gas' ? 'selected' : ''}>High-Pressure Gas / Vapor</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Single Exchanger Tube ID</span><span class="field-sym">d_tube</span></label>
            <div class="input-with-unit">
              <input type="number" id="scTrTubeId" step="0.5" min="4" value="${tr.tubeIdMm}" />
              <span class="unit-addon">mm</span>
            </div>
          </div>
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>HP Side Design / Operating Pressure</span><span class="field-sym">P_HP</span></label>
            <div class="input-with-unit">
              <input type="number" id="scTrHpPress" step="1" min="5" value="${tr.hpPressureBarg}" />
              <span class="unit-addon">barg</span>
            </div>
          </div>
        </div>
      `;
    } else if (key === 'abnormal_heat') {
      if (!sc.abnormalHeat) {
        sc.abnormalHeat = {
          heatSourceType: 'steam_reboiler',
          normalDutyKw: 950,
          abnormalSurgeFactor: 1.5,
          condenserCreditKw: 0,
          latentHeatKjKg: sc.fireLiquid ? sc.fireLiquid.latentHeatKjKg : 320
        };
      }
      const ah = sc.abnormalHeat;
      titleEl.textContent = '1G. Abnormal Process Heat Input (Reboiler / Heater)';
      stdEl.textContent = 'API 521 §4.4.5 & §4.4.6';
      container.innerHTML = `
        <div class="form-grid-2">
          <div class="field-group" style="grid-column: span 2;">
            <label class="field-label"><span>Heating Medium / Source Type</span><span class="field-sym">Source</span></label>
            <div class="input-with-unit">
              <select id="scAbnType">
                <option value="steam_reboiler" ${ah.heatSourceType === 'steam_reboiler' ? 'selected' : ''}>Steam / Hot-Oil Reboiler TCV Fail-Open</option>
                <option value="fired_heater" ${ah.heatSourceType === 'fired_heater' ? 'selected' : ''}>Fired Heater Fuel Gas Valve Fail-Open</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Normal Operating Heat Duty</span><span class="field-sym">Q_norm</span></label>
            <div class="input-with-unit">
              <input type="number" id="scAbnNormKw" step="50" min="10" value="${ah.normalDutyKw}" />
              <span class="unit-addon">kW</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Max Fail-Open Surge Factor</span><span class="field-sym">F_surge</span></label>
            <div class="input-with-unit">
              <input type="number" id="scAbnSurge" step="0.05" min="1.0" max="4.0" value="${ah.abnormalSurgeFactor}" />
              <span class="unit-addon">× Q_norm</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Credited Condenser Duty</span><span class="field-sym">Q_cond</span></label>
            <div class="input-with-unit">
              <input type="number" id="scAbnCondCredit" step="50" min="0" value="${ah.condenserCreditKw || 0}" />
              <span class="unit-addon">kW</span>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label"><span>Latent Heat at Relieving P₁ (λ)</span><span class="field-sym">λ</span></label>
            <div class="input-with-unit">
              <input type="number" id="scAbnLatent" step="5" min="20" value="${ah.latentHeatKjKg}" />
              <span class="unit-addon">kJ/kg</span>
            </div>
          </div>
        </div>
      `;
    }

    container.insertAdjacentHTML('afterbegin', '<p style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.6rem;">Scenario inputs are entered in SI units; results follow the selected unit system.</p>');

    // Bind input listeners inside scenario form
    container.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', () => {
        readScenarioFormToState();
        recomputeAll();
      });
    });
  }

  function readScenarioFormToState() {
    const sc = state.tag.scenarios;
    const key = state.activeScenarioKey;
    if (key === 'fire_liquid') {
      sc.fireLiquid.orientation = document.getElementById('scFireOrientation').value;
      sc.fireLiquid.headType = document.getElementById('scFireHeadType').value;
      sc.fireLiquid.diameterM = num('scFireDiam', 2.0);
      sc.fireLiquid.lengthM = num('scFireLen', 6.0);
      sc.fireLiquid.nllM = num('scFireNll', 1.2);
      sc.fireLiquid.elevAboveGradeM = num('scFireElev', 1.5);
      sc.fireLiquid.drainageAdequate = document.getElementById('scFireDrainage').value === 'true';
      sc.fireLiquid.envFactorF = num('scFireFactorF', 1.0);
      sc.fireLiquid.latentHeatKjKg = num('scFireLatent', 300);
    } else if (key === 'fire_gas') {
      sc.fireGas.exposedAreaM2 = num('scGasArea', 40);
      sc.fireGas.normalGasTempC = num('scGasTemp', 60);
      sc.fireGas.maxWallTempC = num('scGasWallTemp', 593);
    } else if (key === 'blocked_outlet') {
      sc.blockedOutlet.sourceType = document.getElementById('scBlockedType').value;
      sc.blockedOutlet.maxInflowKgHr = num('scBlockedInflow', 10000);
      sc.blockedOutlet.creditedOutflowKgHr = num('scBlockedCredit', 0);
    } else if (key === 'cv_failure') {
      sc.cvFailure.fluidPhase = document.getElementById('scCvPhase').value;
      sc.cvFailure.ratedCv = num('scCvRated', 50);
      sc.cvFailure.bypassCv = num('scCvBypass', 0);
      sc.cvFailure.upstreamPressBarg = num('scCvUpPress', 35);
      sc.cvFailure.normalFlowCreditKgHr = num('scCvCredit', 0);
    } else if (key === 'thermal_expansion') {
      sc.thermalExpansion.heatInputKw = num('scThHeatKw', 250);
      sc.thermalExpansion.alphaVPerC = num('scThAlpha', 0.0008);
      sc.thermalExpansion.cpLiqKjKgK = num('scThCp', 2.4);
    } else if (key === 'tube_rupture') {
      sc.tubeRupture.hpFluidPhase = document.getElementById('scTrPhase').value;
      sc.tubeRupture.tubeIdMm = num('scTrTubeId', 15.7);
      sc.tubeRupture.hpPressureBarg = num('scTrHpPress', 50);
    } else if (key === 'abnormal_heat') {
      if (!sc.abnormalHeat) sc.abnormalHeat = {};
      sc.abnormalHeat.heatSourceType = document.getElementById('scAbnType').value;
      sc.abnormalHeat.normalDutyKw = num('scAbnNormKw', 950);
      sc.abnormalHeat.abnormalSurgeFactor = num('scAbnSurge', 1.5);
      sc.abnormalHeat.condenserCreditKw = num('scAbnCondCredit', 0);
      sc.abnormalHeat.latentHeatKjKg = num('scAbnLatent', 320);
    }
  }

  function renderScenarioOutputs(scenariosBundle) {
    const { evaluated, governing, map } = scenariosBundle;
    const activeObj = map[state.activeScenarioKey] || evaluated[0];

    // 1. Render Active Scenario Equation Breakdown & Bespoke Engineering Schematic
    const traceEl = document.getElementById('scenarioTraceContainer');
    const svgEl = document.getElementById('scenarioSvgContainer');

    if (activeObj.scenarioKey === 'fire_liquid') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Effective Wetted Surface Area (A_ws ≤ 7.62 m above grade)</div>
          <div class="eq-symbolic">${activeObj.geometryFormulaNote}</div>
          <div class="eq-substitution">Total Area = ${activeObj.totalAreaM2.toFixed(1)} m² | Effective Wetted Height h_eff = ${activeObj.hEffM.toFixed(2)} m</div>
          <div class="eq-result">A_ws = ${activeObj.wettedAreaM2.toFixed(2)} m² (${activeObj.wettedAreaFt2.toFixed(1)} ft²)</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. API 521 Pool Fire Heat Absorption (Q) &amp; Relief Load (W)</div>
          <div class="eq-symbolic">Q (W) = ${activeObj.cFireSI.toLocaleString()} × F × A_ws^0.82   |   W = Q / λ</div>
          <div class="eq-substitution">Q = ${activeObj.cFireSI.toLocaleString()} × ${activeObj.envFactorF.toFixed(2)} × (${activeObj.wettedAreaM2.toFixed(2)})^0.82 = ${activeObj.heatDutyKw.toFixed(1)} kW (${activeObj.heatDutyMmbtuHr.toFixed(2)} MMBTU/hr)</div>
          <div class="eq-result">W_fire = (${activeObj.heatDutyKw.toFixed(1)} × 3600) / ${activeObj.latentHeatKjKg.toFixed(1)} = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'cv_failure') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Control Valve Full Fail-Open Capacity (IEC 60534-2-1)</div>
          <div class="eq-symbolic">${activeObj.equationNote}</div>
          <div class="eq-substitution">Total Cv = ${activeObj.totalCv.toFixed(1)} | P_up = ${activeObj.P_upBara.toFixed(2)} bara → P₁ = ${activeObj.P_1Bara.toFixed(2)} bara</div>
          <div class="eq-result">W_cv,max = ${fmtFlow(activeObj.maxCvFlowKgHr)}</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Net Required Relief Load After Normal Outlet Flow Credit</div>
          <div class="eq-symbolic">W_net = W_cv,max - W_normal_credit</div>
          <div class="eq-substitution">W_net = ${activeObj.maxCvFlowKgHr.toFixed(0)} - ${activeObj.normalFlowCreditKgHr.toFixed(0)} kg/h</div>
          <div class="eq-result">W_relief = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'tube_rupture') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Double-Ended Guillotine Tube Break Area (2 × A_tube)</div>
          <div class="eq-symbolic">A_break = 2 × (π / 4) × d_tube²</div>
          <div class="eq-substitution">d_tube = ${activeObj.tubeIdMm.toFixed(1)} mm → Single Tube = ${activeObj.singleTubeAreaMm2.toFixed(1)} mm²</div>
          <div class="eq-result">A_break = ${activeObj.totalBreakAreaMm2.toFixed(1)} mm² (Cd = ${activeObj.Cd})</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. HP-to-LP Orifice Discharge Relief Load (API 521 §4.4.14)</div>
          <div class="eq-symbolic">W = 3600 × Cd × A_break × √[ 2 × ρ × (P_HP - P_LP) ]</div>
          <div class="eq-substitution">P_HP = ${activeObj.P_hpBara.toFixed(2)} bara → P_LP,rel = ${activeObj.P_lpBara.toFixed(2)} bara</div>
          <div class="eq-result">W_tube = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'fire_gas') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Gas Temperature at Relieving Pressure</div>
          <div class="eq-symbolic">T₁ = T_n × P₁ / P_n</div>
          <div class="eq-substitution">P₁ = ${activeObj.P1Psia.toFixed(1)} psia (21% OP), P_n = ${(activeObj.PnBara * 14.5038).toFixed(1)} psia</div>
          <div class="eq-result">T₁ = ${activeObj.T1R.toFixed(1)} °R (${activeObj.T1C.toFixed(1)} °C), T_w = ${activeObj.TwR.toFixed(1)} °R</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Unwetted Vessel Relief Load (API 521 §4.4.13.2.7)</div>
          <div class="eq-symbolic">W (lb/h) = 0.2772 × √(M × P₁) × A' × (T_w − T₁)^1.25 / T₁^1.1506</div>
          <div class="eq-substitution">A' = ${activeObj.exposedAreaFt2.toFixed(1)} ft² (${activeObj.exposedAreaM2.toFixed(1)} m²)</div>
          <div class="eq-result">W = ${fmtFlow(activeObj.reliefRateKgHr)}${activeObj.wallTempWarning ? ' — ⚠ ' + activeObj.wallTempWarning : ''}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'blocked_outlet') {
      const b = state.tag.scenarios.blockedOutlet;
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Blocked Outlet Source Inflow Balance (API 521 §4.4.2)</div>
          <div class="eq-symbolic">W_relief = W_in,max − W_credit   (OP = ${activeObj.allowedOverpressurePct.toFixed(0)}%, P₁ = ${fmtPressA(activeObj.P1_bara)})</div>
          <div class="eq-substitution">W_in,max = ${fmtFlow(b.maxInflowKgHr)} − W_credit = ${fmtFlow(b.creditedOutflowKgHr)}</div>
          <div class="eq-result">W_blocked = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Estimated API 520 Orifice Area for Blocked Outlet</div>
          <div class="eq-symbolic">A_req evaluated at OP = ${activeObj.allowedOverpressurePct.toFixed(0)}%</div>
          <div class="eq-result">A_req = ${activeObj.reqAreaMm2.toFixed(1)} mm² (${activeObj.reqAreaIn2.toFixed(3)} in²) → Orifice ${activeObj.orifice.letter}</div>
        </div>
      `;
    } else if (activeObj.scenarioKey === 'abnormal_heat') {
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Abnormal Reboiler / Heater Fail-Open Duty (API 521 §4.4.5)</div>
          <div class="eq-symbolic">Q_net = max(0, Q_normal × F_surge − Q_cond,credit)</div>
          <div class="eq-substitution">Q_abn = ${activeObj.normalDutyKw.toFixed(0)} kW × ${activeObj.abnormalSurgeFactor.toFixed(2)} − ${activeObj.condenserCreditKw.toFixed(0)} kW = ${activeObj.netHeatDutyKw.toFixed(1)} kW (${activeObj.netHeatDutyMmbtuHr.toFixed(2)} MMBTU/hr)</div>
          <div class="eq-result">Q_net = ${activeObj.netHeatDutyKw.toFixed(1)} kW</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Vapor Boilup Relief Rate &amp; Orifice Area (OP = 10%)</div>
          <div class="eq-symbolic">W_boilup = (3600 × Q_net) / λ</div>
          <div class="eq-substitution">W = (3600 × ${activeObj.netHeatDutyKw.toFixed(1)}) / ${activeObj.latentHeatKjKg.toFixed(1)} = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
          <div class="eq-result">A_req = ${activeObj.reqAreaMm2.toFixed(1)} mm² (${activeObj.reqAreaIn2.toFixed(3)} in²) → Orifice ${activeObj.orifice.letter}</div>
        </div>
      `;
    } else {
      const th = state.tag.scenarios.thermalExpansion;
      traceEl.innerHTML = `
        <div class="eq-step-card">
          <div class="eq-step-header">1. Blocked-In Liquid Thermal Expansion (API 521 §4.4.12)</div>
          <div class="eq-symbolic">W = (3600 × α_v × Q) / Cp</div>
          <div class="eq-substitution">α_v = ${th.alphaVPerC} 1/°C · Q = ${th.heatInputKw} kW · Cp = ${th.cpLiqKjKgK} kJ/(kg·K)</div>
          <div class="eq-result">W_thermal = ${fmtFlow(activeObj.reliefRateKgHr)}</div>
        </div>
        <div class="eq-step-card">
          <div class="eq-step-header">2. Estimated API 520 Orifice Area for Thermal Expansion</div>
          <div class="eq-symbolic">A_req evaluated at OP = ${activeObj.allowedOverpressurePct.toFixed(0)}% (Liquid Service)</div>
          <div class="eq-result">A_req = ${activeObj.reqAreaMm2.toFixed(1)} mm² (${activeObj.reqAreaIn2.toFixed(3)} in²) → Orifice ${activeObj.orifice.letter}</div>
        </div>
      `;
    }

    svgEl.innerHTML = renderBespokeScenarioSvg(activeObj);
    renderScenarioComparisonChart(evaluated, governing);
    renderPidScenarioIdentifier();

    // 2. Render Multi-Scenario Comparison Table
    const tbody = document.getElementById('scenarioSummaryTbody');
    tbody.innerHTML = evaluated.map(ev => {
      const isGov = ev.scenarioKey === governing.scenarioKey;
      return `
        <tr class="${isGov ? 'row-governing' : ''}">
          <td>
            <div style="font-weight:700;">${ev.scenarioName}</div>
            ${isGov ? '<span class="status-badge status-pass" style="margin-top:2px;">★ GOVERNING SCENARIO</span>' : ''}
          </td>
          <td class="mono">${ev.allowedOverpressurePct.toFixed(0)}%</td>
          <td class="mono">${fmtPressA(ev.P1_bara)}</td>
          <td class="mono" style="font-weight:700;">${fmtFlow(ev.reliefRateKgHr)}</td>
          <td class="mono">${ev.reqAreaMm2.toFixed(1)} mm² (${ev.reqAreaIn2.toFixed(3)} in²)</td>
          <td class="mono" style="font-weight:700;color:var(--accent-primary);">Orifice ${ev.orifice.letter} (${ev.orifice.inletOutFlange})</td>
          <td>
            <button type="button" class="btn btn-secondary btn-apply-scen-row" data-skey="${ev.scenarioKey}" style="padding:0.25rem 0.55rem;font-size:0.74rem;">
              Send to Step 2 →
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-apply-scen-row').forEach(btn => {
      btn.addEventListener('click', () => {
        applyScenarioToStep2(map[btn.dataset.skey]);
      });
    });
  }

  function renderScenarioComparisonChart(evaluated, governing) {
    const container = document.getElementById('scenarioComparisonChartContainer');
    if (!container) return;
    const maxArea = Math.max(10, ...evaluated.map(e => e.reqAreaMm2));

    const rowsSvg = evaluated.map((ev, idx) => {
      const y = 20 + idx * 24;
      const isGov = ev.scenarioKey === governing.scenarioKey;
      const isActive = ev.scenarioKey === state.activeScenarioKey;
      const barW = Math.max(6, (ev.reqAreaMm2 / maxArea) * 290);
      const fill = isGov ? '#0284c7' : (isActive ? '#059669' : '#94a3b8');
      const shortName = ev.scenarioName.replace(/^1[A-G]\.\s*/, '').slice(0, 26);
      const areaLabel = isUSC()
        ? `${ev.reqAreaIn2.toFixed(3)} in² (Orif ${ev.orifice.letter})`
        : `${ev.reqAreaMm2.toFixed(1)} mm² (Orif ${ev.orifice.letter})`;

      return `
        <g style="cursor:pointer;" data-chart-scen="${ev.scenarioKey}">
          <text x="172" y="${y + 12}" text-anchor="end" font-size="9.2" font-weight="${isGov || isActive ? '800' : '600'}" fill="${isGov ? '#0284c7' : '#334155'}" font-family="JetBrains Mono">${isGov ? '★ ' : ''}${escapeHtml(shortName)}</text>
          <rect x="180" y="${y + 1}" width="300" height="15" rx="3" fill="rgba(148,163,184,0.15)" />
          <rect x="180" y="${y + 1}" width="${barW.toFixed(1)}" height="15" rx="3" fill="${fill}" />
          <text x="${Math.min(486, 186 + barW).toFixed(1)}" y="${y + 12}" font-size="9.2" font-weight="700" fill="#0f172a" font-family="JetBrains Mono">${areaLabel} · ${fmtFlow(ev.reliefRateKgHr)}</text>
        </g>
      `;
    }).join('');

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
        <span style="font-size:0.75rem;font-weight:700;color:var(--text-secondary);">Visual Comparison: Required Relief Area (A_req) &amp; Selected Orifice Across All 7 API 521 Scenarios</span>
        <span class="mono" style="font-size:0.72rem;color:var(--accent-primary);font-weight:700;">Governing: ${escapeHtml(governing.scenarioName)} → Orifice ${governing.orifice.letter}</span>
      </div>
      <svg viewBox="0 0 680 196" width="100%" height="196" role="img" aria-label="Multi-Scenario Orifice Area Comparison Bar Chart">
        <line x1="180" y1="16" x2="180" y2="190" stroke="#64748b" stroke-width="1.5" />
        ${rowsSvg}
      </svg>
    `;

    container.querySelectorAll('[data-chart-scen]').forEach(g => {
      g.addEventListener('click', () => {
        state.activeScenarioKey = g.getAttribute('data-chart-scen');
        document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.scenario === state.activeScenarioKey);
        });
        renderScenarioForm();
        recomputeAll();
      });
    });
  }

  function renderBespokeScenarioSvg(activeObj) {
    const key = activeObj.scenarioKey;
    if (key === 'fire_liquid') {
      const f = state.tag.scenarios.fireLiquid;
      const fillPct = Math.min(100, Math.max(12, (activeObj.hEffM / Math.max(0.5, f.diameterM)) * 100));
      const liqY = 136 - (96 * fillPct) / 100;
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Vessel Wetted Area Fire Diagram">
          <defs>
            <clipPath id="vesselClip">
              <rect x="65" y="42" width="230" height="94" rx="45" />
            </clipPath>
          </defs>
          <!-- Grade Line -->
          <line x1="15" y1="182" x2="365" y2="182" stroke="#475569" stroke-width="2" />
          <text x="20" y="198" fill="#64748b" font-size="9.5" font-family="JetBrains Mono">POOL FIRE GRADE (0.0m) · Z_bot=${f.elevAboveGradeM}m · Q=${activeObj.heatDutyKw.toFixed(0)} kW</text>
          <!-- 7.62m Flame Ceiling Line -->
          <line x1="20" y1="20" x2="360" y2="20" stroke="#d97706" stroke-width="1.5" stroke-dasharray="5,4" />
          <text x="22" y="13" fill="#d97706" font-size="9.5" font-weight="700" font-family="JetBrains Mono">API 521 7.62m (25 ft) WETTED ENVELOPE</text>
          <!-- Top Relief Vapour Line to PSV -->
          <path d="M180,42 L180,24 L318,24" fill="none" stroke="#0284c7" stroke-width="3" class="svg-flow-anim" />
          <polygon points="315,19 327,24 315,29" fill="#0284c7" />
          <text x="329" y="28" fill="#0284c7" font-size="9.5" font-weight="800" font-family="JetBrains Mono">PSV</text>
          <!-- Vessel Saddle Legs -->
          <line x1="105" y1="136" x2="105" y2="182" stroke="#334155" stroke-width="4" />
          <line x1="255" y1="136" x2="255" y2="182" stroke="#334155" stroke-width="4" />
          <!-- Liquid Wetted Zone + Boiling Vapour Bubbles -->
          <g clip-path="url(#vesselClip)">
            <rect x="65" y="${liqY.toFixed(1)}" width="230" height="${((96 * fillPct) / 100).toFixed(1)}" fill="rgba(2, 132, 199, 0.28)" />
            <line x1="65" y1="${liqY.toFixed(1)}" x2="295" y2="${liqY.toFixed(1)}" stroke="#0284c7" stroke-width="2" stroke-dasharray="4,2" />
            <circle cx="120" cy="${Math.min(128, liqY + 18).toFixed(1)}" r="3.5" fill="#0284c7" opacity="0.6" />
            <circle cx="155" cy="${Math.min(125, liqY + 12).toFixed(1)}" r="4.5" fill="#0284c7" opacity="0.5" />
            <circle cx="205" cy="${Math.min(128, liqY + 20).toFixed(1)}" r="3.5" fill="#0284c7" opacity="0.6" />
            <circle cx="240" cy="${Math.min(124, liqY + 10).toFixed(1)}" r="4" fill="#0284c7" opacity="0.5" />
          </g>
          <!-- Vessel Shell Outline -->
          <rect x="65" y="42" width="230" height="94" rx="45" fill="none" stroke="#0f172a" stroke-width="2.5" />
          <text x="180" y="72" text-anchor="middle" fill="#0f172a" font-size="10.5" font-weight="800" font-family="JetBrains Mono">D=${f.diameterM}m × L=${f.lengthM}m (${f.orientation})</text>
          <text x="180" y="92" text-anchor="middle" fill="#0369a1" font-size="10.5" font-weight="800" font-family="JetBrains Mono">A_ws = ${activeObj.wettedAreaM2.toFixed(1)} m² (${activeObj.wettedAreaFt2.toFixed(0)} ft²)</text>
          <text x="180" y="122" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="700" font-family="JetBrains Mono">W = ${fmtFlow(activeObj.reliefRateKgHr)}</text>
          <!-- Animated Pool Fire Flames -->
          <g class="svg-flame">
            <path d="M95,182 Q106,148 118,182 Q132,142 146,182 Q162,146 178,182 Q194,140 210,182 Q226,146 242,182 Q256,150 268,182" fill="rgba(220,38,38,0.18)" stroke="#dc2626" stroke-width="2.5" />
            <path d="M115,182 Q125,158 135,182 Q150,154 165,182 Q180,156 195,182 Q210,154 225,182 Q238,158 250,182" fill="none" stroke="#f59e0b" stroke-width="2" />
          </g>
        </svg>
      `;
    }

    if (key === 'fire_gas') {
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Unwetted Gas Vessel Fire Schematic">
          <!-- Vertical Gas Contactor / Vessel -->
          <rect x="125" y="28" width="110" height="135" rx="38" fill="rgba(245,158,11,0.12)" stroke="#d97706" stroke-width="2.5" />
          <text x="180" y="64" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="800" font-family="JetBrains Mono">UNWETTED GAS VESSEL</text>
          <text x="180" y="84" text-anchor="middle" fill="#d97706" font-size="10.5" font-weight="800" font-family="JetBrains Mono">A' = ${activeObj.exposedAreaM2.toFixed(1)} m²</text>
          <text x="180" y="104" text-anchor="middle" fill="#334155" font-size="9.5" font-family="JetBrains Mono">Wall T_w = ${activeObj.TwR ? ((activeObj.TwR - 491.67) / 1.8).toFixed(0) : 593} °C</text>
          <text x="180" y="122" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="700" font-family="JetBrains Mono">Gas T₁ = ${activeObj.T1C.toFixed(0)} °C</text>
          <text x="180" y="142" text-anchor="middle" fill="#dc2626" font-size="10" font-weight="800" font-family="JetBrains Mono">${fmtFlow(activeObj.reliefRateKgHr)}</text>
          <!-- Relief Line out Top -->
          <path d="M180,28 L180,14 L315,14" fill="none" stroke="#dc2626" stroke-width="3" class="svg-flow-anim" />
          <polygon points="312,9 324,14 312,19" fill="#dc2626" />
          <text x="345" y="18" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">TO PSV</text>
          <!-- External Radiant Fire Waves on Both Sides -->
          <path d="M72,165 Q85,135 98,165 Q105,140 115,165" fill="none" stroke="#dc2626" stroke-width="2.2" class="svg-flame" />
          <path d="M245,165 Q255,140 265,165 Q278,135 290,165" fill="none" stroke="#dc2626" stroke-width="2.2" class="svg-flame" />
          <path d="M115,180 Q135,152 155,180 Q180,148 205,180 Q225,152 245,180" fill="rgba(220,38,38,0.16)" stroke="#dc2626" stroke-width="2.5" class="svg-flame" />
          <text x="190" y="198" text-anchor="middle" fill="#64748b" font-size="9.5" font-family="JetBrains Mono">API 521 §4.4.13.2.7 VAPOR EXPANSION IN FIRE (21% OP)</text>
        </svg>
      `;
    }

    if (key === 'blocked_outlet') {
      const b = state.tag.scenarios.blockedOutlet;
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Blocked Outlet Overpressure Schematic">
          <!-- Upstream Feed Line -->
          <line x1="18" y1="105" x2="112" y2="105" stroke="#0284c7" stroke-width="6" />
          <line x1="18" y1="105" x2="112" y2="105" stroke="#e0f2fe" stroke-width="2.5" class="svg-flow-anim" />
          <text x="64" y="88" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="800" font-family="JetBrains Mono">INFLOW W_max</text>
          <text x="64" y="125" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="700" font-family="JetBrains Mono">${fmtFlow(b.maxInflowKgHr)}</text>
          <!-- Protected Vessel -->
          <rect x="112" y="42" width="105" height="122" rx="22" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.5" />
          <text x="164" y="82" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="800" font-family="JetBrains Mono">PROTECTED</text>
          <text x="164" y="98" text-anchor="middle" fill="#0369a1" font-size="10" font-weight="800" font-family="JetBrains Mono">P₁=${fmtPressA(activeObj.P1_bara)}</text>
          <text x="164" y="118" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="700" font-family="JetBrains Mono">OP = 10%</text>
          <!-- Top Relief Path to PSV -->
          <path d="M164,42 L164,18 L295,18" fill="none" stroke="#059669" stroke-width="3.5" class="svg-flow-anim" />
          <polygon points="292,13 304,18 292,23" fill="#059669" />
          <text x="336" y="22" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="800" font-family="JetBrains Mono">PSV LIFT</text>
          <!-- Blocked Downstream Outlet Pipe + Closed XV Valve -->
          <line x1="217" y1="105" x2="355" y2="105" stroke="#94a3b8" stroke-width="6" />
          <polygon points="268,90 290,105 268,120" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="312,90 290,105 312,120" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <!-- Red X Block Symbol -->
          <line x1="276" y1="62" x2="304" y2="84" stroke="#dc2626" stroke-width="3" />
          <line x1="304" y1="62" x2="276" y2="84" stroke="#dc2626" stroke-width="3" />
          <text x="290" y="138" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">BLOCKED OUTLET</text>
          <text x="190" y="192" text-anchor="middle" fill="#0f172a" font-size="10.5" font-weight="800" font-family="JetBrains Mono">Net Relief W = ${fmtFlow(activeObj.reliefRateKgHr)} → Orifice ${activeObj.orifice.letter}</text>
        </svg>
      `;
    }

    if (key === 'cv_failure') {
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Control Valve Fail-Open Schematic">
          <!-- Upstream HP Header -->
          <rect x="14" y="65" width="76" height="80" rx="8" fill="rgba(220,38,38,0.12)" stroke="#dc2626" stroke-width="2" />
          <text x="52" y="95" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">HP HEADER</text>
          <text x="52" y="114" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">${activeObj.P_upBara.toFixed(1)} bara</text>
          <!-- Pipe through Fail-Open Control Valve -->
          <line x1="90" y1="105" x2="245" y2="105" stroke="#dc2626" stroke-width="6" />
          <line x1="90" y1="105" x2="245" y2="105" stroke="#fef2f2" stroke-width="2.2" class="svg-flow-anim" />
          <!-- Control Valve + Diaphragm Dome -->
          <polygon points="145,90 168,105 145,120" fill="#d97706" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="191,90 168,105 191,120" fill="#d97706" stroke="#0f172a" stroke-width="1.8" />
          <line x1="168" y1="105" x2="168" y2="66" stroke="#0f172a" stroke-width="2.5" />
          <path d="M148,66 A20,14 0 0,1 188,66 Z" fill="#d97706" stroke="#0f172a" stroke-width="1.8" />
          <text x="168" y="42" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">100% FAIL-OPEN</text>
          <text x="168" y="138" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">Cv_tot = ${activeObj.totalCv.toFixed(1)}</text>
          <!-- Bypass Loop Line -->
          <path d="M115,105 L115,156 L220,156 L220,105" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="4,3" />
          <text x="168" y="170" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">Bypass Loop Credited</text>
          <!-- LP Receiver + PSV -->
          <rect x="245" y="52" width="115" height="106" rx="16" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.2" />
          <text x="302" y="85" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">LP RECEIVER</text>
          <text x="302" y="104" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="700" font-family="JetBrains Mono">P₁=${activeObj.P_1Bara.toFixed(1)} bara</text>
          <text x="302" y="124" text-anchor="middle" fill="#059669" font-size="10" font-weight="800" font-family="JetBrains Mono">${fmtFlow(activeObj.reliefRateKgHr)}</text>
          <text x="190" y="196" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="700" font-family="JetBrains Mono">IEC 60534 Fail-Open → Orifice ${activeObj.orifice.letter}</text>
        </svg>
      `;
    }

    if (key === 'thermal_expansion') {
      const th = state.tag.scenarios.thermalExpansion;
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Thermal Expansion Schematic">
          <!-- Blocked-In Pipe / Exchanger Section -->
          <line x1="30" y1="108" x2="350" y2="108" stroke="#0284c7" stroke-width="18" />
          <line x1="30" y1="108" x2="350" y2="108" stroke="#38bdf8" stroke-width="8" />
          <!-- Left & Right Closed Isolation Valves -->
          <polygon points="55,92 75,108 55,124" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="95,92 75,108 95,124" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="285,92 305,108 285,124" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <polygon points="325,92 305,108 325,124" fill="#dc2626" stroke="#0f172a" stroke-width="1.8" />
          <text x="75" y="84" text-anchor="middle" fill="#dc2626" font-size="9" font-weight="800" font-family="JetBrains Mono">BLOCKED</text>
          <text x="305" y="84" text-anchor="middle" fill="#dc2626" font-size="9" font-weight="800" font-family="JetBrains Mono">BLOCKED</text>
          <!-- Solar / Process Heat Input Arrows -->
          <path d="M135,165 L135,130 M165,165 L165,130 M195,165 L195,130 M225,165 L225,130" stroke="#d97706" stroke-width="2.5" />
          <text x="180" y="182" text-anchor="middle" fill="#d97706" font-size="10" font-weight="800" font-family="JetBrains Mono">↑ HEAT INPUT Q = ${th.heatInputKw} kW (α_v = ${th.alphaVPerC}/°C) ↑</text>
          <!-- Top Thermal Relief Valve (TSV) -->
          <path d="M190,98 L190,34 L275,34" fill="none" stroke="#059669" stroke-width="3.5" class="svg-flow-anim" />
          <text x="190" y="22" text-anchor="middle" fill="#059669" font-size="10" font-weight="800" font-family="JetBrains Mono">TSV / PSV RELIEF: ${fmtFlow(activeObj.reliefRateKgHr)} (Orifice ${activeObj.orifice.letter})</text>
        </svg>
      `;
    }

    if (key === 'abnormal_heat') {
      return `
        <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Abnormal Reboiler Heat Input Schematic">
          <!-- Distillation / Fractionator Column -->
          <rect x="65" y="24" width="95" height="148" rx="22" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.5" />
          <text x="112" y="56" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">COLUMN / VESSEL</text>
          <text x="112" y="76" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="700" font-family="JetBrains Mono">P₁ = ${fmtPressA(activeObj.P1_bara)}</text>
          <text x="112" y="96" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">↑ BOILUP SURGE</text>
          <!-- Reboiler Exchanger & Steam TCV Fail-Open -->
          <circle cx="255" cy="128" r="30" fill="rgba(217,119,6,0.16)" stroke="#d97706" stroke-width="2.2" />
          <text x="255" y="124" text-anchor="middle" fill="#0f172a" font-size="8.5" font-weight="800" font-family="JetBrains Mono">REBOILER</text>
          <text x="255" y="138" text-anchor="middle" fill="#dc2626" font-size="8.5" font-weight="800" font-family="JetBrains Mono">${activeObj.netHeatDutyKw.toFixed(0)} kW</text>
          <!-- Thermosyphon Loop -->
          <path d="M160,148 L225,148 M225,108 L160,108" fill="none" stroke="#dc2626" stroke-width="3" class="svg-flow-anim" />
          <!-- Overhead Relief to PSV -->
          <path d="M112,24 L112,12 L310,12" fill="none" stroke="#059669" stroke-width="3.5" class="svg-flow-anim" />
          <text x="235" y="28" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="800" font-family="JetBrains Mono">PSV OVERHEAD: ${fmtFlow(activeObj.reliefRateKgHr)}</text>
          <text x="190" y="192" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="800" font-family="JetBrains Mono">API 521 §4.4.5 Q_abn = ${activeObj.normalDutyKw}×${activeObj.abnormalSurgeFactor} kW → Orifice ${activeObj.orifice.letter}</text>
        </svg>
      `;
    }

    // 1F: Heat Exchanger Tube Rupture (2 x A_tube)
    return `
      <svg viewBox="0 0 380 210" width="100%" height="210" role="img" aria-label="Heat Exchanger Tube Rupture Schematic">
        <!-- Exchanger Shell Outline -->
        <rect x="45" y="48" width="270" height="106" rx="28" fill="rgba(2,132,199,0.10)" stroke="#0f172a" stroke-width="2.5" />
        <!-- Tube Sheet Divider -->
        <line x1="102" y1="48" x2="102" y2="154" stroke="#0f172a" stroke-width="3.5" />
        <!-- HP U-Tubes inside Shell -->
        <path d="M102,74 L265,74 A18,18 0 0,1 265,110 L102,110" fill="none" stroke="#dc2626" stroke-width="4" />
        <path d="M102,126 L250,126" fill="none" stroke="#dc2626" stroke-width="4" />
        <!-- Guillotine Rupture Jet at X=195 -->
        <circle cx="195" cy="74" r="9" fill="rgba(220,38,38,0.28)" class="svg-pulse-dot" />
        <circle cx="195" cy="74" r="5" fill="#dc2626" />
        <text x="195" y="62" text-anchor="middle" fill="#dc2626" font-size="9.5" font-weight="800" font-family="JetBrains Mono">⚡ 2×A_tube = ${activeObj.totalBreakAreaMm2.toFixed(0)} mm²</text>
        <text x="74" y="96" text-anchor="middle" fill="#dc2626" font-size="9" font-weight="800" font-family="JetBrains Mono">HP TUBE</text>
        <text x="74" y="112" text-anchor="middle" fill="#dc2626" font-size="9" font-weight="700" font-family="JetBrains Mono">${activeObj.P_hpBara.toFixed(1)}b</text>
        <text x="205" y="144" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="800" font-family="JetBrains Mono">LP SHELL P₁ = ${activeObj.P_lpBara.toFixed(1)} bara</text>
        <!-- LP Shell Relief to PSV -->
        <path d="M265,48 L265,20 L345,20" fill="none" stroke="#0284c7" stroke-width="3.5" class="svg-flow-anim" />
        <text x="190" y="190" text-anchor="middle" fill="#0f172a" font-size="10" font-weight="800" font-family="JetBrains Mono">Tube Rupture W = ${fmtFlow(activeObj.reliefRateKgHr)} → Orifice ${activeObj.orifice.letter}</text>
      </svg>
    `;
  }

  function applyScenarioToStep2(scenObj) {
    if (!scenObj) return;
    state.tag.governingScenarioKey = scenObj.scenarioKey;
    state.tag.flowRateKgHr = Math.max(1, Math.round(scenObj.reliefRateKgHr));
    state.tag.overpressurePct = scenObj.allowedOverpressurePct;
    if (scenObj.phaseForScen) {
      state.tag.fluidPhase = scenObj.phaseForScen;
    }
    syncTagToDomInputs();
    recomputeAll();
    switchTab('tab-sizing');
  }

  // =========================================================================
  // 4. STEP 2: API 520 PART I ORIFICE SIZING & VISUALIZERS
  // =========================================================================

  function renderSizingOutputs(sizing) {
    // Top Ribbon
    document.getElementById('ribbonReqArea').textContent = isUSC()
      ? `${sizing.reqAreaIn2.toFixed(3)} in²`
      : `${sizing.reqAreaMm2.toFixed(1)} mm²`;
    document.getElementById('ribbonOrificeLetter').textContent = `${sizing.selectedOrifice.letter} (${sizing.selectedOrifice.inletOutFlange})`;

    // Warnings Banner
    const warnEl = document.getElementById('sizingWarningsBanner');
    if (sizing.warnings.length > 0) {
      warnEl.style.display = 'block';
      warnEl.innerHTML = sizing.warnings.map(w => `<div>⚠ ${w}</div>`).join('');
    } else {
      warnEl.style.display = 'none';
    }

    // Hero Card
    document.getElementById('flowRegimeBadge').textContent = sizing.flowRegime;
    document.getElementById('resOrificeLetter').textContent = sizing.selectedOrifice.letter;
    document.getElementById('resOrificeFlange').textContent = `Flange: ${sizing.selectedOrifice.inletOutFlange}`;
    document.getElementById('resOrificeUtilization').textContent = `Utilization: ${sizing.selectedOrifice.utilizationPct.toFixed(1)}% (Margin: ${sizing.selectedOrifice.marginPct.toFixed(1)}%)`;

    document.getElementById('resReqAreaPrimary').textContent = isUSC()
      ? `${sizing.reqAreaIn2.toFixed(4)} in²`
      : `${sizing.reqAreaMm2.toFixed(1)} mm²`;
    document.getElementById('resReqAreaSecondary').textContent = isUSC()
      ? `${sizing.reqAreaMm2.toFixed(1)} mm²`
      : `${sizing.reqAreaIn2.toFixed(4)} in²`;

    document.getElementById('resSelAreaPrimary').textContent = isUSC()
      ? `${sizing.selectedOrifice.areaIn2.toFixed(3)} in²`
      : `${sizing.selectedOrifice.areaMm2.toFixed(1)} mm²`;
    document.getElementById('resSelAreaSecondary').textContent = `API 526 Orifice ${sizing.selectedOrifice.letter} (d=${sizing.selectedOrifice.dOrificeMm} mm)`;

    document.getElementById('resP1Primary').textContent = fmtPressA(sizing.P1_bara);
    document.getElementById('resP1Secondary').textContent = sizing.Pcf_bara > 0
      ? `P_cf = ${fmtPressA(sizing.Pcf_bara)} (OP ${sizing.overpressurePct}%)`
      : `Overpressure = ${sizing.overpressurePct}%`;

    document.getElementById('resP2Primary').textContent = fmtPressG(sizing.P_backBarg);
    document.getElementById('resP2Secondary').textContent = `${sizing.backpressurePctOfSet.toFixed(1)}% of P_set (P₂/P₁ = ${sizing.absBackpressureRatio.toFixed(3)})`;

    document.getElementById('resFactorsMain').textContent = `Kd=${sizing.Kd.toFixed(3)} · Kb=${sizing.Kb.toFixed(3)}`;
    document.getElementById('resFactorsSub').textContent = sizing.fluidPhase === 'liquid'
      ? `Kc=${sizing.Kc.toFixed(2)} · Kv=${sizing.Kv.toFixed(4)}`
      : (sizing.fluidPhase === 'steam'
        ? `Kn=${sizing.Kn.toFixed(3)} · Ksh=${sizing.Ksh.toFixed(3)}`
        : `Kc=${sizing.Kc.toFixed(2)} · C_SI=${sizing.C_SI.toFixed(4)}`);

    document.getElementById('resRatedCapPrimary').textContent = fmtFlow(sizing.ratedCapacityKgHr);
    document.getElementById('resRatedCapSecondary').textContent = isUSC()
      ? `${Math.round(sizing.ratedCapacityKgHr).toLocaleString()} kg/h (Rated)`
      : `${Math.round(sizing.ratedCapacityLbHr).toLocaleString()} lb/hr (Rated)`;

    // Equation Trace Method Badge
    const methodMap = {
      gas: 'API 520 Pt I §5.6 Gas / Vapor Sizing',
      liquid: 'API 520 Pt I §5.8 Liquid + Viscosity Kv',
      steam: 'API 520 Pt I §5.7 Steam Napier Equation',
      twophase: 'API 520 Pt I Annex C Leung Omega (ω)'
    };
    document.getElementById('eqTraceMethodBadge').textContent = methodMap[sizing.fluidPhase] || 'API 520 Part I';

    // Whitebox Equation Cards
    const stepsContainer = document.getElementById('sizingEquationSteps');
    stepsContainer.innerHTML = sizing.steps.map(s => `
      <div class="eq-step-card">
        <div class="eq-step-header">${s.title}</div>
        <div class="eq-symbolic">${s.formula}</div>
        <div class="eq-substitution">${s.substitution}</div>
        <div class="eq-result">⇒ ${s.result}</div>
      </div>
    `).join('') + `
      <div class="eq-step-card" style="border-left-color:var(--pass-dot);">
        <div class="eq-step-header">Final API 526 Standard Orifice Selection</div>
        <div class="eq-symbolic">Select smallest standard API 526 orifice with A_sel ≥ A_req (${sizing.reqAreaMm2.toFixed(1)} mm² / ${sizing.reqAreaIn2.toFixed(4)} in²)</div>
        <div class="eq-substitution">Selected Orifice "${sizing.selectedOrifice.letter}" → A_sel = ${sizing.selectedOrifice.areaMm2.toFixed(1)} mm² (${sizing.selectedOrifice.areaIn2.toFixed(3)} in²), Flange = ${sizing.selectedOrifice.inletOutFlange}</div>
        <div class="eq-result">⇒ Orifice ${sizing.selectedOrifice.letter} Selected (${sizing.selectedOrifice.utilizationPct.toFixed(1)}% Utilization, W_rated = ${fmtFlow(sizing.ratedCapacityKgHr)})</div>
      </div>
    `;

    renderRadialUtilizationGauge(sizing);
    renderOrificeScaleSvg(sizing);
    renderPressureLadderSvg(sizing);
    renderValveCutawaySvg(sizing);
    renderKbCurveSvg(sizing);
  }

  function renderRadialUtilizationGauge(sizing) {
    const container = document.getElementById('orificeRadialGaugeContainer');
    if (!container) return;
    const pct = Math.min(100, Math.max(2, sizing.selectedOrifice.utilizationPct));
    const r = 24;
    const circ = 2 * Math.PI * r;
    const dashOffset = circ * (1 - pct / 100);
    const strokeColor = pct > 92 ? '#f59e0b' : (pct > 80 ? '#38bdf8' : '#10b981');

    container.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Orifice Utilization Gauge">
        <circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5.5" />
        <circle cx="32" cy="32" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="5.5"
          stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"
          stroke-linecap="round" transform="rotate(-90 32 32)" />
        <text x="32" y="34" text-anchor="middle" font-size="11" font-weight="800" fill="#ffffff" font-family="JetBrains Mono">${pct.toFixed(0)}%</text>
        <text x="32" y="44" text-anchor="middle" font-size="6.8" font-weight="600" fill="#94a3b8" font-family="JetBrains Mono">LOAD</text>
      </svg>
    `;
  }

  function renderValveCutawaySvg(sizing) {
    const container = document.getElementById('valveCutawaySvgContainer');
    if (!container) return;
    const vtype = state.tag.valveType;
    const hasDisc = Boolean(state.tag.ruptureDiscUpstream);
    const badge = document.getElementById('valveCutawayBadge');
    if (badge) {
      const labelMap = {
        conventional: 'Conventional Spring-Loaded',
        bellows: 'Balanced Bellows',
        pilot: 'Pilot-Operated (Piston Dome)'
      };
      badge.textContent = (labelMap[vtype] || 'PSV') + (hasDisc ? ' + Rupture Disc' : '');
    }

    // Internal mechanism elements based on valveType
    let upperInternals = '';
    if (vtype === 'conventional') {
      upperInternals = `
        <!-- Conventional Spring Coils & Bonnet Vented to Body -->
        <rect x="132" y="22" width="66" height="68" rx="6" fill="rgba(148,163,184,0.14)" stroke="#0f172a" stroke-width="2" />
        <line x1="165" y1="12" x2="165" y2="108" stroke="#0f172a" stroke-width="3" />
        <path d="M146,34 L184,41 L146,48 L184,55 L146,62 L184,69 L146,76" fill="none" stroke="#0284c7" stroke-width="2.8" />
        <text x="275" y="42" text-anchor="middle" fill="#0f172a" font-size="9.5" font-weight="800" font-family="JetBrains Mono">CONVENTIONAL BONNET</text>
        <text x="275" y="56" text-anchor="middle" fill="#d97706" font-size="9" font-weight="700" font-family="JetBrains Mono">P_bt acts on Disc Back</text>
        <text x="275" y="70" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">Limit: P_bt ≤ ${sizing.overpressurePct}% of P_set</text>
      `;
    } else if (vtype === 'bellows') {
      upperInternals = `
        <!-- Balanced Bellows + Vented Bonnet -->
        <rect x="132" y="20" width="66" height="72" rx="6" fill="rgba(2,132,199,0.10)" stroke="#0f172a" stroke-width="2" />
        <!-- Atmospheric Bonnet Vent Hole (Left Side) -->
        <line x1="108" y1="48" x2="132" y2="48" stroke="#059669" stroke-width="2.5" />
        <text x="64" y="51" text-anchor="middle" fill="#059669" font-size="8.5" font-weight="800" font-family="JetBrains Mono">BONNET VENT</text>
        <line x1="165" y1="12" x2="165" y2="108" stroke="#0f172a" stroke-width="3" />
        <path d="M148,30 L182,36 L148,42 L182,48 L148,54" fill="none" stroke="#334155" stroke-width="2.2" />
        <!-- Bellows Convolutions Shielding Disc Area -->
        <path d="M144,74 L138,80 L146,85 L138,91 L146,96 L142,104 M186,74 L192,80 L184,85 L192,91 L184,96 L188,104" fill="none" stroke="#059669" stroke-width="2.4" />
        <text x="286" y="34" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="800" font-family="JetBrains Mono">BALANCED BELLOWS</text>
        <text x="286" y="48" text-anchor="middle" fill="#0369a1" font-size="9" font-weight="700" font-family="JetBrains Mono">Isolates Disc from P_bt</text>
        <text x="286" y="62" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">Kb/Kw = ${sizing.Kb.toFixed(3)} (${sizing.backpressurePctOfSet.toFixed(1)}% BP)</text>
      `;
    } else {
      upperInternals = `
        <!-- Pilot-Operated Dome + External Sense Line -->
        <rect x="130" y="26" width="70" height="60" rx="8" fill="rgba(5,150,105,0.14)" stroke="#0f172a" stroke-width="2" />
        <!-- Pilot Control Valve Assembly on Top -->
        <rect x="215" y="18" width="62" height="32" rx="4" fill="#0f172a" />
        <text x="246" y="37" text-anchor="middle" fill="#38bdf8" font-size="9" font-weight="800" font-family="JetBrains Mono">PILOT</text>
        <!-- Sense Tube from Inlet Nozzle to Pilot & Dome -->
        <path d="M138,155 L92,155 L92,34 L215,34 M200,42 L215,42" fill="none" stroke="#0284c7" stroke-width="2" stroke-dasharray="3,2" />
        <rect x="142" y="52" width="46" height="14" rx="2" fill="#059669" />
        <text x="286" y="66" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="800" font-family="JetBrains Mono">PILOT PISTON DOME</text>
        <text x="286" y="80" text-anchor="middle" fill="#64748b" font-size="8.5" font-family="JetBrains Mono">Kb = 1.00 up to 70% BP</text>
      `;
    }

    container.innerHTML = `
      <svg viewBox="0 0 380 205" width="100%" height="205" role="img" aria-label="PSV Mechanical Cutaway Diagram">
        <!-- Valve Body Bowl & Outlet Nozzle -->
        <path d="M122,92 L208,92 L208,104 L288,104 L288,144 L208,144 L208,162 L122,162 Z" fill="rgba(148,163,184,0.16)" stroke="#0f172a" stroke-width="2.2" />
        ${upperInternals}
        <!-- Disc Holder & Lifting Disc -->
        <rect x="140" y="102" width="50" height="12" rx="3" fill="#0284c7" stroke="#0f172a" stroke-width="1.8" />
        <!-- Inlet Nozzle Throat (Orifice d = ${sizing.selectedOrifice.dOrificeMm} mm) -->
        <path d="M136,192 L136,124 L150,118 L180,118 L194,124 L194,192" fill="rgba(2,132,199,0.18)" stroke="#0f172a" stroke-width="2.4" />
        ${hasDisc ? `
          <!-- Upstream Rupture Disc Combination (Kc = 0.90) -->
          <path d="M136,174 Q165,162 194,174" fill="none" stroke="#dc2626" stroke-width="2.8" stroke-dasharray="4,2" />
          <text x="72" y="176" text-anchor="middle" fill="#dc2626" font-size="8.5" font-weight="800" font-family="JetBrains Mono">RUPTURE DISC</text>
          <text x="72" y="187" text-anchor="middle" fill="#dc2626" font-size="8.5" font-weight="700" font-family="JetBrains Mono">(Kc = 0.90)</text>
        ` : ''}
        <!-- Animated Choked Flow Stream through Nozzle & Out Side Branch -->
        <path d="M165,196 L165,122 Q165,112 182,116 L282,124" fill="none" stroke="#0284c7" stroke-width="3.5" class="svg-flow-anim" />
        <polygon points="278,119 290,124 278,129" fill="#0284c7" />
        <!-- Callout Annotations -->
        <text x="64" y="132" text-anchor="middle" fill="#0369a1" font-size="9.5" font-weight="800" font-family="JetBrains Mono">ORIFICE "${sizing.selectedOrifice.letter}"</text>
        <text x="64" y="146" text-anchor="middle" fill="#334155" font-size="8.5" font-family="JetBrains Mono">d = ${sizing.selectedOrifice.dOrificeMm} mm</text>
        <text x="292" y="162" text-anchor="middle" fill="#0f172a" font-size="9" font-weight="700" font-family="JetBrains Mono">OUTLET P₂ = ${fmtPressG(sizing.P_backBarg)}</text>
        <text x="292" y="176" text-anchor="middle" fill="#059669" font-size="9" font-weight="800" font-family="JetBrains Mono">${sizing.selectedOrifice.inletOutFlange}</text>
      </svg>
    `;
  }

  function renderKbCurveSvg(sizing) {
    const container = document.getElementById('kbCurveSvgContainer');
    if (!container) return;

    const xOf = (bpPct) => 42 + (Math.min(60, Math.max(0, bpPct)) / 60) * 310;
    const yOf = (kVal) => 165 - ((Math.min(1.05, Math.max(0.5, kVal)) - 0.5) / 0.55) * 135;

    // Sample points from 0% to 55% backpressure for Bellows Vapor (Kb) and Bellows Liquid (Kw)
    const samplePcts = [0, 10, 15, 20, 25, 30, 32, 35, 38, 40, 45, 50];
    const kbVaporPts = samplePcts.map((pct, i) => {
      const kb = E.computeBackpressureFactor('bellows', pct / 100, sizing.overpressurePct, 'gas');
      return `${i === 0 ? 'M' : 'L'}${xOf(pct).toFixed(1)},${yOf(kb).toFixed(1)}`;
    }).join(' ');

    const kwLiqPts = samplePcts.map((pct, i) => {
      const kw = E.computeBackpressureFactor('bellows', pct / 100, sizing.overpressurePct, 'liquid');
      return `${i === 0 ? 'M' : 'L'}${xOf(pct).toFixed(1)},${yOf(kw).toFixed(1)}`;
    }).join(' ');

    const curBpPct = Math.min(58, Math.max(0, sizing.backpressurePctOfSet));
    const curK = Math.min(1.0, Math.max(0.52, sizing.Kb));
    const cx = xOf(curBpPct);
    const cy = yOf(curK);

    container.innerHTML = `
      <svg viewBox="0 0 380 205" width="100%" height="205" role="img" aria-label="API 520 Backpressure Correction Curve">
        <!-- Axes & Grid -->
        <line x1="42" y1="22" x2="42" y2="165" stroke="#64748b" stroke-width="1.5" />
        <line x1="42" y1="165" x2="356" y2="165" stroke="#64748b" stroke-width="1.5" />
        <line x1="42" y1="${yOf(1.0).toFixed(1)}" x2="356" y2="${yOf(1.0).toFixed(1)}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3,3" />
        <text x="36" y="${(yOf(1.0) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">1.0</text>
        <text x="36" y="${(yOf(0.8) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">0.8</text>
        <text x="36" y="${(yOf(0.6) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">0.6</text>

        <!-- X-axis Ticks (0%, 15%, 30%, 50% of P_set) -->
        <text x="${xOf(0).toFixed(1)}" y="178" text-anchor="middle" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">0%</text>
        <text x="${xOf(15).toFixed(1)}" y="178" text-anchor="middle" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">15%</text>
        <text x="${xOf(30).toFixed(1)}" y="178" text-anchor="middle" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">30%</text>
        <text x="${xOf(50).toFixed(1)}" y="178" text-anchor="middle" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">50% P_set</text>

        <!-- Pilot Operated Flat Line (Kb = 1.0) -->
        <line x1="${xOf(0).toFixed(1)}" y1="${yOf(1.0).toFixed(1)}" x2="${xOf(55).toFixed(1)}" y2="${yOf(1.0).toFixed(1)}" stroke="#059669" stroke-width="2" stroke-dasharray="5,3" />
        <!-- Bellows Gas Kb Curve -->
        <path d="${kbVaporPts}" fill="none" stroke="#0284c7" stroke-width="2.6" />
        <!-- Bellows Liquid Kw Curve -->
        <path d="${kwLiqPts}" fill="none" stroke="#d97706" stroke-width="2.2" />

        <!-- Live Operating Point Marker -->
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="rgba(220,38,38,0.25)" class="svg-pulse-dot" />
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" />
        <rect x="${Math.min(220, Math.max(46, cx - 65)).toFixed(1)}" y="${Math.max(18, cy - 26).toFixed(1)}" width="138" height="16" rx="3" fill="#ffffff" stroke="#fca5a5" />
        <text x="${Math.min(289, Math.max(115, cx + 4)).toFixed(1)}" y="${Math.max(29, cy - 15).toFixed(1)}" text-anchor="middle" font-size="8.8" font-weight="800" fill="#dc2626" font-family="JetBrains Mono">BP=${sizing.backpressurePctOfSet.toFixed(1)}% → K=${sizing.Kb.toFixed(3)}</text>

        <text x="200" y="196" text-anchor="middle" font-size="8.8" font-weight="700" fill="#475569" font-family="JetBrains Mono">Blue: Vapor Kb · Amber: Liquid Kw · Green: Pilot (1.00)</text>
      </svg>
    `;
  }

  function renderOrificeScaleSvg(sizing) {
    const container = document.getElementById('orificeScaleContainer');
    const orifices = E.API_526_ORIFICES;
    const maxLog = Math.log10(orifices[orifices.length - 1].areaMm2);
    const minLog = Math.log10(45);

    const barsHtml = orifices.map((o, idx) => {
      const x = 28 + idx * 24;
      const normH = ((Math.log10(o.areaMm2) - minLog) / (maxLog - minLog)) * 135;
      const y = 165 - normH;
      const isSelected = o.letter === sizing.selectedOrifice.letter;
      const fill = isSelected ? '#0284c7' : (o.areaMm2 < sizing.reqAreaMm2 ? '#cbd5e1' : '#94a3b8');
      return `
        <g>
          <rect x="${x}" y="${y.toFixed(1)}" width="16" height="${normH.toFixed(1)}" rx="2" fill="${fill}" />
          <text x="${x + 8}" y="182" text-anchor="middle" font-size="10" font-weight="${isSelected ? '800' : '600'}" fill="${isSelected ? '#0284c7' : '#475569'}" font-family="JetBrains Mono">${o.letter}</text>
          ${isSelected ? `<text x="${x + 8}" y="${Math.max(14, y - 6).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0284c7" font-family="JetBrains Mono">★</text>` : ''}
        </g>
      `;
    }).join('');

    const reqClamp = Math.max(50, Math.min(orifices[orifices.length - 1].areaMm2, sizing.reqAreaMm2));
    const reqY = 165 - ((Math.log10(reqClamp) - minLog) / (maxLog - minLog)) * 135;

    container.innerHTML = `
      <svg viewBox="0 0 380 195" width="100%" height="195" role="img" aria-label="API 526 Orifice Scale D to T">
        <line x1="20" y1="165" x2="368" y2="165" stroke="#64748b" stroke-width="1.5" />
        ${barsHtml}
        <line x1="20" y1="${reqY.toFixed(1)}" x2="368" y2="${reqY.toFixed(1)}" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="4,3" />
        <rect x="24" y="${Math.max(4, reqY - 16).toFixed(1)}" width="148" height="15" rx="2" fill="#fef2f2" stroke="#fca5a5" />
        <text x="30" y="${Math.max(15, reqY - 5).toFixed(1)}" font-size="9.5" font-weight="700" fill="#991b1b" font-family="JetBrains Mono">A_req = ${sizing.reqAreaMm2.toFixed(0)} mm² (${sizing.reqAreaIn2.toFixed(2)} in²)</text>
      </svg>
    `;
  }

  function renderPressureLadderSvg(sizing) {
    const container = document.getElementById('pressureLadderContainer');
    const P_max = Math.max(1, sizing.P1_bara * 1.12);
    const yScale = (pBara) => 170 - Math.min(145, Math.max(10, (pBara / P_max) * 145));

    const yP1 = yScale(sizing.P1_bara);
    const yPset = yScale(sizing.P_setBarg + state.tag.atmPressureBara);
    const yPop = yScale(state.tag.operatingPressureBarg + state.tag.atmPressureBara);
    const yPcf = sizing.Pcf_bara > 0 ? yScale(sizing.Pcf_bara) : null;
    const yP2 = yScale(sizing.P2_bara);

    container.innerHTML = `
      <svg viewBox="0 0 380 195" width="100%" height="195" role="img" aria-label="Pressure Relationship Ladder">
        <!-- Left Column: Upstream Vessel Pressures -->
        <line x1="40" y1="${yP1}" x2="175" y2="${yP1}" stroke="#dc2626" stroke-width="2.5" />
        <text x="42" y="${yP1 - 5}" font-size="10" font-weight="700" fill="#dc2626" font-family="JetBrains Mono">P₁ Relieving: ${fmtPressA(sizing.P1_bara)}</text>

        <line x1="40" y1="${yPset}" x2="175" y2="${yPset}" stroke="#d97706" stroke-width="2" />
        <text x="42" y="${yPset - 5}" font-size="10" font-weight="700" fill="#d97706" font-family="JetBrains Mono">P_set / MAWP: ${fmtPressG(sizing.P_setBarg)}</text>

        <line x1="40" y1="${yPop}" x2="175" y2="${yPop}" stroke="#0284c7" stroke-width="2" />
        <text x="42" y="${yPop + 13}" font-size="10" font-weight="600" fill="#0284c7" font-family="JetBrains Mono">P_op Normal: ${fmtPressG(state.tag.operatingPressureBarg)}</text>

        <!-- Right Column: Nozzle Choking & Backpressure -->
        ${yPcf !== null ? `
          <line x1="205" y1="${yPcf}" x2="355" y2="${yPcf}" stroke="#059669" stroke-width="2" stroke-dasharray="4,3" />
          <text x="207" y="${yPcf - 5}" font-size="10" font-weight="700" fill="#059669" font-family="JetBrains Mono">P_cf Choke: ${fmtPressA(sizing.Pcf_bara)}</text>
        ` : ''}

        <line x1="205" y1="${yP2}" x2="355" y2="${yP2}" stroke="#475569" stroke-width="2.5" />
        <text x="207" y="${yP2 + 14}" font-size="10" font-weight="700" fill="#334155" font-family="JetBrains Mono">P₂ Backpress: ${fmtPressA(sizing.P2_bara)}</text>

        <!-- Center Divider -->
        <line x1="190" y1="20" x2="190" y2="175" stroke="#cbd5e1" stroke-width="1.5" />
        <text x="105" y="188" text-anchor="middle" font-size="9.5" font-weight="700" fill="#64748b" font-family="JetBrains Mono">UPSTREAM VESSEL</text>
        <text x="280" y="188" text-anchor="middle" font-size="9.5" font-weight="700" fill="#64748b" font-family="JetBrains Mono">NOZZLE / TAILPIPE</text>
      </svg>
    `;
  }

  // =========================================================================
  // 5. STEP 3: API 520 PART II INLET & OUTLET LINE HYDRAULICS
  // =========================================================================

  function renderHydraulicsOutputs(sizing, hyd) {
    const inPass = hyd.inlet.passes3Pct;
    const outPass = hyd.outlet.passesBackpressure && hyd.outlet.passesMach;

    // Update Top Ribbon Badges
    const ribIn = document.getElementById('ribbonInletBadge');
    ribIn.className = `status-badge ${inPass ? 'status-pass' : 'status-fail'}`;
    ribIn.textContent = `${hyd.inlet.lossPctOfSet.toFixed(2)}% ${inPass ? '≤ 3% PASS' : '> 3% FAIL'}`;

    const ribOut = document.getElementById('ribbonOutletBadge');
    ribOut.className = `status-badge ${outPass ? 'status-pass' : 'status-fail'}`;
    ribOut.textContent = `${hyd.outlet.totalBackPctOfSet.toFixed(1)}% ${outPass ? 'PASS' : 'CHECK'}`;

    // Header Badges on Step 3 Panels
    const inHeaderBadge = document.getElementById('inletStatusHeaderBadge');
    inHeaderBadge.className = `status-badge ${inPass ? 'status-pass' : 'status-fail'}`;
    inHeaderBadge.textContent = `ΔP_in = ${hyd.inlet.lossPctOfSet.toFixed(2)}% ${inPass ? '≤ 3.0% PASS' : '> 3.0% CHATTER RISK'}`;

    const outHeaderBadge = document.getElementById('outletStatusHeaderBadge');
    outHeaderBadge.className = `status-badge ${outPass ? 'status-pass' : 'status-fail'}`;
    outHeaderBadge.textContent = `P_bt = ${hyd.outlet.totalBackPctOfSet.toFixed(1)}% (Limit ${hyd.outlet.maxAllowedBackPct}%) · Ma=${hyd.outlet.machNumber.toFixed(2)}`;

    // Sync Built-Up Backpressure display
    document.getElementById('syncBuiltUpVal').textContent = fmtPressG(hyd.outlet.builtUpBackBarg);

    // Inlet Metrics Grid
    document.getElementById('inletMetricsGrid').innerHTML = `
      <div class="metric-box">
        <span class="metric-box-label">Inlet Pressure Loss (ΔP_in)</span>
        <span class="metric-box-main" style="color:${inPass ? 'var(--pass-text)' : 'var(--fail-text)'};">${hyd.inlet.lossPctOfSet.toFixed(2)}% of P_set</span>
        <span class="metric-box-sub">${fmtDP(hyd.inlet.dP_totalBar)} (Limit: ≤ 3.0%)</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Pipe ID &amp; Velocity</span>
        <span class="metric-box-main">${hyd.inlet.velocityMS.toFixed(1)} m/s</span>
        <span class="metric-box-sub">ID = ${hyd.inlet.idMm.toFixed(1)} mm (${hyd.inlet.velocityFtS.toFixed(1)} ft/s)</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Friction &amp; Total K</span>
        <span class="metric-box-main">K_tot = ${hyd.inlet.K_total.toFixed(2)}</span>
        <span class="metric-box-sub">f_D = ${hyd.inlet.fDarcy.toFixed(4)} · Re = ${hyd.inlet.Re.toExponential(2)}</span>
      </div>
    `;

    // Inlet Multi-NPS Comparison Table
    const npsTbody = document.getElementById('inletNpsComparisonTbody');
    npsTbody.innerHTML = hyd.inletNpsComparison.slice(0, 9).map(row => {
      const isCurrent = row.nps === hyd.inlet.nps;
      return `
        <tr class="${isCurrent ? 'row-governing' : ''}" style="cursor:pointer;" data-nps="${row.nps}">
          <td class="mono" style="font-weight:700;">${row.nps} ${isCurrent ? '(Selected)' : ''}</td>
          <td class="mono">${row.idMm.toFixed(1)}</td>
          <td class="mono">${row.velocityMS.toFixed(1)}</td>
          <td class="mono">${fmtDP(row.dPBar)}</td>
          <td class="mono" style="font-weight:700;">${row.lossPct.toFixed(2)}%</td>
          <td>
            <span class="status-badge ${row.passes ? 'status-pass' : 'status-fail'}">
              ${row.passes ? 'PASS ≤ 3%' : 'FAIL > 3%'}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    npsTbody.querySelectorAll('tr[data-nps]').forEach(tr => {
      tr.addEventListener('click', () => {
        document.getElementById('inpInletNps').value = tr.dataset.nps;
        readDomInputsToTag();
        recomputeAll();
      });
    });

    // Outlet Metrics Grid
    document.getElementById('outletMetricsGrid').innerHTML = `
      <div class="metric-box">
        <span class="metric-box-label">Built-Up Backpressure</span>
        <span class="metric-box-main">${fmtPressG(hyd.outlet.builtUpBackBarg, 2)}</span>
        <span class="metric-box-sub">Superimposed: ${fmtPressG(hyd.outlet.superimposedBackBarg, 2)}</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Total Backpressure (P_bt)</span>
        <span class="metric-box-main" style="color:${hyd.outlet.passesBackpressure ? 'var(--pass-text)' : 'var(--fail-text)'};">${hyd.outlet.totalBackPctOfSet.toFixed(1)}% of P_set</span>
        <span class="metric-box-sub">${fmtPressG(hyd.outlet.totalBackBarg, 2)} (Allowable ≤ ${hyd.outlet.maxAllowedBackPct}%)</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Exit Mach &amp; Velocity</span>
        <span class="metric-box-main" style="color:${hyd.outlet.passesMach ? 'var(--pass-text)' : 'var(--warn-text)'};">${sizing.fluidPhase === 'gas' || sizing.fluidPhase === 'steam' ? 'Ma = ' + hyd.outlet.machNumber.toFixed(2) : 'N/A (non-vapor)'}</span>
        <span class="metric-box-sub">v_exit = ${hyd.outlet.exitVelocityMS.toFixed(1)} m/s at header (Target Ma ≤ 0.70)</span>
      </div>
      <div class="metric-box">
        <span class="metric-box-label">Reaction Force (open discharge)</span>
        <span class="metric-box-main">${hyd.outlet.reactionForceKn.toFixed(2)} kN</span>
        <span class="metric-box-sub">${Math.round(hyd.outlet.reactionForceLbf).toLocaleString()} lbf · P_exit = ${fmtPressA(hyd.outlet.exitPressureBara)}</span>
      </div>
      ${hyd.outlet.compressibleWarning ? `<div class="metric-box" style="grid-column:1/-1;background:var(--warn-bg);border-color:var(--warn-border);color:var(--warn-text);font-size:0.78rem;font-weight:600;">⚠ ${hyd.outlet.compressibleWarning}</div>` : ''}
    `;

    // Hydraulic Equation Trace
    document.getElementById('hydraulicEquationSteps').innerHTML = `
      <div class="eq-step-card">
        <div class="eq-step-header">1. Darcy-Weisbach Inlet Line Loss (API 520 Part II)</div>
        <div class="eq-symbolic">ΔP_in = [ f × (L_in / D_in) + ΣK_in ] × (ρ_in × v_in² / 2) ≤ 0.03 × P_set</div>
        <div class="eq-substitution">W_eval = ${fmtFlow(hyd.W_evalKgHr)} (${hyd.flowBasis.toUpperCase()}) | ρ_in = ${hyd.rhoInletKgM3.toFixed(2)} kg/m³ | K_tot = ${hyd.inlet.K_total.toFixed(2)}</div>
        <div class="eq-result">⇒ ΔP_in = ${fmtDP(hyd.inlet.dP_totalBar)} (${hyd.inlet.lossPctOfSet.toFixed(2)}% of P_set) — ${inPass ? 'COMPLIANT (≤ 3%)' : 'EXCEEDS 3% LIMIT (Select ' + hyd.inlet.recommendedNps + ')'}</div>
      </div>
      <div class="eq-step-card">
        <div class="eq-step-header">2. Tailpipe Built-Up Backpressure</div>
        <div class="eq-symbolic">P_bt = P_superimposed + ΔP_out   (vapor density iterated at mean tailpipe pressure)</div>
        <div class="eq-substitution">P_bt = ${hyd.outlet.superimposedBackBarg.toFixed(2)} + ${hyd.outlet.builtUpBackBarg.toFixed(2)} = ${hyd.outlet.totalBackBarg.toFixed(2)} barg (${hyd.outlet.totalBackPctOfSet.toFixed(1)}% of P_set) · ρ_out,avg = ${hyd.rhoOutletKgM3.toFixed(2)} kg/m³</div>
        <div class="eq-result">⇒ ${hyd.outlet.passesBackpressure ? 'Within' : 'EXCEEDS'} ${hyd.outlet.maxAllowedBackPct}% limit for selected valve type</div>
      </div>
      <div class="eq-step-card">
        <div class="eq-step-header">3. Reaction Force — Open Discharge to Atmosphere (API 520 Part II)</div>
        <div class="eq-symbolic">F = W·v_exit + A_exit·(P_exit − P_atm)   (vapor: sonic exit, T* = 2T₁/(k+1))</div>
        <div class="eq-substitution">Applies to vent stacks / open tailpipes. Closed discharge to a flare header has no steady-state thrust at the tailpipe outlet.</div>
        <div class="eq-result">⇒ F_r = ${hyd.outlet.reactionForceKn.toFixed(2)} kN (${Math.round(hyd.outlet.reactionForceLbf).toLocaleString()} lbf)</div>
      </div>
    `;

    renderPipingSchematicSvg(sizing, hyd);
    renderHydraulicPressureProfileSvg(sizing, hyd);
  }

  function renderPipingSchematicSvg(sizing, hyd) {
    const inPass = hyd.inlet.passes3Pct;
    const outPass = hyd.outlet.passesBackpressure;
    const container = document.getElementById('pipingSchematicSvgContainer');

    container.innerHTML = `
      <svg viewBox="0 0 920 175" width="100%" height="175" role="img" aria-label="Inlet PSV Outlet Piping Schematic">
        <!-- Protected Vessel on Left -->
        <rect x="20" y="25" width="145" height="125" rx="18" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.5" />
        <text x="92" y="58" text-anchor="middle" font-size="11" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">${escapeHtml(String(state.tag.equipmentProtected).slice(0, 18))}</text>
        <text x="92" y="80" text-anchor="middle" font-size="10.5" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">P_set = ${fmtPressG(sizing.P_setBarg)}</text>
        <text x="92" y="100" text-anchor="middle" font-size="10" fill="#334155" font-family="JetBrains Mono">P₁ = ${fmtPressA(sizing.P1_bara)}</text>
        <text x="92" y="122" text-anchor="middle" font-size="9.5" fill="#64748b" font-family="JetBrains Mono">T₁ = ${fmtTemp(sizing.T1_C)}</text>

        <!-- Inlet Pipe Segment + Animated Flow Stream -->
        <line x1="165" y1="88" x2="395" y2="88" stroke="${inPass ? '#059669' : '#dc2626'}" stroke-width="9" />
        <line x1="165" y1="88" x2="395" y2="88" stroke="#ffffff" stroke-width="2.5" class="svg-flow-anim" opacity="0.85" />
        <rect x="185" y="24" width="190" height="48" rx="4" fill="#ffffff" stroke="${inPass ? '#6ee7b7' : '#fca5a5'}" stroke-width="1.5" />
        <text x="280" y="42" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">INLET: ${hyd.inlet.nps} ${hyd.inlet.schedule}</text>
        <text x="280" y="60" text-anchor="middle" font-size="10" font-weight="700" fill="${inPass ? '#059669' : '#dc2626'}" font-family="JetBrains Mono">ΔP_in = ${hyd.inlet.lossPctOfSet.toFixed(2)}% (≤ 3.0%)</text>
        <text x="280" y="114" text-anchor="middle" font-size="9.5" fill="#475569" font-family="JetBrains Mono">L=${hyd.inlet.lengthM}m · v=${hyd.inlet.velocityMS.toFixed(1)} m/s · ΣK=${hyd.inlet.K_fittings}</text>

        <!-- PSV Symbol in Center -->
        <polygon points="395,68 435,88 395,108" fill="#0284c7" stroke="#0f172a" stroke-width="2" />
        <polygon points="435,88 455,128 415,128" fill="#0284c7" stroke="#0f172a" stroke-width="2" />
        <line x1="435" y1="88" x2="435" y2="38" stroke="#0f172a" stroke-width="3" />
        <rect x="412" y="18" width="46" height="22" rx="3" fill="#0f172a" />
        <text x="435" y="33" text-anchor="middle" font-size="11" font-weight="800" fill="#38bdf8" font-family="JetBrains Mono">ORIF ${sizing.selectedOrifice.letter}</text>
        <text x="435" y="148" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">${escapeHtml(state.tag.tagNumber)} (${sizing.selectedOrifice.inletOutFlange})</text>

        <!-- Outlet Pipe Segment + Animated Flow Stream -->
        <line x1="455" y1="108" x2="735" y2="108" stroke="${outPass ? '#0284c7' : '#d97706'}" stroke-width="10" />
        <line x1="455" y1="108" x2="735" y2="108" stroke="#e0f2fe" stroke-width="2.8" class="svg-flow-anim" opacity="0.9" />
        <rect x="490" y="24" width="220" height="62" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <text x="600" y="42" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">OUTLET: ${hyd.outlet.nps} ${hyd.outlet.schedule}</text>
        <text x="600" y="59" text-anchor="middle" font-size="10" font-weight="700" fill="${outPass ? '#059669' : '#dc2626'}" font-family="JetBrains Mono">P_bt = ${hyd.outlet.totalBackPctOfSet.toFixed(1)}% of P_set (Ma=${hyd.outlet.machNumber.toFixed(2)})</text>
        <text x="600" y="76" text-anchor="middle" font-size="9.5" fill="#475569" font-family="JetBrains Mono">Reaction Force F_r = ${hyd.outlet.reactionForceKn.toFixed(2)} kN (${Math.round(hyd.outlet.reactionForceLbf)} lbf)</text>

        <!-- Flare / Relief Header on Right -->
        <rect x="735" y="35" width="165" height="110" rx="10" fill="rgba(15,23,42,0.06)" stroke="#334155" stroke-width="2" />
        <text x="817" y="68" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">FLARE / RELIEF HEADER</text>
        <text x="817" y="90" text-anchor="middle" font-size="10" fill="#334155" font-family="JetBrains Mono">P_super = ${fmtPressG(hyd.outlet.superimposedBackBarg)}</text>
        <text x="817" y="110" text-anchor="middle" font-size="10" fill="#0369a1" font-family="JetBrains Mono">ΔP_built = ${fmtPressG(hyd.outlet.builtUpBackBarg)}</text>
        <text x="817" y="130" text-anchor="middle" font-size="10" font-weight="700" fill="#0f172a" font-family="JetBrains Mono">P_total = ${fmtPressG(hyd.outlet.totalBackBarg)}</text>
      </svg>
    `;
  }

  function renderHydraulicPressureProfileSvg(sizing, hyd) {
    const container = document.getElementById('hydraulicPressureProfileSvgContainer');
    if (!container) return;

    const pAtm = state.tag.atmPressureBara || 1.01325;
    const pVesselBara = sizing.P1_bara;
    const pInletFlangeBara = Math.max(pAtm, pVesselBara - hyd.inlet.dP_totalBar);
    const pNozzleThroatBara = sizing.Pcf_bara > 0
      ? Math.max(sizing.Pcf_bara, pAtm + hyd.outlet.totalBackBarg)
      : (pInletFlangeBara + pAtm + hyd.outlet.totalBackBarg) * 0.5;
    const pOutletBodyBara = pAtm + hyd.outlet.totalBackBarg;
    const pHeaderBara = pAtm + hyd.outlet.superimposedBackBarg;

    const pMax = Math.max(2, pVesselBara * 1.12);
    const yOf = (pBara) => 122 - Math.min(96, Math.max(6, (pBara / pMax) * 96));

    const nodes = [
      { x: 95, p: pVesselBara, label: '1. Vessel (P₁)', val: fmtPressA(pVesselBara), color: '#0369a1' },
      { x: 280, p: pInletFlangeBara, label: `2. PSV Inlet (ΔP=${hyd.inlet.lossPctOfSet.toFixed(2)}%)`, val: fmtPressA(pInletFlangeBara), color: hyd.inlet.passes3Pct ? '#059669' : '#dc2626' },
      { x: 460, p: pNozzleThroatBara, label: '3. Orifice Throat (P_cf)', val: fmtPressA(pNozzleThroatBara), color: '#d97706' },
      { x: 645, p: pOutletBodyBara, label: `4. Tailpipe In (P_bt=${hyd.outlet.totalBackPctOfSet.toFixed(1)}%)`, val: fmtPressA(pOutletBodyBara), color: '#0284c7' },
      { x: 825, p: pHeaderBara, label: '5. Flare Header (P_bs)', val: fmtPressA(pHeaderBara), color: '#475569' }
    ];

    const polyPoints = nodes.map(n => `${n.x},${yOf(n.p).toFixed(1)}`).join(' ');
    const areaPoints = `95,122 ${polyPoints} 825,122`;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
        <span style="font-size:0.74rem;font-weight:700;color:var(--text-secondary);">Axial System Pressure Profile Along Relief Path (Vessel → Inlet Line → PSV Nozzle → Tailpipe → Header)</span>
        <span class="mono" style="font-size:0.71rem;color:var(--text-muted);">Flow Basis: ${fmtFlow(hyd.W_evalKgHr)} (${hyd.flowBasis.toUpperCase()})</span>
      </div>
      <svg viewBox="0 0 920 148" width="100%" height="148" role="img" aria-label="Axial Hydraulic Pressure Profile Chart">
        <line x1="55" y1="122" x2="865" y2="122" stroke="#64748b" stroke-width="1.5" />
        <polygon points="${areaPoints}" fill="rgba(2,132,199,0.10)" />
        <polyline points="${polyPoints}" fill="none" stroke="#0284c7" stroke-width="2.8" />
        ${nodes.map(n => {
          const y = yOf(n.p);
          return `
            <g>
              <line x1="${n.x}" y1="${y.toFixed(1)}" x2="${n.x}" y2="122" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3,3" />
              <circle cx="${n.x}" cy="${y.toFixed(1)}" r="4.5" fill="${n.color}" stroke="#ffffff" stroke-width="1.5" />
              <text x="${n.x}" y="${Math.max(14, y - 8).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="${n.color}" font-family="JetBrains Mono">${n.val}</text>
              <text x="${n.x}" y="138" text-anchor="middle" font-size="9" font-weight="700" fill="#334155" font-family="JetBrains Mono">${n.label}</text>
            </g>
          `;
        }).join('')}
      </svg>
    `;
  }

  // =========================================================================
  // 5B. STEP 4: PUMP & PROCESS LINE HYDRAULICS (API 610 / API 14E / IEC 60534)
  // =========================================================================

  function renderPumpOutputs(pumpRes) {
    const p = state.pumpLoop;
    const npshOk = pumpRes.npsh.compliant;
    const badge = document.getElementById('pumpNpshStatusBadge');
    if (badge) {
      badge.className = `status-badge ${npshOk ? 'status-pass' : 'status-fail'}`;
      badge.textContent = npshOk
        ? `NPSHa = ${fmtHead(pumpRes.npsh.npshaM, 2)} ≥ NPSHr (${fmtHead(pumpRes.npsh.npshrM, 2)}) PASS`
        : `NPSHa = ${fmtHead(pumpRes.npsh.npshaM, 2)} < NPSHr + Margin CAVITATION RISK`;
    }

    // 1. Pump Metrics Summary Grid
    const metricsGrid = document.getElementById('pumpMetricsSummaryGrid');
    if (metricsGrid) {
      metricsGrid.innerHTML = `
        <div class="metric-box">
          <span class="metric-box-label">Rated Flow &amp; Mass Rate</span>
          <span class="metric-box-main">${fmtVolFlow(pumpRes.Q_ratedM3Hr)}</span>
          <span class="metric-box-sub">Norm: ${fmtVolFlow(pumpRes.Q_normM3Hr)} · ${fmtFlow(pumpRes.W_ratedKgHr)}</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Total Differential Head (TDH)</span>
          <span class="metric-box-main" style="color:var(--accent-primary);">${fmtHead(pumpRes.pump.tdhRatedM)}</span>
          <span class="metric-box-sub">ΔP = ${fmtDP(pumpRes.pump.diffPressureRatedBar, 2)} (Shutoff: ${fmtPressG(pumpRes.pump.maxDischargeBarg)})</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">NPSHa vs. NPSHr (API 610)</span>
          <span class="metric-box-main" style="color:${npshOk ? 'var(--pass-text)' : 'var(--fail-text)'};">${fmtHead(pumpRes.npsh.npshaM, 2)}</span>
          <span class="metric-box-sub">NPSHr = ${fmtHead(pumpRes.npsh.npshrM, 2)} · Margin = ${fmtHead(pumpRes.npsh.marginM, 2)}</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Shaft Power &amp; API 610 Motor</span>
          <span class="metric-box-main">${pumpRes.pump.brakePowerKw.toFixed(1)} kW (${pumpRes.pump.brakePowerHp.toFixed(1)} hp)</span>
          <span class="metric-box-sub">Hyd: ${pumpRes.pump.hydraulicPowerKw.toFixed(1)} kW · Motor: <strong>${pumpRes.pump.selectedMotorKw} kW</strong></span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Suction Nozzle &amp; Velocity</span>
          <span class="metric-box-main" style="color:${pumpRes.suction.velCompliant ? 'var(--pass-text)' : 'var(--warn-text)'};">${pumpRes.suction.velocityMS.toFixed(2)} m/s</span>
          <span class="metric-box-sub">P_suc = ${fmtPressG(pumpRes.suction.nozzleBarg)} · ΔP/100m = ${fmtDP(pumpRes.suction.dpPer100mBar, 3)}</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Discharge Nozzle &amp; API 14E Vel</span>
          <span class="metric-box-main" style="color:${pumpRes.discharge.velCompliant ? 'var(--pass-text)' : 'var(--warn-text)'};">${pumpRes.discharge.velocityMS.toFixed(2)} m/s</span>
          <span class="metric-box-sub">P_dis = ${fmtPressG(pumpRes.discharge.nozzleBarg)} · v_e = ${pumpRes.discharge.vErosionalMS.toFixed(1)} m/s</span>
        </div>
      `;
    }

    // 2. Control Valve Envelope Table (Min / Normal / Rated)
    const cvContainer = document.getElementById('pumpCvTableContainer');
    if (cvContainer) {
      const cv = pumpRes.controlValve;
      cvContainer.innerHTML = `
        <table class="eng-table" style="font-size:0.75rem;">
          <thead>
            <tr>
              <th>Case</th>
              <th>Flow</th>
              <th>ΔP_CV</th>
              <th>Req. Cv</th>
              <th>% of Max Cv (${cv.selectedMaxCv})</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="mono"><strong>Min (${p.minFlowPct || 30}%)</strong></td>
              <td class="mono">${fmtVolFlow(cv.min.flowM3Hr)}</td>
              <td class="mono">${fmtDP(cv.min.availableCvDpBar, 2)}</td>
              <td class="mono" style="font-weight:700;">${cv.min.reqCv.toFixed(1)}</td>
              <td class="mono">${cv.min.pctOfSelectedCv.toFixed(1)}%</td>
            </tr>
            <tr class="row-governing">
              <td class="mono"><strong>Normal (100%)</strong></td>
              <td class="mono">${fmtVolFlow(cv.normal.flowM3Hr)}</td>
              <td class="mono">${fmtDP(cv.normal.availableCvDpBar, 2)}</td>
              <td class="mono" style="font-weight:800;color:var(--accent-primary);">${cv.normal.reqCv.toFixed(1)}</td>
              <td class="mono" style="font-weight:700;">${cv.normal.pctOfSelectedCv.toFixed(1)}%</td>
            </tr>
            <tr>
              <td class="mono"><strong>Rated (${100 + Number(p.ratedMarginPct)}%)</strong></td>
              <td class="mono">${fmtVolFlow(cv.rated.flowM3Hr)}</td>
              <td class="mono">${fmtDP(cv.rated.availableCvDpBar, 2)}</td>
              <td class="mono" style="font-weight:700;">${cv.rated.reqCv.toFixed(1)}</td>
              <td class="mono">
                <span class="status-badge ${cv.controllabilityPass ? 'status-pass' : 'status-warn'}">${cv.rated.pctOfSelectedCv.toFixed(1)}%</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.45rem;">
          Allocated Rated ΔP_CV = <strong>${fmtDP(cv.allocatedDpRatedBar, 2)}</strong> (${cv.pctOfDynamic.toFixed(1)}% of total dynamic drop). Target Cv opening: 20%–90%.
        </div>
      `;
    }

    // 3. Suction & Discharge Multi-NPS Line Sizing Table
    const lineTbody = document.getElementById('pumpLineSizingTbody');
    if (lineTbody) {
      lineTbody.innerHTML = pumpRes.pipeSizingComparison.slice(1, 9).map(row => {
        const isSuc = row.nps === pumpRes.suction.nps;
        const isDis = row.nps === pumpRes.discharge.nps;
        return `
          <tr class="${isSuc || isDis ? 'row-governing' : ''}">
            <td class="mono" style="font-weight:800;">
              ${row.nps}
              ${isSuc ? '<span class="status-badge status-pass" style="margin-left:3px;">SUC</span>' : ''}
              ${isDis ? '<span class="status-badge status-warn" style="margin-left:3px;">DIS</span>' : ''}
            </td>
            <td class="mono">${row.sucIdMm.toFixed(1)}</td>
            <td class="mono" style="color:${row.sucOk ? 'var(--pass-text)' : 'var(--fail-text)'};font-weight:700;">${row.sucVelMS.toFixed(2)}</td>
            <td class="mono">${fmtDP(row.sucDp100mBar, 3)}</td>
            <td class="mono" style="color:${row.disOk ? 'var(--pass-text)' : 'var(--fail-text)'};font-weight:700;">${row.disVelMS.toFixed(2)}</td>
            <td class="mono">${fmtDP(row.disDp100mBar, 3)}</td>
            <td>
              <div style="display:flex;gap:0.3rem;">
                <button type="button" class="btn btn-secondary btn-set-pump-suc" data-nps='${row.nps}' style="padding:0.18rem 0.45rem;font-size:0.7rem;">Set Suc</button>
                <button type="button" class="btn btn-secondary btn-set-pump-dis" data-nps='${row.nps}' style="padding:0.18rem 0.45rem;font-size:0.7rem;">Set Dis</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      lineTbody.querySelectorAll('.btn-set-pump-suc').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('inpPumpSucNps').value = btn.dataset.nps;
          readDomInputsToPump();
          recomputeAll();
        });
      });
      lineTbody.querySelectorAll('.btn-set-pump-dis').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('inpPumpDisNps').value = btn.dataset.nps;
          readDomInputsToPump();
          recomputeAll();
        });
      });
    }

    // 4. Whitebox Equation Steps
    const eqContainer = document.getElementById('pumpEquationSteps');
    if (eqContainer) {
      eqContainer.innerHTML = pumpRes.steps.map(s => `
        <div class="eq-step-card">
          <div class="eq-step-header">${s.title}</div>
          <div class="eq-symbolic">${s.formula}</div>
          <div class="eq-substitution">${s.substitution}</div>
          <div class="eq-result">⇒ ${s.result}</div>
        </div>
      `).join('');
    }

    renderPumpSchematicSvg(pumpRes);
    renderPumpCurveSvg(pumpRes);
    renderPumpWaterfallSvg(pumpRes);
  }

  function renderPumpSchematicSvg(pumpRes) {
    const container = document.getElementById('pumpSchematicSvgContainer');
    if (!container) return;
    const p = state.pumpLoop;
    const npshOk = pumpRes.npsh.compliant;

    container.innerHTML = `
      <svg viewBox="0 0 920 182" width="100%" height="182" role="img" aria-label="Centrifugal Pump Hydraulic Loop Schematic">
        <!-- Suction Vessel -->
        <rect x="18" y="22" width="145" height="134" rx="14" fill="rgba(2,132,199,0.12)" stroke="#0369a1" stroke-width="2.5" />
        <rect x="20" y="92" width="141" height="62" rx="11" fill="rgba(2,132,199,0.16)" />
        <text x="90" y="46" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">SUCTION VESSEL</text>
        <text x="90" y="66" text-anchor="middle" font-size="10" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">P_s = ${fmtPressG(p.suctionVesselBarg)}</text>
        <text x="90" y="84" text-anchor="middle" font-size="9.5" fill="#334155" font-family="JetBrains Mono">Z_s = +${fmtHead(p.suctionStaticHeadM)}</text>
        <text x="90" y="112" text-anchor="middle" font-size="9.5" fill="#0f172a" font-family="JetBrains Mono">P_vap = ${fmtPressA(pumpRes.vaporPressBara)}</text>
        <text x="90" y="132" text-anchor="middle" font-size="9.5" font-weight="800" fill="${npshOk ? '#059669' : '#dc2626'}" font-family="JetBrains Mono">NPSHa = ${fmtHead(pumpRes.npsh.npshaM, 2)}</text>

        <!-- Suction Pipe + Animated Flow Stream -->
        <line x1="163" y1="115" x2="345" y2="115" stroke="${pumpRes.suction.velCompliant ? '#059669' : '#d97706'}" stroke-width="9" />
        <line x1="166" y1="115" x2="342" y2="115" stroke="#a7f3d0" stroke-width="3" class="svg-flow-anim-slow" />
        <rect x="175" y="32" width="158" height="54" rx="5" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <text x="254" y="50" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">SUC: ${pumpRes.suction.nps} Sch 40</text>
        <text x="254" y="66" text-anchor="middle" font-size="9.5" font-weight="700" fill="#059669" font-family="JetBrains Mono">v = ${pumpRes.suction.velocityMS.toFixed(2)} m/s</text>
        <text x="254" y="80" text-anchor="middle" font-size="9" fill="#475569" font-family="JetBrains Mono">P_suc,noz = ${fmtPressG(pumpRes.suction.nozzleBarg)}</text>

        <!-- Centrifugal Pump Symbol (API 610) -->
        <polygon points="362,147 398,147 408,163 352,163" fill="#0f172a" />
        <line x1="380" y1="82" x2="435" y2="82" stroke="#0284c7" stroke-width="10" />
        <circle cx="380" cy="115" r="32" fill="#0284c7" stroke="#0f172a" stroke-width="2.5" />
        <circle cx="380" cy="115" r="22" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="4,3" />
        <text x="380" y="112" text-anchor="middle" font-size="10" font-weight="800" fill="#ffffff" font-family="JetBrains Mono">${escapeHtml(p.pumpTag)}</text>
        <text x="380" y="126" text-anchor="middle" font-size="8.5" font-weight="700" fill="#e0f2fe" font-family="JetBrains Mono">${pumpRes.pump.selectedMotorKw} kW</text>
        <rect x="330" y="12" width="132" height="48" rx="5" fill="#0f172a" />
        <text x="396" y="31" text-anchor="middle" font-size="10" font-weight="800" fill="#38bdf8" font-family="JetBrains Mono">TDH = ${fmtHead(pumpRes.pump.tdhRatedM)}</text>
        <text x="396" y="48" text-anchor="middle" font-size="9.5" font-weight="700" fill="#f8fafc" font-family="JetBrains Mono">P_shutoff = ${fmtPressG(pumpRes.pump.maxDischargeBarg)}</text>

        <!-- Discharge Pipe + Animated Flow Stream -->
        <line x1="412" y1="82" x2="735" y2="82" stroke="#0284c7" stroke-width="8" />
        <line x1="416" y1="82" x2="730" y2="82" stroke="#bae6fd" stroke-width="2.8" class="svg-flow-anim" />

        <!-- Control Valve Bowtie + Diaphragm Actuator -->
        <polygon points="555,68 580,82 555,96" fill="#059669" stroke="#0f172a" stroke-width="1.8" />
        <polygon points="605,68 580,82 605,96" fill="#059669" stroke="#0f172a" stroke-width="1.8" />
        <line x1="580" y1="82" x2="580" y2="50" stroke="#0f172a" stroke-width="2.5" />
        <path d="M564,50 A16,12 0 0,1 596,50 Z" fill="#059669" stroke="#0f172a" stroke-width="1.8" />
        <text x="580" y="34" text-anchor="middle" font-size="8.5" font-weight="800" fill="#059669" font-family="JetBrains Mono">FCV (${pumpRes.controlValve.rated.pctOfSelectedCv.toFixed(0)}% Open)</text>

        <rect x="478" y="104" width="220" height="56" rx="5" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
        <text x="588" y="121" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">DIS: ${pumpRes.discharge.nps} · v=${pumpRes.discharge.velocityMS.toFixed(2)} m/s</text>
        <text x="588" y="137" text-anchor="middle" font-size="9.5" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">CV ΔP = ${fmtDP(pumpRes.controlValve.allocatedDpRatedBar, 2)} (${pumpRes.controlValve.pctOfDynamic.toFixed(0)}% Dyn)</text>
        <text x="588" y="151" text-anchor="middle" font-size="9" fill="#475569" font-family="JetBrains Mono">Cv_norm = ${pumpRes.controlValve.normal.reqCv.toFixed(1)} · Cv_rated = ${pumpRes.controlValve.rated.reqCv.toFixed(1)}</text>

        <!-- Destination Vessel -->
        <rect x="735" y="22" width="165" height="134" rx="14" fill="rgba(5,150,105,0.12)" stroke="#059669" stroke-width="2.5" />
        <rect x="737" y="96" width="161" height="58" rx="11" fill="rgba(5,150,105,0.16)" />
        <text x="817" y="46" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">DESTINATION VESSEL</text>
        <text x="817" y="66" text-anchor="middle" font-size="10" font-weight="700" fill="#059669" font-family="JetBrains Mono">P_d = ${fmtPressG(p.destVesselBarg)}</text>
        <text x="817" y="84" text-anchor="middle" font-size="9.5" fill="#334155" font-family="JetBrains Mono">Z_d = +${fmtHead(p.dischargeStaticHeadM)}</text>
        <text x="817" y="112" text-anchor="middle" font-size="9.5" fill="#0f172a" font-family="JetBrains Mono">ΔP_equip = ${fmtDP(pumpRes.discharge.dP_equipBar, 2)}</text>
        <text x="817" y="132" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">Q_rated = ${fmtVolFlow(pumpRes.Q_ratedM3Hr)}</text>
      </svg>
    `;
  }

  function renderPumpCurveSvg(pumpRes) {
    const container = document.getElementById('pumpCurveSvgContainer');
    if (!container) return;

    const pts = pumpRes.curvePoints;
    const maxQ = pts[pts.length - 1].flowM3Hr;
    const maxH = Math.max(10, pumpRes.pump.shutoffHeadM * 1.15);

    const xOf = (qM3Hr) => 44 + (qM3Hr / maxQ) * 314;
    // Top panel: H(Q) from y=16 to y=132
    const yOfH = (hM) => 132 - Math.min(114, Math.max(0, (hM / maxH) * 114));

    const pumpPath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfH(pt.pumpHeadM).toFixed(1)}`).join(' ');
    const sysExCvPath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfH(pt.sysHeadExCvM).toFixed(1)}`).join(' ');
    const sysTotPath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfH(pt.sysHeadWithRatedCvM).toFixed(1)}`).join(' ');

    // Bottom panel: NPSHa(Q) vs NPSHr(Q) from y=150 to y=202
    const rhoG = Math.max(100, pumpRes.rhoKgM3) * 9.80665;
    const sucHeadLossRatedM = (pumpRes.suction.dP_totalBar * 1e5) / rhoG;
    const npshaZeroFlowM = pumpRes.npsh.npshaM + sucHeadLossRatedM;
    const maxNpsh = Math.max(8, npshaZeroFlowM * 1.2, pumpRes.npsh.npshrM * 1.6);
    const yOfNpsh = (nM) => 202 - Math.min(48, Math.max(0, (nM / maxNpsh) * 48));

    const npshaPts = pts.map((pt, i) => {
      const ratio = pt.flowM3Hr / Math.max(1e-6, pumpRes.Q_ratedM3Hr);
      const npshaAtQ = Math.max(0, npshaZeroFlowM - sucHeadLossRatedM * ratio * ratio);
      return `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfNpsh(npshaAtQ).toFixed(1)}`;
    }).join(' ');

    const npshrPts = pts.map((pt, i) => {
      const ratio = pt.flowM3Hr / Math.max(1e-6, pumpRes.Q_ratedM3Hr);
      const npshrAtQ = pumpRes.npsh.npshrM * (0.65 + 0.35 * ratio * ratio);
      return `${i === 0 ? 'M' : 'L'}${xOf(pt.flowM3Hr).toFixed(1)},${yOfNpsh(npshrAtQ).toFixed(1)}`;
    }).join(' ');

    const xNorm = xOf(pumpRes.Q_normM3Hr);
    const xRated = xOf(pumpRes.Q_ratedM3Hr);
    const yRated = yOfH(pumpRes.pump.tdhRatedM);
    const yShutoff = yOfH(pumpRes.pump.shutoffHeadM);
    const yNpshaRated = yOfNpsh(pumpRes.npsh.npshaM);
    const yNpshrRated = yOfNpsh(pumpRes.npsh.npshrM);

    container.innerHTML = `
      <svg viewBox="0 0 380 224" width="100%" height="224" role="img" aria-label="Pump Head and NPSH vs Flow Curves">
        <!-- Top Axes: Head H(Q) -->
        <line x1="44" y1="16" x2="44" y2="132" stroke="#64748b" stroke-width="1.5" />
        <line x1="44" y1="132" x2="362" y2="132" stroke="#64748b" stroke-width="1.5" />
        <text x="14" y="76" text-anchor="middle" font-size="8.5" font-weight="700" fill="#475569" font-family="JetBrains Mono" transform="rotate(-90 14,76)">HEAD</text>

        <!-- Head Curves -->
        <path d="${pumpPath}" fill="none" stroke="#0284c7" stroke-width="2.8" />
        <path d="${sysTotPath}" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-dasharray="4,3" />
        <path d="${sysExCvPath}" fill="none" stroke="#059669" stroke-width="2" />

        <!-- Vertical Operating Guides across both subplots -->
        <line x1="${xRated.toFixed(1)}" y1="16" x2="${xRated.toFixed(1)}" y2="202" stroke="#94a3b8" stroke-width="1.1" stroke-dasharray="3,3" />
        <line x1="${xNorm.toFixed(1)}" y1="16" x2="${xNorm.toFixed(1)}" y2="202" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="2,3" />

        <!-- Rated Operating Point Marker -->
        <circle cx="${xRated.toFixed(1)}" cy="${yRated.toFixed(1)}" r="8" fill="#dc2626" opacity="0.2" class="svg-pulse-dot" />
        <circle cx="${xRated.toFixed(1)}" cy="${yRated.toFixed(1)}" r="4.8" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" />
        <circle cx="44" cy="${yShutoff.toFixed(1)}" r="4" fill="#0284c7" />

        <!-- Top Legend & Labels -->
        <text x="50" y="${Math.max(25, yShutoff - 5).toFixed(1)}" font-size="8.5" font-weight="700" fill="#0284c7" font-family="JetBrains Mono">Shutoff: ${fmtHead(pumpRes.pump.shutoffHeadM, 0)}</text>
        <rect x="${Math.min(218, Math.max(48, xRated - 68)).toFixed(1)}" y="${Math.max(12, yRated - 20).toFixed(1)}" width="136" height="14" rx="3" fill="rgba(15,23,42,0.88)" />
        <text x="${Math.min(286, Math.max(116, xRated)).toFixed(1)}" y="${Math.max(22, yRated - 10).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#f8fafc" font-family="JetBrains Mono">Rated: ${fmtVolFlow(pumpRes.Q_ratedM3Hr, 0)} @ ${fmtHead(pumpRes.pump.tdhRatedM, 0)}</text>

        <!-- Bottom Subplot: NPSHa vs NPSHr -->
        <line x1="44" y1="150" x2="44" y2="202" stroke="#64748b" stroke-width="1.5" />
        <line x1="44" y1="202" x2="362" y2="202" stroke="#64748b" stroke-width="1.5" />
        <text x="14" y="176" text-anchor="middle" font-size="8.5" font-weight="700" fill="#475569" font-family="JetBrains Mono" transform="rotate(-90 14,176)">NPSH</text>

        <path d="${npshaPts}" fill="none" stroke="#059669" stroke-width="2.2" />
        <path d="${npshrPts}" fill="none" stroke="#d97706" stroke-width="2" stroke-dasharray="4,2" />
        <circle cx="${xRated.toFixed(1)}" cy="${yNpshaRated.toFixed(1)}" r="3.8" fill="#059669" stroke="#ffffff" stroke-width="1.2" />
        <circle cx="${xRated.toFixed(1)}" cy="${yNpshrRated.toFixed(1)}" r="3.8" fill="#d97706" stroke="#ffffff" stroke-width="1.2" />
        <text x="50" y="160" font-size="8" font-weight="700" fill="#059669" font-family="JetBrains Mono">NPSHa=${fmtHead(pumpRes.npsh.npshaM, 1)} vs NPSHr=${fmtHead(pumpRes.npsh.npshrM, 1)}</text>

        <text x="202" y="218" text-anchor="middle" font-size="8.5" font-weight="700" fill="#475569" font-family="JetBrains Mono">Top: Pump H(Q) / Sys+CV · Bottom: NPSHa (Green) vs NPSHr (Amber)</text>
      </svg>
    `;
  }

  function renderPumpWaterfallSvg(pumpRes) {
    const container = document.getElementById('pumpWaterfallSvgContainer');
    if (!container) return;

    const p = state.pumpLoop;
    const pSuc = Math.max(0, pumpRes.suction.nozzleBarg);
    const pDis = Math.max(0, pumpRes.discharge.nozzleBarg);
    const dpStaticDis = Math.max(0, (pumpRes.rhoKgM3 * 9.80665 * Math.max(0, Number(p.dischargeStaticHeadM) || 0)) / 1e5);
    const dpPipeEquip = Math.max(0, pumpRes.discharge.dP_pipeBar + pumpRes.discharge.dP_equipBar);
    const dpCv = Math.max(0, pumpRes.controlValve.allocatedDpRatedBar);
    const pDest = Math.max(0, Number(p.destVesselBarg) || 0);

    const maxP = Math.max(1, pDis * 1.18);
    const yTop = 20;
    const yBot = 128;
    const plotH = yBot - yTop;
    const yOfP = (valBarg) => yBot - Math.min(plotH, Math.max(0, (valBarg / maxP) * plotH));

    // Step levels along discharge hydraulic path:
    // 1. P_suc (0 -> pSuc)
    // 2. +ΔP_pump (pSuc -> pDis)
    // 3. -ΔP_static (pDis -> pAfterStat)
    // 4. -ΔP_pipe+eq (pAfterStat -> pAfterPipe)
    // 5. -ΔP_CV (pAfterPipe -> pDest)
    // 6. P_dest (0 -> pDest)
    const pAfterStat = Math.max(pDest, pDis - dpStaticDis);
    const pAfterPipe = Math.max(pDest, pAfterStat - dpPipeEquip);

    const bars = [
      { label: 'P_suc', valTxt: fmtPressG(pSuc, 1), pLow: 0, pHigh: pSuc, color: '#0284c7' },
      { label: '+ΔP_pump', valTxt: `+${fmtDP(pumpRes.pump.diffPressureRatedBar, 1)}`, pLow: pSuc, pHigh: pDis, color: '#059669' },
      { label: '-ΔP_stat', valTxt: `-${fmtDP(dpStaticDis, 1)}`, pLow: pAfterStat, pHigh: pDis, color: '#64748b' },
      { label: '-ΔP_line', valTxt: `-${fmtDP(dpPipeEquip, 1)}`, pLow: pAfterPipe, pHigh: pAfterStat, color: '#d97706' },
      { label: '-ΔP_CV', valTxt: `-${fmtDP(dpCv, 1)}`, pLow: pDest, pHigh: pAfterPipe, color: '#dc2626' },
      { label: 'P_dest', valTxt: fmtPressG(pDest, 1), pLow: 0, pHigh: pDest, color: '#0369a1' }
    ];

    const barsSvg = bars.map((b, idx) => {
      const x = 36 + idx * 54;
      const w = 38;
      const y1 = yOfP(b.pHigh);
      const y2 = yOfP(b.pLow);
      const h = Math.max(4, y2 - y1);
      return `
        <g>
          <rect x="${x}" y="${y1.toFixed(1)}" width="${w}" height="${h.toFixed(1)}" rx="3" fill="${b.color}" opacity="0.88" />
          <text x="${x + w / 2}" y="${Math.max(12, y1 - 4).toFixed(1)}" text-anchor="middle" font-size="7.8" font-weight="800" fill="${b.color}" font-family="JetBrains Mono">${b.valTxt}</text>
          <text x="${x + w / 2}" y="143" text-anchor="middle" font-size="8" font-weight="700" fill="#334155" font-family="JetBrains Mono">${b.label}</text>
        </g>
      `;
    }).join('');

    container.innerHTML = `
      <div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);margin-bottom:0.25rem;">
        Circuit Pressure Waterfall Bridge (Suction → Pump TDH → Consumers → Destination)
      </div>
      <svg viewBox="0 0 380 152" width="100%" height="152" role="img" aria-label="Pump Differential Pressure Waterfall Chart">
        <line x1="28" y1="${yTop}" x2="28" y2="${yBot}" stroke="#94a3b8" stroke-width="1.2" />
        <line x1="28" y1="${yBot}" x2="365" y2="${yBot}" stroke="#94a3b8" stroke-width="1.2" />
        ${barsSvg}
      </svg>
    `;
  }


  // =========================================================================
  // 5C. STEP 0: PROCESS & MECHANICAL VESSEL SIZING (GPSA / API 12J / ASME VIII)
  // =========================================================================

  function renderVesselOutputs(vesselRes) {
    const g = vesselRes.geometry;
    const m = vesselRes.mechanical;
    const s = vesselRes.separation;
    const f = vesselRes.firePreview;
    const mawpOk = m.mawpCorrodedBarg >= vesselRes.designPressureBarg - 1e-3;

    const badge = document.getElementById('vesselComplianceBadge');
    if (badge) {
      const ok = s.vaporCompliant && mawpOk;
      badge.className = `status-badge ${ok ? 'status-pass' : 'status-warn'}`;
      badge.textContent = ok
        ? `ID ${g.diameterMm.toFixed(0)} mm × L_TT ${g.lengthMm.toFixed(0)} mm · MAWP ${fmtPressG(m.mawpCorrodedBarg)} PASS`
        : `ID ${g.diameterMm.toFixed(0)} mm × L_TT ${g.lengthMm.toFixed(0)} mm · Check Velocity / MAWP`;
    }

    const couplingTxt = document.getElementById('vesselCouplingSummaryText');
    if (couplingTxt) {
      couplingTxt.innerHTML = `Sized <strong>${escapeHtml(vesselRes.vesselTag)}</strong> (${g.diameterM.toFixed(2)} m ID × ${g.lengthM.toFixed(2)} m T/T, NLL = ${fmtHead(g.levels.nllM, 2)}, A_ws = ${f.wettedAreaM2.toFixed(1)} m², W_fire = ${fmtFlow(f.reliefRateKgHr)}, MAWP = ${fmtPressG(m.mawpCorrodedBarg)}).`;
    }

    // 1. Executive Metrics Summary Grid (6 cards)
    const metricsGrid = document.getElementById('vesselMetricsSummaryGrid');
    if (metricsGrid) {
      metricsGrid.innerHTML = `
        <div class="metric-box">
          <span class="metric-box-label">Nominal Vessel Dimensions</span>
          <span class="metric-box-main" style="color:var(--accent-primary);">${g.diameterMm.toFixed(0)} × ${g.lengthMm.toFixed(0)} mm</span>
          <span class="metric-box-sub">${fmtHead(g.diameterM, 2)} ID × ${fmtHead(g.lengthM, 2)} T/T (L/D = ${g.ldRatio.toFixed(2)})</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Vapor Separation &amp; Settling</span>
          ${s.reentrainment ? `
          <span class="metric-box-main" style="color:${s.vaporCompliant && s.reentrainment.compliant ? 'var(--pass-text)' : 'var(--warn-text)'};">t_fall / t_res = ${s.vaporVelUtilizationPct.toFixed(0)}%</span>
          <span class="metric-box-sub">Droplet fall ${s.reentrainment.dropletFallSec.toFixed(1)} s vs gas residence ${s.reentrainment.gasResidenceSec.toFixed(1)} s · Axial v = ${s.actualVaporVelMS.toFixed(2)} m/s ≤ v_re ${s.reentrainment.vHorizMaxMS.toFixed(2)} m/s (${s.reentrainment.compliant ? 'no re-entrainment' : 'RE-ENTRAINMENT RISK'})</span>` : `
          <span class="metric-box-main" style="color:${s.vaporCompliant ? 'var(--pass-text)' : 'var(--warn-text)'};">${s.actualVaporVelMS.toFixed(2)} m/s (${s.vaporVelUtilizationPct.toFixed(0)}%)</span>
          <span class="metric-box-sub">v_allow = ${s.governingSettlingVelMS.toFixed(2)} m/s (K = ${s.effectiveKsbMS.toFixed(3)} m/s)</span>`}
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Liquid Levels &amp; Residence</span>
          <span class="metric-box-main">NLL = ${fmtHead(g.levels.nllM, 2)}</span>
          <span class="metric-box-sub">LLL ${fmtHead(g.levels.lllM, 2)} · HLL ${fmtHead(g.levels.hllM, 2)} (${vesselRes.holdup.tauHoldMin}+${vesselRes.holdup.tauSurgeMin} min)</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">ASME VIII Shell &amp; Head Wall</span>
          <span class="metric-box-main">${m.tShellSelectedMm} / ${m.tHeadSelectedMm} mm</span>
          <span class="metric-box-sub">${escapeHtml(m.materialName)} (CA = ${m.corrosionAllowanceMm} mm)</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">Corroded MAWP &amp; Steel Weight</span>
          <span class="metric-box-main" style="color:${mawpOk ? 'var(--pass-text)' : 'var(--fail-text)'};">${fmtPressG(m.mawpCorrodedBarg)}</span>
          <span class="metric-box-sub">Empty: ${(m.emptyWeightKg / 1000).toFixed(1)} t · Oper: ${(m.operatingWeightKg / 1000).toFixed(1)} t · Hydro: ${(m.hydrotestWeightKg / 1000).toFixed(1)} t</span>
        </div>
        <div class="metric-box">
          <span class="metric-box-label">API 521 Wetted Area &amp; Pool Fire</span>
          <span class="metric-box-main">${f.wettedAreaM2.toFixed(1)} m² (${f.wettedAreaFt2.toFixed(0)} ft²)</span>
          <span class="metric-box-sub">Q_fire = ${f.heatDutyKw.toFixed(0)} kW → W_fire = <strong>${fmtFlow(f.reliefRateKgHr)}</strong></span>
        </div>
      `;
    }

    // 2. Nozzle Schedule Table
    const nozTbody = document.getElementById('vesselNozzleTbody');
    if (nozTbody) {
      const nozRows = [
        { label: 'N1 — Feed Inlet Nozzle', ...vesselRes.nozzles.inlet },
        { label: 'N2 — Overhead Vapor Outlet', ...vesselRes.nozzles.vaporOutlet },
        { label: 'N3 — Bottom Liquid Outlet', ...vesselRes.nozzles.liquidOutlet }
      ];
      nozTbody.innerHTML = nozRows.map(n => `
        <tr>
          <td><strong>${escapeHtml(n.label)}</strong></td>
          <td class="mono" style="font-weight:800;color:var(--accent-primary);">${n.nps} (DN ${n.dn})</td>
          <td class="mono">${n.idMm.toFixed(1)} mm</td>
          <td class="mono" style="font-weight:700;">${n.velocityMS.toFixed(2)} m/s (${n.velocityFtS.toFixed(1)} ft/s)</td>
          <td class="mono">${n.momentumPa.toFixed(0)} Pa</td>
          <td class="mono" style="font-size:0.72rem;">v ≤ ${n.maxVelocityMS} m/s · ρv² ≤ ${n.maxMomentumPa} Pa</td>
          <td><span class="status-badge ${n.compliant ? 'status-pass' : 'status-warn'}">${n.compliant ? 'PASS' : 'HIGH'}</span></td>
        </tr>
      `).join('');
    }

    // 3. Whitebox Step-by-Step Calculation Trace
    const eqContainer = document.getElementById('vesselEquationSteps');
    if (eqContainer) {
      eqContainer.innerHTML = vesselRes.steps.map(st => `
        <div class="eq-step-card">
          <div class="eq-step-header">${st.title}</div>
          <div class="eq-symbolic">${st.symbolic || st.formula || ''}</div>
          <div class="eq-substitution">${st.substitution}</div>
          <div class="eq-result">⇒ ${st.result}</div>
        </div>
      `).join('');
    }

    // 4. Synchronized Blueprint & Engineering Charts
    renderVesselBlueprintSvg(vesselRes);
    renderVesselFillCurveSvg(vesselRes);
    renderVesselLdWeightSvg(vesselRes);
  }

  function renderVesselBlueprintSvg(vesselRes) {
    const container = document.getElementById('vesselBlueprintSvgContainer');
    if (!container) return;

    const g = vesselRes.geometry;
    const m = vesselRes.mechanical;
    const lv = g.levels;
    const noz = vesselRes.nozzles;
    const f = vesselRes.firePreview;
    const isVert = vesselRes.orientation === 'vertical';

    if (isVert) {
      // Vertical Vessel Elevation Blueprint
      const vx = 210;
      const vy = 34;
      const vw = 150;
      const vh = 152;
      const yFromFrac = (frac) => vy + vh - Math.max(0, Math.min(1, frac)) * vh;

      const fLLL = lv.lllM / Math.max(0.1, g.lengthM);
      const fNLL = lv.nllM / Math.max(0.1, g.lengthM);
      const fHLL = lv.hllM / Math.max(0.1, g.lengthM);
      const fHHLL = lv.hhllM / Math.max(0.1, g.lengthM);
      const fInlet = (lv.inletCenterlineM || (lv.hhllM + 0.45)) / Math.max(0.1, g.lengthM);
      const fDemister = (lv.demisterBottomM || (g.lengthM - 0.40)) / Math.max(0.1, g.lengthM);

      const yLLL = yFromFrac(fLLL);
      const yNLL = yFromFrac(fNLL);
      const yHLL = yFromFrac(fHLL);
      const yHHLL = yFromFrac(fHHLL);
      const yInlet = yFromFrac(fInlet);
      const yDem = yFromFrac(fDemister);
      const spreadLvl = (ys, gap) => { const o = ys.slice(); for (let i = 1; i < o.length; i++) if (o[i] < o[i - 1] + gap) o[i] = o[i - 1] + gap; return o; };
      const [tyHHLL, tyHLL, tyNLL, tyLLL] = spreadLvl([yHHLL, yHLL, yNLL, yLLL].map(y => y + 3), 11);

      container.innerHTML = `
        <svg viewBox="0 0 880 232" width="100%" height="232" role="img" aria-label="Vertical Vessel Mechanical and Level Elevation Blueprint">
          <!-- Left Feed Pipe & Nozzle N1 -->
          <line x1="78" y1="${yInlet.toFixed(1)}" x2="${vx}" y2="${yInlet.toFixed(1)}" stroke="#0284c7" stroke-width="7" />
          <line x1="82" y1="${yInlet.toFixed(1)}" x2="${vx - 4}" y2="${yInlet.toFixed(1)}" stroke="#bae6fd" stroke-width="2.5" class="svg-flow-anim" />
          <rect x="18" y="${(yInlet - 24).toFixed(1)}" width="128" height="36" rx="4" fill="#0f172a" />
          <text x="82" y="${(yInlet - 9).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="800" fill="#38bdf8" font-family="JetBrains Mono">N1 Feed: ${noz.inlet.nps}</text>
          <text x="82" y="${(yInlet + 5).toFixed(1)}" text-anchor="middle" font-size="8.2" fill="#f8fafc" font-family="JetBrains Mono">ρv² = ${noz.inlet.momentumPa.toFixed(0)} Pa</text>

          <!-- Top & Bottom 2:1 Ellipsoidal Heads + Shell -->
          <path d="M${vx},${vy} A${vw / 2},22 0 0,1 ${vx + vw},${vy} L${vx + vw},${vy + vh} A${vw / 2},22 0 0,1 ${vx},${vy + vh} Z"
                fill="rgba(15,23,42,0.06)" stroke="#0f172a" stroke-width="3" />

          <!-- Liquid Holdup Pool up to NLL -->
          <path d="M${vx + 2},${yNLL.toFixed(1)} L${vx + vw - 2},${yNLL.toFixed(1)} L${vx + vw - 2},${vy + vh} A${vw / 2 - 2},20 0 0,1 ${vx + 2},${vy + vh} Z"
                fill="rgba(2,132,199,0.22)" />

          <!-- Demister Pad Internals -->
          <rect x="${vx + 4}" y="${(yDem - 5).toFixed(1)}" width="${vw - 8}" height="10" fill="rgba(5,150,105,0.25)" stroke="#059669" stroke-width="1.4" stroke-dasharray="4,2" />
          <text x="${vx + vw / 2}" y="${(yDem + 14).toFixed(1)}" text-anchor="middle" font-size="8.2" font-weight="800" fill="#059669" font-family="JetBrains Mono">DEMISTER (K=${vesselRes.separation.effectiveKsbMS.toFixed(3)} m/s)</text>

          <!-- Level Lines (HHLL, HLL, NLL, LLL) -->
          <line x1="${vx + 4}" y1="${yHHLL.toFixed(1)}" x2="${vx + vw + 58}" y2="${yHHLL.toFixed(1)}" stroke="#dc2626" stroke-width="1.3" stroke-dasharray="4,3" />
          <text x="${vx + vw + 63}" y="${tyHHLL.toFixed(1)}" font-size="8.5" font-weight="800" fill="#dc2626" font-family="JetBrains Mono">HHLL: ${fmtHead(lv.hhllM, 2)}</text>

          <line x1="${vx + 4}" y1="${yHLL.toFixed(1)}" x2="${vx + vw + 58}" y2="${yHLL.toFixed(1)}" stroke="#d97706" stroke-width="1.3" stroke-dasharray="4,3" />
          <text x="${vx + vw + 63}" y="${tyHLL.toFixed(1)}" font-size="8.5" font-weight="800" fill="#d97706" font-family="JetBrains Mono">HLL:  ${fmtHead(lv.hllM, 2)}</text>

          <line x1="${vx + 4}" y1="${yNLL.toFixed(1)}" x2="${vx + vw + 58}" y2="${yNLL.toFixed(1)}" stroke="#0284c7" stroke-width="1.8" />
          <text x="${vx + vw + 63}" y="${tyNLL.toFixed(1)}" font-size="8.8" font-weight="800" fill="#0284c7" font-family="JetBrains Mono">NLL:  ${fmtHead(lv.nllM, 2)} (A_ws=${f.wettedAreaM2.toFixed(1)}m²)</text>

          <line x1="${vx + 4}" y1="${yLLL.toFixed(1)}" x2="${vx + vw + 58}" y2="${yLLL.toFixed(1)}" stroke="#64748b" stroke-width="1.2" stroke-dasharray="3,3" />
          <text x="${vx + vw + 63}" y="${tyLLL.toFixed(1)}" font-size="8.5" font-weight="700" fill="#475569" font-family="JetBrains Mono">LLL:  ${fmtHead(lv.lllM, 2)}</text>

          <!-- Top Vapor Outlet Nozzle N2 -->
          <line x1="${vx + vw / 2}" y1="${vy - 22}" x2="${vx + vw / 2}" y2="4" stroke="#059669" stroke-width="6" />
          <text x="${vx + vw / 2 + 12}" y="13" font-size="8.5" font-weight="800" fill="#059669" font-family="JetBrains Mono">N2 Vap: ${noz.vaporOutlet.nps} (${noz.vaporOutlet.velocityMS.toFixed(1)} m/s)</text>

          <!-- Bottom Liquid Outlet Nozzle N3 & Skirt -->
          <line x1="${vx + 18}" y1="${vy + vh + 10}" x2="${vx + 8}" y2="224" stroke="#475569" stroke-width="4" />
          <line x1="${vx + vw - 18}" y1="${vy + vh + 10}" x2="${vx + vw - 8}" y2="224" stroke="#475569" stroke-width="4" />
          <line x1="${vx + vw / 2}" y1="${vy + vh + 22}" x2="${vx + vw / 2 + 88}" y2="${vy + vh + 22}" stroke="#0284c7" stroke-width="6" />
          <text x="${vx + vw / 2 + 94}" y="${vy + vh + 25}" font-size="8.5" font-weight="800" fill="#0369a1" font-family="JetBrains Mono">N3 Liq: ${noz.liquidOutlet.nps} (${noz.liquidOutlet.velocityMS.toFixed(2)} m/s)</text>

          <!-- Vessel Center Callout Label -->
          <text x="${vx + vw / 2}" y="${(vy + 46).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">${escapeHtml(vesselRes.vesselTag)}</text>
          <text x="${vx + vw / 2}" y="${(vy + 62).toFixed(1)}" text-anchor="middle" font-size="9.2" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">ID ${g.diameterMm.toFixed(0)} × ${g.lengthMm.toFixed(0)} mm</text>

          <!-- Right Mechanical & Process Summary Card inside SVG -->
          <rect x="555" y="16" width="308" height="198" rx="7" fill="rgba(15,23,42,0.04)" stroke="#cbd5e1" stroke-width="1.5" />
          <text x="570" y="38" font-size="10" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">ASME SEC. VIII DIV. 1 &amp; GPSA SUMMARY</text>
          <text x="570" y="58" font-size="9" fill="#334155" font-family="JetBrains Mono">• Material: ${escapeHtml(m.materialCode)} (S=${m.allowableStressMpa} MPa, E=${m.jointEfficiencyE})</text>
          <text x="570" y="76" font-size="9" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">• Shell Plate (UG-27): ${m.tShellSelectedMm} mm (t_req=${m.tShellReqMm.toFixed(1)} mm)</text>
          <text x="570" y="94" font-size="9" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">• Head Plate (UG-32):  ${m.tHeadSelectedMm} mm (t_req=${m.tHeadReqMm.toFixed(1)} mm)</text>
          <text x="570" y="112" font-size="9" font-weight="800" fill="#059669" font-family="JetBrains Mono">• Corroded MAWP: ${fmtPressG(m.mawpCorrodedBarg)} (P_des=${fmtPressG(vesselRes.designPressureBarg)})</text>
          <text x="570" y="130" font-size="9" fill="#334155" font-family="JetBrains Mono">• Empty / Oper / Hydro: ${(m.emptyWeightKg / 1000).toFixed(1)}t / ${(m.operatingWeightKg / 1000).toFixed(1)}t / ${(m.hydrotestWeightKg / 1000).toFixed(1)}t</text>
          <text x="570" y="148" font-size="9" fill="#334155" font-family="JetBrains Mono">• Total Vessel Volume: ${g.totalVolumeM3.toFixed(1)} m³ (Holdup=${vesselRes.holdup.V_holdupM3.toFixed(2)} m³)</text>
          <text x="570" y="166" font-size="9" font-weight="700" fill="#d97706" font-family="JetBrains Mono">• API 521 Wetted Area: A_ws = ${f.wettedAreaM2.toFixed(2)} m² (${f.wettedAreaFt2.toFixed(0)} ft²)</text>
          <text x="570" y="184" font-size="9" font-weight="800" fill="#dc2626" font-family="JetBrains Mono">• Pool Fire Relief: Q=${f.heatDutyKw.toFixed(0)} kW → W=${fmtFlow(f.reliefRateKgHr)}</text>
          <text x="570" y="202" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">• Grade Elev Z=${fmtHead(g.elevAboveGradeM, 1)} | Static Pump Head=${fmtHead(g.elevAboveGradeM + lv.nllM, 2)}</text>
        </svg>
      `;
    } else {
      // Horizontal Vessel Elevation Blueprint (2-Phase Surge, Flare KO, or 3-Phase Boot/Weir)
      const hx = 68;
      const hy = 46;
      const hw = 320;
      const hh = 114;
      const yFromFrac = (frac) => hy + hh - Math.max(0, Math.min(1, frac)) * hh;

      const fLLL = lv.lllM / Math.max(0.1, g.diameterM);
      const fNLL = lv.nllM / Math.max(0.1, g.diameterM);
      const fHLL = lv.hllM / Math.max(0.1, g.diameterM);
      const fHHLL = lv.hhllM / Math.max(0.1, g.diameterM);

      const yLLL = yFromFrac(fLLL);
      const yNLL = yFromFrac(fNLL);
      const yHLL = yFromFrac(fHLL);
      const yHHLL = yFromFrac(fHHLL);

      const is3Phase = vesselRes.vesselServiceType === 'three_phase';
      const spreadLvlH = (ys, gap) => { const o = ys.slice(); for (let i = 1; i < o.length; i++) if (o[i] < o[i - 1] + gap) o[i] = o[i - 1] + gap; return o; };
      const [tyHHLL, tyHLL, tyNLL, tyLLL] = spreadLvlH([yHHLL, yHLL, yNLL, yLLL].map(y => y + 3), 11);

      const yInterface = is3Phase && lv.nilM
        ? yFromFrac(lv.nilM / Math.max(0.1, g.diameterM))
        : null;

      container.innerHTML = `
        <svg viewBox="0 0 880 232" width="100%" height="232" role="img" aria-label="Horizontal Vessel Mechanical and Level Elevation Blueprint">
          <!-- Left Feed Nozzle N1 -->
          <line x1="${hx + 34}" y1="12" x2="${hx + 34}" y2="${hy}" stroke="#0284c7" stroke-width="7" />
          <text x="${hx + 34}" y="10" text-anchor="middle" font-size="8.5" font-weight="800" fill="#0284c7" font-family="JetBrains Mono">N1 Feed ${noz.inlet.nps} (ρv²=${noz.inlet.momentumPa.toFixed(0)}Pa)</text>

          <!-- Top Right Vapor Outlet Nozzle N2 -->
          <line x1="${hx + hw - 36}" y1="${hy}" x2="${hx + hw - 36}" y2="12" stroke="#059669" stroke-width="7" />
          <text x="${hx + hw - 36}" y="10" text-anchor="middle" font-size="8.5" font-weight="800" fill="#059669" font-family="JetBrains Mono">N2 Vap ${noz.vaporOutlet.nps} (${noz.vaporOutlet.velocityMS.toFixed(1)}m/s)</text>

          <!-- Horizontal Cylindrical Shell + Left/Right 2:1 Ellipsoidal Heads -->
          <path d="M${hx},${hy} L${hx + hw},${hy} A26,${hh / 2} 0 0,1 ${hx + hw},${hy + hh} L${hx},${hy + hh} A26,${hh / 2} 0 0,1 ${hx},${hy} Z"
                fill="rgba(15,23,42,0.06)" stroke="#0f172a" stroke-width="3" />

          <!-- Liquid Pool up to NLL -->
          <rect x="${hx - 14}" y="${yNLL.toFixed(1)}" width="${hw + 28}" height="${(hy + hh - yNLL).toFixed(1)}" rx="10" fill="rgba(2,132,199,0.22)" />
          ${yInterface !== null ? `
            <rect x="${hx - 10}" y="${yInterface.toFixed(1)}" width="${hw + 20}" height="${(hy + hh - yInterface).toFixed(1)}" rx="8" fill="rgba(14,116,144,0.28)" />
            <line x1="${hx - 10}" y1="${yInterface.toFixed(1)}" x2="${hx + hw + 10}" y2="${yInterface.toFixed(1)}" stroke="#0e7490" stroke-width="1.4" stroke-dasharray="5,3" />
          ` : ''}

          <!-- Level Lines (HHLL, HLL, NLL, LLL) -->
          <line x1="${hx - 16}" y1="${yHHLL.toFixed(1)}" x2="${hx + hw + 42}" y2="${yHHLL.toFixed(1)}" stroke="#dc2626" stroke-width="1.3" stroke-dasharray="4,3" />
          <text x="${hx + hw + 46}" y="${tyHHLL.toFixed(1)}" font-size="8.3" font-weight="800" fill="#dc2626" font-family="JetBrains Mono">HHLL: ${fmtHead(lv.hhllM, 2)}</text>

          <line x1="${hx - 16}" y1="${yHLL.toFixed(1)}" x2="${hx + hw + 42}" y2="${yHLL.toFixed(1)}" stroke="#d97706" stroke-width="1.3" stroke-dasharray="4,3" />
          <text x="${hx + hw + 46}" y="${tyHLL.toFixed(1)}" font-size="8.3" font-weight="800" fill="#d97706" font-family="JetBrains Mono">HLL:  ${fmtHead(lv.hllM, 2)}</text>

          <line x1="${hx - 18}" y1="${yNLL.toFixed(1)}" x2="${hx + hw + 42}" y2="${yNLL.toFixed(1)}" stroke="#0284c7" stroke-width="1.8" />
          <text x="${hx + hw + 46}" y="${tyNLL.toFixed(1)}" font-size="8.6" font-weight="800" fill="#0284c7" font-family="JetBrains Mono">NLL:  ${fmtHead(lv.nllM, 2)}</text>

          <line x1="${hx - 14}" y1="${yLLL.toFixed(1)}" x2="${hx + hw + 42}" y2="${yLLL.toFixed(1)}" stroke="#64748b" stroke-width="1.2" stroke-dasharray="3,3" />
          <text x="${hx + hw + 46}" y="${tyLLL.toFixed(1)}" font-size="8.3" font-weight="700" fill="#475569" font-family="JetBrains Mono">LLL:  ${fmtHead(lv.lllM, 2)}</text>

          <!-- Vessel Saddles & Bottom Liquid Nozzle N3 -->
          <polygon points="${hx + 45},${hy + hh} ${hx + 65},${hy + hh} ${hx + 72},198 ${hx + 38},198" fill="#475569" />
          <polygon points="${hx + hw - 65},${hy + hh} ${hx + hw - 45},${hy + hh} ${hx + hw - 38},198 ${hx + hw - 72},198" fill="#475569" />
          <line x1="${hx + hw - 28}" y1="${hy + hh}" x2="${hx + hw - 28}" y2="212" stroke="#0284c7" stroke-width="6" />
          <text x="${hx + hw - 28}" y="224" text-anchor="middle" font-size="8.5" font-weight="800" fill="#0369a1" font-family="JetBrains Mono">N3 Liq: ${noz.liquidOutlet.nps} (${noz.liquidOutlet.velocityMS.toFixed(2)} m/s)</text>

          <!-- Vessel Tag & Dimensions Label -->
          <text x="${hx + hw / 2}" y="${hy + 22}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">${escapeHtml(vesselRes.vesselTag)} — ID ${g.diameterMm.toFixed(0)} × L_TT ${g.lengthMm.toFixed(0)} mm (L/D=${g.ldRatio.toFixed(2)})</text>
          <text x="${hx + hw / 2}" y="${hy + 38}" text-anchor="middle" font-size="8.6" font-weight="700" fill="#059669" font-family="JetBrains Mono">v_vap = ${vesselRes.separation.actualVaporVelMS.toFixed(2)} m/s ≤ v_allow = ${vesselRes.separation.governingSettlingVelMS.toFixed(2)} m/s</text>

          <!-- Right Mechanical & Process Summary Card inside SVG -->
          <rect x="555" y="16" width="308" height="198" rx="7" fill="rgba(15,23,42,0.04)" stroke="#cbd5e1" stroke-width="1.5" />
          <text x="570" y="38" font-size="10" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">ASME SEC. VIII DIV. 1 &amp; GPSA SUMMARY</text>
          <text x="570" y="58" font-size="9" fill="#334155" font-family="JetBrains Mono">• Material: ${escapeHtml(m.materialCode)} (S=${m.allowableStressMpa} MPa, E=${m.jointEfficiencyE})</text>
          <text x="570" y="76" font-size="9" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">• Shell Plate (UG-27): ${m.tShellSelectedMm} mm (t_req=${m.tShellReqMm.toFixed(1)} mm)</text>
          <text x="570" y="94" font-size="9" font-weight="700" fill="#0369a1" font-family="JetBrains Mono">• Head Plate (UG-32):  ${m.tHeadSelectedMm} mm (t_req=${m.tHeadReqMm.toFixed(1)} mm)</text>
          <text x="570" y="112" font-size="9" font-weight="800" fill="#059669" font-family="JetBrains Mono">• Corroded MAWP: ${fmtPressG(m.mawpCorrodedBarg)} (P_des=${fmtPressG(vesselRes.designPressureBarg)})</text>
          <text x="570" y="130" font-size="9" fill="#334155" font-family="JetBrains Mono">• Empty / Oper / Hydro: ${(m.emptyWeightKg / 1000).toFixed(1)}t / ${(m.operatingWeightKg / 1000).toFixed(1)}t / ${(m.hydrotestWeightKg / 1000).toFixed(1)}t</text>
          <text x="570" y="148" font-size="9" fill="#334155" font-family="JetBrains Mono">• Total Vessel Volume: ${g.totalVolumeM3.toFixed(1)} m³ (Holdup=${vesselRes.holdup.V_holdupM3.toFixed(2)} m³)</text>
          <text x="570" y="166" font-size="9" font-weight="700" fill="#d97706" font-family="JetBrains Mono">• API 521 Wetted Area: A_ws = ${f.wettedAreaM2.toFixed(2)} m² (${f.wettedAreaFt2.toFixed(0)} ft²)</text>
          <text x="570" y="184" font-size="9" font-weight="800" fill="#dc2626" font-family="JetBrains Mono">• Pool Fire Relief: Q=${f.heatDutyKw.toFixed(0)} kW → W=${fmtFlow(f.reliefRateKgHr)}</text>
          <text x="570" y="202" font-size="8.5" fill="#64748b" font-family="JetBrains Mono">• Grade Elev Z=${fmtHead(g.elevAboveGradeM, 1)} | Static Pump Head=${fmtHead(g.elevAboveGradeM + lv.nllM, 2)}</text>
        </svg>
      `;
    }
  }

  function renderVesselFillCurveSvg(vesselRes) {
    const container = document.getElementById('vesselFillCurveSvgContainer');
    if (!container) return;

    const pts = vesselRes.fillCurvePoints || [];
    if (pts.length === 0) return;
    const g = vesselRes.geometry;
    const lv = g.levels;
    const maxH = isVertVessel(vesselRes) ? Math.max(0.5, g.lengthM) : Math.max(0.5, g.diameterM);

    const xOfPct = (pct) => 44 + Math.min(1, Math.max(0, pct / 100)) * 290;
    const yOfFrac = (frac) => 142 - Math.min(1, Math.max(0, frac)) * 116;

    const pathVol = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOfPct(pt.volPct).toFixed(1)},${yOfFrac(pt.hOverD).toFixed(1)}`).join(' ');
    const pathWet = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOfPct(pt.wetPct).toFixed(1)},${yOfFrac(pt.hOverD).toFixed(1)}`).join(' ');
    const nllY = yOfFrac(lv.nllM / maxH);
    const hllY = yOfFrac(lv.hllM / maxH);
    const lllY = yOfFrac(lv.lllM / maxH);

    container.innerHTML = `
      <svg viewBox="0 0 360 168" width="100%" height="168" role="img" aria-label="Vessel Liquid Level vs Partial Volume Curve">
        <line x1="44" y1="22" x2="44" y2="142" stroke="#64748b" stroke-width="1.4" />
        <line x1="44" y1="142" x2="340" y2="142" stroke="#64748b" stroke-width="1.4" />
        <path d="${pathVol}" fill="none" stroke="#0284c7" stroke-width="2.6" />
        <path d="${pathWet}" fill="none" stroke="#059669" stroke-width="1.8" stroke-dasharray="4,2" />

        <!-- Level Horizontal Guides -->
        <line x1="44" y1="${hllY.toFixed(1)}" x2="336" y2="${hllY.toFixed(1)}" stroke="#d97706" stroke-width="1.1" stroke-dasharray="3,3" />
        <text x="334" y="${(hllY - 3).toFixed(1)}" text-anchor="end" font-size="8" font-weight="700" fill="#d97706" font-family="JetBrains Mono">HLL ${fmtHead(lv.hllM, 2)}</text>

        <line x1="44" y1="${nllY.toFixed(1)}" x2="336" y2="${nllY.toFixed(1)}" stroke="#059669" stroke-width="1.5" />
        <text x="334" y="${(nllY - 3).toFixed(1)}" text-anchor="end" font-size="8.2" font-weight="800" fill="#059669" font-family="JetBrains Mono">NLL ${fmtHead(lv.nllM, 2)} (A_ws=${vesselRes.firePreview.wettedAreaM2.toFixed(1)}m²)</text>

        <line x1="44" y1="${lllY.toFixed(1)}" x2="336" y2="${lllY.toFixed(1)}" stroke="#64748b" stroke-width="1.1" stroke-dasharray="2,3" />
        <text x="334" y="${(lllY - 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#475569" font-family="JetBrains Mono">LLL ${fmtHead(lv.lllM, 2)}</text>

        <text x="190" y="160" text-anchor="middle" font-size="8.2" font-weight="700" fill="#475569" font-family="JetBrains Mono">Partial Volume % (Blue) &amp; Wetted Area % (Green) [V_tot=${g.totalVolumeM3.toFixed(1)} m³]</text>
      </svg>
    `;
  }

  function isVertVessel(vesselRes) {
    return vesselRes.orientation === 'vertical';
  }

  function renderVesselLdWeightSvg(vesselRes) {
    const container = document.getElementById('vesselLdWeightSvgContainer');
    if (!container) return;

    const pts = vesselRes.ldCurvePoints || [];
    if (pts.length === 0) return;
    const minLd = pts[0].ld;
    const maxLd = pts[pts.length - 1].ld;
    const weights = pts.map(p => p.eqWtTonnes);
    const minW = Math.min(...weights) * 0.9;
    const maxW = Math.max(...weights, minW + 0.5) * 1.08;

    const xOfLd = (ld) => 44 + ((ld - minLd) / Math.max(0.1, maxLd - minLd)) * 290;
    const yOfW = (wt) => 142 - ((wt - minW) / Math.max(0.1, maxW - minW)) * 112;

    const pathD = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOfLd(pt.ld).toFixed(1)},${yOfW(pt.eqWtTonnes).toFixed(1)}`).join(' ');
    const curLd = Math.min(maxLd, Math.max(minLd, vesselRes.geometry.ldRatio));
    const curW = vesselRes.mechanical.emptyWeightKg / 1000;
    const cx = xOfLd(curLd);
    const cy = Math.min(138, Math.max(28, yOfW(curW)));

    container.innerHTML = `
      <svg viewBox="0 0 360 168" width="100%" height="168" role="img" aria-label="Vessel Slenderness Ratio vs Steel Weight Curve">
        <line x1="44" y1="22" x2="44" y2="142" stroke="#64748b" stroke-width="1.4" />
        <line x1="44" y1="142" x2="340" y2="142" stroke="#64748b" stroke-width="1.4" />
        <!-- Optimal Economic L/D Zone (2.5 to 4.0) -->
        <rect x="${xOfLd(2.5).toFixed(1)}" y="22" width="${(xOfLd(4.0) - xOfLd(2.5)).toFixed(1)}" height="120" fill="rgba(5,150,105,0.10)" />
        <text x="${((xOfLd(2.5) + xOfLd(4.0)) / 2).toFixed(1)}" y="34" text-anchor="middle" font-size="7.8" font-weight="700" fill="#059669" font-family="JetBrains Mono">OPTIMAL L/D (2.5–4.0)</text>

        <path d="${pathD}" fill="none" stroke="#0369a1" stroke-width="2.5" />
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" />
        <text x="${Math.min(290, Math.max(85, cx)).toFixed(1)}" y="${Math.max(46, cy - 8).toFixed(1)}" text-anchor="middle" font-size="8.2" font-weight="800" fill="#dc2626" font-family="JetBrains Mono">Selected L/D=${vesselRes.geometry.ldRatio.toFixed(2)} (${curW.toFixed(1)} t)</text>

        <text x="190" y="160" text-anchor="middle" font-size="8.2" font-weight="700" fill="#475569" font-family="JetBrains Mono">Slenderness Ratio L_TT / D_i (2.0 → 5.5) vs Empty Steel Weight (t)</text>
      </svg>
    `;
  }


  // =========================================================================
  // 6. STEP 5: FORMAL IPDS DATASHEET & CALCULATION SHEET (PSV, PUMP & VESSEL)
  // =========================================================================

  function renderVesselIpdsDatasheet(v, vesselRes, todayStr) {
    const g = vesselRes.geometry;
    const m = vesselRes.mechanical;
    const s = vesselRes.separation;
    const lv = g.levels;
    const noz = vesselRes.nozzles;
    const f = vesselRes.firePreview;

    return `
      <table class="ipds-header-table">
        <tr>
          <td rowspan="3" style="width:24%;background:#0f172a;color:#ffffff;text-align:center;">
            <div style="font-family:var(--font-mono);font-size:1.15rem;font-weight:800;letter-spacing:0.04em;">EQUIPMENT PROCESS DATASHEET (IPDS)</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">PRESSURE VESSEL &amp; SEPARATOR (GPSA / API 12J / ASME VIII DIV. 1)</div>
          </td>
          <td style="width:38%;"><strong>PROJECT:</strong> ${escapeHtml(v.project || state.tag.projectTitle)}</td>
          <td style="width:20%;"><strong>VESSEL TAG:</strong> <span class="mono" style="font-weight:800;color:#0369a1;">${escapeHtml(vesselRes.vesselTag)}</span></td>
          <td style="width:18%;"><strong>DATE:</strong> <span class="mono">${todayStr}</span></td>
        </tr>
        <tr>
          <td><strong>CLIENT / CODE:</strong> ${escapeHtml(state.tag.clientName)} · ASME Sec. VIII Div. 1</td>
          <td><strong>NOMINAL SIZE:</strong> <span class="mono" style="font-weight:800;">${g.diameterMm.toFixed(0)} mm ID × ${g.lengthMm.toFixed(0)} mm T/T</span></td>
          <td><strong>REV:</strong> <span class="mono">0 (Issued for Design)</span></td>
        </tr>
        <tr>
          <td><strong>SERVICE:</strong> ${escapeHtml(vesselRes.service)}</td>
          <td colspan="2"><strong>TYPE &amp; INTERNALS:</strong> <span class="mono" style="text-transform:uppercase;">${escapeHtml(vesselRes.orientation)} · ${escapeHtml(vesselRes.internalsType)} · ${escapeHtml(vesselRes.headType)} Heads</span></td>
        </tr>
      </table>

      <div class="ipds-section-banner">1. OPERATING &amp; DESIGN CONDITIONS, PHASE FLOW RATES &amp; PHYSICAL PROPERTIES</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">1</td>
          <td style="width:32%;"><strong>Operating Pressure / Design Pressure (MAWP Basis)</strong></td>
          <td class="mono" style="width:18%;">${fmtPressG(vesselRes.operatingPressureBarg)} / <strong>${fmtPressG(vesselRes.designPressureBarg)}</strong></td>
          <td class="ipds-line-no">2</td>
          <td style="width:32%;"><strong>Operating Temperature / Design Temperature</strong></td>
          <td class="mono" style="width:18%;">${fmtTemp(vesselRes.operatingTempC)} / <strong>${fmtTemp(vesselRes.designTempC)}</strong></td>
        </tr>
        <tr>
          <td class="ipds-line-no">3</td>
          <td><strong>Vapor Mass Flow Rate / Vapor Density (ρ_V) / Vol. Flow (Q_V)</strong></td>
          <td class="mono">${fmtFlow(vesselRes.flows.W_vapKgHr)} / ${vesselRes.flows.rhoV.toFixed(2)} kg/m³ / ${vesselRes.flows.Q_vapM3Hr.toFixed(1)} m³/h</td>
          <td class="ipds-line-no">4</td>
          <td><strong>Liquid Mass Flow Rate / Liquid Density (ρ_L) / Vol. Flow (Q_L)</strong></td>
          <td class="mono">${fmtFlow(vesselRes.flows.W_liqKgHr)} / ${vesselRes.flows.rhoL.toFixed(1)} kg/m³ / ${fmtVolFlow(vesselRes.flows.Q_liqM3Hr)}</td>
        </tr>
      </table>

      <div class="ipds-section-banner">2. VAPOR-LIQUID SEPARATION, HOLDUP / SURGE GEOMETRY &amp; LEVEL ELEVATION SCHEDULE</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">5</td>
          <td style="width:32%;"><strong>Souders-Brown K_SB Factor / Max Allowable Vapor Velocity</strong></td>
          <td class="mono" style="width:18%;">K_SB = ${s.effectiveKsbMS.toFixed(3)} m/s / v_allow = ${s.governingSettlingVelMS.toFixed(2)} m/s</td>
          <td class="ipds-line-no">6</td>
          <td style="width:32%;"><strong>Actual Vapor Velocity / % of Souders-Brown Flooding Limit</strong></td>
          <td class="mono" style="width:18%;font-weight:700;color:${s.vaporCompliant ? '#065f46' : '#991b1b'};">${s.actualVaporVelMS.toFixed(2)} m/s (${s.vaporVelUtilizationPct.toFixed(1)}%) — ${s.vaporCompliant ? 'PASS' : 'HIGH'}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">7</td>
          <td><strong>Liquid Holdup Time (LLL→NLL) / Surge Time (NLL→HLL)</strong></td>
          <td class="mono">${vesselRes.holdup.tauHoldMin.toFixed(1)} min (${vesselRes.holdup.V_holdupM3.toFixed(2)} m³) / ${vesselRes.holdup.tauSurgeMin.toFixed(1)} min (${vesselRes.holdup.V_surgeM3.toFixed(2)} m³)</td>
          <td class="ipds-line-no">8</td>
          <td><strong>Selected Vessel ID × T/T Length (L/D Ratio &amp; Total Volume)</strong></td>
          <td class="mono" style="font-weight:800;color:#0369a1;">${g.diameterMm.toFixed(0)} mm (${g.diameterFt.toFixed(2)} ft) × ${g.lengthMm.toFixed(0)} mm (${g.lengthFt.toFixed(2)} ft) | L/D = ${g.ldRatio.toFixed(2)} | V_tot = ${g.totalVolumeM3.toFixed(2)} m³</td>
        </tr>
        <tr>
          <td class="ipds-line-no">9</td>
          <td><strong>Liquid Level Elevation Table (LLL / NLL / HLL / HHLL)</strong></td>
          <td class="mono" colspan="4"><strong>LLL:</strong> ${fmtHead(lv.lllM, 2)} &nbsp;|&nbsp; <strong>NLL:</strong> ${fmtHead(lv.nllM, 2)} &nbsp;|&nbsp; <strong>HLL:</strong> ${fmtHead(lv.hllM, 2)} &nbsp;|&nbsp; <strong>HHLL:</strong> ${fmtHead(lv.hhllM, 2)} (Above Bottom Tangent / Shell Inv.)</td>
        </tr>
      </table>

      <div class="ipds-section-banner">3. ASME SECTION VIII DIV. 1 MECHANICAL WALL THICKNESS, MAWP &amp; NOZZLE SCHEDULE</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">10</td>
          <td style="width:32%;"><strong>ASME Plate Material / Allowable Stress (S) / Joint Eff. (E)</strong></td>
          <td class="mono" style="width:18%;">${escapeHtml(m.materialName)} / S = ${m.allowableStressMpa} MPa / E = ${m.jointEfficiencyE.toFixed(2)}</td>
          <td class="ipds-line-no">11</td>
          <td style="width:32%;"><strong>Corrosion Allowance (CA) / Shell &amp; Head Nominal Plate</strong></td>
          <td class="mono" style="width:18%;font-weight:800;">CA = ${m.corrosionAllowanceMm.toFixed(1)} mm | Shell = ${m.tShellSelectedMm} mm | Head = ${m.tHeadSelectedMm} mm</td>
        </tr>
        <tr>
          <td class="ipds-line-no">12</td>
          <td><strong>Corroded MAWP (UG-27) / Empty, Operating &amp; Hydrotest Weights</strong></td>
          <td class="mono" style="font-weight:700;color:#065f46;">MAWP = ${fmtPressG(m.mawpCorrodedBarg)} | Empty ${(m.emptyWeightKg / 1000).toFixed(1)} t / Oper ${(m.operatingWeightKg / 1000).toFixed(1)} t / Hydro ${(m.hydrotestWeightKg / 1000).toFixed(1)} t</td>
          <td class="ipds-line-no">13</td>
          <td><strong>API 521 Wetted Area (A_ws ≤ 7.62m) &amp; Pool Fire Relief Load</strong></td>
          <td class="mono" style="font-weight:700;color:#dc2626;">A_ws = ${f.wettedAreaM2.toFixed(2)} m² (${f.wettedAreaFt2.toFixed(1)} ft²) | Q = ${f.heatDutyKw.toFixed(1)} kW → W_fire = ${fmtFlow(f.reliefRateKgHr)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">14</td>
          <td><strong>Nozzle Schedule (N1 Feed / N2 Vapor / N3 Liquid)</strong></td>
          <td class="mono" colspan="4">
            <strong>N1 Feed:</strong> ${noz.inlet.nps} (${noz.inlet.velocityMS.toFixed(1)} m/s, ρv²=${noz.inlet.momentumPa.toFixed(0)} Pa) &nbsp;|&nbsp;
            <strong>N2 Vapor:</strong> ${noz.vaporOutlet.nps} (${noz.vaporOutlet.velocityMS.toFixed(1)} m/s, ρv²=${noz.vaporOutlet.momentumPa.toFixed(0)} Pa) &nbsp;|&nbsp;
            <strong>N3 Liquid:</strong> ${noz.liquidOutlet.nps} (${noz.liquidOutlet.velocityMS.toFixed(2)} m/s)
          </td>
        </tr>
      </table>

      <div class="ipds-section-banner">4. STEP-BY-STEP PROCESS &amp; MECHANICAL VESSEL VERIFICATION TRACE</div>
      <table class="ipds-data-table">
        ${vesselRes.steps.map((st, idx) => `
          <tr>
            <td class="ipds-line-no">V${idx + 1}</td>
            <td style="width:28%;font-weight:700;">${st.title}</td>
            <td class="mono" style="font-size:0.74rem;">
              <div><strong>Eq:</strong> ${st.symbolic || st.formula || ''}</div>
              <div><strong>Sub:</strong> ${st.substitution}</div>
              <div style="color:#065f46;font-weight:700;"><strong>Result:</strong> ${st.result}</div>
            </td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  function renderPumpIpdsDatasheet(p, pumpRes, todayStr) {
    return `
      <table class="ipds-header-table">
        <tr>
          <td rowspan="3" style="width:24%;background:#0f172a;color:#ffffff;text-align:center;">
            <div style="font-family:var(--font-mono);font-size:1.15rem;font-weight:800;letter-spacing:0.04em;">EQUIPMENT PROCESS DATASHEET (IPDS)</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">CENTRIFUGAL PUMP &amp; HYDRAULIC LOOP (API 610 / API 14E)</div>
          </td>
          <td style="width:38%;"><strong>PROJECT:</strong> ${escapeHtml(p.project || state.tag.projectTitle)}</td>
          <td style="width:20%;"><strong>PUMP TAG:</strong> <span class="mono" style="font-weight:800;color:#0369a1;">${escapeHtml(p.pumpTag)}</span></td>
          <td style="width:18%;"><strong>DATE:</strong> <span class="mono">${todayStr}</span></td>
        </tr>
        <tr>
          <td><strong>CLIENT / STD:</strong> ${escapeHtml(state.tag.clientName)} · API 610 12th Ed.</td>
          <td><strong>MOTOR RATING:</strong> <span class="mono" style="font-weight:800;">${pumpRes.pump.selectedMotorKw} kW</span></td>
          <td><strong>REV:</strong> <span class="mono">0 (Vendor Print / IFD)</span></td>
        </tr>
        <tr>
          <td><strong>SERVICE:</strong> ${escapeHtml(p.service)}</td>
          <td colspan="2"><strong>LINES:</strong> <span class="mono">Suction ${pumpRes.suction.nps} ${pumpRes.suction.schedule} × Discharge ${pumpRes.discharge.nps} ${pumpRes.discharge.schedule}</span></td>
        </tr>
      </table>

      <div class="ipds-section-banner">1. OPERATING CONDITIONS, LIQUID PROPERTIES &amp; FLOW RATES</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">1</td>
          <td style="width:32%;"><strong>Pumped Liquid /Pumping Temperature (T_pump)</strong></td>
          <td class="mono" style="width:18%;">${escapeHtml(p.FluidName || 'Process Liquid')} @ ${fmtTemp(pumpRes.tempC)}</td>
          <td class="ipds-line-no">2</td>
          <td style="width:32%;"><strong>Liquid Density (ρ) / Specific Gravity (SG) / Viscosity (μ)</strong></td>
          <td class="mono" style="width:18%;">${pumpRes.rhoKgM3.toFixed(1)} kg/m³ (SG=${pumpRes.SG.toFixed(3)}) / ${pumpRes.viscCp} cP</td>
        </tr>
        <tr>
          <td class="ipds-line-no">3</td>
          <td><strong>Vapor Pressure at Pumping Temp (P_vap)</strong></td>
          <td class="mono">${fmtPressA(pumpRes.vaporPressBara, 3)}</td>
          <td class="ipds-line-no">4</td>
          <td><strong>Normal / Rated / Minimum Continuous Flow</strong></td>
          <td class="mono"><strong>${fmtVolFlow(pumpRes.Q_normM3Hr)}</strong> / <strong>${fmtVolFlow(pumpRes.Q_ratedM3Hr)}</strong> / ${fmtVolFlow(pumpRes.Q_minM3Hr)}</td>
        </tr>
      </table>

      <div class="ipds-section-banner">2. SUCTION &amp; DISCHARGE HYDRAULICS, NPSH &amp; DIFFERENTIAL HEAD (API 610)</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">5</td>
          <td style="width:32%;"><strong>Suction Vessel Pressure / Static Elevation Head (Z_s)</strong></td>
          <td class="mono" style="width:18%;">${fmtPressG(p.suctionVesselBarg)} / +${fmtHead(p.suctionStaticHeadM)}</td>
          <td class="ipds-line-no">6</td>
          <td style="width:32%;"><strong>Destination Vessel Pressure / Static Elevation Head (Z_d)</strong></td>
          <td class="mono" style="width:18%;">${fmtPressG(p.destVesselBarg)} / +${fmtHead(p.dischargeStaticHeadM)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">7</td>
          <td><strong>Suction Line Friction Loss / Pump Suction Nozzle Pressure</strong></td>
          <td class="mono">${fmtDP(pumpRes.suction.dP_totalBar, 3)} / <strong>${fmtPressG(pumpRes.suction.nozzleBarg)}</strong></td>
          <td class="ipds-line-no">8</td>
          <td><strong>Discharge Line + Equip + CV Loss / Discharge Nozzle Pressure</strong></td>
          <td class="mono">${fmtDP(pumpRes.discharge.dP_pipeBar + pumpRes.discharge.dP_equipBar + pumpRes.controlValve.allocatedDpRatedBar, 2)} / <strong>${fmtPressG(pumpRes.discharge.nozzleBarg)}</strong></td>
        </tr>
        <tr>
          <td class="ipds-line-no">9</td>
          <td><strong>Rated Differential Pressure (ΔP_rated) &amp; Total Head (TDH)</strong></td>
          <td class="mono" style="font-weight:800;color:#0369a1;">${fmtDP(pumpRes.pump.diffPressureRatedBar, 2)} / ${fmtHead(pumpRes.pump.tdhRatedM)}</td>
          <td class="ipds-line-no">10</td>
          <td><strong>Shutoff Differential Head &amp; Max Shutoff Discharge Pressure</strong></td>
          <td class="mono" style="font-weight:800;color:#dc2626;">${fmtHead(pumpRes.pump.shutoffHeadM)} / ${fmtPressG(pumpRes.pump.maxDischargeBarg)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">11</td>
          <td><strong>Available NPSH (NPSHa) vs Vendor Required NPSHr (3%)</strong></td>
          <td class="mono" style="font-weight:700;color:${pumpRes.npsh.compliant ? '#065f46' : '#991b1b'};">NPSHa = ${fmtHead(pumpRes.npsh.npshaM, 2)} vs NPSHr = ${fmtHead(pumpRes.npsh.npshrM, 2)} (${pumpRes.npsh.compliant ? 'PASS' : 'FAIL'})</td>
          <td class="ipds-line-no">12</td>
          <td><strong>Hydraulic Power / Brake Shaft Power / API 610 Motor Nameplate</strong></td>
          <td class="mono">${pumpRes.pump.hydraulicPowerKw.toFixed(1)} kW / ${pumpRes.pump.brakePowerKw.toFixed(1)} kW (${pumpRes.pump.brakePowerHp.toFixed(1)} hp) / <strong>${pumpRes.pump.selectedMotorKw} kW</strong></td>
        </tr>
      </table>

      <div class="ipds-section-banner">3. CONTROL VALVE SIZING (IEC 60534) &amp; LINE VELOCITY SUMMARY (API 14E)</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">13</td>
          <td style="width:32%;"><strong>Allocated Control Valve ΔP at Rated Flow (% Dynamic)</strong></td>
          <td class="mono" style="width:18%;">${fmtDP(pumpRes.controlValve.allocatedDpRatedBar, 2)} (${pumpRes.controlValve.pctOfDynamic.toFixed(1)}%)</td>
          <td class="ipds-line-no">14</td>
          <td style="width:32%;"><strong>Required Control Valve Cv (Min / Normal / Rated)</strong></td>
          <td class="mono" style="width:18%;font-weight:700;">${pumpRes.controlValve.min.reqCv.toFixed(1)} / ${pumpRes.controlValve.normal.reqCv.toFixed(1)} / ${pumpRes.controlValve.rated.reqCv.toFixed(1)} (Max Cv=${pumpRes.controlValve.selectedMaxCv})</td>
        </tr>
        <tr>
          <td class="ipds-line-no">15</td>
          <td><strong>Suction Line Velocity &amp; ΔP/100m (${pumpRes.suction.nps} ${pumpRes.suction.schedule})</strong></td>
          <td class="mono">v_s = ${pumpRes.suction.velocityMS.toFixed(2)} m/s | ${fmtDP(pumpRes.suction.dpPer100mBar, 3)}/100m</td>
          <td class="ipds-line-no">16</td>
          <td><strong>Discharge Line Velocity &amp; API 14E Erosional Limit (${pumpRes.discharge.nps})</strong></td>
          <td class="mono">v_d = ${pumpRes.discharge.velocityMS.toFixed(2)} m/s (v_e = ${pumpRes.discharge.vErosionalMS.toFixed(2)} m/s)</td>
        </tr>
      </table>

      <div class="ipds-section-banner">4. STEP-BY-STEP PUMP HYDRAULIC VERIFICATION TRACE</div>
      <table class="ipds-data-table">
        ${pumpRes.steps.map((s, idx) => `
          <tr>
            <td class="ipds-line-no">P${idx + 1}</td>
            <td style="width:28%;font-weight:700;">${s.title}</td>
            <td class="mono" style="font-size:0.74rem;">
              <div><strong>Eq:</strong> ${s.formula}</div>
              <div><strong>Sub:</strong> ${s.substitution}</div>
              <div style="color:#065f46;font-weight:700;"><strong>Result:</strong> ${s.result}</div>
            </td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  function renderIpdsDatasheet(t, scenariosBundle, sizing, hyd, pumpRes, vesselRes) {
    const sheet = document.getElementById('ipdsPrintableSheet');
    const todayStr = new Date().toISOString().slice(0, 10);

    if (state.ipdsMode === 'pump' && pumpRes) {
      sheet.innerHTML = renderPumpIpdsDatasheet(state.pumpLoop, pumpRes, todayStr);
      return;
    }

    if (state.ipdsMode === 'vessel' && vesselRes) {
      sheet.innerHTML = renderVesselIpdsDatasheet(state.vessel, vesselRes, todayStr);
      return;
    }

    const gov = scenariosBundle.governing;

    sheet.innerHTML = `
      <table class="ipds-header-table">
        <tr>
          <td rowspan="3" style="width:24%;background:#0f172a;color:#ffffff;text-align:center;">
            <div style="font-family:var(--font-mono);font-size:1.15rem;font-weight:800;letter-spacing:0.04em;">INSTRUMENT PROCESS DATASHEET (IPDS)</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:4px;">PRESSURE RELIEF VALVE (API 520 / 521 / 526)</div>
          </td>
          <td style="width:38%;"><strong>PROJECT:</strong> ${escapeHtml(t.projectTitle)}</td>
          <td style="width:20%;"><strong>TAG NO.:</strong> <span class="mono" style="font-weight:800;color:#0369a1;">${escapeHtml(t.tagNumber)}</span></td>
          <td style="width:18%;"><strong>DATE:</strong> <span class="mono">${todayStr}</span></td>
        </tr>
        <tr>
          <td><strong>CLIENT / STD:</strong> ${escapeHtml(t.clientName)}</td>
          <td><strong>ORIFICE:</strong> <span class="mono" style="font-weight:800;">API 526 "${sizing.selectedOrifice.letter}"</span></td>
          <td><strong>REV:</strong> <span class="mono">0 (Issued for Design)</span></td>
        </tr>
        <tr>
          <td><strong>SERVICE:</strong> ${escapeHtml(t.service)}</td>
          <td colspan="2"><strong>P&amp;ID NO.:</strong> <span class="mono">${escapeHtml(t.pidNumber)}</span></td>
        </tr>
      </table>

      <div class="ipds-section-banner">1. GENERAL &amp; EQUIPMENT BASIS</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">1</td>
          <td style="width:32%;"><strong>Protected Equipment No. &amp; Description</strong></td>
          <td style="width:18%;">${escapeHtml(t.equipmentProtected)}</td>
          <td class="ipds-line-no">2</td>
          <td style="width:32%;"><strong>Governing Overpressure Scenario (API 521)</strong></td>
          <td style="width:18%;font-weight:700;">${gov.scenarioName}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">3</td>
          <td><strong>Design Code / Sizing Standard</strong></td>
          <td>ASME Sec. VIII Div.1 / API 520 Pt I &amp; II</td>
          <td class="ipds-line-no">4</td>
          <td><strong>Valve Design Type</strong></td>
          <td style="text-transform:capitalize;font-weight:700;">${t.valveType === 'bellows' ? 'Balanced Bellows' : (t.valveType === 'pilot' ? 'Pilot-Operated' : 'Conventional Spring-Loaded')}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">5</td>
          <td><strong>Upstream Rupture Disc Combination (Kc)</strong></td>
          <td class="mono">${t.ruptureDiscUpstream ? 'Yes (Kc = 0.90)' : 'No (Kc = 1.00)'}</td>
          <td class="ipds-line-no">6</td>
          <td><strong>Barometric Atmospheric Pressure</strong></td>
          <td class="mono">${fmtPressA(t.atmPressureBara, 3)}</td>
        </tr>
      </table>

      <div class="ipds-section-banner">2. PROCESS OPERATING, RELIEVING &amp; FLUID PROPERTIES</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">7</td>
          <td style="width:32%;"><strong>Fluid State / Phase at Relieving Conditions</strong></td>
          <td style="width:18%;text-transform:uppercase;font-weight:700;">${t.fluidPhase}</td>
          <td class="ipds-line-no">8</td>
          <td style="width:32%;"><strong>Required Relief Mass Flow Rate (W_req)</strong></td>
          <td class="mono" style="width:18%;font-weight:700;">${fmtFlow(sizing.W_kgHr)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">9</td>
          <td><strong>Normal Operating Pressure / Set Pressure (P_set)</strong></td>
          <td class="mono">${fmtPressG(t.operatingPressureBarg)} / <strong>${fmtPressG(sizing.P_setBarg)}</strong></td>
          <td class="ipds-line-no">10</td>
          <td><strong>Allowed Overpressure % / Relieving Pressure (P₁)</strong></td>
          <td class="mono">${sizing.overpressurePct.toFixed(0)}% / <strong>${fmtPressA(sizing.P1_bara)}</strong></td>
        </tr>
        <tr>
          <td class="ipds-line-no">11</td>
          <td><strong>Superimposed / Built-Up / Total Backpressure</strong></td>
          <td class="mono">${fmtPressG(t.superimposedBackBarg)} / ${fmtPressG(hyd.outlet.builtUpBackBarg)} / <strong>${fmtPressG(hyd.outlet.totalBackBarg)} (${hyd.outlet.totalBackPctOfSet.toFixed(1)}%)</strong></td>
          <td class="ipds-line-no">12</td>
          <td><strong>Relieving Temperature (T₁)</strong></td>
          <td class="mono">${fmtTemp(sizing.T1_C)} (${sizing.T1_K.toFixed(2)} K)</td>
        </tr>
        <tr>
          <td class="ipds-line-no">13</td>
          <td><strong>Molecular Weight (M) / Specific Heat Ratio (k = Cp/Cv)</strong></td>
          <td class="mono">${t.mw.toFixed(2)} kg/kmol / k = ${t.k.toFixed(3)}</td>
          <td class="ipds-line-no">14</td>
          <td><strong>Compressibility (Z) / Liquid Density (ρ) / Viscosity (μ)</strong></td>
          <td class="mono">Z = ${t.z.toFixed(3)} / ρ = ${t.rhoLiqKgM3.toFixed(1)} kg/m³ / μ = ${t.viscCp} cP</td>
        </tr>
      </table>

      <div class="ipds-section-banner">3. API 520 PART I ORIFICE SIZING &amp; API 526 SELECTION SUMMARY</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">15</td>
          <td style="width:32%;"><strong>Flow Regime &amp; Critical Choking Pressure (P_cf)</strong></td>
          <td class="mono" style="width:18%;">${sizing.flowRegime} (${sizing.Pcf_bara > 0 ? fmtPressA(sizing.Pcf_bara) : 'N/A'})</td>
          <td class="ipds-line-no">16</td>
          <td style="width:32%;"><strong>Sizing Coefficients (Kd / Kb or Kw / Kc / Kv)</strong></td>
          <td class="mono" style="width:18%;">Kd=${sizing.Kd} | Kb=${sizing.Kb.toFixed(3)} | Kc=${sizing.Kc} | Kv=${sizing.Kv.toFixed(3)}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">17</td>
          <td><strong>Required Effective Orifice Area (A_req)</strong></td>
          <td class="mono" style="font-weight:800;color:#dc2626;">${sizing.reqAreaMm2.toFixed(1)} mm² (${sizing.reqAreaIn2.toFixed(4)} in²)</td>
          <td class="ipds-line-no">18</td>
          <td><strong>Selected API 526 Standard Orifice &amp; Area (A_sel)</strong></td>
          <td class="mono" style="font-weight:800;color:#0369a1;">Orifice "${sizing.selectedOrifice.letter}" — ${sizing.selectedOrifice.areaMm2.toFixed(1)} mm² (${sizing.selectedOrifice.areaIn2.toFixed(3)} in²)</td>
        </tr>
        <tr>
          <td class="ipds-line-no">19</td>
          <td><strong>Standard Valve Inlet × Outlet Flange Size</strong></td>
          <td class="mono" style="font-weight:700;">${sizing.selectedOrifice.inletOutFlange}</td>
          <td class="ipds-line-no">20</td>
          <td><strong>Orifice Utilization % &amp; Valve Rated Capacity (W_rated)</strong></td>
          <td class="mono">${sizing.selectedOrifice.utilizationPct.toFixed(1)}% | W_rated = ${fmtFlow(sizing.ratedCapacityKgHr)}</td>
        </tr>
      </table>

      <div class="ipds-section-banner">4. API 520 PART II INLET &amp; OUTLET PIPING HYDRAULIC SUMMARY</div>
      <table class="ipds-data-table">
        <tr>
          <td class="ipds-line-no">21</td>
          <td style="width:32%;"><strong>Inlet Line NPS, Schedule, Length &amp; Fittings ΣK</strong></td>
          <td class="mono" style="width:18%;">${hyd.inlet.nps} ${hyd.inlet.schedule} (ID=${hyd.inlet.idMm} mm), L=${hyd.inlet.lengthM}m, ΣK=${hyd.inlet.K_fittings}</td>
          <td class="ipds-line-no">22</td>
          <td style="width:32%;"><strong>Inlet Pressure Loss ΔP_inlet (% of P_set ≤ 3.0% Rule)</strong></td>
          <td class="mono" style="width:18%;font-weight:700;color:${hyd.inlet.passes3Pct ? '#065f46' : '#991b1b'};">${fmtDP(hyd.inlet.dP_totalBar)} (${hyd.inlet.lossPctOfSet.toFixed(2)}%) — ${hyd.inlet.passes3Pct ? 'PASS' : 'FAIL'}</td>
        </tr>
        <tr>
          <td class="ipds-line-no">23</td>
          <td><strong>Outlet Tailpipe NPS, Schedule, Length &amp; Fittings ΣK</strong></td>
          <td class="mono">${hyd.outlet.nps} ${hyd.outlet.schedule} (ID=${hyd.outlet.idMm} mm), L=${hyd.outlet.lengthM}m, ΣK=${hyd.outlet.K_fittings}</td>
          <td class="ipds-line-no">24</td>
          <td><strong>Outlet Mach Number &amp; Discharge Reaction Force (F_r)</strong></td>
          <td class="mono">Ma = ${hyd.outlet.machNumber.toFixed(2)} | F_r = ${hyd.outlet.reactionForceKn.toFixed(2)} kN (${Math.round(hyd.outlet.reactionForceLbf)} lbf)</td>
        </tr>
      </table>

      <div class="ipds-section-banner">5. STEP-BY-STEP EQUATION VERIFICATION TRACE</div>
      <table class="ipds-data-table">
        ${sizing.steps.map((s, idx) => `
          <tr>
            <td class="ipds-line-no">S${idx + 1}</td>
            <td style="width:28%;font-weight:700;">${s.title}</td>
            <td class="mono" style="font-size:0.74rem;">
              <div><strong>Eq:</strong> ${s.formula}</div>
              <div><strong>Sub:</strong> ${s.substitution}</div>
              <div style="color:#065f46;font-weight:700;"><strong>Result:</strong> ${s.result}</div>
            </td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  // =========================================================================
  // 7. STEP 6: PROJECT TAG REGISTER & EXPORT / IMPORT
  // =========================================================================

  function renderProjectRegisterTable() {
    const tbody = document.getElementById('projectRegisterTbody');
    if (!tbody) return;
    const badge = document.getElementById('registerCountBadge');
    if (badge) badge.textContent = String(state.register.length);

    const evaluatedRows = state.register.map((tagItem, idx) => {
      const { sizing: s, hyd: h } = computeForTag(tagItem);
      return { tagItem, idx, s, h };
    });

    renderRegisterVisualDashboard(evaluatedRows);

    tbody.innerHTML = evaluatedRows.map(({ tagItem, idx, s, h }) => {
      const isCurrent = tagItem.tagNumber === state.tag.tagNumber;
      return `
        <tr class="${isCurrent ? 'row-governing' : ''}">
          <td class="mono" style="font-weight:800;color:var(--accent-primary);">${escapeHtml(tagItem.tagNumber)}</td>
          <td>
            <div style="font-weight:700;">${escapeHtml(tagItem.service)}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(tagItem.equipmentProtected)} · ${escapeHtml(tagItem.pidNumber || '')}</div>
          </td>
          <td class="mono" style="text-transform:uppercase;">${escapeHtml(tagItem.fluidPhase)}</td>
          <td class="mono">${escapeHtml((tagItem.governingScenarioKey || 'blocked_outlet').replace('_', ' '))}</td>
          <td class="mono">${fmtPressG(tagItem.setPressureBarg)}</td>
          <td class="mono">${fmtFlow(tagItem.flowRateKgHr)}</td>
          <td class="mono" style="font-weight:700;">${s.reqAreaMm2.toFixed(1)} mm²</td>
          <td class="mono" style="font-weight:800;color:var(--accent-primary);">${s.selectedOrifice.letter} (${s.selectedOrifice.inletOutFlange})</td>
          <td class="mono">
            <span class="status-badge ${h.inlet.passes3Pct ? 'status-pass' : 'status-fail'}">${escapeHtml(tagItem.inletNps)}: ${h.inlet.lossPctOfSet.toFixed(2)}%</span>
          </td>
          <td class="mono">
            <span class="status-badge ${h.outlet.passesBackpressure ? 'status-pass' : 'status-fail'}">${escapeHtml(tagItem.outletNps)}: ${h.outlet.totalBackPctOfSet.toFixed(1)}%</span>
          </td>
          <td>
            <div style="display:flex;gap:0.35rem;">
              <button type="button" class="btn btn-primary btn-load-reg" data-idx="${idx}" style="padding:0.22rem 0.5rem;font-size:0.73rem;">Load</button>
              <button type="button" class="btn btn-secondary btn-del-reg" data-idx="${idx}" style="padding:0.22rem 0.5rem;font-size:0.73rem;">✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-load-reg').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (state.register[idx]) {
          state.tag = JSON.parse(JSON.stringify(state.register[idx]));
          syncTagToDomInputs();
          renderScenarioForm();
          recomputeAll();
          switchTab('tab-sizing');
        }
      });
    });

    tbody.querySelectorAll('.btn-del-reg').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (state.register.length > 1) {
          state.register.splice(idx, 1);
          saveRegisterToStorage();
          renderProjectRegisterTable();
        }
      });
    });
  }

  function renderRegisterVisualDashboard(evaluatedRows) {
    const container = document.getElementById('registerVisualDashboard');
    if (!container) return;

    const totalTags = evaluatedRows.length;
    const totalRelievingKgHr = evaluatedRows.reduce((acc, r) => acc + (Number(r.tagItem.flowRateKgHr) || 0), 0);
    const inletPassCount = evaluatedRows.filter(r => r.h.inlet.passes3Pct).length;
    const outletPassCount = evaluatedRows.filter(r => r.h.outlet.passesBackpressure).length;
    const fullAuditPassCount = evaluatedRows.filter(r => r.h.inlet.passes3Pct && r.h.outlet.passesBackpressure).length;

    const phaseCounts = {};
    const orificeCounts = {};
    evaluatedRows.forEach(({ tagItem, s }) => {
      const ph = (tagItem.fluidPhase || 'vapor').toUpperCase();
      phaseCounts[ph] = (phaseCounts[ph] || 0) + 1;
      const lettr = s.selectedOrifice.letter;
      orificeCounts[lettr] = (orificeCounts[lettr] || 0) + 1;
    });

    const letters = Object.keys(orificeCounts);
    const maxOrificeCount = Math.max(1, ...Object.values(orificeCounts));
    const barSlotW = Math.min(68, Math.floor(340 / Math.max(1, letters.length)));
    const barsSvg = letters.map((lettr, idx) => {
      const cnt = orificeCounts[lettr];
      const x = 44 + idx * barSlotW;
      const bw = Math.max(22, barSlotW - 14);
      const bh = Math.max(14, (cnt / maxOrificeCount) * 62);
      const y = 92 - bh;
      return `
        <g>
          <rect x="${x}" y="${y.toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="4" fill="#0284c7" />
          <text x="${x + bw / 2}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0284c7" font-family="JetBrains Mono">${cnt} tag${cnt > 1 ? 's' : ''}</text>
          <text x="${x + bw / 2}" y="107" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a" font-family="JetBrains Mono">"${lettr}"</text>
        </g>
      `;
    }).join('');

    const phaseSummaryStr = Object.entries(phaseCounts).map(([k, v]) => `${k}: ${v}`).join(' · ');

    container.innerHTML = `
      <div class="register-exec-grid">
        <div class="exec-kpi-card">
          <span class="exec-kpi-label">Total Plant PSVs Registered</span>
          <span class="exec-kpi-value">${totalTags} Tags</span>
          <span class="exec-kpi-sub">Phases: ${escapeHtml(phaseSummaryStr)}</span>
        </div>
        <div class="exec-kpi-card">
          <span class="exec-kpi-label">Cumulative Relief Load</span>
          <span class="exec-kpi-value" style="color:var(--accent-primary);">${fmtFlow(totalRelievingKgHr)}</span>
          <span class="exec-kpi-sub">Combined peak flare/vent header basis</span>
        </div>
        <div class="exec-kpi-card">
          <span class="exec-kpi-label">API 520 3% Inlet Audit</span>
          <span class="exec-kpi-value" style="color:${inletPassCount === totalTags ? 'var(--pass-text)' : 'var(--warn-text)'};">${inletPassCount} / ${totalTags} PASS</span>
          <span class="exec-kpi-sub">Chatter-free non-recoverable ΔP_in ≤ 3%</span>
        </div>
        <div class="exec-kpi-card">
          <span class="exec-kpi-label">Overall EPC Audit Compliance</span>
          <span class="exec-kpi-value" style="color:${fullAuditPassCount === totalTags ? 'var(--pass-text)' : 'var(--warn-text)'};">${Math.round((fullAuditPassCount / Math.max(1, totalTags)) * 100)}%</span>
          <span class="exec-kpi-sub">Inlet (${inletPassCount}/${totalTags}) &amp; Backpressure (${outletPassCount}/${totalTags})</span>
        </div>
      </div>
      <div style="background:var(--bg-surface-alt);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:0.65rem 0.9rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;">
        <div>
          <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">API 526 Standard Orifice Procurement Distribution</div>
          <div style="font-size:0.73rem;color:var(--text-muted);margin-top:0.15rem;">Breakdown of selected API 526 standard orifice designations across all registered plant relief valves</div>
        </div>
        <svg viewBox="0 0 420 116" width="420" height="116" style="max-width:100%;" role="img" aria-label="API 526 Orifice Distribution Chart">
          <line x1="30" y1="92" x2="405" y2="92" stroke="#94a3b8" stroke-width="1.4" />
          ${barsSvg}
        </svg>
      </div>
    `;
  }

  // =========================================================================
  // 8. MASTER RECOMPUTE & EVENT BINDING
  // =========================================================================

  function recomputeAll() {
    const t = state.tag;
    const scenariosBundle = evaluateAllScenariosForTag(t);
    const { sizing, hyd } = computeForTag(t);
    const pumpRes = E.calcPumpLoopHydraulics({
      ...state.pumpLoop,
      atmPressureBara: t.atmPressureBara || 1.01325
    });
    const vesselRes = E.calcVesselSizingFromScratch({
      ...state.vessel,
      atmPressureBara: t.atmPressureBara || 1.01325
    });

    renderVesselOutputs(vesselRes);
    renderScenarioOutputs(scenariosBundle);
    renderSizingOutputs(sizing);
    renderHydraulicsOutputs(sizing, hyd);
    renderPumpOutputs(pumpRes);
    renderIpdsDatasheet(t, scenariosBundle, sizing, hyd, pumpRes, vesselRes);
    renderProjectRegisterTable();
    updateAskPsvContextBar(t, sizing, hyd, pumpRes, vesselRes);
    scheduleAutosave();
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.workflow-tabs .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });
  }

  function exportCsvFile(filename, rows) {
    const csvContent = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function initEventListeners() {
    // Tab switching (main buttons + crawlable internal anchor links)
    document.querySelectorAll('.workflow-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.querySelectorAll('a[data-tab-link]').forEach(link => {
      link.addEventListener('click', (e) => {
        const targetTab = link.getAttribute('data-tab-link');
        if (targetTab) {
          e.preventDefault();
          switchTab(targetTab);
          const tabEl = document.getElementById(targetTab);
          if (tabEl) {
            tabEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });

    const validTabs = ['tab-vessel', 'tab-scenarios', 'tab-sizing', 'tab-hydraulics', 'tab-pump', 'tab-ipds', 'tab-register'];
    const handleHashNavigation = () => {
      const hash = (window.location.hash || '').replace(/^#/, '');
      if (validTabs.includes(hash)) {
        switchTab(hash);
      }
    };
    window.addEventListener('hashchange', handleHashNavigation);
    handleHashNavigation();

    // Unit System Toggle (SI <-> USC)
    document.querySelectorAll('.unit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetUnit = btn.dataset.unit;
        if (targetUnit !== state.unitSystem) {
          state.unitSystem = targetUnit;
          document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === targetUnit));
          syncTagToDomInputs();
          syncPumpToDomInputs();
          syncVesselToDomInputs();
          syncPidSystemToDomInputs();
          recomputeAll();
          if (window.PSVTools) window.PSVTools.notifyUnitChange();
        }
      });
    });

    // P&ID System Boundary Preset Selector
    const pidPresetSel = document.getElementById('pidSystemPresetSelect');
    if (pidPresetSel) {
      pidPresetSel.addEventListener('change', (e) => {
        const preset = (E.PID_SYSTEM_PRESETS || []).find(p => p.id === e.target.value);
        if (preset) {
          state.pidSystem = JSON.parse(JSON.stringify(preset));
          state.pidAiAnalysis = null;
          const banner = document.getElementById('pidAiAnalysisBanner');
          if (banner) banner.style.display = 'none';
          syncPidSystemToDomInputs(true);
          renderPidScenarioIdentifier();
        }
      });
    }

    // P&ID Boundary Reactive Inputs
    const pidReactiveIds = [
      'pidInpMawp', 'pidInpUpSourcePress', 'pidInpUpInflow', 'pidInpOutletBlock',
      'pidInpCvUpPress', 'pidInpCvRated', 'pidInpReboilerDuty', 'pidInpReboilerSurge',
      'pidInpExchHpPress', 'pidInpFireZone', 'inpPidNotesText'
    ];
    pidReactiveIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const handler = () => {
          readDomInputsToPidSystem();
          renderPidScenarioIdentifier();
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
      }
    });

    // 1-Click Sync P&ID & Governing Scenario -> Step 1 & Step 2
    const btnSyncPid = document.getElementById('btnSyncPidToWorkbench');
    if (btnSyncPid) {
      btnSyncPid.addEventListener('click', () => {
        syncPidResultsToWorkbench(null, true);
      });
    }

    // Download Sample P&ID JSON Template
    const btnSamplePidJson = document.getElementById('btnDownloadSamplePidJson');
    if (btnSamplePidJson) {
      btnSamplePidJson.addEventListener('click', () => {
        readDomInputsToPidSystem();
        const sampleObj = {
          schema: 'psvcalc_pid_boundary_v1',
          pidNumber: state.pidSystem.pidNumber || 'PID-1014-REV4',
          equipmentTag: state.pidSystem.equipmentTag || 'V-1001',
          equipmentService: state.pidSystem.equipmentService || 'HP Production Separator',
          psvTag: state.pidSystem.psvTag || state.tag.tagNumber,
          protectedEquipment: {
            mawpBarg: state.pidSystem.mawpBarg,
            operatingPressureBarg: state.pidSystem.operatingPressureBarg,
            setPressureBarg: state.pidSystem.mawpBarg,
            inFireZone: state.pidSystem.inFireZone !== false,
            diameterM: state.pidSystem.fireDiameterM || 2.4,
            lengthM: state.pidSystem.fireLengthM || 7.5,
            nllM: state.pidSystem.fireNllM || 1.4
          },
          upstreamPressureSources: {
            upstreamSourceDesc: state.pidSystem.upstreamSourceDesc || 'Wellhead Manifold / Feed Pump',
            upstreamMaxSourceBarg: state.pidSystem.upstreamMaxSourceBarg,
            maxSourceInflowKgHr: state.pidSystem.maxSourceInflowKgHr,
            hasOutletBlockValve: state.pidSystem.hasOutletBlockValve
          },
          controlValves: {
            hasUpstreamControlValve: state.pidSystem.hasUpstreamControlValve,
            cvTag: state.pidSystem.cvTag || 'PCV-1001',
            cvUpstreamPressBarg: state.pidSystem.cvUpstreamPressBarg,
            cvRatedMaxCv: state.pidSystem.cvRatedMaxCv,
            cvBypassCv: state.pidSystem.cvBypassCv || 0,
            cvNormalFlowCreditKgHr: state.pidSystem.cvNormalFlowCreditKgHr || 0,
            cvFluidPhase: state.pidSystem.cvFluidPhase || 'gas'
          },
          heatInputsAndExchangers: {
            hasReboilerOrHeater: state.pidSystem.hasReboilerOrHeater,
            reboilerSourceType: state.pidSystem.reboilerSourceType || 'steam_reboiler',
            reboilerNormalDutyKw: state.pidSystem.reboilerNormalDutyKw || 0,
            reboilerSurgeFactor: state.pidSystem.reboilerSurgeFactor || 1.5,
            condenserCreditKw: state.pidSystem.condenserCreditKw || 0,
            latentHeatKjKg: state.pidSystem.latentHeatKjKg || 320,
            hasHeatExchanger: state.pidSystem.hasHeatExchanger,
            exchangerHpBarg: state.pidSystem.exchangerHpBarg || 0,
            exchangerTubeIdMm: state.pidSystem.exchangerTubeIdMm || 15.7
          },
          pidSummaryNotes: document.getElementById('inpPidNotesText') ? document.getElementById('inpPidNotesText').value : state.pidSystem.pidSummaryNotes
        };
        const blob = new Blob([JSON.stringify(sampleObj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(state.pidSystem.pidNumber || 'PID_Boundary').replace(/[^A-Za-z0-9_-]/g, '_')}_Spec.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Downloaded sample P&ID JSON reference file.', 'ok');
      });
    }

    // Upload P&ID Reference File (.pdf, .json, .png, .jpg, .webp, .txt)
    const inpPidFile = document.getElementById('inpPidRefFile');
    if (inpPidFile) {
      inpPidFile.addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        const statusEl = document.getElementById('pidFileUploadStatus');
        const fname = file.name || 'reference';
        const lower = fname.toLowerCase();

        if (lower.endsWith('.json')) {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const obj = JSON.parse(String(reader.result || '{}'));
              applyUploadedPidJson(obj, fname);
              if (statusEl) {
                statusEl.textContent = `✓ Loaded JSON P&ID: ${fname}`;
                statusEl.style.color = 'var(--pass-text)';
              }
              showToast(`Loaded P&ID JSON specification "${fname}".`, 'ok');
            } catch (err) {
              if (statusEl) {
                statusEl.textContent = `✕ Invalid JSON: ${err.message}`;
                statusEl.style.color = 'var(--fail-text)';
              }
              showToast(`Invalid P&ID JSON file: ${err.message}`, 'error');
            }
          };
          reader.readAsText(file);
        } else if (lower.endsWith('.txt')) {
          const reader = new FileReader();
          reader.onload = () => {
            const txt = String(reader.result || '').slice(0, 12000);
            const notesEl = document.getElementById('inpPidNotesText');
            if (notesEl) notesEl.value = txt;
            state.pidAttachment = { name: fname, mimeType: 'text/plain', base64Data: '', extractedText: txt };
            parseTextHintsIntoPidSystem(txt);
            if (statusEl) {
              statusEl.textContent = `✓ Loaded P&ID Notes: ${fname}`;
              statusEl.style.color = 'var(--pass-text)';
            }
            showToast(`Loaded P&ID text notes from "${fname}".`, 'ok');
          };
          reader.readAsText(file);
        } else {
          // PDF or Image P&ID drawing: read as DataURL for Gemini multimodal inlineData + extract printable text from PDF
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result || '');
            const commaIdx = dataUrl.indexOf(',');
            const base64Data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
            const mimeType = file.type || (lower.endsWith('.pdf') ? 'application/pdf' : 'image/png');
            let extractedText = '';
            if (lower.endsWith('.pdf') && base64Data) {
              extractedText = extractPrintableTextFromPdfBase64(base64Data);
            }
            state.pidAttachment = {
              name: fname,
              mimeType,
              base64Data,
              sizeBytes: file.size,
              extractedText
            };
            if (extractedText && document.getElementById('inpPidNotesText')) {
              const notesEl = document.getElementById('inpPidNotesText');
              notesEl.value = `[Extracted from ${fname}]: ${extractedText.slice(0, 1500)}`;
              parseTextHintsIntoPidSystem(extractedText);
            }
            if (statusEl) {
              statusEl.textContent = `✓ Attached P&ID (${(file.size / 1024).toFixed(1)} KB): ${fname} — Ready for Gemini`;
              statusEl.style.color = 'var(--pass-text)';
            }
            showToast(`Attached P&ID reference "${fname}". Click "Analyze P&ID with Gemini" to run AI scenario identification.`, 'ok');
          };
          reader.readAsDataURL(file);
        }
      });
    }

    // Analyze P&ID with Gemini (API 521 §4 Overpressure Scenario Identification)
    const btnAnalyzePid = document.getElementById('btnAnalyzePidGemini');
    if (btnAnalyzePid) {
      btnAnalyzePid.addEventListener('click', () => {
        analyzePidWithGemini();
      });
    }

    // Vessel Sizing Preset Loader
    const vesselPresetSel = document.getElementById('vesselPresetSelect');
    if (vesselPresetSel) {
      vesselPresetSel.addEventListener('change', (e) => {
        const preset = E.VESSEL_SIZING_PRESETS.find(v => v.id === e.target.value);
        if (preset) {
          state.vessel = JSON.parse(JSON.stringify(preset));
          syncVesselToDomInputs();
          recomputeAll();
        }
      });
    }

    // Vessel Service Type auto-orientation helper
    const vesselTypeSel = document.getElementById('inpVesselServiceType');
    if (vesselTypeSel) {
      vesselTypeSel.addEventListener('change', () => {
        const stype = vesselTypeSel.value;
        const orientEl = document.getElementById('inpVesselOrientation');
        if (orientEl) {
          if (stype === 'vertical_ko') orientEl.value = 'vertical';
          else orientEl.value = 'horizontal';
        }
        readDomInputsToVessel();
        syncVesselToDomInputs();
        recomputeAll();
      });
    }

    // Vessel Sizing Reactive Inputs
    const vesselReactiveIds = [
      'inpVesselTag', 'inpVesselService', 'inpVesselOrientation',
      'inpVesselInternals', 'inpVesselInletDevice', 'inpVesselOpPress',
      'inpVesselDesPress', 'inpVesselVapFlow', 'inpVesselVapRho',
      'inpVesselLiqFlow', 'inpVesselLiqRho', 'inpVesselWaterFlow',
      'inpVesselLatent', 'inpVesselHoldupMin', 'inpVesselSurgeMin',
      'inpVesselTargetLd', 'inpVesselElevGrade', 'inpVesselMaterial',
      'inpVesselHeadType', 'inpVesselJointEff', 'inpVesselCorrosionMm'
    ];
    vesselReactiveIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          readDomInputsToVessel();
          recomputeAll();
        });
        el.addEventListener('change', () => {
          readDomInputsToVessel();
          recomputeAll();
        });
      }
    });

    // 1-Click Coupling: Send Sized Vessel -> Step 1 API 521 Fire & Step 2 PSV Sizing
    const btnSendVesselPsv = document.getElementById('btnSendVesselToPsv');
    if (btnSendVesselPsv) {
      btnSendVesselPsv.addEventListener('click', () => {
        readDomInputsToVessel();
        const vesselRes = E.calcVesselSizingFromScratch({
          ...state.vessel,
          atmPressureBara: state.tag.atmPressureBara || 1.01325
        });
        const g = vesselRes.geometry;
        const f = vesselRes.firePreview;

        state.tag.equipmentProtected = `${vesselRes.vesselTag} (${vesselRes.service})`;
        state.tag.operatingPressureBarg = Number(vesselRes.operatingPressureBarg.toFixed(2));
        state.tag.setPressureBarg = Number(vesselRes.designPressureBarg.toFixed(2));
        state.tag.mawpBarg = state.tag.setPressureBarg;
        state.tag.fluidPhase = 'gas';
        state.tag.rhoLiqKgM3 = Number(vesselRes.flows.rhoL.toFixed(1));
        state.tag.flowRateKgHr = Math.max(10, Math.round(f.reliefRateKgHr));
        state.tag.overpressurePct = 21.0;
        state.tag.governingScenarioKey = 'fire_liquid';
        state.activeScenarioKey = 'fire_liquid';

        // Populate Step 1 External Fire (Liquid-Wetted) & Unwetted Gas Exposure from sized vessel
        state.tag.scenarios.fireLiquid.orientation = vesselRes.orientation;
        state.tag.scenarios.fireLiquid.headType = vesselRes.headType === 'hemispherical' ? 'hemispherical' : 'ellipsoidal';
        state.tag.scenarios.fireLiquid.diameterM = Number(g.diameterM.toFixed(2));
        state.tag.scenarios.fireLiquid.lengthM = Number(g.lengthM.toFixed(2));
        state.tag.scenarios.fireLiquid.nllM = Number(g.levels.nllM.toFixed(2));
        state.tag.scenarios.fireLiquid.elevAboveGradeM = Number(g.elevAboveGradeM.toFixed(2));
        state.tag.scenarios.fireLiquid.latentHeatKjKg = Number(vesselRes.flows.latentHeatKjKg.toFixed(1));
        state.tag.scenarios.fireGas.exposedAreaM2 = Number(f.totalAreaM2.toFixed(1));

        document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.scenario === 'fire_liquid');
        });
        syncTagToDomInputs();
        renderScenarioForm();
        recomputeAll();
        switchTab('tab-scenarios');
      });
    }

    // 1-Click Coupling: Send Sized Vessel -> Step 4 Pump Suction Hydraulics
    const btnSendVesselPump = document.getElementById('btnSendVesselToPump');
    if (btnSendVesselPump) {
      btnSendVesselPump.addEventListener('click', () => {
        readDomInputsToVessel();
        const vesselRes = E.calcVesselSizingFromScratch({
          ...state.vessel,
          atmPressureBara: state.tag.atmPressureBara || 1.01325
        });
        state.pumpLoop.service = `${vesselRes.vesselTag} Bottoms Pump (${vesselRes.service})`;
        state.pumpLoop.normalFlowM3Hr = Number(Math.max(5, vesselRes.flows.Q_liqM3Hr).toFixed(1));
        state.pumpLoop.rhoKgM3 = Number(vesselRes.flows.rhoL.toFixed(1));
        state.pumpLoop.tempC = Number(vesselRes.operatingTempC.toFixed(1));
        state.pumpLoop.suctionVesselBarg = Number(vesselRes.operatingPressureBarg.toFixed(2));
        state.pumpLoop.suctionStaticHeadM = Number((vesselRes.geometry.elevAboveGradeM + vesselRes.geometry.levels.nllM).toFixed(2));
        if (vesselRes.nozzles && vesselRes.nozzles.liquidOutlet && vesselRes.nozzles.liquidOutlet.nps) {
          state.pumpLoop.suctionNps = vesselRes.nozzles.liquidOutlet.nps;
        }

        syncPumpToDomInputs();
        recomputeAll();
        switchTab('tab-pump');
      });
    }

    // Preset EPC Tag Loader
    document.getElementById('presetTagSelect').addEventListener('change', (e) => {
      const preset = E.EPC_TAG_PRESETS.find(p => p.id === e.target.value);
      if (preset) {
        state.tag = JSON.parse(JSON.stringify(preset));
        state.activeScenarioKey = preset.governingScenarioKey || 'fire_liquid';
        document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.scenario === state.activeScenarioKey);
        });
        syncTagToDomInputs();
        renderScenarioForm();
        recomputeAll();
      }
    });

    // Pump Loop Preset Loader
    const pumpPresetSel = document.getElementById('pumpPresetSelect');
    if (pumpPresetSel) {
      pumpPresetSel.addEventListener('change', (e) => {
        const preset = E.PUMP_LOOP_PRESETS.find(p => p.id === e.target.value);
        if (preset) {
          state.pumpLoop = JSON.parse(JSON.stringify(preset));
          syncPumpToDomInputs();
          recomputeAll();
        }
      });
    }

    // Pump Loop Reactive Inputs
    const pumpReactiveIds = [
      'inpPumpTag', 'inpPumpService', 'inpPumpNormFlow', 'inpPumpRatedMargin',
      'inpPumpRho', 'inpPumpVisc', 'inpPumpVaporPress', 'inpPumpTemp',
      'inpPumpSucPress', 'inpPumpSucHead', 'inpPumpSucNps', 'inpPumpSucLength',
      'inpPumpSucK', 'inpPumpNpshr', 'inpPumpDestPress', 'inpPumpDisHead',
      'inpPumpDisNps', 'inpPumpDisLength', 'inpPumpDisK', 'inpPumpEquipDp',
      'inpPumpCvMinDp', 'inpPumpCvMax', 'inpPumpEff', 'inpPumpShutoffRise'
    ];
    pumpReactiveIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          readDomInputsToPump();
          recomputeAll();
        });
        el.addEventListener('change', () => {
          readDomInputsToPump();
          recomputeAll();
        });
      }
    });

    // Send Pump Rated Flow & Shutoff Pressure to PSV Blocked-Outlet Sizing
    const btnSendPump = document.getElementById('btnSendPumpToPsv');
    if (btnSendPump) {
      btnSendPump.addEventListener('click', () => {
        readDomInputsToPump();
        const pumpRes = E.calcPumpLoopHydraulics({
          ...state.pumpLoop,
          atmPressureBara: state.tag.atmPressureBara || 1.01325
        });
        state.tag.fluidPhase = 'liquid';
        state.tag.rhoLiqKgM3 = Number(pumpRes.rhoKgM3.toFixed(1));
        state.tag.viscCp = Number(pumpRes.viscCp);
        state.tag.relievingTempC = Number(pumpRes.tempC.toFixed(1));
        state.tag.flowRateKgHr = Math.round(pumpRes.W_ratedKgHr);
        state.tag.operatingPressureBarg = Number(pumpRes.discharge.nozzleBarg.toFixed(2));
        state.tag.setPressureBarg = Number(pumpRes.pump.maxDischargeBarg.toFixed(2));
        state.tag.mawpBarg = state.tag.setPressureBarg;
        state.tag.overpressurePct = 10.0;
        state.tag.governingScenarioKey = 'blocked_outlet';
        state.tag.scenarios.blockedOutlet.sourceType = 'pump_compressor';
        state.tag.scenarios.blockedOutlet.maxInflowKgHr = Math.round(pumpRes.W_ratedKgHr);
        state.tag.scenarios.blockedOutlet.creditedOutflowKgHr = 0;

        syncTagToDomInputs();
        renderScenarioForm();
        recomputeAll();
        switchTab('tab-sizing');
      });
    }

    // IPDS Datasheet Mode Toggle (PSV vs Centrifugal Pump)
    document.querySelectorAll('#ipdsModeSelectorGroup .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.ipdsMode = btn.dataset.ipdsMode;
        document.querySelectorAll('#ipdsModeSelectorGroup .seg-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.ipdsMode === state.ipdsMode);
        });
        recomputeAll();
      });
    });

    // Scenario Selector buttons in Step 1
    document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeScenarioKey = btn.dataset.scenario;
        document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.scenario === state.activeScenarioKey);
        });
        renderScenarioForm();
        recomputeAll();
      });
    });

    // Apply Active or Governing Scenario to Step 2
    document.getElementById('btnApplyActiveScenario').addEventListener('click', () => {
      const bundle = evaluateAllScenariosForTag(state.tag);
      applyScenarioToStep2(bundle.map[state.activeScenarioKey]);
    });
    document.getElementById('btnApplyGoverningScenario').addEventListener('click', () => {
      const bundle = evaluateAllScenariosForTag(state.tag);
      applyScenarioToStep2(bundle.governing);
    });

    // Fluid Phase segmented buttons
    document.querySelectorAll('#phaseSelectorGroup .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tag.fluidPhase = btn.dataset.phase;
        syncTagToDomInputs();
        recomputeAll();
      });
    });

    // Fluid Preset Dropdown
    document.getElementById('fluidPresetSelect').addEventListener('change', (e) => {
      const key = e.target.value;
      state.tag.fluidPresetKey = key;
      const fp = E.FLUID_PRESETS[key];
      if (fp) {
        state.tag.fluidPhase = fp.phase;
        state.tag.mw = fp.mw;
        state.tag.k = fp.k;
        state.tag.z = fp.z;
        state.tag.rhoLiqKgM3 = fp.rhoLiq;
        state.tag.viscCp = fp.viscCp;
        state.tag.scenarios.fireLiquid.latentHeatKjKg = fp.latentHeat;
        state.tag.scenarios.thermalExpansion.cpLiqKjKgK = fp.cpLiq;
        state.tag.scenarios.thermalExpansion.alphaVPerC = fp.alphaV;
        syncTagToDomInputs();
        renderScenarioForm();
        recomputeAll();
      }
    });

    // Valve Type segmented buttons
    document.querySelectorAll('#valveTypeGroup .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tag.valveType = btn.dataset.vtype;
        syncTagToDomInputs();
        recomputeAll();
      });
    });

    // Auto vs Manual Kb toggle
    document.getElementById('inpAutoKb').addEventListener('change', (e) => {
      state.autoKb = e.target.value === 'true';
      state.tag.autoKb = state.autoKb;
      document.getElementById('fgManualKb').style.display = state.autoKb ? 'none' : '';
      recomputeAll();
    });

    // All Step 2 & Step 3 & Context inputs
    const reactiveIds = [
      'ctxTagNumber', 'ctxService', 'ctxEquipment', 'ctxProject', 'ctxClient', 'ctxPid',
      'inpMw', 'inpK', 'inpZ', 'inpRhoLiq', 'inpVisc', 'inpSteamSh', 'inpOmega',
      'inpFlowRate', 'inpRelievingTemp', 'inpOpPressure', 'inpSetPressure',
      'inpOverpressurePct', 'inpAtmPressure', 'inpSuperBack', 'inpBuiltUpBack',
      'inpRuptureDisc', 'inpManualKb', 'inpHydFlowBasis',
      'inpInletNps', 'inpInletSch', 'inpInletLength', 'inpInletFittingsK',
      'inpOutletNps', 'inpOutletSch', 'inpOutletLength', 'inpOutletFittingsK'
    ];
    reactiveIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          readDomInputsToTag();
          recomputeAll();
        });
        el.addEventListener('change', () => {
          readDomInputsToTag();
          recomputeAll();
        });
      }
    });

    // Quick Inlet Fittings K-factor preset buttons
    document.querySelectorAll('.btn-inlet-k').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('inpInletFittingsK').value = btn.dataset.k;
        readDomInputsToTag();
        recomputeAll();
      });
    });

    // Select Optimal Compliant Inlet NPS button
    document.getElementById('btnAutoSelectInletNps').addEventListener('click', () => {
      const { hyd } = computeForTag(state.tag);
      document.getElementById('inpInletNps').value = hyd.inlet.recommendedNps;
      readDomInputsToTag();
      recomputeAll();
    });

    // Sync Built-Up Backpressure from Step 3 to Step 2
    document.getElementById('btnSyncBuiltUpToSizing').addEventListener('click', () => {
      const { hyd } = computeForTag(state.tag);
      state.tag.builtUpBackBarg = Number(hyd.outlet.builtUpBackBarg.toFixed(3));
      syncTagToDomInputs();
      recomputeAll();
    });

    // Save Current Tag to Register
    document.getElementById('btnSaveTagToRegister').addEventListener('click', () => {
      readDomInputsToTag();
      const copy = JSON.parse(JSON.stringify(state.tag));
      const existingIdx = state.register.findIndex(r => r.tagNumber === copy.tagNumber);
      if (existingIdx >= 0) {
        state.register[existingIdx] = copy;
      } else {
        state.register.push(copy);
      }
      saveRegisterToStorage();
      renderProjectRegisterTable();
      const btn = document.getElementById('btnSaveTagToRegister');
      const orig = btn.innerHTML;
      btn.innerHTML = '<span>✓ Saved to Register</span>';
      setTimeout(() => { btn.innerHTML = orig; }, 1400);
    });

    // Print / PDF IPDS Datasheet
    const triggerPrint = () => {
      endReportPrint(); // IPDS print must never show the calculation report
      switchTab('tab-ipds');
      setTimeout(() => window.print(), 150);
    };
    document.getElementById('btnPrintDatasheet').addEventListener('click', triggerPrint);
    document.getElementById('btnPrintIpdsView').addEventListener('click', triggerPrint);

    // Export Current Tag Datasheet CSV
    document.getElementById('btnExportCurrentCsv').addEventListener('click', () => {
      if (state.ipdsMode === 'vessel') {
        const v = state.vessel;
        const vr = E.calcVesselSizingFromScratch({ ...v, atmPressureBara: state.tag.atmPressureBara || 1.01325 });
        const rows = [
          ['PARAMETER', 'VALUE', 'UNITS / NOTES'],
          ['Vessel Tag Number', vr.vesselTag, v.project || state.tag.projectTitle],
          ['Service Description', vr.service, `${vr.vesselServiceType} (${vr.orientation})`],
          ['Operating / Design Pressure', `${vr.operatingPressureBarg.toFixed(2)} / ${vr.designPressureBarg.toFixed(2)}`, 'barg'],
          ['Vapor / Liquid Mass Flow', `${vr.flows.W_vapKgHr.toFixed(0)} / ${vr.flows.W_liqKgHr.toFixed(0)}`, 'kg/h'],
          ['Selected Vessel ID x T/T Length', `${vr.geometry.diameterMm} x ${vr.geometry.lengthMm}`, `mm (L/D = ${vr.geometry.ldRatio.toFixed(2)}, V_tot = ${vr.geometry.totalVolumeM3.toFixed(2)} m3)`],
          ['Souders-Brown K_SB & Vapor Velocity', `${vr.separation.effectiveKsbMS.toFixed(3)} / ${vr.separation.actualVaporVelMS.toFixed(2)}`, `m/s (v_max = ${vr.separation.governingSettlingVelMS.toFixed(2)} m/s)`],
          ['Liquid Levels (LLL / NLL / HLL / HHLL)', `${vr.geometry.levels.lllM.toFixed(2)} / ${vr.geometry.levels.nllM.toFixed(2)} / ${vr.geometry.levels.hllM.toFixed(2)} / ${vr.geometry.levels.hhllM.toFixed(2)}`, 'm'],
          ['ASME VIII Shell & Head Nominal Thickness', `${vr.mechanical.tShellSelectedMm} / ${vr.mechanical.tHeadSelectedMm}`, `mm (${vr.mechanical.materialName}, CA = ${vr.mechanical.corrosionAllowanceMm} mm)`],
          ['Corroded MAWP & Empty/Oper/Hydro Weights', `${vr.mechanical.mawpCorrodedBarg.toFixed(2)} barg`, `${(vr.mechanical.emptyWeightKg / 1000).toFixed(1)}t / ${(vr.mechanical.operatingWeightKg / 1000).toFixed(1)}t / ${(vr.mechanical.hydrotestWeightKg / 1000).toFixed(1)}t`],
          ['API 521 Wetted Area & Pool Fire Load', `${vr.firePreview.wettedAreaM2.toFixed(2)} m2`, `Q = ${vr.firePreview.heatAbsorptionKw.toFixed(1)} kW -> W_fire = ${vr.firePreview.reliefRateKgHr.toFixed(0)} kg/h`]
        ];
        exportCsvFile(`${escapeHtml(vr.vesselTag)}_Vessel_IPDS_Calculation.csv`, rows);
        return;
      }

      if (state.ipdsMode === 'pump') {
        const p = state.pumpLoop;
        const pr = E.calcPumpLoopHydraulics({ ...p, atmPressureBara: state.tag.atmPressureBara || 1.01325 });
        const rows = [
          ['PARAMETER', 'VALUE', 'UNITS / NOTES'],
          ['Pump Tag Number', p.pumpTag, p.project || state.tag.projectTitle],
          ['Service Description', p.service, p.FluidName || 'Process Liquid'],
          ['Liquid Density / Viscosity', pr.rhoKgM3.toFixed(1), `kg/m3 (SG=${pr.SG.toFixed(3)}), mu=${pr.viscCp} cP`],
          ['Normal / Rated Flow', `${pr.Q_normM3Hr.toFixed(1)} / ${pr.Q_ratedM3Hr.toFixed(1)}`, `m3/h (${pr.W_ratedKgHr.toFixed(0)} kg/h)`],
          ['Suction Nozzle Pressure', pr.suction.nozzleBarg.toFixed(2), `barg (Line: ${pr.suction.nps} ${pr.suction.schedule}, v=${pr.suction.velocityMS.toFixed(2)} m/s)`],
          ['Discharge Nozzle Pressure', pr.discharge.nozzleBarg.toFixed(2), `barg (Line: ${pr.discharge.nps} ${pr.discharge.schedule}, v=${pr.discharge.velocityMS.toFixed(2)} m/s)`],
          ['Total Differential Head (TDH)', pr.pump.tdhRatedM.toFixed(2), `m (${pr.pump.tdhRatedFt.toFixed(1)} ft) | dP = ${pr.pump.diffPressureRatedBar.toFixed(2)} bar`],
          ['Shutoff Head & Max Discharge Pressure', pr.pump.maxDischargeBarg.toFixed(2), `barg (Shutoff Head = ${pr.pump.shutoffHeadM.toFixed(1)} m)`],
          ['NPSHa vs NPSHr (API 610)', `${pr.npsh.npshaM.toFixed(2)} vs ${pr.npsh.npshrM.toFixed(2)}`, `m (Margin = ${pr.npsh.marginM.toFixed(2)} m — ${pr.npsh.compliant ? 'PASS' : 'FAIL'})`],
          ['Control Valve Allocated dP & Cv', pr.controlValve.allocatedDpRatedBar.toFixed(2), `bar (${pr.controlValve.pctOfDynamic.toFixed(1)}% Dyn) | Cv Min/Norm/Rated = ${pr.controlValve.min.reqCv.toFixed(1)} / ${pr.controlValve.normal.reqCv.toFixed(1)} / ${pr.controlValve.rated.reqCv.toFixed(1)}`],
          ['Hydraulic / Shaft / API 610 Motor Power', `${pr.pump.hydraulicPowerKw.toFixed(1)} / ${pr.pump.brakePowerKw.toFixed(1)} / ${pr.pump.selectedMotorKw}`, `kW (Pump Eff = ${pr.pump.pumpEfficiencyPct}%)`]
        ];
        exportCsvFile(`${escapeHtml(p.pumpTag)}_Pump_IPDS_Calculation.csv`, rows);
        return;
      }

      const t = state.tag;
      const { sizing: s, hyd: h } = computeForTag(t);
      const rows = [
        ['PARAMETER', 'VALUE', 'UNITS / NOTES'],
        ['PSV Tag Number', t.tagNumber, t.pidNumber],
        ['Service Description', t.service, t.equipmentProtected],
        ['Project / Client', t.projectTitle, t.clientName],
        ['Fluid Phase', t.fluidPhase.toUpperCase(), `MW=${t.mw}, k=${t.k}, Z=${t.z}, rho=${t.rhoLiqKgM3} kg/m3`],
        ['Required Relief Rate (W)', t.flowRateKgHr.toFixed(1), 'kg/h'],
        ['Set Pressure (P_set)', t.setPressureBarg.toFixed(2), 'barg'],
        ['Allowed Overpressure', t.overpressurePct.toFixed(1), '%'],
        ['Relieving Pressure (P1)', s.P1_bara.toFixed(3), 'bara'],
        ['Total Backpressure (P2)', s.P_backBarg.toFixed(2), 'barg'],
        ['Flow Regime', s.flowRegime, `P_cf = ${s.Pcf_bara.toFixed(3)} bara`],
        ['Required Orifice Area (A_req)', s.reqAreaMm2.toFixed(1), `mm2 (${s.reqAreaIn2.toFixed(4)} in2)`],
        ['Selected API 526 Orifice', s.selectedOrifice.letter, `${s.selectedOrifice.areaMm2} mm2 (${s.selectedOrifice.inletOutFlange})`],
        ['Valve Rated Capacity (W_rated)', s.ratedCapacityKgHr.toFixed(1), 'kg/h'],
        ['Inlet Line Size & Loss', `${h.inlet.nps} ${h.inlet.schedule}`, `dP = ${h.inlet.lossPctOfSet.toFixed(2)}% of P_set (Limit <= 3%)`],
        ['Outlet Line Size & Backpressure', `${h.outlet.nps} ${h.outlet.schedule}`, `P_bt = ${h.outlet.totalBackPctOfSet.toFixed(1)}% of P_set, Mach = ${h.outlet.machNumber.toFixed(2)}`],
        ['Discharge Reaction Force (Fr)', h.outlet.reactionForceKn.toFixed(2), `kN (${Math.round(h.outlet.reactionForceLbf)} lbf)`]
      ];
      exportCsvFile(`${escapeHtml(t.tagNumber)}_IPDS_Calculation.csv`, rows);
    });

    // Register Actions (Restore Presets, Export CSV, Export/Import JSON)
    document.getElementById('btnResetDefaultPresets').addEventListener('click', () => {
      state.register = JSON.parse(JSON.stringify(E.EPC_TAG_PRESETS));
      saveRegisterToStorage();
      renderProjectRegisterTable();
    });

    document.getElementById('btnExportRegisterCsv').addEventListener('click', () => {
      const header = [
        'Tag Number', 'Service', 'Protected Equipment', 'P&ID', 'Phase', 'Governing Scenario',
        'Set Pressure (barg)', 'Overpressure (%)', 'Relief Rate (kg/h)', 'Req Area (mm2)', 'Req Area (in2)',
        'API 526 Orifice', 'Flange Size', 'Inlet NPS', 'Inlet dP (%)', 'Outlet NPS', 'Total Backpressure (%)', 'Outlet Mach'
      ];
      const rows = [header];
      state.register.forEach(item => {
        const { sizing: s, hyd: h } = computeForTag(item);
        rows.push([
          item.tagNumber, item.service, item.equipmentProtected, item.pidNumber,
          item.fluidPhase, item.governingScenarioKey,
          item.setPressureBarg.toFixed(2), item.overpressurePct.toFixed(0),
          item.flowRateKgHr.toFixed(0), s.reqAreaMm2.toFixed(1), s.reqAreaIn2.toFixed(4),
          s.selectedOrifice.letter, s.selectedOrifice.inletOutFlange,
          item.inletNps, h.inlet.lossPctOfSet.toFixed(2),
          item.outletNps, h.outlet.totalBackPctOfSet.toFixed(1), h.outlet.machNumber.toFixed(2)
        ]);
      });
      exportCsvFile('PSV_Project_Tag_Register.csv', rows);
    });

    document.getElementById('btnExportRegisterJson').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.register, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'psvcalc_project_register.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    document.getElementById('inpImportRegisterJson').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        // Accepts legacy register-only arrays AND schemaVersion 2 project files.
        const res = importJsonText(ev.target.result);
        if (!res.ok) showToast(res.error, 'error');
        else showToast(res.message, 'ok');
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    // Dark/Light Theme Toggle
    document.getElementById('btnThemeToggle').addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      document.getElementById('themeToggleLabel').textContent = next === 'dark' ? 'Light Mode' : 'Dark Mode';
    });

    initAskPsvCopilot();

    // Bridge for Step 7 Engineering Toolkit plug-ins (tools/*.js)
    window.PSVApp = {
      getUnitSystem: () => state.unitSystem,
      getTag: () => JSON.parse(JSON.stringify(state.tag)),
      getRegister: () => JSON.parse(JSON.stringify(state.register)),
      getVesselResult: () => E.calcVesselSizingFromScratch({ ...state.vessel, atmPressureBara: state.tag.atmPressureBara || 1.01325 }),
      getPumpResult: () => E.calcPumpLoopHydraulics({ ...state.pumpLoop, atmPressureBara: state.tag.atmPressureBara || 1.01325 }),
      applyTagPatch: (patch, goToTab) => {
        if (!patch || typeof patch !== 'object') return;
        Object.assign(state.tag, patch);
        syncTagToDomInputs();
        renderScenarioForm();
        recomputeAll();
        if (goToTab) switchTab(goToTab);
      },
      switchTab,
      onToolChanged: () => scheduleAutosave(),
      // Workflow & deliverables (B1–B5)
      buildProject: () => buildWorkspace(),
      loadProjectFromText: (text) => importJsonText(text),
      buildXlsxBytes: () => buildWorkbookBytes(),
      encodeShare: (ws) => encodeShareState(ws || buildShareWorkspace()),
      decodeShare: (hash) => decodeShareHash(hash),
      loadShareHash: (hash) => handleSharedHash(hash),
      snapshotCase: (name) => snapshotCurrentCase(name),
      getCases: () => clone(state.cases),
      selectCases: (ids) => { state.caseSel = (ids || []).filter(id => state.cases.some(c => c.id === id)).slice(0, 3); renderCasesPanel(); },
      restoreCase: (id) => restoreCase(id),
      openReportDialog: () => openReportDialog(),
      prepareReportPrint: (meta, sections) => prepareReportPrint(meta, sections),
      endReportPrint: () => endReportPrint()
    };
    initDeliverables();
    if (window.PSVTools) window.PSVTools.init();
  }

  // =========================================================================
  // 9. "ASK PSV" — API 520 / 521 / 526 / 610 GROUNDED AI COPILOT
  // =========================================================================

  const askPsvHistory = [];

  function buildAskPsvContextSnapshot(t, sizing, hyd, pumpRes) {
    const p = state.pumpLoop;
    const vRes = E.calcVesselSizingFromScratch({
      ...state.vessel,
      atmPressureBara: t.atmPressureBara || 1.01325
    });
    return {
      unitSystem: state.unitSystem,
      activeTab: state.activeTab,
      vesselSizing: {
        vesselTag: vRes.vesselTag,
        service: vRes.service,
        orientation: vRes.orientation,
        vesselServiceType: vRes.vesselServiceType,
        DiMm: vRes.geometry.diameterMm,
        LttMm: vRes.geometry.lengthMm,
        actualLdRatio: Number(vRes.geometry.ldRatio.toFixed(2)),
        NLL_m: Number(vRes.geometry.levels.nllM.toFixed(2)),
        nominalShellPlateMm: vRes.mechanical.tShellSelectedMm,
        nominalHeadPlateMm: vRes.mechanical.tHeadSelectedMm,
        corrodedMawpBarg: Number(vRes.mechanical.mawpCorrodedBarg.toFixed(2)),
        emptyWeightTonnes: Number((vRes.mechanical.emptyWeightKg / 1000).toFixed(2)),
        wettedAreaM2: Number(vRes.firePreview.wettedAreaM2.toFixed(2)),
        fireReliefRateKgHr: Number(vRes.firePreview.reliefRateKgHr.toFixed(0))
      },
      psvTag: {
        tagNumber: t.tagNumber,
        service: t.service,
        equipmentProtected: t.equipmentProtected,
        fluidPhase: t.fluidPhase,
        valveType: t.valveType,
        ruptureDisc: !!t.ruptureDisc,
        setPressureBarg: Number(t.setPressureBarg.toFixed(3)),
        overpressurePct: Number(t.overpressurePct.toFixed(1)),
        relievingPressureBara: Number(sizing.P1_bara.toFixed(3)),
        flowRateKgHr: Number(t.flowRateKgHr.toFixed(1)),
        flowRegime: sizing.flowRegime,
        reqAreaMm2: Number(sizing.reqAreaMm2.toFixed(1)),
        reqAreaIn2: Number(sizing.reqAreaIn2.toFixed(4)),
        selectedOrificeLetter: sizing.selectedOrifice.letter,
        selectedOrificeAreaMm2: sizing.selectedOrifice.areaMm2,
        flangeSize: sizing.selectedOrifice.inletOutFlange,
        ratedCapacityKgHr: Number(sizing.ratedCapacityKgHr.toFixed(1)),
        Kb: Number(sizing.Kb.toFixed(3)),
        Kc: Number(sizing.Kc.toFixed(2)),
        Kv: Number((sizing.Kv || 1).toFixed(3))
      },
      pipingHydraulics: {
        inletNps: hyd.inlet.nps,
        inletLengthM: t.inletLengthM,
        inletLossBar: Number((hyd.inlet.dP_totalBar || 0).toFixed(3)),
        inletLossPctOfSet: Number((hyd.inlet.lossPctOfSet || 0).toFixed(2)),
        passes3PctInletRule: hyd.inlet.passes3Pct,
        recommendedInletNps: hyd.inlet.recommendedNps,
        outletNps: hyd.outlet.nps,
        outletLengthM: t.outletLengthM,
        superimposedBackBarg: Number(t.superimposedBackBarg.toFixed(2)),
        builtUpBackBarg: Number(hyd.outlet.builtUpBackBarg.toFixed(3)),
        totalBackBarg: Number(hyd.outlet.totalBackBarg.toFixed(3)),
        totalBackPctOfSet: Number(hyd.outlet.totalBackPctOfSet.toFixed(1)),
        passesBackpressureLimit: hyd.outlet.passesBackpressure,
        recommendedValveType: hyd.outlet.recommendedValveType,
        outletMachNumber: Number(hyd.outlet.machNumber.toFixed(2)),
        reactionForceKn: Number(hyd.outlet.reactionForceKn.toFixed(2))
      },
      pumpLoop: {
        pumpTag: p.pumpTag,
        service: p.service,
        ratedFlowM3Hr: Number(pumpRes.Q_ratedM3Hr.toFixed(1)),
        tdhRatedM: Number(pumpRes.pump.tdhRatedM.toFixed(2)),
        shutoffDischargeBarg: Number(pumpRes.pump.maxDischargeBarg.toFixed(2)),
        npshaM: Number(pumpRes.npsh.npshaM.toFixed(2)),
        npshrM: Number(pumpRes.npsh.npshrM.toFixed(2)),
        npshMarginM: Number(pumpRes.npsh.marginM.toFixed(2)),
        npshCompliant: pumpRes.npsh.compliant,
        suctionNps: pumpRes.suction.nps,
        suctionVelocityMS: Number(pumpRes.suction.velocityMS.toFixed(2)),
        dischargeNps: pumpRes.discharge.nps,
        dischargeVelocityMS: Number(pumpRes.discharge.velocityMS.toFixed(2)),
        controlValveRatedCv: Number(pumpRes.controlValve.rated.reqCv.toFixed(1)),
        selectedMotorKw: pumpRes.pump.selectedMotorKw
      }
    };
  }

  function updateAskPsvContextBar(t, sizing, hyd, pumpRes) {
    const bar = document.getElementById('askPsvContextBar');
    if (!bar) return;
    const inBadge = hyd.inlet.passes3Pct
      ? `<span class="status-badge status-pass">Inlet ${hyd.inlet.lossPctOfSet.toFixed(2)}% ≤ 3%</span>`
      : `<span class="status-badge status-fail">Inlet ${hyd.inlet.lossPctOfSet.toFixed(2)}% &gt; 3% FAIL</span>`;
    const bpBadge = hyd.outlet.passesBackpressure
      ? `<span class="status-badge status-pass">P_bt ${hyd.outlet.totalBackPctOfSet.toFixed(1)}% PASS</span>`
      : `<span class="status-badge status-warn">P_bt ${hyd.outlet.totalBackPctOfSet.toFixed(1)}% WARN</span>`;
    const npshBadge = pumpRes.npsh.compliant
      ? `<span class="status-badge status-pass">NPSHa ${pumpRes.npsh.npshaM.toFixed(1)}m PASS</span>`
      : `<span class="status-badge status-fail">NPSHa ${pumpRes.npsh.npshaM.toFixed(1)}m FAIL</span>`;

    bar.innerHTML = `
      <span><strong>Active:</strong> ${escapeHtml(t.tagNumber)} ("${sizing.selectedOrifice.letter}" · ${sizing.reqAreaMm2.toFixed(0)} mm²)</span>
      ${inBadge}
      ${bpBadge}
      ${npshBadge}
    `;
  }

  function formatBotMarkdown(rawText) {
    let cleaned = String(rawText || '')
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\\mathrm\{([^}]*)\}/g, '$1')
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
      .replace(/\$\$([^$]+)\$\$/g, '$1')
      .replace(/\$([^$\n]+)\$/g, '$1');
    let safe = escapeHtml(cleaned);
    // Convert markdown links [Label](https://...) to safe anchor tags
    safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Inline code `...`
    safe = safe.replace(/`([^`]+)`/g, '<code class="mono">$1</code>');
    // Bold **...**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    const lines = safe.split(/\r?\n/);
    const out = [];
    let inList = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[-*•]\s+/.test(trimmed)) {
        if (!inList) {
          out.push('<ul>');
          inList = true;
        }
        out.push(`<li>${trimmed.replace(/^[-*•]\s+/, '')}</li>`);
      } else {
        if (inList) {
          out.push('</ul>');
          inList = false;
        }
        if (trimmed.length > 0) {
          out.push(`<p style="margin:0 0 0.42rem 0;">${trimmed}</p>`);
        }
      }
    }
    if (inList) out.push('</ul>');
    return out.join('');
  }

  function buildSmartActionsForContext(userPrompt, ctx) {
    const actions = [];
    const q = (userPrompt || '').toLowerCase();
    const h = ctx.pipingHydraulics;
    const psv = ctx.psvTag;

    if (!h.passes3PctInletRule && h.recommendedInletNps !== h.inletNps) {
      actions.push({
        id: 'fix-inlet-nps',
        label: `⚡ Upsize Inlet to ${h.recommendedInletNps} (Fix 3% Rule)`
      });
    }
    if (!h.passesBackpressureLimit) {
      const targetType = h.totalBackPctOfSet > 50 ? 'pilot' : 'bellows';
      const targetName = targetType === 'pilot' ? 'Pilot-Operated PRV' : 'Balanced Bellows PRV';
      if (psv.valveType !== targetType) {
        actions.push({
          id: `set-valve-${targetType}`,
          label: `⚡ Switch to ${targetName}`
        });
      }
    }
    if (Math.abs((state.tag.builtUpBackBarg || 0) - h.builtUpBackBarg) > 0.05) {
      actions.push({
        id: 'sync-builtup-bp',
        label: `⚡ Sync Built-Up Backpressure (${h.builtUpBackBarg.toFixed(2)} barg) to Step 2`
      });
    }
    if (q.includes('vessel') || q.includes('drum') || q.includes('separator') || q.includes('souders') || q.includes('asme') || q.includes('ug-27') || q.includes('ug-32')) {
      actions.push({ id: 'goto-tab-vessel', label: '🛢️ Open Step 0 Vessel Sizing' });
      actions.push({ id: 'send-vessel-to-psv', label: '⚡ Send Sized Vessel to Step 1 Fire & PSV' });
    } else if (q.includes('pump') || q.includes('610') || q.includes('npsh')) {
      actions.push({ id: 'goto-tab-pump', label: '💧 Open Step 4 Pump Hydraulics' });
      actions.push({ id: 'send-pump-to-psv', label: '⚡ Couple Pump Shutoff to PSV Sizing' });
    } else if (q.includes('fire') || q.includes('521') || q.includes('scenario')) {
      actions.push({ id: 'goto-tab-scenarios', label: '📐 Open Step 1 API 521 Scenarios' });
    } else if (q.includes('inlet') || q.includes('3%') || q.includes('chatter') || q.includes('part ii')) {
      actions.push({ id: 'goto-tab-hydraulics', label: '🔧 Open Step 3 Piping Hydraulics' });
    } else {
      actions.push({ id: 'goto-tab-ipds', label: '📄 View Printable IPDS Datasheet' });
    }
    return actions.slice(0, 3);
  }

  function executeAskPsvSmartAction(actionId) {
    if (actionId === 'fix-inlet-nps') {
      document.getElementById('btnAutoSelectInletNps').click();
      switchTab('tab-hydraulics');
    } else if (actionId === 'set-valve-bellows' || actionId === 'set-valve-pilot') {
      const vType = actionId === 'set-valve-pilot' ? 'pilot' : 'bellows';
      document.querySelectorAll('#valveTypeGroup .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.valvetype === vType);
      });
      readDomInputsToTag();
      recomputeAll();
      switchTab('tab-sizing');
    } else if (actionId === 'sync-builtup-bp') {
      document.getElementById('btnSyncBuiltUpToSizing').click();
      switchTab('tab-sizing');
    } else if (actionId === 'send-pump-to-psv') {
      document.getElementById('btnSendPumpToPsv').click();
    } else if (actionId === 'send-vessel-to-psv') {
      document.getElementById('btnSendVesselToPsv').click();
    } else if (actionId.startsWith('goto-tab-')) {
      switchTab(actionId.replace('goto-', ''));
    }
  }

  function answerWithLocalStandardsRag(userMessage, ctx) {
    const q = (userMessage || '').toLowerCase();
    const psv = ctx.psvTag;
    const hyd = ctx.pipingHydraulics;
    const pmp = ctx.pumpLoop;
    const vsl = ctx.vesselSizing;

    // Strict off-topic guardrail check
    const domainKeywords = [
      'psv', 'prv', 'valve', 'api', '520', '521', '526', '610', '14e', '60534', 'iec',
      'orifice', 'pressure', 'set', 'overpressure', 'backpressure', 'bellows', 'pilot',
      'conventional', 'chatter', 'inlet', 'outlet', 'flare', 'tailpipe', 'mach', 'reaction',
      'fire', 'wetted', 'unwetted', 'pool', 'drainage', 'latent', 'vapor', 'gas', 'steam',
      'liquid', 'viscosity', 'kv', 'kb', 'kc', 'kd', 'ksh', 'kn', 'omega', 'leung', 'two-phase',
      '2-phase', 'flashing', 'rupture', 'tube', 'thermal', 'expansion', 'blocked', 'cv',
      'pump', 'npsh', 'npsha', 'npshr', 'cavitation', 'tdh', 'head', 'shutoff', 'suction',
      'discharge', 'ipds', 'datasheet', 'tag', 'audit', 'check', 'size', 'sizing', 'flow',
      'area', 'nozzle', 'flange', 'vessel', 'column', 'drum', 'separator', 'souders', 'asme',
      'ug-27', 'ug-32', 'mawp', 'holdup', 'surge', 'demister', 'choked', 'critical', 'subcritical'
    ];
    const isInDomain = domainKeywords.some(kw => q.includes(kw));
    if (!isInDomain) {
      return `I am **Ask PSV**, a specialized process engineering assistant strictly grounded in **API 520 Part I & II, API 521, API 526, API 610, API RP 14E, GPSA Ch. 7, API 12J, ASME Section VIII Div. 1, and IEC 60534**. Please ask a question related to vessel sizing, PSV sizing, overpressure scenarios, piping hydraulics, pump NPSHa, or your active calculation.`;
    }

    if (q.includes('vessel') || q.includes('souders') || q.includes('ug-27') || q.includes('ug-32') || q.includes('separator') || (q.includes('audit') && q.includes('drum'))) {
      return [
        `**Live Process & ASME Section VIII Div. 1 Vessel Audit for \`${vsl.vesselTag}\` (${vsl.service}):**`,
        `- **Process Geometry (GPSA Ch. 7 / API 12J):** \`${vsl.orientation.toUpperCase()}\` vessel sized at **\`ID = ${vsl.DiMm} mm × L_TT = ${vsl.LttMm} mm\`** (\`L/D = ${vsl.actualLdRatio}\`, Normal Liquid Level \`NLL = ${vsl.NLL_m} m\`).`,
        `- **ASME Sec. VIII Div. 1 Wall Thickness (UG-27 / UG-32):** Nominal Shell Plate = \`${vsl.nominalShellPlateMm} mm\`, Head Plate = \`${vsl.nominalHeadPlateMm} mm\`, Corroded \`MAWP = ${vsl.corrodedMawpBarg} barg\`, Empty Steel Weight = \`${vsl.emptyWeightTonnes} tonnes\`.`,
        `- **API 521 §4.4.13 Pool Fire Coupling:** Wetted surface area \`A_ws = ${vsl.wettedAreaM2} m²\` generates \`W_fire = ${vsl.fireReliefRateKgHr} kg/h\` relief load for Step 1/2 PSV sizing.`
      ].join('\n');
    }

    if (q.includes('audit') && (q.includes('pump') || q.includes('610'))) {
      return [
        `**Live API 610 / API 14E Pump Audit for \`${pmp.pumpTag}\` (${pmp.service}):**`,
        `- **Total Differential Head (TDH):** \`${pmp.tdhRatedM} m\` at rated flow \`${pmp.ratedFlowM3Hr} m³/h\` (Shutoff discharge = \`${pmp.shutoffDischargeBarg} barg\`, API 610 motor = \`${pmp.selectedMotorKw} kW\`).`,
        `- **NPSHa vs. NPSHr ([API 610](https://energy-steel.com/wp-content/uploads/2024/12/API-610.pdf)):** \`NPSHa = ${pmp.npshaM} m\` vs \`NPSHr = ${pmp.npshrM} m\` (Margin = \`+${pmp.npshMarginM} m\` — **${pmp.npshCompliant ? 'PASS' : 'FAIL — Cavitation Risk'}**).`,
        `- **Line Hydraulics (API RP 14E):** Suction \`${pmp.suctionNps}\` (\`v = ${pmp.suctionVelocityMS} m/s\`) · Discharge \`${pmp.dischargeNps}\` (\`v = ${pmp.dischargeVelocityMS} m/s\`) · Control Valve Rated \`Cv = ${pmp.controlValveRatedCv}\`.`
      ].join('\n');
    }

    if (q.includes('audit') || q.includes('active') || q.includes('my tag') || q.includes('current')) {
      return [
        `**Live API 520 / 526 / Part II Engineering Audit for \`${psv.tagNumber}\` (${psv.service}):**`,
        `- **Orifice Sizing ([API 520 Part I](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf) & API 526):** Phase = \`${psv.fluidPhase.toUpperCase()}\` (${psv.flowRegime}), Set = \`${psv.setPressureBarg} barg\` (\`P1 = ${psv.relievingPressureBara} bara\`), Relief Load = \`${psv.flowRateKgHr} kg/h\` → Required Area \`A_req = ${psv.reqAreaMm2} mm² (${psv.reqAreaIn2} in²)\` → Selected **API 526 Orifice \`${psv.selectedOrificeLetter}\`** (\`${psv.selectedOrificeAreaMm2} mm²\`, \`${psv.flangeSize}\`, Rated \`W_rated = ${psv.ratedCapacityKgHr} kg/h\`).`,
        `- **Inlet Piping 3% Rule ([API 520 Part II §7.3](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-II.pdf)):** Line \`${hyd.inletNps}\` (\`L = ${hyd.inletLengthM} m\`) gives non-recoverable loss \`ΔP_in = ${hyd.inletLossBar} bar (${hyd.inletLossPctOfSet}% of P_set)\` — **${hyd.passes3PctInletRule ? 'PASS (≤ 3.0%)' : `FAIL (> 3.0% — Upsize to ${hyd.recommendedInletNps} to prevent chatter)`}**.`,
        `- **Backpressure & Valve Selection:** Total backpressure \`P_bt = ${hyd.totalBackBarg} barg (${hyd.totalBackPctOfSet}% of P_set)\` on \`${psv.valveType.toUpperCase()}\` valve, Tailpipe Mach = \`${hyd.outletMachNumber}\`, Reaction Force = \`${hyd.reactionForceKn} kN\` — **${hyd.passesBackpressureLimit ? 'PASS' : `WARN (Recommended: ${hyd.recommendedValveType})`}**.`
      ].join('\n');
    }

    if (q.includes('3%') || q.includes('inlet') || q.includes('chatter') || q.includes('part ii')) {
      return [
        `**API 520 Part II §7.3 — The 3% Inlet Pressure Loss Rule ([API 520 Part II PDF](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-II.pdf)):**`,
        `- **Mandatory Criterion:** The total non-recoverable frictional pressure loss from the protected equipment nozzle to the PRV inlet flange must not exceed **3% of gauge set pressure** (\`ΔP_in ≤ 0.03 × P_set\`).`,
        `- **Why Evaluated at Rated Capacity (\`W_rated\`):** Once a spring-loaded PSV pops open, it flows at the **selected orifice's full rated capacity (\`W_rated\`)**, not just the required process load (\`W_req\`). If \`ΔP_in > 3%\`, static pressure under the disc drops below reseating pressure, causing violent rapid cycling (**valve chatter**) that destroys seats and flange joints.`,
        `- **Your Active Tag (\`${psv.tagNumber}\`):** Inlet \`${hyd.inletNps}\` loss is \`${hyd.inletLossPctOfSet}%\` of \`${psv.setPressureBarg} barg\` at \`W_rated = ${psv.ratedCapacityKgHr} kg/h\` (${hyd.passes3PctInletRule ? 'PASS' : `Recommend upsizing to ${hyd.recommendedInletNps}`}).`
      ].join('\n');
    }

    if (q.includes('bellows') || q.includes('pilot') || q.includes('conventional') || q.includes('backpressure') || q.includes('kb')) {
      return [
        `**PRV Type Selection & Backpressure Derating ([API 520 Part I PDF](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf)):**`,
        `- **Conventional Spring-Loaded PSV:** Permitted only when built-up backpressure does not exceed allowable overpressure (**10%** non-fire, **21%** fire) and superimposed backpressure is constant.`,
        `- **Balanced-Bellows PRV:** Required when total backpressure is between **10% and 50% of gauge set pressure** or flare header backpressure varies. Applies capacity derating factor \`K_b\` (API 520 Fig. 30 for vapors; \`K_b = 1.0\` up to 30% backpressure, \`~0.85\` at 40%) or \`K_w\` (Fig. 32 for liquids).`,
        `- **Pilot-Operated PRV:** Required when total backpressure exceeds **50% of set pressure**, when operating pressure is within **5% of set pressure**, or when zero inlet/backpressure effect on set pressure is needed.`,
        `- **Your Active Tag (\`${psv.tagNumber}\`):** Currently \`${psv.valveType.toUpperCase()}\` with \`K_b = ${psv.Kb}\` and total backpressure \`${hyd.totalBackPctOfSet}%\` of set pressure.`
      ].join('\n');
    }

    if (q.includes('fire') || q.includes('521') || q.includes('wetted') || q.includes('25 ft') || q.includes('7.62')) {
      return [
        `**External Pool Fire Relief Load ([API 521 §4.4.13 PDF](https://eballotprodstorage.blob.core.windows.net/eballotscontainer/521_e9-WI_11-20250610.pdf)):**`,
        `- **7.62 m (25 ft) Flame Envelope Limit:** Only liquid-wetted internal vessel surface area (\`A_ws\`, m²) up to **7.62 m (25 ft)** above the fire source grade is included in pool fire heat absorption.`,
        `- **Liquid-Wetted Heat Absorption (SI):**`,
        `  - With adequate drainage & prompt firefighting: \`Q = 43,200 × F × A_ws^0.82\` Watts (\`21,000 × F × A_ws^0.82 BTU/hr\` in USC).`,
        `  - Without adequate drainage: \`Q = 70,900 × F × A_ws^0.82\` Watts (\`34,500 × F × A_ws^0.82 BTU/hr\` in USC).`,
        `- **Vapor Relief Rate:** \`W = Q / λ\` (where \`λ\` is latent heat of vaporization at relieving pressure \`P_1\` with **21% allowable overpressure**).`
      ].join('\n');
    }

    if (q.includes('omega') || q.includes('leung') || q.includes('two-phase') || q.includes('2-phase') || q.includes('flashing')) {
      return [
        `**DIERS Leung Omega (ω) Two-Phase Sizing ([API 520 Part I Annex C PDF](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf)):**`,
        `- **Omega Compressibility Parameter:** \`ω = α_0 + (ρ_0 · C_p · T_0 · P_0) / (λ · ρ_v0)²\`, where the first term represents inlet non-condensable/vapor void fraction (\`α_0\`) and the second term captures thermal flashing inside the nozzle throat.`,
        `- **Critical Pressure Ratio & Flux:** From \`ω\`, the critical throat pressure ratio \`η_c = P_cf / P_1\` is solved iteratively; when \`P_2 ≤ P_cf\`, the flow is choked and two-phase mass flux \`G_tp (kg/m²·s)\` determines \`A_req = W / (3.6 × K_d × K_b × K_c × G_tp)\`.`
      ].join('\n');
    }

    if (q.includes('pump') || q.includes('610') || q.includes('npsh') || q.includes('cavitation')) {
      return [
        `**Centrifugal Pump NPSHa & Hydraulic Verification ([API 610 PDF](https://energy-steel.com/wp-content/uploads/2024/12/API-610.pdf)):**`,
        `- **Available NPSH Formula:** \`NPSHa = (P_suction,abs − P_vapor,abs) × 10⁵ / (ρ · g)\` (meters of liquid head at the pump suction flange after subtracting suction line Darcy-Weisbach friction loss).`,
        `- **API 610 Cavitation Margin:** Requires \`NPSHa ≥ max(NPSHr + 1.0 m, 1.10 × NPSHr)\`.`,
        `- **Active Pump Loop (\`${pmp.pumpTag}\`):** \`NPSHa = ${pmp.npshaM} m\`, \`NPSHr = ${pmp.npshrM} m\`, Margin = \`+${pmp.npshMarginM} m\` (${pmp.npshCompliant ? 'PASS' : 'FAIL'}).`
      ].join('\n');
    }

    return [
      `**API 520 / 521 / 526 / 610 Guidance for Active Tag \`${psv.tagNumber}\`:**`,
      `- **Sizing Basis ([API 520 Part I](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf)):** Relieving pressure \`P_1 = P_set × (1 + overpressure/100) + P_atm = ${psv.relievingPressureBara} bara\`. Required area \`A_req = ${psv.reqAreaMm2} mm²\` selects **API 526 Orifice \`${psv.selectedOrificeLetter}\`** (\`${psv.selectedOrificeAreaMm2} mm²\`, \`${psv.flangeSize}\`).`,
      `- **Piping Audit ([API 520 Part II](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-II.pdf)):** Inlet \`${hyd.inletNps}\` loss is \`${hyd.inletLossPctOfSet}%\` (limit ≤ 3.0%); outlet \`${hyd.outletNps}\` total backpressure is \`${hyd.totalBackPctOfSet}%\` of set pressure.`,
      `- **Reference Standards:** [API 520 Part I](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf) · [API 520 Part II](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-II.pdf) · [API 521](https://eballotprodstorage.blob.core.windows.net/eballotscontainer/521_e9-WI_11-20250610.pdf) · [API 610](https://energy-steel.com/wp-content/uploads/2024/12/API-610.pdf).`
    ].join('\n');
  }

  function appendAskPsvMessage(role, rawText, metaLabel, smartActions = []) {
    const container = document.getElementById('askPsvMessages');
    if (!container) return;

    const msgEl = document.createElement('div');
    msgEl.className = `ask-psv-msg ${role === 'user' ? 'ask-psv-msg-user' : 'ask-psv-msg-bot'}`;

    if (role === 'user') {
      msgEl.textContent = rawText;
    } else {
      const actionsHtml = smartActions.length > 0
        ? `<div class="ask-psv-actions-row">${smartActions.map(a => `<button type="button" class="ask-psv-action-btn" data-psv-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join('')}</div>`
        : '';
      msgEl.innerHTML = `
        <div class="ask-psv-msg-meta">
          <span><strong>Ask PSV</strong> · Standards Copilot</span>
          <span>${escapeHtml(metaLabel || 'API 520/521/526/610')}</span>
        </div>
        <div class="ask-psv-msg-body">${formatBotMarkdown(rawText)}</div>
        ${actionsHtml}
      `;
      msgEl.querySelectorAll('[data-psv-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          executeAskPsvSmartAction(btn.getAttribute('data-psv-action'));
        });
      });
    }

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
  }

  async function sendAskPsvQuestion(questionText) {
    const cleanQ = String(questionText || '').trim();
    if (!cleanQ) return;

    const t = state.tag;
    const { sizing, hyd } = computeForTag(t);
    const pumpRes = E.calcPumpLoopHydraulics({
      ...state.pumpLoop,
      atmPressureBara: t.atmPressureBara || 1.01325
    });
    const ctx = buildAskPsvContextSnapshot(t, sizing, hyd, pumpRes);

    appendAskPsvMessage('user', cleanQ);

    const sendBtn = document.getElementById('btnSendAskPsv');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Thinking...';
    }

    let replyText = '';
    let modeLabel = 'gemini-flash-latest · Grounded';

    try {
      const res = await fetch('/api/ask-psv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: cleanQ,
          history: askPsvHistory.slice(-6),
          activeContext: ctx
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.reply) {
          replyText = data.reply;
          modeLabel = `${data.model || 'gemini-flash-latest'} · API Grounded`;
          const badge = document.getElementById('askPsvModeBadge');
          if (badge) badge.textContent = `${data.model || 'gemini-flash-latest'} · Live Proxy`;
        }
      }
    } catch (_) {
      // Offline or static file:// mode — handled seamlessly by local RAG engine below
    }

    if (!replyText) {
      replyText = answerWithLocalStandardsRag(cleanQ, ctx);
      modeLabel = 'Built-in API 520/521/610 Clause Engine';
    }

    askPsvHistory.push({ role: 'user', text: cleanQ });
    askPsvHistory.push({ role: 'model', text: replyText });

    const smartActions = buildSmartActionsForContext(cleanQ, ctx);
    appendAskPsvMessage('bot', replyText, modeLabel, smartActions);

    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Ask PSV';
    }
  }

  function renderAskPsvWelcome() {
    const container = document.getElementById('askPsvMessages');
    if (!container) return;
    container.innerHTML = '';
    askPsvHistory.length = 0;

    const t = state.tag;
    const { sizing, hyd } = computeForTag(t);
    const pumpRes = E.calcPumpLoopHydraulics({
      ...state.pumpLoop,
      atmPressureBara: t.atmPressureBara || 1.01325
    });
    const ctx = buildAskPsvContextSnapshot(t, sizing, hyd, pumpRes);

    const welcomeMd = [
      `Hello! I am **Ask PSV**, your process safety and hydraulics AI assistant strictly grounded in **[API 520 Pt I Sizing PDF](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-I.pdf)**, **[API 520 Pt II Piping PDF](https://www.psvshop.ir/wp-content/uploads/2022/03/API-520-II.pdf)**, **[API 521 Relief PDF](https://eballotprodstorage.blob.core.windows.net/eballotscontainer/521_e9-WI_11-20250610.pdf)**, **API 526**, and **[API 610 Pump PDF](https://energy-steel.com/wp-content/uploads/2024/12/API-610.pdf)**.`,
      `- **Live Context Connected:** I can see your active PSV tag \`${ctx.psvTag.tagNumber}\` (Orifice \`${ctx.psvTag.selectedOrificeLetter}\`, Inlet ΔP = \`${ctx.pipingHydraulics.inletLossPctOfSet}%\`) and Pump \`${ctx.pumpLoop.pumpTag}\` (\`NPSHa = ${ctx.pumpLoop.npshaM} m\`).`,
      `- Ask me to **audit your active calculation**, explain any **API standard equation or clause**, or click a prompt chip above!`
    ].join('\n');

    appendAskPsvMessage('bot', welcomeMd, 'gemini-flash-latest · Ready', buildSmartActionsForContext('audit', ctx));
  }

  function toggleAskPsvDrawer(forceOpen) {
    const drawer = document.getElementById('askPsvDrawer');
    if (!drawer) return;
    const isOpen = typeof forceOpen === 'boolean' ? forceOpen : !drawer.classList.contains('open');
    drawer.classList.toggle('open', isOpen);
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (isOpen) {
      const inp = document.getElementById('askPsvInput');
      if (inp) setTimeout(() => inp.focus(), 80);
    }
  }

  function initAskPsvCopilot() {
    renderAskPsvWelcome();

    const openBtn = document.getElementById('btnOpenAskPsv');
    const fabBtn = document.getElementById('askPsvFloatingBtn');
    const closeBtn = document.getElementById('btnCloseAskPsv');
    const clearBtn = document.getElementById('btnClearAskPsv');
    const auditBtn = document.getElementById('btnAuditActiveTag');
    const form = document.getElementById('askPsvForm');
    const input = document.getElementById('askPsvInput');

    if (openBtn) openBtn.addEventListener('click', () => toggleAskPsvDrawer(true));
    if (fabBtn) fabBtn.addEventListener('click', () => toggleAskPsvDrawer(true));
    if (closeBtn) closeBtn.addEventListener('click', () => toggleAskPsvDrawer(false));
    if (clearBtn) clearBtn.addEventListener('click', () => renderAskPsvWelcome());
    if (auditBtn) {
      auditBtn.addEventListener('click', () => {
        sendAskPsvQuestion('Audit my active PSV tag and piping hydraulics against API 520 Part I, Part II (3% inlet rule), and API 526.');
      });
    }

    document.querySelectorAll('#askPsvPromptChips .ask-psv-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.getAttribute('data-prompt');
        if (prompt) sendAskPsvQuestion(prompt);
      });
    });

    if (form && input) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value;
        input.value = '';
        sendAskPsvQuestion(text);
      });
    }
  }

  // =========================================================================
  // 10. WORKFLOW & DELIVERABLES — project file (B1), report (B2), XLSX (B3),
  //     share links (B4), case snapshots & comparison (B5)
  // =========================================================================

  const APP_NAME = 'PSVCalc Pro';
  const SCHEMA_VERSION = 2;
  const WORKSPACE_KEY = 'psvcalc_pro_workspace_v2';
  const CASES_KEY = 'psvcalc_pro_cases_v1';
  const VALID_TABS = ['tab-vessel', 'tab-scenarios', 'tab-sizing', 'tab-hydraulics', 'tab-pump', 'tab-ipds', 'tab-toolkit', 'tab-register'];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isPlainObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  let autosaveTimer = null;
  let autosaveReady = false;
  let suppressAutosave = false;
  let pendingShareUndo = null;

  // ---- B1. Workspace (de)serialisation ------------------------------------

  /** Deep-merge `val` onto `def`, keeping `def` where `val` has the wrong type (never yields NaN). */
  function sanitizeLike(def, val) {
    if (val === undefined || val === null) return def === undefined ? val : clone(def);
    if (def === undefined || def === null) return typeof val === 'object' ? clone(val) : val;
    if (typeof def === 'number') return (typeof val === 'number' && Number.isFinite(val)) ? val : def;
    if (typeof def === 'string') return (typeof val === 'string' || typeof val === 'number') ? String(val) : def;
    if (typeof def === 'boolean') return typeof val === 'boolean' ? val : def;
    if (Array.isArray(def)) return Array.isArray(val) ? clone(val) : clone(def);
    if (isPlainObj(def)) {
      if (!isPlainObj(val)) return clone(def);
      const out = {};
      new Set([...Object.keys(def), ...Object.keys(val)]).forEach(k => { out[k] = sanitizeLike(def[k], val[k]); });
      return out;
    }
    return val;
  }
  const presetFor = (list, obj, key) => list.find(p => (obj.id !== undefined && p.id === obj.id) || (key && obj[key] !== undefined && p[key] === obj[key])) || list[0];
  const isValidTagObj = (t) => isPlainObj(t) && typeof t.tagNumber === 'string' &&
    Number.isFinite(t.setPressureBarg) && t.setPressureBarg > 0 && Number.isFinite(t.flowRateKgHr) && t.flowRateKgHr > 0;
  const isValidCase = (c) => isPlainObj(c) && typeof c.id === 'string' && typeof c.name === 'string' && isPlainObj(c.ws) && isValidTagObj(c.ws.tag);

  /** Validate a parsed project object -> { ok, ws } (normalised, canonical SI) or { ok:false, error }. */
  function validateProject(obj) {
    if (!isPlainObj(obj)) return { ok: false, error: 'This file is not a PSVCalc Pro project (expected a JSON object).' };
    if (obj.app !== APP_NAME) return { ok: false, error: `Not a PSVCalc Pro project file (app = "${String(obj.app ?? 'missing').slice(0, 40)}").` };
    const ver = Number(obj.schemaVersion);
    if (!Number.isInteger(ver) || ver < 1) return { ok: false, error: 'Project file has a missing or invalid schemaVersion.' };
    if (ver > SCHEMA_VERSION) return { ok: false, error: `Project schemaVersion ${ver} was written by a newer PSVCalc Pro (this build reads ≤ ${SCHEMA_VERSION}).` };
    if (!isValidTagObj(obj.tag)) return { ok: false, error: 'Project has no valid active PSV tag (needs tagNumber, setPressureBarg > 0 and flowRateKgHr > 0 in SI).' };
    if (obj.register !== undefined && !Array.isArray(obj.register)) return { ok: false, error: 'Project "register" must be an array of PSV tags.' };
    if (obj.cases !== undefined && !Array.isArray(obj.cases)) return { ok: false, error: 'Project "cases" must be an array.' };
    const tagPresets = E.EPC_TAG_PRESETS;
    return {
      ok: true,
      ws: {
        unitSystem: obj.unitSystem === 'USC' ? 'USC' : 'SI',
        ipdsMode: ['psv', 'pump', 'vessel'].includes(obj.ipdsMode) ? obj.ipdsMode : 'psv',
        activeTab: VALID_TABS.includes(obj.activeTab) ? obj.activeTab : 'tab-sizing',
        activeScenarioKey: typeof obj.activeScenarioKey === 'string' ? obj.activeScenarioKey : null,
        tag: sanitizeLike(presetFor(tagPresets, obj.tag, 'tagNumber'), obj.tag),
        register: Array.isArray(obj.register) ? obj.register.filter(isValidTagObj).map(r => sanitizeLike(presetFor(tagPresets, r, 'tagNumber'), r)) : null,
        pumpLoop: isPlainObj(obj.pumpLoop) ? sanitizeLike(presetFor(E.PUMP_LOOP_PRESETS, obj.pumpLoop, 'pumpTag'), obj.pumpLoop) : null,
        vessel: isPlainObj(obj.vessel) ? sanitizeLike(presetFor(E.VESSEL_SIZING_PRESETS, obj.vessel, 'vesselTag'), obj.vessel) : null,
        tools: isPlainObj(obj.tools) ? obj.tools : null,
        cases: Array.isArray(obj.cases) ? obj.cases.filter(isValidCase) : null,
        report: isPlainObj(obj.report) ? obj.report : null
      }
    };
  }

  function exportToolsState() {
    try { return window.PSVTools ? window.PSVTools.exportState() : {}; } catch (_) { return {}; }
  }

  /** Full canonical-SI workspace (B1 schema v2). */
  function buildWorkspace({ register = true, cases = true, report = true } = {}) {
    const ws = {
      app: APP_NAME,
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      unitSystem: state.unitSystem,
      ipdsMode: state.ipdsMode,
      activeTab: state.activeTab,
      activeScenarioKey: state.activeScenarioKey,
      tag: clone(state.tag)
    };
    if (register) ws.register = clone(state.register);
    ws.pumpLoop = clone(state.pumpLoop);
    ws.vessel = clone(state.vessel);
    ws.tools = exportToolsState();
    if (cases) ws.cases = clone(state.cases);
    if (report && state.report) ws.report = clone(state.report);
    return ws;
  }
  const buildShareWorkspace = () => buildWorkspace({ register: false, cases: false, report: false });

  /** Apply a normalised workspace (from validateProject) to state + DOM. */
  function applyWorkspace(ws, opts = {}) {
    const prevUnit = state.unitSystem;
    suppressAutosave = true;
    try {
      if (ws.unitSystem && opts.units !== false) state.unitSystem = ws.unitSystem;
      if (ws.ipdsMode) state.ipdsMode = ws.ipdsMode;
      if (ws.tag) state.tag = clone(ws.tag);
      if (ws.pumpLoop) state.pumpLoop = clone(ws.pumpLoop);
      if (ws.vessel) state.vessel = clone(ws.vessel);
      state.activeScenarioKey = ws.activeScenarioKey || state.tag.governingScenarioKey || state.activeScenarioKey;
      if (opts.register !== false && ws.register && ws.register.length) {
        state.register = clone(ws.register);
        saveRegisterToStorage();
      }
      if (opts.cases !== false && ws.cases) mergeCases(ws.cases);
      if (ws.report) state.report = { ...defaultReportMeta(), ...ws.report };

      document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === state.unitSystem));
      document.querySelectorAll('#ipdsModeSelectorGroup .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.ipdsMode === state.ipdsMode));
      document.querySelectorAll('#scenarioSelectorList .scenario-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.scenario === state.activeScenarioKey));
      syncTagToDomInputs();
      syncPumpToDomInputs();
      syncVesselToDomInputs();
      renderScenarioForm();
      recomputeAll();
      if (ws.tools && window.PSVTools) window.PSVTools.importState(ws.tools);
      if (prevUnit !== state.unitSystem && window.PSVTools) window.PSVTools.notifyUnitChange();
      if (ws.activeTab && opts.tab !== false) switchTab(ws.activeTab);
      renderCasesPanel();
    } finally {
      suppressAutosave = false;
    }
    scheduleAutosave();
  }

  function scheduleAutosave() {
    if (!autosaveReady || suppressAutosave) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveWorkspaceNow, 600);
  }
  function saveWorkspaceNow() {
    autosaveTimer = null;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(buildWorkspace({ register: false, cases: false })));
    } catch (err) {
      console.warn('Workspace autosave failed:', err);
    }
  }
  function restoreWorkspaceFromStorage() {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY);
      if (!raw) return null;
      const v = validateProject(JSON.parse(raw));
      return v.ok ? v.ws : null;
    } catch (_) {
      return null;
    }
  }

  /** Open a project file or a legacy register-only JSON array. */
  function importJsonText(text) {
    let obj;
    try { obj = JSON.parse(String(text)); } catch (_) { return { ok: false, error: 'Could not open file: it is not valid JSON.' }; }
    if (Array.isArray(obj)) {
      const register = obj.filter(isValidTagObj).map(r => sanitizeLike(presetFor(E.EPC_TAG_PRESETS, r, 'tagNumber'), r));
      if (!register.length) return { ok: false, error: 'Register file contains no valid PSV tags (needs tagNumber, setPressureBarg, flowRateKgHr).' };
      applyWorkspace({ tag: register[0], register }, { cases: false, tab: false });
      return { ok: true, message: `Imported legacy register (${register.length} tags).` };
    }
    const v = validateProject(obj);
    if (!v.ok) return v;
    applyWorkspace(v.ws);
    return { ok: true, message: `Opened project "${v.ws.tag.projectTitle || v.ws.tag.tagNumber}".` };
  }

  const slugify = (s) => String(s || '').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'psvcalc_project';
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function saveProjectFile() {
    const name = `${slugify(state.tag.projectTitle || state.tag.tagNumber)}.psvproj.json`;
    downloadBlob(new Blob([JSON.stringify(buildWorkspace(), null, 2)], { type: 'application/json' }), name);
    showToast(`Project saved as ${name}`, 'ok');
  }

  let toastTimer = null;
  function showToast(msg, kind = 'info', extraNode = null) {
    const el = document.getElementById('psvToast');
    if (!el) return;
    el.className = `psv-toast psv-toast-${kind}`;
    el.textContent = String(msg);
    if (extraNode) el.appendChild(extraNode);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, extraNode ? 15000 : 4500);
  }

  // ---- Shared formatting for report / Excel / case comparison ------------

  // [SI unit, USC unit, SI->USC converter]
  const KIND = {
    pressG: ['barg', 'psig', U.barToPsi], pressA: ['bara', 'psia', U.barToPsi], dp: ['bar', 'psi', U.barToPsi],
    flow: ['kg/h', 'lb/h', U.kgHrToLbHr], vol: ['m³/h', 'gpm', U.m3HrToGpm], head: ['m', 'ft', U.mToFt],
    vel: ['m/s', 'ft/s', U.mToFt], mm: ['mm', 'in', U.mmToIn], area: ['mm²', 'in²', U.mm2ToIn2],
    m2: ['m²', 'ft²', v => v * 10.7639104], kg: ['kg', 'lb', v => v * 2.20462262], kw: ['kW', 'hp', v => v / 0.745699872],
    duty: ['kW', 'MMBtu/h', v => v * 0.0034121416], kn: ['kN', 'lbf', v => v * 224.808943], temp: ['°C', '°F', U.cToF],
    pct: ['%', '%', v => v], none: ['', '', v => v]
  };
  const R = (p, v, k = 'text', d = 2, ref = '', du) => ({ p, v, k, d, du: du ?? d, ref });
  const kindUnit = (k, usc = isUSC()) => (KIND[k] ? KIND[k][usc ? 1 : 0] : '');
  const kindDigits = (r, usc = isUSC()) => (usc ? r.du : r.d);
  const kindVal = (k, v, usc = isUSC()) => (KIND[k] && usc ? KIND[k][2](v) : v);
  function fmtKind(r) {
    if (r.k === 'text' || !KIND[r.k]) return r.v === undefined || r.v === null || r.v === '' ? '—' : String(r.v);
    if (typeof r.v !== 'number' || !Number.isFinite(r.v)) return '—';
    const d = kindDigits(r);
    const val = kindVal(r.k, r.v);
    const unit = kindUnit(r.k);
    return `${val.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}${unit ? ' ' + unit : ''}`;
  }
  const fx = (v, d) => (Number.isFinite(v) ? Number(v).toFixed(d) : '—');
  const scenarioLabel = (k) => String(k || 'blocked_outlet').replace(/_/g, ' ');

  function currentResults() {
    const t = state.tag;
    const { sizing, hyd } = computeForTag(t);
    const atm = t.atmPressureBara || 1.01325;
    return {
      t, s: sizing, h: hyd,
      v: E.calcVesselSizingFromScratch({ ...state.vessel, atmPressureBara: atm }),
      p: E.calcPumpLoopHydraulics({ ...state.pumpLoop, atmPressureBara: atm })
    };
  }

  function psvRows(t, s) {
    const o = s.selectedOrifice || {};
    return [
      R('PSV tag / service', `${t.tagNumber} — ${t.service || ''}`, 'text', 0, t.pidNumber || ''),
      R('Protected equipment', t.equipmentProtected || '—'),
      R('Governing scenario', scenarioLabel(t.governingScenarioKey), 'text', 0, 'API 521 §4 (overpressure causes)'),
      R('Fluid phase', String(t.fluidPhase || '').toUpperCase(), 'text', 0, t.fluidPhase === 'liquid' ? `ρ = ${fx(t.rhoLiqKgM3, 1)} kg/m³, μ = ${t.viscCp} cP` : `MW = ${t.mw}, k = ${t.k}, Z = ${t.z}`),
      R('Required relief rate W', t.flowRateKgHr, 'flow', 0, 'Relief load from API 521 scenario'),
      R('Set pressure P_set', t.setPressureBarg, 'pressG', 2, 'Set ≤ MAWP', 1),
      R('Allowable overpressure', t.overpressurePct, 'pct', 0, 'Accumulation 10 / 16 / 21 % (ASME VIII-1, API 520-1)'),
      R('Relieving pressure P₁', s.P1_bara, 'pressA', 3, 'P₁ = P_set + ΔP_over + P_atm', 2),
      R('Total backpressure', s.P_backBarg, 'pressG', 2, 'Superimposed + built-up', 1),
      R('Flow regime', s.flowRegime || '—', 'text', 0, Number.isFinite(s.Pcf_bara) ? `P_cf = ${fmtPressA(s.Pcf_bara, 3)} (API 520-1 critical-flow ratio)` : ''),
      R('Kd / Kb / Kc / Kv', `${fx(s.Kd, 3)} / ${fx(s.Kb, 3)} / ${fx(s.Kc, 2)} / ${fx(s.Kv, 3)}`, 'text', 0, 'API 520-1 §5.6–5.9 correction factors'),
      R('Required effective area A_req', s.reqAreaMm2, 'area', 1, 'API 520-1 §5.6 gas · §5.7 steam · §5.8 liquid · §5.9/Annex C two-phase', 4),
      R('Selected API 526 orifice', `${o.letter || '—'} — ${Number.isFinite(o.areaMm2) ? fmtArea(o.areaMm2) : '—'} (${o.inletOutFlange || ''})`, 'text', 0, 'API 526 effective orifice areas'),
      R('Rated capacity', s.ratedCapacityKgHr, 'flow', 0, 'W × A_526 / A_req'),
      R('Orifice utilisation', s.ratedCapacityKgHr > 0 ? (t.flowRateKgHr / s.ratedCapacityKgHr) * 100 : NaN, 'pct', 1, 'W / W_rated')
    ];
  }
  function hydRows(t, h) {
    return [
      R('Inlet line', `${h.inlet.nps} Sch ${h.inlet.schedule}, L = ${fmtHead(h.inlet.lengthM, 1)}`, 'text', 0, `Flow basis: ${h.flowBasis || 'rated'}`),
      R('Inlet pressure loss (% of P_set)', h.inlet.lossPctOfSet, 'pct', 2, `API 520-2 non-recoverable inlet loss ≤ 3 % — ${h.inlet.passes3Pct ? 'PASS' : 'FAIL'}`),
      R('Outlet line', `${h.outlet.nps} Sch ${h.outlet.schedule}, L = ${fmtHead(h.outlet.lengthM, 1)}`),
      R('Built-up backpressure', h.outlet.builtUpBackBarg, 'pressG', 3, 'Darcy–Weisbach / compressible outlet flow', 2),
      R('Total backpressure (% of P_set)', h.outlet.totalBackPctOfSet, 'pct', 1, `Limit ${fx(h.outlet.maxAllowedBackPct, 0)} % for valve type (API 520-1) — ${h.outlet.passesBackpressure ? 'PASS' : 'FAIL'}`),
      R('Outlet exit Mach number', h.outlet.machNumber, 'none', 2, `API 521 tail-pipe velocity check — ${h.outlet.passesMach ? 'PASS' : 'HIGH'}`),
      R('Discharge reaction force', h.outlet.reactionForceKn, 'kn', 2, 'API 520-2 open-discharge reaction force', 0)
    ];
  }
  function vesselRows(v) {
    const g = v.geometry, m = v.mechanical, sep = v.separation, f = v.firePreview;
    return [
      R('Vessel tag / service', `${v.vesselTag} — ${v.service}`, 'text', 0, `${v.vesselServiceType} · ${v.orientation}`),
      R('Operating / design pressure', `${fmtPressG(v.operatingPressureBarg)} / ${fmtPressG(v.designPressureBarg)}`),
      R('Vapour mass flow', v.flows.W_vapKgHr, 'flow', 0),
      R('Liquid mass flow', v.flows.W_liqKgHr, 'flow', 0),
      R('Souders-Brown K (derated)', sep.effectiveKsbMS, 'vel', 3, 'GPSA Sec. 7: V_max = K·√((ρL − ρV)/ρV)'),
      R('Vapour velocity utilisation', sep.vaporVelUtilizationPct, 'pct', 0, sep.vaporCompliant ? 'PASS (≤ 100 %)' : 'EXCEEDS allowable'),
      R('Vessel ID', g.diameterMm, 'mm', 0, 'Rounded to 50 mm increments', 1),
      R('Length T/T', g.lengthMm, 'mm', 0, `L/D = ${fx(g.ldRatio, 2)}`, 1),
      R('Normal liquid level NLL', g.levels.nllM, 'head', 2, `Hold-up ${v.holdup.tauHoldMin} min + surge ${v.holdup.tauSurgeMin} min (API 12J)`),
      R('Shell nominal thickness', m.tShellSelectedMm, 'mm', 1, 'ASME VIII-1 UG-27(c)(1): t = PR/(SE − 0.6P) + CA', 3),
      R('Head nominal thickness', m.tHeadSelectedMm, 'mm', 1, `ASME VIII-1 UG-32 (${v.headType}) + CA`, 3),
      R('Material / corrosion allowance', `${m.materialName} / ${m.corrosionAllowanceMm} mm`),
      R('Corroded MAWP', m.mawpCorrodedBarg, 'pressG', 2, m.mawpCorrodedBarg >= v.designPressureBarg - 1e-3 ? 'PASS (≥ design pressure)' : 'BELOW design pressure', 1),
      R('Empty weight', m.emptyWeightKg, 'kg', 0),
      R('Operating weight', m.operatingWeightKg, 'kg', 0),
      R('Hydrotest weight', m.hydrotestWeightKg, 'kg', 0),
      R('Fire wetted area A_ws', f.wettedAreaM2, 'm2', 2, 'API 521 pool fire, ≤ 7.6 m above grade', 1),
      R('Fire heat absorption Q', f.heatDutyKw, 'duty', 0, 'API 521: Q = C·F·A_ws^0.82', 3),
      R('Fire relief load', f.reliefRateKgHr, 'flow', 0, 'W = Q / λ')
    ];
  }
  function pumpRows(p) {
    const pm = p.pump, cv = p.controlValve;
    return [
      R('Pump tag / service', `${state.pumpLoop.pumpTag || ''} — ${state.pumpLoop.service || ''}`),
      R('Normal flow', p.Q_normM3Hr, 'vol', 1),
      R('Rated flow', p.Q_ratedM3Hr, 'vol', 1, 'API 610 rated point'),
      R('Specific gravity', p.SG, 'none', 3),
      R('Suction nozzle pressure', p.suction.nozzleBarg, 'pressG', 2, `${p.suction.nps} Sch ${p.suction.schedule}, v = ${fmtHead(p.suction.velocityMS, 2)}/s`, 1),
      R('Discharge nozzle pressure', p.discharge.nozzleBarg, 'pressG', 2, `${p.discharge.nps} Sch ${p.discharge.schedule}`, 1),
      R('Differential pressure', pm.diffPressureRatedBar, 'dp', 2, '', 1),
      R('Total differential head TDH', pm.tdhRatedM, 'head', 1, 'H = ΔP / (ρ·g)'),
      R('Shut-off head', pm.shutoffHeadM, 'head', 1),
      R('Max. discharge pressure', pm.maxDischargeBarg, 'pressG', 2, 'Shut-off + max suction (PSV blocked-outlet basis)', 1),
      R('Discharge erosional velocity', p.discharge.vErosionalMS, 'vel', 2, 'API RP 14E: V_e = C/√ρ_m'),
      R('NPSHa', p.npsh.npshaM, 'head', 2),
      R('NPSHr', p.npsh.npshrM, 'head', 2),
      R('NPSH margin', p.npsh.marginM, 'head', 2, `API 610 margin — ${p.npsh.compliant ? 'PASS' : 'FAIL'}`),
      R('Control valve ΔP (rated)', cv.allocatedDpRatedBar, 'dp', 2, `IEC 60534-2-1 Cv min/norm/rated = ${fx(cv.min.reqCv, 1)} / ${fx(cv.normal.reqCv, 1)} / ${fx(cv.rated.reqCv, 1)}`, 1),
      R('Hydraulic power', pm.hydraulicPowerKw, 'kw', 1),
      R('Brake power', pm.brakePowerKw, 'kw', 1, `η = ${pm.pumpEfficiencyPct} %`),
      R('Selected motor rating', pm.selectedMotorKw, 'kw', 0, 'API 610 driver margin over rated BHP')
    ];
  }

  // ---- B3. Excel (.xlsx) ---------------------------------------------------

  function xlsxRows(rows) {
    return [['Parameter', 'Value', 'Units (SI)', 'Basis / reference'],
      ...rows.map(r => [r.p,
        r.k === 'text' || !KIND[r.k] ? String(r.v ?? '') : (Number.isFinite(r.v) ? Number(r.v.toFixed(r.d + 2)) : ''),
        r.k === 'text' ? '' : kindUnit(r.k, false), r.ref])];
  }
  function buildWorkbookBytes() {
    const { t, s, h, v, p } = currentResults();
    const reg = [['Tag Number', 'Service', 'Protected Equipment', 'P&ID', 'Phase', 'Governing Scenario', 'Set Pressure (barg)',
      'Overpressure (%)', 'Relief Rate (kg/h)', 'Req. Area (mm2)', 'Req. Area (in2)', 'API 526 Orifice', 'Orifice Area (mm2)',
      'Flange Size', 'Inlet NPS', 'Inlet Loss (% Pset)', 'Outlet NPS', 'Total Backpressure (% Pset)', 'Outlet Mach']];
    state.register.forEach(item => {
      const r = computeForTag(item);
      const n = (x, d) => (Number.isFinite(x) ? Number(x.toFixed(d)) : '');
      reg.push([item.tagNumber, item.service, item.equipmentProtected, item.pidNumber, item.fluidPhase, scenarioLabel(item.governingScenarioKey),
        n(item.setPressureBarg, 3), n(item.overpressurePct, 1), n(item.flowRateKgHr, 1), n(r.sizing.reqAreaMm2, 2), n(r.sizing.reqAreaIn2, 4),
        r.sizing.selectedOrifice.letter, n(r.sizing.selectedOrifice.areaMm2, 1), r.sizing.selectedOrifice.inletOutFlange,
        item.inletNps, n(r.hyd.inlet.lossPctOfSet, 2), item.outletNps, n(r.hyd.outlet.totalBackPctOfSet, 2), n(r.hyd.outlet.machNumber, 3)]);
    });
    const tk = [['Tool / Parameter', 'Value', 'Units', 'Standard']];
    const bold = [0];
    const sums = window.PSVTools ? window.PSVTools.allSummaries() : [];
    sums.forEach(sm => {
      bold.push(tk.length);
      tk.push([sm.title, '', '', sm.std || '']);
      (sm.rows || []).forEach(row => tk.push([String(row[0] ?? ''), row[1] ?? '', String(row[2] ?? ''), '']));
      tk.push([]);
    });
    if (!sums.length) tk.push(['No toolkit modules registered']);
    return window.PSVExport.buildXlsx([
      { name: 'Register', rows: reg, widths: [14, 34, 30, 22, 9, 18] },
      { name: 'PSV Datasheet', rows: xlsxRows([...psvRows(t, s), ...hydRows(t, h)]), widths: [34, 30, 11, 60] },
      { name: 'Vessel', rows: xlsxRows(vesselRows(v)), widths: [34, 30, 11, 60] },
      { name: 'Pump', rows: xlsxRows(pumpRows(p)), widths: [34, 30, 11, 60] },
      { name: 'Toolkit', rows: tk, boldRows: bold, widths: [42, 18, 14, 40] }
    ]);
  }
  function exportXlsx() {
    const name = `${slugify(state.tag.projectTitle || state.tag.tagNumber)}.xlsx`;
    downloadBlob(new Blob([buildWorkbookBytes()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    showToast(`Excel workbook exported (${name}, SI units)`, 'ok');
  }

  // ---- B4. Share links -----------------------------------------------------

  // Links stay short by sending only the fields that differ from the matching preset /
  // tool defaultState(); decodeShareHash() re-expands them before validation.
  function diffFrom(def, val) {
    if (isPlainObj(def) && isPlainObj(val)) {
      const out = {};
      Object.keys(val).forEach(k => { const d = diffFrom(def[k], val[k]); if (d !== undefined) out[k] = d; });
      return Object.keys(out).length ? out : undefined;
    }
    return JSON.stringify(def) === JSON.stringify(val) ? undefined : val;
  }
  const SHARE_PARTS = [['tag', () => E.EPC_TAG_PRESETS, 'tagNumber'], ['pumpLoop', () => E.PUMP_LOOP_PRESETS, 'pumpTag'], ['vessel', () => E.VESSEL_SIZING_PRESETS, 'vesselTag']];
  const toolDefault = (id) => { try { const t = window.PSVTools && window.PSVTools.get(id); return t ? t.defaultState() : undefined; } catch (_) { return undefined; } };
  function compactWorkspace(ws) {
    const out = { ...ws, compact: 1 };
    SHARE_PARTS.forEach(([k, list, key]) => {
      if (!isPlainObj(ws[k])) return;
      const def = presetFor(list(), ws[k], key);
      out[k] = { ...(diffFrom(def, ws[k]) || {}), [key]: ws[k][key] };
      if (ws[k].id !== undefined) out[k].id = ws[k].id;
    });
    if (isPlainObj(ws.tools)) {
      out.tools = {};
      Object.keys(ws.tools).forEach(id => { const d = toolDefault(id); out.tools[id] = isPlainObj(d) ? (diffFrom(d, ws.tools[id]) || {}) : ws.tools[id]; });
    }
    return out;
  }
  function expandWorkspace(obj) {
    if (!isPlainObj(obj) || obj.compact !== 1) return obj;
    const out = { ...obj };
    delete out.compact;
    SHARE_PARTS.forEach(([k, list, key]) => { if (isPlainObj(obj[k])) out[k] = sanitizeLike(presetFor(list(), obj[k], key), obj[k]); });
    if (isPlainObj(obj.tools)) {
      out.tools = {};
      Object.keys(obj.tools).forEach(id => { const d = toolDefault(id); out.tools[id] = isPlainObj(d) ? sanitizeLike(d, obj.tools[id]) : obj.tools[id]; });
    }
    return out;
  }

  async function encodeShareState(ws) {
    const json = JSON.stringify(compactWorkspace(ws));
    if (typeof CompressionStream === 'function') {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 's=' + window.PSVExport.bytesToB64url(new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    return 'j=' + window.PSVExport.bytesToB64url(new TextEncoder().encode(json));
  }
  async function decodeShareHash(hash) {
    const m = /^#?([sj])=([A-Za-z0-9_-]+)$/.exec(String(hash || ''));
    if (!m) return null;
    const bytes = window.PSVExport.b64urlToBytes(m[2]);
    if (m[1] === 'j') return expandWorkspace(JSON.parse(new TextDecoder().decode(bytes)));
    if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot decompress shared links');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return expandWorkspace(JSON.parse(await new Response(stream).text()));
  }
  const clearShareHash = () => history.replaceState(null, '', window.location.pathname + window.location.search);
  async function handleSharedHash(hash) {
    let obj;
    try { obj = await decodeShareHash(hash); } catch (err) { showToast(`Shared link could not be decoded (${err.message}).`, 'error'); clearShareHash(); return false; }
    const v = obj ? validateProject(obj) : { ok: false, error: 'empty link' };
    if (!v.ok) { showToast(`Shared link is not a valid PSVCalc Pro case: ${v.error}`, 'error'); clearShareHash(); return false; }
    pendingShareUndo = buildShareWorkspace();
    applyWorkspace({ ...v.ws, register: null, cases: null, report: null }, { register: false, cases: false });
    const banner = document.getElementById('shareBanner');
    document.getElementById('shareBannerText').textContent = `Loaded shared case — ${v.ws.tag.tagNumber} (${v.ws.tag.service || 'no service'})`;
    banner.hidden = false;
    return true;
  }
  function resolveShareBanner(keep) {
    if (!keep && pendingShareUndo) {
      const v = validateProject(pendingShareUndo);
      if (v.ok) applyWorkspace(v.ws, { register: false, cases: false });
    }
    pendingShareUndo = null;
    document.getElementById('shareBanner').hidden = true;
    clearShareHash();
  }
  async function copyShareLink() {
    try {
      const url = `${window.location.href.split('#')[0]}#${await encodeShareState(buildShareWorkspace())}`;
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(url); copied = true; }
      } catch (_) { /* clipboard permission denied: show the link for manual copy */ }
      const inp = document.createElement('input');
      inp.readOnly = true;
      inp.value = url;
      inp.className = 'psv-toast-link mono';
      inp.addEventListener('focus', () => inp.select());
      showToast(copied ? `Share link copied to clipboard (${url.length} characters; register not included).` : 'Copy this share link (register not included):', copied ? 'ok' : 'info', inp);
      return url;
    } catch (err) {
      showToast(`Could not create share link (${err.message}).`, 'error');
      return null;
    }
  }

  // ---- B5. Case snapshots & comparison --------------------------------------

  function loadCasesFromStorage() {
    try {
      const arr = JSON.parse(localStorage.getItem(CASES_KEY) || '[]');
      state.cases = Array.isArray(arr) ? arr.filter(isValidCase) : [];
    } catch (_) {
      state.cases = [];
    }
  }
  function saveCasesToStorage() {
    try { localStorage.setItem(CASES_KEY, JSON.stringify(state.cases)); } catch (err) { console.warn('Could not persist case snapshots:', err); }
  }
  function mergeCases(list) {
    list.filter(isValidCase).forEach(c => {
      const i = state.cases.findIndex(x => x.id === c.id);
      if (i >= 0) state.cases[i] = clone(c); else state.cases.push(clone(c));
    });
    saveCasesToStorage();
  }
  function snapshotCurrentCase(name) {
    const nm = String(name || '').trim().slice(0, 80) || `${state.tag.tagNumber} · ${new Date().toLocaleString()}`;
    const c = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: nm, savedAt: new Date().toISOString(), ws: buildShareWorkspace() };
    state.cases.push(c);
    if (state.cases.length > 30) state.cases.shift();
    state.caseSel = [...state.caseSel.filter(id => id !== c.id), c.id].slice(-3);
    saveCasesToStorage();
    renderCasesPanel();
    return clone(c);
  }
  function restoreCase(id) {
    const c = state.cases.find(x => x.id === id);
    const v = c ? validateProject(c.ws) : { ok: false, error: 'snapshot not found' };
    if (!v.ok) { showToast(`Cannot restore case: ${v.error}`, 'error'); return false; }
    applyWorkspace(v.ws, { register: false, cases: false, units: false, tab: false });
    showToast(`Restored case "${c.name}"`, 'ok');
    return true;
  }
  function caseKpis(ws) {
    const v = validateProject(ws);
    if (!v.ok) return null;
    const w = v.ws;
    const out = { tag: w.tag.tagNumber };
    try {
      const { sizing: s, hyd: h } = computeForTag(w.tag);
      Object.assign(out, { reqArea: s.reqAreaMm2, orifice: s.selectedOrifice.letter, inletLoss: h.inlet.lossPctOfSet, backPct: h.outlet.totalBackPctOfSet });
      const atm = w.tag.atmPressureBara || 1.01325;
      if (w.vessel) {
        const vr = E.calcVesselSizingFromScratch({ ...w.vessel, atmPressureBara: atm });
        Object.assign(out, { vesselId: vr.geometry.diameterMm, vesselL: vr.geometry.lengthMm, mawp: vr.mechanical.mawpCorrodedBarg,
          emptyWt: vr.mechanical.emptyWeightKg, wetted: vr.firePreview.wettedAreaM2, fire: vr.firePreview.reliefRateKgHr });
      }
      if (w.pumpLoop) {
        const pr = E.calcPumpLoopHydraulics({ ...w.pumpLoop, atmPressureBara: atm });
        Object.assign(out, { tdh: pr.pump.tdhRatedM, npshMargin: pr.npsh.marginM, motorKw: pr.pump.selectedMotorKw });
      }
    } catch (err) {
      console.warn('Case KPI evaluation failed:', err);
    }
    return out;
  }
  const CASE_KPIS = [
    { g: 'PSV — API 520 Part I / II · API 526' },
    { key: 'reqArea', label: 'Required area A_req', k: 'area', d: 1, du: 4 },
    { key: 'orifice', label: 'API 526 orifice', k: 'text' },
    { key: 'inletLoss', label: 'Inlet loss (% of P_set)', k: 'pct', d: 2 },
    { key: 'backPct', label: 'Total backpressure (% of P_set)', k: 'pct', d: 1 },
    { g: 'Vessel — GPSA Sec. 7 · ASME VIII-1 · API 521' },
    { key: 'vesselId', label: 'Vessel ID', k: 'mm', d: 0, du: 1 },
    { key: 'vesselL', label: 'Length T/T', k: 'mm', d: 0, du: 1 },
    { key: 'mawp', label: 'Corroded MAWP', k: 'pressG', d: 2, du: 1 },
    { key: 'emptyWt', label: 'Empty weight', k: 'kg', d: 0 },
    { key: 'wetted', label: 'Fire wetted area A_ws', k: 'm2', d: 1, du: 0 },
    { key: 'fire', label: 'Fire relief load', k: 'flow', d: 0 },
    { g: 'Pump — API 610' },
    { key: 'tdh', label: 'Total differential head', k: 'head', d: 1 },
    { key: 'npshMargin', label: 'NPSH margin (NPSHa − NPSHr)', k: 'head', d: 2 },
    { key: 'motorKw', label: 'Selected motor rating', k: 'kw', d: 0 }
  ];
  function renderCasesPanel() {
    const list = document.getElementById('caseListContainer');
    const table = document.getElementById('caseCompareTable');
    const hint = document.getElementById('caseCompareHint');
    if (!list || !table) return;
    state.caseSel = state.caseSel.filter(id => state.cases.some(c => c.id === id));
    list.innerHTML = state.cases.length ? state.cases.map(c => {
      const sel = state.caseSel.includes(c.id);
      const when = new Date(c.savedAt);
      return `
        <div class="case-chip ${sel ? 'selected' : ''}">
          <label><input type="checkbox" class="case-sel-cb" data-id="${escapeHtml(c.id)}" ${sel ? 'checked' : ''} />
            <span class="case-chip-name">${escapeHtml(c.name)}</span>
            <span class="case-chip-meta mono">${escapeHtml(c.ws.tag.tagNumber)} · ${Number.isFinite(when.getTime()) ? escapeHtml(when.toLocaleDateString()) : '—'}</span></label>
          <button type="button" class="case-chip-del" data-id="${escapeHtml(c.id)}" title="Delete snapshot" aria-label="Delete snapshot ${escapeHtml(c.name)}">✕</button>
        </div>`;
    }).join('') : '<div class="case-empty">No snapshots yet. Name the current case and click “Snapshot current case”.</div>';

    const sel = state.caseSel.map(id => state.cases.find(c => c.id === id)).filter(Boolean);
    hint.textContent = sel.length < 2 ? 'Select 2–3 snapshots to compare side by side. The first selected case is the baseline for deltas.' : `Δ shown against baseline "${sel[0].name}". Highlighted cells differ from the baseline at displayed precision.`;
    if (!sel.length) { table.innerHTML = ''; return; }
    const kp = sel.map(c => caseKpis(c.ws) || {});
    const head = `<thead><tr><th>KPI</th>${sel.map((c, i) => `
      <th class="case-col-head"><div class="case-col-name">${escapeHtml(c.name)}</div>
        <div class="case-col-meta">${escapeHtml(kp[i].tag || '')} · ${i === 0 ? 'baseline' : 'Δ vs baseline'}</div>
        <button type="button" class="btn btn-secondary btn-restore-case" data-id="${escapeHtml(c.id)}">Restore this case</button></th>`).join('')}</tr></thead>`;
    const body = CASE_KPIS.map(def => {
      if (def.g) return `<tr class="case-group-row"><td colspan="${sel.length + 1}">${escapeHtml(def.g)}</td></tr>`;
      const unit = def.k === 'text' ? '' : kindUnit(def.k);
      const cells = kp.map((k, i) => {
        const r = { v: k[def.key], k: def.k, d: def.d ?? 0, du: def.du ?? def.d ?? 0 };
        if (r.v === undefined) return '<td class="mono">—</td>';
        if (i === 0) return `<td class="mono">${escapeHtml(fmtKind(r))}</td>`;
        const b = kp[0][def.key];
        if (def.k === 'text') {
          const diff = String(r.v) !== String(b);
          return `<td class="mono ${diff ? 'cmp-diff' : ''}">${escapeHtml(fmtKind(r))}<div class="cmp-delta">${diff ? `≠ ${escapeHtml(String(b ?? '—'))}` : '= baseline'}</div></td>`;
        }
        if (!Number.isFinite(r.v) || !Number.isFinite(b)) return `<td class="mono">${escapeHtml(fmtKind(r))}</td>`;
        const dg = kindDigits(r);
        const dv = Number((kindVal(def.k, r.v) - kindVal(def.k, b)).toFixed(dg));
        if (dv === 0) return `<td class="mono">${escapeHtml(fmtKind(r))}<div class="cmp-delta">= baseline</div></td>`;
        const sign = dv > 0 ? '+' : '−';
        const rel = def.k !== 'pct' && b !== 0 ? ` (${sign}${Math.abs(((r.v - b) / Math.abs(b)) * 100).toFixed(1)} %)` : '';
        const du = def.k === 'pct' ? 'pp' : unit;
        return `<td class="mono cmp-diff">${escapeHtml(fmtKind(r))}<div class="cmp-delta ${dv > 0 ? 'cmp-up' : 'cmp-down'}">${sign}${Math.abs(dv).toFixed(dg)} ${escapeHtml(du)}${rel}</div></td>`;
      }).join('');
      return `<tr><td><strong>${escapeHtml(def.label)}</strong>${unit ? ` <span class="case-unit">[${escapeHtml(unit)}]</span>` : ''}</td>${cells}</tr>`;
    }).join('');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
  }

  // ---- B2. Calculation report ------------------------------------------------

  const REPORT_SECTIONS = [
    { key: 'vessel', title: 'Vessel Sizing', std: 'GPSA Sec. 7 · API 12J · ASME VIII Div. 1 · API 521' },
    { key: 'scenarios', title: 'Overpressure Scenarios', std: 'API 521 · IEC 60534-2-1' },
    { key: 'psv', title: 'PSV Sizing', std: 'API 520 Part I · API 526' },
    { key: 'hydraulics', title: 'PSV Line Hydraulics', std: 'API 520 Part II · API 521' },
    { key: 'pump', title: 'Pump Hydraulics', std: 'API 610 · API RP 14E · IEC 60534-2-1' },
    { key: 'toolkit', title: 'Engineering Toolkit', std: 'Step 7 plug-in modules' },
    { key: 'register', title: 'Tag Register', std: 'Project PSV register' }
  ];
  const REPORT_REFERENCES = [
    'API Standard 520 Part I — Sizing, Selection and Installation of Pressure-relieving Devices: Sizing and Selection',
    'API Recommended Practice 520 Part II — Sizing, Selection and Installation of Pressure-relieving Devices: Installation',
    'API Standard 521 — Pressure-relieving and Depressuring Systems',
    'API Standard 526 — Flanged Steel Pressure-relief Valves',
    'API Standard 610 (ISO 13709) — Centrifugal Pumps for Petroleum, Petrochemical and Natural Gas Industries',
    'GPSA Engineering Data Book, Section 7 — Separation Equipment',
    'API Specification 12J — Specification for Oil and Gas Separators',
    'ASME Boiler & Pressure Vessel Code, Section VIII Division 1 — UG-27 (shells), UG-32 (formed heads)',
    'API Recommended Practice 14E — Design and Installation of Offshore Production Platform Piping Systems (erosional velocity)',
    'IEC 60534-2-1 — Industrial-process control valves: Flow capacity — Sizing equations for fluid flow under installed conditions',
    'API Standard 2000 (ISO 28300) — Venting Atmospheric and Low-pressure Storage Tanks'
  ];
  const REPORT_ASSUMPTIONS = [
    'All calculations are performed internally in canonical SI units; values in this report are shown in the unit system selected at generation time.',
    'Fluid properties (MW, k, Z, density, viscosity, latent heat) are user inputs and are not validated against a process simulator.',
    'PSV sizing uses API 520 Part I effective discharge coefficients and API 526 effective orifice areas for preliminary sizing; final selection shall use the vendor-certified Kd and actual areas.',
    'Two-phase relief uses the API 520 Part I Annex C ω-method, which is a screening method; confirm with a rigorous HEM/DIERS analysis where governing.',
    'Fire relief loads use the API 521 pool-fire equations with the environmental factor F as entered; wetted area is limited to 7.6 m (25 ft) above grade.',
    'Vessel sizing (Souders-Brown / hold-up) is a preliminary process sizing; wall thickness uses ASME VIII-1 UG-27/UG-32 formulas only (no nozzle reinforcement, wind, seismic or external loads).',
    'Pump and line hydraulics use Darcy–Weisbach friction with user-entered fittings K and equipment ΔP; the NPSH margin requirement is per API 610 as entered.',
    'Engineering Toolkit modules carry their own basis and screening limitations as stated in each module.',
    'This is a computer-generated calculation and must be independently checked and approved by a competent engineer before use.'
  ];

  function defaultReportMeta() {
    const t = state.tag;
    const today = new Date().toISOString().slice(0, 10);
    return {
      docNo: `${t.tagNumber || 'PSV'}-CALC-001`, rev: 'A', title: 'Pressure Relief, Vessel & Pump Hydraulic Calculation',
      project: t.projectTitle || '', client: t.clientName || '', preparedBy: '', checkedBy: '', approvedBy: '', date: today,
      revisions: [{ rev: 'A', date: today, desc: 'Issued for review', by: '', chk: '', app: '' }],
      sections: Object.fromEntries(REPORT_SECTIONS.map(s => [s.key, true]))
    };
  }
  const str200 = (v) => String(v ?? '').slice(0, 200);
  function normalizeReportMeta(m) {
    const d = defaultReportMeta();
    const src = isPlainObj(m) ? m : {};
    const out = {};
    ['docNo', 'rev', 'title', 'project', 'client', 'preparedBy', 'checkedBy', 'approvedBy', 'date'].forEach(k => { out[k] = src[k] !== undefined ? str200(src[k]) : d[k]; });
    out.revisions = Array.isArray(src.revisions) ? src.revisions.filter(isPlainObj).slice(0, 20).map(r => ({
      rev: str200(r.rev), date: str200(r.date), desc: str200(r.desc), by: str200(r.by), chk: str200(r.chk), app: str200(r.app) })) : d.revisions;
    out.sections = { ...d.sections, ...(isPlainObj(src.sections) ? src.sections : {}) };
    return out;
  }

  function renderRevRows(revs) {
    const tbody = document.getElementById('rptRevTbody');
    tbody.innerHTML = revs.map((r, i) => `
      <tr>
        ${['rev', 'date', 'desc', 'by', 'chk', 'app'].map(k => `<td><input type="text" class="rev-${k}" value="${escapeHtml(r[k])}" aria-label="Revision ${i + 1} ${k}" /></td>`).join('')}
        <td><button type="button" class="btn btn-secondary rpt-rev-del" data-idx="${i}" aria-label="Remove revision row">✕</button></td>
      </tr>`).join('');
  }
  function readRevRows() {
    return [...document.querySelectorAll('#rptRevTbody tr')].map(tr => {
      const o = {};
      ['rev', 'date', 'desc', 'by', 'chk', 'app'].forEach(k => { o[k] = str200(tr.querySelector(`.rev-${k}`).value); });
      return o;
    });
  }
  const RPT_FIELDS = { rptDocNo: 'docNo', rptRev: 'rev', rptTitle: 'title', rptProject: 'project', rptClient: 'client',
    rptPreparedBy: 'preparedBy', rptCheckedBy: 'checkedBy', rptApprovedBy: 'approvedBy', rptDate: 'date' };
  function openReportDialog() {
    const meta = normalizeReportMeta(state.report);
    if (!state.report) { meta.project = state.tag.projectTitle || ''; meta.client = state.tag.clientName || ''; }
    Object.entries(RPT_FIELDS).forEach(([id, k]) => { document.getElementById(id).value = meta[k]; });
    document.querySelectorAll('input[name="rptSection"]').forEach(cb => { cb.checked = meta.sections[cb.value] !== false; });
    renderRevRows(meta.revisions);
    const dlg = document.getElementById('reportDialog');
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }
  function readReportDialog() {
    const meta = {};
    Object.entries(RPT_FIELDS).forEach(([id, k]) => { meta[k] = str200(document.getElementById(id).value); });
    meta.revisions = readRevRows();
    meta.sections = {};
    document.querySelectorAll('input[name="rptSection"]').forEach(cb => { meta.sections[cb.value] = cb.checked; });
    return normalizeReportMeta(meta);
  }

  function tableHtml(headers, rows, cls = '') {
    return `<table class="rpt-table ${cls}"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  const rowsTableHtml = (rows) => tableHtml(['Parameter', 'Value', 'Basis / reference'], rows.map(r => [r.p, fmtKind(r), r.ref || '']), 'rpt-kv');

  let rptCloneSeq = 0;
  /** Clone a live SVG for the report, renaming internal ids (gradients/markers) so url(#…) refs stay local. */
  function cloneSvg(svg) {
    const c = svg.cloneNode(true);
    const sfx = `-rpt${++rptCloneSeq}`;
    const map = {};
    c.removeAttribute('id');
    c.querySelectorAll('[id]').forEach(el => { map[el.id] = el.id + sfx; el.id += sfx; });
    if (Object.keys(map).length) {
      c.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(a => {
          if (!a.value.includes('#')) return;
          let nv = a.value.replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, (mm, id) => (map[id] ? `url(#${map[id]})` : mm));
          if (nv.startsWith('#') && map[nv.slice(1)]) nv = '#' + map[nv.slice(1)];
          if (nv !== a.value) el.setAttributeNS(a.namespaceURI, a.name, nv);
        });
      });
    }
    return c;
  }
  function appendFigures(parent, figs, secNo) {
    let n = 0;
    figs.forEach(([id, caption]) => {
      const svg = document.querySelector(`#${id} svg`);
      if (!svg) return;
      const fig = document.createElement('figure');
      fig.className = 'rpt-fig';
      fig.appendChild(cloneSvg(svg));
      const cap = document.createElement('figcaption');
      cap.textContent = `Figure ${secNo}.${++n} — ${caption}`;
      fig.appendChild(cap);
      parent.appendChild(fig);
    });
    return n;
  }
  function appendTrace(parent, id) {
    const cards = document.querySelectorAll(`#${id} .eq-step-card`);
    if (!cards.length) return 0;
    const wrap = document.createElement('div');
    wrap.className = 'rpt-trace';
    cards.forEach(cd => wrap.appendChild(cd.cloneNode(true)));
    parent.appendChild(wrap);
    return cards.length;
  }

  function buildReportSection(key, secNo, res) {
    const def = REPORT_SECTIONS.find(s => s.key === key);
    const sec = document.createElement('section');
    sec.className = 'rpt-section';
    sec.id = `rpt-sec-${key}`;
    let html = `<h2 class="rpt-h2"><span class="rpt-secno">${secNo}</span> ${escapeHtml(def.title)} <span class="rpt-std">${escapeHtml(def.std)}</span></h2>`;
    const sub = (n, txt) => `<h3 class="rpt-h3">${secNo}.${n} ${escapeHtml(txt)}</h3>`;
    const { t, s, h, v, p } = res;
    const blocks = []; // [heading, html?, figs?, traceId?]
    if (key === 'vessel') {
      blocks.push(['Key results', rowsTableHtml(vesselRows(v))]);
      blocks.push(['Diagrams', '', [['vesselBlueprintSvgContainer', 'Vessel elevation blueprint & liquid levels'], ['vesselFillCurveSvgContainer', 'Partial volume / wetted-area curve'], ['vesselLdWeightSvgContainer', 'L/D vs. steel weight optimisation']]]);
      blocks.push(['Calculation trace', '', null, 'vesselEquationSteps']);
    } else if (key === 'scenarios') {
      const b = evaluateAllScenariosForTag(t);
      const g = b.governing || {};
      const rows = (b.evaluated || []).map(ev => [ev.scenarioName || scenarioLabel(ev.scenarioKey), `${fx(ev.allowedOverpressurePct, 0)} %`, fmtPressA(ev.P1_bara),
        fmtFlow(ev.reliefRateKgHr), fmtArea(ev.reqAreaMm2), ev.orifice ? ev.orifice.letter : '—', ev.scenarioKey === g.scenarioKey ? 'GOVERNING' : '']);
      blocks.push(['Scenario summary', `<p class="rpt-p">Governing scenario: <strong>${escapeHtml(g.scenarioName || scenarioLabel(g.scenarioKey))}</strong>.</p>` +
        tableHtml(['API 521 scenario', 'Overpressure', 'Relieving P₁', 'Relief load W', 'Est. required area', 'Orifice', ''], rows)]);
      blocks.push(['Diagrams', '', [['scenarioComparisonChartContainer', 'Scenario required-area comparison'], ['scenarioSvgContainer', `Active scenario schematic (${scenarioLabel(state.activeScenarioKey)})`]]]);
      blocks.push([`Calculation trace — active scenario (${scenarioLabel(state.activeScenarioKey)})`, '', null, 'scenarioTraceContainer']);
    } else if (key === 'psv') {
      blocks.push(['Key results', rowsTableHtml(psvRows(t, s))]);
      blocks.push(['Diagrams', '', [['orificeRadialGaugeContainer', 'Orifice utilisation'], ['valveCutawaySvgContainer', 'PRV mechanical cross-section'], ['kbCurveSvgContainer', 'Backpressure correction Kb / Kw'], ['orificeScaleContainer', 'API 526 orifice scale'], ['pressureLadderContainer', 'Pressure relationship ladder']]]);
      blocks.push(['Calculation trace', '', null, 'sizingEquationSteps']);
    } else if (key === 'hydraulics') {
      blocks.push(['Key results', rowsTableHtml(hydRows(t, h))]);
      blocks.push(['Diagrams', '', [['pipingSchematicSvgContainer', 'PSV inlet / outlet piping schematic'], ['hydraulicPressureProfileSvgContainer', 'Axial pressure profile P₁ → P_in → P_cf → P_bt → P_bs']]]);
      blocks.push(['Calculation trace', '', null, 'hydraulicEquationSteps']);
    } else if (key === 'pump') {
      blocks.push(['Key results', rowsTableHtml(pumpRows(p))]);
      blocks.push(['Diagrams', '', [['pumpSchematicSvgContainer', 'Pump loop schematic'], ['pumpCurveSvgContainer', 'H(Q) and NPSHa / NPSHr curves'], ['pumpWaterfallSvgContainer', 'Differential pressure waterfall']]]);
      blocks.push(['Calculation trace', '', null, 'pumpEquationSteps']);
    } else if (key === 'toolkit') {
      const sums = window.PSVTools ? window.PSVTools.allSummaries() : [];
      const html = sums.length ? sums.map(sm => `<h4 class="rpt-h4">${escapeHtml(sm.title)} <span class="rpt-std">${escapeHtml(sm.std || '')}</span></h4>` +
        ((sm.rows || []).length ? tableHtml(['Parameter', 'Value', 'Units'], sm.rows.map(r => [String(r[0] ?? ''), String(r[1] ?? '—'), String(r[2] ?? '')]), 'rpt-kv') : '<p class="rpt-p">No results available.</p>')).join('')
        : '<p class="rpt-p">No Engineering Toolkit modules are registered.</p>';
      blocks.push(['Module summaries', html]);
    } else if (key === 'register') {
      const rows = state.register.map(item => {
        const r = computeForTag(item);
        return [item.tagNumber, item.service || '', String(item.fluidPhase || '').toUpperCase(), scenarioLabel(item.governingScenarioKey), fmtPressG(item.setPressureBarg),
          fmtFlow(item.flowRateKgHr), fmtArea(r.sizing.reqAreaMm2), `${r.sizing.selectedOrifice.letter} (${r.sizing.selectedOrifice.inletOutFlange})`,
          `${fx(r.hyd.inlet.lossPctOfSet, 2)} %`, `${fx(r.hyd.outlet.totalBackPctOfSet, 1)} %`];
      });
      blocks.push([`Register (${rows.length} tags)`, tableHtml(['Tag', 'Service', 'Phase', 'Scenario', 'P_set', 'W', 'A_req', 'Orifice', 'Inlet ΔP', 'P_bt'], rows, 'rpt-compact')]);
    }
    sec.innerHTML = html;
    let n = 0;
    blocks.forEach(([heading, inner, figs, traceId]) => {
      const holder = document.createElement('div');
      holder.className = 'rpt-block';
      holder.innerHTML = sub(++n, heading) + (inner || '');
      if (figs) {
        const grid = document.createElement('div');
        grid.className = 'rpt-fig-grid';
        if (!appendFigures(grid, figs, secNo)) grid.innerHTML = '<p class="rpt-p">Diagrams not available.</p>';
        holder.appendChild(grid);
      }
      if (traceId && !appendTrace(holder, traceId)) holder.insertAdjacentHTML('beforeend', '<p class="rpt-p">Calculation trace not available.</p>');
      sec.appendChild(holder);
    });
    return sec;
  }

  function buildReportRoot(metaIn) {
    const meta = normalizeReportMeta(metaIn);
    const root = document.getElementById('reportPrintRoot');
    const res = currentResults();
    const t = res.t;
    const keys = REPORT_SECTIONS.map(s => s.key).filter(k => meta.sections[k] !== false);
    const e = escapeHtml;
    const toc = [...keys.map(k => REPORT_SECTIONS.find(s => s.key === k)), { title: 'Assumptions & References', std: '' }];
    root.innerHTML = `
      <section class="rpt-cover">
        <div class="rpt-cover-band">
          <div class="rpt-brand">PSV</div>
          <div>
            <div class="rpt-cover-app">PSVCalc Pro · Process Engineering Calculation Sheet</div>
            <h1 class="rpt-cover-title">${e(meta.title)}</h1>
            <div class="rpt-cover-sub">${e(t.tagNumber)} — ${e(t.service || '')}</div>
          </div>
        </div>
        <table class="rpt-titleblock">
          <tr><th>Project</th><td>${e(meta.project)}</td><th>Document No.</th><td class="mono">${e(meta.docNo)}</td></tr>
          <tr><th>Client</th><td>${e(meta.client)}</td><th>Revision</th><td class="mono">${e(meta.rev)}</td></tr>
          <tr><th>Equipment</th><td>${e(t.equipmentProtected || '')}</td><th>Date</th><td class="mono">${e(meta.date)}</td></tr>
          <tr><th>P&amp;ID</th><td>${e(t.pidNumber || '')}</td><th>Units</th><td>${isUSC() ? 'US Customary' : 'SI / Metric'}</td></tr>
          <tr><th>Discipline</th><td>Process</td><th>Sections</th><td>${toc.length}</td></tr>
        </table>
        <table class="rpt-signoff">
          <thead><tr><th></th><th>Name</th><th>Signature</th><th>Date</th></tr></thead>
          <tbody>
            <tr><th>Prepared</th><td>${e(meta.preparedBy)}</td><td></td><td>${e(meta.date)}</td></tr>
            <tr><th>Checked</th><td>${e(meta.checkedBy)}</td><td></td><td></td></tr>
            <tr><th>Approved</th><td>${e(meta.approvedBy)}</td><td></td><td></td></tr>
          </tbody>
        </table>
        <h3 class="rpt-h3">Revision history</h3>
        ${tableHtml(['Rev', 'Date', 'Description', 'Prepared', 'Checked', 'Approved'], meta.revisions.map(r => [r.rev, r.date, r.desc, r.by, r.chk, r.app]), 'rpt-revtable')}
        <p class="rpt-disclaimer">Computer-generated by PSVCalc Pro. Screening/preliminary methods are identified in the Assumptions section. Results shall be independently checked before use for design, procurement or construction.</p>
      </section>
      <section class="rpt-toc">
        <h2 class="rpt-h2">Table of Contents</h2>
        <ol class="rpt-toc-list">${toc.map(s => `<li><span>${e(s.title)}</span><span class="rpt-std">${e(s.std)}</span></li>`).join('')}</ol>
      </section>`;
    keys.forEach((k, i) => {
      try {
        root.appendChild(buildReportSection(k, i + 1, res));
      } catch (err) {
        console.warn(`Report section ${k} failed:`, err);
      }
    });
    const refs = document.createElement('section');
    refs.className = 'rpt-section';
    refs.id = 'rpt-sec-references';
    const n = keys.length + 1;
    refs.innerHTML = `<h2 class="rpt-h2"><span class="rpt-secno">${n}</span> Assumptions &amp; References</h2>
      <h3 class="rpt-h3">${n}.1 Assumptions and limitations</h3><ol class="rpt-list">${REPORT_ASSUMPTIONS.map(a => `<li>${e(a)}</li>`).join('')}</ol>
      <h3 class="rpt-h3">${n}.2 References</h3><ol class="rpt-list">${REPORT_REFERENCES.map(a => `<li>${e(a)}</li>`).join('')}</ol>`;
    root.appendChild(refs);
    return { sections: root.querySelectorAll('.rpt-section').length, svgs: root.querySelectorAll('svg').length, meta };
  }

  let rptPrevTheme = null;
  const cssStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
  function prepareReportPrint(metaIn, sections) {
    const meta = normalizeReportMeta({ ...(metaIn || state.report || {}), ...(sections ? { sections } : {}) });
    const info = buildReportRoot(meta);
    const html = document.documentElement;
    if (rptPrevTheme === null) {
      rptPrevTheme = html.getAttribute('data-theme') || 'light';
      html.setAttribute('data-theme', 'light'); // print on white paper with light-theme SVG colours
    }
    let style = document.getElementById('reportPageStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'reportPageStyle';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: A4; margin: 15mm 13mm 17mm 13mm;
      @top-left { content: ${cssStr(`PSVCalc Pro — ${meta.title}`)}; font: 7.5pt sans-serif; color: #475569; }
      @top-right { content: ${cssStr(meta.project)}; font: 7.5pt sans-serif; color: #475569; }
      @bottom-left { content: ${cssStr(`Doc. No. ${meta.docNo}  ·  Rev. ${meta.rev}`)}; font: 7.5pt sans-serif; color: #334155; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt sans-serif; color: #334155; } }`;
    document.body.classList.add('report-printing');
    return info;
  }
  function endReportPrint() {
    document.body.classList.remove('report-printing');
    const style = document.getElementById('reportPageStyle');
    if (style) style.remove();
    if (rptPrevTheme !== null) {
      document.documentElement.setAttribute('data-theme', rptPrevTheme);
      rptPrevTheme = null;
    }
  }
  function generateReport() {
    const meta = readReportDialog();
    if (!Object.values(meta.sections).some(Boolean)) { showToast('Select at least one report section.', 'error'); return; }
    state.report = meta;
    scheduleAutosave();
    document.getElementById('reportDialog').close();
    prepareReportPrint(meta);
    window.addEventListener('afterprint', endReportPrint, { once: true });
    window.print();
  }

  function initDeliverables() {
    const $ = (id) => document.getElementById(id);
    const menuBtn = $('btnProjectMenu');
    const menu = $('projectMenuList');
    const setMenu = (open) => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
    menuBtn.addEventListener('click', (ev) => { ev.stopPropagation(); setMenu(menu.hidden); });
    menu.addEventListener('click', (ev) => { if (ev.target.closest('[role="menuitem"]')) setMenu(false); });
    document.addEventListener('click', (ev) => { if (!menu.hidden && !ev.target.closest('#projectMenu')) setMenu(false); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });

    $('btnProjectSave').addEventListener('click', saveProjectFile);
    $('btnProjectOpen').addEventListener('click', () => $('inpOpenProject').click());
    $('inpOpenProject').addEventListener('change', (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = importJsonText(reader.result);
        showToast(res.ok ? res.message : res.error, res.ok ? 'ok' : 'error');
        ev.target.value = '';
      };
      reader.readAsText(file);
    });
    $('btnProjectReport').addEventListener('click', openReportDialog);
    $('btnProjectExcel').addEventListener('click', exportXlsx);
    $('btnProjectShare').addEventListener('click', copyShareLink);
    $('btnProjectSnapshot').addEventListener('click', () => { const c = snapshotCurrentCase(''); showToast(`Snapshot "${c.name}" saved — compare in Step 6.`, 'ok'); });
    $('btnProjectCompare').addEventListener('click', () => { switchTab('tab-register'); $('caseComparePanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); });

    // Report dialog
    $('btnRptAddRev').addEventListener('click', () => {
      const revs = readRevRows();
      const last = revs[revs.length - 1];
      const nextRev = last && /^[A-Y]$/.test(last.rev) ? String.fromCharCode(last.rev.charCodeAt(0) + 1) : (last && /^\d+$/.test(last.rev) ? String(Number(last.rev) + 1) : '');
      revs.push({ rev: nextRev, date: new Date().toISOString().slice(0, 10), desc: '', by: '', chk: '', app: '' });
      renderRevRows(revs.slice(0, 20));
    });
    $('rptRevTbody').addEventListener('click', (ev) => {
      const b = ev.target.closest('.rpt-rev-del');
      if (!b) return;
      const revs = readRevRows();
      revs.splice(Number(b.dataset.idx), 1);
      renderRevRows(revs);
    });
    $('btnReportCancel').addEventListener('click', () => $('reportDialog').close());
    $('reportForm').addEventListener('submit', (ev) => { ev.preventDefault(); generateReport(); });

    // Share banner
    $('btnShareKeep').addEventListener('click', () => resolveShareBanner(true));
    $('btnShareDiscard').addEventListener('click', () => resolveShareBanner(false));
    window.addEventListener('hashchange', () => { if (/^#[sj]=/.test(window.location.hash)) handleSharedHash(window.location.hash); });

    // Case comparison panel (Step 6)
    $('btnSnapshotCase').addEventListener('click', () => {
      const c = snapshotCurrentCase($('caseNameInput').value);
      $('caseNameInput').value = '';
      showToast(`Snapshot "${c.name}" saved.`, 'ok');
    });
    $('caseNameInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $('btnSnapshotCase').click(); } });
    $('caseListContainer').addEventListener('change', (ev) => {
      const cb = ev.target.closest('.case-sel-cb');
      if (!cb) return;
      const id = cb.dataset.id;
      state.caseSel = state.caseSel.filter(x => x !== id);
      if (cb.checked) { state.caseSel.push(id); if (state.caseSel.length > 3) state.caseSel.shift(); }
      renderCasesPanel();
    });
    $('caseListContainer').addEventListener('click', (ev) => {
      const del = ev.target.closest('.case-chip-del');
      if (!del) return;
      state.cases = state.cases.filter(c => c.id !== del.dataset.id);
      saveCasesToStorage();
      renderCasesPanel();
    });
    $('caseCompareTable').addEventListener('click', (ev) => {
      const b = ev.target.closest('.btn-restore-case');
      if (b) restoreCase(b.dataset.id);
    });
    renderCasesPanel();

    // Flush pending autosave when the page is hidden/closed.
    window.addEventListener('pagehide', () => { if (autosaveTimer) { clearTimeout(autosaveTimer); saveWorkspaceNow(); } });
  }

  // Boot application
  document.addEventListener('DOMContentLoaded', () => {
    loadRegisterFromStorage();
    loadCasesFromStorage();
    syncTagToDomInputs();
    syncPumpToDomInputs();
    syncVesselToDomInputs();
    syncPidSystemToDomInputs(true);
    renderScenarioForm();
    initEventListeners();
    // Restore the autosaved workspace (register keeps its own legacy storage key).
    const saved = restoreWorkspaceFromStorage();
    const hashTab = VALID_TABS.includes((window.location.hash || '').replace(/^#/, ''));
    if (saved) applyWorkspace(saved, { register: false, cases: false, tab: !hashTab });
    else recomputeAll();
    autosaveReady = true;
    if (/^#[sj]=/.test(window.location.hash || '')) handleSharedHash(window.location.hash);
  });
})();
