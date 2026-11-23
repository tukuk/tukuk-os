'use strict';
// Unit tests for src/blog-index.js — postToDoc is pure mapping (crypto + strings).
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { postToDoc } = require('../src/blog-index');

const POST = {
  slug: 'test-guide',
  title: 'Test Guide',
  excerpt: 'A short summary.',
  content: '## Sub One\nThere are several words here for the purpose of word counting.\n## Section Two\nMore text added.',
  tags: ['guide', 'test'],
  createdAt: '2026-01-02T00:00:00.000Z'
};

test('postToDoc: a deterministic id (sha256(slug) prefix 16) & idempotent', () => {
  const expected = crypto.createHash('sha256').update(POST.slug).digest('hex').slice(0, 16);
  const d = postToDoc(POST);
  assert.strictEqual(d.id, expected);
  assert.strictEqual(postToDoc(POST).id, d.id); // called twice, same result
});

test('postToDoc: fixed fields & the blog URL are built', () => {
  const d = postToDoc(POST);
  assert.strictEqual(d.url, 'https://tukuk.org/blog/test-guide');
  assert.strictEqual(d.siteName, 'Tukuk-OS');
  assert.strictEqual(d.host, 'tukuk.org');
  assert.strictEqual(d.type, 'article');
  assert.strictEqual(d.quality, 0.95);
  assert.strictEqual(d.publishedAt, POST.createdAt);
});

test('postToDoc: summary/description follow the excerpt, section=first tag, keywords=tags', () => {
  const d = postToDoc(POST);
  assert.strictEqual(d.summary, 'A short summary.');
  assert.strictEqual(d.description, 'A short summary.');
  assert.strictEqual(d.section, 'guide');
  assert.deepStrictEqual(d.keywords, ['guide', 'test']);
});

test('postToDoc: headings come from ## lines, wordCount counts the text', () => {
  const d = postToDoc(POST);
  assert.deepStrictEqual(d.headings, ['Sub One', 'Section Two']);
  assert.ok(d.wordCount > 0);
  assert.strictEqual(d.wordCount, POST.content.split(/\s+/).filter(Boolean).length);
});

test('postToDoc: fallback — no tags → default keywords, no excerpt → description trims the content', () => {
  const d = postToDoc({ slug: 'x', title: 'Hello World', content: 'One two three four five six seven eight nine ten.' });
  assert.deepStrictEqual(d.keywords, ['tukuk', 'search']);
  assert.strictEqual(d.section, 'Blog');
  assert.strictEqual(d.summary, '');
  assert.ok(d.description.startsWith('One two'));
});
