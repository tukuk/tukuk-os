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
  params.hasImages = true;
  const key = `s:${JSON.stringify(params)}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const res = await http.get(`${API}/v1.1/search`, { params });
  const body = res.data || {};
  if (!Array.isArray(body.objectIDs)) throw new Error('tiada objectIDs');
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

module.exports = { COLLECTIONS, findCollection, searchIds, getObject, hydrate, getDepartments };
