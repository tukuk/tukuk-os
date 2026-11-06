// ═══ Tests: thin-page enrichment (batch 4) — cities, deep sky, art objects ═══
// The contract for this batch: no invented facts. Every new paragraph is pure
// spherical arithmetic on coordinates and catalogue figures we already store —
// day lengths from the obliquity formula, distances from the haversine, ranks
// from the IAU areas, deep-time scale notes from fixed anchors — and the art
// pages render only fields from the museum's own record. Same data in →
// same sentences out, and every comparator link points at a page of ours.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');
const sky = require('../src/deepsky');
const kt = require('../src/kota');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function get(p) {
  const res = await fetch(base + p);
  return { status: res.status, html: await res.text() };
}
const noUndefined = (html) => !/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, ''));
// Same formula as server.js, re-derived here so the test can pin exact numbers.
const dayLength = (absLat) => {
  const t = -Math.tan((absLat * Math.PI) / 180) * Math.tan((23.44 * Math.PI) / 180);
  if (t <= -1) return 24;
  if (t >= 1) return 0;
  return (2 * Math.acos(t) * 180) / (15 * Math.PI);
};

test('city pages carry the Earth-math block: band, distances, comparators, antipode', async () => {
  const { status, html } = await get('/cities/paris');
  assert.equal(status, 200);
  assert.ok(html.includes('Where Paris sits on the Earth'), 'the section leads with the city’s own name');
  assert.ok(/5,\d{3} km<\/b> from the equator itself/.test(html), 'equator distance in thousands');
  assert.ok(/4,5\d\d km<\/b> from its nearest pole/.test(html), 'pole distance = R × (90 − 48.86)° ≈ 4,575 km');
  assert.ok(html.includes('temperate zone'), 'Paris is band-coded from its latitude alone');
  assert.ok(html.includes('Nearest cities on our list'), 'comparators are OUR own city pages');
  assert.ok(html.includes('The other side of the world'), 'antipode paragraph present');
  // 48.86° N → equinox noon sun at 90 − 48.86 = 41.1°, and the solstice day
  // length straight from the obliquity formula.
  assert.ok(html.includes('41.1°'), 'equinox sun altitude');
  assert.ok(html.includes(dayLength(48.86).toFixed(1) + ' hours of daylight'), 'longest day is checkable maths');
  // Spin speed: 1674 cos(48.86°) ≈ 1,103 km/h.
  assert.ok(/1,0\d\d|1,10\d km\/h/.test(html), 'rotation speed at this latitude');
  assert.ok(!/&amp;amp;/.test(html) && noUndefined(html));
});

test('latitude bands: tropics wording, and the midnight-sun tail only where true', async () => {
  const sg = await get('/cities/singapore');
  assert.equal(sg.status, 200);
  assert.ok(sg.html.includes('inside the tropics'), '1.35° N is tropics by definition');
  assert.ok(sg.html.includes('the sun passes directly overhead twice a year'), 'the band note is the real criterion');
  assert.ok(/12\.\d hours of daylight/.test(sg.html), 'a tropical day is ~12 h all year — the formula says so');
  assert.ok(sg.html.includes('88.7°'), 'equinox noon sun at 1.35° N is 88.65 → 88.7');
  const rvk = await get('/cities/reykjavik');
  assert.ok(rvk.html.includes('boreal zone'), '64° N is boreal, not polar');
  assert.ok(!rvk.html.includes('does not set at all'), ' Reykjavik never gets the true midnight sun — the text must not claim it');
});

test('constellation pages: area rank, genitive usage, hemisphere visibility — all from stored data', async () => {
  const { status, html } = await get('/constellations/orion');
  assert.equal(status, 200);
  assert.ok(html.includes('How big is Orion on the sky?'), 'size section');
  assert.ok(html.includes('594 square degrees'), 'area straight from the catalogue row');
  const rank = [...sky.CONSTELLATIONS].filter((c) => c.area).sort((a, b) => b.area - a.area).findIndex((c) => c.name === 'Orion') + 1;
  assert.ok(html.includes(`number <b>${rank} of 88</b>`), 'rank matches an independent sort of the same data');
  assert.ok(html.includes('full moons'), 'area translated into something a reader can feel');
  assert.ok(html.includes('The name in use') && html.includes('Orionis'), 'genitive explained');
  assert.ok(html.includes('Who can see it'), 'hemisphere visibility block');
  assert.ok(!/&amp;amp;/.test(html) && noUndefined(html));
});

test('messier pages: deep-time distance scale, magnitude ladder, home constellation, type chips', async () => {
  const m31 = await get('/messier/m31');
  assert.equal(m31.status, 200);
  assert.ok(m31.html.includes('How far is M31, really?'), 'distance section');
  assert.ok(m31.html.includes('2,540 thousand light-years'), 'stored catalogue distance, untouched');
  assert.ok(/778,\d{3} parsecs/.test(m31.html), 'parsecs = kly × 306.61 — arithmetic, not invention');
  assert.ok(m31.html.includes('8.5 times the span since the earliest Homo sapiens fossils'), 'deep-time anchor chosen by size');
  assert.ok(m31.html.includes('What will show it to you?') && m31.html.includes('naked eye from a genuinely dark site'), 'mag 3.4 earns the naked-eye tier');
  assert.ok(m31.html.includes('diffuse object'), 'galaxies get the surface-brightness caution');
  assert.ok(m31.html.includes('Finding its home constellation') && m31.html.includes('/constellations/andromeda'), 'links to the constellation page');
  assert.ok(m31.html.includes('More galaxies in the catalogue'), 'same-type chips');
  const m45 = await get('/messier/m45');
  assert.ok(/left home around the year 1601 CE/.test(m45.html), '425 ly lands inside recorded history, so the CE phrasing applies');
  assert.ok(!/&amp;amp;/.test(m31.html) && noUndefined(m31.html) && noUndefined(m45.html));
});

test('art object pages render the museum’s own record fully — no filler invented', async () => {
  const res = await fetch(base + '/art/object/436535', { redirect: 'manual' });
  if (res.status !== 200) return; // Met unreachable/cooldown — the hub fallback still works; nothing to assert
  const html = await res.text();
  assert.ok(html.includes('Record details'), 'the catalogue table still leads');
  assert.ok(html.includes('Accession number'), 'the museum’s own accession number is shown');
  assert.ok(html.includes('Where it sits in the museum'), 'department blurb section renders for a known department');
  assert.ok(html.includes('European paintings department'), 'the European Paintings record gets the European Paintings text');
  assert.ok(html.includes('About the maker'), 'Van Gogh’s own bio dates from the record');
  assert.ok(html.includes('rendered without addition'), 'the closing meta states the honesty contract');
  assert.ok(!/&amp;amp;/.test(html) && noUndefined(html));
});

test('off-catalogue slugs stay honest 404s — enrichment added no generated pages', async () => {
  assert.equal((await fetch(base + '/cities/zxcitynotreal')).status, 404);
  assert.equal((await fetch(base + '/constellations/notasquare')).status, 404);
  assert.equal((await fetch(base + '/messier/m999')).status, 404);
});

test('the three shelves still ship in the sitemap after the rewrite', async () => {
  const sm = await (await fetch(base + '/sitemap.xml')).text();
  for (const p of ['/thesaurus', '/rhymes', '/idioms']) assert.ok(sm.includes(`${p}</loc>`), `sitemap must still list ${p}`);
  const idx = await get('/index');
  assert.equal(idx.status, 200);
  assert.ok(idx.html.includes('Thesaurus'), '/index survived batch 4 too');
});
