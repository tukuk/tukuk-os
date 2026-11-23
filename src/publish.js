'use strict';
// /builder publishing helpers: one-click publish a stand-alone HTML app to a public link
// (/a/<slug>). Everything here is PURE (no I/O) so it can be unit-tested without
// booting the server. server.js uses this module and owns the disk read/write.
//
// SECURITY: published pages are SERVED IN A SANDBOX (opaque origin). `sandbox` WITHOUT
// `allow-same-origin` means the document cannot read cookies/localStorage or fetch
// tukuk.org sources — user content is separated from the main domain (anti-XSS /
// cross-origin phishing). `allow-scripts` is kept so games/interactions inside the app run.

// Slug: lowercase letters/digits/hyphens only, 3–40 chars, must start with a letter/digit.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

// `slugify` — human name → safe slug root (strip unicode/spaces, use hyphens).
function slugify(name, fallback = 'app') {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // drop diacritics after normalisation
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || fallback;
}

function isSlug(s) {
  return SLUG_RE.test(String(s || ''));
}

// Public origin used to build publish URLs — honour proxy headers (Cloudflare → http at the server).
function publicOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] === 'https' || req.secure) ? 'https' : (req.protocol || 'http');
  const host = req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

// CSP for published documents: opaque-origin sandbox + inline scripts/styles (self-contained
// app) + img/media data/https. connect-src & frame-ancestors 'none' (default-src
// 'none') block exfiltration & embedding. NO allow-same-origin = origin isolation.
const PUBLISH_CSP = [
  'sandbox allow-scripts allow-forms allow-popups allow-modals',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob: https:',
  'media-src data: blob: https:',
  'font-src data:',
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ') + ';';

// Size cap for published documents (bytes). The server JSON body on the /api/publish
// route is capped at 6MB (custom parser); this caps the HTML itself — 4MB is enough for
// a single 3D HTML file (Three.js via CDN + base64 assets) while staying safe at the edge.
const PUBLISH_MAX_BYTES = 4 * 1024 * 1024;

// Published CSP + `connect-src` SET TO the host serving the page only —
// letting the sandboxed app read the leaderboard (/api/scores) and submit scores
// from the same origin. opaque-origin (no allow-same-origin) = cookies are NOT sent,
// so only public endpoints are reachable; no route out to external hosts (exfiltration stays closed).
// `embed` (/a/<slug>?embed=1 page): frame-ancestors flips 'none' → 'self' so our own
// /play player can embed the game; external sites REMAIN blocked (cross-origin anti-clickjacking
// is unchanged — 'self' only allows documents inside the same host).
function publishCspFor(host, proto, embed) {
  const scheme = (proto === 'https') ? 'https' : 'http';
  const extra = host ? ` connect-src ${scheme}://${host};` : '';
  const csp = embed ? PUBLISH_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : PUBLISH_CSP;
  return csp + extra;
}

// Early HTML eligibility check: must be a full HTML document and within the size cap.
function looksLikeHtml(html) {
  return /^\s*<!doctype\s+html/i.test(html) || /^\s*<html[\s>]/i.test(html);
}

// Edit key: random 32 hex-character token (proof of ownership for re-publishing).
const EDIT_KEY_RE = /^[0-9a-f]{32}$/i;
function isEditKey(k) {
  return EDIT_KEY_RE.test(String(k || ''));
}

// `extractTitle` — read the HTML document's <title> for public listings (light sanitisation).
function extractTitle(html, fallback = 'App') {
  const m = String(html || '').match(/<title[^>]*>([^<]*)<\/title>/i);
  const t = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return (t || fallback).slice(0, 80);
}

// ── Community comment board (published apps). PURE helpers — sanitise input + inject
//    the comment UI into the /a/<slug> page. server.js owns the I/O (read/write comments.json).
//    The injected UI is an inline script that fetches the same host (/api/comments) — allowed by
//    PUBLISH_CSP (script-src 'unsafe-inline') + publishCspFor (connect-src host).
function cmtSlug(s) { const x = String(s || ''); return isSlug(x) ? x : ''; }
function cmtName(n) { return String(n || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 20) || 'Anon'; }
function cmtText(t) { return String(t || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300); }

// Stand-alone comment block (English UI) — the list plus the form. The SLUG is embedded
// as a literal (the server passes it through cmtSlug before the call; it is sanitised here too).
function commentsWidget(slug) {
  const s = String(slug).replace(/[^a-z0-9-]/g, '');
  return '<section id="tukuk-comments" style="max-width:640px;margin:28px auto 8px;padding:16px 18px;font-family:system-ui,sans-serif;border-top:1px solid rgba(128,128,128,.28)">'
    + '<h3 style="margin:0 0 10px;font-size:15px">\ud83d\udcac Comments</h3>'
    + '<div id="tc-list" style="font-size:14px;line-height:1.5"></div>'
    + '<form id="tc-form" style="margin-top:12px;display:flex;flex-direction:column;gap:6px">'
    + '<input id="tc-n" maxlength="20" placeholder="Name (optional)" style="padding:7px 9px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:transparent;color:inherit;font:inherit">'
    + '<textarea id="tc-c" maxlength="300" rows="2" required placeholder="Write a comment\u2026" style="padding:7px 9px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:transparent;color:inherit;font:inherit;resize:vertical"></textarea>'
    + '<button type="submit" style="align-self:flex-start;padding:7px 14px;border:0;border-radius:8px;background:#4c8dff;color:#fff;font:inherit;cursor:pointer">Send</button>'
    + '</form></section>'
    + '<script>(function(){var SLUG="' + s + '";var box=document.getElementById("tc-list");'
    + 'function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}'
    + 'function ago(t){var d=(Date.now()-t)/1000;if(d<60)return"just now";if(d<3600)return Math.floor(d/60)+"m ago";if(d<86400)return Math.floor(d/3600)+"h ago";return Math.floor(d/86400)+"d ago";}'
    + 'function load(){fetch("/api/comments?slug="+encodeURIComponent(SLUG)+"&limit=30",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){var it=(d&&d.items)||[];if(!it.length){box.innerHTML="<div style=\'opacity:.6\'>No comments yet. Be the first \u270d\ufe0f</div>";return;}box.innerHTML=it.map(function(x){return "<div style=\'padding:7px 0;border-bottom:1px solid rgba(128,128,128,.15)\'><b>"+esc(x.n)+"</b> <span style=\'opacity:.55;font-size:12px\'>"+ago(x.t||0)+"</span><div>"+esc(x.c)+"</div></div>";}).join("");}).catch(function(){box.innerHTML="<div style=\'opacity:.6\'>Failed to load comments.</div>";});}'
    + 'document.getElementById("tc-form").addEventListener("submit",function(e){e.preventDefault();var c=document.getElementById("tc-c");var tx=(c.value||"").trim();if(tx.length<2)return;var btn=this.querySelector("button");btn.disabled=true;btn.textContent="\u23f3";fetch("/api/comments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:SLUG,name:document.getElementById("tc-n").value,text:tx})}).then(function(r){return r.json();}).then(function(d){if(d&&d.ok){c.value="";load();}else{alert((d&&d.error)||"Failed");}}).catch(function(){alert("Send failed \u2014 try again.");}).then(function(){btn.disabled=false;btn.textContent="Send";});});'
    + 'load();})();</' + 'script>';
}

// Insert the comment widget before the last </body>; if there is no </body>, append at the end.
function injectComments(html, slug) {
  const widget = commentsWidget(slug);
  const i = String(html).lastIndexOf('</body>');
  if (i === -1) return String(html) + widget;
  return String(html).slice(0, i) + widget + String(html).slice(i);
}

// Insert an HTML block before the last </body>; if there is no </body>, append at the end.
function insertBeforeBody(html, block) {
  const i = String(html).lastIndexOf('</body>');
  if (i === -1) return String(html) + block;
  return String(html).slice(0, i) + block + String(html).slice(i);
}

// ── GLOBAL leaderboard widget for the stateless Arcade pages (/games/<key>). ──────
//    PURE: only builds strings (style + inline script). Games report scores by
//    calling window.__tkScore(n) (always present; no-op when the widget is missing → offline-safe).
//    This widget also loads and renders the top-5 from /api/scores. Fetching the
//    same-host route is allowed by publishCspFor(connect-src). The publish sandbox
//    already has allow-modals (prompt OK) + allow-scripts.
function arcadeWidget(key) {
  const g = String(key || '').replace(/[^a-z0-9_-]/gi, '');
  const css = '<style>#tk-lb{position:fixed;left:8px;bottom:8px;width:196px;max-width:46vw;font:12px/1.45 system-ui,sans-serif;'
    + 'background:rgba(18,22,30,.92);color:#e6e9ef;border:1px solid rgba(128,128,128,.4);border-radius:10px;padding:8px 11px;z-index:2147483000}'
    + '#tk-lb h4{margin:0 0 5px;font-size:12px}#tk-lb ol{margin:0;padding-left:18px}#tk-lb li{margin:1px 0}'
    + '#tk-lb .mine{color:#4c8dff;font-weight:700}#tk-lb .sub{opacity:.55;font-size:10px}</style>';
  const js = '<script>(function(){var G="' + g + '",s=0,peaked=0,box,name="";'
    + 'function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}'
    // The name is asked for ONCE, and only when the player really tries to submit a
    // score (not on load) — avoids a blocking modal + bad UX; no localStorage (opaque origin).
    + 'function askName(){if(name)return name;var n="";try{n=prompt("Name for the global leaderboard?","")||"";}catch(e){n="";}n=String(n).trim().slice(0,20);name=n||"Anon";return name;}'
    + 'function load(){fetch("/api/scores?g="+encodeURIComponent(G)+"&limit=5",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){var it=(d&&d.items)||[],me=name.toLowerCase();'
    + 'var h="<h4>\ud83c\udf0d Global Top</h4><div class=\\"sub\\">"+esc(G)+"</div>";'
    + 'h+=it.length?"<ol>"+it.map(function(x){var m=(String(x.n).toLowerCase()===me);return "<li>"+(m?"\u2605 ":"")+esc(x.n)+" \u2014 "+(x.s|0)+"</li>";}).join("")+"</ol>":"<div style=\'opacity:.6\'>No scores yet. Be the first!</div>";'
    + 'box.innerHTML=h;}).catch(function(){box.innerHTML="<div style=\'opacity:.6\'>The leaderboard is offline.</div>";});}'
    + 'function post(sc){var n=askName();fetch("/api/score?g="+encodeURIComponent(G)+"&n="+encodeURIComponent(n)+"&s="+sc,{cache:"no-store",keepalive:true}).then(load).catch(function(){});}'
    + 'window.__tkScore=function(v){v=parseInt(v,10)||0;if(v>s)s=v;if(s>peaked){peaked=s;post(s);}};'
    + 'function boot(){box=document.createElement("div");box.id="tk-lb";document.body.appendChild(box);load();}'
    + 'if(document.readyState!=="loading")boot();else document.addEventListener("DOMContentLoaded",boot);'
    + '})();</' + 'script>';
  return css + js;
}

// Serve the Arcade template in direct-play mode: drop the /store link (swap it back to
// /games) + inject the score widget (games only). PURE so it can be unit-tested.
function injectArcade(html, key, showScore) {
  let out = String(html || '');
  out = out.replace(/href="\/store"/gi, 'href="/games"');
  if (showScore) out = insertBeforeBody(out, arcadeWidget(key));
  return out;
}

// ── Game genres (web-games.io style). PURE helpers so they can be unit-tested without
//    booting the server. server.js uses these functions to build /api/store.
//    Internal values keep Malay keys (matching existing data); public display = GENRE_UI.
const GAME_GENRES = new Set(['arkad', 'teki-teki', 'refleks', 'kuiz', 'tindakan', 'penembakan', 'santai', 'kereta', 'sukan', 'klik', 'io', 'board', 'cards', '3d']);
const GENRE_SYNONYM = { arkade: 'arkad', arcade: 'arkad', action: 'tindakan', shooter: 'penembakan', puzzle: 'teki-teki', reflex: 'refleks', casual: 'santai', racing: 'kereta', car: 'kereta', sport: 'sukan', clicker: 'klik', quiz: 'kuiz', board: 'board', card: 'cards', cards: 'cards', threejs: '3d', '3d': '3d', '3d-game': '3d' };
// Display labels for internal (Malay-keyed) genres — user-facing surfaces are English.
const GENRE_UI = { arkad: 'Arcade', 'teki-teki': 'Puzzle', refleks: 'Reflex', kuiz: 'Quiz', tindakan: 'Action', penembakan: 'Shooter', santai: 'Casual', kereta: 'Racing', sukan: 'Sports', klik: 'Clicker', io: 'IO', board: 'Board', cards: 'Cards', '3d': '3D' };
function normalizeGenre(g) {
  const s = String(g || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (GAME_GENRES.has(s)) return s;
  return GAME_GENRES.has(GENRE_SYNONYM[s]) ? GENRE_SYNONYM[s] : null;
}
// Keyword-based genre guess (community / satu kata) — defaults to 'arkad' so every
// game always has a genre (no card gets lost from the chip filter).
function guessGameGenre(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  // 3D first — WebGL/Three.js/open-world are the most specific signals.
  if (/(\b3d\b|three\.?js|babylon|webgl|voxel|first[- ]person|dunia bukaan|open[- ]world)/.test(t)) return '3d';
  if (/\.io\b|\bio\b/.test(t)) return 'io';
  if (/(kereta|\bcar\b|racing|lumba|drift)/.test(t)) return 'kereta';
  if (/(sukan|footbal|bola|basket|sokker)/.test(t)) return 'sukan';
  if (/(klik|clicker|idle)/.test(t)) return 'klik';
  if (/(penembak|tembak|shooter|shooting|\bfps\b)/.test(t)) return 'penembakan';
  if (/(tindakan|action|battle|royale|\brpg\b)/.test(t)) return 'tindakan';
  if (/(kuiz|quiz|trivia)/.test(t)) return 'kuiz';
  if (/(refleks|reflex|reaksi|tikus|\bmola\b)/.test(t)) return 'refleks';
  if (/(teki|puzzle|memori|2048|sudoku|jigsaw|ambang|rambau|blok|jajar)/.test(t)) return 'teki-teki';
  if (/(santai|casual|lari|runner)/.test(t)) return 'santai';
  return 'arkad';
}

module.exports = { SLUG_RE, slugify, isSlug, publicOrigin, PUBLISH_CSP, PUBLISH_MAX_BYTES, looksLikeHtml, isEditKey, extractTitle, publishCspFor, cmtSlug, cmtName, cmtText, commentsWidget, injectComments, insertBeforeBody, arcadeWidget, injectArcade, GAME_GENRES, GENRE_SYNONYM, GENRE_UI, normalizeGenre, guessGameGenre };
