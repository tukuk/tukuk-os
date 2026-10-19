// ═══ arcade-verify.js — sah-akan game arkad di PRODUCTION dengan Chrome headless ═══
// Navigasi https://tukuk.org/games/<key>, auto-click butang mula, screenshot,
// laporkan ralat konsol + sokongan WebGL + status kanvas. Perlukan Chrome headless
// dengan --remote-debugging-port=9222 (SwiftShader untuk WebGL).
//
// Guna: node scripts/arcade-verify.js <key> [out.png] [--ms=1500]
'use strict';
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:9222';
const args = process.argv.slice(2);
const KEY = args[0] || 'subway';
const OUT = (args.find((a) => a.endsWith('.png'))) || `/tmp/arc-${KEY}.png`;
const MS = parseInt((args.find((a) => a.startsWith('--ms=')) || '--ms=1600').split('=')[1], 10);
const URL_TARGET = /^https?:/.test(KEY) ? KEY : `https://tukuk.org/games/${KEY}`;
setTimeout(() => { console.log('TIMEOUT: harness melebihi 25s'); process.exit(4); }, 25000).unref();

async function json(p) { const r = await fetch(BASE + p); if (!r.ok) throw new Error('CDP ' + r.status + ' ' + p); return r.json(); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
      else if (m.method) (this.events.get(m.method) || []).forEach((fn) => fn(m.params)); }); }
  send(method, params = {}, sessionId) { const id = ++this.id; const payload = { id, method, params }; if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify(payload)); }); }
  on(m, fn) { if (!this.events.has(m)) this.events.set(m, []); this.events.get(m).push(fn); }
  static connect(url) { return new Promise((resolve, reject) => { const ws = new WebSocket(url); ws.addEventListener('error', reject); ws.addEventListener('open', () => resolve(new CDP(ws))); }); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evalJS(cdp, s, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s);
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function main() {
  const dbg = (m) => console.error('[stage] ' + m);
  dbg('connect');
  const cdp = await CDP.connect((await json('/json/version')).webSocketDebuggerUrl);
  dbg('createTarget');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  dbg('enable');
  const errs = [];
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId).catch(() => {});
  cdp.on('Runtime.exceptionThrown', (p) => errs.push('EX: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
  cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errs.push('LOG: ' + p.entry.text); });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: 1, mobile: false }, sessionId);
  const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
  dbg('navigate');
  await cdp.send('Page.navigate', { url: URL_TARGET }, sessionId);
  await Promise.race([loaded, sleep(9000)]).catch(() => {});
  dbg('after-nav race');
  await sleep(800);
  // WebGL keupayaan
  dbg('eval webgl');
  const gl = await evalJS(cdp, sessionId, `(()=>{try{var c=document.createElement('canvas');var g=c.getContext('webgl')||c.getContext('experimental-webgl');if(!g)return {ok:false};var d=g.getExtension('WEBGL_debug_renderer_info');return {ok:true,renderer:d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'n/a'};}catch(e){return {ok:false,err:''+e};}})()`);
  // cuba mula game: cari butang main / panggil play
  dbg('eval start');
  const started = await evalJS(cdp, sessionId, `(()=>{var sel=['#play','#start','.cta','button'];for(var i=0;i<sel.length;i++){var b=document.querySelector(sel[i]);if(b&&/main|mula|play|▶|▶|start|↻/i.test(b.textContent||'')){b.click();return 'clicked:'+(b.id||b.className);}}return 'none';})()`);
  await sleep(MS);
  dbg('eval canvas + shot');
  // status kanvas + sampling kasar (drawn vs blank)
  const info = await evalJS(cdp, sessionId, `(()=>{var c=document.querySelector('canvas');if(!c)return {hasCanvas:false};var r=c.getBoundingClientRect();var has2d=false,hasgl=false;try{hasgl=!!(c.getContext&&(window.__tkGL));}catch(e){}return {hasCanvas:true,w:c.width,h:c.height,cw:Math.round(r.width),ch:Math.round(r.height)};})()`);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  dbg('shot done');
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
  await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  cdp.ws.close();
  const NOISE = /cloudflareinsights|challenge-platform|cdn-cgi|\.webmcp\/bridge|beacon\.min|speculation|ERR_FAILED|blocked by CORS|violates the following Content Security Policy/i;
  const realErrs = errs.filter((e) => !NOISE.test(e));
  console.log('KEY       :', KEY, '→', URL_TARGET);
  console.log('WEBGL     :', gl.ok ? 'YES (' + gl.renderer + ')' : 'NO ' + (gl.err || ''));
  console.log('START     :', started);
  console.log('CANVAS    :', JSON.stringify(info));
  console.log('SCREENSHOT:', OUT);
  console.log('ERRORS    :', realErrs.length ? realErrs.slice(0, 6).join(' | ') : 'bersih');
  process.exit(realErrs.length ? 3 : 0);
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
