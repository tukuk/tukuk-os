'use strict';
/**
 * Tukuk Code — code generator & scaffolder for Tukuk Studio / MCP.
 *
 * Designed to WORK WITHOUT AN LLM ("template" mode): every result is
 * a small project that genuinely runs out of the box. When an LLM is active
 * (cloud/Ollama), the layer above (mcp/server.js) can enrich the plan &
 * code with the model — but this template base stays as the safety net.
 *
 * NO network execution / arbitrary code here. `review()` only
 * runs `node --check` on a temporary file to confirm the syntax.
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

/** A structured plan (files + steps) for a given project kind. */
function planFor(kind, goal) {
  const g = String(goal || 'small app').slice(0, 200);
  const g2 = normalizeKind(kind);
  const plans = {
    game: {
      files: [
        { path: 'index.html', purpose: 'Canvas + loop + score' },
        { path: 'game.js', purpose: 'Entity logic, input, collision' }
      ],
      steps: [
        'Set up <canvas> + requestAnimationFrame loop',
        'Keyboard/touch input (left/right, R to restart)',
        'Spawn objects + collision detection',
        'Score, Game Over state, visual polish'
      ]
    },
    app: {
      files: [{ path: 'index.html', purpose: 'Single-file SPA with localStorage' }],
      steps: ['Simple HTML + CSS structure', 'State in localStorage', 'Minimum CRUD (add / list / delete)', 'Re-render after every action']
    },
    node: {
      files: [
        { path: 'index.mjs', purpose: 'Pure functions (export)' },
        { path: 'index.test.mjs', purpose: 'node:test tests' }
      ],
      steps: ['Write functions as ESM exports', 'Test with `node --test`', 'Separate logic from I/O so it can be tested']
    },
    cli: {
      files: [{ path: 'cli.mjs', purpose: 'argv parser + subcommands' }],
      steps: ['Read process.argv', 'Dispatch subcommands (hello/sum/...)', 'Clear output + exit code']
    },
    html: {
      files: [{ path: 'index.html', purpose: 'Responsive static page' }],
      steps: ['Viewport meta + CSS', 'Semantic content', 'Accessible (focus, contrast)']
    }
  };
  return { goal: g, kind: g2, ...plans[g2] };
}

// ── Code templates (each file: { path, contents }) ──────────────────────────
// Note: the contents below DELIBERATELY avoid backticks and ${ so they can be
// wrapped safely inside a template literal.

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
    if (dead) { x.fillStyle = '#fb7185'; x.font = '24px system-ui'; x.fillText('Game Over - press R', 120, H / 2); }
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
      li.title = 'Click to remove';
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
  <h1>Hello Tukuk</h1>
  <p>A basic responsive page. Edit this content to get started.</p>
</main>
</body>
</html>`;

// ── Ready-to-run (single-file) templates ── the more we have, the less LLM ──
// Each file is one complete HTML with no external library & NO backtick/${
// so it is safe to wrap as a template literal (the convention of this file).
const SNAKE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snake</title>
<style>html,body{margin:0;height:100%;background:#0f1115;color:#e6e9ef;font:16px system-ui;display:grid;place-items:center}canvas{background:#171a21;border:1px solid #262b36}#s{position:fixed;top:8px;left:12px;color:#9aa3b2}</style>
</head><body><div id="s">Snake &mdash; arrow keys / swipe &middot; R restart</div><canvas id="c" width="360" height="360"></canvas>
<script>
var c=document.getElementById('c'),x=c.getContext('2d'),G=18,N=c.width/G,snake=[{x:8,y:8}],dir={x:1,y:0},next=dir,food={x:12,y:8},score=0,dead=false;
function place(){food={x:(Math.random()*N)|0,y:(Math.random()*N)|0};}
function reset(){snake=[{x:8,y:8}];dir={x:1,y:0};next=dir;score=0;dead=false;place();}
addEventListener('keydown',function(e){var k=e.key;if(k==='r'){reset();return;}if(k==='ArrowLeft'&&dir.x===0){next={x:-1,y:0};}if(k==='ArrowRight'&&dir.x===0){next={x:1,y:0};}if(k==='ArrowUp'&&dir.y===0){next={x:0,y:-1};}if(k==='ArrowDown'&&dir.y===0){next={x:0,y:1};}});
var tx=0,ty=0;c.addEventListener('touchstart',function(e){tx=e.touches[0].clientX;ty=e.touches[0].clientY;});
c.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-tx,dy=e.changedTouches[0].clientY-ty;if(Math.abs(dx)>Math.abs(dy)){if(dx>0&&dir.x===0)next={x:1,y:0};else if(dx<0&&dir.x===0)next={x:-1,y:0};}else{if(dy>0&&dir.y===0)next={x:0,y:1};else if(dy<0&&dir.y===0)next={x:0,y:-1};}});
function tick(){if(dead)return;dir=next;var h={x:snake[0].x+dir.x,y:snake[0].y+dir.y};if(h.x<0||h.y<0||h.x>=N||h.y>=N){dead=true;return;}for(var i=0;i<snake.length;i++){if(snake[i].x===h.x&&snake[i].y===h.y){dead=true;return;}}snake.unshift(h);if(h.x===food.x&&h.y===food.y){score++;place();}else{snake.pop();}}
function draw(){x.fillStyle='#171a21';x.fillRect(0,0,c.width,c.height);x.fillStyle='#fb7185';x.fillRect(food.x*G,food.y*G,G-1,G-1);x.fillStyle='#34d399';for(var i=0;i<snake.length;i++)x.fillRect(snake[i].x*G,snake[i].y*G,G-1,G-1);x.fillStyle='#e6e9ef';x.font='16px system-ui';x.fillText('Score '+score,8,c.height-8);if(dead){x.fillStyle='#fb7185';x.font='24px system-ui';x.fillText('Game Over - R',110,c.height/2);}}
setInterval(function(){tick();draw();},110);tick();draw();
</script></body></html>`;

const MEMORY_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memory Match</title>
<style>body{margin:0;background:#0f1115;color:#e6e9ef;font:16px system-ui;display:grid;place-items:center;min-height:100vh}h1{font-size:1.1rem;color:#9aa3b2}.g{display:grid;grid-template-columns:repeat(4,72px);gap:8px}.c{width:72px;height:72px;border:1px solid #262b36;border-radius:10px;background:#171a21;display:grid;place-items:center;font-size:28px;font-weight:700;cursor:pointer}.c.o{background:#12203a;border-color:#4c8dff}.c.m{opacity:.35;pointer-events:none}</style>
</head><body><div><h1>Memory Match &mdash; click to open</h1><div class="g" id="g"></div></div>
<script>
var em={a:'S',b:'H',c:'M',d:'U',e:'L',f:'B',g:'R',h:'F'};var deck=[];for(var s in em){deck.push(s,s);}
deck.sort(function(){return Math.random()-0.5;});
var g=document.getElementById('g'),first=null,lock=false,flipped=0;
deck.forEach(function(sym){var d=document.createElement('div');d.className='c';d.dataset.sym=sym;d.textContent='';d.onclick=function(){if(lock||d.classList.contains('m')||d.classList.contains('o'))return;d.classList.add('o');d.textContent=em[sym];if(!first){first=d;return;}if(first.dataset.sym===sym){first.classList.add('m');d.classList.add('m');first=null;flipped+=2;if(flipped===deck.length)setTimeout(function(){alert('Done!');},200);}else{lock=true;var a=first,b=d;setTimeout(function(){a.classList.remove('o');a.textContent='';b.classList.remove('o');b.textContent='';first=null;lock=false;},700);}};g.appendChild(d);});
</script></body></html>`;

const POMODORO_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pomodoro</title>
<style>body{margin:0;background:#0f1115;color:#e6e9ef;font:16px system-ui;display:grid;place-items:center;min-height:100vh;text-align:center}.t{font-size:72px;font-variant-numeric:tabular-nums}button{margin:6px;padding:10px 16px;border:1px solid #262b36;border-radius:8px;background:#171a21;color:#e6e9ef;cursor:pointer}button.on{background:#4c8dff;border-color:#4c8dff;color:#fff}</style>
</head><body><div><h1>Pomodoro Timer</h1><div class="t" id="t">25:00</div><div><button id="start">Start</button><button id="reset">Reset</button></div><div><button class="m on" data-m="25">25</button><button class="m" data-m="5">5</button><button class="m" data-m="15">15</button></div></div>
<script>
var total=1500,left=total,running=false,iv=null;
function fmt(s){var m=Math.floor(s/60),ss=s%60;return (m<10?'0':'')+m+':'+(ss<10?'0':'')+ss;}
function render(){document.getElementById('t').textContent=fmt(left);}
function stop(){running=false;if(iv)clearInterval(iv);iv=null;document.getElementById('start').textContent='Start';}
function toggle(){running=!running;document.getElementById('start').textContent=running?'Pause':'Start';if(running){iv=setInterval(function(){if(left>0){left--;render();}if(left<=0){stop();alert('Time up!');}},1000);}else if(iv){clearInterval(iv);iv=null;}}
document.getElementById('start').onclick=toggle;
document.getElementById('reset').onclick=function(){stop();left=total;render();};
var bs=document.querySelectorAll('.m');for(var i=0;i<bs.length;i++){bs[i].onclick=function(){for(var j=0;j<bs.length;j++)bs[j].classList.remove('on');this.classList.add('on');total=Number(this.dataset.m)*60;left=total;stop();render();};}
render();
</script></body></html>`;

const TEMPLATES = { snake: SNAKE_HTML, memory: MEMORY_HTML, pomodoro: POMODORO_HTML };

// Match goal keywords → template key (multilingual ms/en). PURE & testable.
const TEMPLATE_HINTS = [
  ['snake', ['snake', 'ular', 'ulat', 'hedgehog']],
  ['memory', ['memory', 'ingatan', 'padan', 'padanan', 'pair', 'kad', 'card', 'match']],
  ['pomodoro', ['pomodoro', 'timer', 'tempoh', 'focus', 'fokus', 'kanji', 'masa', 'countdown']]
];
function detectTemplate(goal) {
  const q = String(goal || '').toLowerCase();
  for (const [key, ws] of TEMPLATE_HINTS) { if (ws.some((w) => q.includes(w))) return key; }
  return '';
}
function listTemplates() { return Object.keys(TEMPLATES); }

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

/** The full scaffold for a given project kind. */
function scaffoldFor(kind, goal) {
  const k = normalizeKind(kind);
  // Prefer the ready-to-run single-file templates for game/app → 0 LLM tokens.
  const tmplKey = (k === 'game' || k === 'app') ? detectTemplate(goal) : '';
  if (tmplKey && TEMPLATES[tmplKey]) {
    return {
      kind: k,
      goal: String(goal || '').slice(0, 200),
      template: tmplKey,
      files: [{ path: 'index.html', contents: TEMPLATES[tmplKey] }],
      run: 'Open index.html in the browser (or upload it to Studio).'
    };
  }
  return {
    kind: k,
    goal: String(goal || '').slice(0, 200),
    files: filesFor(k),
    run: k === 'game' || k === 'app' || k === 'html'
      ? 'Open index.html in the browser (or upload it to Studio).'
      : k === 'node'
        ? 'node --test index.test.mjs'
        : 'node cli.mjs hello Tukuk'
  };
}

/** Validate JS/MJS syntax with `node --check`; HTML gets a light inspection. */
function review(code, lang) {
  const src = String(code || '');
  const l = String(lang || 'js').toLowerCase();
  const hints = [];
  if (/\beval\s*\(/.test(src)) hints.push('avoid eval() — security risk.');
  if (/document\.write\s*\(/.test(src)) hints.push('document.write can be slow — use DOM APIs.');
  if (/<script>/.test(src) && !/charset/i.test(src)) hints.push('Add <meta charset="utf-8">.');

  const isJs = /^(js|mjs|cjs|javascript)$/.test(l);
  if (!isJs) {
    return Promise.resolve({ ok: true, lang: l, hints });
  }
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), 'tukukcode_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.mjs');
    try {
      fs.writeFileSync(file, src);
    } catch (e) {
      return resolve({ ok: false, lang: l, error: 'failed to write tmp file: ' + e.message, hints });
    }
    execFile(process.execPath, ['--check', file], (err, _so, stderr) => {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
      if (err) resolve({ ok: false, lang: l, error: String(stderr || err.message).slice(0, 500), hints });
      else resolve({ ok: true, lang: l, hints });
    });
  });
}

module.exports = { KINDS, normalizeKind, planFor, scaffoldFor, review, TEMPLATES, detectTemplate, listTemplates };
