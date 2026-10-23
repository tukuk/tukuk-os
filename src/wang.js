'use strict';
// ── TUKUK-OS WORLD MONEY (/wang) — ECB direct exchange rates ────────────
// Source: frankfurter.dev — European Central Bank rate data (40 currencies),
// FREE with no key and no registration. Updated every working day
// ±16:00 CET. Honesty contract: every payload carries source + asOfDate;
// rates are always labelled "reference rate" — never airport/counter rates.
const axios = require('axios');
const https = require('https');
const { attachGuard } = require('./outbound');

const http = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ family: 4 }), // VPS: IPv6 is awkward (NOAA pitfall)
  headers: { 'User-Agent': 'TukukOS-Money-Client/1.0 (+https://tukuk.org)' },
});
// Same shape as the /muzik case that started the guard: /wang/kadar answered 503 after 15.018 s
// in the survey window (the weight report still lists it among the ten slowest). Frankfurter is
// the ECB reference rate — one page, one call, nobody needs to queue behind it (src/outbound.js).
attachGuard(http, { name: 'wang' });

const BASE = 'https://api.frankfurter.dev/v1';
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  return { data: hit.data, stale: Date.now() > hit.expiresAt };
}
function cacheSet(key, data, ttlMs) { cache.set(key, { data, expiresAt: Date.now() + ttlMs }); }
const TTL_LATEST = 6 * 60 * 60 * 1000;         // ECB updates daily
const TTL_HIST = 7 * 24 * 60 * 60 * 1000;      // past dates never change

// Note: ECB rates are reference rates; only ~30 currencies in the ECB table are listed.
const CODES = [
  ['USD', 'US Dollar', '🇺🇸'], ['EUR', 'Euro', '🇪🇺'], ['GBP', 'British Pound', '🇬🇧'],
  ['JPY', 'Japanese Yen', '🇯🇵'], ['MYR', 'Malaysian Ringgit', '🇲🇾'], ['SGD', 'Singapore Dollar', '🇸🇬'],
  ['INR', 'Indian Rupee', '🇮🇳'], ['CNY', 'Chinese Yuan', '🇨🇳'], ['AUD', 'Australian Dollar', '🇦🇺'],
  ['NZD', 'New Zealand Dollar', '🇳🇿'], ['CAD', 'Canadian Dollar', '🇨🇦'], ['CHF', 'Swiss Franc', '🇨🇭'],
  ['KRW', 'South Korean Won', '🇰🇷'], ['BRL', 'Brazilian Real', '🇧🇷'], ['ZAR', 'South African Rand', '🇿🇦'],
  ['TRY', 'Turkish Lira', '🇹🇷'], ['IDR', 'Indonesian Rupiah', '🇮🇩'], ['THB', 'Thai Baht', '🇹🇭'],
  ['PHP', 'Philippine Peso', '🇵🇭'], ['SAR', 'Saudi Riyal', '🇸🇦'], ['MXN', 'Mexican Peso', '🇲🇽'],
  ['PLN', 'Polish Zloty', '🇵🇱'], ['SEK', 'Swedish Krona', '🇸🇪'], ['NOK', 'Norwegian Krone', '🇳🇴'],
  ['DKK', 'Danish Krone', '🇩🇰'], ['CZK', 'Czech Koruna', '🇨🇿'], ['HUF', 'Hungarian Forint', '🇭🇺'],
  ['RON', 'Romanian Leu', '🇷🇴'], ['ILS', 'Israeli Shekel', '🇮🇱'], ['ISK', 'Icelandic Krona', '🇮🇸'],
].filter((c) => c[1]);

function isCode(x) { return /^[A-Z]{3}$/.test(String(x || '')); }

// Latest rates for ONE base against every listed currency (single request).
async function getLatest(base) {
  const b = isCode(base) ? base : 'USD';
  const key = `latest:${b}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const res = await http.get(`${BASE}/latest?base=${b}`);
    const d = res.data || {};
    if (!d.rates) throw new Error('no rates');
    const out = { source: 'live', base: d.base || b, date: d.date, rates: d.rates, fetchedAt: Date.now() };
    cacheSet(key, out, TTL_LATEST);
    if (hit && hit.data) cacheSet(`hist:${b}:${out.date.slice(0, 4)}`, hit.data, TTL_HIST);
    return out;
  } catch (err) {
    if (hit && hit.data) return Object.assign({}, hit.data, { source: 'last-known' });
    throw err;
  }
}

// One day of history (for the "one year ago" comparison strip).
async function getOnDate(base, date) {
  const key = `ondate:${base}:${date}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  try {
    const res = await http.get(`${BASE}/${date}?base=${base}`);
    const out = { source: 'live', base, date, rates: (res.data && res.data.rates) || {}, fetchedAt: Date.now() };
    cacheSet(key, out, TTL_HIST);
    return out;
  } catch (err) {
    if (hit && hit.data) return Object.assign({}, hit.data, { source: 'last-known' });
    throw err;
  }
}

// Convert any→any through the base's rate table (EUR table has USD inside it —
// frankfurter always includes all counter-rates when no symbols= filter given).
function convert(latest, from, to, amount) {
  if (from === to) return { per: 1, total: Number(amount) || 0 };
  const r = latest.rates || {};
  // Rates are expressed as 1 {base} = x {symbol}. Cross: from→to = r[to]/r[from],
  // with r[base]=1.0 implicit.
  const val = (c) => (c === latest.base ? 1 : Number(r[c]));
  const a = val(from); const b = val(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  const per = b / a;
  return { per, total: (Number(amount) || 1) * per };
}

module.exports = { CODES, isCode, getLatest, getOnDate, convert };
