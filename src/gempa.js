'use strict';
// ── TUKUK-OS GEMPA COMPLEX — USGS Earthquake Feed (PERCUMA, tanpa kunci API) ──
// Sumber: https://earthquake.usgs.gov/fdsnws/event/1/query (GeoJSON). Tiada
// pendaftaran, tiada kuota keras (dasar penggunaan yang munasabah), kemas kini
// setiap ~5 minit di pihak USGS. Kita cache 10 minit → beban pelayan sifar.
// Sejarah acara besar statik disimpan dalam teks halaman penjelasan sahaja.
const axios = require('axios');

const http = axios.create({
  timeout: 20000,
  headers: { 'User-Agent': 'TukukOS-Gempa-Client/1.0 (+https://tukuk.org)' },
});

const QUERY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

const cache = new Map();
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

// ——— Wilayah tetap (slug → kotak lat/lon) — bbox = [minLon, minLat, maxLon, maxLat] ———
const REGIONS = [
  { slug: 'malaysia', name: 'Malaysia', bbox: [98, -2, 121, 8], minMag: 2.0, hours: 24 * 30, limit: 60,
    blurb: 'Gempa terdekat dengan Malaysia — Sabah, Sarawak, Semenanjung dan sempadan Laut China Selatan.' },
  { slug: 'asia-tenggara', name: 'Asia Tenggara', bbox: [90, -15, 148, 30], minMag: 4.5, hours: 24 * 7, limit: 60,
    blurb: 'Indonesia, Filipina, Papua New Guinea dan sekeliling — zon tektonik paling aktif di Asia.' },
  { slug: 'jepun', name: 'Jepun & Pasifik Barat', bbox: [125, 10, 180, 50], minMag: 4.0, hours: 24 * 7, limit: 50,
    blurb: 'Cincin Api bahagian barat: Jepun, Kamchatka, Mariana dan Kepulauan Ryukyu.' },
  { slug: 'pasifik-timur', name: 'Pasifik Timur & Amerika', bbox: [-180, -60, -55, 62], minMag: 5.0, hours: 24 * 7, limit: 50,
    blurb: 'Pantai barat Amerika: California, Chile, Peru, Mexico dan Alaska.' },
  { slug: 'dunia', name: 'Dunia M4.5+', bbox: null, minMag: 4.5, hours: 24 * 7, limit: 80,
    blurb: 'Semua gempa magnitude 4.5 ke atas di seluruh dunia, tujuh hari terakhir.' },
];

function findRegion(slug) {
  return REGIONS.find((r) => r.slug === String(slug || '')) || null;
}

async function usgsQuery(params) {
  const key = JSON.stringify(params);
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  // stale-while-revalidate: suapan USGS boleh ambil ~8s; hidang data lama serta-merta
  // dan muat semula di latar supaya halaman tak pernah 503 atau tunggu lama.
  if (hit && hit.stale) { fetchAndCache(key, params).catch(() => {}); return hit.data; }
  return fetchAndCache(key, params);
}

async function fetchAndCache(key, params) {
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
    if (h) return h.data; // stale lebih baik daripada gagal
    throw err;
  }
}

// Carikan mengikut wilayah config (kotak lat/lon atau tanpa kotak untuk dunia).
function regionFeed(r) {
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

// Ringkasan untuk kad statistik hab.
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
