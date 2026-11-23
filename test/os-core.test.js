// ═══ Tests: the REAL Tukuk OS engine (/os) — the command parser + catalogue integrity ═══
// findApp/parseCommand/timeFmt are extracted verbatim from public/os.html (the
// source the browser actually runs) and tested in a sandbox without a DOM.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'os.html'), 'utf8');

function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('unbalanced brackets: ' + name);
}

// Take the APPS array + the pure functions from the same file.
const appsMatch = html.match(/var APPS = (\[[\s\S]*?\n\]);/);
assert.ok(appsMatch, 'the APPS array was found in os.html');
const APPS = new Function('return ' + appsMatch[1])();
const code = ['findApp', 'parseCommand', 'timeFmt'].map((n) => extractFn(html, n)).join('\n\n');
const engine = new Function('APPS', code + '\nreturn { findApp, parseCommand, timeFmt };')(APPS);

test('findApp: full and partial name/title matches', () => {
  assert.equal(engine.findApp('weather')[0], 'cuaca');
  assert.equal(engine.findApp('holidays')[0], 'cuti');
  assert.equal(engine.findApp('wiki')[0], 'wiki');
  assert.equal(engine.findApp('T Chat')[0], 'chat');
  assert.equal(engine.findApp('data center')[0], 'datacenter');
  assert.equal(engine.findApp('zzq unknown thing'), null);
  assert.equal(engine.findApp(''), null);
});

test('parseCommand: system commands are answered by the OS without asking the AI', () => {
  assert.equal(engine.parseCommand('open chat').action, 'open');
  assert.equal(engine.parseCommand('open chat').app[0], 'chat');
  assert.equal(engine.parseCommand('Open Wiki!').action, 'open');
  assert.equal(engine.parseCommand('close all').action, 'closeAll');
  assert.equal(engine.parseCommand('close chat').action, 'close');
  assert.equal(engine.parseCommand('home').action, 'home');
  assert.equal(engine.parseCommand('search how to bake bread').action, 'web');
  assert.equal(engine.parseCommand('search how to bake bread').q, 'how to bake bread');
});

test('parseCommand: not a command → sent to the AI (including "open <not an app>")', () => {
  const a = engine.parseCommand('what is dns over https');
  assert.equal(a.action, 'ask');
  assert.equal(a.q, 'what is dns over https');
  const b = engine.parseCommand('open quantum flux capacitor');
  assert.equal(b.action, 'ask'); // the app does not exist → let the AI try to answer
  assert.equal(engine.parseCommand('').action, 'noop');
});

test('timeFmt: 12-hour clock with zero-padded minutes', () => {
  assert.equal(engine.timeFmt(new Date(2026, 0, 1, 13, 5)), '1:05');
  assert.equal(engine.timeFmt(new Date(2026, 0, 1, 0, 30)), '12:30');
  assert.equal(engine.timeFmt(new Date(2026, 0, 1, 9, 0)), '9:00');
});

// ── The app catalogue (the files really exist on the server; the list is watched by tests) ──
// Only LIVING pages may be launched by the browser — apps/web-tools dropped during
// the content pivot (b0542e7) must leave APPS, not merely be hidden.
test('the OS catalogue: living pages only (no known-dead 404s)', () => {
  const DEAD = ['/explore', '/store', '/builder', '/studio', '/editor', '/editor-video',
    '/movie', '/design', '/3d', '/collage', '/bg-remover', '/converter', '/apps'];
  for (const a of APPS) {
    for (const d of DEAD) {
      if (d !== '/apps') assert.ok(!a[3].startsWith(d), `${a[0]} → ${a[3]} is a dead page`);
      else assert.ok(a[3] === '/apps/chat' || !a[3].startsWith('/apps/'), `${a[0]} → ${a[3]} is a dead app`);
    }
  }
});

test('the OS catalogue: every URL maps to an HTML file or an existing server route', () => {
  const PUBLIC = path.join(__dirname, '..', 'public');
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  for (const a of APPS) {
    const url = a[3];
    if (url.includes('?')) continue;
    let file;
    if (url === '/') file = path.join(PUBLIC, 'index.html');
    else if (url.startsWith('/apps/')) file = path.join(PUBLIC, 'apps', a[0] + '.html');
    else file = path.join(PUBLIC, a[0] + '.html');
    // A server-rendered page is valid when its app.get route is registered in server.js.
    // The catalogue key stays an internal identifier, so the public URL counts too.
    const routePath = url.replace(/\/$/, '');
    const routed = serverSrc.includes(`app.get('${routePath}'`) || serverSrc.includes(`app.get('/${a[0]}'`);
    assert.ok(fs.existsSync(file) || routed, `a file/route exists for ${a[1]} (${url})`);
  }
});

test('the OS catalogue: unique names and complete tuples (5 fields)', () => {
  const names = APPS.map((a) => a[0]);
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
  for (const a of APPS) {
    assert.equal(a.length, 5, `a complete tuple for ${a[0]}`);
    assert.ok(a[1] && a[2] && a[3] && a[4], `no empty field: ${a[0]}`);
  }
});
