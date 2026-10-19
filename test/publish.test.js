'use strict';
// Ujian pembantu terbitan (/builder → pautan awam /a/<slug>). Murni — tiada pelayan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const publish = require('../src/publish');

test('slugify: nama manusia → pangkal slug selamat', () => {
  assert.equal(publish.slugify('Halo Dunia 2!'), 'halo-dunia-2');
  assert.equal(publish.slugify('Ünïcode Akça'), 'unicode-akca');
  assert.equal(publish.slugify('   '), 'app', 'kosong → fallback');
  assert.equal(publish.slugify('###'), 'app', 'simbol sahaja → fallback');
});

test('slugify: had panjang 32 aksara', () => {
  const long = publish.slugify('a'.repeat(50));
  assert.equal(long.length, 32);
});

test('isSlug: terima format sah, tolak tak sah', () => {
  for (const ok of ['abc', 'a1-b2', 'app-9', 'my-todo-list']) assert.ok(publish.isSlug(ok), ok);
  for (const bad of ['ab', 'A-bc', '-abc', 'abc!', 'a b', 'a/b', '../../etc', '']) assert.ok(!publish.isSlug(bad), 'tolak: ' + bad);
});

test('looksLikeHtml: hanya dokumen HTML penuh diterima', () => {
  assert.ok(publish.looksLikeHtml('<!DOCTYPE html><html></html>'));
  assert.ok(publish.looksLikeHtml('<html lang="ms">'));
  assert.ok(!publish.looksLikeHtml('<div>hi</div>'), 'fragmen bukan dokumen');
  assert.ok(!publish.looksLikeHtml(''), 'kosong ditolak');
});

test('PUBLISH_CSP: sandbox opaque-origin (TIADA allow-same-origin) + skrip inline', () => {
  assert.match(publish.PUBLISH_CSP, /sandbox allow-scripts/);
  assert.ok(!publish.PUBLISH_CSP.includes('allow-same-origin'), 'mesti opaque-origin (pemisahan asal)');
  assert.match(publish.PUBLISH_CSP, /script-src 'unsafe-inline'/, 'app berdiri sendiri guna skrip inline');
  assert.match(publish.PUBLISH_CSP, /img-src data:/, 'imej dataURL dibenarkan');
});

test('publicOrigin: hormat x-forwarded-proto https + host', () => {
  const req = { headers: { 'x-forwarded-proto': 'https' }, secure: false, protocol: 'http', get: (h) => (h === 'host' ? 'tukuk.org' : '') };
  assert.equal(publish.publicOrigin(req), 'https://tukuk.org');
  const local = { headers: {}, secure: false, protocol: 'http', get: () => 'localhost:3000' };
  assert.equal(publish.publicOrigin(local), 'http://localhost:3000');
});

test('PUBLISH_MAX_BYTES: 4MB untuk fail tunggal 3D, di bawah parser khas /api/publish (6MB)', () => {
  assert.equal(publish.PUBLISH_MAX_BYTES, 4 * 1024 * 1024);
  assert.ok(publish.PUBLISH_MAX_BYTES < 6 * 1024 * 1024, 'mesti ada ruang untuk balutan JSON body');
});

test('isEditKey: terima 32 aksara hex sah, tolak lain', () => {
  assert.ok(publish.isEditKey('0'.repeat(32)));
  assert.ok(publish.isEditKey('a1b2c3d4e5f60718293a4b5c6d7e8f90'), 'hex kecil 32');
  assert.ok(publish.isEditKey('ABCDEF0123456789ABCDEF0123456789'), 'hex besar diterima');
  for (const bad of ['', 'z'.repeat(32), 'f'.repeat(31), 'f'.repeat(33), 'abc', null, undefined]) assert.ok(!publish.isEditKey(bad), 'tolak: ' + bad);
});

test('extractTitle: baca <title>, sanitasi ruang, fallback & had 80', () => {
  assert.equal(publish.extractTitle('<!DOCTYPE html><html><head><title>App Saya</title></head>'), 'App Saya');
  assert.equal(publish.extractTitle('<TITLE>  Banyak   Ruang  </TITLE>'), 'Banyak Ruang', 'case-insensitive + ruang diringkas');
  assert.equal(publish.extractTitle('<html>tiada tajuk</html>', 'Aplikasi'), 'Aplikasi', 'fallback bila tiada <title>');
  assert.equal(publish.extractTitle('<title>' + 'x'.repeat(120) + '</title>').length, 80, 'had 80 aksara');
});

test('publishCspFor: tambah connect-src host-sendiri, kekal opaque-origin (tiada allow-same-origin)', () => {
  const csp = publish.publishCspFor('tukuk.org', 'https');
  assert.match(csp, /connect-src https:\/\/tukuk\.org/, 'connect-src dipasangkan ke host https');
  assert.ok(!csp.includes('allow-same-origin'), 'mesti kekal opaque-origin');
  const http = publish.publishCspFor('192.168.8.100:3000', 'http');
  assert.match(http, /connect-src http:\/\/192\.168\.8\.100:3000/, 'skema http + port dikekalkan');
  assert.equal(publish.publishCspFor('', 'https'), publish.PUBLISH_CSP, 'tiada host → CSP asal tanpa connect-src');
});

// ── Papan komen: sanitasi MURNI + suntik UI (tiada pelayan) ──
test('cmtSlug: slug sah lulus, tak sah → kosong', () => {
  assert.equal(publish.cmtSlug('my-app-9'), 'my-app-9');
  for (const bad of ['ab', 'A-bc', '-abc', 'a b', '../../etc', '', null, undefined]) assert.equal(publish.cmtSlug(bad), '', 'tolak: ' + bad);
});

test('cmtName: buang baru baru/tab, pangkas 20, kosong → Anon', () => {
  assert.equal(publish.cmtName('Ali\nBin\tQasim'), 'Ali Bin Qasim');
  assert.equal(publish.cmtName('   ').length, 4, 'kosong → Anon');
  assert.equal(publish.cmtName('x'.repeat(50)).length, 20, 'had 20 aksara');
});

test('cmtText: buang tag HTML, ringkas ruang, pangkas 300', () => {
  assert.equal(publish.cmtText('<script>alert(1)<\/script> halo'), 'alert(1) halo', 'tag dibuang, teks kekal');
  assert.equal(publish.cmtText('a   b\n\nc'), 'a b c', 'runung ruang/baris diringkas');
  assert.ok(publish.cmtText('<b>x</b>').indexOf('<') === -1, 'tiada kurungan sudu tembus');
  assert.equal(publish.cmtText('y'.repeat(500)).length, 300, 'had 300 aksara');
});

test('commentsWidget: rujuk /api/comments + borang + SLUG ditanam selamat', () => {
  const w = publish.commentsWidget('app-1');
  assert.ok(w.includes('/api/comments'), 'skrip fetch /api/comments');
  assert.ok(w.includes('id="tc-form"'), 'borang wujud');
  assert.ok(w.includes('var SLUG="app-1"'), 'slug ditanam sebagai literal');
  assert.ok(w.includes('</' + 'script>'), 'blok skrip ditutup dengan betul');
  // Cubaan pecah keluar dari skrip → hanya alfanumerik/nego kekal, petikan & simbol dibuang.
  const evil = publish.commentsWidget('a";alert(1);//');
  assert.ok(evil.includes('var SLUG="aalert1"'), 'slug disanitasi kepada alfanumerik sahaja');
  assert.ok(!evil.includes('alert(1)'), 'ranjang kod tidak tembus sebagai teks mentah');
  assert.ok(!evil.includes('var SLUG="a"'), 'petikan penutup tidak boleh memecahkan literal');
});

test('injectComments: sisip sebelum </body> terakhir; tampal jika tiada', () => {
  const doc = '<html><body><h1>App</h1><script>var x=1;<' + '/script></body></html>';
  const out = publish.injectComments(doc, 'app-1');
  const iBody = out.lastIndexOf('</body>');
  assert.ok(out.indexOf('id="tukuk-comments"') < iBody, 'widget sebelum </body>');
  assert.ok(out.includes('<h1>App</h1>'), 'kandungan asal dikekalkan');
  assert.ok(out.includes('</html>'), 'struktur penutup kekal');
  const frag = publish.injectComments('<div>tiada body</div>', 'zz-1');
  assert.ok(frag.includes('id="tukuk-comments"'), 'tiada </body> → tampal di hujung');
});

// ── Genre game (MURNI; dipindah ke publish.js supaya boleh diuji tanpa pelayan) ──
test('guessGameGenre: 3D didahulukan (Three.js/WebGL/open-world)', () => {
  assert.equal(publish.guessGameGenre('Neon Racer 3D'), '3d');
  assert.equal(publish.guessGameGenre('built with three.js'), '3d');
  assert.equal(publish.guessGameGenre('WebGL shooter'), '3d', 'webgl → 3d walaupun ada "shooter"');
  assert.equal(publish.guessGameGenre('open world survival'), '3d');
});

test('guessGameGenre: cabang sedia ada masih berfungsi', () => {
  assert.equal(publish.guessGameGenre('2048 blok'), 'teki-teki');
  assert.equal(publish.guessGameGenre('lumba kereta drift'), 'kereta');
  assert.equal(publish.guessGameGenre('Super Mola .io'), 'io');
  assert.equal(publish.guessGameGenre('sesuatu yang tak dikenali'), 'arkad', 'fallback arkad');
});

test('normalizeGenre: sinonim + nilai 3D baharu dinormalisasi', () => {
  assert.equal(publish.normalizeGenre('3D'), '3d');
  assert.equal(publish.normalizeGenre('threejs'), '3d');
  assert.equal(publish.normalizeGenre('arcade'), 'arkad');
  assert.equal(publish.normalizeGenre('puzzle'), 'teki-teki');
  assert.equal(publish.normalizeGenre('tiada-genre-begini'), null, 'tak diketahui → null');
});

test('GENRE_UI: label paparan 3D = "3D" (permukaan awam bahasa Inggeris)', () => {
  assert.equal(publish.GENRE_UI['3d'], '3D');
});

// ── Arked stateless (/games): widget skor + suntikan (MURNI, tiada pelayan) ──
test('arcadeWidget: ada <style> + skrip inline yang lapor /api/score & baca /api/scores + __tkScore', () => {
  const w = publish.arcadeWidget('fps3d');
  assert.ok(w.includes('<style>'), 'gaya panel disertakan');
  assert.ok(w.includes('/api/score'), 'skrip hantar skor');
  assert.ok(w.includes('/api/scores'), 'skrip baca papan skor');
  assert.ok(w.includes('window.__tkScore'), 'API laporan skor didedahkan ke game');
  assert.ok(w.includes('var G="fps3d"'), 'kunci game ditanam selamat');
  assert.ok(w.includes('</' + 'script>'), 'blok skrip ditutup dengan betul');
  // key musuh → dibuang aksara tak selamat (tiada pecah literal/closing skrip).
  const evil = publish.arcadeWidget('a";alert(1);//');
  assert.ok(evil.includes('var G="aalert1"'), 'key disanitasi kepada [a-z0-9_-] sahaja');
  assert.ok(!evil.includes('alert(1)'), 'ranjang kod tidak tembus');
});

test('arcadeWidget: JS inline yang dijana ialah JavaScript yang sah (parse check)', () => {
  const m = publish.arcadeWidget('racer3d').match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'blok skrip ditemui');
  // new Function() membungkus penguraian tanpa pelaksanaan → SyntaxError jika cacat.
  assert.doesNotThrow(() => new Function(m[1]), 'skrip widget mesti boleh diuraikan');
});

test('injectArcade: pautan /store → /games; widget skor disuntik hanya bila showScore', () => {
  const doc = '<html><body><header><a href="/store">x</a></header><script>1<\/script></body></html>';
  const on = publish.injectArcade(doc, 'soccer3d', true);
  assert.ok(on.includes('href="/games"'), 'pautan balik ke arked');
  assert.ok(!on.includes('href="/store"'), 'pautan /store lama dibuang');
  assert.ok(on.includes('window.__tkScore'), 'widget disuntik untuk game');
  assert.ok(on.lastIndexOf('__tkScore') < on.lastIndexOf('</body>'), 'widget sebelum </body>');
  const off = publish.injectArcade(doc, 'notes', false);
  assert.ok(!off.includes('__tkScore'), 'bukan game → tiada widget skor');
  assert.ok(off.includes('href="/games"'), 'pautan tetap ditulis walau tanpa widget');
});
