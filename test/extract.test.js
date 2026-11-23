'use strict';
// Unit tests for src/extract.js — a real HTML parser (no network; cheerio + utils).
const { test } = require('node:test');
const assert = require('node:assert');

const { extract } = require('../src/extract');

const BASE = 'https://site.example/post/1';
const HTML = `<!doctype html><html lang="en"><head>
<title>Test &amp; Title</title>
<meta name="description" content="A fairly long description used for testing purposes.">
<meta property="og:image" content="/img/cover.png">
<link rel="canonical" href="https://site.example/post/1">
</head><body>
<nav>navigation menu</nav>
<main>
  <h1>  main heading  </h1>
  <h2>Section One</h2>
  <p>This paragraph carries more than thirty characters so it counts as the main content.</p>
  <p>Short.</p>
  <a href="/post/2">same-site link</a>
  <a href="https://other.example/x">external link</a>
</main>
<footer>page footer</footer>
<script>var secret = 1;</script>
</body></html>`;

test('extract: title + entity decoding + lang', () => {
  const r = extract(HTML, BASE);
  assert.strictEqual(r.title, 'Test & Title');
  assert.strictEqual(r.lang, 'en');
});

test('extract: siteName/host/path/depth from the URL', () => {
  const r = extract(HTML, BASE);
  assert.strictEqual(r.siteName, 'site.example');
  assert.strictEqual(r.host, 'site.example');
  assert.strictEqual(r.path, '/post/1');
  assert.strictEqual(r.depth, 2);
  assert.deepStrictEqual(r.pathSegments, ['post', '1']);
});

test('extract: meta → canonical and an absolute image url', () => {
  const r = extract(HTML, BASE);
  assert.strictEqual(r.canonical, 'https://site.example/post/1');
  assert.strictEqual(r.image, 'https://site.example/img/cover.png');
});

test('extract: links are same-site only (external domains are dropped)', () => {
  const r = extract(HTML, BASE);
  assert.ok(r.links.includes('https://site.example/post/2'));
  assert.ok(!r.links.some((l) => l.includes('other.example')));
});

test('extract: heading order + normalised text', () => {
  const r = extract(HTML, BASE);
  assert.ok(r.headings.includes('main heading'));
  assert.ok(r.headings.includes('Section One'));
});

test('extract: content drops boilerplate, paragraphs <30 characters and scripts', () => {
  const r = extract(HTML, BASE);
  assert.ok(r.content.includes('counts as the main content'));
  assert.ok(!r.content.includes('Short.'));            // far too short (<30)
  assert.ok(!r.content.includes('navigation'));       // the <nav> boilerplate
  assert.ok(!r.content.includes('page footer'));     // the <footer>
  assert.ok(!r.content.includes('secret'));          // the <script>
});

test('extract: a summary from the meta description, a full schema', () => {
  const r = extract(HTML, BASE);
  assert.ok(r.description.includes('description'));
  assert.strictEqual(r.type, 'article');
  assert.strictEqual(typeof r.quality, 'number');
  assert.ok(r.quality >= 0 && r.quality <= 100);
  assert.ok(r.wordCount >= 1);
});

test('extract: fallback — no <title> uses finalUrl, no canonical uses finalUrl', () => {
  const r = extract('<body><p>x</p></body>', BASE);
  assert.strictEqual(r.title, BASE);
  assert.strictEqual(r.canonical, BASE);
  assert.strictEqual(r.image, '');
});
