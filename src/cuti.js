'use strict';
// ── TUKUK-OS CUTI COMPLEX — Malaysia public-holiday calendar (FREE, no API key) ──
// Source: malaysia-holiday.dydxsoft.my/api/v1 — an open Laravel API whose
// tables are checked by the admin against the official gazette
// (www.kabinet.gov.my/hari-kelepasan-am); celebration names come back in Malay,
// covering 13 states + 3 federal territories. No signup and no hard quota; the
// calendar rarely changes → cached for 30 days.
const axios = require('axios');
const { attachGuard } = require('./outbound');
const https = require('https');

const http = axios.create({
  timeout: 12000,
  headers: { 'User-Agent': 'TukukOS-Cuti-Client/1.0 (+https://tukuk.org)' },
});
// Guarded as-is: the declared 12 s stays the deadline, what this adds is one shared call per
// URL during a crawler burst and a cooldown after a failure instead of a queue (src/outbound.js).
attachGuard(http, { name: 'cuti' });

// The server-side CDN (hcdn) answers non-browser clients (axios/fetch/curl) with a
// 403 "browser challenge" on its IPv4 edge but passes us through the IPv6 edge.
// server.js sets the global dns result order to 'ipv4first', so we force IPv6
// first and fall back to plain resolution when the host has no IPv6 at all
// (corporate laptop / certain VPS) or the network itself fails.
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const plainAgent = new https.Agent({ keepAlive: true });

const BASE = 'https://malaysia-holiday.dydxsoft.my/api/v1';

const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // 30 days — the table only moves when the government declares a special day off

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) return { data: hit.data, stale: true };
  return { data: hit.data, stale: false };
}

function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + TTL });
  if (cache.size > 80) {
    let oldestKey = null; let oldest = Infinity;
    for (const [k, v] of cache) if (v.expiresAt < oldest) { oldest = v.expiresAt; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// ——— 16 states/territories: [API code, slug, name, weekend convention] ———
// Kedah, Kelantan, Johor & Terengganu rest on Friday–Saturday; the rest Saturday–Sunday.
const STATE_ROWS = [
  ['JHR', 'johor', 'Johor', 'Friday–Saturday'],
  ['KDH', 'kedah', 'Kedah', 'Friday–Saturday'],
  ['KTN', 'kelantan', 'Kelantan', 'Friday–Saturday'],
  ['MLK', 'melaka', 'Melaka', 'Saturday–Sunday'],
  ['NSN', 'negeri-sembilan', 'Negeri Sembilan', 'Saturday–Sunday'],
  ['PHG', 'pahang', 'Pahang', 'Saturday–Sunday'],
  ['PRK', 'perak', 'Perak', 'Saturday–Sunday'],
  ['PLS', 'perlis', 'Perlis', 'Saturday–Sunday'],
  ['PNG', 'pulau-pinang', 'Pulau Pinang', 'Saturday–Sunday'],
  ['SBH', 'sabah', 'Sabah', 'Saturday–Sunday'],
  ['SWK', 'sarawak', 'Sarawak', 'Saturday–Sunday'],
  ['SGR', 'selangor', 'Selangor', 'Saturday–Sunday'],
  ['TRG', 'terengganu', 'Terengganu', 'Friday–Saturday'],
  ['KUL', 'kuala-lumpur', 'Kuala Lumpur', 'Saturday–Sunday'],
  ['PJY', 'putrajaya', 'Putrajaya', 'Saturday–Sunday'],
  ['LBN', 'labuan', 'Labuan', 'Saturday–Sunday'],
];
const STATES = STATE_ROWS.map(([code, slug, name, weekend]) => ({ code, slug, name, weekend }));

function findState(slug) {
  const s = String(slug || '').toLowerCase();
  return STATES.find((x) => x.slug === s || x.code.toLowerCase() === s) || null;
}

async function requestJson(url) {
  // Two routes: the forced-IPv6 one (the edge the CDN serves) then plain resolution.
  try {
    const res = await http.get(url, { httpsAgent: v6Agent });
    return res.data;
  } catch (err) {
    const status = err.response ? err.response.status : null;
    // A non-403 status that did get a response (404/500) really means "no data".
    if (status && status !== 403) throw err;
    const res2 = await http.get(url, { httpsAgent: plainAgent });
    return res2.data;
  }
}

// One request in flight at a time toward the same CDN.
let queueTail = Promise.resolve();
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function apiGet(path, params) {
  const key = `${path}:${JSON.stringify(params || {})}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const qs = new URLSearchParams(Object.entries(params || {}).map(([k, v]) => [k, String(v)])).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  // The server-side hcdn sometimes answers 403 "challenge" when several
  // connections from the same IP are open at once. Serialize the requests (one
  // at a time) and retry once after 1.5s.
  const prev = queueTail;
  let release;
  queueTail = new Promise((r) => { release = r; });
  let lastErr = null;
  try {
    await prev;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(1500);
      try {
        const body = await requestJson(url);
        const data = (body && Array.isArray(body.data)) ? body.data : [];
        if (data.length) cacheSet(key, data);
        return data.length ? data : (hit ? hit.data : data);
      } catch (err) {
        lastErr = err;
        if (process.env.CUTI_DEBUG) console.error('[cuti] apiGet fail', path, JSON.stringify(params), 'attempt', attempt, err.message);
      }
    }
    if (hit) return hit.data; // stale beats an error page
    throw lastErr;
  } finally {
    release();
  }
}

// National list (every entry carries state_codes = the states that rest that day).
function getHolidays(year) {
  return apiGet('/holidays', { year: Number(year) });
}

// One state only.
function getStateHolidays(code, year) {
  return apiGet('/holidays', { year: Number(year), state: code });
}

// Filter the national list down to one state (for the hub pages — consecutive runs
// only make sense per state; the mixed national list cannot be joined up).
function forState(rows, code) {
  return rows.filter((r) => Array.isArray(r.state_codes) && r.state_codes.includes(code));
}

const YEAR_MIN = 2026;
const YEAR_MAX = 2027; // the API currently supports these two years only

function dow(dateStr) { return new Date(`${dateStr}T00:00:00Z`).getUTCDay(); }

// ——— Long-weekend calculation ———
// Collect consecutive holidays into runs, then append the adjacent weekend
// (Saturday–Sunday as the national convention; the 4 Friday–Saturday states are
// noted on each state page).
// Output: [{start,end,holidays:[row],spanDays,auto,bridge}]
//   auto = 3 days or more WITHOUT taking leave; bridge = one leave day is needed.
function longWeekends(rows) {
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const runs = [];
  let run = [];
  const flush = () => { if (run.length) { runs.push(run); run = []; } };
  for (let i = 0; i < sorted.length; i++) {
    if (run.length && sorted[i].date > nextDay(run[run.length - 1].date)) flush();
    run.push(sorted[i]);
  }
  flush();
  const out = [];
  for (const r of runs) {
    let span = r.length;
    const fd = dow(r[0].date), ld = dow(r[r.length - 1].date);
    // The standard Saturday–Sunday weekend. Thursday→2 (Friday is a work day) and
    // Tuesday→2 (Monday is a work day) are not long weekends, so only a Friday or
    // Saturday end, and a Monday or Sunday start, are counted.
    if (ld === 5) span += 2;              // holiday ends on Friday → Saturday-Sunday attach
    else if (ld === 6) span += 1;         // ends on Saturday → Sunday attaches
    if (fd === 1) span += 2;              // holiday starts on Monday → the previous Saturday-Sunday
    else if (fd === 0) span += 1;         // starts on Sunday → the Saturday before
    out.push({
      start: r[0].date, end: r[r.length - 1].date, holidays: r, spanDays: span,
      auto: span >= 3, bridge: span >= 3 ? 0 : (hasBridge(r) ? 1 : 0),
    });
  }
  return out.filter((w) => w.spanDays >= 3 || w.bridge);
}

function hasBridge(r) {
  // A lone Tuesday or Thursday holiday: 1 leave day joins it to the weekend → 4 days.
  if (r.length !== 1) return false;
  const d = dow(r[0].date);
  return d === 2 || d === 4;
}

function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nextHoliday(rows, todayStr) {
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return sorted.find((r) => String(r.date) >= String(todayStr)) || null;
}

module.exports = { STATES, findState, getHolidays, getStateHolidays, forState, longWeekends, nextHoliday, YEAR_MIN, YEAR_MAX };
