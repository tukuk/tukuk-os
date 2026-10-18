'use strict';
// Invarian Read Aloud: widget Web Speech tanpa API (satu-satunya sumber suara),
// suntikan satu-titik lewat siteFooter untuk semua shell SSR + 9 halaman statik,
// dan tiada eval/new Function (lulus CSP ketat script-src 'self').
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const raSrc = fs.readFileSync(path.join(ROOT, 'public', 'read-aloud.js'), 'utf8');

test('read-aloud.js: Web Speech API asli, tanpa kunci/eval (CSP-safe)', () => {
  assert.ok(raSrc.includes('window.speechSynthesis'), 'guna speechSynthesis pelayar');
  assert.ok(raSrc.includes('SpeechSynthesisUtterance'), 'utterance standard W3C');
  assert.ok(!/\beval\(|new Function\(/.test(raSrc), 'tiada eval/new Function');
  assert.ok(!/https?:\/\/(?!tukuk\.org)[a-z]/i.test(raSrc.replace(/\+https:\/\/tukuk\.org/g, '')), 'tiada rangkaian luar');
  assert.ok(raSrc.includes("if (!synth || !window.SpeechSynthesisUtterance) return;"), 'ciri-ciri disemak dulu');
  assert.ok(raSrc.includes('armKeepAlive'), 'workaround Chrome berhenti queue panjang');
  assert.ok(raSrc.includes("'ms'") && raSrc.includes('ms-MY'), 'keutamaan suara Bahasa Melayu');
});

test('read-aloud.js: SKIP SPA/alat, hanya halaman kandungan', () => {
  assert.ok(/\/\^\?/.test('/') || raSrc.includes('location.pathname'), 'tapis ikut laluan');
  assert.ok(raSrc.includes('(os|admin|cari|apps'), 'senarai pengecualian SPA');
  assert.ok(raSrc.includes("querySelector('main')"), 'sasar kontena utama halaman');
  // Teks baca buang nav/footer/iklan supaya voice tidak baca sampah.
  assert.ok(raSrc.includes('.ad-slot'), 'slot iklan dibuang dari bacaan');
  assert.ok(raSrc.includes('nav,footer'), 'nav+footer dibuang');
});

test('server.js: siteFooter menyuntik widget pada semua shell SSR', () => {
  const footerBlock = serverSrc.slice(serverSrc.indexOf('function siteFooter()'));
  const end = footerBlock.indexOf('\n}\n');
  assert.ok(end > 0, 'blok siteFooter ditemui');
  assert.ok(footerBlock.slice(0, end).includes('<script src="/read-aloud.js" defer></script>'), 'suntikan satu-titik dalam footer');
  // 10 shell (blog/hab/nasa/cuaca/gempa/cuti/negara/wiki/post/404) pakai siteFooter → auto liput.
  const uses = (serverSrc.match(/\$\{siteFooter\(\)\}/g) || []).length;
  assert.ok(uses >= 9, `shell SSR pakai siteFooter (dapat ${uses})`);
});

test('halaman statik: 9 halaman kandungan muat read-aloud.js', () => {
  for (const f of ['index', 'about', 'docs', 'rekomendasi', 'contact', 'privacy', 'terms', 'access', 'download']) {
    const html = fs.readFileSync(path.join(ROOT, 'public', `${f}.html`), 'utf8');
    assert.ok(html.includes('<script src="/read-aloud.js" defer></script>'), `${f}.html suntik widget`);
  }
  // SPA tidak patut dapat widget langsung (selain pengecualian laluan).
  const osHtml = fs.readFileSync(path.join(ROOT, 'public', 'os.html'), 'utf8');
  assert.ok(!osHtml.includes('/read-aloud.js'), 'os.html bebas widget');
});
