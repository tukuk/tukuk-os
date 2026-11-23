'use strict';
// ── SOCIAL FINDER — passive & ethical OSINT on PUBLIC accounts ────────────────
// Check whether a username EXISTS on a public platform by looking at the HTTP status
// of the PUBLIC profile page (404 = absent) and/or the page body pattern.
// Principle: no login, no personal data, only public pages anyone
// can open. Login-walled platforms (Instagram, X, Facebook, LinkedIn)
// are returned as 'check' so the user verifies the link themselves.
// Use for accountability (tracking scammers) — not harassment/stalking.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — the same name isn't re-probed in a burst
const CACHE_MAX = 200;

// PLATFORM PROPERTIES:
//   probe       true → check HTTP status / body pattern; false → show the link only
//   url         PUBLIC profile URL template (for the user to view/click)
//   probeUrl    A different URL used for the check (e.g. JSON API vs HTML). Defaults to: url.
//   jsonAccept  true → send Accept: application/json (API) instead of text/html
//   apiNotFound true → any API 4xx (not just 404) counts as 'no account'
//   positive    Regex that MUST match in the body to confirm the account exists
//               (e.g. Telegram always returns 200; only real profiles have tgme_page_title)
//   negative    Regex meaning the account does NOT exist (soft-404 with a 200 status)
// Order = display priority: auto-detect first, manual-check afterwards.
const PLATFORMS = [
  // ── Auto-detect: trustworthy HTTP status (404 = no account) ─────────────────
  { name: 'GitHub',     ic: '🐙', probe: true, url: (u) => `https://github.com/${u}` },
  { name: 'GitLab',     ic: '🦊', probe: true, url: (u) => `https://gitlab.com/${u}` },
  { name: 'YouTube',    ic: '▶️', probe: true, url: (u) => `https://www.youtube.com/@${u}` },
  { name: 'npm',        ic: '📦', probe: true, url: (u) => `https://www.npmjs.com/~${u}` },
  { name: 'Mastodon',   ic: '🐘', probe: true, url: (u) => `https://mastodon.social/@${u}` },
  // Medium: a server-side Node.js fetch always gets 200 + the real page.
  // Real profile → og:title filled ("name – Medium"); fake name → og:title content="".
  // negative: if some requests hit a Cloudflare challenge, drop the false-found.
  { name: 'Medium',     ic: '📝', probe: true, url: (u) => `https://medium.com/@${u}`,
    negative: /Just a moment\.\.\./i,
    positive: /og:title" content="[^"]+"/ },
  { name: 'Patreon',    ic: '🎗️', probe: true, url: (u) => `https://www.patreon.com/${u}` },
  { name: 'Linktree',   ic: '🌳', probe: true, url: (u) => `https://linktr.ee/${u}` },
  { name: 'Dev.to',     ic: '💻', probe: true, url: (u) => `https://dev.to/${u}` },
  // Bluesky: use the public API — 200 = exists, 400 ActorNotFound = no account.
  // apiNotFound: true so 4xx is returned as 'notfound', not 'check'.
  { name: 'Bluesky',    ic: '🦋', probe: true,
    url: (u) => `https://bsky.app/profile/${u}.bsky.social`,
    probeUrl: (u) => `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(u)}.bsky.social`,
    jsonAccept: true, apiNotFound: true },
  // Reddit: HTML is blocked with 403 from servers/data centers.
  // old.reddit.com/user/.../about.json usually passes and gives an accurate 404.
  {
    name: 'Reddit', ic: '👾', probe: true,
    url: (u) => `https://www.reddit.com/user/${u}`,
    probeUrl: (u) => `https://old.reddit.com/user/${encodeURIComponent(u)}/about.json`,
    jsonAccept: true,
    // positive so the login/auth HTML returned after redirect-following
    // (status 200) is not misread as "found". A real account JSON has "kind".
    positive: /"kind"|"name"/i,
  },
  // ── Auto-detect: body patterns (status 200 but the page content differs) ────
  // Telegram: always 200; only a real profile has the tgme_page_title element.
  { name: 'Telegram',   ic: '✈️', probe: true,
    url: (u) => `https://t.me/${u}`,
    positive: /tgme_page_title/i },
  { name: 'SoundCloud', ic: '🎧', probe: true,
    url: (u) => `https://soundcloud.com/${u}`,
    negative: /Sorry.{0,30}can.t find|error.404|Couldn.t find that/i },
  // TikTok: data-center servers get a WAF/Slardar page (1.4KB, no content)
  // for every name — status 200 but the content is indistinguishable.
  { name: 'TikTok',     ic: '🎵', probe: false, url: (u) => `https://www.tiktok.com/@${u}` },
  // Pinterest: 200 for every name. A real profile has a title
  // "Pinterest (name) - Profile | Pinterest"; a fake name → empty <title></title>.
  { name: 'Pinterest',  ic: '📌', probe: true,
    url: (u) => `https://www.pinterest.com/${u}/`,
    positive: / - Profile \| Pinterest/ },
  // Twitch: 200 for every name (SPA). Real channel: "<title>name - Twitch</title>".
  // Fake channel: just "<title>Twitch</title>" — no "- Twitch" after the name.
  { name: 'Twitch',     ic: '🎮', probe: true,
    url: (u) => `https://www.twitch.tv/${u}`,
    positive: / - Twitch<\/title>/i },
  // ── Manual check: full login wall / anti-bot ──────────────────────
  { name: 'X',          ic: '🐦', probe: false, url: (u) => `https://x.com/${u}` },
  { name: 'Instagram',  ic: '📸', probe: false, url: (u) => `https://www.instagram.com/${u}/` },
  { name: 'Facebook',   ic: '📘', probe: false, url: (u) => `https://www.facebook.com/${u}` },
  { name: 'LinkedIn',   ic: '💼', probe: false, url: (u) => `https://www.linkedin.com/in/${u}` },
  { name: 'Snapchat',   ic: '👻', probe: false, url: (u) => `https://www.snapchat.com/add/${u}` },
];

// A username safe to paste into the URL template — letters/digits/. _ -,
// 2–31 characters, starting alphanumeric. (Prevents malicious path/query injection.)
function normalizeUsername(raw) {
  const u = String(raw || '').trim().replace(/^@+/, '');
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,30}$/.test(u) ? u : null;
}

async function probe(p, u) {
  const url = p.url(u);
  // probeUrl: a different URL for the check (e.g. Reddit/Bluesky API vs the displayed HTML).
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
    // apiNotFound: true → any 4xx (e.g. Bluesky ActorNotFound=400) = no account.
    if (p.apiNotFound && r.status >= 400 && r.status < 500) return { state: 'notfound', url };
    if (!r.ok) return { state: 'check', url }; // 403/rate-limit → manual check
    // Read the page body when needed (positive/negative pattern).
    if (p.negative || p.positive) {
      const body = (await r.text()).slice(0, 30000);
      if (p.negative && p.negative.test(body)) return { state: 'notfound', url };
      // positive: the pattern MUST be present. If missing → account doesn't exist (soft-404).
      if (p.positive && !p.positive.test(body)) return { state: 'notfound', url };
    }
    return { state: 'found', url };
  } catch {
    return { state: 'check', url }; // timeout/blocked/network error → manual check
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
  // found first, then notfound, then manual-check — important results don't get buried.
  const rank = { found: 0, notfound: 1, check: 2 };
  results.sort((a, b) => rank[a.state] - rank[b.state]);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(u, { at: Date.now(), results });
  return { username: u, results };
}

module.exports = { lookup, normalizeUsername, PLATFORMS };
