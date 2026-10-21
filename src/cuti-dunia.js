'use strict';
// ── TUKUK-OS CUTI DUNIA — public-holiday calendars for the whole planet (FREE, no key) ──
// Source: Nager.Date v3 (date.nager.at) — an open-source project, no registration.
// It covers ~180 countries; we picked the larger ones for the hub + country pages.
// Countries with no data (HTTP 204) are handled gracefully — dropped from the counts.
// This country list was verified against Nager.Date's /AvailableCountries: Israel,
// India, Thailand, Taiwan, UAE, Saudi Arabia, Pakistan, Sri Lanka, Nepal and Malaysia
// are NOT supported by that source, so they are replaced by neighbours that do have
// data. Malaysia is still served by the Cuti Complex's own feed (/cuti/2026) built
// from the API + the official gazette, and the hub links to it explicitly.
const https = require('https');

const NAGER = 'https://date.nager.at/api/v3';
const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // annual calendars rarely change

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + TTL });
}

// The IPv6 agent goes first (server.js sets the global dns order to ipv4first).
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const v4Agent = new https.Agent({ family: 4, keepAlive: true });

function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': 'TukukOS-CutiDunia-Client/1.0 (+https://tukuk.org)' } }, (res) => {
      if (res.statusCode === 204) { res.resume(); resolve(null); return; } // no data is fine, not an error
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        httpsGet(next, agent).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(c); });
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

// ——— The hub's chosen countries: [cca2, English name, region] ———
// Flags and the page URLs come from this table. The holiday URLs use our own ASCII
// slug so the source spelling (Türkiye → 't-rkiye') never leaks into a web address.
const COUNTRIES = [
  ['JP', 'Japan', 'Asia'], ['CN', 'China', 'Asia'], ['KR', 'South Korea', 'Asia'], ['KH', 'Cambodia', 'Asia'],
  ['VN', 'Vietnam', 'Asia'], ['ID', 'Indonesia', 'Asia'], ['PH', 'Philippines', 'Asia'], ['SG', 'Singapore', 'Asia'],
  ['HK', 'Hong Kong', 'Asia'], ['KZ', 'Kazakhstan', 'Asia'], ['MN', 'Mongolia', 'Asia'], ['TR', 'Turkey', 'Asia'],
  ['IQ', 'Iraq', 'Asia'], ['BH', 'Bahrain', 'Asia'], ['BD', 'Bangladesh', 'Asia'],
  ['US', 'United States', 'Americas'], ['CA', 'Canada', 'Americas'], ['MX', 'Mexico', 'Americas'], ['BR', 'Brazil', 'Americas'],
  ['AR', 'Argentina', 'Americas'], ['CL', 'Chile', 'Americas'], ['CO', 'Colombia', 'Americas'], ['PE', 'Peru', 'Americas'],
  ['GB', 'United Kingdom', 'Europe'], ['IE', 'Ireland', 'Europe'], ['FR', 'France', 'Europe'], ['DE', 'Germany', 'Europe'],
  ['IT', 'Italy', 'Europe'], ['ES', 'Spain', 'Europe'], ['PT', 'Portugal', 'Europe'], ['NL', 'Netherlands', 'Europe'],
  ['BE', 'Belgium', 'Europe'], ['CH', 'Switzerland', 'Europe'], ['AT', 'Austria', 'Europe'], ['SE', 'Sweden', 'Europe'],
  ['NO', 'Norway', 'Europe'], ['DK', 'Denmark', 'Europe'], ['FI', 'Finland', 'Europe'], ['PL', 'Poland', 'Europe'],
  ['CZ', 'Czechia', 'Europe'], ['GR', 'Greece', 'Europe'], ['RO', 'Romania', 'Europe'], ['HU', 'Hungary', 'Europe'],
  ['UA', 'Ukraine', 'Europe'], ['RU', 'Russia', 'Europe'], ['AU', 'Australia', 'Oceania'], ['NZ', 'New Zealand', 'Oceania'],
  ['ZA', 'South Africa', 'Africa'], ['EG', 'Egypt', 'Africa'], ['NG', 'Nigeria', 'Africa'], ['KE', 'Kenya', 'Africa'],
  ['MA', 'Morocco', 'Africa'], ['DZ', 'Algeria', 'Africa'], ['TN', 'Tunisia', 'Africa'], ['ET', 'Ethiopia', 'Africa'],
  ['GH', 'Ghana', 'Africa'], ['UG', 'Uganda', 'Africa'],
];

function slugOf(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const COUNROWS = {};
const SLUGROWS = {};
for (const [cca2, en, region] of COUNTRIES) {
  const rec = { cca2, en, region, slug: slugOf(en) };
  COUNROWS[cca2] = rec;
  SLUGROWS[rec.slug] = rec;
}

function findCountry(cca2) {
  return COUNROWS[String(cca2 || '').toUpperCase()] || null;
}
function findCountryBySlug(slug) {
  return SLUGROWS[String(slug || '').toLowerCase()] || null;
}

// Hub regions — the slugs mirror the Country Complex so the cross links read well.
const REGIONS = [
  { slug: 'asia', en: 'Asia' },
  { slug: 'americas', en: 'Americas' },
  { slug: 'europe', en: 'Europe' },
  { slug: 'africa', en: 'Africa' },
  { slug: 'oceania', en: 'Oceania' },
];
function findRegion(slug) {
  const s = String(slug || '').toLowerCase();
  return REGIONS.find((r) => r.slug === s) || null;
}
function inRegion(world, slug) {
  const r = findRegion(slug);
  if (!r) return [];
  return world.filter((x) => x.region === r.en);
}

// Simple totals for the hub statistic cards.
function worldTotals(world) {
  const withData = (world || []).filter((r) => Array.isArray(r.holidays) && r.holidays.length);
  const total = withData.reduce((s, r) => s + r.holidays.length, 0);
  return { countries: withData.length, total, avg: withData.length ? total / withData.length : 0 };
}

// Public holidays of one country in one year; a 204/null becomes [] (no data, not an error).
async function loadHolidays(year, cca2) {
  const key = `ph:${year}:${cca2}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(`${NAGER}/PublicHolidays/${year}/${cca2}`);
    const rows = Array.isArray(body) ? body : [];
    if (rows.length) cacheSet(key, rows);
    return rows.length ? rows : (hit ? hit.data : rows);
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Nager's own long-weekend combinations (they include the bridge-day logic).
async function loadLongWeekends(year, cca2) {
  const key = `lw:${year}:${cca2}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const body = await fetchJson(`${NAGER}/LongWeekend/${year}/${cca2}`);
    const rows = Array.isArray(body) ? body : [];
    if (rows.length) cacheSet(key, rows);
    return rows.length ? rows : (hit ? hit.data : rows);
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

// Load every country through a small pool (6 at a time) so Nager is never flooded.
// One country failing does not break the world — that country simply gets rows = null.
async function mapPool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(size, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch { out[k] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

async function loadWorld(year) {
  const results = await mapPool(COUNTRIES, 6, async ([cca2, en, region]) => {
    const holidays = await loadHolidays(year, cca2);
    return { cca2, en, region, slug: slugOf(en), holidays };
  });
  const withData = results.filter((r) => Array.isArray(r.holidays) && r.holidays.length);
  if (!withData.length) throw new Error('no world data');
  return results;
}

// Public holidays worldwide in the next N days (ISO date order → list).
function worldUpcoming(world, days, todayStr) {
  const end = new Date(Date.parse(`${todayStr}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const list = [];
  for (const r of world) {
    if (!Array.isArray(r.holidays)) continue;
    for (const h of r.holidays) {
      if (String(h.date) > todayStr && String(h.date) <= end && h.global) list.push({ date: h.date, cca2: r.cca2, en: r.en, slug: r.slug || slugOf(r.en), name: h.localName || h.name, nameEn: h.name });
    }
  }
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.en).localeCompare(String(b.en)));
  return list;
}

// The countries with the most holidays — ranked by count.
function worldRanking(world) {
  return world
    .filter((r) => Array.isArray(r.holidays) && r.holidays.length)
    .map((r) => ({ cca2: r.cca2, en: r.en, region: r.region, slug: r.slug || slugOf(r.en), count: r.holidays.length, globals: r.holidays.filter((h) => h.global).length }))
    .sort((a, b) => b.count - a.count || String(a.en).localeCompare(String(b.en)));
}

// Every long-weekend combination in the world, longest first.
async function loadWorldLongWeekends(year) {
  const results = await mapPool(COUNTRIES, 6, async ([cca2, en, region]) => {
    const lws = await loadLongWeekends(year, cca2);
    return { cca2, en, region, lws };
  });
  const flat = [];
  for (const r of results) {
    if (!Array.isArray(r.lws)) continue;
    for (const w of r.lws) flat.push({ cca2: r.cca2, en: r.en, region: r.region, slug: slugOf(r.en), start: w.startDate, end: w.endDate, dayCount: w.dayCount, needBridge: !!w.needBridgeDay, bridgeDays: w.bridgeDays || [] });
  }
  if (!flat.length) throw new Error('no long-weekend data');
  flat.sort((a, b) => b.dayCount - a.dayCount || String(a.start).localeCompare(String(b.start)));
  return flat;
}

module.exports = { COUNTRIES, REGIONS, findCountry, findCountryBySlug, findRegion, inRegion, worldTotals, loadHolidays, loadLongWeekends, loadWorld, loadWorldLongWeekends, worldUpcoming, worldRanking, mapPool };
