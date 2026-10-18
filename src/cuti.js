'use strict';
// ── TUKUK-OS CUTI COMPLEX — jadual cuti umum Malaysia (PERCUMA, tanpa kunci) ──
// Sumber: malaysia-holiday.dydxsoft.my/api/v1 — API Laravel terbuka yang
// disemak admin terhadap dokumen rasmi (www.kabinet.gov.my/hari-kelepasan-am),
// nama perayaan dalam Bahasa Melayu, liputan 13 negeri + 3 wilayah persekutuan.
// Tiada pendaftaran & tiada kuota keras; jadual jarang berubah → cache 30 hari.
const axios = require('axios');
const https = require('https');

const http = axios.create({
  timeout: 12000,
  headers: { 'User-Agent': 'TukukOS-Cuti-Client/1.0 (+https://tukuk.org)' },
});

// CDN (hcdn) di sisi pelayan ini menjawab 403 "browser challenge" pada edge
// IPv4-nya untuk klien bukan pelayar (axios/fetch/curl), tetapi lulus melalui
// edge IPv6. server.js menetapkan dns result order 'ipv4first' global, jadi
// kita paksa IPv6 dahulu, kemudian fallback ke resolusi biasa jika hos
// langsung tiada IPv6 (laptop korporat/VPS tertentu) atau ralat rangkaian.
const v6Agent = new https.Agent({ family: 6, keepAlive: true });
const plainAgent = new https.Agent({ keepAlive: true });

const BASE = 'https://malaysia-holiday.dydxsoft.my/api/v1';

const cache = new Map();
const TTL = 30 * 24 * 60 * 60 * 1000; // 30 hari — hanya berubah bila kerajaan umum potongan khas

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

// ——— 16 negeri/wilayah: [kod API, slug, nama, hujung minggu] ———
// Kedah, Kelantan, Johor & Terengganu bercuti Jumaat–Sabtu; selebihnya Sabtu–Ahad.
const STATE_ROWS = [
  ['JHR', 'johor', 'Johor', 'Jumaat–Sabtu'],
  ['KDH', 'kedah', 'Kedah', 'Jumaat–Sabtu'],
  ['KTN', 'kelantan', 'Kelantan', 'Jumaat–Sabtu'],
  ['MLK', 'melaka', 'Melaka', 'Sabtu–Ahad'],
  ['NSN', 'negeri-sembilan', 'Negeri Sembilan', 'Sabtu–Ahad'],
  ['PHG', 'pahang', 'Pahang', 'Sabtu–Ahad'],
  ['PRK', 'perak', 'Perak', 'Sabtu–Ahad'],
  ['PLS', 'perlis', 'Perlis', 'Sabtu–Ahad'],
  ['PNG', 'pulau-pinang', 'Pulau Pinang', 'Sabtu–Ahad'],
  ['SBH', 'sabah', 'Sabah', 'Sabtu–Ahad'],
  ['SWK', 'sarawak', 'Sarawak', 'Sabtu–Ahad'],
  ['SGR', 'selangor', 'Selangor', 'Sabtu–Ahad'],
  ['TRG', 'terengganu', 'Terengganu', 'Jumaat–Sabtu'],
  ['KUL', 'kuala-lumpur', 'Kuala Lumpur', 'Sabtu–Ahad'],
  ['PJY', 'putrajaya', 'Putrajaya', 'Sabtu–Ahad'],
  ['LBN', 'labuan', 'Labuan', 'Sabtu–Ahad'],
];
const STATES = STATE_ROWS.map(([code, slug, name, weekend]) => ({ code, slug, name, weekend }));

function findState(slug) {
  const s = String(slug || '').toLowerCase();
  return STATES.find((x) => x.slug === s || x.code.toLowerCase() === s) || null;
}

async function requestJson(url) {
  // Dua laluan: IPv6-paksa (edge yang dilayan CDN) kemudian resolusi biasa.
  try {
    const res = await http.get(url, { httpsAgent: v6Agent });
    return res.data;
  } catch (err) {
    const status = err.response ? err.response.status : null;
    // Ralat bukan-403 yang mempunyai respons (404/500) = memang tiada data.
    if (status && status !== 403) throw err;
    const res2 = await http.get(url, { httpsAgent: plainAgent });
    return res2.data;
  }
}

// Ekor giliran permintaan — satu sokongan pada satu masa ke CDN yang sama.
let queueTail = Promise.resolve();
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function apiGet(path, params) {
  const key = `${path}:${JSON.stringify(params || {})}`;
  const hit = cacheGet(key);
  if (hit && !hit.stale) return hit.data;
  const qs = new URLSearchParams(Object.entries(params || {}).map(([k, v]) => [k, String(v)])).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  // CDN hcdn di sisi pelayan kadang menolak dengan 403 "challenge" apabila
  // beberapa sokongan serentak dari IP yang sama. Suai cara bergilir (satu
  // permintaan pada satu masa) + satu percubaan semula selepas 1.5s.
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
    if (hit) return hit.data; // stale lebih baik daripada tiada
    throw lastErr;
  } finally {
    release();
  }
}

// Senarai nasional (setiap entri ada state_codes = negeri yang bercuti).
function getHolidays(year) {
  return apiGet('/holidays', { year: Number(year) });
}

// Senarai satu negeri sahaja.
function getStateHolidays(code, year) {
  return apiGet('/holidays', { year: Number(year), state: code });
}

// Tapis senarai nasional mengikut negeri (untuk halaman hab — run berturutan
// hanya bermakna bagi satu negeri; nasional bercampur-cahur tak boleh digabung).
function forState(rows, code) {
  return rows.filter((r) => Array.isArray(r.state_codes) && r.state_codes.includes(code));
}

const YEAR_MIN = 2026;
const YEAR_MAX = 2027; // API kini menyokong dua tahun ini sahaja

function dow(dateStr) { return new Date(`${dateStr}T00:00:00Z`).getUTCDay(); }

// ——— Pengiraan hujung minggu panjang ———
// Kumpul cuti berturutan jadi "run", tambah hujung minggu bersebelahan (Sabtu–Ahad
// sebagai piawaian nasional; 4 negeri Jumaat–Sabtu noted di halaman negeri).
// Output: [{start,end,holidays:[row],spanDays,auto,bridge}]
//   auto = 3 hari atau lebih TANPA perlu cuti rehat; bridge = perlu 1 cuti rehat.
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
    // Hujung minggu piawai Sabtu–Ahad. Khamis→2 (Jumaat kerja) & Selasa→2 (Isnin kerja)
    // bukan hujung minggu panjang, jadi hanya Jumaat/Sabtu/Ahad/Istin dan Ahad
    // di belakang run dikira.
    if (ld === 5) span += 2;              // cuti berakhir Jumaat → Sabtu-Ahad melekat
    else if (ld === 6) span += 1;         // berakhir Sabtu → Ahad melekat
    if (fd === 1) span += 2;              // cuti bermula Isnin → Sabtu-Ahad sebelumnya
    else if (fd === 0) span += 1;         // bermula Ahad → Sabtu sebelumnya
    out.push({
      start: r[0].date, end: r[r.length - 1].date, holidays: r, spanDays: span,
      auto: span >= 3, bridge: span >= 3 ? 0 : (hasBridge(r) ? 1 : 0),
    });
  }
  return out.filter((w) => w.spanDays >= 3 || w.bridge);
}

function hasBridge(r) {
  // Cuti tunggal Selasa/ Khamis: 1 hari cuti rehat sambung hujung minggu → 4 hari.
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
