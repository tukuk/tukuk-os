'use strict';
// ── SOCIAL FINDER — OSINT akaun AWAM yang pasif & beretika ──────────────────
// Semak sama ada satu nama pengguna WUJUD di platform publik dengan memeriksa
// status HTTP halaman profil AWAM (200 = kemungkinan wujud, 404 = tiada).
// Prinsip: tiada login, tiada data peribadi, tiada halaman peribadi disentuh —
// hanya paparan awam yang mana-mana pelawat boleh buka. Platform bertembok
// login (Instagram, X, Facebook) dipulangkan sebagai 'check' sahaja supaya
// pengguna semak sendiri di pautan.
// Guna untuk akauntabiliti (jejak penipu yang menyamar) — bukan gangguan/stalking.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minit — nama sama tak dibom berulang
const CACHE_MAX = 200;

// `probe: true` = status HTTP boleh dipercayai untuk pengesanan automatik.
// Susunan = keutamaan paparan: auto-detect dulu, manual-check selepas.
const PLATFORMS = [
  { name: 'GitHub', ic: '🐙', probe: true, url: (u) => `https://github.com/${u}` },
  { name: 'YouTube', ic: '▶️', probe: true, url: (u) => `https://www.youtube.com/@${u}` },
  { name: 'Reddit', ic: '👾', probe: false, url: (u) => `https://www.reddit.com/user/${u}` }, // API awam & halaman diblok 403 dari pelayan → semak manual
  { name: 'X', ic: '🐦', probe: false, url: (u) => `https://x.com/${u}` }, // bertembok login + API follow-button lama telah mati → semak manual
  // t.me sentiasa hantar 200 + halaman pratinjau walaupun nama tidak wujud →
  // status HTTP tak boleh dipercayai; dipapar sebagai 'check' (semak manual).
  { name: 'Telegram', ic: '✈️', probe: false, url: (u) => `https://t.me/${u}` },
  { name: 'TikTok', ic: '🎵', probe: false, url: (u) => `https://www.tiktok.com/@${u}` }, // soft-404: 200 untuk nama tak wujud
  { name: 'Instagram', ic: '📸', probe: false, url: (u) => `https://www.instagram.com/${u}/` },
  { name: 'Facebook', ic: '📘', probe: false, url: (u) => `https://www.facebook.com/${u}` },
  { name: 'Pinterest', ic: '📌', probe: false, url: (u) => `https://www.pinterest.com/${u}/` }, // soft-404 juga
  { name: 'Twitch', ic: '🎮', probe: false, url: (u) => `https://www.twitch.tv/${u}` } // SPA: shellsama untuk wujud/tidak → semak manual
];

// Nama pengguna yang sah untuk ditempel ke templat URL — huruf/nombor/. _ -,
// 2–31 karakter, bermula alfanumerik. (Mencegah sisipan laluan/kuiri jahat.)
function normalizeUsername(raw) {
  const u = String(raw || '').trim().replace(/^@+/, '');
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,30}$/.test(u) ? u : null;
}

async function probe(p, u) {
  const url = p.url(u);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' }
    });
    if (r.status === 404) return { state: 'notfound', url };
    if (!r.ok) return { state: 'check', url };
    if (p.negative) {
      const body = (await r.text()).slice(0, 20000);
      if (p.negative.test(body)) return { state: 'notfound', url };
    }
    return { state: 'found', url };
  } catch {
    return { state: 'check', url }; // timeout/ablok/ralat rangkaian → semak manual
  } finally {
    clearTimeout(t);
  }
}

const cache = new Map();

async function lookup(raw) {
  const u = normalizeUsername(raw);
  if (!u) return { error: 'Invalid username — letters, numbers, dot, underscore, dash; 2–31 characters.' };
  const hit = cache.get(u);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { username: u, results: hit.results, cached: true };
  }
  const results = await Promise.all(PLATFORMS.map((p) =>
    (p.probe
      ? probe(p, u).then((r) => ({ platform: p.name, ic: p.ic, state: r.state, url: r.url }))
      : Promise.resolve({ platform: p.name, ic: p.ic, state: 'check', url: p.url(u) }))
  ));
  // found dahulu, then notfound, then manual-check — hasil penting tak tenggelim.
  const rank = { found: 0, notfound: 1, check: 2 };
  results.sort((a, b) => rank[a.state] - rank[b.state]);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(u, { at: Date.now(), results });
  return { username: u, results };
}

module.exports = { lookup, normalizeUsername, PLATFORMS };
