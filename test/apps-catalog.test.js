'use strict';
// Invarian katalog aplikasi: array APPS server ↔ fail HTML ↔ katalog /os & STORE.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const PUBLIC = path.join(ROOT, 'public');

function appNames(src) {
  const m = src.match(/const APPS = \[([^\]]+)\]/);
  assert.ok(m, 'array APPS wujud di server.js');
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

test('setiap nama dalam APPS punya fail public/apps/<name>.html', () => {
  for (const n of appNames(serverSrc)) {
    assert.ok(fs.existsSync(path.join(PUBLIC, 'apps', n + '.html')), `fail ${n}.html wujud`);
  }
});

test('setiap /apps/<name> dalam katalog /os terdaftar di route server (array APPS)', () => {
  const osSrc = fs.readFileSync(path.join(PUBLIC, 'os.html'), 'utf8');
  const names = new Set(appNames(serverSrc));
  const refs = [...osSrc.matchAll(/'\/apps\/([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(refs.length >= 40, `katalog /os merujuk banyak app (${refs.length})`);
  for (const r of refs) assert.ok(names.has(r), `/os merujuk ${r} yang tak terdaftar di APPS`);
});

test('setiap item STORE_APP_META terdaftar di array APPS — tiada nama ponteng', () => {
  const names = new Set(appNames(serverSrc));
  const start = serverSrc.indexOf('const STORE_APP_META');
  assert.ok(start !== -1, 'katalog STORE_APP_META wujud');
  const storeBlock = serverSrc.slice(start, serverSrc.indexOf('// Arked = templat game Pembina'));
  const keys = [...storeBlock.matchAll(/^\s{2}([a-z0-9-]+): \{ ic:/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 30, `katalog STORE cukup besar (${keys.length})`);
  for (const k of keys) assert.ok(names.has(k), `STORE_APP_META menyenarai ${k} tanpa route /apps`);
});

test('12 surface baharu terdaftar lengkap (APPS + os + STORE)', () => {
  const osSrc = fs.readFileSync(path.join(PUBLIC, 'os.html'), 'utf8');
  const NEW = ['pong', 'stack', 'simon', 'muncher', 'puzzle15', 'tictactoe', 'memory', 'whack', 'calendar', 'dice', 'tip', 'bmi'];
  const names = new Set(appNames(serverSrc));
  for (const n of NEW) {
    assert.ok(names.has(n), `${n} di APPS server`);
    assert.ok(osSrc.includes(`/apps/${n}`), `${n} di katalog /os`);
    assert.ok(serverSrc.includes(`  ${n}: { ic:`), `${n} di katalog STORE`);
    assert.ok(fs.existsSync(path.join(PUBLIC, 'apps', n + '.html')), `fail ${n}.html`);
  }
});
