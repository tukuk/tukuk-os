'use strict';
// ── TUKUK LIVE TRAFFIC — the real road, not only what people typed ────────────────
//
// /traffic used to be a community notice board: honest, but empty until somebody
// posted. This module gives the page a second layer that is actually measured — the
// live traffic-flow raster (green = moving, amber = slow, red = stopped) that phones
// in cars feed continuously. It is the same class of data every road map sells; we
// only add the plumbing that makes it survive on a small box:
//
//   1. PROXY      — tiles are fetched by us, not by the visitor, so the page stays
//                   same-origin (no CSP surprises, no referer games) and the provider
//                   never sees a visitor's IP. One place to swap providers later:
//                   set TRAFFIC_TILE_URL to any {z}/{x}/{y} template, plus
//                   TRAFFIC_SOURCE_LABEL and (for keyed providers) TRAFFIC_API_KEY.
//                   Keyless default today, keyed provider one restart away:
//                     TomTom  https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key={apiKey}
//                     HERE    https://traffic.maps.hereapi.com/v1/tiles/{z}/{x}/{y}/png8?apiKey={apiKey}
//   2. CACHE      — a tile is reused for two minutes, which is exactly how often a
//                   flow raster genuinely changes. Panning back to a spot you just
//                   looked at costs zero upstream calls.
//   3. STALE-BEATS-ERROR — if the provider times out, the last copy of that tile is
//                   still served (up to ten minutes old) instead of a hole in the map.
//                   A traffic map with yesterday's colours is still useful; a traffic
//                   map with a blank square is not.
//   4. NEVER BREAKS THE PAGE — with no cache and no upstream we answer with a 1×1
//                   transparent PNG, so Leaflet draws the community layer over a plain
//                   base map instead of logging a wall of tile errors.
//
// The budget and cooldown come from src/outbound.js, the same guard every other
// outbound call on this box uses, so a dead provider costs ONE slow request and then
// answers instantly for two minutes rather than one timeout per visitor.
const axios = require('axios');
const https = require('https');
const { attachGuard } = require('./outbound');

// The deploy box has no usable IPv6 route; Node's Happy-Eyeballs default fails
// against dual-stack tile hosts (the same trap documented in src/peta.js).
const agent = new https.Agent({ autoSelectFamily: false, keepAlive: true, maxSockets: 12 });

const http = axios.create({
  timeout: 8000,
  httpsAgent: agent,
  responseType: 'arraybuffer',
  maxRedirects: 2,
  // A tile is either an image or it is a failure; 3xx/4xx/5xx must reach the catch
  // block so the caller can fall back to the cache instead of leaking HTML to Leaflet.
  validateStatus: (s) => s >= 200 && s < 300,
  headers: {
    // Identify ourselves honestly. Some tile hosts reject an empty UA outright.
    'User-Agent': 'TukukOS-Traffic/1.0 (+https://tukuk.org/traffic)',
    'Accept': 'image/png,image/jpeg,image/*;q=0.8',
  },
});
attachGuard(http, { name: 'traffic-tiles', budgetMs: 8000, cooldownMs: 60000, maxConcurrent: 12 });

// Google's raster endpoint takes the layer in the PATH (not a query string), which is
// why the default template looks unusual. `lyrs=m,traffic` = road map with the live
// flow overlay burned in; `hl=en` keeps labels Latin. {s} rotates across four hosts
// so one edge never becomes the whole page's bottleneck.
const DEFAULT_TEMPLATE = 'https://mt{s}.google.com/vt/lyrs=m,traffic&x={x}&y={y}&z={z}&hl=en';
const TILE_TEMPLATE = String(process.env.TRAFFIC_TILE_URL || DEFAULT_TEMPLATE).trim();
const SOURCE_LABEL = String(process.env.TRAFFIC_SOURCE_LABEL || 'Google live traffic').trim();
// Only used when the template asks for it. Keeping the key out of the template means
// the same provider URL can live in docs/logs without carrying the secret.
const API_KEY = String(process.env.TRAFFIC_API_KEY || '').trim();
// A keyed template with no key would just be a wall of 403s in the log, so treat it
// as "no provider configured" and let the page fall back honestly.
const TEMPLATE_USABLE = Boolean(TILE_TEMPLATE) && (!TILE_TEMPLATE.includes('{apiKey}') || Boolean(API_KEY));

const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
const FRESH_MS = 2 * 60 * 1000;   // how long a tile is considered current
const STALE_MS = 10 * 60 * 1000;  // how long we keep serving it when upstream is down
const MAX_TILES = 900;            // entries kept (≈ 25 KB each → ~22 MB ceiling)
const MAX_BYTES = 24 * 1024 * 1024;

// 1×1 fully transparent PNG: the "I have nothing, but do not break" answer.
const TRANSPARENT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

/** Insertion-ordered Map used as an LRU: newest at the end, eviction from the front. */
const cache = new Map();
let cachedBytes = 0;

const stats = { served: 0, hits: 0, stale: 0, upstream: 0, errors: 0, lastOkAt: 0, lastError: '' };

/** Accepts "12", " 12 ", 12 → 12; anything outside the pyramid → null. */
function num(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Validate a slippy-map coordinate.
 * @returns {{z:number,x:number,y:number}|null} null means "not a real tile"
 */
function normalise(z, x, y) {
  const Z = num(z); const X = num(x); const Y = num(y);
  if (Z === null || X === null || Y === null) return null;
  if (Z < MIN_ZOOM || Z > MAX_ZOOM) return null;
  const span = 1 << Z;                       // 2^z tiles per axis
  if (X < 0 || Y < 0 || X >= span || Y >= span) return null;
  return { z: Z, x: X, y: Y };
}

/** The provider URL for one tile, with our headers and subdomain rotation. */
function upstreamUrl(z, x, y) {
  if (!TEMPLATE_USABLE) return '';
  return TILE_TEMPLATE
    .replace('{s}', String((x + y) % 4))
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{apiKey}', API_KEY);
}

function touch(key, entry) {
  cache.delete(key);          // re-insert so this entry becomes the newest
  cache.set(key, entry);
}

function remember(key, entry) {
  if (cache.has(key)) {
    const old = cache.get(key);
    cachedBytes -= old.buf.length;
    cache.delete(key);
  }
  cache.set(key, entry);
  cachedBytes += entry.buf.length;
  // Evict oldest entries until both ceilings are satisfied. Bounded on purpose:
  // an unbounded tile cache on a 4 GB box is how a map page becomes a memory leak.
  while (cache.size > MAX_TILES || cachedBytes > MAX_BYTES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const victim = cache.get(oldest.value);
    cache.delete(oldest.value);
    if (victim) cachedBytes -= victim.buf.length;
  }
}

// Tests inject a transport so no network is touched; production always uses axios.
let transport = async (url, config) => http.get(url, config);

/**
 * One tile, best effort.
 * Resolution order: fresh cache → provider → stale cache → null.
 * @returns {Promise<{buf:Buffer,type:string,at:number,stale:boolean,cached:boolean}|null>}
 */
async function getTile(z, x, y) {
  const at = normalise(z, x, y);
  if (!at) return null;
  const key = `${at.z}/${at.x}/${at.y}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) {
    touch(key, hit);
    stats.hits++;
    stats.served++;
    return { ...hit, stale: false, cached: true };
  }

  const url = upstreamUrl(at.z, at.x, at.y);
  if (url) {
    try {
      const res = await transport(url, { method: 'GET' });
      const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || []);
      // A 0-byte or HTML "answer" is not a tile. Treat it as an outage so the cache
      // keeps its last good copy instead of poisoning the map with a broken square.
      const type = String((res.headers && res.headers['content-type']) || 'image/png').split(';')[0].trim();
      if (buf.length > 64 && /^image\//i.test(type)) {
        const entry = { buf, type, at: Date.now() };
        remember(key, entry);
        stats.upstream++;
        stats.served++;
        stats.lastOkAt = entry.at;
        return { ...entry, stale: false, cached: false };
      }
      throw new Error(`not an image (${type}, ${buf.length}B)`);
    } catch (err) {
      stats.errors++;
      stats.lastError = String((err && err.message) || err).slice(0, 160);
    }
  }

  if (hit && Date.now() - hit.at < STALE_MS) {
    touch(key, hit);
    stats.stale++;
    stats.served++;
    return { ...hit, stale: true, cached: true };
  }
  return null;
}

/** What /api/traffic/live reports — counters only, no visitor data. */
function status() {
  const now = Date.now();
  let fresh = 0;
  for (const entry of cache.values()) if (now - entry.at < FRESH_MS) fresh++;
  return {
    source: SOURCE_LABEL,
    provider: TEMPLATE_USABLE ? safeHost(TILE_TEMPLATE) : '',
    refreshSec: Math.round(FRESH_MS / 1000),
    staleSec: Math.round(STALE_MS / 1000),
    tiles: {
      cached: cache.size,
      fresh,
      bytes: cachedBytes,
      served: stats.served,
      hits: stats.hits,
      stale: stats.stale,
      upstream: stats.upstream,
      errors: stats.errors,
    },
    lastOkAt: stats.lastOkAt || null,
    lastError: stats.lastError || null,
    serverTime: now,
  };
}

// The host is public information (it is in the attribution), but never leak a path
// that might carry a future API key.
function safeHost(template) {
  try { return new URL(template.replace('{s}', '0')).host; } catch { return ''; }
}

/** Test seam: replace the network with a stub. Never called from application code. */
function __setTransport(fn) { transport = fn || (async (url, config) => http.get(url, config)); }

/** Test seam: rewind every cached tile by `ms` so TTL boundaries can be asserted. */
function __age(ms) {
  const back = Number(ms) || 0;
  for (const entry of cache.values()) entry.at -= back;
  return cache.size;
}

/** Test seam: empty the cache and the counters. */
function reset() {
  cache.clear();
  cachedBytes = 0;
  for (const k of Object.keys(stats)) stats[k] = typeof stats[k] === 'number' ? 0 : stats[k];
  stats.lastError = '';
}

module.exports = {
  TILE_TEMPLATE, SOURCE_LABEL, TRANSPARENT, FRESH_MS, STALE_MS, MAX_TILES,
  upstreamUrl, normalise, getTile, status, reset, __setTransport, __age,
};
