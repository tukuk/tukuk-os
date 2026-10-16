// ═══ Tests: enjin TULEN Tukuk OS (/os) — pemroses arahan + integriti katalog ═══
// findApp/parseCommand/timeFmt diekstrak verbatim dari public/os.html (sumber
// sebenar yang dijalankan pelayar) dan diuji dalam sandbox tanpa DOM.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'os.html'), 'utf8');

function extractFn(src, name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('fungsi tidak ditemui: ' + name);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error('kurung tak seimbang: ' + name);
}

// Ambil array APPS + fungsi murni dari fail yang sama.
const appsMatch = html.match(/var APPS = (\[[\s\S]*?\n\]);/);
assert.ok(appsMatch, 'array APPS ditemui dalam os.html');
const APPS = new Function('return ' + appsMatch[1])();
const code = ['findApp', 'parseCommand', 'timeFmt'].map((n) => extractFn(html, n)).join('\n\n');
const engine = new Function('APPS', code + '\nreturn { findApp, parseCommand, timeFmt };')(APPS);

test('findApp: padanan nama/tajuk biasa & sebahagian', () => {
  assert.equal(engine.findApp('calculator')[0], 'calc');
  assert.equal(engine.findApp('snake')[0], 'snake');
  assert.equal(engine.findApp('background remover')[0], 'bg-remover');
  assert.equal(engine.findApp('T Chat')[0], 'chat');
  assert.equal(engine.findApp('data center')[0], 'datacenter');
  assert.equal(engine.findApp('zzq unknown thing'), null);
  assert.equal(engine.findApp(''), null);
});

test('parseCommand: arahan sistem dijawab OS tanpa questions ke AI', () => {
  assert.equal(engine.parseCommand('open calculator').action, 'open');
  assert.equal(engine.parseCommand('open calculator').app[0], 'calc');
  assert.equal(engine.parseCommand('Open Snake!').action, 'open');
  assert.equal(engine.parseCommand('close all').action, 'closeAll');
  assert.equal(engine.parseCommand('close snake').action, 'close');
  assert.equal(engine.parseCommand('home').action, 'home');
  assert.equal(engine.parseCommand('search how to bake bread').action, 'web');
  assert.equal(engine.parseCommand('search how to bake bread').q, 'how to bake bread');
});

test('parseCommand: bukan arahan → dihantar ke AI (termasuk "open <bukan app>")', () => {
  const a = engine.parseCommand('what is dns over https');
  assert.equal(a.action, 'ask');
  assert.equal(a.q, 'what is dns over https');
  const b = engine.parseCommand('open quantum flux capacitor');
  assert.equal(b.action, 'ask'); // app tak wujud → biar AI cuba jawab
  assert.equal(engine.parseCommand('').action, 'noop');
});

test('timeFmt: 12-jam dengan minit berpad zero', () => {
  assert.equal(engine.timeFmt(new Date(2026, 0, 1, 13, 5)), '1:05');
  assert.equal(engine.timeFmt(new Date(2026, 0, 1, 0, 30)), '12:30');
  assert.equal(engine.timeFmt(new Date(2026, 0, 1, 9, 0)), '9:00');
});

test('katalog OS: setiap URL petakan ke fail HTML atau route server yang wujud', () => {
  const PUBLIC = path.join(__dirname, '..', 'public');
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  for (const a of APPS) {
    const url = a[3];
    if (url.includes('?')) continue;
    let file;
    if (url === '/') file = path.join(PUBLIC, 'index.html');
    else if (url.startsWith('/apps/')) file = path.join(PUBLIC, 'apps', a[0] + '.html');
    else file = path.join(PUBLIC, a[0] + '.html');
    // Halaman terespons (model/datacenter) sah jika route app.get daftar di server.js.
    const routed = serverSrc.includes(`app.get('/${a[0]}'`);
    assert.ok(fs.existsSync(file) || routed, `fail/route wujud untuk ${a[1]} (${url})`);
  }
});

test('katalog OS: nama unik & tuple lengkap (5 medan)', () => {
  const names = APPS.map((a) => a[0]);
  assert.equal(new Set(names).size, names.length, 'tiada nama berganda');
  for (const a of APPS) {
    assert.equal(a.length, 5, `tuple lengkap untuk ${a[0]}`);
    assert.ok(a[1] && a[2] && a[3] && a[4], `medan tak kosong: ${a[0]}`);
  }
});
