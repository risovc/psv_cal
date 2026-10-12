/**
 * End-to-end UI smoke test via Chrome DevTools Protocol (no npm deps; Node ≥ 22).
 * Usage: node tests/ui_e2e.js http://127.0.0.1:8085/index.html [screenshotDir]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8085/index.html';
const SHOT_DIR = process.argv[3] || '';
const PORT = 9333;

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

  await step('Step 1 tab + 6-scenario comparison bar chart SVG', click('#navTabScenarios') + `return document.getElementById('tab-scenarios').classList.contains('active') && !!document.querySelector('#scenarioComparisonChartContainer svg');`);
  for (const sc of ['fire_liquid', 'fire_gas', 'blocked_outlet', 'cv_failure', 'thermal_expansion', 'tube_rupture']) {
    await step(`Scenario ${sc} renders bespoke SVG + form + trace`, click(`[data-scenario="${sc}"]`) +
      `return !!document.querySelector('#scenarioSvgContainer svg') && document.querySelectorAll('#scenarioInputContainer input, #scenarioInputContainer select').length > 0 && document.getElementById('scenarioTraceContainer').children.length > 0 && document.querySelectorAll('#scenarioSummaryTbody tr').length === 6;`);
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
  await step('Step 5 IPDS switches back to PSV mode', click('#btnIpdsModePsv') +
    `return document.getElementById('ipdsPrintableSheet').innerText.includes('PRESSURE RELIEF VALVE (API 520 / 521 / 526)');`);
  await shot('05_ipds');

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

  let pass = 0;
  for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`); if (r.ok) pass++; }
  console.log(`\nJS errors captured: ${errors.length}`);
  errors.forEach(e => console.log('  ' + e));
  console.log(`\n${pass}/${results.length} UI checks passed`);
  ws.close(); chrome.kill('SIGKILL');
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
