'use strict';
// ── TUKUK-OS LIVE RUNTIME — real aircraft and real vessels over the map ──────────────
// One page (/maps/live) shows two genuinely moving things on Earth right now:
//   • AIRCRAFT  — OpenSky Network, keyed by nobody (a bounding box of transponder
//     positions). Anonymous OpenSky is rate-limited, so this module keeps ONE shared
//     snapshot per coarse box for ~20 s: a hundred visitors looking at the same sky
//     cost OpenSky exactly one call, and the browser only ever talks to tukuk.org.
//   • VESSELS   — AIS positions from aisstream.io, a free service whose only catch is
//     that every real-time AIS feed needs a token. If AISSTREAM_TOKEN is set we hold
//     one inbound WebSocket over the world's busiest lanes and answer every viewer
//     from the same in-memory store; if it is not set, ships are honestly reported as
//     "not enabled" and the aircraft layer still works. Nothing here invents a
//     position: an aircraft is what a transponder reported, a ship is what its AIS
//     transponder broadcast. A source that is cold says so instead of drawing dots.
const axios = require('axios');
const https = require('https');
const { attachGuard } = require('./outbound');
const { haversineKm } = require('./peta');

const agent = new https.Agent({ autoSelectFamily: false, keepAlive: true });
const http = axios.create({
  timeout: 9000,
  httpsAgent: agent,
  headers: { 'User-Agent': 'TukukOS-Radar-Client/1.0 (+https://tukuk.org)' },
});
// Short deadline: a live tile must fail fast and fall back to the last snapshot, not
// hold a socket for 15 s. Cooldown is brief so a one-off OpenSky hiccup is retried soon.
attachGuard(http, { name: 'radar', budgetMs: 9000, cooldownMs: 30000 });

const OPENSKY = 'https://opensky-network.org/api/states/all';

// ── AIRCRAFT ───────────────────────────────────────────────────────────────────────
const airCache = new Map();               // coarse box key -> { at, list }
const TTL_AIR = 20000;                    // one shared snapshot per ~20 s
const round = (n, step) => Math.round(n / step) * step;

// OpenSky leaves a field `null` when a transponder did not report it. Number(null) is 0,
// which is a *valid-looking* coordinate (0,0 sits in the Gulf of Guinea), so nulls must be
// turned into NaN before the finite test — otherwise silent gaps become phantom vehicles.
const fin = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

// OpenSky hands back each aircraft as a POSITIONAL array, not an object:
//   [0]icao24 [1]callsign [2]origin_country [3]time_position [4]last_contact
//   [5]longitude [6]latitude [7]baro_altitude [8]on_ground [9]velocity(m/s)
//   [10]true_track [11]vertical_rate(m/s) [12]ensors [13]geo_altitude [14]squawk
// Anything on the ground, or without a real fix, is not a moving target to plot.
function normalise(s) {
  if (!Array.isArray(s)) return null;
  const lon = fin(s[5]); const lat = fin(s[6]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (s[8] === true) return null;                                   // taxiing/parked, not airborne
  const vel = fin(s[9]); const track = fin(s[10]); const vrate = fin(s[11]);
  const baro = fin(s[7]); const geo = fin(s[13]);
  const alt = Number.isFinite(baro) ? baro : geo;
  return {
    icao: String(s[0] || '').toUpperCase(),
    call: String(s[1] || '').trim(),
    country: String(s[2] || ''),
    lat, lon,
    altFt: Number.isFinite(alt) ? Math.round(alt * 3.28084) : null,
    spdKt: Number.isFinite(vel) ? Math.round(vel * 1.94384) : null,
    hdg: Number.isFinite(track) ? Math.round(track) : null,
    vsFpm: Number.isFinite(vrate) ? Math.round(vrate * 196.85) : null,
  };
}

// Center + radius -> the few aircraft OpenSky reports inside that box, fresh or cached.
// The box is rounded to a 0.25° grid so neighbouring viewports share one cache entry,
// and clamped so one wide zoom can never ask for a whole hemisphere in a single call.
async function aircraft(lat, lon, radiusKm = 120) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('need a finite center');
  const r = Math.max(20, Math.min(Number(radiusKm) || 120, 250));
  const dLat = r / 111.32;
  const dLon = r / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const lamin = round(lat - dLat, 0.25); const lamax = round(lat + dLat, 0.25);
  const lomin = round(lon - dLon, 0.25); const lomax = round(lon + dLon, 0.25);
  const key = `${lamin}|${lamax}|${lomin}|${lomax}`;
  const hit = airCache.get(key);
  if (hit && Date.now() - hit.at < TTL_AIR) {
    return { list: within(hit.list, lat, lon, r), cached: true, ageMs: Date.now() - hit.at };
  }
  const url = `${OPENSKY}?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
  try {
    const res = await http.get(url);
    const rows = (Array.isArray(res.data && res.data.states) ? res.data.states : [])
      .map(normalise).filter(Boolean);
    airCache.set(key, { at: Date.now(), list: rows });
    trimAir();
    return { list: within(rows, lat, lon, r), cached: false, ageMs: 0 };
  } catch (err) {
    if (hit) return { list: within(hit.list, lat, lon, r), cached: true, stale: true, ageMs: Date.now() - hit.at };
    throw err;
  }
}

// The box is a rectangle; the marker circle is a radius. Trim to the circle so the map
// agrees with the "within N km" the page claims.
function within(list, lat, lon, r) {
  const c = { lat, lon };
  return list.filter((a) => haversineKm(c, { lat: a.lat, lon: a.lon }) <= r);
}

function trimAir() {
  if (airCache.size <= 160) return;
  let oldestKey = null; let oldest = Infinity;
  for (const [k, v] of airCache) if (v.at < oldest) { oldest = v.at; oldestKey = k; }
  if (oldestKey) airCache.delete(oldestKey);
}

// ── VESSELS (AIS) ───────────────────────────────────────────────────────────────────
// The token is the whole gate: no token, no socket, ships stay off, the page says so.
const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const AIS_TOKEN = String(process.env.AISSTREAM_TOKEN || '').trim();
// aisstream's free tier subscribes a handful of boxes at once. These are the busiest
// shipping lanes on the planet plus the water beside this project's home region — the
// sea where ships genuinely crowd, so the layer is alive on arrival. Each box is
// [[southWestLat, southWestLon], [northEastLat, northEastLon]]. Edit freely.
const AIS_BOXES = [
  [[2.0, 97.5], [7.0, 105.0]],    // Strait of Malacca & Singapore — the home lane
  [[19.0, 110.0], [32.0, 123.0]], // South China Sea to the East China Sea
  [[48.5, -3.0], [52.0, 4.5]],    // English Channel / Dover / southern North Sea
  [[23.5, 47.0], [31.5, 60.0]],   // Persian Gulf & Strait of Hormuz
  [[29.0, 30.5], [36.5, 41.0]],   // Eastern Mediterranean & Suez approaches
];

const vessels = new Map();        // mmsi -> merged last-known record
let ws = null;
let wsState = AIS_TOKEN ? 'idle' : 'no-token';
let reconnectTimer = null;
let backoff = 1500;
let msgCount = 0;
const VESSEL_TTL = 180000;        // gone quiet for 3 min = no longer "live"
const VESSEL_CAP = 30000;

// aisstream's JSON key casing has changed across versions, so read every field through
// a small list of aliases rather than betting on one name. Positions are the one thing
// we must not lose; the niceties (name, destination) are allowed to stay blank.
const pick = (o, keys) => {
  for (const k of keys) { if (o && o[k] != null && o[k] !== '') return o[k]; }
  return null;
};

// Feed one raw AIS message into the store. Exported (as ingestMessage) so the parser can
// be tested offline with a captured sample, without a token or a network.
function ingestMessage(raw) {
  let m;
  try { m = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
  const d = m && m.data;
  if (!d || d.mmsi == null) return;
  const id = Number(d.mmsi);
  if (!Number.isFinite(id)) return;
  const t = String(m.type || '');
  const cur = vessels.get(id) || { mmsi: id };
  if (t === 'PositionReport') {
    const lat = fin(pick(d, ['lat', 'latitude']));
    const lon = fin(pick(d, ['lon', 'longitude']));
    if (Number.isFinite(lat) && Number.isFinite(lon)) { cur.lat = lat; cur.lon = lon; }
    const sog = fin(pick(d, ['sog', 'SOG', 'speed_over_ground']));
    const cog = fin(pick(d, ['cog', 'COG', 'course_over_ground']));
    const hdg = fin(pick(d, ['true_heading', 'hdg', 'heading']));
    const nav = pick(d, ['nav_status', 'navStatus', 'navi']);
    if (Number.isFinite(sog)) cur.speed = Math.round(sog);
    if (Number.isFinite(cog)) cur.course = Math.round(cog);
    if (Number.isFinite(hdg)) cur.heading = Math.round(hdg);
    if (nav != null) cur.navStatus = Number(nav);
    cur.seenAt = Date.now();
    msgCount++;
  } else if (t === 'ShipStaticData') {
    const sd = d.static_data && typeof d.static_data === 'object' ? d.static_data : d;
    const name = pick(sd, ['name', 'NAME']);
    const type = pick(sd, ['ship_type', 'type', 'shp_type']);
    const dest = pick(sd, ['destination', 'DESTINATION']);
    if (name != null) cur.name = String(name).trim();
    if (type != null) cur.type = String(type).trim();
    if (dest != null) cur.dest = String(dest).trim();
    if (!cur.seenAt) cur.seenAt = Date.now();
    msgCount++;
  } else {
    return;                                            // base stations, aids-to-navigation, etc.
  }
  vessels.set(id, cur);
  pruneVessels();
}

function pruneVessels() {
  const now = Date.now();
  if (vessels.size > 4000) {                            // opportunistic age sweep
    for (const [k, v] of vessels) if (now - (v.seenAt || 0) > VESSEL_TTL) vessels.delete(k);
  }
  if (vessels.size <= VESSEL_CAP) return;               // hard cap: drop the quietest first
  const byOldest = [...vessels.entries()].sort((a, b) => (a[1].seenAt || 0) - (b[1].seenAt || 0));
  for (let i = 0; i < byOldest.length - VESSEL_CAP; i++) vessels.delete(byOldest[i][0]);
}

// Ships currently inside the viewer's circle, newest report first.
function vesselsNear(lat, lon, radiusKm = 150) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const r = Math.max(10, Math.min(Number(radiusKm) || 150, 600));
  const now = Date.now(); const c = { lat, lon }; const out = [];
  for (const v of vessels.values()) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    if (now - (v.seenAt || 0) > VESSEL_TTL) continue;
    if (haversineKm(c, { lat: v.lat, lon: v.lon }) > r) continue;
    out.push(v);
  }
  out.sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0));
  return out.slice(0, 800).map((v) => ({
    mmsi: v.mmsi, name: v.name || '', type: v.type || '',
    lat: v.lat, lon: v.lon,
    speed: v.speed == null ? null : v.speed,
    course: v.course == null ? null : v.course,
    heading: v.heading == null ? null : v.heading,
    navStatus: v.navStatus == null ? null : v.navStatus,
    dest: v.dest || '',
    agoSec: Math.round((now - (v.seenAt || now)) / 1000),
  }));
}

// Public picture of the ship layer, so the page can be honest about what it is showing.
function aisStatus() {
  return {
    state: wsState,
    live: wsState === 'live',
    enabled: !!AIS_TOKEN,
    vessels: vessels.size,
    msgs: msgCount,
    boxes: AIS_BOXES.length,
  };
}

function connectAis() {
  let WebSocket;
  try { WebSocket = require('ws'); } catch (e) { wsState = 'no-ws'; return; }
  wsState = 'connecting';
  let sock;
  try { sock = new WebSocket(AIS_URL); } catch (e) { wsState = 'error'; scheduleAis(); return; }
  ws = sock;
  sock.on('open', () => {
    backoff = 1500; wsState = 'live';
    try { sock.send(JSON.stringify({ APIKey: AIS_TOKEN, Subscribe: true, BoundingBoxes: AIS_BOXES })); } catch {}
    console.log(`[radar] AIS live — subscribed to ${AIS_BOXES.length} shipping lanes`);
  });
  sock.on('message', (buf) => { ingestMessage(buf); });
  sock.on('error', () => { /* close will follow and drive the reconnect */ });
  sock.on('close', () => { ws = null; if (wsState !== 'stopped') { wsState = 'closed'; scheduleAis(); } });
}

function scheduleAis() {
  if (reconnectTimer || wsState === 'stopped') return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectAis(); }, backoff);
  backoff = Math.min(backoff * 2, 60000);               // exponential, capped at a minute
  if (reconnectTimer.unref) reconnectTimer.unref();
}

// Called once at boot: a no-op without a token, so the process never opens a socket it
// has no business opening and ships simply read as "not enabled" on the page.
function startAis() {
  if (!AIS_TOKEN) { wsState = 'no-token'; return false; }
  connectAis();
  return true;
}

function stopAis() {
  wsState = 'stopped';
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.close(); } catch {} ws = null; }
}

module.exports = {
  aircraft, normalise,
  vesselsNear, aisStatus, startAis, stopAis, ingestMessage,
  OPENSKY, AIS_BOXES, TTL_AIR, VESSEL_TTL,
};
