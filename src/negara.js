'use strict';
// ── TUKUK-OS COUNTRY COMPLEX — profiles for 250 countries (FREE, no API key) ──
// Source 1: the npm package "world-countries" over the jsDelivr CDN — a full copy of
// the old restcountries v3.1 dataset (capital, continent, languages, currencies,
// borders, area, translations). No registration; the jsDelivr CDN is stable and fast.
// Source 2: World Bank Open Data — population, GDP, urbanisation, life expectancy
// (2023 indicators, plain JSON, no key). flagcdn.com serves the flag images.
// Note: the original restcountries.com is now v5 behind an API key — deliberately
// DROPPED because of our "only free sources that need no signup" policy.
const https = require('https');

const WC_URL = 'https://cdn.jsdelivr.net/npm/world-countries@5.1.0/countries.json';
const WB_IND = 'https://api.worldbank.org/v2/country/all/indicator/INDICATOR?format=json&per_page=400&date=2023';
const IND = { pop: 'SP.POP.TOTL', gdp: 'NY.GDP.MKTP.CD', urban: 'SP.URB.TOTL.IN.ZS', life: 'SP.DYN.LE00.IN' };

const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // country data rarely changes

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

// jsDelivr and api.worldbank.org pass a plain fetch; the IPv6 agent goes first
// because server.js sets the global dns order to 'ipv4first' (the holiday-module pitfall).
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
  catch { return await httpsGet(url, v4Agent); } // host has no IPv6 → fall back
}

// ——— slug ———
function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Hub continents — the English label is the restcountries region value itself.
const REGIONS = [
  { slug: 'asia', en: 'Asia' },
  { slug: 'africa', en: 'Africa' },
  { slug: 'europe', en: 'Europe' },
  { slug: 'americas', en: 'Americas' },
  { slug: 'oceania', en: 'Oceania' },
  { slug: 'antarctic', en: 'Antarctic' },
];

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
    if (!Array.isArray(body) || body.length < 200) throw new Error('odd dataset');
    cacheSet('wc', body);
    return body;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Merge both sources into a render-ready list plus the population ranking.
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
  // Population ranking + a cca3→slug border map for the neighbour links.
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

// The continent index: our slug maps back onto the restcountries region value.
function inRegion(rows, slug) {
  const r = findRegion(slug);
  return rows.filter((c) => c.region === (r ? r.en : '')).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { loadCountries, findCountry, inRegion, findRegion, REGIONS, flagUrl, slugify };
