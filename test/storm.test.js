// ═══ Tests: /maps/storm — storm.js (wind/waves parser) and page + API render ═══
// Unit-test the data helpers with synthetic Open-Meteo shapes (no network), then assert
// the SSR page and the same-origin endpoint behave exactly as the client script expects.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const storm = require('../src/storm');
const { app } = require('../src/server');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

// ── normalise() ─────────────────────────────────────────────────────────────────────
test('normalise: a full current block maps to the compact row the page draws', () => {
  const loc = {
    latitude: 3.128, longitude: 101.685,
    current: {
      wind_speed_10m: 12.6, wind_direction_10m: 225, wind_gusts_10m: 30.2,
      temperature_2m: 28.4, pressure_msl: 1009.6, weather_code: 95, precipitation: 1.4,
    },
  };
  const r = storm.normalise(loc);
  assert.ok(r);
  assert.equal(r.lat, 3.128);
  assert.equal(r.lon, 101.685);
  assert.equal(r.windKmh, 13);                 // rounded
  assert.equal(r.windDir, 225);
  assert.equal(r.gustKmh, 30);
  assert.equal(r.tempC, 28.4);
  assert.equal(r.pressureHpa, 1009.6);
  assert.equal(r.precipMm, 1.4);
  assert.equal(r.code, 95);
  assert.equal(r.wx, 'Thunderstorm');          // WMO 95
  assert.equal(r.wxIcon, '⛈️');
  assert.equal(r.beaufort, 3);                 // 12.6 km/h → force 3 (12–19 band)
});

test('normalise: a missing current block returns null', () => {
  assert.equal(storm.normalise({ latitude: 1, longitude: 2 }), null);
  assert.equal(storm.normalise(null), null);
});

test('normalise: non-finite coordinates return null (no phantom at 0,0)', () => {
  const loc = { latitude: null, longitude: null, current: { wind_speed_10m: 5 } };
  assert.equal(storm.normalise(loc), null);
});

test('normalise: a null wind speed keeps the point but leaves windKmh null', () => {
  const loc = { latitude: 1, longitude: 2, current: { wind_speed_10m: null, temperature_2m: 20 } };
  const r = storm.normalise(loc);
  assert.ok(r);
  assert.equal(r.windKmh, null);
});

// ── wmo() / beaufort() ──────────────────────────────────────────────────────────────
test('wmo: known and unknown codes', () => {
  assert.equal(storm.wmo(0).label, 'Clear sky');
  assert.equal(storm.wmo(61).icon, '🌦️');
  assert.equal(storm.wmo(12345).label, '');      // unknown stays blank, never guesses
});

test('beaufort: km/h maps to the mariner scale', () => {
  assert.equal(storm.beaufort(0), 0);
  assert.equal(storm.beaufort(10), 2);
  assert.equal(storm.beaufort(50), 7);
  assert.equal(storm.beaufort(120), 12);
  assert.equal(storm.beaufort(NaN), null);
});

// ── /maps/storm page ────────────────────────────────────────────────────────────────
test('GET /maps/storm returns a complete rendered page', async () => {
  const res = await fetch(base + '/maps/storm');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('Storm &amp; Wind'), 'hero title');
  assert.ok(html.includes('id="storm-map"'), 'map container');
  assert.ok(html.includes('id="storm-q"'), 'search input');
  assert.ok(html.includes('id="storm-go"'), 'search button');
  assert.ok(html.includes('id="storm-detail"'), 'detail panel');
  assert.ok(html.includes('id="storm-legend"'), 'colour legend');
  assert.ok(html.includes('open-meteo.com'), 'credits the data source');
  assert.ok(html.includes('"@type":"WebApplication"'), 'JSON-LD');
  assert.ok(html.includes('leaflet'), 'leaflet css/js referenced');
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no literal undefined');
});

test('GET /maps/storm is reachable from the peta nav', async () => {
  const html = await (await fetch(base + '/maps')).text();
  assert.ok(html.includes('href="/maps/storm"'), 'maps hub links /maps/storm');
});

// ── /api/peta/storm endpoint ────────────────────────────────────────────────────────
test('GET /api/peta/storm rejects a bad bbox with 400', async () => {
  const res = await fetch(base + '/api/peta/storm?bbox=1&latMin=x&latMax=1&lonMin=2&lonMax=3');
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.equal(j.ok, false);
});

test('GET /api/peta/storm rejects out-of-range detail lat with 400', async () => {
  const res = await fetch(base + '/api/peta/storm?lat=999&lon=0');
  assert.equal(res.status, 400);
});

test('GET /api/peta/storm detail returns structured JSON with valid params', async () => {
  // The contract holds whether or not the model is reachable right now: always JSON,
  // ok:true, mode:detail, with a point (possibly null) and a marine object.
  const res = await fetch(base + '/api/peta/storm?lat=3.1&lon=101.6');
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.mode, 'detail');
  assert.ok('point' in j);
  assert.equal(typeof j.marine, 'object');
});

test('GET /api/peta/storm grid answers 200 (array) or a clean 502 upstream error', async () => {
  const res = await fetch(base + '/api/peta/storm?bbox=1&latMin=1&latMax=5&lonMin=100&lonMax=105');
  const j = await res.json();
  if (res.status === 200) {
    assert.equal(j.ok, true);
    assert.equal(j.mode, 'grid');
    assert.ok(Array.isArray(j.grid));
  } else {
    assert.equal(res.status, 502);
    assert.equal(j.ok, false);
  }
});

// ── sitemap inclusion ───────────────────────────────────────────────────────────────
test('sitemap.xml includes /maps/storm', async () => {
  const xml = await (await fetch(base + '/sitemap.xml')).text();
  assert.ok(xml.includes('/maps/storm</loc>'), 'sitemap missing /maps/storm');
});
