'use strict';
// ── SOCIAL FINDER — OSINT akaun AWAM yang pasif & beretika ──────────────────
// Semak sama ada satu nama pengguna WUJUD di platform publik dengan memeriksa
// status HTTP halaman profil AWAM (404 = tiada) dan/atau pola badan halaman.
// Prinsip: tiada login, tiada data peribadi, hanya paparan awam yang sesiapa
// pun boleh buka. Platform bertembok login (Instagram, X, Facebook, LinkedIn)
// dipulangkan sebagai 'check' supaya pengguna semak sendiri di pautan.
// Guna untuk akauntabiliti (jejak penipu) — bukan gangguan/stalking.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minit — nama sama tak dibom berulang
const CACHE_MAX = 200;

// SIFAT platform:
//   probe       true → semak HTTP status / pola badan; false → paparkan pautan sahaja
//   url         templat URL profil AWAM (untuk dipapar/diklik pengguna)
//   probeUrl    URL berbeza untuk semakan (contoh API JSON vs HTML). Default: url.
//   jsonAccept  true → hantar Accept: application/json (API) berbanding text/html
//   apiNotFound true → sebarang 4xx API (bukan hanya 404) dianggap 'tiada akaun'
//   positive    Regex yang MESTI padan dalam badan untuk sahkan akaun wujud
//               (contoh: Telegram selalu 200; hanya profil sah punya tgme_page_title)
//   negative    Regex yang bermakna akaun TIDAK wujud (soft-404 dengan status 200)
// Susunan = keutamaan paparan: auto-detect dulu, manual-check selepas.
const PLATFORMS = [
  // ── Auto-detect: status HTTP boleh dipercayai (404 = tiada akaun) ─────────
  { name: 'GitHub',     ic: '🐙', probe: true, url: (u) => `https://github.com/${u}` },
  { name: 'GitLab',     ic: '🦊', probe: true, url: (u) => `https://gitlab.com/${u}` },
  { name: 'YouTube',    ic: '▶️', probe: true, url: (u) => `https://www.youtube.com/@${u}` },
  { name: 'npm',        ic: '📦', probe: true, url: (u) => `https://www.npmjs.com/~${u}` },
  { name: 'Mastodon',   ic: '🐘', probe: true, url: (u) => `https://mastodon.social/@${u}` },
  { name: 'Medium',     ic: '📝', probe: true, url: (u) => `https://medium.com/@${u}` },
  { name: 'Patreon',    ic: '🎗️', probe: true, url: (u) => `https://www.patreon.com/${u}` },
  { name: 'Linktree',   ic: '🌳', probe: true, url: (u) => `https://linktr.ee/${u}` },
  { name: 'Dev.to',     ic: '💻', probe: true, url: (u) => `https://dev.to/${u}` },
  // Bluesky: guna API awam — 200 = wujud, 400 ActorNotFound = tiada akaun.
  // apiNotFound: true supaya 4xx dipulangkan sebagai 'notfound', bukan 'check'.
  { name: 'Bluesky',    ic: '🦋', probe: true,
    url: (u) => `https://bsky.app/profile/${u}.bsky.social`,
    probeUrl: (u) => `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(u)}.bsky.social`,
    jsonAccept: true, apiNotFound: true },
  // Reddit: HTML diblok 403 dari pelayan/data-center.
  // old.reddit.com/user/.../about.json selalunya lulus dan beri 404 yg tepat.
  {
    name: 'Reddit', ic: '👾', probe: true,
    url: (u) => `https://www.reddit.com/user/${u}`,
    probeUrl: (u) => `https://old.reddit.com/user/${encodeURIComponent(u)}/about.json`,
    jsonAccept: true,
    // positive supaya HTML login/auth yang dipulangkan selepas redirect-follow
    // (status 200) tidak disalahreads sebagai "found". JSON akaun sah ada "kind".
    positive: /"kind"|"name"/i,
  },
  // ── Auto-detect: pola badan (status 200 tetapi isi halaman membezakan) ────
  // Telegram: sentiasa 200; hanya profil sah punya elemen tgme_page_title.
  { name: 'Telegram',   ic: '✈️', probe: true,
    url: (u) => `https://t.me/${u}`,
    positive: /tgme_page_title/i },
  { name: 'SoundCloud', ic: '🎧', probe: true,
    url: (u) => `https://soundcloud.com/${u}`,
    negative: /Sorry.{0,30}can.t find|error.404|Couldn.t find that/i },
  { name: 'TikTok',     ic: '🎵', probe: true,
    url: (u) => `https://www.tiktok.com/@${u}`,
    negative: /"user.not.found"|"statusCode":"10202"|"statusCode":"10221"|couldn.t find this account|account.does.n.t.exist/i },
  { name: 'Pinterest',  ic: '📌', probe: true,
    url: (u) => `https://www.pinterest.com/${u}/`,
    negative: /user.not.found|This page doesn.t exist|Page Not Found|We couldn.t find/i },
  { name: 'Twitch',     ic: '🎮', probe: true,
    url: (u) => `https://www.twitch.tv/${u}`,
    negative: /The page you.re looking for|isSpecialUser|channel.not.found|notFound/i },
  // ── Semakan manual: login wall / anti-bot sepenuhnya ──────────────────────
  { name: 'X',          ic: '🐦', probe: false, url: (u) => `https://x.com/${u}` },
  { name: 'Instagram',  ic: '📸', probe: false, url: (u) => `https://www.instagram.com/${u}/` },
  { name: 'Facebook',   ic: '📘', probe: false, url: (u) => `https://www.facebook.com/${u}` },
  { name: 'LinkedIn',   ic: '💼', probe: false, url: (u) => `https://www.linkedin.com/in/${u}` },
  { name: 'Snapchat',   ic: '👻', probe: false, url: (u) => `https://www.snapchat.com/add/${u}` },
];

// Nama pengguna yang sah untuk ditempel ke templat URL — huruf/nombor/. _ -,
// 2–31 karakter, bermula alfanumerik. (Mencegah sisipan laluan/kuiri jahat.)
function normalizeUsername(raw) {
  const u = String(raw || '').trim().replace(/^@+/, '');
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,30}$/.test(u) ? u : null;
}

async function probe(p, u) {
  const url = p.url(u);
  // probeUrl: URL berbeza utk semak (contoh: Reddit/Bluesky API vs HTML paparan).
  const checkUrl = p.probeUrl ? p.probeUrl(u) : url;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(checkUrl, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: p.jsonAccept
          ? 'application/json;q=0.9,*/*;q=0.1'
          : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (r.status === 404) return { state: 'notfound', url };
    // apiNotFound: true → sebarang 4xx (contoh: Bluesky ActorNotFound=400) = tiada akaun.
    if (p.apiNotFound && r.status >= 400 && r.status < 500) return { state: 'notfound', url };
    if (!r.ok) return { state: 'check', url }; // 403/rate-limit → semak manual
    // Baca badan halaman jika perlu (positive/negative pattern).
    if (p.negative || p.positive) {
      const body = (await r.text()).slice(0, 30000);
      if (p.negative && p.negative.test(body)) return { state: 'notfound', url };
      // positive: pola MESTI ada. Jika tiada → akaun tidak wujud (soft-404).
      if (p.positive && !p.positive.test(body)) return { state: 'notfound', url };
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
  // found dahulu, then notfound, then manual-check — hasil penting tak tenggelam.
  const rank = { found: 0, notfound: 1, check: 2 };
  results.sort((a, b) => rank[a.state] - rank[b.state]);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(u, { at: Date.now(), results });
  return { username: u, results };
}

module.exports = { lookup, normalizeUsername, PLATFORMS };
