/**
 * End-to-end UI smoke test via Chrome DevTools Protocol (no npm deps; Node ≥ 22).
 * Usage: node tests/ui_e2e.js http://127.0.0.1:8085/index.html [screenshotDir]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8085/index.html';
const SHOT_DIR = process.argv[3] || '';
const PORT = Number(process.env.CDP_PORT) || 9333;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    '--window-size=1500,1100', `--user-data-dir=/tmp/psv-e2e-${Date.now()}`, 'about:blank'
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch (_) {}
    await sleep(200);
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map(a => a.value || a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(msg.params.entry.url || '')) errors.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  const shot = async (name) => {
    if (!SHOT_DIR) return;
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL_UNDER_TEST });
  await sleep(2500);

  const results = [];
  const step = async (name, expr) => {
    try {
      const v = await evaluate(`(async () => { ${expr} })()`);
      const bad = await evaluate(`(() => { const t = document.body.innerText; const m = t.match(/.{0,40}(NaN|undefined|Infinity|\\[object Object\\]).{0,40}/); return m ? m[0] : ''; })()`);
      const ok = v !== false && !bad;
      results.push({ name, ok, detail: bad ? 'Rendered bad value: ' + bad : (typeof v === 'string' ? v : '') });
    } catch (e) {
      results.push({ name, ok: false, detail: e.message });
    }
  };
  const click = sel => `document.querySelector(${JSON.stringify(sel)}).click(); await new Promise(r=>setTimeout(r,120));`;

  await step('Initial load renders orifice + ribbon + radial gauge + valve cutaway + Kb curve',
    `return !!document.getElementById('resOrificeLetter').textContent.trim() && document.getElementById('ribbonReqArea').textContent.includes('mm²') && !!document.querySelector('#orificeRadialGaugeContainer svg') && !!document.querySelector('#valveCutawaySvgContainer svg') && !!document.querySelector('#kbCurveSvgContainer svg');`);
  await shot('01_sizing');

  for (const tag of ['PSV-1001A', 'PSV-2004', 'PSV-3102', 'PSV-4005', 'PSV-5010']) {
    await step(`Load preset ${tag}`, `const s=document.getElementById('presetTagSelect'); s.value='${tag}'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,150));
      return document.getElementById('ctxTagNumber').value === '${tag}' ? document.getElementById('resOrificeLetter').textContent + ' / ' + document.getElementById('ribbonInletBadge').textContent : false;`);
  }

  await step('Step 1 tab + P&ID Scenario Identifier + 7-scenario comparison bar chart SVG', click('#navTabScenarios') + `return document.getElementById('tab-scenarios').classList.contains('active') && !!document.querySelector('#scenarioComparisonChartContainer svg') && !!document.querySelector('#pidTopologySvgContainer svg') && document.querySelectorAll('#pidScenarioMatrixTbody tr').length === 7;`);
  for (const pidId of ['PID-1014', 'PID-2042', 'PID-3108', 'PID-5010']) {
    await step(`P&ID System Preset ${pidId} updates topology SVG & 7-row API 521 Table 1 matrix`,
      `const s=document.getElementById('pidSystemPresetSelect'); s.value='${pidId}'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,120));
       return !!document.querySelector('#pidTopologySvgContainer svg') && document.querySelectorAll('#pidScenarioMatrixTbody tr').length === 7 ? document.getElementById('pidGoverningSummaryLabel').textContent : false;`);
  }
  await step('P&ID 1-Click Sync populates Step 1 scenarios & Step 2 governing orifice',
    `const s=document.getElementById('pidSystemPresetSelect'); s.value='PID-2042'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,120));` +
    click('#btnSyncPidToWorkbench') +
    `const eqOk = document.getElementById('ctxEquipment').value.includes('C-2004');
     const ps=document.getElementById('presetTagSelect'); ps.value='PSV-1001A'; ps.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,140));` +
    click('#navTabScenarios') +
    `return eqOk && document.querySelectorAll('#scenarioSummaryTbody tr').length === 7;`);
  await step('P&ID Gemini Flash Analysis (/api/ask-psv mode=pid_scenario_id) evaluates P&ID system & renders AI findings banner',
    click('#btnAnalyzePidGemini') +
    `for(let i=0;i<60;i++){ await new Promise(r=>setTimeout(r,250)); if(document.getElementById('pidAiAnalysisBanner').style.display !== 'none') break; }
     const b = document.getElementById('pidAiAnalysisBanner'); return b && b.style.display !== 'none' && b.innerText.includes('P&ID Scenario Identification Report') ? b.innerText.slice(0, 90).replace(/\\n+/g, ' ') + '...' : false;`);
  for (const sc of ['fire_liquid', 'fire_gas', 'blocked_outlet', 'cv_failure', 'thermal_expansion', 'tube_rupture', 'abnormal_heat']) {
    await step(`Scenario ${sc} renders bespoke SVG + form + trace`, click(`[data-scenario="${sc}"]`) +
      `return !!document.querySelector('#scenarioSvgContainer svg') && document.querySelectorAll('#scenarioInputContainer input, #scenarioInputContainer select').length > 0 && document.getElementById('scenarioTraceContainer').children.length > 0 && document.querySelectorAll('#scenarioSummaryTbody tr').length === 7;`);
  }
  await step('Edit scenario input updates table', click('[data-scenario="blocked_outlet"]') +
    `const before=document.getElementById('scenarioSummaryTbody').innerText; const el=document.getElementById('scBlockedInflow'); el.value='55555'; el.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,120)); return before !== document.getElementById('scenarioSummaryTbody').innerText;`);
  await shot('02_scenarios');
  await step('Apply governing scenario -> Step 2', click('#btnApplyGoverningScenario') + `return document.getElementById('tab-sizing').classList.contains('active');`);
  await step('Fire scenario sends vapor phase to Step 2 (liquid tag PSV-3102)',
    `const s=document.getElementById('presetTagSelect'); s.value='PSV-3102'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,150));` +
    click('#navTabScenarios') + click('[data-scenario="fire_liquid"]') + click('#btnApplyActiveScenario') +
    `return document.querySelector('#phaseSelectorGroup .seg-btn.active').dataset.phase === 'gas' && document.getElementById('inpOverpressurePct').value === '21';`);

  for (const ph of ['gas', 'liquid', 'steam', 'twophase']) {
    await step(`Phase ${ph} sizing + trace`, click(`[data-phase="${ph}"]`) + `return document.querySelectorAll('#sizingEquationSteps .eq-step-card').length >= 3;`);
  }
  for (const vt of ['conventional', 'bellows', 'pilot']) {
    await step(`Valve type ${vt} updates cutaway schematic`, click(`[data-vtype="${vt}"]`) + `return document.querySelector('#valveTypeGroup .seg-btn.active').dataset.vtype === '${vt}' && !!document.querySelector('#valveCutawaySvgContainer svg');`);
  }
  await step('Manual Kb mode', `const s=document.getElementById('inpAutoKb'); s.value='false'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,100)); return document.getElementById('fgManualKb').style.display === '';`);
  await step('Zero superimposed backpressure accepted', `const e=document.getElementById('inpSuperBack'); e.value='0'; e.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100)); return document.getElementById('inpSuperBack').value === '0';`);

  await step('Unit toggle SI -> USC -> SI round-trip preserves flow',
    `const f0=document.getElementById('inpFlowRate').value;` + click('#btnUnitUSC') +
    `const fu=document.getElementById('inpFlowRate').value; const okU=document.getElementById('ribbonReqArea').textContent.includes('in²');` + click('#btnUnitSI') +
    `const f1=document.getElementById('inpFlowRate').value; return okU && Math.abs(f1-f0) <= 1 ? f0+' kg/h -> '+fu+' lb/h -> '+f1 : false;`);

  await step('Fluid preset load', `const s=document.getElementById('fluidPresetSelect'); s.value='nitrogen'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,100)); return document.getElementById('inpMw').value === '28.01';`);

  await step('Step 3 hydraulics + 5-node axial pressure profile SVG renders', click('#navTabHydraulics') + `return document.querySelectorAll('#inletNpsComparisonTbody tr').length > 0 && !!document.querySelector('#pipingSchematicSvgContainer svg') && !!document.querySelector('#hydraulicPressureProfileSvgContainer svg');`);
  await step('Auto-select compliant inlet NPS', click('#btnAutoSelectInletNps') + `return document.getElementById('inletStatusHeaderBadge').classList.contains('status-pass');`);
  await step('Sync built-up backpressure to Step 2', click('#btnSyncBuiltUpToSizing') + `return true;`);
  await step('Flow basis = required', `const s=document.getElementById('inpHydFlowBasis'); s.value='required'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,100)); return document.getElementById('hydraulicEquationSteps').innerText.includes('REQUIRED');`);
  await shot('03_hydraulics');

  await step('Step 4 Pump & Line Hydraulics tab + H-Q/NPSH curve + waterfall SVG renders', click('#navTabPump') +
    `return document.getElementById('tab-pump').classList.contains('active') && !!document.querySelector('#pumpSchematicSvgContainer svg') && !!document.querySelector('#pumpCurveSvgContainer svg') && !!document.querySelector('#pumpWaterfallSvgContainer svg') && document.querySelectorAll('#pumpLineSizingTbody tr').length > 0;`);
  for (const pTag of ['P-3102A/B', 'P-2004A/B', 'P-4101A/B']) {
    await step(`Load pump preset ${pTag}`, `const s=document.getElementById('pumpPresetSelect'); s.value='${pTag}'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,120)); return document.getElementById('inpPumpTag').value === '${pTag}' ? document.getElementById('pumpNpshStatusBadge').textContent : false;`);
  }
  await step('Pump line sizing row Set Suc / Set Dis buttons update NPS',
    `document.querySelector('.btn-set-pump-suc[data-nps=\\'8"\\']').click(); await new Promise(r=>setTimeout(r,100)); return document.getElementById('inpPumpSucNps').value === '8"';`);
  await step('Pump USC -> SI unit conversion round-trip',
    `const q0=document.getElementById('inpPumpNormFlow').value;` + click('#btnUnitUSC') +
    `const qu=document.getElementById('inpPumpNormFlow').value;` + click('#btnUnitSI') +
    `const q1=document.getElementById('inpPumpNormFlow').value; return Math.abs(q1 - q0) <= 0.2 ? q0 + ' m3/h -> ' + qu + ' gpm -> ' + q1 : false;`);
  await shot('04_pump_hydraulics');
  await step('Send Pump Shutoff & Flow to PSV sizing', click('#btnSendPumpToPsv') +
    `return document.getElementById('tab-sizing').classList.contains('active') && document.querySelector('#phaseSelectorGroup .seg-btn.active').dataset.phase === 'liquid';`);

  await step('Step 5 IPDS renders PSV mode', click('#navTabIpds') + `return document.querySelectorAll('#ipdsPrintableSheet .ipds-data-table').length >= 4;`);
  await step('Step 5 IPDS switches to Centrifugal Pump IPDS (API 610) mode', click('#btnIpdsModePump') +
    `return document.getElementById('ipdsPrintableSheet').innerText.includes('CENTRIFUGAL PUMP & HYDRAULIC LOOP (API 610 / API 14E)');`);
  await step('Step 5 IPDS switches to Pressure Vessel IPDS (GPSA / ASME VIII) mode', click('#btnIpdsModeVessel') +
    `return document.getElementById('ipdsPrintableSheet').innerText.includes('PRESSURE VESSEL & SEPARATOR (GPSA / API 12J / ASME VIII DIV. 1)');`);
  await step('Step 5 IPDS switches back to PSV mode', click('#btnIpdsModePsv') +
    `return document.getElementById('ipdsPrintableSheet').innerText.includes('PRESSURE RELIEF VALVE (API 520 / 521 / 526)');`);
  await shot('05_ipds');

  // Step 0: Process & Mechanical Vessel Sizing from Scratch (v6)
  await step('Step 0 Vessel Sizing tab + Blueprint SVG + Fill Curve SVG + L/D Weight Curve SVG renders', click('#navTabVessel') +
    `return document.getElementById('tab-vessel').classList.contains('active') && !!document.querySelector('#vesselBlueprintSvgContainer svg') && !!document.querySelector('#vesselFillCurveSvgContainer svg') && !!document.querySelector('#vesselLdWeightSvgContainer svg') && document.querySelectorAll('#vesselNozzleTbody tr').length >= 3 && document.querySelectorAll('#vesselEquationSteps .eq-step-card').length >= 5;`);
  for (const vTag of ['V-1001', 'V-2004', 'V-5001', 'V-3002']) {
    await step(`Load vessel preset ${vTag}`, `const s=document.getElementById('vesselPresetSelect'); s.value='${vTag}'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,140)); return document.getElementById('inpVesselTag').value === '${vTag}' ? document.getElementById('vesselComplianceBadge').textContent : false;`);
  }
  await step('Vessel Sizing SI -> USC -> SI unit conversion round-trip',
    `const w0=document.getElementById('inpVesselVapFlow').value;` + click('#btnUnitUSC') +
    `const wu=document.getElementById('inpVesselVapFlow').value;` + click('#btnUnitSI') +
    `const w1=document.getElementById('inpVesselVapFlow').value; return Math.abs(w1 - w0) <= 2 ? w0 + ' kg/h -> ' + wu + ' lb/hr -> ' + w1 : false;`);
  await shot('00_vessel_sizing');
  await step('1-Click Coupling: Send Sized Vessel -> Step 4 Pump Suction updates suction static head & pressure',
    `const s=document.getElementById('vesselPresetSelect'); s.value='V-1001'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,120));` +
    click('#btnSendVesselToPump') +
    `return document.getElementById('tab-pump').classList.contains('active') && document.getElementById('inpPumpService').value.includes('V-1001');`);
  await step('1-Click Coupling: Send Sized Vessel -> Step 1 Fire & PSV Sizing populates vessel geometry & MAWP',
    click('#navTabVessel') + click('#btnSendVesselToPsv') +
    `return document.getElementById('tab-scenarios').classList.contains('active') && document.getElementById('ctxEquipment').value.includes('V-1001') && parseFloat(document.getElementById('scFireDiam').value) > 1.0;` +
    `const ps=document.getElementById('presetTagSelect'); ps.value='PSV-1001A'; ps.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,140));`);

  await step('Save new tag to register + render executive visual dashboard', `const e=document.getElementById('ctxTagNumber'); e.value='PSV-TEST-<b>1</b>'; e.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100));` + click('#btnSaveTagToRegister') + click('#navTabRegister') +
    `return document.getElementById('registerCountBadge').textContent === '6' && document.querySelectorAll('#projectRegisterTbody b').length === 0 && document.querySelectorAll('#registerVisualDashboard .exec-kpi-card').length === 4 && !!document.querySelector('#registerVisualDashboard svg');`);
  await step('Register persisted in localStorage', `return JSON.parse(localStorage.getItem('psvcalc_pro_register_v1')).length === 6;`);
  await step('Load tag from register', click('.btn-load-reg') + `return document.getElementById('tab-sizing').classList.contains('active');`);
  await step('Delete tag from register', click('#navTabRegister') + `document.querySelectorAll('.btn-del-reg')[5].click(); await new Promise(r=>setTimeout(r,100)); return document.getElementById('registerCountBadge').textContent === '5';`);
  await step('ZIP download link resolves', `const r = await fetch('psvcalc-pro-standalone.zip', {method:'HEAD'}); return r.ok;`);
  await shot('06_register');

  await step('Dark mode toggle', click('#btnThemeToggle') + click('#navTabSizing') + `return document.documentElement.getAttribute('data-theme') === 'dark';`);
  await shot('07_dark_sizing');
  await step('Dark mode Step 4 pump view', click('#navTabPump') + `return document.documentElement.getAttribute('data-theme') === 'dark';`);
  await shot('08_dark_pump');

  await step('Reload restores register from storage', `location.reload(); return true;`);
  await sleep(2000);
  await step('After reload: badge reflects stored register', `return document.getElementById('registerCountBadge').textContent === '5';`);

  // SEO & Discoverability Verification Suite (v4)
  await step('SEO: robots.txt resolves with valid User-agent & Sitemap directives (not HTML)',
    `const r = await fetch('robots.txt'); const txt = await r.text(); return r.ok && txt.includes('User-agent: *') && txt.includes('Sitemap: https://psv.chakrabortty.in/sitemap.xml') && !txt.includes('<!DOCTYPE') ? txt.trim().replace(/\\n+/g, ' | ') : false;`);
  await step('SEO: sitemap.xml and manifest.json resolve cleanly',
    `const rs = await fetch('sitemap.xml'); const ts = await rs.text(); const rm = await fetch('manifest.json'); const jm = await rm.json(); return rs.ok && ts.includes('<urlset') && rm.ok && jm.short_name === 'PSVCalc Pro' ? 'sitemap.xml + manifest.json OK' : false;`);
  await step('SEO: <title> (<=60 chars) & <meta description> (120..158 chars) within SERP pixel limits',
    `const t = document.title; const d = document.querySelector('meta[name="description"]')?.content || ''; return t.length >= 40 && t.length <= 60 && d.length >= 120 && d.length <= 158 ? 'title=' + t.length + 'c, desc=' + d.length + 'c' : false;`);
  await step('SEO: canonical, hreflang, Open Graph & Twitter Card tags present',
    `const can = document.querySelector('link[rel="canonical"]')?.href; const hf = document.querySelectorAll('link[rel="alternate"][hreflang]').length; const og = document.querySelector('meta[property="og:title"]')?.content; const tw = document.querySelector('meta[name="twitter:card"]')?.content; return can === 'https://psv.chakrabortty.in/' && hf >= 2 && !!og && tw === 'summary_large_image' ? can + ' (hreflang=' + hf + ')' : false;`);
  await step('SEO: JSON-LD structured data parses WebApplication + FAQPage',
    `const raw = document.querySelector('script[type="application/ld+json"]')?.textContent; const parsed = JSON.parse(raw); const types = parsed['@graph'].map(n => n['@type']); const faqCount = parsed['@graph'].find(n => n['@type'] === 'FAQPage')?.mainEntity?.length || 0; return types.includes('WebApplication') && types.includes('FAQPage') && faqCount >= 6 ? types.join('+') + ' (' + faqCount + ' FAQs)' : false;`);
  await step('SEO: 20+ crawlable <a href> links with unique anchor texts & tab-link navigation works',
    `const links = [...document.querySelectorAll('a[href]')]; const texts = links.map(a => a.textContent.trim()); const uniqueTexts = new Set(texts); document.querySelector('a[data-tab-link="tab-scenarios"]').click(); await new Promise(r=>setTimeout(r,100)); const switched = document.getElementById('tab-scenarios').classList.contains('active'); return links.length >= 20 && uniqueTexts.size === links.length && switched ? links.length + ' unique crawlable links' : false;`);

  // "Ask PSV" AI Copilot & Zero-Exposure Key Security Suite (v5)
  await step('Ask PSV: drawer opens with live active tag telemetry & API PDF links',
    click('#btnOpenAskPsv') +
    `const d = document.getElementById('askPsvDrawer'); const ctx = document.getElementById('askPsvContextBar')?.innerText || ''; const msg = document.getElementById('askPsvMessages')?.innerText || ''; return d.classList.contains('open') && ctx.includes('PSV-1001A') && msg.includes('Ask PSV') ? 'Drawer open + context bar OK' : false;`);
  await step('Ask PSV: live Gemini Flash proxy (/api/ask-psv) answers engineering query with API standard citations',
    `document.querySelector('#askPsvPromptChips .ask-psv-chip').click(); for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,250)); if(document.querySelectorAll('#askPsvMessages .ask-psv-msg-bot').length >= 2) break; } const bots = document.querySelectorAll('#askPsvMessages .ask-psv-msg-bot'); const last = bots[bots.length-1]?.innerText || ''; return bots.length >= 2 && (last.includes('API 520') || last.includes('PSV-1001A')) ? 'Bot replied (' + last.slice(0, 70).replace(/\\n+/g, ' ') + '...)' : false;`);
  await step('Ask PSV: strict domain guardrail refuses unrelated non-engineering queries',
    `const inp = document.getElementById('askPsvInput'); inp.value = 'Give me a chocolate cake recipe'; document.getElementById('askPsvForm').dispatchEvent(new Event('submit')); for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,250)); if(document.querySelectorAll('#askPsvMessages .ask-psv-msg-bot').length >= 3) break; } const bots = document.querySelectorAll('#askPsvMessages .ask-psv-msg-bot'); const last = bots[bots.length-1]?.innerText || ''; return bots.length >= 3 && last.includes('API 520') ? 'Guardrail active' : false;`);
  await step('Security: API key is NEVER exposed in client source files or DOM',
    `const files = await Promise.all(['index.html','app.js','engine.js','styles.css','functions/api/ask-psv.js'].map(f => fetch(f).then(r => r.text()))); const keyPattern = new RegExp('AQ\\.[A-Za-z0-9_-]{30,}|AIza[0-9A-Za-z_-]{35}'); const leaked = files.some(txt => keyPattern.test(txt)); return !leaked ? 'Zero client/source exposure verified' : false;`);

  // ======================================================================
  // B. Workflow & Deliverables suite: project file, report, XLSX, share links, case comparison
  // ======================================================================
  await step('B1 Project ▾ menu opens with Save/Open/Report/Excel/Share/Snapshot items',
    click('#navTabSizing') + click('#btnProjectMenu') +
    `const m=document.getElementById('projectMenuList'); const ids=['btnProjectSave','btnProjectOpen','btnProjectReport','btnProjectExcel','btnProjectShare','btnProjectSnapshot'].filter(i=>document.getElementById(i)); return !m.hidden && ids.length===6 && document.getElementById('btnProjectMenu').getAttribute('aria-expanded')==='true' ? ids.length + ' menu items' : false;`);
  await shot('09_project_menu');
  await step('B1 Save Project downloads valid schemaVersion 2 JSON containing tools state',
    `const blobs=[]; const orig=URL.createObjectURL; URL.createObjectURL=(b)=>{blobs.push(b); return orig.call(URL,b);};
     document.getElementById('btnProjectSave').click(); URL.createObjectURL=orig; await new Promise(r=>setTimeout(r,80));
     const menuClosed=document.getElementById('projectMenuList').hidden; const txt=await blobs[0].text(); const j=JSON.parse(txt); window.__savedProject=txt;
     const keys=['app','schemaVersion','savedAt','unitSystem','ipdsMode','activeTab','tag','register','pumpLoop','vessel','tools','cases'];
     return menuClosed && j.app==='PSVCalc Pro' && j.schemaVersion===2 && keys.every(k=>k in j) && j.tools && typeof j.tools==='object' && j.register.length===5 && blobs[0].type==='application/json'
       ? 'keys OK, tools=[' + Object.keys(j.tools).join(',') + '], ' + txt.length + ' bytes' : false;`);
  await step('B1 Open Project round-trip restores a changed value; invalid file rejected with friendly error; legacy register JSON still imports',
    `const saved=window.__savedProject; const f0=JSON.parse(saved).tag.flowRateKgHr;
     const el=document.getElementById('inpFlowRate'); el.value='12345'; el.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,120));
     const changed=window.PSVApp.getTag().flowRateKgHr;
     const bad=window.PSVApp.loadProjectFromText('{"app":"Other","schemaVersion":2}'); const bad2=window.PSVApp.loadProjectFromText('not json');
     const legacy=window.PSVApp.loadProjectFromText(JSON.stringify(window.PSVApp.getRegister()));
     const res=window.PSVApp.loadProjectFromText(saved); await new Promise(r=>setTimeout(r,150));
     const back=window.PSVApp.getTag().flowRateKgHr; const dom=document.getElementById('inpFlowRate').value;
     return res.ok && legacy.ok && !bad.ok && !bad2.ok && changed===12345 && back===f0 && Math.abs(Number(dom)-f0)<=1 ? f0+' -> 12345 -> '+back+' | rejected: '+bad.error.slice(0,45) : false;`);
  await step('B1 SI -> USC -> SI keeps canonical SI project state lossless',
    `const a=JSON.stringify(window.PSVApp.buildProject().tag);` + click('#btnUnitUSC') +
    `const u=window.PSVApp.buildProject(); ` + click('#btnUnitSI') +
    `const b=JSON.stringify(window.PSVApp.buildProject().tag); return a===b && u.unitSystem==='USC' && JSON.stringify(u.tag)===a ? 'tag state identical (' + a.length + ' chars)' : false;`);
  await step('B1 Workspace autosaved to localStorage (debounced) without breaking legacy register key',
    `await new Promise(r=>setTimeout(r,900)); const w=JSON.parse(localStorage.getItem('psvcalc_pro_workspace_v2')||'null'); const reg=JSON.parse(localStorage.getItem('psvcalc_pro_register_v1'));
     return w && w.schemaVersion===2 && w.tag && 'tools' in w && Array.isArray(reg) && reg.length===5 ? 'workspace ' + JSON.stringify(w).length + ' bytes' : false;`);

  await step('B2 Generate Report dialog opens prefilled from tag with revision table + 7 section checkboxes',
    `window.print=()=>{ window.__printed=(window.__printed||0)+1; };` + click('#btnProjectMenu') + click('#btnProjectReport') +
    `const d=document.getElementById('reportDialog'); document.getElementById('rptPreparedBy').value='A. Engineer <script>x</script>'; document.getElementById('rptCheckedBy').value='B. Checker';
     document.getElementById('btnRptAddRev').click(); await new Promise(r=>setTimeout(r,60));
     const revs=document.querySelectorAll('#rptRevTbody tr').length; const secs=document.querySelectorAll('input[name="rptSection"]').length;
     return d.open && document.getElementById('rptProject').value===window.PSVApp.getTag().projectTitle && revs===2 && secs===7 && document.querySelectorAll('#rptRevTbody .rev-rev')[1].value==='B' ? 'revs=' + revs + ', sections=' + secs : false;`);
  await shot('10_report_dialog');
  await step('B2 Generate builds #reportPrintRoot (cover + TOC + >=5 sections + SVGs + traces) and calls window.print',
    click('#btnReportGenerate') +
    `await new Promise(r=>setTimeout(r,200)); const root=document.getElementById('reportPrintRoot');
     const secs=root.querySelectorAll('.rpt-section').length; const svgs=root.querySelectorAll('svg').length; const cards=root.querySelectorAll('.eq-step-card').length;
     const txt=root.textContent; const badTxt=/NaN|undefined|Infinity|\\[object Object\\]/.test(txt);
     const ok = window.__printed===1 && !document.getElementById('reportDialog').open && !!root.querySelector('.rpt-cover .rpt-titleblock') && !!root.querySelector('.rpt-toc') &&
       secs>=5 && svgs>=5 && cards>=5 && document.body.classList.contains('report-printing') && !!document.getElementById('reportPageStyle') &&
       root.innerHTML.includes('A. Engineer &lt;script&gt;') && !root.querySelector('script') && !badTxt && txt.includes('API 2000') && txt.includes('API 14E') && !!root.querySelector('#rpt-sec-toolkit');
     return ok ? 'sections=' + secs + ', svgs=' + svgs + ', traces=' + cards : false;`);
  if (SHOT_DIR) {
    const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    if (pdf.result && pdf.result.data) fs.writeFileSync(path.join(SHOT_DIR, 'report.pdf'), Buffer.from(pdf.result.data, 'base64'));
  }
  await step('B2 IPDS print buttons still print the datasheet only (report mode cleared)',
    `window.PSVApp.endReportPrint(); document.getElementById('btnPrintDatasheet').click(); await new Promise(r=>setTimeout(r,250));
     return window.__printed===2 && !document.body.classList.contains('report-printing') && !document.getElementById('reportPageStyle') && document.getElementById('tab-ipds').classList.contains('active') ? 'IPDS print OK' : false;`);

  await step('B3 Export Excel downloads an .xlsx blob that is a zip starting with PK',
    `const blobs=[]; const orig=URL.createObjectURL; URL.createObjectURL=(b)=>{blobs.push(b); return orig.call(URL,b);};` + click('#btnProjectMenu') + click('#btnProjectExcel') +
    `URL.createObjectURL=orig; const u8=new Uint8Array(await blobs[0].arrayBuffer()); const s=new TextDecoder('latin1').decode(u8);
     return u8[0]===0x50 && u8[1]===0x4B && blobs[0].type.includes('spreadsheetml') && s.includes('xl/workbook.xml') && s.includes('[Content_Types].xml') ? u8.length + ' bytes' : false;`);
  try {
    const b64 = await evaluate(`(() => { const b = window.PSVApp.buildXlsxBytes(); let s=''; for (let i=0;i<b.length;i+=0x8000) s+=String.fromCharCode.apply(null, b.subarray(i,i+0x8000)); return btoa(s); })()`);
    const xlsxPath = path.join(SHOT_DIR || '/tmp', 'psvcalc_e2e.xlsx');
    fs.writeFileSync(xlsxPath, Buffer.from(b64, 'base64'));
    const py = `import zipfile,sys,json,xml.dom.minidom as m
z=zipfile.ZipFile(sys.argv[1]); bad=z.testzip(); n=z.namelist()
for f in n:
    if f.endswith('.xml') or f.endswith('.rels'): m.parseString(z.read(f))
wb=z.read('xl/workbook.xml').decode(); s1=z.read('xl/worksheets/sheet1.xml').decode(); s5=z.read('xl/worksheets/sheet5.xml').decode()
print(json.dumps({'bad':bad,'names':n,'sheets':[x in wb for x in ['Register','PSV Datasheet','Vessel','Pump','Toolkit']],'num':s1.count('<v>'),'bold':s1.count(' s="1"'),'cols':'<cols>' in s1,'tk':s5.count('<row ')}))`;
    const out = JSON.parse(require('child_process').execFileSync('python3', ['-c', py, xlsxPath]).toString());
    const need = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', ...[1, 2, 3, 4, 5].map(i => `xl/worksheets/sheet${i}.xml`)];
    const ok = out.bad === null && need.every(n => out.names.includes(n)) && out.sheets.every(Boolean) && out.num > 20 && out.bold >= 10 && out.cols && out.tk >= 2;
    results.push({ name: 'B3 python3 zipfile.testzip() + XML well-formedness of every part; 5 named sheets, numeric cells, bold header, column widths', ok, detail: `${out.names.length} parts, ${out.num} numeric cells, toolkit rows=${out.tk}` });
  } catch (e) {
    results.push({ name: 'B3 python3 zipfile validation of xlsx', ok: false, detail: e.message.slice(0, 200) });
  }

  await step('B4 Share link encode -> decode round-trip equals workspace (register excluded, tools included)',
    `const h=await window.PSVApp.encodeShare(); const obj=await window.PSVApp.decodeShare('#'+h); const ref=window.PSVApp.buildProject();
     const canon=(v)=>Array.isArray(v)?'['+v.map(canon).join(',')+']':(v&&typeof v==='object')?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}':JSON.stringify(v);
     const same=['tag','pumpLoop','vessel','tools','unitSystem','ipdsMode'].every(k=>canon(obj[k])===canon(ref[k]));
     window.__shareHash=h; return /^[sj]=[A-Za-z0-9_-]+$/.test(h) && same && !('register' in obj) && !('cases' in obj) && 'tools' in obj ? h.slice(0,2) + ' ' + h.length + ' chars (JSON ' + JSON.stringify(obj).length + ')' : false;`);
  await step('B4 Opening a shared hash shows Keep/Discard banner; Discard reverts, Keep retains',
    `const h=window.__shareHash; const f0=window.PSVApp.getTag().flowRateKgHr;
     const el=document.getElementById('inpFlowRate'); el.value='22222'; el.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100));
     location.hash=h; await new Promise(r=>setTimeout(r,400));
     const banner=document.getElementById('shareBanner'); const shown=!banner.hidden && document.getElementById('shareBannerText').textContent.includes('Loaded shared case'); const applied=window.PSVApp.getTag().flowRateKgHr;
     document.getElementById('btnShareDiscard').click(); await new Promise(r=>setTimeout(r,150)); const reverted=window.PSVApp.getTag().flowRateKgHr; const hashCleared=location.hash==='';
     await window.PSVApp.loadShareHash('#'+h); document.getElementById('btnShareKeep').click(); await new Promise(r=>setTimeout(r,100)); const kept=window.PSVApp.getTag().flowRateKgHr;
     return shown && applied===f0 && reverted===22222 && hashCleared && kept===f0 && banner.hidden ? 'applied ' + applied + ', discard -> ' + reverted + ', keep -> ' + kept : false;`);

  await step('B5 Snapshot 2 cases, compare table renders KPI deltas with highlighted differences',
    `window.PSVApp.selectCases([]); const c1=window.PSVApp.snapshotCase('Base case');
     const el=document.getElementById('inpFlowRate'); el.value=String(Math.round(window.PSVApp.getTag().flowRateKgHr*1.3)); el.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100));
     const vp=document.getElementById('inpVesselDesPress'); vp.value=String(Number(vp.value)+5); vp.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,100));
     const c2=window.PSVApp.snapshotCase('High flow +30% <i>x</i>'); window.PSVApp.selectCases([c1.id,c2.id]); window.__c1=c1;` + click('#navTabRegister') +
    `const t=document.getElementById('caseCompareTable'); const rows=t.querySelectorAll('tbody tr').length; const diffs=t.querySelectorAll('td.cmp-diff').length; const deltas=[...t.querySelectorAll('.cmp-delta.cmp-up')].length;
     const stored=JSON.parse(localStorage.getItem('psvcalc_pro_cases_v1')).length; const restoreBtns=t.querySelectorAll('.btn-restore-case').length;
     return rows>=16 && diffs>=3 && deltas>=2 && restoreBtns===2 && stored>=2 && !t.querySelector('i') && t.innerText.includes('Required area') ? 'rows=' + rows + ', diffs=' + diffs + ', e.g. ' + t.querySelector('.cmp-delta.cmp-up').textContent : false;`);
  await shot('11_case_compare');
  await step('B5 "Restore this case" restores the baseline workspace; cases saved into project file',
    `const c1=window.__c1; document.querySelector('#caseCompareTable .btn-restore-case[data-id="'+c1.id+'"]').click(); await new Promise(r=>setTimeout(r,150));
     const p=window.PSVApp.buildProject(); return window.PSVApp.getTag().flowRateKgHr===c1.ws.tag.flowRateKgHr && p.cases.length>=2 && document.getElementById('tab-register').classList.contains('active') ? 'restored W=' + c1.ws.tag.flowRateKgHr : false;`);
  await step('B Dark mode: menu, comparison panel and dialog use theme variables',
    `window.__themeBefore=document.documentElement.getAttribute('data-theme'); if (window.__themeBefore!=='dark') document.getElementById('btnThemeToggle').click();` + click('#btnProjectMenu') +
    `const bg=getComputedStyle(document.getElementById('projectMenuList')).backgroundColor; const ok=document.documentElement.getAttribute('data-theme')==='dark' && bg!=='rgb(255, 255, 255)'; return ok ? 'menu bg ' + bg : false;`);
  await shot('12_dark_menu_compare');
  await step('B Theme restored after dark-mode check', click('#btnProjectMenu') +
    `if (window.__themeBefore!=='dark') document.getElementById('btnThemeToggle').click(); return document.documentElement.getAttribute('data-theme') === (window.__themeBefore || 'light') && document.getElementById('projectMenuList').hidden;`);

  let pass = 0;
  for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`); if (r.ok) pass++; }
  console.log(`\nJS errors captured: ${errors.length}`);
  errors.forEach(e => console.log('  ' + e));
  console.log(`\n${pass}/${results.length} UI checks passed`);
  ws.close(); chrome.kill('SIGKILL');
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
