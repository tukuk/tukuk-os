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

// ── the feed's real envelope (captured off the socket, not imagined) ───────────────
// Both samples below are verbatim from wss://stream.aisstream.io/v0/stream on 25 Oct 2026.
// They are the regression guard for the bug that made the ship layer read "live" with
// zero vessels: the parser had been written against a flat {type, data} guess, so every
// real message matched no key and was dropped without a word.
const REAL_POSITION = JSON.stringify({
  MetaData: {
    MMSI: 538012693, MMSI_String: 538012693, ShipName: 'MAERSK PUELO        ',
    latitude: 1.23603, longitude: 103.93925, time_utc: '2026-10-24 19:38:36.379823433 +0000 UTC',
  },
  MessageType: 'PositionReport',
  Message: {
    PositionReport: {
      MessageID: 1, RepeatIndicator: 0, UserID: 538012693, Valid: true, NavigationalStatus: 0,
      RateOfTurn: 0, Sog: 12.6, PositionAccuracy: false, Longitude: 103.93925333333333,
      Latitude: 1.23603, Cog: 248.3, TrueHeading: 248, Timestamp: 35,
      SpecialManoeuvreIndicator: 0, Spare: 0, Raim: false, CommunicationState: 99662,
    },
  },
});
const REAL_STATIC = JSON.stringify({
  MetaData: {
    MMSI: 533110714, MMSI_String: 533110714, ShipName: 'HERA',
    latitude: 1.24041, longitude: 103.80322, time_utc: '2026-10-24 19:38:58.187492758 +0000 UTC',
  },
  MessageType: 'ShipStaticData',
  Message: {
    ShipStaticData: {
      AisVersion: 2, CallSign: '9M3234', Destination: '',
      Dimension: { A: 96, B: 9, C: 13, D: 2 }, Dte: false,
      Eta: { Day: 0, Hour: 0, Minute: 0, Month: 0 }, FixType: 1, ImoNumber: 1075375,
      MaximumStaticDraught: 0, MessageID: 5, Name: 'HERA', RepeatIndicator: 0,
      Spare: false, Type: 80, UserID: 533110714, Valid: true,
    },
  },
});

test('ingestMessage: a real aisstream envelope becomes a vessel', () => {
  radar.ingestMessage(REAL_POSITION);
  const v = radar.vesselsNear(1.23603, 103.93925, 5).find((x) => x.mmsi === 538012693);
  assert.ok(v, 'the captured PositionReport must land in the store');
  assert.equal(v.name, 'MAERSK PUELO', 'name comes from MetaData, trimmed');
  assert.equal(v.lat, 1.23603);
  assert.equal(v.lon, 103.93925333333333);
  assert.equal(v.speed, 13);
  assert.equal(v.course, 248);
  assert.equal(v.heading, 248);
  assert.equal(v.navStatus, 0);
});

test('ingestMessage: a real ShipStaticData names the ship and its kind', () => {
  // Static data carries no fix of its own — the latitude in MetaData belongs to the
  // receiver that heard the broadcast, not necessarily to the ship — so it must not put
  // a marker on the map on its own. It is remembered, and the next fix joins it up.
  radar.ingestMessage(REAL_STATIC);
  assert.ok(!radar.vesselsNear(1.24041, 103.80322, 5).find((x) => x.mmsi === 533110714),
    'no position report yet, so no marker');
  radar.ingestMessage(JSON.stringify({
    MetaData: { MMSI: 533110714, ShipName: 'HERA' },
    MessageType: 'PositionReport',
    Message: { PositionReport: {
      UserID: 533110714, Latitude: 1.24041, Longitude: 103.80322,
      Sog: 0, Cog: 90, TrueHeading: 90, NavigationalStatus: 5,
    } },
  }));
  const v = radar.vesselsNear(1.24041, 103.80322, 5).find((x) => x.mmsi === 533110714);
  assert.ok(v, 'the remembered static data joins the first fix');
  assert.equal(v.name, 'HERA');
  assert.equal(v.type, 'Tanker', 'Type 80 is a tanker, not the number 80');
  assert.equal(v.dest, '', 'an empty destination stays empty rather than becoming "null"');
  assert.equal(v.speed, 0, 'a moored ship reports 0.0 kt, which is a fact, not a blank');
});

test('ingestMessage: "not available" sentinels are dropped, the fix is kept', () => {
  const nothing = JSON.stringify({
    MetaData: { MMSI: 111222333, ShipName: 'SENTINELS' },
    MessageType: 'PositionReport',
    Message: { PositionReport: {
      UserID: 111222333, Latitude: 4.5, Longitude: 100.2,
      Sog: 102.3, Cog: 360, TrueHeading: 511, NavigationalStatus: 15,
    } },
  });
  radar.ingestMessage(nothing);
  const v = radar.vesselsNear(4.5, 100.2, 10).find((x) => x.mmsi === 111222333);
  assert.ok(v, 'the position is real and must still be plotted');
  assert.equal(v.speed, null, '102.3 kt is "speed not available"');
  assert.equal(v.course, null, '360° is "course not available"');
  assert.equal(v.heading, null, '511 is "heading not available"');
  assert.equal(v.navStatus, null, '15 is "navigational status undefined"');
});

test('ingestMessage: the subscription handshake is not a ship', () => {
  const before = radar.aisStatus().vessels;
  radar.ingestMessage(JSON.stringify({ Message: { CompressionEnabled: true }, MessageType: 'SubscriptionConfirmation' }));
  assert.equal(radar.aisStatus().vessels, before, 'no phantom vessel from a handshake');
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
