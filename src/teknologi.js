'use strict';
// ── TUKUK-OS TECHNOLOGY COMPLEX — the live pulse of the tech world (FREE, no API key) ──
// Source: the public Hacker News Algolia API (https://hn.algolia.com/api/v1/…).
// No signup, generous fair-use quota; the front page re-ranks continuously.
// We cache 10 minutes with stale-while-revalidate (same pattern as gempa.js), so
// a slow or failing HN call never breaks the page — old list beats an error.
const axios = require('axios');

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'TukukOS-Technology-Client/1.0 (+https://tukuk.org)' },
});

const API = 'https://hn.algolia.com/api/v1';

const cache = new Map();
const TTL = 10 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}

function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + TTL });
  if (cache.size > 40) {
    let oldestKey = null; let oldest = Infinity;
    for (const [k, v] of cache) if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// One normalised story row from an Algolia hit.
function normHit(h) {
  const title = String(h.title || h.story_title || '').trim();
  return {
    id: String(h.objectID || ''),
    title,
    url: String(h.url || ''),
    text: String(h.story_text || h.comment_text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    points: Number(h.points) || 0,
    comments: Number(h.num_comments) || 0,
    author: String(h.author || ''),
    createdAt: Number(h.created_at_i) || 0,
  };
}

function hnLink(s) {
  return `https://news.ycombinator.com/item?id=${encodeURIComponent(s.id)}`;
}

// Read a ranked/filtered story list from HN Algolia; SWR cache keyed by params.
async function hnQuery(path, params) {
  const key = `${path}?${JSON.stringify(params)}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  if (hit && hit.stale) { fetchAndCache(key, path, params).catch(() => {}); return hit.data; }
  return fetchAndCache(key, path, params);
}

async function fetchAndCache(key, path, params) {
  try {
    const res = await http.get(`${API}/${path}`, { params });
    const hits = res.data && Array.isArray(res.data.hits) ? res.data.hits : [];
    const rows = hits.map(normHit).filter((s) => s.title);
    if (!rows.length) throw new Error('empty HN feed');
    cacheSet(key, rows);
    return rows;
  } catch (err) {
    const h = cacheGet(key);
    if (h) return h.data; // stale beats an error
    throw err;
  }
}

// The current front page, ranked the way Hacker News ranks it.
function frontPage() {
  return hnQuery('search', { tags: 'front_page', hitsPerPage: 30 });
}

// Newest tech stories worth reading (a light quality floor on points+comments).
function latest() {
  const since = Math.floor(Date.now() / 1000) - 48 * 3600;
  return hnQuery('search_by_date', { tags: 'story', numericFilters: `created_at_i>${since}`, hitsPerPage: 30 });
}

// "Show HN" — people demonstrating something they built, last 14 days, 20+ points.
function showHn() {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  return hnQuery('search_by_date', { tags: 'show_hn', numericFilters: `created_at_i>${since},points>19`, hitsPerPage: 30 });
}

// "Ask HN" — questions to the community, last 14 days, some traction.
function askHn() {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  return hnQuery('search_by_date', { tags: 'ask_hn', numericFilters: `created_at_i>${since},points>4`, hitsPerPage: 30 });
}

// A compact "3h ago / 2d ago" label for story rows.
function agoLabel(unixSec) {
  if (!unixSec) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

// The readable domain shown under each story title.
function domainOf(s) {
  if (s.url) { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* fall through */ } }
  return 'news.ycombinator.com';
}

module.exports = { frontPage, latest, showHn, askHn, hnLink, agoLabel, domainOf };
