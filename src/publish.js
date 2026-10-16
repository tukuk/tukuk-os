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

// Had saiz dokumen terbitan (bayt). Body JSON pelayan pagari ~2MB; ini pagari HTML.
const PUBLISH_MAX_BYTES = 1.5 * 1024 * 1024;

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

// Blok komen berdiri sendiri (bahasa MS) — senarai + borang. SLUG ditanam sebagai literal
// (dilepaskan cmtSlug di pelayan sebelum dipanggil; dipertahankan di sini juga).
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

module.exports = { SLUG_RE, slugify, isSlug, publicOrigin, PUBLISH_CSP, PUBLISH_MAX_BYTES, looksLikeHtml, isEditKey, extractTitle, publishCspFor, cmtSlug, cmtName, cmtText, commentsWidget, injectComments };
