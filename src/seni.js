'use strict';
// ── TUKUK-OS ART GALLERY (/seni) — The Metropolitan Museum of Collection API ─
// Source: collectionapi.metmuseum.org — FREE, no key. 490k+ artworks;
// those labelled isPublicDomain can be downloaded & viewed freely. Search
// uses v1.1 (Elastic, paginated — v1 search retires Oct 2026);
// one object's details come from v1/objects/{id} (that endpoint is still supported).
// There is no bulk /objects?ids= list — it now returns ALL ids, so
// the grid page loads N objects at once with a small cap + a long cache.
const axios = require('axios');
const { attachGuard } = require('./outbound');
const https = require('https');

const http = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ family: 4 }),
  headers: { 'User-Agent': 'TukukOS-Gallery-Client/1.0 (+https://tukuk.org)' },
});
// Dedupe + failure cooldown, declared 15 s kept as the deadline (src/outbound.js).
attachGuard(http, { name: 'seni' });

const API = 'https://collectionapi.metmuseum.org/public/collection';
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data, ttlMs) { cache.set(key, { data, expiresAt: Date.now() + ttlMs }); }
const TTL_SEARCH = 7 * 24 * 60 * 60 * 1000;  // search id lists barely change
const TTL_OBJECT = 30 * 24 * 60 * 60 * 1000; // museum metadata = stable
const TTL_DEPT = 30 * 24 * 60 * 60 * 1000;

// Curated collections — each one is a Met search verified to return
// hundreds of pictured works. `q` is wired to the slug.
const COLLECTIONS = [
  { slug: 'post-impressionism', q: 'van gogh seurat gauguin', name: 'Post-Impressionism', icon: '🌻',
    blurb: 'The years after Impressionism when painters kept its light but added structure, symbol and raw emotion — Van Gogh, Gauguin, Seurat and Cézanne.' },
  { slug: 'japanese-prints', q: 'ukiyo-e hokusai hiroshige', name: 'Japanese Woodblock Prints', icon: '🌊',
    blurb: 'Ukiyo-e — floating-world prints of the Edo period: landscapes, actors and tales cut in cherry wood and pulled by hand, one colour block at a time.' },
  { slug: 'egypt', q: 'egyptian', name: 'Ancient Egypt', icon: '🪦',
    blurb: 'Five thousand years along the Nile — painted reliefs, jewellery, sculpture and daily objects from tombs and temples.' },
  { slug: 'greco-roman', q: 'greek roman', name: 'Greek & Roman Antiquities', icon: '🏛️',
    blurb: 'Marble and terracotta from the classical world: vases with black-figure painting, portrait busts, bronzes and grave markers.' },
  { slug: 'impressionism', q: 'monet degas renoir', name: 'Impressionism', icon: '🎨',
    blurb: 'Plein-air light and broken brushwork — the 1860s–1880s revolution that taught the eye to paint rather than the memory.' },
  { slug: 'dutch-masters', q: 'rembrandt vermeer', name: 'Dutch Masters', icon: '🌙',
    blurb: 'The 17th-century Golden Age: Rembrandt’s chiaroscuro, Vermeer’s quiet interiors, portraits and still lives of a new merchant republic.' },
  { slug: 'islamic-art', q: 'persian ottoman arabesque', name: 'Art of the Islamic World', icon: '🕌',
    blurb: 'Calligraphy, metalwork, ceramics and carpet design from Spain to India — geometry and writing as the highest decorative arts.' },
  { slug: 'photos', q: 'photograph', name: 'Photographs', icon: '📷',
    blurb: 'The Met’s photography department from the 1840s to today — pictorialism, street, documentary and concept.' },
  { slug: 'arms-armor', q: 'armor sword', name: 'Knights: Arms & Armor', icon: '⚔️',
    blurb: 'Field armour, tournament gear and blades — engineering you can wear, decorated like jewellery.' },
  { slug: 'modern-art', q: 'pablo picasso matisse', name: 'Modern Art', icon: '🟥',
    blurb: 'Cubism, Fauvism and abstraction — the early-1900s break from resemblance that split art history open.' },
];
function findCollection(slug) {
  return COLLECTIONS.find((c) => c.slug === String(slug || '')) || null;
}

// v1.1 search → { total, ids } (ids are paginated; max page size 64? — we rely on
// the 40 entries returned per page; the API sends every matching id on
// that page).
async function searchIds(opts) {
  const params = { pagesize: 40 };
  if (opts.q) params.q = opts.q;
  if (opts.departmentId) params.departmentId = opts.departmentId;
  if (opts.title) params.title = true;
  if (opts.page) params.page = opts.page;
  if (opts.isPublicDomain) params.isPublicDomain = true;
  params.hasImages = true;
  const key = `s:${JSON.stringify(params)}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const res = await http.get(`${API}/v1.1/search`, { params });
  const body = res.data || {};
  if (!Array.isArray(body.objectIDs)) throw new Error('no objectIDs');
  const out = { total: Number(body.total) || body.objectIDs.length, ids: body.objectIDs };
  cacheSet(key, out, TTL_SEARCH);
  return out;
}

// One full object (image + metadata). null if missing / it fails.
async function getObject(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n < 1) return null;
  const key = `o:${n}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const res = await http.get(`${API}/v1/objects/${n}`);
    const o = res.data && res.data.objectID ? res.data : null;
    if (o) cacheSet(key, o, TTL_OBJECT);
    return o;
  } catch {
    return hit ? hit.data : null;
  }
}

// Serve the first N ids as objects carrying an image (one failure → skipped, not a
// broken page). Concurrency capped at 6 so Met doesn't see a request burst.
async function hydrate(ids, want) {
  const list = (ids || []).slice(0, want * 3); // loose: some have no image
  const out = [];
  for (let i = 0; i < list.length && out.length < want; i += 6) {
    const slice = list.slice(i, i + 6);
    const got = await Promise.all(slice.map((id) => getObject(id).catch(() => null)));
    for (const o of got) {
      if (o && o.primaryImageSmall && out.length < want) out.push(o);
    }
  }
  return out;
}

async function getDepartments() {
  const key = 'dept';
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const res = await http.get(`${API}/v1/departments`);
  const list = (res.data && res.data.departments) || [];
  cacheSet(key, list, TTL_DEPT);
  return list;
}

// Enumerate candidate objectIDs for one collection across several search pages
// (hasImages=true). No public-domain filter is usable: v1.1 search IGNORES
// `isPublicDomain` (verified — the total never changes). The real filtering happens
// later in keepRenderable(). Non-fatal: one search page failing →
// stop and keep what we have; don't break the whole sitemap.
async function collectionImageIds(c, pages) {
  const seen = new Set();
  const max = Number(pages) || 5;
  for (let p = 1; p <= max; p++) {
    let r;
    try { r = await searchIds({ q: c.q, page: p }); }
    catch { break; }
    if (!r || !Array.isArray(r.ids) || !r.ids.length) break;
    for (const id of r.ids) seen.add(id);
    if (r.total && seen.size >= r.total) break;
  }
  return [...seen];
}

// Filter candidates → only ids that REALLY render an object page. The
// /seni/objek/:id route requires `getObject(id)` to return an object with `primaryImage`
// (otherwise → 302 /seni). We verify it up front so the sitemap isn't stuffed with URLs
// that bounce to the hub. Concurrency is capped at 6 so Met isn't flooded; getObject
// itself is cached 30 days, so rebuilding afterwards is cheap.
async function keepRenderable(ids, cap) {
  const list = [...new Set(ids || [])].slice(0, Number(cap) || 360);
  const valid = [];
  for (let i = 0; i < list.length && valid.length < 220; i += 4) {
    const slice = list.slice(i, i + 4);
    const got = await Promise.all(slice.map((id) => getObject(id).catch(() => null)));
    slice.forEach((id, j) => { const o = got[j]; if (o && o.primaryImage) valid.push(id); });
  }
  return valid;
}

// The /seni/objek/<id> URL list for the sitemap — built IN THE BACKGROUND (SWR 6 hours)
// so the sitemap GET is always instant and NEVER 503s even when Met is slow/
// down (the slow-feed-page pitfall): the caller serves the existing cache (or []
// when cold → the static hub+collection sitemap) while a fresh build runs in the background.
let objectUrlCache = null; // { urls: string[], expiresAt: number }
let buildInflight = null;
const TTL_GOOD = 24 * 60 * 60 * 1000;  // museum metadata is static → refreshing 1x/day is enough
const TTL_EMPTY = 6 * 60 * 60 * 1000;   // empty build / blocked → long backoff, don't hammer Met
function buildObjectUrls(pagesPerCollection) {
  if (buildInflight) return buildInflight;
  const pages = Number(pagesPerCollection) || 1;
  buildInflight = (async () => {
    const cols = await Promise.all(COLLECTIONS.map((c) => collectionImageIds(c, pages).catch(() => [])));
    const renderable = await keepRenderable(cols.flat(), 360);
    const urls = [];
    for (const id of renderable) urls.push(`/seni/objek/${id}`);
    // Only hold the 6h key when there is content. An empty build (Met transient/failing) → keep
    // the old URLs if any, and schedule a retry right away (5 min) — not 6h.
    const now = Date.now();
    if (urls.length) {
      objectUrlCache = { urls, expiresAt: now + TTL_GOOD };
    } else {
      objectUrlCache = { urls: objectUrlCache ? objectUrlCache.urls : [], expiresAt: now + TTL_EMPTY };
    }
    return objectUrlCache.urls;
  })().catch(() => (objectUrlCache ? objectUrlCache.urls : []))
    .finally(() => { buildInflight = null; });
  return buildInflight;
}

// Non-blocking: return at once (a full cache / the old URLs during a build / [] when
// completely cold), kick a build when there is no full cache or it has expired.
function sitemapObjectUrls(pagesPerCollection) {
  const has = objectUrlCache && objectUrlCache.urls.length > 0;
  const fresh = has && Date.now() < objectUrlCache.expiresAt;
  if (!fresh) buildObjectUrls(pagesPerCollection);
  return objectUrlCache ? objectUrlCache.urls : [];
}

module.exports = { COLLECTIONS, findCollection, searchIds, getObject, hydrate, getDepartments, collectionImageIds, keepRenderable, buildObjectUrls, sitemapObjectUrls };
