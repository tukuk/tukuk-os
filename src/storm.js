// ── TUKUK-OS STORM & WIND — real wind, weather and ocean waves over the map ─────────
// One page (/maps/storm) reads the living atmosphere off a grid of points: the wind
// (speed, direction and gusts), the sea state (wave height, period and direction), the
// temperature, the pressure and the WMO weather code (rain, thunder, snow…) at each.
// The data is Open-Meteo — a free, keyless numerical-weather service — and it is asked
// for the WHOLE visible grid in a single multi-location call, so a hundred visitors
// watching the same sky cost the provider one forecast request per coarse box, not one
// per person. Our server sits in front: the browser only ever talks to tukuk.org, the
// grid is cached for a few minutes (weather does not turn on a dime), and every arrow we
// draw is a value a weather model genuinely reported. A point the model has no answer
// for (open ocean for wind, dry land for waves) stays blank instead of being invented.
const axios = require('axios');
const https = require('https');
const { attachGuard } = require('./outbound');

const agent = new https.Agent({ autoSelectFamily: false, keepAlive: true });
const http = axios.create({
  timeout: 9000,
  httpsAgent: agent,
  headers: { 'User-Agent': 'TukukOS-Storm-Client/1.0 (+https://tukuk.org)' },
});
// Live weather must fail fast and fall back to the last cached grid, not hold a socket.
attachGuard(http, { name: 'storm', budgetMs: 9000, cooldownMs: 30000 });

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
// Wind, temperature, pressure and weather code, all as the model's current instant.
const FC_VARS = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,pressure_msl,weather_code,precipitation';

const cache = new Map();                 // grid key -> { at, list }
const TTL = 300000;                       // five minutes: the sky agrees with itself
const MAX_POINTS = 24;                    // one call can never ask for a hemisphere's worth
const fin = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

// WMO 4677 weather codes (what Open-Meteo reports). A compact, honest label + one icon;
// anything unknown stays "—" rather than guessing at the sky.
const WMO = {
  0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Depositing rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Dense drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Dense freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Heavy freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '❄️'],
  80: ['Rain showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'], 86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm + hail', '⛈️'], 99: ['Severe thunderstorm + hail', '⛈️'],
};
function wmo(code) {
  const hit = WMO[Number(code)];
  return hit ? { label: hit[0], icon: hit[1] } : { label: '', icon: '' };
}

// Beaufort wind force from km/h — the mariner's scale, so a number becomes a feeling.
function beaufort(kmh) {
  if (!Number.isFinite(kmh)) return null;
  const b = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  let f = 0;
  for (let i = 0; i < b.length; i++) if (kmh >= b[i]) f = i + 1;
  return f;
}

// Turn one Open-Meteo location object into the compact row the page draws. A missing
// wind speed (a point with no model level) yields null coordinates downstream, so the
// arrow simply is not drawn.
function normalise(loc) {
  const c = loc && loc.current;
  if (!c) return null;
  const lat = fin(loc.latitude); const lon = fin(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const spd = fin(c.wind_speed_10m); const dir = fin(c.wind_direction_10m);
  const gust = fin(c.wind_gusts_10m); const temp = fin(c.temperature_2m);
  const pres = fin(c.pressure_msl); const precip = fin(c.precipitation);
  const code = c.weather_code;
  const w = wmo(code);
  return {
    lat, lon,
    windKmh: Number.isFinite(spd) ? Math.round(spd) : null,
    windDir: Number.isFinite(dir) ? Math.round(dir) : null,
    gustKmh: Number.isFinite(gust) ? Math.round(gust) : null,
    tempC: Number.isFinite(temp) ? Math.round(temp * 10) / 10 : null,
    pressureHpa: Number.isFinite(pres) ? Math.round(pres * 10) / 10 : null,
    precipMm: Number.isFinite(precip) ? Math.round(precip * 10) / 10 : null,
    code: Number.isFinite(fin(code)) ? Number(code) : null,
    wx: w.label, wxIcon: w.icon,
    beaufort: beaufort(Number.isFinite(spd) ? spd : NaN),
  };
}

// The visible rectangle -> the wind, weather and pressure Open-Meteo reports on a coarse
// lattice inside it. Points are rounded to one decimal (~11 km) so neighbouring viewports
// reuse one cache entry and one upstream call; a hard cap keeps one wide zoom from asking
// for a whole continent in a single request.
async function windField(bbox) {
  const { latMin, latMax, lonMin, lonMax } = bbox || {};
  if (![latMin, latMax, lonMin, lonMax].every((n) => Number.isFinite(n)))
    throw new Error('need a finite bounding box');
  const lats = []; const lons = [];
  const rows = 4; const cols = 6;
  const r1 = (n) => Math.round(n * 10) / 10;
  for (let r = 0; r < rows; r++) {
    const la = latMin + (r / (rows - 1)) * (latMax - latMin);
    for (let c = 0; c < cols; c++) {
      const lo = lonMin + (c / (cols - 1)) * (lonMax - lonMin);
      lats.push(r1(la)); lons.push(r1(lo));
    }
  }
  // De-duplicate rounded points (a small box rounds to repeats) and enforce the cap.
  const seen = new Set(); const pl = [];
  for (let i = 0; i < lats.length; i++) {
    const k = `${lats[i]}|${lons[i]}`;
    if (seen.has(k)) continue;
    seen.add(k); pl.push({ lat: lats[i], lon: lons[i] });
    if (pl.length >= MAX_POINTS) break;
  }
  const key = pl.map((p) => `${p.lat},${p.lon}`).join(';');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { list: hit.list, cached: true, ageMs: Date.now() - hit.at };
  const url = `${FORECAST}?latitude=${pl.map((p) => p.lat).join(',')}`
    + `&longitude=${pl.map((p) => p.lon).join(',')}`
    + `&current=${FC_VARS}&timezone=UTC`;
  try {
    const res = await http.get(url);
    const arr = Array.isArray(res.data) ? res.data : [res.data];
    const list = arr.map(normalise).filter((x) => x && x.windKmh != null);
    cache.set(key, { at: Date.now(), list });
    trim();
    return { list, cached: false, ageMs: 0 };
  } catch (err) {
    if (hit) return { list: hit.list, cached: true, stale: true, ageMs: Date.now() - hit.at };
    throw err;
  }
}

// The sea state right under the viewer's crosshair. Over open water Open-Meteo reports
// real wave height/period/direction; over land it has nothing and we say so (ok:false)
// rather than showing a calm sea that does not exist.
async function marine(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: 'need a finite point' };
  const url = `${MARINE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + '&current=wave_height,wave_period,wave_direction,swell_wave_height&timezone=UTC';
  const mkey = `m|${Math.round(lat * 10) / 10}|${Math.round(lon * 10) / 10}`;
  const hit = cache.get(mkey);
  if (hit && Date.now() - hit.at < TTL) return Object.assign({ cached: true, ageMs: Date.now() - hit.at }, hit.res);
  try {
    const res = await http.get(url);
    const c = res.data && res.data.current;
    const wh = fin(c && c.wave_height); const wp = fin(c && c.wave_period); const wd = fin(c && c.wave_direction);
    const out = (Number.isFinite(wh))
      ? { ok: true, waveHeightM: Math.round(wh * 100) / 100, wavePeriodS: Number.isFinite(wp) ? Math.round(wp * 10) / 10 : null, waveDir: Number.isFinite(wd) ? Math.round(wd) : null }
      : { ok: false, error: 'no sea here' };
    cache.set(mkey, { at: Date.now(), res: out }); trim();
    return Object.assign({ cached: false, ageMs: 0 }, out);
  } catch (err) {
    if (hit) return Object.assign({ cached: true, stale: true, ageMs: Date.now() - hit.at }, hit.res);
    return { ok: false, error: String(err.message || 'marine unreachable').slice(0, 160) };
  }
}

// The atmosphere at exactly one point — what the click/details panel shows.
async function atPoint(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('need a finite point');
  const key = `p|${(Math.round(lat * 10) / 10).toFixed(1)}|${(Math.round(lon * 10) / 10).toFixed(1)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { point: hit.list[0] || null, cached: true, ageMs: Date.now() - hit.at };
  const url = `${FORECAST}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=${FC_VARS}&timezone=UTC`;
  const res = await http.get(url);
  const arr = Array.isArray(res.data) ? res.data : [res.data];
  const list = arr.map(normalise).filter(Boolean);
  cache.set(key, { at: Date.now(), list }); trim();
  return { point: list[0] || null, cached: false, ageMs: 0 };
}

function trim() {
  if (cache.size <= 400) return;
  let oldestKey = null; let oldest = Infinity;
  for (const [k, v] of cache) if (v.at < oldest) { oldest = v.at; oldestKey = k; }
  if (oldestKey) cache.delete(oldestKey);
}

module.exports = {
  windField, marine, atPoint, normalise, wmo, beaufort,
  FORECAST, MARINE, TTL, MAX_POINTS,
};
