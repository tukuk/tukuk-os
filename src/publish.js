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
function publishCspFor(host, proto) {
  const scheme = (proto === 'https') ? 'https' : 'http';
  const extra = host ? ` connect-src ${scheme}://${host};` : '';
  return PUBLISH_CSP + extra;
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
function extractTitle(html, fallback = 'Aplikasi') {
  const m = String(html || '').match(/<title[^>]*>([^<]*)<\/title>/i);
  const t = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return (t || fallback).slice(0, 80);
}

module.exports = { SLUG_RE, slugify, isSlug, publicOrigin, PUBLISH_CSP, PUBLISH_MAX_BYTES, looksLikeHtml, isEditKey, extractTitle, publishCspFor };
