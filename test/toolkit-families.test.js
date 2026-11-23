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
const CZ = require('../src/city-zones');
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
  assert.equal(byCat.clock, F.COUNTS.clock);
  assert.equal(F.FAMILY_ENTRIES.length,
    F.COUNTS.distances + F.COUNTS.coordinates + F.COUNTS.antipodes + F.COUNTS.clock);
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

// ── family four: the world-clock shelf ──────────────────────────────────────
// The engine that reads the offsets is proved in test/city-zones.test.js. What is proved here is
// the shelf: that the static card a crawler sees is byte-identical to the answer the browser
// script renders a moment later, that every number printed is what a real clock conversion gives,
// that the cities a page says share its clocks really do, that every pair of clock rules has
// exactly one page, and that no two pages print the same figures under different city names — the
// claim the crawl policy makes about this family, and the first thing a generated family silently
// loses when somebody edits the pairing rule.
const CLOCK_PAGES = F.FAMILY_ENTRIES.filter((t) => t.cat === 'clock');

// Pinned, because a test that quotes "five hours" has to mean the same thing when it runs in
// January as in July. Only the tests that name a published figure use it; the rest read the date
// each page carries, so they check what actually ships.
const CLOCK_REF = new Date(Date.UTC(2026, 5, 15, 12));
const PINNED_CLOCK = I.buildClock(CLOCK_REF);

// The zones and display names are in the script, which is the one place all three sides (baked
// card, browser script, this test) have to agree about them.
function clockConstants(t) {
  const m = t.script.match(/var ZA=("(?:[^"]*)"),ZB=("(?:[^"]*)"),NA=("(?:[^"]*)"),NB=("(?:[^"]*)");/);
  assert.ok(m, `${t.slug}: the script's own zone and city constants cannot be found`);
  return m.slice(1, 5).map((json) => JSON.parse(json));
}

// The card markup the page ships with, cut out of the result div. The form ends with that div's
// own closing tag, so the last </div> in it is the boundary — everything between is the card,
// which is why the check is on the card's shape rather than on there being no nested div.
function bakedCard(t) {
  const start = t.form.indexOf('id="cl-out">') + 'id="cl-out">'.length;
  const card = t.form.slice(start, t.form.lastIndexOf('</div>'));
  assert.ok(start > 11, `${t.slug}: no result div for the script to write into`);
  assert.ok(card.length > 100 && card.includes('class="tl-big"') && card.includes('tl-tab')
    && card.trimEnd().endsWith('</p>'), `${t.slug}: the baked card is not a headline, a table and a note`);
  return card;
}

// Run the family script against a stub DOM holding exactly the values the page ships with. The
// script is ES5 and only ever touches these four elements, so no browser is needed.
function scriptCard(t) {
  const els = {
    'cl-date': { value: t.form.match(/id="cl-date" type="date" value="([^"]+)"/)[1] },
    'cl-time': { value: t.form.match(/id="cl-time"[^>]*value="([^"]+)"/)[1] },
    'cl-go': {},
    'cl-out': { innerHTML: '' },
  };
  new Function('document', t.script)({ getElementById: (id) => els[id] });
  assert.ok(els['cl-go'].onclick && els['cl-date'].oninput && els['cl-time'].oninput, `${t.slug}: a handler is not wired`);
  return els['cl-out'].innerHTML;
}

const cardRows = (html) => [...html.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map((m) => [m[1], m[2]]);
const rowValue = (rows, label) => {
  const hit = rows.filter((r) => r[0] === label).pop();
  assert.ok(hit, `no row labelled "${label}"`);
  return hit[1];
};
const rowStarting = (rows, prefix) => {
  const hit = rows.filter((r) => r[0].startsWith(prefix)).pop();
  assert.ok(hit, `no row starting "${prefix}"`);
  return hit[1];
};

// ICU's own offset, printed as "GMT+05:45" — a different format and a different code path from the
// engine's formatToParts subtraction, which is what makes it usable as an oracle for the headline.
// Cached because building a formatter is the whole cost of the call.
const ICU_FMT = {};
function icuOffset(zone, t) {
  let f = ICU_FMT[zone];
  if (!f) f = ICU_FMT[zone] = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
  const v = f.formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName').value;
  if (v === 'GMT') return 0;
  const m = v.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  assert.ok(m, `${zone}: unexpected offset form ${v}`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

// ── the behaviour classes, rebuilt here from the dataset rather than taken from buildClock ────
// Two cities are in the same class when their whole year of daily offsets is the same sequence,
// which is the rule the family pairs on. Recomputing it in the test is what lets the "N other
// cities" count and the completeness of the shelf be checked at all, and it doubles as the proof
// that the representative of a class is the first of its cities in dataset order.
const SIG_CACHE = {};
const sigOf = (zone, year) => {
  const k = zone + '|' + year;
  if (!SIG_CACHE[k]) SIG_CACHE[k] = CZ.yearSignature(zone, year);
  return SIG_CACHE[k];
};
const CLASS_CACHE = {};
function classesFor(year) {
  if (CLASS_CACHE[year]) return CLASS_CACHE[year];
  const order = [];
  const bySig = {};
  for (const c of I.CITIES) {
    const key = sigOf(CZ.zoneFor(c), year).join(',');
    if (!bySig[key]) { bySig[key] = { key, zone: CZ.zoneFor(c), sig: sigOf(CZ.zoneFor(c), year), members: [] }; order.push(bySig[key]); }
    bySig[key].members.push(c);
  }
  order.forEach((cls) => { cls.rep = cls.members[0]; });
  CLASS_CACHE[year] = order;
  return order;
}

// The pair of rules a page is built from, as the two yearly offset sequences. A page is the same
// answer as another exactly when both sequences match, because every figure the card prints —
// the absolute offsets in its first two rows, the difference runs, the working window and the
// instants either side moves its clocks — is read off those numbers.
function rulePairKey(zoneA, zoneB, year) {
  return sigOf(zoneA, year).join(',') + '||' + sigOf(zoneB, year).join(',');
}

// The figures a card actually publishes, with the two city names taken out. Deliberately read off
// the markup rather than recomputed from the zones: a pairing rule that stops matching what is on
// the page is the mistake this is here to catch, and it is the same mistake an earlier draft made
// when it merged Lagos–Mexico City with Accra–Phoenix on their shared difference table while the
// two pages still printed different clocks. The zone names live in the disclosure line, which is
// about provenance rather than about the answer, so that paragraph is cut.
function cardFigures(t) {
  const [, , na, nb] = clockConstants(t);
  const body = bakedCard(t).replace(/<p class="meta">[\s\S]*$/, '');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = [na, nb].sort((x, y) => y.length - x.length).map(esc).join('|');
  return body.replace(new RegExp(names, 'g'), 'CITY');
}

// The date each page was built for, read off the page itself so the tests describe what ships.
const pageRef = (t) => new Date(t.form.match(/id="cl-date" type="date" value="(\d{4}-\d{2}-\d{2})"/)[1] + 'T12:00:00Z');

test('the clock shelf is the size the hub advertises, and every member is a pair page', () => {
  assert.ok(CLOCK_PAGES.length > 400, `${CLOCK_PAGES.length}: the clock family has to be the size the hub advertises`);
  const slugs = new Set(CLOCK_PAGES.map((t) => t.slug));
  assert.equal(slugs.size, CLOCK_PAGES.length, 'two clock pages share a slug');
  const indexByName = {};
  const ref = pageRef(CLOCK_PAGES[0]);
  const year = ref.getUTCFullYear();
  I.CITIES.forEach((c, i) => { indexByName[c.name] = i; });
  for (const t of CLOCK_PAGES) {
    const [za, zb, na, nb] = clockConstants(t);
    assert.match(t.slug, /^time-difference-[a-z0-9-]+-[a-z0-9-]+$/, `${t.slug}: not a pair slug`);
    assert.ok(za !== zb, `${t.slug}: a city cannot be paired with its own clock`);
    // Different ids are not enough: the pair has to be two different LAWS, which is what makes it
    // a question anybody could ask rather than one city measured against itself.
    assert.notEqual(sigOf(za, year).join(','), sigOf(zb, year).join(','),
      `${t.slug}: ${za} and ${zb} keep the same clock, so this is a city paired with itself`);
    assert.ok(na !== nb, `${t.slug}: both representatives must be different places`);
    assert.ok(indexByName[na] !== undefined && indexByName[nb] !== undefined,
      `${t.slug}: names a city the dataset does not have`);
    assert.equal(t.slug, 'time-difference-' + I.CITY_SLUG[indexByName[na]] + '-' + I.CITY_SLUG[indexByName[nb]],
      `${t.slug}: the slug is not the two cities it names`);
    // No page may be its own mirror image: the family pairs class i with class j > i, so the
    // reverse URL must not exist, or a crawler gets two pages that disagree about which way round
    // the difference runs while every figure is the same.
    assert.ok(!slugs.has('time-difference-' + I.CITY_SLUG[indexByName[nb]] + '-' + I.CITY_SLUG[indexByName[na]]),
      `${t.slug}: its mirror image is also on the shelf`);
  }
});

test("the static card is byte-identical to what the page's own script renders on load", () => {
  // The house rule for every family on this shelf, and the reason a visitor never sees one answer
  // before touching the form and another after. Note what this cannot catch: an arithmetic error
  // shared by both sides. That is what the clock-conversion test below is for.
  for (const t of CLOCK_PAGES) {
    const baked = bakedCard(t);
    const live = scriptCard(t);
    if (live !== baked) {
      assert.fail(`${t.slug}: the script renders a different card\n  baked: ${baked.slice(0, 240)}\n  live:  ${live.slice(0, 240)}`);
    }
  }
});

test('every number a clock page prints is what a real clock conversion gives', () => {
  // Sign trap: the two readings of one instant differ by offB − offA. Writing it the other way
  // round mirrors every window through midday, keeps the card internally consistent with the
  // script and still reads plausibly — an earlier draft of this family did exactly that, and only
  // a conversion built a different way caught it. So the truth here comes from instants.
  for (const t of CLOCK_PAGES) {
    const [za, zb, na, nb] = clockConstants(t);
    const ref = pageRef(t);
    const date = ref.toISOString().slice(0, 10);
    const rows = cardRows(bakedCard(t));
    const tA = CZ.instantFor(za, ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 12, 0);
    const pa = CZ.partsIn(za, new Date(tA));
    const pb = CZ.partsIn(zb, new Date(tA));
    const got = CZ.clockText(pa.hour * 60 + pa.minute);
    // Row 1 prints the reading, not the requested time, and says so when the two differ.
    const first = rowValue(rows, `${na} on ${date}`);
    if (got !== '12:00') {
      assert.ok(/that time (?:did not exist|happened twice)/.test(bakedCard(t)), `${t.slug}: noon needs a note and has none`);
    }
    assert.equal(first.slice(0, 5), got, `${t.slug}: row 1 is not what A's clock reads at the instant`);
    // Row 2 is the same instant in B, with the day relationship the conversion actually gives.
    const delta = Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000);
    const want2 = CZ.clockText(pb.hour * 60 + pb.minute) + ' ' + I.dayPhrase(delta);
    assert.equal(rowValue(rows, `${nb} at that instant`).slice(0, want2.length), want2, `${t.slug}: the instant row lies`);
    // The three anchor rows: 09:00/12:00/18:00 in A, read in B by conversion.
    for (const h of [9, 12, 18]) {
      const instant = CZ.instantFor(za, ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), h, 0);
      const inB = CZ.partsIn(zb, new Date(instant));
      const label = String(h).padStart(2, '0') + ':00 in ' + na + ' is';
      assert.equal(rowValue(rows, label).slice(0, 5), CZ.clockText(inB.hour * 60 + inB.minute), `${t.slug}: ${label}`);
    }
    // The shared window: every printed hour must be inside 09:00–17:00 at both ends by conversion,
    // and no excluded hour may be.
    const shared = [];
    for (let h = 9; h < 17; h += 1) {
      const instant = CZ.instantFor(za, ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), h, 0);
      const inB = CZ.partsIn(zb, new Date(instant));
      if (inB.hour >= 9 && inB.hour < 17) shared.push(h);
    }
    const ovText = rowStarting(rows, 'Shared 09:00');
    if (shared.length) {
      const wanted = `${CZ.clockText(shared[0] * 60)}–${CZ.clockText((shared[shared.length - 1] + 1) * 60)} in ${na}, `;
      assert.ok(ovText.startsWith(wanted), `${t.slug}: window says ${ovText}, conversion says ${wanted}`);
    } else {
      assert.equal(ovText, 'none — there is no hour that is inside 09:00–17:00 in both', `${t.slug}: invented a window where there is none`);
    }
    // The headline and the GMT labels, against ICU's independent rendering of the same offsets.
    const head = bakedCard(t).match(/class="tl-big">([^<]+)</)[1];
    const diff = icuOffset(za, ref) - icuOffset(zb, ref);
    const mins = Math.abs(diff);
    const phrase = (mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? '' : 's'}`
      : mins < 60 ? `${mins} minute${mins === 1 ? '' : 's'}` : `${Math.floor(mins / 60)} h ${mins % 60} min`) + ' ahead of ';
    if (diff > 0) assert.equal(head, `${na} is ${phrase}${nb}`, `${t.slug}: headline direction or size`);
    else if (diff < 0) assert.equal(head, `${nb} is ${phrase}${na}`, `${t.slug}: headline direction or size`);
    else assert.ok(`${na} and ${nb} show the same time on ${date}` === head || /are on the same clock, all year/.test(head),
      `${t.slug}: a zero difference needs one of the two honest headlines`);
    for (const [city, zone, label] of [[na, za, `${na} on ${date}`], [nb, zb, `${nb} at that instant`]]) {
      const printed = rowValue(rows, label).match(/\(([^)]+)\)$/)[1];
      const o = icuOffset(zone, new Date(tA));
      const wanted = o === 0 ? 'GMT+0' : 'GMT' + (o < 0 ? '−' : '+') + Math.floor(Math.abs(o) / 60)
        + (Math.abs(o) % 60 ? ':' + String(Math.abs(o) % 60).padStart(2, '0') : '');
      assert.equal(printed, wanted, `${t.slug}: ${city} offset label`);
    }
  }
});

test('no two clock pages publish the same figures under different city names', () => {
  // The claim the crawl policy on /alat makes about this family, and the reason the shelf is 780
  // pages rather than the 57,970 city pairs a naive generator would print. Compared on the printed
  // card rather than on buildClock's own pairing, so the rule that decides the URLs and the promise
  // the pages make cannot drift apart - which is precisely how an earlier draft shipped Lagos–Mexico
  // City and Accra–Phoenix as one page whose GMT labels disagreed with each other.
  const seen = new Map();
  for (const t of CLOCK_PAGES) {
    const figures = cardFigures(t);
    assert.ok(!seen.has(figures),
      `${t.slug} and ${seen.get(figures)} print identical figures - only the city names differ`);
    seen.set(figures, t.slug);
  }
  assert.equal(seen.size, CLOCK_PAGES.length, 'the shelf does not have one page per distinct answer');
});

test('every pair of clock behaviours has exactly one page', () => {
  // Completeness, the other half: forty-odd rules must produce k(k−1)/2 pages, each rule paired
  // with every later rule once and never with itself, and no pair may fall off the shelf because
  // its answer looked like somebody else's. Enumerated from the dataset here, keyed through the
  // test's own rulePairKey(), so it is a second implementation rather than a restatement.
  const ref = pageRef(CLOCK_PAGES[0]);
  const year = ref.getUTCFullYear();
  const classes = classesFor(year);
  const expected = (classes.length * (classes.length - 1)) / 2;
  assert.equal(CLOCK_PAGES.length, expected,
    `${classes.length} behaviour classes make ${expected} pairs and the shelf has ${CLOCK_PAGES.length} pages`);
  const published = new Map();
  for (const t of CLOCK_PAGES) {
    const [za, zb] = clockConstants(t);
    const key = rulePairKey(za, zb, year);
    assert.ok(!published.has(key), `${t.slug} and ${published.get(key)} are the same pair of rules twice`);
    published.set(key, t.slug);
  }
  const missing = [];
  for (let i = 0; i < classes.length; i += 1) {
    for (let j = i + 1; j < classes.length; j += 1) {
      if (!published.has(rulePairKey(classes[i].zone, classes[j].zone, year))) {
        missing.push(`${classes[i].rep.name} ↔ ${classes[j].rep.name}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'some pairs of clock rules have no page');
});

test("a page's list of cities that share its clocks is drawn from the dataset, not invented", () => {
  // The one prose claim this family makes about arithmetic: that other cities keep the same clock
  // as one of the two it names. Each has to be a member of one of the page's two classes, the count
  // has to be the size of those classes minus the two representatives, and a page with no such city
  // has to say so rather than trail an empty list.
  const ref = pageRef(CLOCK_PAGES[0]);
  const classes = classesFor(ref.getUTCFullYear());
  const KIN_PRE = 'keep the same clock as one of them, including ';
  const KIN_END = ', so looking any of those up against the city on the other side of the pair gives this page’';
  let counted = 0;
  for (const t of CLOCK_PAGES) {
    const [za, zb, na, nb] = clockConstants(t);
    const clsA = classes.find((c) => c.zone === za);
    const clsB = classes.find((c) => c.zone === zb);
    assert.ok(clsA && clsB, `${t.slug}: a zone it names is not a class the dataset produces`);
    assert.equal(clsA.rep.name, na, `${t.slug}: ${na} is not the first dataset city in ${za}'s class`);
    assert.equal(clsB.rep.name, nb, `${t.slug}: ${nb} is not the first dataset city in ${zb}'s class`);
    // The cities that keep the same clock as one of the two representatives.
    const others = clsA.members.length + clsB.members.length - 2;
    if (others > 0) {
      const claim = t.seo.match(/: (\d+) other cities in our dataset keep the same clock as one of them, including /);
      assert.ok(claim, `${t.slug}: ${others} other cities share these clocks but the page does not say so`);
      assert.equal(Number(claim[1]), others, `${t.slug}: the count of cities that agree is wrong`);
      const from = t.seo.indexOf(KIN_PRE);
      const list = t.seo.slice(from + KIN_PRE.length, t.seo.indexOf(KIN_END, from));
      const expected = clsA.members.concat(clsB.members).filter((c) => c.name !== na && c.name !== nb)
        .slice(0, 5).map((c) => c.name);
      assert.equal(list, expected.join(', '), `${t.slug}: named the wrong cities`);
      counted += 1;
    } else {
      assert.ok(/No other city in our dataset keeps either of these two clock rules/.test(t.seo),
        `${t.slug}: claims other cities without naming the rule, or the reverse`);
    }
  }
  assert.ok(counted > 100, `${counted}: pairing by rule instead of by city has to be absorbing real cities`);
});

test('the prose about changing gaps follows the table, and the disclosure is on every page', () => {
  for (const t of CLOCK_PAGES) {
    const rows = cardRows(bakedCard(t));
    const runs = rows.filter((r) => /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(r[0]));
    assert.ok(runs.length >= 1, `${t.slug}: the year's difference must be stated in runs`);
    const moving = runs.length > 1;
    const heading = /changes during /.test(t.seo) && !/keep a fixed gap all year/.test(t.seo);
    assert.equal(heading, moving, `${t.slug}: ${runs.length} run(s) but the "why" heading says otherwise`);
    // The claim that makes the whole family browser-local, and the caveat that makes it honest.
    assert.ok(/this device’s own time-zone database, so nothing is fetched and nothing is sent/.test(bakedCard(t)),
      `${t.slug}: no local-computation disclosure`);
    assert.ok(/A database older than the last rule change gives the old answer/.test(t.script), `${t.slug}: the script drops the caveat`);
    assert.ok(bakedCard(t).includes('Computed from the IANA zones ' + clockConstants(t)[0] + ' and ' + clockConstants(t)[1]),
      `${t.slug}: the card and the script name different zones`);
    // The difference quoted in the prose is the difference in the table. A zero difference is
    // written as "none" in the row and as "identical on this date" in the lead, so the two forms
    // are matched up rather than compared as strings.
    const diffRow = rowValue(rows, 'Difference on this date');
    const magnitude = diffRow.replace(/ \(\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\)$/, '');
    if (magnitude === 'none') {
      assert.ok(t.lead.includes('identical on this date'), `${t.slug}: a zero difference must be said plainly`);
    } else {
      assert.ok(t.lead.includes('apart by ' + magnitude), `${t.slug}: the lead disagrees with the difference row`);
    }
  }
});

test('the New York ↔ London page says the five-and-four hours it is famous for', () => {
  // Pinned to 15 June 2026 so the figures below are checkable against the statutes rather than
  // against whenever the suite happened to run.
  const t = PINNED_CLOCK.find((e) => e.slug === 'time-difference-new-york-city-london');
  assert.ok(t, 'the shelf has lost its most-searched clock page');
  const rows = cardRows(bakedCard(t));
  const runs = rows.filter((r) => /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(r[0]));
  // US clocks jump on the second Sunday of March and the first of November, EU on the last Sunday
  // of March and of October, so the gap is 5, 4, 5, 4, 5 hours and the table must say so.
  assert.deepEqual(runs.map((r) => [r[0], r[1]]), [
    ['2026-01-01 to 2026-03-07', '5 hours'],
    ['2026-03-08 to 2026-03-28', '4 hours'],
    ['2026-03-29 to 2026-10-24', '5 hours'],
    ['2026-10-25 to 2026-10-31', '4 hours'],
    ['2026-11-01 to 2026-12-31', '5 hours'],
  ], 'the London–New York gap through 2026');
  assert.equal(rowValue(rows, 'Difference on this date'), '5 hours (2026-03-29 to 2026-10-24)');
  assert.equal(rowValue(rows, '12:00 in New York City is'), '17:00 in London');
  assert.equal(rowValue(rows, '09:00 in New York City is'), '14:00 in London');
  assert.equal(rowValue(rows, '18:00 in New York City is'), '23:00 in London');
  assert.equal(rowValue(rows, 'Shared 09:00–17:00 working window'),
    '09:00–12:00 in New York City, 14:00–17:00 in London');
  assert.equal(rowValue(rows, 'London at that instant').slice(0, 5), '17:00', 'noon in New York is five hours on');
  assert.equal(rowStarting(rows, 'Next clock change, New York City'), 'Sunday 1 November 2026 at 06:00 UTC');
  assert.equal(rowStarting(rows, 'Next clock change, London'), 'Sunday 25 October 2026 at 01:00 UTC');
});

test('a pinned build is reproducible, so a restart cannot reshuffle the shelf', () => {
  const again = I.buildClock(CLOCK_REF).map((t) => t.slug);
  assert.deepEqual(again, PINNED_CLOCK.map((t) => t.slug), 'the same date produced a different shelf');
  assert.deepEqual(again.filter((s) => s.startsWith('time-difference-')).length, again.length);
  // A typo in the ranked-city list has to be a crash, not a silently missing page.
  assert.ok(PINNED_CLOCK.length > 400);
  assert.equal(F.COUNTS.clock, CLOCK_PAGES.length, 'the hub count and the built shelf disagree');
});

// ── what a visitor (and a crawler) actually gets ────────────────────────────
const SAMPLE = [
  'distance-cairo-alexandria', 'distance-lagos-abuja', 'distance-washington-d-c-boston',
  'coords-kyoto', 'coords-bogota', 'coords-sao-paulo', 'coords-washington-d-c',
  'antipode-sao-paulo', 'antipode-noumea', 'antipode-george-town',
  'time-difference-new-york-city-london', 'time-difference-kathmandu-london', 'time-difference-tokyo-london',
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
    const card = { distance: 'ds-out', coords: 'cd-out', antipode: 'ap-out', time: 'cl-out' }[slug.split('-')[0]];
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
