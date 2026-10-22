'use strict';
// ── TUKUK-OS /bendera — Flags of the World ──
// The country list, slugs and flag PNGs already come from src/negara.js (the
// vendored world-countries dataset, no key). This module adds the STORY: the
// lead paragraph of each "Flag of <country>" article on English Wikipedia —
// real, sourced, CC BY-SA text (attribution is rendered on every page).
// Summaries are cached in memory for 30 days AND persisted to
// data/bendera-stories.json, so a Wikipedia outage or a dead server still
// serves the last good texts — clearly labelled with their fetch date.
const fs = require('fs');
const path = require('path');
const https = require('https');

const STORE = path.join(__dirname, '..', 'data', 'bendera-stories.json');
const TTL = 30 * 24 * 60 * 60 * 1000;
const mem = new Map(); // cc → {data, expiresAt}

// Disk snapshot is the fallback of last resort; loaded lazily once.
let disk = null;
function loadDisk() {
  if (disk) return disk;
  try { disk = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { disk = {}; }
  return disk;
}
let saveQueued = false;
function saveDisk() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    try {
      const out = {};
      for (const [cc, v] of mem) out[cc] = v.data;
      for (const cc of Object.keys(loadDisk())) if (!out[cc]) out[cc] = loadDisk()[cc];
      fs.writeFileSync(STORE, JSON.stringify(out));
    } catch (e) { console.warn('[bendera] snapshot save failed:', e.message); }
  }, 2000).unref();
}

function wikiSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'TukukOS-Bendera-Client/1.0 (+https://tukuk.org)' },
    }, (res) => {
      if (res.statusCode === 404) { res.resume(); const e = new Error('no article'); e.notFound = true; reject(e); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// The flag story for one country name ("Tuvalu", "Côte d'Ivoire", …).
// Returns { extract, url, fetchedAt } | { missing:true, …from cache } | null.
async function flagStory(cca2, name) {
  const hit = mem.get(cca2);
  if (hit && Date.now() < hit.expiresAt) return hit.data;
  try {
    const j = await wikiSummary('Flag of ' + name);
    const canonical = (((j.titles || {}).canonical) || ('Flag_of_' + name)).replace(/_/g, ' ');
    const data = {
      extract: String(j.extract || ''),
      url: (j.contentUrls && j.contentUrls.desktop && j.contentUrls.desktop.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(canonical)}`,
      title: canonical,
      fetchedAt: Date.now(),
    };
    if (!data.extract) throw new Error('empty extract');
    mem.set(cca2, { data, expiresAt: Date.now() + TTL });
    saveDisk();
    return data;
  } catch (err) {
    if (err.notFound) {
      // Remember the gap honestly so we do not re-probe on every page view.
      const data = { missing: true, fetchedAt: Date.now() };
      mem.set(cca2, { data, expiresAt: Date.now() + TTL });
      return data;
    }
    if (hit) return hit.data; // stale beats an error
    const d = loadDisk()[cca2]; // dead cache? the disk snapshot still serves
    if (d) return d;
    return null;
  }
}

// Flags a visitor is most likely to land on first (they are in the sitemap, the
// header nav and the country chips) — warmed before the rest of the list.
const PRIORITY = ['malaysia', 'united-states', 'united-kingdom', 'japan', 'brazil',
  'india', 'nigeria', 'germany', 'france', 'singapore', 'australia', 'nepal',
  'netherlands', 'south-korea', 'mexico', 'saudi-arabia'];

// Pre-warm the snapshot at boot: gently fetch stories we do not have yet,
// a few at a time, so the first visitors are not charged for the crawl.
async function warmStories(countries, limit = 8) {
  const pending = countries.filter((c) => c.cca2 && !loadDisk()[c.cca2] && !mem.has(c.cca2));
  const rank = (c) => { const i = PRIORITY.indexOf(c.slug); return i < 0 ? PRIORITY.length : i; };
  const todo = [...pending].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit);
  for (const c of todo) {
    await flagStory(c.cca2, c.name).catch(() => {});
    await new Promise((r) => setTimeout(r, 800)); // polite to Wikipedia
  }
  return { warmed: todo.length, pending: pending.length };
}

module.exports = { flagStory, warmStories, PRIORITY, STORE, TTL };
