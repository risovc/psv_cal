/**
 * Step 7 Engineering Toolkit E2E checks (generic over every registered tool).
 * Usage: node tests/tools_e2e.js http://127.0.0.1:8085/index.html [screenshotDir] [onlyToolId]
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

  // ---- Step 7 Engineering Toolkit: generic plug-in checks ----
  const ONLY = process.argv[4] || '';
  const ids = await evaluate(`window.PSVTools ? window.PSVTools.list().map(t => t.id) : []`);
  await step('Toolkit tab opens and registry lists modules', click('#navTabToolkit') +
    `return document.getElementById('tab-toolkit').classList.contains('active') && document.querySelectorAll('#toolkitNav .toolkit-nav-btn').length === ${ids.length} ? '${ids.join(', ')}' : false;`);
  for (const id of ids.filter(i => !ONLY || i === ONLY)) {
    await step(`Tool ${id}: mounts with inputs, SVG, outputs and calc trace`, click(`#toolkitBtn-${id}`) +
      `const p=document.getElementById('toolPane-${id}'); if(!p||p.style.display==='none') return false; const n={inputs:p.querySelectorAll('input,select').length, svg:p.querySelectorAll('svg').length, metrics:p.querySelectorAll('.metric-box').length, trace:p.querySelectorAll('.eq-step-card').length}; return n.inputs>=3 && n.svg>=1 && n.metrics>=2 && n.trace>=2 ? JSON.stringify(n) : 'FAILCOUNTS '+JSON.stringify(n) && false;`);
    await step(`Tool ${id}: every preset renders cleanly`,
      `const t=window.PSVTools.get('${id}'); const ps=t.presets||[]; for(const pr of ps){ t.setState(JSON.parse(JSON.stringify(pr.state))); await new Promise(r=>setTimeout(r,60)); } return ps.length + ' presets';`);
    await step(`Tool ${id}: editing first numeric input recomputes outputs`,
      `const p=document.getElementById('toolPane-${id}'); const inp=[...p.querySelectorAll('input[type=number]')][0]; if(!inp) return false; const before=p.querySelector('.metric-box')?.innerText; inp.value=String(Number(inp.value||1)*1.5); inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,150)); const after=p.querySelector('.metric-box')?.innerText; return before!==after ? 'changed' : false;`);
    await step(`Tool ${id}: SI -> USC -> SI round-trip keeps state`,
      `const t=window.PSVTools.get('${id}'); const s0=JSON.stringify(t.getState());` + click('#btnUnitUSC') + `const usc=document.getElementById('toolPane-${id}').innerText;` + click('#btnUnitSI') +
      `const s1=JSON.stringify(t.getState()); const a=JSON.parse(s0), b=JSON.parse(s1); const close=(x,y)=>typeof x==='number'&&typeof y==='number'?Math.abs(x-y)<=Math.max(1e-6,Math.abs(x)*0.002):JSON.stringify(x)===JSON.stringify(y); const diffs=Object.keys(a).filter(k=>!close(a[k],b[k])); return diffs.length===0 && usc.length>50 ? 'state preserved' : 'diffs: '+diffs.join(',') && false;`);
    await step(`Tool ${id}: summaryRows() and getState()/setState() round-trip`,
      `const t=window.PSVTools.get('${id}'); const rows=t.summaryRows(); const s=t.getState(); t.setState(JSON.parse(JSON.stringify(s))); return Array.isArray(rows) && rows.length>=4 && rows.every(r=>Array.isArray(r)&&r.length===3) ? rows.length+' rows' : false;`);
    await shot(`toolkit_${id}`);
  }
  await step('Toolkit dark mode renders', click('#btnThemeToggle') + `const ok=document.documentElement.getAttribute('data-theme')==='dark';` + click('#btnThemeToggle') + `return ok;`);

  let pass = 0;
  for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`); if (r.ok) pass++; }
  console.log(`\nJS errors captured: ${errors.length}`);
  errors.forEach(e => console.log('  ' + e));
  console.log(`\n${pass}/${results.length} toolkit UI checks passed`);
  ws.close(); chrome.kill('SIGKILL');
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
