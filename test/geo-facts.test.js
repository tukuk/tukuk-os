'use strict';
// Computed geography: the pure half. No server, no network — the nearest-neighbour index
// is checked against a brute-force scan on a deterministic fixture, because a spatial
// index that is merely "usually right" would put the wrong town on 816k pages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/geo-facts');

// Deterministic PRNG: a failure here has to be reproducible, not a once-in-a-run gift.
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function fixture(n, seed) {
  const r = lcg(seed);
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({
      name: `Point ${i}`, slug: `point-${i}`,
      lat: Number((r() * 40 + 5).toFixed(4)),
      lng: Number((r() * 40 + 5).toFixed(4)),
    });
  }
  return list;
}

test('kmBetween: matches known great-circle distances', () => {
  const kl = { lat: 3.1390, lng: 101.6869 };
  const sg = { lat: 1.3521, lng: 103.8198 };
  const d = g.kmBetween(kl, sg);
  assert.ok(d > 290 && d < 320, `Kuala Lumpur–Singapore should be ~315 km, got ${d}`);
  assert.equal(g.kmBetween(kl, kl), 0);
});

test('nearest: agrees with a brute-force scan for every item', () => {
  const list = fixture(150, 42);
  for (const item of list) {
    const brute = list
      .filter((x) => x.slug !== item.slug)
      .map((x) => ({ slug: x.slug, km: g.kmBetween(item, x) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);
    const got = g.nearest(list, item, 5).map((x) => ({ slug: x.item.slug, km: x.km }));
    assert.deepEqual(got, brute, `nearest() disagrees with brute force for ${item.slug}`);
  }
});

test('nearest: never returns the item itself, and handles tiny clusters', () => {
  const list = fixture(3, 7);
  for (const item of list) {
    assert.ok(g.nearest(list, item, 5).every((x) => x.item.slug !== item.slug));
  }
  assert.deepEqual(g.nearest(list.slice(0, 1), list[0], 5), []);
  assert.deepEqual(g.nearest([], { lat: 0, lng: 0, slug: 'x' }, 5), []);
});

test('nearest: the index is built once and reused', () => {
  const list = fixture(2000, 99);
  const first = g.nearest(list, list[0], 5);
  const second = g.nearest(list, list[1], 5);
  assert.equal(first.length, 5);
  assert.equal(second.length, 5);
  assert.deepEqual(g.nearest(list, list[0], 5), first, 'a re-run must give the same answer');
});

test('equatorKm: a latitude said in kilometres', () => {
  assert.equal(g.equatorKm({ lat: 0 }), 0);
  assert.equal(g.equatorKm({ lat: -8.5 }), 946);
});

test('solarOffsetMinutes: 15 degrees of longitude is one hour', () => {
  assert.equal(g.solarOffsetMinutes(0), 0);
  assert.equal(g.solarOffsetMinutes(15), 60);
  assert.equal(g.solarOffsetMinutes(-75), -300);
  assert.equal(g.solarOffsetMinutes(101.6869), 405, 'Kuala Lumpur is solar UTC+6:45');
});

test('formatUtcOffset / formatKm: the shapes a reader sees', () => {
  assert.equal(g.formatUtcOffset(405), 'UTC+6:45');
  assert.equal(g.formatUtcOffset(-300), 'UTC-5');
  assert.equal(g.formatUtcOffset(0), 'UTC+0');
  assert.equal(g.formatKm(0.42), '0.4 km');
  assert.equal(g.formatKm(12.4), '12 km');
  assert.equal(g.formatKm(1284.2), '1,284 km');
  // A dataset entry missing a coordinate loses a fact; it must never print "NaN km".
  assert.equal(g.formatUtcOffset(NaN), '');
  assert.ok(!Number.isFinite(g.equatorKm({})));
});

test('sunOn: an equinox at the equator is a twelve-hour day', () => {
  const s = g.sunOn({ lat: 0, lng: 0 }, '2026-03-20');
  assert.ok(s && s.dayLengthMin, 'equinox at the equator must have a day length');
  assert.ok(Math.abs(s.dayLengthMin - 720) < 30, `expected ~720 min, got ${s.dayLengthMin}`);
  assert.equal(s.polar, null);
});

test('sunOn: polar day is reported, not invented', () => {
  const s = g.sunOn({ lat: 78, lng: 15 }, '2026-06-21');
  assert.equal(s.polar, 'day');
  assert.equal(s.sunrise, null, 'there is no sunrise on a polar day');
  const w = g.sunOn({ lat: 78, lng: 15 }, '2026-12-21');
  assert.equal(w.polar, 'night');
});

test('sunOn: a bad date fails soft instead of throwing at a crawler', () => {
  assert.equal(g.sunOn({ lat: 0, lng: 0 }, 'not-a-date'), null);
});

test('rankBy: ties share a rank, and missing values are refused', () => {
  const list = [
    { slug: 'a', elev: 3000 }, { slug: 'b', elev: 4000 },
    { slug: 'c', elev: 4000 }, { slug: 'd', elev: 1000 },
  ];
  assert.deepEqual(g.rankBy(list, list[3], 'elev'), { rank: 4, total: 4, ties: 1 });
  assert.deepEqual(g.rankBy(list, list[1], 'elev'), { rank: 1, total: 4, ties: 2 });
  assert.equal(g.rankBy(list, { slug: 'x' }, 'elev'), null);
});

test('elevMeters: a row stored in feet is converted, not trusted', () => {
  assert.equal(g.elevMeters({ elev: 8848 }), 8848);
  assert.equal(g.elevMeters({ elev: 16390 }), 4996, '16,390 ft is 4,996 m, not a 16 km mountain');
  assert.equal(g.elevMeters({ elev: 0 }), null);
  assert.equal(g.elevMeters({ elev: 'n/a' }), null);
  assert.equal(g.elevMeters(null), null);
});

test('rankBy: the normaliser is what stops a feet row outranking Everest', () => {
  const list = [{ slug: 'feet', elev: 16390 }, { slug: 'everest', elev: 8848 }];
  assert.deepEqual(g.rankBy(list, list[1], 'elev', g.elevMeters), { rank: 1, total: 2, ties: 1 });
  assert.deepEqual(g.rankBy(list, list[0], 'elev'), { rank: 1, total: 2, ties: 1 }, 'raw ranking is the trap');
});
