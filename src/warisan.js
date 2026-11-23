'use strict';
// ── TUKUK-OS WARISAN (/warisan) — UNESCO World Heritage sites ────────────────
// A STATIC list of iconic World Heritage sites (stable facts only: country,
// continent, type, approximate coordinates) + the Wikipedia summary fetched LIVE
// and cached. Safety principle (the Met incident + /kota lesson): the page core
// always renders from fixed data → it MUST NEVER 503. The Wikipedia summary is
// a NICE-TO-HAVE (fail-open): failure → the page is still valid. Text &
// scope are English (international). Years/details are NOT hand-written —
// dropped from the data so nothing gets invented (data honesty); only the name, country,
// continent, type & approximate coordinates that are confidently stable.
const https = require('https');
const wikibank = require('./wikibank');
const DATA = require('./warisan-data.json');

const UA = 'TukukOS-Warisan/1.0 (+https://tukuk.org)';
const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // Wikipedia summaries change slowly

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const REGION_ORDER = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];
const TYPE_ORDER = ['Cultural', 'Natural', 'Mixed'];

const SITES = DATA.map((s) => ({ ...s, slug: slugify(s.name), countrySlug: slugify(s.country) }));
const S_BY_SLUG = new Map(SITES.map((s) => [s.slug, s]));

// Region (continent) as its own hub page — count the sites in each.
function countInRegion(r) { let n = 0; for (const s of SITES) if (s.region === r) n++; return n; }
const REGIONS = REGION_ORDER.map((r) => ({ name: r, slug: slugify(r), count: countInRegion(r) }));
const R_BY_SLUG = new Map(REGIONS.map((r) => [r.slug, r]));

function findSite(slug) { return S_BY_SLUG.get(String(slug || '').toLowerCase()) || null; }
function findRegion(slug) { return R_BY_SLUG.get(String(slug || '').toLowerCase()) || null; }
function sitesInRegion(region) { return SITES.filter((s) => s.region === region); }
function sitesByCountry(countrySlug) { return SITES.filter((s) => s.countrySlug === countrySlug); }

// ——— HTTP IPv6→IPv4 + timeout (the bencana.js/sejarah.js/kota.js pattern) ———
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const v4Agent = new https.Agent({ family: 4, keepAlive: true });
function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume(); httpsGet(next, agent).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let size = 0; const chunks = [];
      res.on('data', (d) => { size += d.length; if (size > 4 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(d); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function fetchJson(url) {
  try { return await httpsGet(url, v6Agent); } catch { return await httpsGet(url, v4Agent); }
}

// Wikipedia summary for one title → {extract, description, thumb, thumbW, thumbH, url} or null.
// Fail-open: any error → null (the render call still serves the static page).
async function fetchSummary(wikiTitle) {
  const t = String(wikiTitle || '').trim();
  if (!t) return null;
  const key = `wsum:${t.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() <= hit.expiresAt) return hit.data;
  try {
    const s = (await wikibank.summary(t)) || await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`);
    if (!s || !s.extract) { const out = null; cache.set(key, { data: out, expiresAt: Date.now() + TTL }); return out; }
    const out = {
      extract: String(s.extract).trim(),
      description: s.description ? String(s.description).trim() : '',
      thumb: s.thumbnail && s.thumbnail.source ? s.thumbnail.source : null,
      thumbW: s.thumbnail && s.thumbnail.width ? s.thumbnail.width : null,
      thumbH: s.thumbnail && s.thumbnail.height ? s.thumbnail.height : null,
      url: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`,
    };
    cache.set(key, { data: out, expiresAt: Date.now() + TTL });
    return out;
  } catch {
    return hit ? hit.data : null; // SWR — stale beats nothing, but don't block
  }
}

module.exports = { SITES, REGIONS, REGION_ORDER, TYPE_ORDER, findSite, findRegion, sitesInRegion, sitesByCountry, fetchSummary, slugify };
