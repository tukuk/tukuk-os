// The site is English-only, and that includes the addresses. Every content section
// that used to live under a Malay path now has an English home, and the old address
// answers 301 with its parameters intact — a city, a region, an event id or a state.
// This file pins both halves of that promise: the redirect and the live route.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { app } = require('../src/server');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

// [old Malay address, English address it must lead to]
const PAIRS = [
  ['/cuaca', '/weather'],
  ['/cuaca/peta', '/weather/map'],
  ['/cuaca/ekstrem', '/weather/extremes'],
  ['/gempa', '/earthquakes'],
  ['/gempa/penjelasan', '/earthquakes/explained'],
  ['/gempa/asia-tenggara', '/earthquakes/southeast-asia'],
  ['/cuti', '/holidays'],
  ['/cuti/hujung-minggu-panjang', '/holidays/long-weekends'],
  ['/cuti/dunia', '/holidays/world'],
  ['/cuti/selangor', '/holidays/selangor'],
  ['/negara', '/countries'],
  ['/statistik', '/statistics'],
  ['/bencana', '/disasters'],
  ['/peta', '/maps'],
  ['/peta/langit', '/maps/sky'],
  ['/muzik', '/charts'],
  ['/bendera', '/flags'],
  ['/bendera/teka', '/flags/quiz'],
  ['/teknologi', '/technology'],
  ['/udara', '/air-quality'],
  ['/udara/carbon', '/air-quality/carbon'],
  ['/akademi', '/academy'],
  ['/wang', '/money'],
  ['/wang/kadar', '/money/rates'],
  ['/seni', '/art'],
  ['/hidupan', '/life'],
  ['/unsur', '/elements'],
  ['/buruj', '/constellations'],
  ['/pepatah', '/proverbs'],
  ['/rekod', '/records'],
  ['/sejarah', '/history'],
  ['/kota', '/cities'],
  ['/warisan', '/heritage'],
];

for (const [oldPath, newPath] of PAIRS) {
  test(`GET ${oldPath} redirects permanently to ${newPath}`, async () => {
    const res = await fetch(base + oldPath, { redirect: 'manual' });
    assert.equal(res.status, 301, `${oldPath} must answer 301, not ${res.status}`);
    assert.equal(res.headers.get('location'), newPath, `${oldPath} must land on ${newPath}`);
  });
}

// A parameter must survive the hop: dropping it would silently strand the visitor
// on a hub page instead of the city / region / state they asked for.
test('redirects carry their parameters across', async () => {
  const cases = [
    ['/cuaca/tokyo', '/weather/tokyo'],
    ['/cuaca/tokyo/surya', '/weather/tokyo/sun'],
    ['/cuaca/tokyo/udara', '/weather/tokyo/air'],
    ['/gempa/jepun', '/earthquakes/japan'],
    ['/gempa/pasifik-timur', '/earthquakes/east-pacific'],
    ['/bencana/banjir', '/disasters/floods'],
    ['/bencana/gunung-berapi/EONET_1', '/disasters/volcanoes/EONET_1'],
    ['/bendera/malaysia', '/flags/malaysia'],
    ['/pepatah/negara/jepun', '/proverbs/country/jepun'],
    ['/sejarah/08/31', '/history/08/31'],
  ];
  for (const [oldPath, newPath] of cases) {
    const res = await fetch(base + oldPath, { redirect: 'manual' });
    assert.equal(res.status, 301, `${oldPath} must answer 301`);
    assert.equal(res.headers.get('location'), newPath, `${oldPath} → ${newPath}`);
  }
});

// The other half: the English address is a live route in the server, not a 301 of
// its own. A slug page is served by its parameterised sibling (/countries/:slug), so
// either the literal path or that sibling has to be registered.
test('every English section address is a registered route', async () => {
  for (const [, newPath] of PAIRS) {
    const exact = serverSrc.includes(`app.get('${newPath}'`);
    const [root, second] = newPath.split('/').slice(1);
    const sibling = Boolean(second) && serverSrc.includes(`app.get('/${root}/:`);
    assert.ok(exact || sibling, `${newPath} is registered with app.get (or its :param sibling)`);
  }
});

// Nothing reader-facing should still hand out an old address — that would cost every
// visitor a redirect hop and keep the Malay URLs discoverable.
test('no page or content file still links to a Malay section path', async () => {
  const oldRoots = PAIRS.map(([p]) => p.split('/')[1]).filter((v, i, a) => a.indexOf(v) === i);
  const offenders = [];
  for (const file of ['public/index.html', 'public/os.html', 'public/llms.txt']) {
    const body = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const root of oldRoots) {
      const re = new RegExp(`(href="|\\]\\()/?${root}(?=[/"'#? )])`, 'g');
      if (re.test(body)) offenders.push(`${file} → /${root}`);
    }
  }
  assert.deepEqual(offenders, [], 'no published page hands out a redirected address');
});
