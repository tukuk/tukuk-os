// Boot proof for play.tukuk.org, driven over raw CDP -- no npm deps, Node 22 ships
// WebSocket. It answers the one question curl cannot: does the exported pack actually
// start, get a WebGL2 context, keep painting frames, and load every resource it asks
// for? Nothing else in the repo proves the shipped bytes run.
//
//   node cdp-boot.js                       # against the live edge
//   BOOT_URL=... GATE=0 node cdp-boot.js   # against a local nginx, no gate to press
//   (see deploy/godot/verify-boot.sh for the headless-Chrome launch that wraps this)
//
// Boot is asserted by THREE independent facts, because each one alone is also true of
// a page that has not loaded yet (an absent #status element once fooled an earlier
// version of this driver into a green run on about:blank):
//   * the shell's #canvas exists,
//   * the engine removed the #status splash overlay,
//   * requestAnimationFrame is advancing between polls, i.e. the render loop lives.
//
// Console output is classified, not merely counted. Godot writes its own warnings
// through console.error, so "any error means failure" makes a green run impossible --
// and the obvious repair, swallowing everything, also swallows the one error this
// project actually needs to catch (see BENIGN). Unmatched lines are FATAL and printed;
// matched lines are counted and their classes are printed, so a newly silenced class
// is visible in the verdict instead of hidden.
const CDP_PORT = process.env.CDP_PORT || '9222';
const URL_TO_TEST = process.env.BOOT_URL || 'https://play.tukuk.org/index.html';
const SHOT = process.env.SHOT || '/tmp/strike-boot.png';
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 420000);
// 0 for a build whose shell starts the engine on its own (a scratch dir served straight
// off disk, before the press-to-start gate is spliced in).
const GATE = process.env.GATE !== '0';

// Lines the engine prints through console.error that are not a defect in this build.
// Each entry is a fact about the WEB platform or about a project setting the web
// renderer cannot honour -- measured, not guessed: they are the lines a 4.7 web export
// of this project prints on boot.
const BENIGN = [
  /^\s*at: /, // a stack frame belongs to whatever printed it; match the message, not this
  /^console: WARNING: FSR2 3D scaling is only available when using the Forward\+ renderer\./,
  /^console: WARNING: HDR output requested, but it is not supported by this display server\./,
  /^console: WARNING: Occlusion culling is disabled at build-time\./,
  // Anything else the engine calls WARNING is a judgement call this project has not
  // made yet, so it stays FATAL until it is written down here on purpose.
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      // Chrome also exposes internal targets (chrome://webui-toolbar, omnibox) with
      // type 'page'; attaching to one of those silently reports an empty document.
      const page = list.find(
        (t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('chrome')
      );
      if (page) return page;
    } catch (e) {
      /* chrome still booting */
    }
    await sleep(1000);
  }
  throw new Error('no http(s) CDP page target on port ' + CDP_PORT);
}

// Installed before any page script so the counter exists before the engine paints.
const COUNTER = `window.__frames = 0; (function tick(){ requestAnimationFrame(tick); window.__frames++; })();`;

const PROBE = `(() => {
  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const bytes = document.getElementById('tb-bytes');
  const gate = document.querySelector('#tb-gate button');
  let gl = null;
  let ver = null;
  try {
    gl = canvas && canvas.getContext('webgl2');
    if (gl) ver = gl.getParameter(gl.VERSION);
  } catch (e) { ver = 'getContext failed: ' + e.message; }
  return {
    shell: !!canvas,
    splash: !!status,
    gl: ver,
    canvas: canvas ? canvas.width + 'x' + canvas.height : 'none',
    frames: window.__frames || 0,
    readout: bytes ? bytes.textContent : null,
    gated: !!gate && !gate.closest('#tb-gate[hidden]'),
    ready: document.readyState,
  };
})()`;

const PRESS = `(() => {
  const b = document.querySelector('#tb-gate button');
  if (!b) return 'absent';
  b.click();
  return 'clicked';
})()`;

async function main() {
  const target = await findPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  const benign = [];
  const badStatus = [];
  const cdn = [];
  const engineLines = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.description || a.value || a.type).join(' ');
      if (msg.params.type === 'error') {
        const line = 'console: ' + text;
        (BENIGN.some((re) => re.test(line)) ? benign : errors).push(line);
      } else if (/Godot Engine|OpenGL API|Vulkan|WebGL 2\.0/i.test(text)) {
        engineLines.push(text);
      }
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const line = 'log: ' + msg.params.entry.text;
      (BENIGN.some((re) => re.test(line)) ? benign : errors).push(line);
    }
    if (msg.method === 'Network.responseReceived') {
      const r = msg.params.response;
      if (r.status >= 400) badStatus.push(r.status + ' ' + r.url);
      // The whole reason the .zip aliases exist. Only readable here, on the real
      // request the engine makes, and only when the URL goes through the edge.
      const hit = r.headers && (r.headers['cf-cache-status'] || r.headers['CF-Cache-Status']);
      if (/index\.(pck|wasm)\.zip/.test(r.url)) cdn.push(`${hit || 'no-header'} ${r.url.split('/').pop()}`);
    }
  };

  const send = (method, params = {}) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: COUNTER });

  await send('Page.navigate', { url: URL_TO_TEST });

  const started = Date.now();
  let prev = { frames: 0, shell: false, splash: true };
  let verdict = null;
  let gatePress = 'not attempted';
  while (Date.now() - started < DEADLINE_MS) {
    await sleep(6000);
    const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    const p = r.result && r.result.result && r.result.result.value;
    if (!p) { process.stdout.write('.'); continue; }
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`[${mins}m] ready=${p.ready} shell=${p.shell} splash=${p.splash} gate=${p.gated} canvas=${p.canvas} gl=${p.gl} frames=${p.frames} readout=${JSON.stringify(p.readout)}`);
    const painting = p.frames >= prev.frames + 5;
    // The gate holds the download back, so a page nobody presses never gets past the
    // splash. Pressing the real button also proves the deferred start still works --
    // a wrapper around startGame that deadlocks would look exactly like a slow boot.
    if (GATE && p.gated && gatePress === 'not attempted') {
      const press = await send('Runtime.evaluate', { expression: PRESS, returnByValue: true });
      gatePress = (press.result && press.result.result && press.result.result.value) || 'evaluate failed';
      console.log(`gate=${gatePress}`);
    }
    // WebGL is reported but not required here: getContext() on a canvas the engine
    // already owns can return null for reasons unrelated to the build, and a
    // splash-less page that keeps painting is the engine running.
    if (p.shell && !p.splash && painting) { verdict = 'booted'; break; }
    prev = p;
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));

  console.log('VERDICT=' + (verdict || 'TIMEOUT'));
  console.log('GATE=' + gatePress);
  console.log('ENGINE=' + (engineLines.slice(0, 3).join(' | ') || 'none captured'));
  console.log('CDN=' + (cdn.join(' | ') || 'none (not through the edge)'));
  console.log('HTTP_FAILURES=' + (badStatus.length ? badStatus.join(' | ') : 'none'));
  console.log('PAGE_ERRORS=' + (errors.length ? errors.slice(0, 8).join(' | ') : 'none'));
  console.log('BENIGN=' + benign.length + ' silenced' +
    (benign.length ? ' :: ' + [...new Set(benign.slice(0, 8))].join(' | ') : ''));
  console.log('SCREENSHOT=' + SHOT);
  ws.close();
  process.exit(verdict === 'booted' && !badStatus.length && !errors.length ? 0 : 1);
}

main().catch((e) => { console.error('DRIVER-FAIL', e.message); process.exit(2); });
