'use strict';
// Pembantu terbitan /builder: satu-klik terbitkan app HTML berdiri sendiri ke pautan
// awam (/a/<slug>). Fungsi di sini MURNI (tanpa I/O) supaya boleh diuji unit tanpa
// memulakan pelayan. server.js memakai modul ini + mengurus tulis/capai cakera.
//
// KESELAMATAN: halaman terbitan DILAYAN DALAM SANDBOX (opaque-origin). `sandbox` TANPA
// `allow-same-origin` bermakna dokumen tidak boleh membaca cookie/localStorage/fetch
// sumber tukuk.org — memisahkan kandungan pengguna daripada domain utama (anti-XSS/
// phishing lintas-asal). `allow-scripts` dibiarkan supaya game/interaksi dalam app jalan.

// Slug: huruf-kecil/angka/nego sahaja, 3–40 aksara, bermula huruf/angka.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

// `slugify` — nama manusia → pangkal slug selamat (buang unicode/ruang, tanda hubung).
function slugify(name, fallback = 'app') {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // buang tanda diakritik selepas normalisasi
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || fallback;
}

function isSlug(s) {
  return SLUG_RE.test(String(s || ''));
}

// Asal awam untuk bina URL terbitan — hormat kepala proksi (Cloudflare → http di pelayan).
function publicOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] === 'https' || req.secure) ? 'https' : (req.protocol || 'http');
  const host = req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

// CSP untuk dokumen terbitan: sandbox opaque-origin + skrip/gaya inline (app berdiri
// sendiri) + img/media data/https. connect-src & frame-ancestors 'none' (default-src
// 'none') menghalang exfiltrasi & embedding. TIADA allow-same-origin = pemisahan asal.
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

// Had saiz dokumen terbitan (bayt). Body JSON pelayan pada laluan /api/publish
// dipagari pada 6MB (parser khas); ini pagari HTML itu sendiri — 4MB cukup untuk
// satu fail HTML 3D (Three.js via CDN + aset base64) sambil kekal selamat di tepi.
const PUBLISH_MAX_BYTES = 4 * 1024 * 1024;

// CSP terbitan + `connect-src` DIPASANGKAN kepada host yang menyajikan halaman sahaja —
// membenarkan app dalam sandbox membaca papan pendahulu (/api/scores) & menghantar skor
// daripada origin yang sama. opaque-origin (tiada allow-same-origin) = cookie TIDAK dihantar,
// jadi hanya endpoint awam boleh diakses; tiada laluan keluar ke host luar (eksfiltrasi kekal tertutup).
// `embed` (halaman /a/<slug>?embed=1): frame-ancestors ditukar 'none' → 'self' supaya
// pemain /play kita sendiri boleh menempek game; laman luar TETAP disekat (anti-clickjacking
// silang-origin tidak berubah — 'self' hanya membenarkan dokumen dalam host yang sama).
function publishCspFor(host, proto, embed) {
  const scheme = (proto === 'https') ? 'https' : 'http';
  const extra = host ? ` connect-src ${scheme}://${host};` : '';
  const csp = embed ? PUBLISH_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : PUBLISH_CSP;
  return csp + extra;
}

// Semakan kelayakan awal HTML: mesti dokumen HTML penuh & dalam had saiz.
function looksLikeHtml(html) {
  return /^\s*<!doctype\s+html/i.test(html) || /^\s*<html[\s>]/i.test(html);
}

// Kunci edit: token acak 32 aksara hex (bukti pemilikan untuk terbit semula).
const EDIT_KEY_RE = /^[0-9a-f]{32}$/i;
function isEditKey(k) {
  return EDIT_KEY_RE.test(String(k || ''));
}

// `extractTitle` — baca <title> dokumen HTML untuk senarai awam (sanitasi ringan).
function extractTitle(html, fallback = 'App') {
  const m = String(html || '').match(/<title[^>]*>([^<]*)<\/title>/i);
  const t = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return (t || fallback).slice(0, 80);
}

// ── Papan komen komuniti (app terbitan). Pembantu MURNI — sanitasi input + suntik
//    UI komen ke halaman /a/<slug>. server.js mengurus I/O (baca/tulis comments.json).
//    UI disuntik ialah skrip inline yang fetch host-sendiri (/api/comments) — dibenarkan
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

// Sisip widget komen sebelum </body> terakhir; jika tiada </body>, tampal di hujung.
function injectComments(html, slug) {
  const widget = commentsWidget(slug);
  const i = String(html).lastIndexOf('</body>');
  if (i === -1) return String(html) + widget;
  return String(html).slice(0, i) + widget + String(html).slice(i);
}

// Sisip blok HTML sebelum </body> terakhir; jika tiada </body>, tampal di hujung.
function insertBeforeBody(html, block) {
  const i = String(html).lastIndexOf('</body>');
  if (i === -1) return String(html) + block;
  return String(html).slice(0, i) + block + String(html).slice(i);
}

// ── Widget papan skor GLOBAL untuk halaman Arked stateless (/games/<key>). ──────
//    MURNI: hanya bina string (style + inline script). Game melapor skor dengan
//    memanggil window.__tkScore(n) (sedia ada; no-op jika widget tiada → offline-safe).
//    Widget ini juga memuat & memaparkan top-5 daripada /api/scores. Fetch ke
//    laluan host-sendiri dibenarkan oleh publishCspFor(connect-src). sandbox
//    publish sudah ada allow-modals (prompt OK) + allow-scripts.
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

// Hidang templat Arked dalam mod main-terus: buang pautan /store (ganti balik ke
// /games) + suntik widget skor (hanya untuk game). MURNI supaya boleh diuji unit.
function injectArcade(html, key, showScore) {
  let out = String(html || '');
  out = out.replace(/href="\/store"/gi, 'href="/games"');
  if (showScore) out = insertBeforeBody(out, arcadeWidget(key));
  return out;
}

// ── Genre game (gaya web-games.io). Pembantu MURNI supaya boleh diuji unit tanpa
//    memulakan pelayan. server.js mengambil fungsi ini untuk membina /api/store.
//    Nilai dalaman berkunci Melayu (padan data sedia ada); paparan awam = GENRE_UI.
const GAME_GENRES = new Set(['arkad', 'teki-teki', 'refleks', 'kuiz', 'tindakan', 'penembakan', 'santai', 'kereta', 'sukan', 'klik', 'io', 'board', 'cards', '3d']);
const GENRE_SYNONYM = { arkade: 'arkad', arcade: 'arkad', action: 'tindakan', shooter: 'penembakan', puzzle: 'teki-teki', reflex: 'refleks', casual: 'santai', racing: 'kereta', car: 'kereta', sport: 'sukan', clicker: 'klik', quiz: 'kuiz', board: 'board', card: 'cards', cards: 'cards', threejs: '3d', '3d': '3d', '3d-game': '3d' };
// Display labels for internal (Malay-keyed) genres — user-facing surfaces are English.
const GENRE_UI = { arkad: 'Arcade', 'teki-teki': 'Puzzle', refleks: 'Reflex', kuiz: 'Quiz', tindakan: 'Action', penembakan: 'Shooter', santai: 'Casual', kereta: 'Racing', sukan: 'Sports', klik: 'Clicker', io: 'IO', board: 'Board', cards: 'Cards', '3d': '3D' };
function normalizeGenre(g) {
  const s = String(g || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (GAME_GENRES.has(s)) return s;
  return GAME_GENRES.has(GENRE_SYNONYM[s]) ? GENRE_SYNONYM[s] : null;
}
// Tebakan genre berasaskan kata kunci (komuniti / satu kata) — default 'arkad' supaya
// setiap game pasti ada genre (tiada kad tersesat dari penapis chip).
function guessGameGenre(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  // 3D dahulu — WebGL/Three.js/open-world ialah isyarat paling spesifik.
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
