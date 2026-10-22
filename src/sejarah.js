'use strict';
// ── TUKUK-OS SEJARAH (/sejarah) — "On this day" via Wikipedia REST feed ───────
// Source: https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/MM/DD —
// ONE keyless request that returns selected (featured events),
// births, deaths and holidays for a date. The data is cached 30 days (history
// doesn't change) with SWR: upstream slow/failing → serve the stale cache, NEVER 503
// when it succeeded before. Invalid dates (month/day out of range) are REJECTED 404
// BEFORE any API call — so a bot can't trigger a 500 / burn quota.
// The page text & meaning are in English (international).
const https = require('https');

const FEED = 'https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all';
const UA = 'TukukOS-Sejarah/1.0 (+https://tukuk.org)';
const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // history is fixed — long cache

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function daysInMonth(m, y) {
  if (m === 2) return isLeap(y == null ? 2024 : y) ? 29 : 28; // Feb reaches 29 (leap year)
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}
function pad2(n) { return String(n).padStart(2, '0'); }

// Validate mm/dd BEFORE the API. Feb is lenient up to 29 so the 02/29 page keeps existing
// (the feed has that data). Out-of-range month/day → null (the caller answers 404, no API).
function validDate(mm, dd) {
  const m = Number(mm); const d = Number(dd);
  if (!Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1) return null;
  const max = m === 2 ? 29 : daysInMonth(m, 2024);
  if (d > max) return null;
  return { mm: pad2(m), dd: pad2(d), month: MONTHS[m - 1], m, d };
}

// ——— HTTP with an IPv6→IPv4 fallback + a soft timeout (the bencana.js pattern) ———
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
      res.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) req.destroy(new Error('too big')); chunks.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function fetchJson(url) {
  try { return await httpsGet(url, v6Agent); } catch { return await httpsGet(url, v4Agent); }
}

// Clean one feed item → {year, text, links[]}. pages[] → Wikipedia links.
function pick(it) {
  const links = Array.isArray(it.pages) ? it.pages.slice(0, 3).map((p) => ({
    title: String(p.title || '').replace(/_/g, ' '),
    href: p.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}` : null,
  })).filter((x) => x.href) : [];
  return { year: it.year || null, text: String(it.text || '').trim(), links };
}

// Load & condense one date. selected stays complete; births/deaths are trimmed to the top 12.
async function loadDay(mm, dd) {
  const v = validDate(mm, dd);
  if (!v) return null;
  const key = `otd:${v.mm}-${v.dd}`;
  const hit = cache.get(key);
  if (hit && Date.now() <= hit.expiresAt) return hit.data; // fresh
  try {
    const body = await fetchJson(`${FEED}/${v.mm}/${v.dd}`);
    const arr = (k) => Array.isArray(body && body[k]) ? body[k].map(pick).filter((x) => x.text) : [];
    const data = {
      mm: v.mm, dd: v.dd, m: v.m, d: v.d, month: v.month,
      label: `${v.month} ${v.d}`,
      selected: arr('selected'),
      births: arr('births').slice(0, 12),
      deaths: arr('deaths').slice(0, 12),
      holidays: arr('holidays'),
    };
    if (!data.selected.length && !data.births.length && !data.deaths.length) {
      // Empty feed (date outside the calendar, etc.) → don't cache empty as truth.
      if (hit) return hit.data;
      return null;
    }
    cache.set(key, { data, expiresAt: Date.now() + TTL });
    return data;
  } catch (err) {
    if (hit) return hit.data; // SWR — serve stale, never 503
    throw err;
  }
}

// The 366 valid dates for the hub + sitemap (reference year 2024 → 29 Feb included).
function allDates() {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const max = daysInMonth(m, 2024);
    for (let d = 1; d <= max; d++) out.push({ mm: pad2(m), dd: pad2(d), month: MONTHS[m - 1], d });
  }
  return out;
}

function todayParts(date) {
  const t = date || new Date();
  return { mm: pad2(t.getUTCMonth() + 1), dd: pad2(t.getUTCDate()) };
}

module.exports = { loadDay, allDates, validDate, todayParts, MONTHS, daysInMonth };
