// ═══ Tests: approuter — gabungan brain ↔ aplikasi (tool-use ringan) ═══════════
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const approuter = require('../src/brain/approuter');

const PUBLIC = path.join(__dirname, '..', 'public');

test('route: memadankan maksud ke aplikasi/hab yang betul', () => {
  const cases = [
    ['saya nak chat dengan kawan', 'chat'],
    ['cuaca tokyo hari ini', 'cuaca'],
    ['latest earthquake mag 5', 'gempa'],
    ['exchange rate usd to myr', 'wang'],
    ['photosynthesis lesson for kids', 'akademi'],
    ['remove background from my photo', null], // halaman dibuang — jangan cadang
    ['generate a strong random password', null], // halaman dibuang — jangan cadang
    ['what is the cpu load average formula', null], // soalan umum → jangan paksa
    ['', null],
  ];
  for (const [q, expect] of cases) {
    const { apps } = approuter.route(q);
    if (expect === null) {
      assert.equal(apps.length, 0, `kosong untuk: ${q}`);
    } else {
      assert.ok(apps.length > 0, `apps untuk: ${q}`);
      assert.equal(apps[0].name, expect, `jangka ${expect} dpt ${apps[0].name} untuk: ${q}`);
    }
  }
});

test('route: gate — skor separuh seorang tak cukup, dua separuh cukup', () => {
  // 'weatherish' hanya awalan 'weather' (0.5) seorang sahaja → tak layak.
  assert.equal(approuter.route('weatherish').apps.length, 0);
  // dua isyarat separuh ('weatherish' + 'forecastt') → ≥1.0 → layak.
  const r = approuter.route('weatherish forecastt');
  assert.ok(r.apps.length > 0);
  assert.equal(r.apps[0].name, 'cuaca');
});

test('route: maksimum 3 cadangan, disusun ikut skor menurun', () => {
  const { apps } = approuter.route('music song lagu muzik listen radio stesen dengar berita');
  assert.ok(apps.length <= 3);
  for (let i = 1; i < apps.length; i++) assert.ok(apps[i - 1].score >= apps[i].score);
});

test('katalog: setiap laluan padanan fail HTML atau route server yang wujud', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  for (const [name, url, , title] of approuter.CATALOG) {
    if (url.includes('?')) continue; // penapis /store & mod /cari — failnya halaman sendiri
    let file;
    if (url.startsWith('/apps/')) file = path.join(PUBLIC, 'apps', name + '.html');
    else file = path.join(PUBLIC, name + '.html');
    const routed = serverSrc.includes(`app.get('/${name}'`);
    assert.ok(fs.existsSync(file) || routed, `fail/route wujud untuk ${title} (${url})`);
  }
});

test('katalog: utiliti sepadan dengan senarai APPS + fail public/apps', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const m = serverSrc.match(/const APPS = \[([^\]]*)\]/);
  assert.ok(m, 'APPS array dijumpai dalam server.js');
  const appList = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  for (const [name, url] of approuter.UTILITIES) {
    assert.equal(url, `/apps/${name}`, `url utiliti ${name} konsisten`);
    assert.ok(appList.includes(name), `${name} juga dalam APPS server`);
  }
});

test('laluan: /ask forms — apps sentiasa array (tiada undefined bocor)', () => {
  const ok1 = approuter.route('hello there');
  assert.ok(Array.isArray(ok1.apps));
  const ok2 = approuter.route(null);
  assert.ok(Array.isArray(ok2.apps));
});
