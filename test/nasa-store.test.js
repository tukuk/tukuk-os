// Ujian pangkalan data arkib NASA (src/nasa-store.js) — DB setempat, tanpa API.
// NASA_DB_PATH mesti ditetapkan SEBELUM require supaya store tulis ke direktori sementara.
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

test('saveApod menolak entri rosak dan menerima yang sah', () => {
  const added = store.saveApod([
    goodApod('2026-10-15'),
    { date: '2026-10-16', title: 'NASA Science', explanation: 'x'.repeat(100), url: 'logo.png' },
    { date: 'bukan-tarikh', title: 'X'.repeat(60), explanation: 'x'.repeat(100), url: 'a.jpg' }
  ]);
  assert.strictEqual(added, 1);
  assert.strictEqual(store.getApod('2026-10-15').title, 'The Pillars of Creation');
  assert.strictEqual(store.getApod('2026-10-16'), null);
});

test('latestApod menghormati tarikh pemotongan', () => {
  store.saveApod(goodApod('2026-10-17', 'Aurora over Norway'));
  assert.strictEqual(store.latestApod('2026-10-16').date, '2026-10-15');
  assert.strictEqual(store.latestApod('2026-10-17').date, '2026-10-17');
  assert.strictEqual(store.latestApod().date, '2026-10-17'); // tanpa cutoff = paling baru
});

test('listApod isih terbaru dahulu dan menapis dengan q', () => {
  const semua = store.listApod({ limit: 10 });
  assert.deepStrictEqual(semua.map((e) => e.date), ['2026-10-17', '2026-10-15']);
  const carian = store.listApod({ q: 'aurora' });
  assert.strictEqual(carian.length, 1);
  assert.strictEqual(carian[0].date, '2026-10-17');
});

test('saveAsteroids menyahganda; searchAsteroids utamakan bahaya', () => {
  const list = [
    { id: '1', name: '2026 AB1', is_potentially_hazardous: false, miss_distance_km: 100000, velocity_kmh: 50000, estimated_diameter_meters: { min: 10, max: 20 }, close_approach_date: '2026-10-17', nasa_jpl_url: 'u' },
    { id: '2', name: 'Apophis', is_potentially_hazardous: true, miss_distance_km: 900000000, velocity_kmh: 100000, estimated_diameter_meters: { min: 300, max: 400 }, close_approach_date: '2026-10-18', nasa_jpl_url: 'u' },
    { id: '1', name: '2026 AB1', is_potentially_hazardous: false, miss_distance_km: 100000, velocity_kmh: 50000, estimated_diameter_meters: { min: 10, max: 20 }, close_approach_date: '2026-10-17', nasa_jpl_url: 'u' }
  ];
  const added = store.saveAsteroids(list);
  assert.strictEqual(added, 2);
  const bahaya = store.searchAsteroids({ hazardousOnly: true });
  assert.strictEqual(bahaya.length, 1);
  assert.strictEqual(bahaya[0].name, 'Apophis');
  const semua = store.searchAsteroids({});
  assert.strictEqual(semua[0].name, 'Apophis'); // berbahaya dahulu walaupun jarak lebih jauh
});

test('saveEpic & listEpic simpan dan isih ikut tarikh', () => {
  const added = store.saveEpic([
    { identifier: 'a1', date: '2026-10-16 10:00:00', image: 'a1.png', url: 'u1' },
    { identifier: 'a2', date: '2026-10-17 10:00:00', image: 'a2.png', url: 'u2' },
    { tiada: 'identiti diabaikan' }
  ]);
  assert.strictEqual(added, 2);
  const senarai = store.listEpic({ limit: 5 });
  assert.strictEqual(senarai[0].identifier, 'a2');
});

test('stats mengira rekod setiap koleksi', () => {
  const s = store.stats();
  assert.strictEqual(s.apodEntries, 2);
  assert.strictEqual(s.asteroidEntries, 2);
  assert.strictEqual(s.epicEntries, 2);
  assert.strictEqual(s.dir, process.env.NASA_DB_PATH);
});

test.after(() => {
  fs.rmSync(process.env.NASA_DB_PATH, { recursive: true, force: true });
});
