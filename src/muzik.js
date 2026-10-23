'use strict';
// ── TUKUK-OS /muzik — World Music Charts (FREE, no API key) ──
// Sources: Apple's public RSS Marketing Tools feed (charts per storefront country,
// refreshed daily) and the iTunes Lookup API (the same one /music search already uses).
// Both are keyless and healthy from our server. Charts are cached 24h with
// stale-while-revalidate (the {data, expiresAt} pattern from src/teknologi.js) —
// a slow or failing Apple call never breaks the page; the last good chart wins.
const axios = require('axios');
const { attachGuard } = require('./outbound');

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'TukukOS-Muzik-Client/1.0 (+https://tukuk.org)' },
});
// The measured case that started the guard: nine /muzik/<cc> requests held Node for exactly
// 15.00 s each and then answered 503 (un-cached, so the next visitor pays it again), while the
// feed itself answers in 1.0–3.0 s from this box. 6 s is twice the worst healthy answer, and
// one dead chart costs a cooldown instead of a queue (src/outbound.js).
attachGuard(http, { name: 'muzik', budgetMs: 6000 });

const RSS = 'https://rss.marketingtools.apple.com/api/v2';

const cache = new Map();
const TTL = 24 * 60 * 60 * 1000;        // charts move once a day
const PREVIEW_TTL = 7 * TTL;            // preview URLs are static assets

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}

function cacheSet(key, data, ttl = TTL) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
  if (cache.size > 200) {
    let oldestKey = null; let oldest = Infinity;
    for (const [k, v] of cache) if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// cc → 🇵🇹-style regional-indicator emoji, computed so a typo is impossible
// (U+1F1E6 is 🇦, so an uppercase letter's code point shifts by 127397).
function flagOf(cc) {
  return String.fromCodePoint(...String(cc).toUpperCase().split('').map((c) => c.charCodeAt(0) + 127397));
}

// Apple storefronts we expose. Every code here was verified live against the
// charts feed (data/muzik-countries.js) — codes whose feed 404/500s were dropped
// (e.g. Bangladesh). Region buckets drive the hub grouping; names are English
// (international scope).
const COUNTRIES = [
  { cc: 'us', name: 'United States', region: 'Americas' },
  { cc: 'ca', name: 'Canada', region: 'Americas' },
  { cc: 'mx', name: 'Mexico', region: 'Americas' },
  { cc: 'br', name: 'Brazil', region: 'Americas' },
  { cc: 'ar', name: 'Argentina', region: 'Americas' },
  { cc: 'cl', name: 'Chile', region: 'Americas' },
  { cc: 'co', name: 'Colombia', region: 'Americas' },
  { cc: 'pe', name: 'Peru', region: 'Americas' },
  { cc: 'ec', name: 'Ecuador', region: 'Americas' },
  { cc: 'uy', name: 'Uruguay', region: 'Americas' },
  { cc: 'cr', name: 'Costa Rica', region: 'Americas' },
  { cc: 'pa', name: 'Panama', region: 'Americas' },
  { cc: 'do', name: 'Dominican Republic', region: 'Americas' },
  { cc: 'gt', name: 'Guatemala', region: 'Americas' },
  { cc: 've', name: 'Venezuela', region: 'Americas' },
  { cc: 'bo', name: 'Bolivia', region: 'Americas' },
  { cc: 'py', name: 'Paraguay', region: 'Americas' },
  { cc: 'jm', name: 'Jamaica', region: 'Americas' },
  { cc: 'tt', name: 'Trinidad & Tobago', region: 'Americas' },
  { cc: 'gb', name: 'United Kingdom', region: 'Europe' },
  { cc: 'ie', name: 'Ireland', region: 'Europe' },
  { cc: 'de', name: 'Germany', region: 'Europe' },
  { cc: 'fr', name: 'France', region: 'Europe' },
  { cc: 'es', name: 'Spain', region: 'Europe' },
  { cc: 'it', name: 'Italy', region: 'Europe' },
  { cc: 'pt', name: 'Portugal', region: 'Europe' },
  { cc: 'nl', name: 'Netherlands', region: 'Europe' },
  { cc: 'be', name: 'Belgium', region: 'Europe' },
  { cc: 'lu', name: 'Luxembourg', region: 'Europe' },
  { cc: 'ch', name: 'Switzerland', region: 'Europe' },
  { cc: 'at', name: 'Austria', region: 'Europe' },
  { cc: 'se', name: 'Sweden', region: 'Europe' },
  { cc: 'no', name: 'Norway', region: 'Europe' },
  { cc: 'dk', name: 'Denmark', region: 'Europe' },
  { cc: 'fi', name: 'Finland', region: 'Europe' },
  { cc: 'is', name: 'Iceland', region: 'Europe' },
  { cc: 'pl', name: 'Poland', region: 'Europe' },
  { cc: 'cz', name: 'Czechia', region: 'Europe' },
  { cc: 'sk', name: 'Slovakia', region: 'Europe' },
  { cc: 'hu', name: 'Hungary', region: 'Europe' },
  { cc: 'ro', name: 'Romania', region: 'Europe' },
  { cc: 'bg', name: 'Bulgaria', region: 'Europe' },
  { cc: 'hr', name: 'Croatia', region: 'Europe' },
  { cc: 'si', name: 'Slovenia', region: 'Europe' },
  { cc: 'rs', name: 'Serbia', region: 'Europe' },
  { cc: 'ee', name: 'Estonia', region: 'Europe' },
  { cc: 'lv', name: 'Latvia', region: 'Europe' },
  { cc: 'lt', name: 'Lithuania', region: 'Europe' },
  { cc: 'gr', name: 'Greece', region: 'Europe' },
  { cc: 'mt', name: 'Malta', region: 'Europe' },
  { cc: 'ua', name: 'Ukraine', region: 'Europe' },
  { cc: 'tr', name: 'Turkey', region: 'Africa & Middle East' },
  { cc: 'il', name: 'Israel', region: 'Africa & Middle East' },
  { cc: 'sa', name: 'Saudi Arabia', region: 'Africa & Middle East' },
  { cc: 'ae', name: 'United Arab Emirates', region: 'Africa & Middle East' },
  { cc: 'eg', name: 'Egypt', region: 'Africa & Middle East' },
  { cc: 'ma', name: 'Morocco', region: 'Africa & Middle East' },
  { cc: 'tn', name: 'Tunisia', region: 'Africa & Middle East' },
  { cc: 'dz', name: 'Algeria', region: 'Africa & Middle East' },
  { cc: 'ng', name: 'Nigeria', region: 'Africa & Middle East' },
  { cc: 'ke', name: 'Kenya', region: 'Africa & Middle East' },
  { cc: 'gh', name: 'Ghana', region: 'Africa & Middle East' },
  { cc: 'tz', name: 'Tanzania', region: 'Africa & Middle East' },
  { cc: 'ug', name: 'Uganda', region: 'Africa & Middle East' },
  { cc: 'za', name: 'South Africa', region: 'Africa & Middle East' },
  { cc: 'zw', name: 'Zimbabwe', region: 'Africa & Middle East' },
  { cc: 'zm', name: 'Zambia', region: 'Africa & Middle East' },
  { cc: 'na', name: 'Namibia', region: 'Africa & Middle East' },
  { cc: 'mu', name: 'Mauritius', region: 'Africa & Middle East' },
  { cc: 'in', name: 'India', region: 'Asia-Pacific' },
  { cc: 'pk', name: 'Pakistan', region: 'Asia-Pacific' },
  { cc: 'lk', name: 'Sri Lanka', region: 'Asia-Pacific' },
  { cc: 'np', name: 'Nepal', region: 'Asia-Pacific' },
  { cc: 'jp', name: 'Japan', region: 'Asia-Pacific' },
  { cc: 'kr', name: 'South Korea', region: 'Asia-Pacific' },
  { cc: 'cn', name: 'China', region: 'Asia-Pacific' },
  { cc: 'hk', name: 'Hong Kong', region: 'Asia-Pacific' },
  { cc: 'tw', name: 'Taiwan', region: 'Asia-Pacific' },
  { cc: 'sg', name: 'Singapore', region: 'Asia-Pacific' },
  { cc: 'my', name: 'Malaysia', region: 'Asia-Pacific' },
  { cc: 'id', name: 'Indonesia', region: 'Asia-Pacific' },
  { cc: 'th', name: 'Thailand', region: 'Asia-Pacific' },
  { cc: 'vn', name: 'Vietnam', region: 'Asia-Pacific' },
  { cc: 'ph', name: 'Philippines', region: 'Asia-Pacific' },
  { cc: 'mn', name: 'Mongolia', region: 'Asia-Pacific' },
  { cc: 'kz', name: 'Kazakhstan', region: 'Asia-Pacific' },
  { cc: 'au', name: 'Australia', region: 'Asia-Pacific' },
  { cc: 'nz', name: 'New Zealand', region: 'Asia-Pacific' },
  { cc: 'fj', name: 'Fiji', region: 'Asia-Pacific' },
  { cc: 'pg', name: 'Papua New Guinea', region: 'Asia-Pacific' },
];

const BY_CC = new Map(COUNTRIES.map((c) => [c.cc, { ...c, flag: flagOf(c.cc) }]));
const REGIONS = ['Americas', 'Europe', 'Africa & Middle East', 'Asia-Pacific'];

// Countries shown in the hub's "what the world is #1-ing right now" wall.
const HIGHLIGHT = ['us', 'gb', 'jp', 'kr', 'br', 'in', 'ng', 'de', 'fr', 'au', 'mx', 'sa'];

function hasCountry(cc) { return BY_CC.has(String(cc || '').toLowerCase()); }
function countryOf(cc) { return BY_CC.get(String(cc || '').toLowerCase()) || null; }
function allCountries() { return [...BY_CC.values()]; }

// One normalised chart row from an Apple feed entry.
function normSong(h, rank) {
  const artwork = String(h.artworkUrl100 || '').replace('/100x100bb.', '/300x300bb.');
  return {
    rank,
    id: String(h.id || ''),
    name: String(h.name || '').trim(),
    artist: String(h.artistName || '').trim(),
    artistUrl: String(h.artistUrl || ''),
    album: String(h.albumName || '').trim(),
    genre: ((h.categories && h.categories[0] && h.categories[0].name) || '').trim(),
    releaseDate: String(h.releaseDate || ''),
    url: String(h.url || ''),
    artwork,
  };
}

// Top-25 "Most Played" chart for one storefront. SWR: fresh hits return straight
// from cache, stale hits serve instantly while revalidating in the background.
async function countryChart(cc) {
  const c = BY_CC.get(String(cc).toLowerCase());
  if (!c) { const e = new Error('unknown country'); e.notFound = true; throw e; }
  const key = `chart:${c.cc}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  if (hit && hit.stale) { fetchChart(key, c.cc).catch(() => {}); return hit.data; }
  return fetchChart(key, c.cc);
}

async function fetchChart(key, cc) {
  try {
    const res = await http.get(`${RSS}/${cc}/music/most-played/25/songs.json`);
    const feed = res.data && res.data.feed;
    const list = feed && Array.isArray(feed.results) ? feed.results : [];
    const rows = list.map((h, i) => normSong(h, i + 1)).filter((r) => r.name && r.id);
    if (rows.length < 5) throw new Error('thin chart feed');
    const value = { cc, rows, updated: String(feed.updated || ''), fetchedAt: Date.now() };
    cacheSet(key, value);
    return value;
  } catch (err) {
    const h = cacheGet(key);
    if (h) return h.data; // stale beats an error
    throw err;
  }
}

// The hub wall: today's #1 for the highlight countries, in parallel, tolerant —
// one dead feed only loses that country's tile.
async function worldTop() {
  const parts = await Promise.all(HIGHLIGHT.map((cc) => countryChart(cc)
    .then((v) => ({ cc, country: BY_CC.get(cc), song: v.rows[0], updated: v.updated, fetchedAt: v.fetchedAt }))
    .catch(() => null)));
  const tiles = parts.filter(Boolean);
  if (!tiles.length) throw new Error('no country charts reachable');
  return { tiles, fetchedAt: Date.now() };
}

// 30-second preview clip + true full length for one chart track id (iTunes Lookup).
async function previewFor(id) {
  const clean = String(id || '').replace(/[^0-9]/g, '');
  if (!clean) { const e = new Error('bad id'); e.notFound = true; throw e; }
  const key = `prev:${clean}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  if (hit && hit.stale) { fetchPreview(key, clean).catch(() => {}); return hit.data; }
  return fetchPreview(key, clean);
}

async function fetchPreview(key, clean) {
  try {
    const res = await http.get(`https://itunes.apple.com/lookup?id=${clean}&entity=song`);
    const r = res.data && Array.isArray(res.data.results) ? res.data.results[0] : null;
    if (!r || !r.previewUrl) throw new Error('no preview for that track');
    const value = {
      id: clean,
      trackName: String(r.trackName || ''),
      artist: String(r.artistName || ''),
      previewUrl: String(r.previewUrl),
      fullMs: Number(r.trackTimeMillis) || 0,
      artwork: String(r.artworkUrl100 || '').replace('/100x100bb.', '/300x300bb.'),
    };
    cacheSet(key, value, PREVIEW_TTL);
    return value;
  } catch (err) {
    const h = cacheGet(key);
    if (h) return h.data;
    throw err;
  }
}

module.exports = { COUNTRIES, REGIONS, HIGHLIGHT, hasCountry, countryOf, allCountries, countryChart, worldTop, previewFor };
