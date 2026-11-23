'use strict';
// ── TUKUK-OS STATISTICS COMPLEX — world rankings by indicator (FREE, no API key) ──
// Sources: World Bank Open Data (public JSON, no signup) plus the already-cached
// dataset in src/negara.js (the population / life-expectancy / urbanisation fields
// exist there). This module only loads the EXTRA indicators and builds the rankings.
const https = require('https');

const WB_IND_BASE = 'https://api.worldbank.org/v2/country/all/indicator';
const WB_YEAR_DEFAULT = 2023;
const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // the 2023 statistics are already final

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + TTL });
}

// The IPv6 agent goes first — server.js pins the global resolver to 'ipv4first' (the holiday pitfall).
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const v4Agent = new https.Agent({ family: 4, keepAlive: true });

function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': 'TukukOS-Statistik-Client/1.0 (+https://tukuk.org)' } }, (res) => {
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

// ——— Indicator catalogue (the Malay slugs are public URLs and must not change;
// `field` is borrowed from the rows src/negara.js exports) ———
// better: 'high' = higher is better; 'low' = lower is better; null = neutral.
const INDICATORS = [
  { slug: 'populasi', code: null, field: 'population', en: 'Population', unit: 'people', dec: 0, better: 'high',
    intro: 'How many people live in each country — the official World Bank estimate for 2023, rounded to a single person.' },
  { slug: 'kdnk-kapita', code: 'NY.GDP.PCAP.CD', field: null, en: 'GDP per Capita', unit: 'USD', dec: 0, better: 'high',
    intro: 'Gross domestic product divided by the population, in nominal US dollars — a rough measure of individual economic strength.' },
  { slug: 'jangka-hayat', code: null, field: 'life', en: 'Life Expectancy at Birth', unit: 'years', dec: 1, better: 'high',
    intro: 'How long a baby born today is expected to live, given the health system currently in place.' },
  { slug: 'internet', code: 'IT.NET.USER.ZS', field: null, en: 'Internet Users', unit: '%', dec: 1, better: 'high',
    intro: 'The share of people who used the internet at least once in the past three months — the pulse of the digital economy.' },
  { slug: 'urbanisasi', code: null, field: 'urban', en: 'Urban Population', unit: '%', dec: 1, better: null,
    intro: 'The share of people living in urban areas, measured by the definition each country itself uses — a mirror of economic transformation.' },
  { slug: 'kesuburan', code: 'SP.DYN.TFRT.IN', field: null, en: 'Fertility Rate', unit: 'children per woman', dec: 1, better: null,
    intro: 'The average number of children a woman would have in her lifetime. Below 2.1 the population of a country starts to shrink.' },
  { slug: 'literasi', code: 'SE.ADT.LITR.ZS', field: null, en: 'Adult Literacy Rate', unit: '%', dec: 1, better: 'high',
    intro: 'The share of people aged 15 and above who can read and write a short, simple statement with understanding.' },
  { slug: 'pengangguran', code: 'SL.UEM.TOTL.ZS', field: null, en: 'Unemployment Rate', unit: '%', dec: 1, better: 'low',
    intro: 'The share of the labour force that is actively looking for work but has not found it yet.' },
  { slug: 'inflasi', code: 'FP.CPI.TOTL.ZG', field: null, en: 'Consumer Price Inflation', unit: '%', dec: 1, better: 'low',
    intro: 'The annual change in the consumer price index — the rate that reaches into every household purse each month.' },
  { slug: 'tenaga-boleh-diperbaharui', code: 'EG.FEC.RNEW.ZS', field: null, yr: 2021, en: 'Renewable Energy', unit: '%', dec: 1, better: 'high',
    intro: 'The renewable share (hydro, solar, wind, bioenergy) of total final energy use. The World Bank has only reported 2021 for this indicator, so that year is used ahead of the others.' },
  { slug: 'pelepasan-co2', code: 'EN.GHG.CO2.PC.CE.AR5', field: null, en: 'CO₂ Emissions per Capita', unit: 'tonnes CO₂', dec: 1, better: 'low',
    intro: 'Tonnes of carbon dioxide released per person per year, excluding land use — the per-person carbon footprint of a country.' },
  { slug: 'liputan-hutan', code: 'AG.LND.FRST.ZS', field: null, en: 'Forest Cover', unit: '%', dec: 1, better: 'high',
    intro: 'The share of a country\'s land covered by natural forest and growth — the lungs of the planet.' },
  { slug: 'kematian-bayi', code: 'SP.DYN.IMRT.IN', field: null, en: 'Infant Mortality', unit: 'per 1,000 births', dec: 1, better: 'low',
    intro: 'How many babies die before reaching their first birthday, for every 1,000 live births.' },
  { slug: 'pertumbuhan-penduduk', code: 'SP.POP.GROW', field: null, en: 'Population Growth', unit: '%', dec: 1, better: null,
    intro: 'The yearly change in total population — positive means the country is growing, negative means its people are thinning out.' },
  { slug: 'kematian-kanak', code: 'SH.DYN.MORT', field: null, en: 'Child Mortality', unit: 'per 1,000 births', dec: 1, better: 'low',
    intro: 'Children who die before the age of five, for every 1,000 live births — the single strongest signal of how well a health system works.' },
];

function findIndicator(slug) {
  return INDICATORS.find((i) => i.slug === String(slug || '')) || null;
}

// iso3 → value map for the newer World Bank indicators; 30-day cache plus stale-serve.
async function loadWbMap(code, yr) {
  const year = yr || WB_YEAR_DEFAULT;
  const key = `wb:${code}:${year}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(`${WB_IND_BASE}/${code}?format=json&per_page=400&date=${year}`);
    const rows = {};
    for (const r of (Array.isArray(body) && body[1]) ? body[1] : []) {
      if (r && r.countryiso3code && r.value != null) rows[r.countryiso3code] = r.value;
    }
    if (Object.keys(rows).length) cacheSet(key, rows);
    return Object.keys(rows).length ? rows : (hit ? hit.data : rows);
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Merge with the negara.js rows (English name + slug + flag come free from that cache).
async function loadRanking(ind, countries) {
  let values = null;
  if (ind.field) {
    values = {};
    for (const c of countries) if (c[ind.field] != null) values[c.cca3] = c[ind.field];
  } else {
    values = await loadWbMap(ind.code, ind.yr);
  }
  const list = [];
  for (const c of countries) {
    const v = values[c.cca3];
    if (v != null && Number.isFinite(v)) list.push({ cca3: c.cca3, name: c.name, slug: c.slug, flag: c.flag, cca2: c.cca2, value: v });
  }
  list.sort((a, b) => b.value - a.value);
  list.forEach((x, i) => { x.rank = i + 1; });
  const nums = list.map((x) => x.value).sort((a, b) => a - b);
  const sum = nums.reduce((s, x) => s + x, 0);
  const stats = {
    n: list.length,
    min: nums[0] ?? null,
    max: nums[nums.length - 1] ?? null,
    avg: nums.length ? sum / nums.length : null,
    median: nums.length ? (nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2) : null,
  };
  return { ind, list, stats };
}

module.exports = { INDICATORS, findIndicator, loadRanking, loadWbMap };
