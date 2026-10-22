'use strict';
// ── TUKUK-OS READING — the "Further reading" & "The research" boxes for /akademi ─
// Two sources, both FREE with no key:
//   * Open Library (openlibrary.org/search.json) — 40M+ bibliographic records;
//     cover via covers.openlibrary.org (external image link, allowed by the CSP).
//   * Crossref (api.crossref.org) — a DOI index of 150M+ academic works;
//     sort=is-referenced-by-count yields the most-cited ones.
// 24-hour cache — academy topics are stable, freshness needs no more than that.
const axios = require('axios');
const https = require('https');

const http = axios.create({
  timeout: 12000,
  httpsAgent: new https.Agent({ family: 4 }),
  headers: { 'User-Agent': 'TukukOS-Reading/1.0 (+https://tukuk.org/contact)' },
});

const cache = new Map();
const TTL = 24 * 60 * 60 * 1000;
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data) { cache.set(key, { data, expiresAt: Date.now() + TTL }); }

async function books(topic, want) {
  const key = `b:${topic}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const res = await http.get('https://openlibrary.org/search.json', {
    params: { q: topic, limit: want || 3, fields: 'title,author_name,first_publish_year,key,cover_i,edition_count' },
  });
  const rows = ((res.data && res.data.docs) || []).slice(0, want || 3).map((d) => ({
    title: d.title || '',
    author: (d.author_name && d.author_name[0]) || 'Unknown',
    year: d.first_publish_year || null,
    key: d.key || '',
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    url: d.key ? `https://openlibrary.org${d.key}` : 'https://openlibrary.org',
  })).filter((r) => r.title);
  cacheSet(key, rows);
  return rows;
}

async function papers(topic, want) {
  const key = `p:${topic}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const res = await http.get('https://api.crossref.org/works', {
    params: {
      'query.bibliographic': topic, rows: want || 3, sort: 'is-referenced-by-count',
      order: 'desc', select: 'title,DOI,is-referenced-by-count,issued,author',
    },
  });
  const rows = (((res.data && res.data.message && res.data.message.items) || [])).slice(0, want || 3).map((it) => ({
    title: (it.title && it.title[0]) || '',
    doi: it.DOI || '',
    cites: Number(it['is-referenced-by-count']) || 0,
    year: it.issued && it.issued['date-parts'] && it.issued['date-parts'][0] && it.issued['date-parts'][0][0],
    author: it.author && it.author[0] ? (it.author[0].family || it.author[0].name || 'Unknown') : 'Unknown',
    url: it.DOI ? `https://doi.org/${it.DOI}` : 'https://www.crossref.org',
  })).filter((r) => r.title);
  cacheSet(key, rows);
  return rows;
}

module.exports = { books, papers };
