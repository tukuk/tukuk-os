'use strict';
// Ujian unit untuk helper tulen di src/util.js — tiada network, tiada fail I/O.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const u = require('../src/util');

test('isPrivateAddress: kenali alamat dalaman & luaran', () => {
  assert.equal(u.isPrivateAddress('127.0.0.1'), true);
  assert.equal(u.isPrivateAddress('10.1.2.3'), true);
  assert.equal(u.isPrivateAddress('192.168.8.100'), true);
  assert.equal(u.isPrivateAddress('172.16.0.5'), true);
  assert.equal(u.isPrivateAddress('::1'), true);
  assert.equal(u.isPrivateAddress('fe80::1'), true);
  assert.equal(u.isPrivateAddress('8.8.8.8'), false);
  assert.equal(u.isPrivateAddress('1.1.1.1'), false);
  // Input bukan IP → dianggap private (jimat-SSRF)
  assert.equal(u.isPrivateAddress('not-an-ip'), true);
});

test('normalizeUrl: buang hash, tracking params, slash akhir; sort query', () => {
  const a = u.normalizeUrl('https://example.com/Path/?b=2&a=1&utm_source=x#frag');
  assert.equal(a, 'https://example.com/Path?a=1&b=2');
  const b = u.normalizeUrl('https://example.com/post/');
  assert.equal(b, 'https://example.com/post');
});

test('sameSite: bandingkan host tanpa www', () => {
  assert.equal(u.sameSite('https://tukuk.org/x', 'https://tukuk.org/y'), true);
  assert.equal(u.sameSite('https://www.tukuk.org/x', 'https://tukuk.org/y'), true);
  assert.equal(u.sameSite('https://tukuk.org/x', 'https://example.com/y'), false);
  assert.equal(u.sameSite('garbage', 'https://tukuk.org'), false);
});

test('documentId & contentHash: stabil untuk input sama', () => {
  assert.equal(u.documentId('https://x.com/a/'), u.documentId('https://x.com/a'));
  const h1 = u.contentHash('hello');
  const h2 = u.contentHash('hello');
  assert.equal(h1, h2);
  assert.equal(h1.length, 40); // sha1 hex
});

test('truncate: potong di sempadan kata, tambah elipsis', () => {
  assert.equal(u.truncate('abc', 10), 'abc');
  const t = u.truncate('the quick brown fox jumps', 12);
  assert.ok(t.endsWith('…'));
  assert.ok(t.length <= 13);
});

test('decodeEntities: entity asas & numerikal', () => {
  assert.equal(u.decodeEntities('a &amp; b'), 'a & b');
  assert.equal(u.decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(u.decodeEntities('&#65;&#66;'), 'AB');
  assert.equal(u.decodeEntities('x&nbsp;y'), 'x y');
});

test('escapeHtml: netralisasikan watak berbahaya untuk HTML', () => {
  assert.equal(u.escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(u.escapeHtml(`a "b" 'c'`), 'a &quot;b&quot; &#39;c&#39;');
  assert.equal(u.escapeHtml(null), '');
});

test('safeError: sertakan status bila ada', () => {
  assert.deepEqual(u.safeError(new Error('boom')), { message: 'boom' });
  assert.deepEqual(u.safeError(Object.assign(new Error('x'), { statusCode: 404 })), { message: 'x', status: 404 });
  assert.equal(typeof u.safeError(undefined), 'string');
});

test('assertPublicUrl: tolak protokol bukan-http, IP dalaman, localhost', async () => {
  await assert.rejects(() => u.assertPublicUrl('ftp://example.com/x'), /protokol/);
  await assert.rejects(() => u.assertPublicUrl('http://127.0.0.1/'), /dalaman/);
  await assert.rejects(() => u.assertPublicUrl('http://localhost/'), /dalaman/);
  // IP awam literal → lulus tanpa DNS lookup
  const url = await u.assertPublicUrl('http://8.8.8.8/x');
  assert.equal(url.hostname, '8.8.8.8');
});
