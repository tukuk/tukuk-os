'use strict';
/**
 * Tukuk Code — penjana & penyahpijah kod untuk Tukuk Studio / MCP.
 *
 * Direka supaya BERFUNGSI TANPA LLM (mod "template"): setiap hasil ialah
 * projek kecil yang benar-benar boleh terus dijalankan. Apabila LLM aktif
 * (cloud/Ollama), lapisan atas (mcp/server.js) boleh memperkasa rancangan &
 * kod dengan model — tetapi asas templat ini tetap menjadi jaring keselamatan.
 *
 * TIADA pelaksanaan rangkaian / arbitrary code di sini. `review()` hanya
 * menjalankan `node --check` ke atas fail sementara untuk mengesahkan sintaks.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const KINDS = ['game', 'app', 'node', 'cli', 'html'];

function normalizeKind(kind) {
  const k = String(kind || '').toLowerCase().trim();
  return KINDS.includes(k) ? k : 'app';
}

/** Rancangan berstruktur (fail + langkah) bagi sesuatu jenis projek. */
function planFor(kind, goal) {
  const g = String(goal || 'aplikasi kecil').slice(0, 200);
  const g2 = normalizeKind(kind);
  const plans = {
    game: {
      files: [
        { path: 'index.html', purpose: 'Kanvas + gelung + skor' },
        { path: 'game.js', purpose: 'Logika entiti, input, collision' }
      ],
      steps: [
        'Sediakan <canvas> + requestAnimationFrame loop',
        'Input keyboard/touch (kiri/kanan, R untuk restart)',
        'Spawn objek + pengesanan collision',
        'Skor, keadaan Game Over, polish visual'
      ]
    },
    app: {
      files: [{ path: 'index.html', purpose: 'SPA satu fail dengan localStorage' }],
      steps: ['Struktur HTML + CSS ringkas', 'State di localStorage', 'CRUD minimum (add / list / delete)', 'Render semula selepas setiap tindakan']
    },
    node: {
      files: [
        { path: 'index.mjs', purpose: 'Fungsi tulen (export)' },
        { path: 'index.test.mjs', purpose: 'Ujian node:test' }
      ],
      steps: ['Tulis fungsi sebagai ESM export', 'Ujian dengan `node --test`', 'Pisahkan logika daripada I/O supaya boleh diuji']
    },
    cli: {
      files: [{ path: 'cli.mjs', purpose: 'Parser argv + subcommand' }],
      steps: ['Baca process.argv', 'Dispatch subcommand (hello/sum/...)', 'Output jelas + exit code']
    },
    html: {
      files: [{ path: 'index.html', purpose: 'Halaman statik responsif' }],
      steps: ['Meta viewport + CSS', 'Kandungan semantik', 'Accessible (fokus, kontras)']
    }
  };
  return { goal: g, kind: g2, ...plans[g2] };
}

// ── Templat kod (setiap fail: { path, contents }) ──────────────────────────
// Nota: kandungan di bawah SENGAJA tidak memakai backtick atau ${ supaya boleh
// dibungkus dalam template literal dengan selamat.

const GAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tukuk Game</title>
<style>
  html,body{margin:0;height:100%;background:#0f1115;color:#e6e9ef;font:16px system-ui;display:grid;place-items:center}
  canvas{background:#171a21;border:1px solid #262b36;max-width:96vw;touch-action:none}
  h1{position:fixed;top:8px;left:12px;font-size:14px;color:#9aa3b2}
</style>
</head>
<body>
<h1>Tukuk Game &mdash; arrow keys / A D &middot; R restart &middot; tap left/right on mobile</h1>
<canvas id="c" width="480" height="320"></canvas>
<script src="game.js"></script>
</body>
</html>`;

const GAME_JS = `const c = document.getElementById('c');
const x = c.getContext('2d');
const W = c.width, H = c.height;
let score = 0, dead = false;
const player = { x: W / 2, y: H - 22, r: 10 };
const drops = [];
const keys = {};

addEventListener('keydown', (e) => { keys[e.key] = 1; if (e.key === 'r') reset(); });
addEventListener('keyup', (e) => { keys[e.key] = 0; });
c.addEventListener('pointermove', (e) => {
  const rect = c.getBoundingClientRect();
  player.x = ((e.clientX - rect.left) / rect.width) * W;
});

function reset() { score = 0; dead = false; drops.length = 0; player.x = W / 2; }
function spawn() { drops.push({ x: 10 + Math.random() * (W - 20), y: -8, s: 2 + Math.random() * 2.5 }); }

function step() {
  if (!dead) {
    x.fillStyle = '#171a21'; x.fillRect(0, 0, W, H);
    let vx = 0;
    if (keys.ArrowLeft || keys.a) vx = -3.2;
    if (keys.ArrowRight || keys.d) vx = 3.2;
    player.x = Math.max(player.r, Math.min(W - player.r, player.x + vx));
    if (Math.random() < 0.05) spawn();
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.y += d.s;
      x.fillStyle = '#4c8dff'; x.fillRect(d.x - 4, d.y - 4, 8, 8);
      if (Math.hypot(d.x - player.x, d.y - player.y) < player.r + 5) dead = true;
      if (d.y > H) { drops.splice(i, 1); score++; }
    }
    x.fillStyle = '#e6e9ef'; x.font = '16px system-ui'; x.fillText('Score: ' + score, 10, 22);
    x.fillStyle = '#34d399'; x.beginPath(); x.arc(player.x, player.y, player.r, 0, 7); x.fill();
    if (dead) { x.fillStyle = '#fb7185'; x.font = '24px system-ui'; x.fillText('Game Over - tekan R', 120, H / 2); }
  }
  requestAnimationFrame(step);
}
step();`;

const APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tukuk App</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--text:#e6e9ef;--accent:#4c8dff}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px system-ui;display:grid;place-items:center;min-height:100vh}
  .app{width:min(420px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px}
  h1{margin:0 0 12px;font-size:1.3rem}form{display:flex;gap:8px;margin-bottom:12px}
  input{flex:1;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}
  button{padding:9px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
  ul{list-style:none;margin:0;padding:0}li{padding:9px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;cursor:pointer}
  li:hover{border-color:var(--accent)}
</style>
</head>
<body>
<div class="app">
  <h1>My List</h1>
  <form id="f"><input id="i" placeholder="Type something..." autocomplete="off"><button>Add</button></form>
  <ul id="u"></ul>
</div>
<script>
  var items = [];
  try { items = JSON.parse(localStorage.getItem('tk-items') || '[]'); } catch (e) { items = []; }
  function save(){ localStorage.setItem('tk-items', JSON.stringify(items)); }
  function render(){
    var u = document.getElementById('u'); u.innerHTML = '';
    items.forEach(function (t, n) {
      var li = document.createElement('li'); li.textContent = t;
      li.title = 'Klik untuk buang';
      li.onclick = function () { items.splice(n, 1); save(); render(); };
      u.appendChild(li);
    });
  }
  document.getElementById('f').onsubmit = function (e) {
    e.preventDefault();
    var el = document.getElementById('i'); var v = el.value.trim();
    if (v) { items.push(v); save(); render(); el.value = ''; }
  };
  render();
</script>
</body>
</html>`;

const NODE_MJS = `export function greet(name) {
  return 'Hello, ' + (name || 'Tukuk') + '!';
}

export function sum(list) {
  if (!Array.isArray(list)) throw new TypeError('list must be an array');
  return list.reduce((a, b) => a + Number(b), 0);
}`;

const NODE_TEST_MJS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet, sum } from './index.mjs';

test('greet default', () => assert.equal(greet(), 'Hello, Tukuk!'));
test('greet named', () => assert.equal(greet('A'), 'Hello, A!'));
test('sum adds', () => assert.equal(sum([1, 2, 3]), 6));
test('sum rejects non-array', () => assert.throws(() => sum('nope')));`;

const CLI_MJS = `#!/usr/bin/env node
const args = process.argv.slice(2);
const cmd = args[0] || 'help';

function main() {
  if (cmd === 'hello') {
    console.log('Hello ' + (args[1] || 'world'));
  } else if (cmd === 'sum') {
    const total = args.slice(1).map(Number).reduce((a, b) => a + (b || 0), 0);
    console.log(String(total));
  } else {
    console.log('Usage: node cli.mjs <hello [name] | sum 1 2 3>');
    process.exitCode = cmd === 'help' ? 0 : 1;
  }
}
main();`;

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tukuk Page</title>
<style>
  body{margin:0;font:16px/1.7 system-ui;background:#0f1115;color:#e6e9ef;display:grid;place-items:center;min-height:100vh}
  main{max-width:640px;padding:24px}h1{color:#4c8dff}
</style>
</head>
<body>
<main>
  <h1>Halo Tukuk</h1>
  <p>Halaman responsif asas. Edit kandungan ini untuk memulakan.</p>
</main>
</body>
</html>`;

function filesFor(kind) {
  switch (kind) {
    case 'game': return [{ path: 'index.html', contents: GAME_HTML }, { path: 'game.js', contents: GAME_JS }];
    case 'node': return [{ path: 'index.mjs', contents: NODE_MJS }, { path: 'index.test.mjs', contents: NODE_TEST_MJS }];
    case 'cli': return [{ path: 'cli.mjs', contents: CLI_MJS }];
    case 'html': return [{ path: 'index.html', contents: HTML_PAGE }];
    case 'app':
    default: return [{ path: 'index.html', contents: APP_HTML }];
  }
}

/** Scaffold lengkap bagi sesuatu jenis projek. */
function scaffoldFor(kind, goal) {
  const k = normalizeKind(kind);
  return {
    kind: k,
    goal: String(goal || '').slice(0, 200),
    files: filesFor(k),
    run: k === 'game' || k === 'app' || k === 'html'
      ? 'Buka index.html dalam pelayar (atau muat naik ke Studio).'
      : k === 'node'
        ? 'node --test index.test.mjs'
        : 'node cli.mjs hello Tukuk'
  };
}

/** Sahkan sintaks JS/MJS dengan `node --check`; HTML diberi pemeriksaan ringkas. */
function review(code, lang) {
  const src = String(code || '');
  const l = String(lang || 'js').toLowerCase();
  const hints = [];
  if (/\beval\s*\(/.test(src)) hints.push('elakkan eval() — risiko keselamatan.');
  if (/document\.write\s*\(/.test(src)) hints.push('document.write boleh lambat — guna DOM API.');
  if (/<script>/.test(src) && !/charset/i.test(src)) hints.push('Tambah <meta charset="utf-8">.');

  const isJs = /^(js|mjs|cjs|javascript)$/.test(l);
  if (!isJs) {
    return Promise.resolve({ ok: true, lang: l, hints });
  }
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), 'tukukcode_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.mjs');
    try {
      fs.writeFileSync(file, src);
    } catch (e) {
      return resolve({ ok: false, lang: l, error: 'gagal tulis fail tmp: ' + e.message, hints });
    }
    execFile(process.execPath, ['--check', file], (err, _so, stderr) => {
      try { fs.unlinkSync(file); } catch { /* abaikan */ }
      if (err) resolve({ ok: false, lang: l, error: String(stderr || err.message).slice(0, 500), hints });
      else resolve({ ok: true, lang: l, hints });
    });
  });
}

module.exports = { KINDS, normalizeKind, planFor, scaffoldFor, review };
