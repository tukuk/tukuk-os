// Tests for the NASA archive database (src/nasa-store.js) — a local DB, no API.
// NASA_DB_PATH must be set BEFORE the require so the store writes into a temp directory.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NASA_DB_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'nasa-db-'));
const store = require('../src/nasa-store');

function goodApod(date, title = 'The Pillars of Creation') {
  return {
    date,
    title,
    explanation: 'A long enough explanation about stars forming in a dusty nebula column.',
    url: `https://example.test/${date}.jpg`,
    hdurl: `https://example.test/${date}-hd.jpg`,
    media_type: 'image'
  };
}

test('saveApod rejects broken entries and accepts valid ones', () => {
  const added = store.saveApod([
    goodApod('2026-10-15'),
    { date: '2026-10-16', title: 'NASA Science', explanation: 'x'.repeat(100), url: 'logo.png' },
    { date: 'not-a-date', title: 'X'.repeat(60), explanation: 'x'.repeat(100), url: 'a.jpg' }
  ]);
  assert.strictEqual(added, 1);
  assert.strictEqual(store.getApod('2026-10-15').title, 'The Pillars of Creation');
  assert.strictEqual(store.getApod('2026-10-16'), null);
});

test('latestApod honours the cutoff date', () => {
  store.saveApod(goodApod('2026-10-17', 'Aurora over Norway'));
  assert.strictEqual(store.latestApod('2026-10-16').date, '2026-10-15');
  assert.strictEqual(store.latestApod('2026-10-17').date, '2026-10-17');
  assert.strictEqual(store.latestApod().date, '2026-10-17'); // no cutoff = the newest one
});

test('listApod sorts newest first and filters with q', () => {
  const all = store.listApod({ limit: 10 });
  assert.deepStrictEqual(all.map((e) => e.date), ['2026-10-17', '2026-10-15']);
  const found = store.listApod({ q: 'aurora' });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].date, '2026-10-17');
});

test('saveAsteroids de-duplicates; searchAsteroids puts hazard first', () => {
  const list = [
    { id: '1', name: '2026 AB1', is_potentially_hazardous: false, miss_distance_km: 100000, velocity_kmh: 50000, estimated_diameter_meters: { min: 10, max: 20 }, close_approach_date: '2026-10-17', nasa_jpl_url: 'u' },
    { id: '2', name: 'Apophis', is_potentially_hazardous: true, miss_distance_km: 900000000, velocity_kmh: 100000, estimated_diameter_meters: { min: 300, max: 400 }, close_approach_date: '2026-10-18', nasa_jpl_url: 'u' },
    { id: '1', name: '2026 AB1', is_potentially_hazardous: false, miss_distance_km: 100000, velocity_kmh: 50000, estimated_diameter_meters: { min: 10, max: 20 }, close_approach_date: '2026-10-17', nasa_jpl_url: 'u' }
  ];
  const added = store.saveAsteroids(list);
  assert.strictEqual(added, 2);
  const hazardous = store.searchAsteroids({ hazardousOnly: true });
  assert.strictEqual(hazardous.length, 1);
  assert.strictEqual(hazardous[0].name, 'Apophis');
  const every = store.searchAsteroids({});
  assert.strictEqual(every[0].name, 'Apophis'); // hazard first even though it is further away
});

test('saveEpic & listEpic store and sort by date', () => {
  const added = store.saveEpic([
    { identifier: 'a1', date: '2026-10-16 10:00:00', image: 'a1.png', url: 'u1' },
    { identifier: 'a2', date: '2026-10-17 10:00:00', image: 'a2.png', url: 'u2' },
    { missing: 'an ignored identity' }
  ]);
  assert.strictEqual(added, 2);
  const list = store.listEpic({ limit: 5 });
  assert.strictEqual(list[0].identifier, 'a2');
});

test('stats counts the records of every collection', () => {
  const s = store.stats();
  assert.strictEqual(s.apodEntries, 2);
  assert.strictEqual(s.asteroidEntries, 2);
  assert.strictEqual(s.epicEntries, 2);
  assert.strictEqual(s.dir, process.env.NASA_DB_PATH);
});

test.after(() => {
  fs.rmSync(process.env.NASA_DB_PATH, { recursive: true, force: true });
});
