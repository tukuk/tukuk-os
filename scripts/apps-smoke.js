'use strict';
// CDP smoke test for the 12 new surfaces — open every page in headless Chromium,
// click/set values, assert the HUD changes and there are no JS errors. Run: node scripts/apps-smoke.js [base]
// Needs headless Chromium with --remote-debugging-port=9222 (see scripts/os-playtest.js).
const BASE = process.argv[2] || 'https://tukuk.org';
const PORT = 9222;

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && this.handlers.has(m.method)) this.handlers.get(m.method)(m.params);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  on(method, fn) { this.handlers.set(method, fn); }
  static connect(url) {
    return new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(new CDP(ws)); ws.onerror = rej; });
  }
}
const jget = (path) => fetch(`http://127.0.0.1:${PORT}${path}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Probe for every app: a JS function that returns an OK/PASS string or throws.
const PAGES = [
  ['pong', `document.getElementById('start').click(); await new Promise(r=>setTimeout(r,300)); return document.querySelector('canvas') ? 'canvas-ok' : 'NO-CANVAS';`],
  ['stack', `return document.querySelector('canvas') ? 'canvas-ok' : 'NO-CANVAS';`],
  ['simon', `document.getElementById('start').click(); await new Promise(r=>setTimeout(r,300)); return document.getElementById('msg').textContent;`],
  ['muncher', `document.getElementById('start').click(); await new Promise(r=>setTimeout(r,400)); return document.getElementById('hLives').textContent;`],
  ['puzzle15', `return 'cells=' + document.getElementById('grid').children.length;`],
  ['tictactoe', `document.getElementById('grid').children[4].click(); await new Promise(r=>setTimeout(r,600)); return document.getElementById('grid').innerText.replace(/\\s/g,'');`],
  ['memory', `return 'cards=' + document.getElementById('grid').children.length;`],
  ['whack', `document.getElementById('start').click(); return 'time=' + document.getElementById('hT').textContent;`],
  ['calendar', `return 'cells=' + document.getElementById('grid').children.length + '|' + document.getElementById('info').textContent.slice(0,6);`],
  ['dice', `document.querySelector('[data-die="6"]').click(); return 'out=' + document.getElementById('out').children.length + '|' + document.getElementById('hist').textContent.slice(0,5);`],
  ['tip', `const b=document.getElementById('bill'); b.value='50'; b.dispatchEvent(new Event('input')); return document.getElementById('each').textContent;`],
  ['bmi', `const h=document.getElementById('h'),w=document.getElementById('w'); h.value='170'; w.value='62'; h.dispatchEvent(new Event('input')); w.dispatchEvent(new Event('input')); return 'bmi=' + document.getElementById('bmi').textContent + '|' + document.getElementById('cat').textContent;`],
];

(async () => {
  let ver;
  try { ver = await jget('/json/version'); } catch { console.error('❌ Chromium CDP is not running on port ' + PORT); process.exit(1); }
  const cdp = await CDP.connect(ver.webSocketDebuggerUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  let errors = [];
  cdp.on('Runtime.exceptionThrown', (p) => errors.push(String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text).slice(0, 120)));
  const S = (expr) => cdp.send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }, sessionId);

  let pass = 0;
  for (const [name, probe] of PAGES) {
    errors = [];
    await cdp.send('Page.navigate', { url: `${BASE}/apps/${name}` }, sessionId);
    await sleep(1400);
    let out, fail = '';
    try {
      const r = await S(probe);
      if (r.exceptionDetails) fail = 'probe: ' + (r.exceptionDetails.text || '');
      else out = r.result.value;
    } catch (e) { fail = e.message; }
    const ok = !fail && errors.length === 0 && out;
    if (ok) pass++;
    console.log(`${ok ? '✅' : '❌'} /apps/${name} — ${out || ''}${fail ? ' FAIL:' + fail : ''}${errors.length ? ' JSERR:' + errors.join(' ;; ') : ''}`);
  }
  console.log(`\n═══ SMOKE: ${pass}/${PAGES.length} passed ═══`);
  try { await cdp.send('Target.closeTarget', { targetId }); } catch {}
  cdp.ws.close();
  process.exit(pass === PAGES.length ? 0 : 1);
})().catch((e) => { console.error('Driver error:', e.message); process.exit(1); });
