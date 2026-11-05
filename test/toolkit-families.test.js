// ═══ Tests: the data-driven families behind /alat (Nov 2026 third wave) ═══
// One engine per family, a thousand members — which means the ENGINE is what has to be
// proved, not the members. Everything below is checked against a published figure or an
// independent implementation rather than against the module's own output: the WGS84
// quarter meridian, two distances you can look up, the canonical GeoHash example from
// the format's own documentation, and a decoder written from the spec so a bit-order
// slip in the encoder cannot be hidden by a matching slip in the test.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const F = require('../src/toolkit-families');
const { app } = require('../src/server');

const I = F._internals;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const near = (actual, expected, tol, label) => {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} is not within ${tol} of ${expected}`);
};

// fix() from the family module, reimplemented here rather than imported: the pages format
// their own headline numbers with it, and a test that borrowed the production formatter
// could not catch the formatter being wrong. Integer-part separators only.
const fmt = (n, d) => {
  const parts = n.toFixed(d === undefined ? 0 : d).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};

// ── the maths, against published numbers ────────────────────────────────────
test('the WGS84 meridian quadrant matches the published ellipsoid figure', () => {
  // 10,001,965.7 m is the WGS84 quadrant distance — the definition the metre was
  // originally built on and the number every geodesy table prints.
  near(I.meridianKm(90), 10001.9657, 0.01, 'quarter meridian');
  near(I.meridianKm(0), 0, 1e-9, 'the equator is 0 km from the equator');
  near(I.meridianKm(-45), I.meridianKm(45), 1e-9, 'a southern latitude must read the same arc');
  // 1° of latitude is ~111 km but not constant: it grows toward the pole.
  const low = I.meridianKm(1) - I.meridianKm(0);
  const high = I.meridianKm(89) - I.meridianKm(88);
  assert.ok(high > low * 1.009, `meridian degrees must widen toward the pole (${low} → ${high})`);
});

test('the parallel radius is the ellipsoid value, not a sphere guess', () => {
  near(I.parallelRadiusKm(0), 6378.137, 1e-6, 'equatorial radius');
  // N(60°) = a / sqrt(1 − e² sin²60) and the parallel radius is that times cos 60.
  const a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const expected = (a / Math.sqrt(1 - e2 * 0.75)) * 0.5;
  near(I.parallelRadiusKm(60), expected, 1e-6, 'parallel radius at 60°');
  assert.ok(I.parallelRadiusKm(90) < 1e-9, 'a pole has no parallel');
});

test('great-circle distances agree with the figures you can look up', () => {
  near(I.gcKm(51.5072, -0.1276, 48.8566, 2.3522), 343.6, 1, 'London → Paris');
  // 6,741 mi / 10,849 km is the city-centre air line the distance calculators publish; which
  // exact coordinate a city is pinned to moves the figure by a couple of km, hence the tolerance.
  near(I.gcKm(35.6762, 139.6503, 40.7128, -74.006), 10849, 4, 'Tokyo → New York');
  near(I.gcKm(30.0444, 31.2357, 31.2001, 29.9187), 181, 3, 'Cairo → Alexandria');
  // A degree of a great circle on the IUGG mean sphere, and the two identities that fall
  // out of it: a point to itself is nothing, and half an equator is half a circumference.
  near(I.gcKm(0, 0, 0, 1), 111.195, 0.01, 'one degree along the equator');
  near(I.gcKm(0, 0, 0, 0), 0, 1e-9, 'a point to itself');
  near(I.gcKm(0, 0, 0, 180), Math.PI * 6371.0088, 1e-6, 'half an equator');
  assert.equal(I.gcKm(10, 20, 30, 40), I.gcKm(30, 40, 10, 20), 'distance must be symmetric');
});

test('haversine agrees with the vector form of the same arc, everywhere', () => {
  // The independent implementation: build the two unit vectors, take the angle between them
  // with atan2 of the cross and dot products. Different algebra, same sphere, so a stable
  // formula error in one (a lost sign, a missing factor of two) shows up as a disagreement.
  const rad = (d) => d * Math.PI / 180;
  const vec = (la, lo) => [Math.cos(rad(la)) * Math.cos(rad(lo)), Math.cos(rad(la)) * Math.sin(rad(lo)), Math.sin(rad(la))];
  const angKm = (la1, lo1, la2, lo2) => {
    const [a, b] = [vec(la1, lo1), vec(la2, lo2)];
    const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const chord = Math.hypot(cr[0], cr[1], cr[2]);
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return Math.atan2(chord, dot) * 6371.0088;
  };
  // A dense grid over the whole sphere, plus the awkward cases: poles, the dateline, and
  // points a few metres apart, which is where an unstable formula starts to lose digits.
  for (let la1 = -90; la1 <= 90; la1 += 15) {
    for (let lo1 = -180; lo1 < 180; lo1 += 30) {
      for (let la2 = -90; la2 <= 90; la2 += 15) {
        for (let lo2 = -180; lo2 < 180; lo2 += 30) {
          near(I.gcKm(la1, lo1, la2, lo2), angKm(la1, lo1, la2, lo2), 1e-6, `(${la1},${lo1})→(${la2},${lo2})`);
        }
      }
    }
  }
  near(I.gcKm(90, 0, 45, 179.9), angKm(90, 0, 45, 179.9), 1e-6, 'from the north pole across the dateline');
  near(I.gcKm(-33.8688, 151.2093, -33.8689, 151.2094), angKm(-33.8688, 151.2093, -33.8689, 151.2094),
    1e-6, 'two points a metre apart');
});

test('the initial bearing is a true-north azimuth you can check on a chart', () => {
  near(I.bearingDeg(30.0444, 31.2357, 31.2001, 29.9187), 315.9, 0.5, 'Cairo → Alexandria is northwest');
  near(I.bearingDeg(0, 0, 10, 0), 0, 1e-9, 'due north along a meridian');
  near(I.bearingDeg(0, 0, 0, 10), 90, 1e-9, 'due east along the equator');
  assert.ok(I.bearingDeg(0, 0, -10, 0) > 179 && I.bearingDeg(0, 0, -10, 0) < 181, 'due south');
});

test('geohash is the standard base-32 interleaving, longitude first and MSB first', () => {
  // (42.6, −5.6) is the worked example in the geohash documentation itself, and
  // (0, 0) must be the all-zero cell 's0000000' — the two vectors that separate
  // every bit-order convention from every other one.
  assert.equal(I.geohash(42.6, -5.6, 5), 'ezs42');
  assert.equal(I.geohash(0, 0, 8), 's0000000');
  assert.equal(I.geohash(42.6, -5.6, 3), 'ezs');
  assert.match(I.geohash(-33.8688, 151.2093, 9), /^[0-9bcdefghjkmnpqrstuvwxyz]{9}$/, 'no a, i, l or o');
});

// An independent decoder, written from the spec: bisect the world with the same
// bits and check the point lands inside the cell its own hash describes.
function decodeBox(hash) {
  const ALPHA = '0123456789bcdefghjkmnpqrstuvwxyz';
  let lon = [-180, 180], lat = [-90, 90], lonStep = true;
  for (const ch of hash) {
    const idx = ALPHA.indexOf(ch);
    assert.ok(idx >= 0, `illegal geohash character ${ch}`);
    for (let bit = 4; bit >= 0; bit -= 1) {
      const on = ((idx >> bit) & 1) === 1;
      if (lonStep) { const m = (lon[0] + lon[1]) / 2; if (on) lon[0] = m; else lon[1] = m; }
      else { const m = (lat[0] + lat[1]) / 2; if (on) lat[0] = m; else lat[1] = m; }
      lonStep = !lonStep;
    }
  }
  return { lat, lon };
}

test('every city encodes inside its own geohash cell, and prefixes nest', () => {
  for (const c of I.CITIES) {
    const h9 = I.geohash(c.lat, c.lng, 9);
    const box = decodeBox(h9);
    assert.ok(c.lat >= box.lat[0] && c.lat <= box.lat[1], `${c.name}: lat outside ${h9}`);
    assert.ok(c.lng >= box.lon[0] && c.lng <= box.lon[1], `${c.name}: lng outside ${h9}`);
    assert.equal(I.geohash(c.lat, c.lng, 5), h9.slice(0, 5), `${c.name}: prefixes must nest`);
  }
});

test('DMS and slug folding do the job the URLs depend on', () => {
  assert.equal(I.dms(6.52, 'N', 'S'), '6° 31′ 12.0″ N');
  assert.equal(I.dms(-33.87, 'N', 'S'), '33° 52′ 12.0″ S');
  assert.equal(I.slugify('Bogotá'), 'bogota');
  assert.equal(I.slugify("Xi'an"), 'xi-an');
  assert.equal(I.slugify('Washington D.C.'), 'washington-d-c');
  assert.equal(I.normLon(190), -170);
  assert.equal(I.normLon(-200), 160);
  near(I.normLon(I.normLon(12.3 + 180) + 180), 12.3, 1e-9, 'an antipode twice must come home');
  assert.equal(I.normLon(I.normLon(12 + 180) + 180), 12, 'an exact degree must survive the round trip bit for bit');
});

// ── the registry the families publish ───────────────────────────────────────
test('the families publish the counts, categories and fields they claim', () => {
  const byCat = {};
  for (const t of F.FAMILY_ENTRIES) {
    byCat[t.cat] = (byCat[t.cat] || 0) + 1;
    for (const k of ['slug', 'ic', 'name', 'title', 'desc', 'hero', 'sub', 'navBlurb', 'hubBlurb', 'lead', 'form', 'script', 'seo']) {
      assert.equal(typeof t[k], 'string', `${t.slug}: ${k} missing`);
      assert.ok(t[k].length > 0, `${t.slug}: ${k} empty`);
    }
    // Focus mode in worldDoc only fires on a single-segment /alat/<slug> URL.
    assert.match(t.slug, /^[a-z0-9-]+$/, `${t.slug}: not a safe single-segment slug`);
  }
  assert.equal(byCat.distances, F.COUNTS.distances);
  assert.equal(byCat.coordinates, F.COUNTS.coordinates);
  assert.equal(byCat.antipodes, F.COUNTS.antipodes);
  assert.equal(F.FAMILY_ENTRIES.length, F.COUNTS.distances + F.COUNTS.coordinates + F.COUNTS.antipodes);
});

test('the numbers a family page states are the numbers its own script recomputes', () => {
  // The static card is server-rendered from the same engine the browser script
  // re-runs, so the page can never show one answer before interaction and a
  // different one after. Every distance page is checked, not a sample.
  const dist = F.FAMILY_ENTRIES.filter((t) => t.cat === 'distances');
  assert.ok(dist.length > 300, 'the distance family has to be the size the hub advertises');
  for (const t of dist) {
    const a = t.form.match(/value="(-?[\d.]+)"[\s\S]*?value="(-?[\d.]+)"[\s\S]*?value="(-?[\d.]+)"[\s\S]*?value="(-?[\d.]+)"/);
    assert.ok(a, `${t.slug}: cannot recover the four defaults from the form`);
    const km = I.gcKm(Number(a[1]), Number(a[2]), Number(a[3]), Number(a[4]));
    assert.ok(t.sub.includes(`${km.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} km`), `${t.slug}: sub disagrees with the maths`);
  }
  const anti = F.FAMILY_ENTRIES.filter((t) => t.cat === 'antipodes');
  for (const t of anti) {
    const a = t.form.match(/value="(-?[\d.]+)"[\s\S]*?value="(-?[\d.]+)"/);
    const la = Number(a[1]), lo = Number(a[2]);
    assert.equal(t.slug.startsWith('antipode-'), true);
    near(I.gcKm(la, lo, -la, I.normLon(lo + 180)), Math.asin(1) * 2 * 6371.0088, 0.01, `${t.slug}: antipode arc`);
  }
});

// ── what a visitor (and a crawler) actually gets ────────────────────────────
const SAMPLE = [
  'distance-cairo-alexandria', 'distance-lagos-abuja', 'distance-washington-d-c-boston',
  'coords-kyoto', 'coords-bogota', 'coords-sao-paulo', 'coords-washington-d-c',
  'antipode-sao-paulo', 'antipode-noumea', 'antipode-george-town',
];

for (const slug of SAMPLE) {
  test(`GET /alat/${slug} renders its own answer`, async () => {
    const res = await fetch(`${base}/alat/${slug}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no literal undefined');
    assert.ok(!/\bNaN\b/.test(html), 'no NaN in the rendered markup');
    assert.ok(html.includes('[object Object]') === false, 'no stringified object');
    assert.match(html, /<link rel="canonical" href="https:\/\/tukuk\.org\/alat\/[a-z0-9-]+">/, 'single-segment canonical');
    assert.ok(html.includes('href="/alat"'), 'must link back to the hub');
    // Each family has its own result card id because each has its own script writing to it.
    const card = { distance: 'ds-out', coords: 'cd-out', antipode: 'ap-out' }[slug.split('-')[0]];
    assert.ok(card, `${slug}: the test does not know this family`);
    assert.ok(html.includes(`class="tl-res" id="${card}"`), `${slug}: result card ${card} is missing`);
    assert.ok(html.includes('class="tl-big"'), `${slug}: no headline answer`);
    assert.match(html, /<script[\s\S]*?<\/script>/, 'the family script is inlined');
  });
}

test('a family page agrees with the engine for its own city pair', async () => {
  // The coordinates come out of the entry's own form, so the test cannot drift away from
  // the dataset, and the figure is formatted here rather than with the module's fix().
  const entry = F.FAMILY_ENTRIES.find((t) => t.slug === 'distance-lagos-abuja');
  assert.ok(entry, 'the Lagos–Abuja page has to exist');
  const [la1, lo1, la2, lo2] = [...entry.form.matchAll(/value="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(la1, 6.52, 'the page still carries Lagos');
  assert.ok(/Lagos ↔ Abuja/.test(entry.name), 'the page must be the Lagos–Abuja pair');
  const km = I.gcKm(la1, lo1, la2, lo2);
  const html = await fetch(`${base}/alat/${entry.slug}`).then((r) => r.text());
  assert.ok(html.includes(`${fmt(km)} km · ${fmt(km * 0.621371)} mi`), 'the baked answer must be the computed one');
  assert.ok(html.includes(`${fmt(km / 1.852, 1)} nmi`), 'the nautical-mile row is baked too');
});
