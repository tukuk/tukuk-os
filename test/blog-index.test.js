'use strict';
// Ujian unit src/blog-index.js — postToDoc ialah pemetaan tulen (crypto + string).
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { postToDoc } = require('../src/blog-index');

const POST = {
  slug: 'ujian-panduan',
  title: 'Panduan Ujian',
  excerpt: 'Ringkasan pendek.',
  content: '## Sub Satu\nAda beberapa patah perkataan di sini untuk tujuan pengiraan kata.\n## Bahagian Dua\nTambahan teks lagi.',
  tags: ['panduan', 'ujian'],
  createdAt: '2026-01-02T00:00:00.000Z'
};

test('postToDoc: id deterministik (sha256(slug) prefix 16) & idempotent', () => {
  const expected = crypto.createHash('sha256').update(POST.slug).digest('hex').slice(0, 16);
  const d = postToDoc(POST);
  assert.strictEqual(d.id, expected);
  assert.strictEqual(postToDoc(POST).id, d.id); // panggil dua kali sama
});

test('postToDoc: medan tetap & URL blog terbina', () => {
  const d = postToDoc(POST);
  assert.strictEqual(d.url, 'https://tukuk.org/blog/ujian-panduan');
  assert.strictEqual(d.siteName, 'Tukuk-OS');
  assert.strictEqual(d.host, 'tukuk.org');
  assert.strictEqual(d.type, 'article');
  assert.strictEqual(d.quality, 0.95);
  assert.strictEqual(d.publishedAt, POST.createdAt);
});

test('postToDoc: ringkasan/deskripsi ikut excerpt, section=tag pertama, keywords=tags', () => {
  const d = postToDoc(POST);
  assert.strictEqual(d.summary, 'Ringkasan pendek.');
  assert.strictEqual(d.description, 'Ringkasan pendek.');
  assert.strictEqual(d.section, 'panduan');
  assert.deepStrictEqual(d.keywords, ['panduan', 'ujian']);
});

test('postToDoc: headings dari baris ## , wordCount kira teks', () => {
  const d = postToDoc(POST);
  assert.deepStrictEqual(d.headings, ['Sub Satu', 'Bahagian Dua']);
  assert.ok(d.wordCount > 0);
  assert.strictEqual(d.wordCount, POST.content.split(/\s+/).filter(Boolean).length);
});

test('postToDoc: fallback — tiada tag → keywords lalai, tiada excerpt → description potong content', () => {
  const d = postToDoc({ slug: 'x', title: 'Hello World', content: 'One two three four five six seven eight nine ten.' });
  assert.deepStrictEqual(d.keywords, ['tukuk', 'search']);
  assert.strictEqual(d.section, 'Blog');
  assert.strictEqual(d.summary, '');
  assert.ok(d.description.startsWith('One two'));
});
