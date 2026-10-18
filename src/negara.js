'use strict';
// ── TUKUK-OS NEGARA COMPLEX — profil 250 negara (PERCUMA, tanpa kunci API) ──
// Sumber 1: pakej npm "world-countries" melalui CDN jsDelivr — salinan penuh
// dataset old restcountries v3.1 (ibu negara, benua, bahasa, mata wang, sempadan,
// keluasan, terjemahan). Tiada pendaftaran; jsDelivr CDN stabil & laju.
// Sumber 2: World Bank Open Data API — populasi, KDNK, urbanisasi, jangka hayat
// (indikator 2023, format JSON, tanpa kunci). flagcdn.com untuk gambar bendera.
// Nota: restcountries.com asal kini v5 + API key — sengaja DILAPAS kerana dasar
// "hanya yang percuma tanpa daftar".
const https = require('https');

const WC_URL = 'https://cdn.jsdelivr.net/npm/world-countries@5.1.0/countries.json';
const WB_IND = 'https://api.worldbank.org/v2/country/all/indicator/INDICATOR?format=json&per_page=400&date=2023';
const IND = { pop: 'SP.POP.TOTL', gdp: 'NY.GDP.MKTP.CD', urban: 'SP.URB.TOTL.IN.ZS', life: 'SP.DYN.LE00.IN' };

const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // data negara jarang berubah

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}

function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + TTL });
  if (cache.size > 20) {
    let oldestKey = null; let oldest = Infinity;
    for (const [k, v] of cache) if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// jsDelivr + api.worldbank.org lulus fetch biasa; agent IPv6 didahulukan
// kerana server.js menetapkan dns order 'ipv4first' global (pitfall cuti).
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const v4Agent = new https.Agent({ family: 4, keepAlive: true });

function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': 'TukukOS-Negara-Client/1.0 (+https://tukuk.org)' } }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        httpsGet(next, agent).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) { req.destroy(new Error('too big')); } chunks.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchJson(url) {
  try { return await httpsGet(url, v6Agent); }
  catch { return await httpsGet(url, v4Agent); } // hos tiada IPv6 → fallback
}

// ——— slug & nama BM ———
function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Nama common Bahasa Melayu untuk negara yang kerap dicari pembaca MY.
const BM_NAMES = {
  japan: 'Jepun', germany: 'Jerman', 'south korea': 'Korea Selatan', china: 'Cina',
  india: 'India', indonesia: 'Indonesia', thailand: 'Thailand', turkey: 'Turki',
  egypt: 'Mesir', 'united states': 'Amerika Syarikat', netherlands: 'Belanda',
  france: 'Perancis', spain: 'Sepanyol', italy: 'Itali', russia: 'Rusia',
  brazil: 'Brazil', argentina: 'Argentina', australia: 'Australia',
  singapore: 'Singapura', brunei: 'Brunei', mexico: 'Mexico', canada: 'Kanada',
  'united arab emirates': 'Emirab Arab Bersatu', 'saudi arabia': 'Arab Saudi',
  philippines: 'Filipina', cambodia: 'Kemboja', vietnam: 'Vietnam',
  pakistan: 'Pakistan', bangladesh: 'Bangladesh', nepal: 'Nepal',
  'south africa': 'Afrika Selatan', nigeria: 'Nigeria', palestine: 'Palestin',
};

const REGIONS = [
  { slug: 'asia', bm: 'Asia' },
  { slug: 'africa', bm: 'Afrika' },
  { slug: 'europe', bm: 'Eropah' },
  { slug: 'americas', bm: 'Amerika' },
  { slug: 'oceania', bm: 'Oseania' },
  { slug: 'antarctic', bm: 'Antartika' },
];
const REGION_BM = { Asia: 'Asia', Africa: 'Afrika', Europe: 'Eropah', Americas: 'Amerika', Oceania: 'Oseania', Antarctic: 'Antartika' };

function findRegion(slug) {
  return REGIONS.find((r) => r.slug === String(slug || '')) || null;
}

function flagUrl(cca2) {
  return `https://flagcdn.com/w640/${String(cca2 || '').toLowerCase()}.png`;
}

async function loadIndicator(key) {
  const cacheKey = `wb:${key}`;
  const hit = cacheGet(cacheKey);
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(WB_IND.replace('INDICATOR', IND[key]));
    const rows = {};
    for (const r of (Array.isArray(body) && body[1]) ? body[1] : []) {
      if (r && r.countryiso3code && r.value != null) rows[r.countryiso3code] = r.value;
    }
    if (Object.keys(rows).length) cacheSet(cacheKey, rows);
    return Object.keys(rows).length ? rows : (hit ? hit.data : rows);
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

async function loadBase() {
  const hit = cacheGet('wc');
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(WC_URL);
    if (!Array.isArray(body) || body.length < 200) throw new Error('dataset janggal');
    cacheSet('wc', body);
    return body;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Gabungkan kedua-dua sumber jadi senarai siap-render + ranking populasi.
async function loadCountries() {
  const hit = cacheGet('merged');
  if (hit && !hit.stale) return hit.data;
  const [base, pop, gdp, urban, life] = await Promise.all([
    loadBase(), loadIndicator('pop'), loadIndicator('gdp'), loadIndicator('urban'), loadIndicator('life'),
  ]);
  const out = base.map((c) => {
    const name = c.name && c.name.common ? c.name.common : c.cca2;
    const p = pop[c.cca3] || null;
    return {
      cca2: c.cca2, cca3: c.cca3,
      name,
      bm: BM_NAMES[slugify(name)] || name,
      official: c.name ? c.name.official : name,
      capital: Array.isArray(c.capital) && c.capital.length ? c.capital[0] : null,
      region: c.region || '', subregion: c.subregion || '',
      population: p, gdp: gdp[c.cca3] || null, urban: urban[c.cca3] || null, life: life[c.cca3] || null,
      area: c.area || null,
      languages: c.languages ? Object.values(c.languages) : [],
      currencies: c.currencies ? Object.entries(c.currencies).map(([code, v]) => ({ code, name: v.name, symbol: v.symbol })) : [],
      borders: Array.isArray(c.borders) ? c.borders : [],
      tld: Array.isArray(c.tld) && c.tld.length ? c.tld[0] : null,
      calling: c.idd && c.idd.root ? c.idd.root + (c.idd.suffixes || []).join('/') : null,
      latlng: Array.isArray(c.latlng) ? c.latlng : [0, 0],
      independent: c.independent !== false,
      landlocked: !!c.landlocked,
      slug: slugify(name),
      flag: flagUrl(c.cca2),
    };
  }).filter((c) => c.slug);
  // Ranking populasi + peta sempadan cca3→slug untuk pautan jiran.
  const byPop = [...out].filter((c) => c.population).sort((a, b) => b.population - a.population);
  const rank = {}; byPop.forEach((c, i) => { rank[c.cca3] = i + 1; });
  const slugByCca3 = {}; out.forEach((c) => { slugByCca3[c.cca3] = c.slug; });
  for (const c of out) {
    c.popRank = rank[c.cca3] || null;
    c.borderSlugs = c.borders.map((b) => slugByCca3[b]).filter(Boolean);
    c.worldPop = byPop.length ? byPop.reduce((s, x) => s + x.population, 0) : 0;
  }
  if (out.length >= 200) cacheSet('merged', out);
  return out.length >= 200 ? out : (hit ? hit.data : out);
}

function findCountry(rows, slug) {
  const s = String(slug || '');
  return rows.find((c) => c.slug === s) || null;
}

function inRegion(rows, slug) {
  const en = Object.keys(REGION_BM).find((k) => REGION_BM[k] && slugify(REGION_BM[k]) === slug) ||
    Object.keys(REGION_BM).find((k) => slugify(k) === slug);
  return rows.filter((c) => c.region === en).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { loadCountries, findCountry, inRegion, findRegion, REGIONS, REGION_BM, flagUrl, slugify };
