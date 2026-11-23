'use strict';
// ── TUKUK-OS DISASTER COMPLEX — live natural-event watch from NASA EONET ──
// Source: https://eonet.gsfc.nasa.gov/api/v3 — NASA Earth Observatory Network,
// staffed 24/7 by human curators plus satellites. NO key, no signup.
// Covers volcanoes, storms, wildfires, floods, drought, landslides, snow,
// dust, sea ice and water issues around the world.
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const EONET = 'https://eonet.gsfc.nasa.gov/api/v3';
const cache = new Map();
const inflight = new Map();   // one shared EONET promise per key, so a cold burst of readers asks once
const TTL_OPEN = 6 * 60 * 60 * 1000;  // the open-event list refreshes a few times a day
const TTL_ONE = 24 * 60 * 60 * 1000;  // one event's detail

function cacheGet(key, ttl) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data, ttl) {
  cache.set(key, { data, expiresAt: Date.now() + (ttl || TTL_OPEN) });
}

// The last-good open list of every category, on disk — exactly how gempa/books/recipes keep
// theirs. A restart must not make the first visitor wait on EONET, and a category whose
// upstream call is slow or down must still answer with the list it showed an hour ago, so the
// live hub never has to hand a crawler a 503. Keyed by EONET category id (never a query, so it
// stays small: one entry per category, bounded by CATS.length).
const MIRROR_FILE = process.env.BENCANA_MIRROR_PATH || path.join(path.dirname(config.store.path), 'bencana-last.json');

function readMirror() {
  try {
    const raw = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeMirror(catId, entry, all) {
  try {
    all[catId] = entry;
    fs.mkdirSync(path.dirname(MIRROR_FILE), { recursive: true });
    const tmp = `${MIRROR_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, MIRROR_FILE); // rename is atomic: a reader never sees half a file
  } catch {
    // a failed mirror is a slow restart later, never a broken page now
  }
}

// The IPv6 agent goes first — server.js pins the global resolver to 'ipv4first'.
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const v4Agent = new https.Agent({ family: 4, keepAlive: true });

function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': 'TukukOS-Bencana-Client/1.0 (+https://tukuk.org)' } }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        httpsGet(next, agent).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function fetchJson(url) {
  try { return await httpsGet(url, v6Agent); }
  catch { return await httpsGet(url, v4Agent); }
}

// The categories we publish (EONET id → slug/name), each with the explanatory
// blurb that doubles as the SEO copy of its category page.
// Slugs are English (Oct 2026): the old Malay slugs survive only in LEGACY_SLUGS below,
// which the 301 redirects use so no published address breaks.
// KNOWN DATA DEFECT (not yet fixed, it would move public URLs): EONET v3 publishes
// drought, dustHaze, earthquakes, floods, landslides, manmade, seaLakeIce,
// severeStorms, snow, tempExtremes, volcanoes, waterColor and wildfires — so the ids
// dustHazard, seaAndLakeIce, icebergs and waterIssues below are unknown to the API,
// and an unknown category= does not error: EONET drops the filter and returns every
// open event (up to the limit). Those four pages therefore over-report.
const CATS = [
  { id: 'volcanoes', slug: 'volcanoes', en: 'Volcanoes', icon: '🌋',
    blurb: 'Volcanic activity under watch right now — eruptions, volcanic tremor, lava flows and ash alerts. Volcanic ash can travel thousands of kilometres and ground aircraft, so this list is kept current by NASA curators working from VAAC and observatory reports worldwide.' },
  { id: 'severeStorms', slug: 'storms', en: 'Hurricanes & Cyclones', icon: '🌀',
    blurb: 'Tropical cyclones, hurricanes, typhoons and severe thunderstorms — spotted from space by geostationary satellite scans. Storm names come from six rotating regional lists; strength is measured on the Saffir–Simpson scale in the western hemisphere and the JMA scale in Asia.' },
  { id: 'wildfires', slug: 'wildfires', en: 'Wildfires & Forest Fires', icon: '🔥',
    blurb: 'Active forest, scrub and peat-land fires — detected by the MODIS and VIIRS sensors, which see burning heat from orbit. Fire smoke can cross whole continents and degrade air quality in countries far away from the flame.' },
  { id: 'floods', slug: 'floods', en: 'Floods', icon: '🌊',
    blurb: 'River, flash and monsoon floods that reach people — reported by disaster agencies and imaged by water satellites (Sentinel-1 sees through cloud). Flooding is the most frequent disaster on earth; more than 1.5 billion people are affected every decade.' },
  { id: 'drought', slug: 'drought', en: 'Drought', icon: '☀️',
    blurb: 'Places suffering a prolonged shortfall of rain — tracked with soil-delay and land-surface temperature indices. Drought moves slowly but kills more livestock and crops than the sudden disasters do.' },
  { id: 'landslides', slug: 'landslides', en: 'Landslides', icon: '⛰️',
    blurb: 'Slope failures, slumps and debris flows — usually triggered by heavy rain or an earthquake in hilly ground. Mountainous tropics such as Indonesia and the Philippines are badly exposed through the monsoon season.' },
  { id: 'snow', slug: 'snow', en: 'Snow & Extreme Cold', icon: '❄️',
    blurb: 'Major snowstorms and severe freezing weather — from North American blizzards to early Himalayan snow. These events test a country\'s power grid, flights and water supply in a single night.' },
  { id: 'dustHazard', slug: 'dust-storms', en: 'Dust & Sandstorms', icon: '🏜️',
    blurb: 'Saharan dust, Asian sandstorms and dust storms — dust clouds that can cross an ocean and reach the Caribbean. The phosphorus they carry even fertilises the Amazon rainforest every year.' },
  { id: 'seaAndLakeIce', slug: 'sea-ice', en: 'Sea & Lake Ice', icon: '🧊',
    blurb: 'The formation and breakup of Arctic sea ice and frozen lakes — the most honest barometer of polar climate. Seasonal sea-ice extent has been shrinking every decade since satellite measurement began in 1979.' },
  { id: 'icebergs', slug: 'icebergs', en: 'Icebergs', icon: '🚢',
    blurb: 'Giant icebergs calved from the Greenland and Antarctic ice shelves — some the size of a city, able to drift for years. Watching them matters for shipping lanes and for sea-level-rise research.' },
  { id: 'waterIssues', slug: 'water', en: 'Water Issues', icon: '💧',
    blurb: 'Events that hit the water supply — pollution, landslides into reservoirs, dam failures and shortages. More than 2 billion people live in water-stressed countries; the topic rarely makes headlines, but the slow danger is large.' },
  { id: 'manmade', slug: 'man-made', en: 'Human-Made Incidents', icon: '🏭',
    blurb: 'Technological and industrial disasters seen from space: warehouse fires, collapses, oil spills and explosions. This category is a reminder that satellites watch over human safety, not nature alone.' },
];

function findCat(slug) {
  const s = String(slug || '');
  return CATS.find((c) => c.slug === s || c.id === s) || null;
}

// Old Malay category slug → the English slug now published. Only used by 301 redirects.
const LEGACY_SLUGS = {
  'gunung-berapi': 'volcanoes',
  'taufan-ribut': 'storms',
  'kebakaran-lahan': 'wildfires',
  banjir: 'floods',
  kemarau: 'drought',
  'tanah-runtuh': 'landslides',
  'salji-beku': 'snow',
  'badai-habuk': 'dust-storms',
  'ais-laut': 'sea-ice',
  'gunung-ais': 'icebergs',
  'isu-air': 'water',
  'insiden-manusia': 'man-made',
};

// EONET sends the geometry under `geometry` (singular) on BOTH the list and the
// detail endpoint, and never sends created/updated — derive them from the ends of
// the timeline, then hand the page one stable key: `geometries`.
function normaliseEvent(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  if (!Array.isArray(ev.geometries)) ev.geometries = Array.isArray(ev.geometry) ? ev.geometry : [];
  if (ev.geometries.length && (ev.created == null || ev.updated == null)) {
    const dates = ev.geometries.map((g) => String(g.date || '')).filter(Boolean).sort();
    if (dates.length) {
      if (ev.created == null) ev.created = dates[0];
      if (ev.updated == null) ev.updated = dates[dates.length - 1];
    }
  }
  return ev;
}

// The list of events still open for one EONET category.
// Resilience ladder (same shape as the USGS feed): fresh cache → stale-while-revalidate →
// disk mirror (read before the network, so a cold process renders at once) → live fetch with
// one retry. Every rung that can answer does, so a slow or briefly-down EONET call produces a
// slightly older hub page, never a 503 that an AdSense reviewer would see.
async function loadEvents(cat) {
  const key = `open:${cat.id}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  if (hit && hit.stale) { refreshEvents(cat).catch(() => {}); return hit.data; }
  const mirrored = readMirror()[cat.id];
  if (mirrored && Array.isArray(mirrored.events)) {
    cache.set(key, { data: mirrored.events, expiresAt: Date.now() }); // expired on purpose: next call revalidates
    refreshEvents(cat).catch(() => {});
    return mirrored.events;
  }
  return refreshEvents(cat);
}

// Single-flight refresh: a cold cache plus a burst of readers opens ONE EONET query per
// category, not one per request.
function refreshEvents(cat) {
  const key = `open:${cat.id}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchEvents(cat, 0).finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

async function fetchEvents(cat, attempt) {
  const key = `open:${cat.id}`;
  try {
    const body = await fetchJson(`${EONET}/events?category=${encodeURIComponent(cat.id)}&status=open&limit=300&include=geo`);
    const events = (body && Array.isArray(body.events)) ? body.events.map(normaliseEvent) : null;
    if (!events) throw new Error('no event list');
    cacheSet(key, events, TTL_OPEN);
    writeMirror(cat.id, { at: new Date().toISOString(), events }, readMirror());
    return events;
  } catch (err) {
    const h = cacheGet(key);
    if (h) return h.data; // stale beats an error
    const m = readMirror()[cat.id];
    if (m && Array.isArray(m.events)) return m.events; // yesterday's list beats a 503
    if (attempt < 1) return fetchEvents(cat, attempt + 1); // one retry, then give up
    throw err;
  }
}

// Open every category at once for the hub (one failing category must not sink it).
async function loadAllOpen() {
  const results = await Promise.all(CATS.map(async (c) => {
    try { return { cat: c, events: await loadEvents(c) }; }
    catch { return { cat: c, events: null }; }
  }));
  const ok = results.filter((r) => r.events && r.events.length);
  if (!ok.length) throw new Error('every feed failed');
  return results; // keeps the CATS order; the caller checks events === null
}

// Detail of one event — the full geometry / timeline.
async function loadEvent(eonetId) {
  const id = String(eonetId || '');
  if (!/^EONET_\d+$/.test(id)) throw new Error('odd event id');
  const key = `ev:${id}`;
  const hit = cacheGet(key, TTL_ONE);
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(`${EONET}/events/${id}`);
    if (!body || !body.id) throw new Error('no such event');
    normaliseEvent(body);
    cacheSet(key, body, TTL_ONE);
    return body;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Display helper: [lng,lat] coordinates → a readable label + an open-map URL.
function geoLabel(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]); const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, text: `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}` };
}

// ── wikiPeek: a Wikipedia summary for the context box on the event page ─────
// Source: the en.wikipedia.org API — FREE, no key. Two steps: an opensearch
// query (place name → encyclopedia article title), then the REST summary
// (short extract + thumbnail). If either step fails → null and the page is
// still valid without the box. Cached 24 hours — Wikipedia summaries change slowly.
async function wikiPeek(term) {
  const q = String(term || '').trim();
  if (!q || q.length < 3) return null;
  const key = `wiki:${q.toLowerCase()}`;
  const hit = cacheGet(key, TTL_ONE);
  if (hit && !hit.stale) return hit.data;
  try {
    const os = await fetchJson(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`);
    const title = os && os[1] && os[1][0];
    if (!title) { cacheSet(key, null, TTL_ONE); return null; }
    const sum = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!sum || !sum.extract) { cacheSet(key, null, TTL_ONE); return null; }
    const out = {
      title: sum.title || title,
      extract: sum.extract,
      url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      thumb: sum.thumbnail && sum.thumbnail.source ? sum.thumbnail.source : null,
    };
    cacheSet(key, out, TTL_ONE);
    return out;
  } catch {
    return hit ? hit.data : null;
  }
}

module.exports = { CATS, LEGACY_SLUGS, findCat, loadEvents, loadAllOpen, loadEvent, geoLabel, wikiPeek, normaliseEvent };
