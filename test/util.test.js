'use strict';
// Unit tests for the real helpers in src/util.js — no network, no file I/O.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const u = require('../src/util');

test('isPrivateAddress: recognises internal & external addresses', () => {
  assert.equal(u.isPrivateAddress('127.0.0.1'), true);
  assert.equal(u.isPrivateAddress('10.1.2.3'), true);
  assert.equal(u.isPrivateAddress('192.168.8.100'), true);
  assert.equal(u.isPrivateAddress('172.16.0.5'), true);
  assert.equal(u.isPrivateAddress('::1'), true);
  assert.equal(u.isPrivateAddress('fe80::1'), true);
  assert.equal(u.isPrivateAddress('8.8.8.8'), false);
  assert.equal(u.isPrivateAddress('1.1.1.1'), false);
  // Non-IP input → treated as private (SSRF-safe)
  assert.equal(u.isPrivateAddress('not-an-ip'), true);
});

test('normalizeUrl: drops the hash, tracking params and a trailing slash; sorts the query', () => {
  const a = u.normalizeUrl('https://example.com/Path/?b=2&a=1&utm_source=x#frag');
  assert.equal(a, 'https://example.com/Path?a=1&b=2');
  const b = u.normalizeUrl('https://example.com/post/');
  assert.equal(b, 'https://example.com/post');
});

test('sameSite: compares hosts ignoring www', () => {
  assert.equal(u.sameSite('https://tukuk.org/x', 'https://tukuk.org/y'), true);
  assert.equal(u.sameSite('https://www.tukuk.org/x', 'https://tukuk.org/y'), true);
  assert.equal(u.sameSite('https://tukuk.org/x', 'https://example.com/y'), false);
  assert.equal(u.sameSite('garbage', 'https://tukuk.org'), false);
});

test('documentId & contentHash: stable for the same input', () => {
  assert.equal(u.documentId('https://x.com/a/'), u.documentId('https://x.com/a'));
  const h1 = u.contentHash('hello');
  const h2 = u.contentHash('hello');
  assert.equal(h1, h2);
  assert.equal(h1.length, 40); // sha1 hex
});

test('truncate: cuts at a word boundary and adds an ellipsis', () => {
  assert.equal(u.truncate('abc', 10), 'abc');
  const t = u.truncate('the quick brown fox jumps', 12);
  assert.ok(t.endsWith('…'));
  assert.ok(t.length <= 13);
});

test('decodeEntities: basic & numeric entities', () => {
  assert.equal(u.decodeEntities('a &amp; b'), 'a & b');
  assert.equal(u.decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(u.decodeEntities('&#65;&#66;'), 'AB');
  assert.equal(u.decodeEntities('x&nbsp;y'), 'x y');
});

test('escapeHtml: neutralises characters that are dangerous in HTML', () => {
  assert.equal(u.escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(u.escapeHtml(`a "b" 'c'`), 'a &quot;b&quot; &#39;c&#39;');
  assert.equal(u.escapeHtml(null), '');
});

test('safeError: includes the status when there is one', () => {
  assert.deepEqual(u.safeError(new Error('boom')), { message: 'boom' });
  assert.deepEqual(u.safeError(Object.assign(new Error('x'), { statusCode: 404 })), { message: 'x', status: 404 });
  assert.equal(typeof u.safeError(undefined), 'string');
});

test('assertPublicUrl: rejects non-http protocols, internal IPs and localhost', async () => {
  await assert.rejects(() => u.assertPublicUrl('ftp://example.com/x'), /protocol/);
  await assert.rejects(() => u.assertPublicUrl('http://127.0.0.1/'), /Internal/);
  await assert.rejects(() => u.assertPublicUrl('http://localhost/'), /Internal/);
  // A literal public IP → passes without a DNS lookup
  const url = await u.assertPublicUrl('http://8.8.8.8/x');
  assert.equal(url.hostname, '8.8.8.8');
});
