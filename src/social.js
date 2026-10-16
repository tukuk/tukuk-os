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
// `negative` = regex penafian dalam badan halaman bila server kekal hantar 200.
const PLATFORMS = [
  { name: 'GitHub', probe: true, url: (u) => `https://github.com/${u}` },
  // t.me sentiasa hantar 200 + halaman pratinjau walaupun nama tidak wujud →
  // status HTTP tak boleh dipercayai; dipapar sebagai 'check' (semak manual).
  { name: 'Telegram', probe: false, url: (u) => `https://t.me/${u}` },
  { name: 'YouTube', probe: true, url: (u) => `https://www.youtube.com/@${u}` },
  { name: 'Reddit', probe: true, json: true, url: (u) => `https://www.reddit.com/user/${u}/about.json` },
  { name: 'TikTok', probe: false, url: (u) => `https://www.tiktok.com/@${u}` }, // soft-404: 200 untuk nama tak wujud
  { name: 'Pinterest', probe: false, url: (u) => `https://www.pinterest.com/${u}/` }, // soft-404 juga
  { name: 'Twitch', probe: false, url: (u) => `https://www.twitch.tv/${u}` },
  { name: 'Instagram', probe: false, url: (u) => `https://www.instagram.com/${u}/` },
  { name: 'X (Twitter)', probe: false, url: (u) => `https://x.com/${u}` },
  { name: 'Facebook', probe: false, url: (u) => `https://www.facebook.com/${u}` }
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
      headers: { 'User-Agent': UA, Accept: p.json ? 'application/json' : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' }
    });
    if (r.status === 404) return { state: 'notfound', url };
    if (!r.ok) return { state: 'check', url };
    if (p.negative) {
      const body = (await r.text()).slice(0, 4000);
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
      ? probe(p, u).then((r) => ({ platform: p.name, state: r.state, url: r.url }))
      : Promise.resolve({ platform: p.name, state: 'check', url: p.url(u) }))
  ));
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(u, { at: Date.now(), results });
  return { username: u, results };
}

module.exports = { lookup, normalizeUsername, PLATFORMS };
