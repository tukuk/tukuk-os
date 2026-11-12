// ═══ CDP playtest for Tukuk OS (/os) — drives headless Chromium ════════════
// Node 22 built-in WebSocket → Chrome DevTools Protocol. No external dependencies.
'use strict';
const fs = require('node:fs');

const BASE = 'http://127.0.0.1:9222';
const URL_TARGET = 'https://tukuk.org/os';

async function json(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error('CDP http ' + r.status + ' ' + path);
  return r.json();
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.events.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  on(method, fn) { if (!this.events.has(method)) this.events.set(method, []); this.events.get(method).push(fn); }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('error', reject);
      ws.addEventListener('open', () => resolve(new CDP(ws)));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function evalJS(cdp, session, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

async function main() {
  const targets = await json('/json/list');
  const page = targets.find((t) => t.type === 'page');
  const cdp = await CDP.connect((await json('/json/version')).webSocketDebuggerUrl);

  // New target for controlled navigation
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  // COLLECT console/pageerror errors
  const consoleErrors = [];
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId).catch(() => {});
  cdp.on('Runtime.exceptionThrown', (p) => consoleErrors.push('EX: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
  cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') consoleErrors.push('LOG: ' + p.entry.text); });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
  const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
  await cdp.send('Page.navigate', { url: URL_TARGET }, sessionId);
  await loaded;
  await sleep(2200); // boot splash fade

  // ── STEP 1: HOME ──
  const home = await evalJS(cdp, sessionId, `(() => {
    var booted = !document.getElementById('boot') || document.getElementById('os').hidden === false;
    var cells = document.querySelectorAll('#grid .cell').length;
    var clock = (document.getElementById('clock')||{}).textContent;
    var dock = document.querySelectorAll('#dock .cell').length;
    var carrier = document.querySelector('#status b') ? document.querySelector('#status b').textContent : '';
    var ph = (document.getElementById('gooQ')||{}).placeholder || '';
    return { boot: booted, cells, clock, dock, carrier, ph };
  })()`);
  check('1. Boot + home grid', home.boot && home.cells >= 10 && home.dock === 5, `cells=${home.cells} dock=${home.dock} clock="${home.clock}" carrier="${home.carrier}" search="${home.ph.slice(0,18)}"`);
  await shot(cdp, sessionId, '/tmp/os-home.png');

  // ── STEP 2: DRAWER + Snake ──
  await evalJS(cdp, sessionId, `document.getElementById('dDrawer').click()`);
  await sleep(300);
  const drawer = await evalJS(cdp, sessionId, `(() => {
    var d = document.getElementById('drawer');
    var wasOpen = d.classList.contains('open');            // read BEFORE the click (launch closes the drawer)
    var secs = [...document.querySelectorAll('#drawerBody h4')].map(h => h.textContent.trim());
    var snake = document.querySelector('#drawerBody [data-app="snake"]');
    if (snake) snake.click();
    return { open: wasOpen, secs, clicked: !!snake };
  })()`);
  await sleep(2500); // the game iframe loads
  const snakeWin = await evalJS(cdp, sessionId, `(() => {
    var w = document.querySelector('#windows .win'); var a = document.getElementById('activity');
    var frame = (w && w.querySelector('iframe')) || (a && a.classList.contains('open') && document.getElementById('actFrame'));
    var src = frame ? frame.getAttribute('src') : null;
    var bodyLen = 0; try { bodyLen = (frame.contentDocument.body.innerText||'').length; } catch(e) {}
    return { hasWin: !!w || (a && a.classList.contains('open')), src, bodyLen };
  })()`);
  check('2. Drawer + Snake game', drawer.open && drawer.secs.length >= 3 && drawer.clicked && snakeWin.hasWin && /snake/.test(snakeWin.src || ''), `sections=[${drawer.secs}] win=${snakeWin.hasWin} src=${snakeWin.src} gameText=${snakeWin.bodyLen} chars`);
  // close
  await evalJS(cdp, sessionId, `(() => { var w=document.querySelector('#windows .win'); if(w) w.querySelector('[data-act="x"]').click(); var x=document.getElementById('actX'); if(x) x.click(); return 1; })()`);
  await sleep(300);

  // ── STEP 3: AI COMMAND "open calculator" (no roundtrip) ──
  await evalJS(cdp, sessionId, `(() => { document.getElementById('dAssist').click(); return 1; })()`);
  await sleep(200);
  await evalJS(cdp, sessionId, `(() => { document.getElementById('aQ').value='open calculator'; document.getElementById('aform').dispatchEvent(new Event('submit',{cancelable:true})); return 1; })()`);
  await sleep(1200);
  const cmd = await evalJS(cdp, sessionId, `(() => {
    var b=[...document.querySelectorAll('#afeed .bub.ai')];
    var last=b[b.length-1]||{};
    var win=document.querySelector('#windows .win') || (document.getElementById('activity').classList.contains('open')?document.getElementById('activity'):null);
    var src = win ? (win.querySelector('iframe')||{}).getAttribute?.('src') : null;
    return { text:(last.textContent||'').slice(0,60), opened: !!win, src };
  })()`);
  check('3. Command "open calculator" (no server)', /Opening/i.test(cmd.text) && cmd.opened && /calc/.test(cmd.src || ''), `"${cmd.text.trim()}" → ${cmd.src}`);

  // ── STEP 4: AI QUESTION (CPU LLM, ≤90s) ──
  await evalJS(cdp, sessionId, `(() => { var el=document.getElementById('aQ'); el.value='what is a cdn cache'; document.getElementById('aform').dispatchEvent(new Event('submit',{cancelable:true})); return 1; })()`);
  let answer = null;
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    answer = await evalJS(cdp, sessionId, `(() => {
      var b=[...document.querySelectorAll('#afeed .bub.ai')]; var last=b[b.length-1]; if(!last) return null;
      var meta=last.querySelector('.meta'); var chips=[...last.querySelectorAll('.apps button')].map(x=>x.textContent.trim());
      return { len:(last.textContent||'').length, thinking:/Thinking/.test(last.textContent||'') && b.length<=2, model: meta?meta.textContent:null, chips };
    })()`);
    if (answer && !answer.thinking && answer.len > 40) break;
  }
  check('4. AI question answered by the CPU LLM', answer && answer.len > 40 && answer.model && !/Thinking on the server/.test(answer.model || ''), `len=${answer && answer.len} model="${answer && answer.model}" chips=${JSON.stringify((answer && answer.chips) || [])}`);
  await evalJS(cdp, sessionId, `(() => { var s=document.getElementById('settings'); s.classList.remove('open'); var d=document.getElementById('assist'); return 1; })()`);
  await shot(cdp, sessionId, '/tmp/os-assistant.png');

  // ── STEP 5: RECENTS ──
  await evalJS(cdp, sessionId, `(() => { document.getElementById('dAssist').click(); return 1; })()`);
  await sleep(150);
  await evalJS(cdp, sessionId, `(() => { document.getElementById('dRecents').click(); return 1; })()`);
  await sleep(300);
  const recents = await evalJS(cdp, sessionId, `(() => {
    var r=document.getElementById('recents'); var cards=[...document.querySelectorAll('#rcards .card')].map(c=>c.textContent.replace(/✕/,'').trim());
    return { open: r.classList.contains('open'), cards };
  })()`);
  check('5. Recents overlay', recents.open && recents.cards.length >= 1, `cards: ${JSON.stringify(recents.cards)}`);

  // ── CONSOLE ERRORS ──
  check('6. No JavaScript errors', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.slice(0, 4).join(' | ') : 'clean');

  await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n═══ PLAYTEST: ${pass}/${results.length} passed ═══`);
  process.exit(pass === results.length ? 0 : 1);
}

async function shot(cdp, session, file) {
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, session);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('   📸 ' + file);
  } catch (e) { console.log('   (screenshot failed: ' + e.message + ')'); }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
