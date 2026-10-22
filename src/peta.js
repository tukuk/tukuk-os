'use strict';
// ── TUKUK-OS MAPS & NAVIGATION — free routing, no API key anywhere ─────────────
// Geocoding: Nominatim (OpenStreetMap search) — proxy through OUR server so the
// required contact User-Agent is set once and every result is cached 24 h.
// Routing: OSRM engines. Driving uses the public demo router; cycling and
// walking use the FOSSGIS OSRM instances. Both run on OpenStreetMap data and
// charge nothing. Responses are cached per coordinate pair (30 min) with the
// same stale-beats-error rule as gempa.js, so a flaky router never kills a page.
const axios = require('axios');
const https = require('https');

// Our deploy box has a working IPv4 route but no usable IPv6, and Node's
// Happy-Eyeballs (autoSelectFamily, on by default in Node 20+) fails there
// against the OSRM hosts' dual-stack DNS — curl connects fine, Node times
// out. Disabling family selection on this agent restores plain IPv4-first
// behaviour without touching any other module's networking.
const agent = new https.Agent({ autoSelectFamily: false, keepAlive: true });

const http = axios.create({
  timeout: 15000,
  httpsAgent: agent,
  headers: { 'User-Agent': 'TukukOS-Peta-Client/1.0 (+https://tukuk.org)' },
});

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OM_GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const ROUTERS = {
  car: 'https://router.project-osrm.org/route/v1/driving/',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/cycling/',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/',
};
const MODE_LABEL = { car: '🚗 Driving', bike: '🚲 Cycling', foot: '🚶 Walking' };

const cache = new Map();
const TTL_GEOCODE = 24 * 60 * 60 * 1000;
const TTL_ROUTE = 30 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}

function cacheSet(key, data, ttl) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
  if (cache.size > 200) {
    let oldestKey = null; let oldest = Infinity;
    for (const [k, v] of cache) if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// Shared GET with JSON cache; stale data beats a thrown error.
async function getCached(key, ttl, url) {
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const res = await http.get(url);
    cacheSet(key, res.data, ttl);
    return res.data;
  } catch (err) {
    if (hit) return hit.data; // stale beats an error
    throw err;
  }
}

// Text → up to 5 {label, lat, lon} places. Short/empty queries are rejected
// locally so we never spam the public nominatim instances.
async function geocode(q) {
  const query = String(q || '').trim();
  if (query.length < 3 || query.length > 80) throw new Error('query too short or too long');
  const key = `geo:${query.toLowerCase()}`;
  const data = await getCached(key, TTL_GEOCODE,
    `${NOMINATIM}?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`);
  const rows = (Array.isArray(data) ? data : []).map((r) => ({
    label: String(r.display_name || r.name || '').trim(),
    lat: Number(r.lat), lon: Number(r.lon),
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  if (!rows.length) throw new Error('place not found');
  return rows;
}

// Two points → one route: polyline, distance, duration, human step list.
async function route(from, to, mode) {
  const base = ROUTERS[mode] || ROUTERS.car;
  const f = `${round6(from.lon)},${round6(from.lat)}`;
  const t = `${round6(to.lon)},${round6(to.lat)}`;
  const key = `rt:${mode}:${f}:${t}`;
  let data;
  try {
    data = await getCached(key, TTL_ROUTE,
      `${base}${f};${t}?overview=simplified&geometries=geojson&steps=true`);
  } catch (err) {
    // OSRM answers impossible requests with a 400 + a real reason — pass it
    // through so the UI can be honest instead of saying “routing failed”.
    const m = err && err.response && err.response.data && err.response.data.message;
    if (m === 'Impossible route between points') throw new Error('no road route between these points (separated by sea?)');
    if (m) throw new Error(String(m).toLowerCase());
    throw new Error('router unreachable — try again in a minute');
  }
  const r = data && data.routes && data.routes[0];
  if (!r) throw new Error('no route found');
  const coords = (r.geometry && Array.isArray(r.geometry.coordinates) ? r.geometry.coordinates : [])
    .map(([lon, lat]) => [lat, lon]);
  const steps = [];
  const legs = Array.isArray(r.legs) ? r.legs : [];
  for (const leg of legs) {
    for (const st of (leg.steps || [])) steps.push({
      text: stepText(st),
      distance: Math.round(st.distance || 0),
    });
  }
  return {
    mode: ROUTERS[mode] ? mode : 'car',
    distance: Math.round(r.distance || 0),
    duration: Math.round(r.duration || 0),
    coords, steps,
  };
}

function round6(n) { return Math.round(Number(n) * 1e6) / 1e6; }

// Great-circle distance in km between two {lat, lon} points — the honest
// "as the crow flies" number, pure spherical geometry, no API involved.
function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

// Sunrise / sunset / day length by the classic textbook solar-position
// algorithm: mean anomaly → ecliptic longitude → declination + right
// ascension → equation of time → hour angle at zenith 90.833° (refraction
// and solar disc included, so it matches printed almanacs). Accurate to
// well under a minute and pure arithmetic — no service can be down,
// rate-limited or sold. Times return as UTC minutes from midnight; polar
// day/night are reported honestly instead of invented.
function solarTimes(lat, lon, dateStr) {
  const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
  const norm = (x, lo, hi) => lo + ((x - lo) % (hi - lo) + (hi - lo)) % (hi - lo);
  const [Y, M, D] = String(dateStr).split('-').map(Number);
  if (!Y || !M || !D) throw new Error('bad date');
  const n = (Date.UTC(Y, M - 1, D) - Date.UTC(Y, 0, 1)) / 86400000; // days since Jan 1
  const meanAnom = rad(norm(357.5291 + 0.98560028 * n, 0, 360));
  const meanLong = norm(280.459 + 0.98564736 * n, 0, 360);          // degrees
  const eclLong = rad(norm(meanLong + 1.915 * Math.sin(meanAnom) + 0.020 * Math.sin(2 * meanAnom), 0, 360));
  const obliq = rad(23.4393 - 0.00000036 * n);
  const decl = Math.asin(Math.sin(obliq) * Math.sin(eclLong));
  const ra = Math.atan2(Math.cos(obliq) * Math.sin(eclLong), Math.cos(eclLong)); // radians
  const eqTime = 4 * norm(meanLong - deg(ra), -180, 180);           // minutes
  const sinDec = Math.sin(decl), cosDec = Math.cos(decl);
  // Hour-angle offset in minutes of time for a given zenith angle.
  // null = the sun never reaches that altitude (polar night side of it),
  // 'always' = it never drops below (polar day). 90.833° = rise/set with
  // refraction; 96° = civil twilight (sun 6° below the horizon).
  const off = (zen) => {
    const c = (Math.cos(rad(zen)) - Math.sin(rad(lat)) * sinDec) / (Math.cos(rad(lat)) * cosDec);
    if (c > 1) return null;
    if (c < -1) return 'always';
    return deg(Math.acos(c)) * 4;
  };
  const noon = 720 - 4 * lon - eqTime;                          // minutes after 00:00 UTC
  const wrap = (m) => ((m % 1440) + 1440) % 1440;
  const sun = off(90.833), civil = off(96);
  const res = {
    noonUtc: wrap(noon), polar: sun === 'always' ? 'day' : sun === null ? 'night' : null,
    declDeg: deg(decl), eqTime,
  };
  if (typeof sun === 'number') {
    res.sunriseUtc = wrap(noon - sun);
    res.sunsetUtc = wrap(noon + sun);
    res.dayLengthMin = Math.round(sun * 2);
  }
  if (typeof civil === 'number') {
    res.civilDawnUtc = wrap(noon - civil);
    res.civilDuskUtc = wrap(noon + civil);
  }
  return res;
}

// City name → IANA time zone name (for the world clock). Goes through the
// same fixed http agent as everything else here; explore.js has its own
// transport that hits the deploy box’s Happy-Eyeballs bug on this host.
async function city(q) {
  const query = String(q || '').trim();
  if (query.length < 2 || query.length > 60) throw new Error('city name too short or too long');
  const data = await getCached(`city:${query.toLowerCase()}`, TTL_GEOCODE,
    `${OM_GEO}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
  const r = Array.isArray(data && data.results) ? data.results[0] : null;
  if (!r || !r.timezone) throw new Error('place not found');
  return { name: String(r.name || query), country: String(r.country || ''), tz: String(r.timezone) };
}

// OSRM maneuver → a short English instruction the way a navigator would say it.
function stepText(st) {
  const t = String((st.maneuver && st.maneuver.type) || '');
  const m = String(st.maneuver && st.maneuver.modifier || '');
  const name = String(st.name || '').trim();
  const onto = name ? ` onto ${name}` : '';
  if (t === 'arrive') return `Arrive${name ? ' at ' + name : ' at your destination'}`;
  if (t === 'depart') return `Head ${m || 'out'}${name ? ` along ${name}` : ''}`;
  if (t === 'turn') return `Turn ${m}${onto || ' (continue straight ahead)'}`;
  if (t === 'new name') return `Continue${onto}`;
  if (t === 'continue' || t === 'merge') return `Continue ${m}${onto}`;
  if (t === 'on ramp') return `Take the ramp${onto}`;
  if (t === 'off ramp') return `Take the exit${onto}`;
  if (t === 'fork') return `Keep ${m} at the fork${onto}`;
  if (t === 'roundabout' || t === 'rotary') return `Take the roundabout${onto || ' and exit straight ahead'}`;
  if (t === 'end of road') return `At the end of the road turn ${m}${onto}`;
  if (t === 'change bridge' || t === 'change main road') return `Continue${onto}`;
  return `Continue${onto}`;
}

module.exports = { geocode, route, city, haversineKm, solarTimes, ROUTERS, MODE_LABEL };
