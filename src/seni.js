'use strict';
// ── TUKUK-OS ART GALLERY (/seni) — The Metropolitan Museum of Collection API ─
// Sumber: collectionapi.metmuseum.org — PERCUMA tanpa kunci. 490k+ karya;
// yang berlabel isPublicDomain boleh dimuat turun & dilihat bebas. Cari
// menggunakan v1.1 (Elastic, berpaginasi — v1 search bersara Okt 2026);
// butiran satu objek melalui v1/objects/{id} (hujung ini masih disokong).
// Tiada senarai pukal /objects?ids= — ia kini mengembalikan SEMUA id, jadi
// halaman grid memuat N objek secara serentak dengan had kecil + cache panjang.
const axios = require('axios');
const https = require('https');

const http = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ family: 4 }),
  headers: { 'User-Agent': 'TukukOS-Gallery-Client/1.0 (+https://tukuk.org)' },
});

const API = 'https://collectionapi.metmuseum.org/public/collection';
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data, ttlMs) { cache.set(key, { data, expiresAt: Date.now() + ttlMs }); }
const TTL_SEARCH = 7 * 24 * 60 * 60 * 1000;  // id carian hampir tak berubah
const TTL_OBJECT = 30 * 24 * 60 * 60 * 1000; // metadata museum = stabil
const TTL_DEPT = 30 * 24 * 60 * 60 * 1000;

// Koleksi kurasi — setiap satu ialah carian Met yang telah disahkan mengembalikan
// beratus karya bergambar. `q` dipautkan pada slug.
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

// Carian v1.1 → { total, ids } (ids berpaginasi, pagesize maksimum 64? — kami
// guna 40 sehelai yang dikembalikan; API menghantar semua id sepadan dalam
// halaman tersebut).
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

// Satu objek penuh (img + metadata). null jika tiada / gagal.
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

// Hidang N id pertama sebagai objek berimg (kegagalan satu → dilangkau, bukan
// halaman rosak). Serentak had 6 supaya Met tidak melihat letupan permintaan.
async function hydrate(ids, want) {
  const list = (ids || []).slice(0, want * 3); // longgar: sesetengah tiada img
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

// Enumerasi calon objectID untuk satu koleksi merentas beberapa halaman carian
// (hasImages=true). Tiada penapis domain-awam boleh guna: carian v1.1 MENGABAIKAN
// `isPublicDomain` (disahkan — total tak berubah). Penapisan sebenar dibuat
// kemudiannya melalui keepRenderable(). Non-fatal: satu halaman carian gagal →
// berhenti & kumpul yang ada, jangan rosak seluruh sitemap.
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

// Saring calon → hanya id yang BETUL-BETUL render halaman objek. Syarat route
// /seni/objek/:id ialah `getObject(id)` mengembalikan objek dengan `primaryImage`
// (jika tidak → 302 /seni). Kami sahkan langsung supaya sitemap tidak sarat URL
// yang melompat ke hab. Dideria had 6 supaya Met tidak dibanjiri; getObject
// sendiri di-cache 30 hari jadi bina semula selepas itu murah.
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

// Senarai lalanan /seni/objek/<id> untuk sitemap — dijana DALAM LATAR (SWR 6 jam)
// supaya GET sitemap sentiasa serta-merta & TIDAK PERNAH 503 walaupun Met lambat/
// mati (pitfall halaman suapan lambat): pemanggil hidang cache sedia-ada (atau []
// bila sejuk → sitemap statik hub+koleksi) sambil build segar di belakang.
let objectUrlCache = null; // { urls: string[], expiresAt: number }
let buildInflight = null;
const TTL_GOOD = 24 * 60 * 60 * 1000;  // metadata museum statik → cukup segar semula 1x/hari
const TTL_EMPTY = 6 * 60 * 60 * 1000;   // build kosong/kena blok → backoff panjang, jangan hempuk Met
function buildObjectUrls(pagesPerCollection) {
  if (buildInflight) return buildInflight;
  const pages = Number(pagesPerCollection) || 1;
  buildInflight = (async () => {
    const cols = await Promise.all(COLLECTIONS.map((c) => collectionImageIds(c, pages).catch(() => [])));
    const renderable = await keepRenderable(cols.flat(), 360);
    const urls = [];
    for (const id of renderable) urls.push(`/seni/objek/${id}`);
    // Hanya kunci 6j bila ada konten. Build kosong (Met transient/gagal) → kekalkan
    // URL lama jika ada, dan jadualkan percubaan semula segera (5 min) — bukan 6j.
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

// Non-blocking: hidang segera (cache berisi / URL lama semasa build / [] bila sejuk
// sepenuhnya), kick build bila tiada cache berisi atau telah tamat tempoh.
function sitemapObjectUrls(pagesPerCollection) {
  const has = objectUrlCache && objectUrlCache.urls.length > 0;
  const fresh = has && Date.now() < objectUrlCache.expiresAt;
  if (!fresh) buildObjectUrls(pagesPerCollection);
  return objectUrlCache ? objectUrlCache.urls : [];
}

module.exports = { COLLECTIONS, findCollection, searchIds, getObject, hydrate, getDepartments, collectionImageIds, keepRenderable, buildObjectUrls, sitemapObjectUrls };
