'use strict';
// desktop/main.js — the Electron wrapper, exercised without a display.
//
// `npm run desktop` used to be a promise the repo could not keep: package.json's `main` is
// index.js (the server), so `electron .` started Express inside the Electron main process and
// never opened a window; the wrapper itself spawned `desktop/index.js`, a file that has never
// existed, and then loaded :8000 while the child it started bound :3000. Four independent
// reasons the window had nothing to show, none of them visible without opening it.
//
// Electron is replaced by a stub that records what the wrapper asked for, and the window is
// therefore never drawn. Everything else — which port, which preload, which server entry, and
// whether a running server is reused instead of spawning a second one — is exactly the code
// that ships.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'desktop', 'main.js');

// The harness: stub `electron`, record `child_process.spawn` instead of running it, then load
// the real wrapper. It writes everything it saw to DESKTOP_REPORT.
const HARNESS = `
const fs = require('fs');
const path = require('path');
const Module = require('module');
const cp = require('child_process');

const report = process.env.DESKTOP_REPORT;
const rec = (key, value) => {
  let r = {};
  try { r = JSON.parse(fs.readFileSync(report, 'utf8')); } catch {}
  r[key] = value;
  fs.writeFileSync(report, JSON.stringify(r));
};

const stubPath = path.join(path.dirname(report), 'electron-stub.js');
fs.writeFileSync(stubPath, \`
const fs = require('fs');
const rec = (key, value) => {
  let r = {};
  try { r = JSON.parse(fs.readFileSync(process.env.DESKTOP_REPORT, 'utf8')); } catch {}
  r[key] = value;
  fs.writeFileSync(process.env.DESKTOP_REPORT, JSON.stringify(r));
};
function BrowserWindow(options) {
  rec('window', options);
  this.webContents = { send() {}, openDevTools() {}, reloadIgnoringCache() {} };
  this.loadURL = (url) => rec('url', url);
  this.on = () => {};
  this.reload = () => {};
}
BrowserWindow.getAllWindows = () => [];
module.exports = {
  BrowserWindow,
  app: {
    whenReady: () => Promise.resolve(),
    commandLine: { appendSwitch() {} },
    on() {},
    quit() {}
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} }
};
\`);

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return stubPath;
  return resolve.call(this, request, ...rest);
};

// The wrapper destructures spawn at load time, so this replacement is the one it captures.
cp.spawn = (cmd, args, options) => {
  rec('spawn', {
    cmd,
    args,
    cwd: options && options.cwd,
    env: { PORT: options && options.env && options.env.PORT, HOST: options && options.env && options.env.HOST }
  });
  return { on() {}, kill() {} };
};

require(process.env.DESKTOP_WRAPPER);
setTimeout(() => process.exit(0), 400);
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-wrapper-'));

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function run({ port, serverUp }) {
  const report = path.join(dir, `report-${port}-${serverUp}.json`);
  fs.writeFileSync(report, '{}');
  const harness = path.join(path.dirname(report), `harness-${port}-${serverUp}.js`);
  fs.writeFileSync(harness, HARNESS);

  let server = null;
  const ready = serverUp
    ? new Promise((resolve) => {
        server = http.createServer((req, res) => {
          if (req.url === '/health') { res.writeHead(200); res.end('ok'); } else { res.writeHead(200); res.end('<html></html>'); }
        });
        server.listen(port, '127.0.0.1', resolve);
      })
    : Promise.resolve();

  return ready.then(() => new Promise((resolve, reject) => {
    let out = '';
    const child = require('node:child_process').spawn(process.execPath, [harness], {
      env: { ...process.env, PORT: String(port), DESKTOP_REPORT: report, DESKTOP_WRAPPER: WRAPPER },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => {
      if (server) server.close();
      try { resolve({ seen: JSON.parse(fs.readFileSync(report, 'utf8')), out }); } catch (err) { reject(err); }
    });
  }));
}

test('a server already answering is reused, and the window loads that same port', async () => {
  const port = 18431;
  const { seen, out } = await run({ port, serverUp: true });
  assert.strictEqual(seen.url, `http://127.0.0.1:${port}`, 'the window loads the port the health check asked');
  assert.ok(out.includes('[desktop] local server is already running.'), 'a running server is reused');
  assert.strictEqual(seen.spawn, undefined, 'and no second server is spawned');
});

test('with nothing listening, the child it spawns is the repo server on the same port', async () => {
  const port = 18432;
  const { seen } = await run({ port, serverUp: false });
  assert.ok(seen.spawn, 'a server is spawned when the health check fails');
  assert.strictEqual(seen.spawn.cmd, 'node');
  assert.strictEqual(seen.spawn.args[0], path.join(ROOT, 'index.js'), 'the entry is the real server, not desktop/index.js');
  assert.ok(fs.existsSync(seen.spawn.args[0]), 'and that entry exists');
  assert.strictEqual(seen.spawn.cwd, ROOT, 'it runs from the app root, where index.js expects to be');
  assert.strictEqual(seen.spawn.env.PORT, String(port), 'child and window agree on the port');
  assert.strictEqual(seen.spawn.env.HOST, '127.0.0.1', 'the desktop app does not expose the portal to the LAN');
});

test('the window gets the preload bridge, an existing icon, and a locked-down renderer', async () => {
  const port = 18433;
  const { seen } = await run({ port, serverUp: true });
  const prefs = seen.window.webPreferences;
  assert.strictEqual(prefs.preload, path.join(ROOT, 'desktop', 'preload.js'), 'preload.js is wired, so window.tukukDesktop exists');
  assert.ok(fs.existsSync(prefs.preload), 'and that file exists');
  assert.strictEqual(prefs.nodeIntegration, false);
  assert.strictEqual(prefs.contextIsolation, true);
  assert.ok(fs.existsSync(seen.window.icon), 'the window icon path resolves');
});

test('package.json starts the wrapper, not the server', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const script of ['desktop', 'desktop:dev', 'desktop:no-sandbox']) {
    assert.ok(pkg.scripts[script].includes('desktop/main.js'), `${script} names the wrapper`);
  }
  assert.strictEqual(pkg.build.extraMetadata.main, 'desktop/main.js', 'a packaged build starts the wrapper too');
  assert.ok(fs.existsSync(path.join(ROOT, 'index.js')), 'the server entry the wrapper spawns is still there');
});
