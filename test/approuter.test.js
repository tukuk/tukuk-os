// ═══ Tests: approuter — the brain ↔ apps bridge (lightweight tool use) ═══════
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const approuter = require('../src/brain/approuter');

const PUBLIC = path.join(__dirname, '..', 'public');

test('route: maps the intent to the right app/hub', () => {
  const cases = [
    ['saya nak chat dengan kawan', 'chat'],
    ['cuaca tokyo hari ini', 'cuaca'],
    ['latest earthquake mag 5', 'gempa'],
    ['exchange rate usd to myr', 'wang'],
    ['photosynthesis lesson for kids', 'akademi'],
    ['remove background from my photo', null], // the page was removed — do not suggest it
    ['generate a strong random password', null], // the page was removed — do not suggest it
    ['what is the cpu load average formula', null], // a general question → do not force one
    ['', null],
  ];
  for (const [q, expect] of cases) {
    const { apps } = approuter.route(q);
    if (expect === null) {
      assert.equal(apps.length, 0, `nothing for: ${q}`);
    } else {
      assert.ok(apps.length > 0, `apps for: ${q}`);
      assert.equal(apps[0].name, expect, `expected ${expect} got ${apps[0].name} for: ${q}`);
    }
  }
});

test('route: the gate — one half score is not enough, two halves are', () => {
  // 'weatherish' is only the 'weather' prefix (0.5) on its own → not eligible.
  assert.equal(approuter.route('weatherish').apps.length, 0);
  // two half signals ('weatherish' + 'forecastt') → ≥1.0 → eligible.
  const r = approuter.route('weatherish forecastt');
  assert.ok(r.apps.length > 0);
  assert.equal(r.apps[0].name, 'cuaca');
});

test('route: at most 3 suggestions, sorted by a descending score', () => {
  const { apps } = approuter.route('music song lagu muzik listen radio stesen dengar berita');
  assert.ok(apps.length <= 3);
  for (let i = 1; i < apps.length; i++) assert.ok(apps[i - 1].score >= apps[i].score);
});

test('catalogue: every match route points at an HTML file or an existing server route', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  for (const [name, url, , title] of approuter.CATALOG) {
    if (url.includes('?')) continue; // the /store filter & the /cari mode — the file is the page itself
    const routePath = url.replace(/\/$/, '');
    let file;
    if (url.startsWith('/apps/')) file = path.join(PUBLIC, 'apps', name + '.html');
    else file = path.join(PUBLIC, name + '.html');
    // The catalogue key is an internal identifier; the URL is the public contract. A live
    // route for either is enough — they coincided until the English URL migration.
    const routed = serverSrc.includes(`app.get('${routePath}'`) || serverSrc.includes(`app.get('/${name}'`);
    assert.ok(fs.existsSync(file) || routed, `a file/route exists for ${title} (${url})`);
  }
});

test('catalogue: the utilities match the APPS list + the public/apps files', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const m = serverSrc.match(/const APPS = \[([^\]]*)\]/);
  assert.ok(m, 'the APPS array was found in server.js');
  const appList = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  for (const [name, url] of approuter.UTILITIES) {
    assert.equal(url, `/apps/${name}`, `the ${name} utility url is consistent`);
    assert.ok(appList.includes(name), `${name} is also in the server APPS`);
  }
});

test('routes: the /ask form — apps is always an array (no undefined leaks through)', () => {
  const ok1 = approuter.route('hello there');
  assert.ok(Array.isArray(ok1.apps));
  const ok2 = approuter.route(null);
  assert.ok(Array.isArray(ok2.apps));
});
