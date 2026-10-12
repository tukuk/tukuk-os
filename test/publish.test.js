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

test('PUBLISH_MAX_BYTES: berada di bawah had body JSON pelayan (2MB)', () => {
  assert.ok(publish.PUBLISH_MAX_BYTES > 0 && publish.PUBLISH_MAX_BYTES <= 2 * 1024 * 1024);
});
