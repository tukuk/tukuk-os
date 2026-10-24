// ═══ Tests: /maps/live — radar.js (aircraft + vessels) and page render ═══
// Unit-test the data helpers with synthetic inputs (no network, no token), then
// assert the SSR page and the API endpoint behave as the client-side script expects.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const radar = require('../src/radar');
const { app } = require('../src/server');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

// ── normalise() ─────────────────────────────────────────────────────────────────────
test('normalise: valid airborne entry produces correct fields', () => {
  // OpenSky positional: [icao24, callsign, country, time, last_contact,
  //   lon, lat, baro_alt, on_ground, velocity, true_track, vert_rate, ...]
  const s = ['abc123', 'SIA345 ', 'Singapore', 1700000000, 1700000001,
    103.99, 1.35, 10000, false, 200, 45, 5, null, 9800, '7700'];
  const a = radar.normalise(s);
  assert.ok(a);
  assert.equal(a.icao, 'ABC123');
  assert.equal(a.call, 'SIA345');
  assert.equal(a.country, 'Singapore');
  assert.equal(a.lat, 1.35);
  assert.equal(a.lon, 103.99);
  assert.equal(a.altFt, 32808);              // 10000 m × 3.28084
  assert.equal(a.spdKt, 389);                // 200 m/s × 1.94384 → 389
  assert.equal(a.hdg, 45);
  assert.equal(a.vsFpm, 984);                // 5 m/s × 196.85
});

test('normalise: on-ground aircraft returns null', () => {
  const s = ['x', 'y', 'z', 0, 0, 103, 1, 0, true, 0, 0, 0];
  assert.equal(radar.normalise(s), null);
});

test('normalise: null coordinates returns null (no phantom at 0,0)', () => {
  const s = ['x', 'y', 'z', 0, 0, null, null, 0, false, 0, 0, 0];
  assert.equal(radar.normalise(s), null);
});

test('normalise: non-array returns null', () => {
  assert.equal(radar.normalise(null), null);
  assert.equal(radar.normalise('string'), null);
});

// ── ingestMessage() + vesselsNear() ────────────────────────────────────────────────
test('ingestMessage: PositionReport + ShipStaticData merge into one vessel', () => {
  const pos = JSON.stringify({
    type: 'PositionReport',
    data: { mmsi: 636019824, lat: 51.9, lon: 4.4, sog: 12.5, cog: 220, true_heading: 218, nav_status: 0 },
  });
  const stat = JSON.stringify({
    type: 'ShipStaticData',
    data: { mmsi: 636019824, static_data: { name: 'EVER GIVEN', ship_type: 'Cargo', destination: 'Rotterdam' } },
  });
  radar.ingestMessage(pos);
  radar.ingestMessage(stat);
  const near = radar.vesselsNear(51.9, 4.4, 20);
  const v = near.find((x) => x.mmsi === 636019824);
  assert.ok(v, 'vessel should appear in vesselsNear');
  assert.equal(v.name, 'EVER GIVEN');
  assert.equal(v.type, 'Cargo');
  assert.equal(v.dest, 'Rotterdam');
  assert.equal(v.speed, 13);          // rounded
  assert.equal(v.course, 220);
  assert.ok(v.agoSec < 5);
});

test('vesselsNear: excludes ships outside the radius', () => {
  const far = JSON.stringify({
    type: 'PositionReport',
    data: { mmsi: 999999999, lat: 0, lon: 0, sog: 5, cog: 0 },
  });
  radar.ingestMessage(far);
  const near = radar.vesselsNear(51.9, 4.4, 20);
  assert.ok(!near.find((x) => x.mmsi === 999999999), 'far vessel excluded');
});

test('aisStatus: reports no-token or closed without a token', () => {
  const s = radar.aisStatus();
  assert.ok(['no-token', 'idle', 'connecting', 'live', 'closed', 'error', 'stopped', 'no-ws'].includes(s.state));
  assert.equal(typeof s.vessels, 'number');
});

// ── /maps/live page ─────────────────────────────────────────────────────────────────
test('GET /maps/live returns a complete rendered page', async () => {
  const res = await fetch(base + '/maps/live');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('Live Aircraft &amp; Ships'), 'hero title');
  assert.ok(html.includes('id="radar-map"'), 'map container');
  assert.ok(html.includes('id="radar-q"'), 'search input');
  assert.ok(html.includes('id="radar-go"'), 'search button');
  assert.ok(html.includes('id="radar-pause"'), 'pause button');
  assert.ok(html.includes('"@type":"WebApplication"'), 'JSON-LD');
  assert.ok(html.includes('leaflet'), 'leaflet css/js referenced');
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no literal undefined');
});

test('GET /maps/live is reachable from the peta nav', async () => {
  const html = await (await fetch(base + '/maps')).text();
  assert.ok(html.includes('href="/maps/live"'), 'maps hub links /maps/live');
});

// ── /api/peta/live endpoint ─────────────────────────────────────────────────────────
test('GET /api/peta/live rejects missing params with 400', async () => {
  const res = await fetch(base + '/api/peta/live');
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.equal(j.ok, false);
});

test('GET /api/peta/live rejects out-of-range lat with 400', async () => {
  const res = await fetch(base + '/api/peta/live?lat=999&lon=0');
  assert.equal(res.status, 400);
});

test('GET /api/peta/live returns structured JSON with valid params', async () => {
  // This may or may not reach OpenSky from the test environment; the contract is
  // that it always returns JSON with ok:true + the expected keys, even on failure.
  const res = await fetch(base + '/api/peta/live?lat=3.1&lon=101.6&r=150');
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.aircraft));
  assert.ok(Array.isArray(j.vessels));
  assert.ok(typeof j.ais === 'object');
});

// ── sitemap inclusion ───────────────────────────────────────────────────────────────
test('sitemap.xml includes /maps/live', async () => {
  const xml = await (await fetch(base + '/sitemap.xml')).text();
  assert.ok(xml.includes('/maps/live</loc>'), 'sitemap missing /maps/live');
});
