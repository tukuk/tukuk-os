'use strict';
// ── TUKUK-OS GEMPA COMPLEX — USGS Earthquake Feed (FREE, no API key) ──────────
// Source: https://earthquake.usgs.gov/fdsnws/event/1/query (GeoJSON). No signup,
// no hard quota (fair-use policy), USGS refreshes about every 5 minutes. We cache
// 10 minutes → zero extra load on our server.
// The static big-event history lives inside the explanation page text only.
const axios = require('axios');
const { attachGuard } = require('./outbound');

const http = axios.create({
  timeout: 20000,
  headers: { 'User-Agent': 'TukukOS-Gempa-Client/1.0 (+https://tukuk.org)' },
});
// Deliberately shortened from the declared 20 s: no page on this box may hold a visitor for
// twenty seconds because USGS took a moment (the guard's 15 s default is the ceiling now).
attachGuard(http, { name: 'gempa' });

const QUERY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

const cache = new Map();
const inflight = new Map();
const TTL = 10 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) return { data: hit.data, stale: true };
  return { data: hit.data, stale: false };
}

function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + TTL });
  if (cache.size > 60) {
    let oldestKey = null; let oldest = Infinity;
    for (const [k, v] of cache) if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// ——— Fixed regions (slug → lat/lon box) — bbox = [minLon, minLat, maxLon, maxLat] ———
// Slugs stay Malay because they are the public URLs; the labels are English.
const REGIONS = [
  { slug: 'malaysia', name: 'Malaysia', bbox: [98, -2, 121, 8], minMag: 2.0, hours: 24 * 30, limit: 60,
    blurb: 'The earthquakes closest to Malaysia — Sabah, Sarawak, the Peninsula and the South China Sea border.' },
  { slug: 'southeast-asia', name: 'Southeast Asia', bbox: [90, -15, 148, 30], minMag: 4.5, hours: 24 * 7, limit: 60,
    blurb: 'Indonesia, the Philippines, Papua New Guinea and neighbours — the most tectonically active zone in Asia.' },
  { slug: 'japan', name: 'Japan & the Western Pacific', bbox: [125, 10, 180, 50], minMag: 4.0, hours: 24 * 7, limit: 50,
    blurb: 'The western side of the Ring of Fire: Japan, Kamchatka, Mariana and the Ryukyu Islands.' },
  { slug: 'east-pacific', name: 'Eastern Pacific & the Americas', bbox: [-180, -60, -55, 62], minMag: 5.0, hours: 24 * 7, limit: 50,
    blurb: 'The west coast of the Americas: California, Chile, Peru, Mexico and Alaska.' },
  { slug: 'world', name: 'World M4.5+', bbox: null, minMag: 4.5, hours: 24 * 7, limit: 80,
    blurb: 'Every earthquake of magnitude 4.5 or above worldwide, over the last seven days.' },
];

function findRegion(slug) {
  return REGIONS.find((r) => r.slug === String(slug || '')) || null;
}

async function usgsQuery(params) {
  const key = JSON.stringify(params);
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  // stale-while-revalidate: a USGS feed can take ~8s; serve the old data at once
  // and re-fetch in the background so the page never 503s or waits a long time.
  if (hit && hit.stale) { fetchAndCache(key, params).catch(() => {}); return hit.data; }
  return fetchAndCache(key, params);
}

async function fetchAndCache(key, params) {
  // Single-flight: a cold cache plus a burst of readers used to open one USGS query per
  // request, and when that upstream call timed out the page answered 503 even though a
  // retry a moment later succeeds. Callers now share one promise.
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchOnce(key, params, 0).finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

async function fetchOnce(key, params, attempt) {
  try {
    const res = await http.get(QUERY_URL, {
      params: { format: 'geojson', orderby: 'time', ...params },
    });
    const rows = (res.data && Array.isArray(res.data.features) ? res.data.features : []).map((f) => {
      const p = f.properties || {};
      const c = (f.geometry && f.geometry.coordinates) || [0, 0, 0];
      return {
        id: String(f.id || p.id || ''),
        mag: Number(p.mag) || 0,
        place: String(p.place || ''),
        time: Number(p.time) || 0,
        depth: Math.round((Number(c[2]) || 0) * 10) / 10,
        lat: Math.round(Number(c[1]) * 10000) / 10000,
        lon: Math.round(Number(c[0]) * 10000) / 10000,
        url: String(p.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`),
        tsunami: Number(p.tsunami) > 0,
        felt: Number(p.felt) || 0,
        cdi: Number(p.cdi) || 0,
        status: String(p.status || 'automatic'),
        sig: Number(p.sig) || 0,
      };
    });
    cacheSet(key, rows);
    return rows;
  } catch (err) {
    const h = cacheGet(key);
    if (h) return h.data; // stale beats an error
    if (attempt < 1) return fetchOnce(key, params, attempt + 1); // one retry, then give up
    throw err;
  }
}

// Query by configured region (a lat/lon box, or none for the whole world).
function regionFeed(r) {
  // findRegion hands back null for a slug that is not in REGIONS; say so plainly
  // instead of dereferencing null and surfacing a bare TypeError at the call site.
  if (!r) throw new Error('regionFeed needs a known region');
  const params = { starttime: isoAgo(r.hours), endtime: new Date().toISOString(), minmagnitude: r.minMag, limit: r.limit };
  if (r.bbox) {
    const [minLon, minLat, maxLon, maxLat] = r.bbox;
    params.minlongitude = minLon; params.minlatitude = minLat;
    params.maxlongitude = maxLon; params.maxlatitude = maxLat;
  }
  return usgsQuery(params);
}

function isoAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

// Summary for the hub statistic cards.
function summarise(rows) {
  if (!rows || !rows.length) return { count: 0, max: 0, latest: null, shallow: 0, felt: 0, tsunamis: 0 };
  let max = 0; let shallow = 0; let felt = 0; let tsunamis = 0;
  for (const q of rows) {
    if (q.mag > max) max = q.mag;
    if (q.depth < 35) shallow += 1;
    if (q.felt > 0) felt += 1;
    if (q.tsunami) tsunamis += 1;
  }
  return { count: rows.length, max, latest: rows[0], shallow, felt, tsunamis };
}

module.exports = { REGIONS, findRegion, regionFeed, usgsQuery, summarise };
