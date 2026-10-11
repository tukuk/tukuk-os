'use strict';
// Ujian unit src/extract.js — parser HTML tulen (tiada rangkaian; cheerio + util).
const { test } = require('node:test');
const assert = require('node:assert');

const { extract } = require('../src/extract');

const BASE = 'https://situs.example/post/1';
const HTML = `<!doctype html><html lang="ms"><head>
<title>Ujian &amp; Tajuk</title>
<meta name="description" content="Ini huraan yang agak panjang untuk tujuan ujian.">
<meta property="og:image" content="/img/cover.png">
<link rel="canonical" href="https://situs.example/post/1">
</head><body>
<nav>menu navigasi</nav>
<main>
  <h1>  tajuk utama  </h1>
  <h2>Seksyen Satu</h2>
  <p>Paragraf ini mempunyai lebih daripada tiga puluh aksara supaya ia dianggap kandungan utama.</p>
  <p>Pendek.</p>
  <a href="/post/2">pautan sama-situs</a>
  <a href="https://lain.example/x">pautan luar</a>
</main>
<footer>kaki halaman</footer>
<script>var rahsia = 1;</script>
</body></html>`;

test('extract: tajuk + nyahan entity + lang', () => {
  const r = extract(HTML, BASE);
  assert.strictEqual(r.title, 'Ujian & Tajuk');
  assert.strictEqual(r.lang, 'ms');
});

test('extract: siteName/host/path/depth daripada URL', () => {
  const r = extract(HTML, BASE);
  assert.strictEqual(r.siteName, 'situs.example');
  assert.strictEqual(r.host, 'situs.example');
  assert.strictEqual(r.path, '/post/1');
  assert.strictEqual(r.depth, 2);
  assert.deepStrictEqual(r.pathSegments, ['post', '1']);
});

test('extract: meta → canonical & gambar absolut', () => {
  const r = extract(HTML, BASE);
  assert.strictEqual(r.canonical, 'https://situs.example/post/1');
  assert.strictEqual(r.image, 'https://situs.example/img/cover.png');
});

test('extract: links hanya sama-situs (buang domain luar)', () => {
  const r = extract(HTML, BASE);
  assert.ok(r.links.includes('https://situs.example/post/2'));
  assert.ok(!r.links.some((l) => l.includes('lain.example')));
});

test('extract: headings tertib & teks dinormal', () => {
  const r = extract(HTML, BASE);
  assert.ok(r.headings.includes('tajuk utama'));
  assert.ok(r.headings.includes('Seksyen Satu'));
});

test('extract: kandungan buang boilerplate, paragraf <30 aksara, script', () => {
  const r = extract(HTML, BASE);
  assert.ok(r.content.includes('dianggap kandungan utama'));
  assert.ok(!r.content.includes('Pendek.'));        // terlampau pendek (<30)
  assert.ok(!r.content.includes('navigasi'));       // <nav> boilerplate
  assert.ok(!r.content.includes('kaki halaman'));   // <footer>
  assert.ok(!r.content.includes('rahsia'));         // <script>
});

test('extract: ringkasan ikut meta description, skema penuh', () => {
  const r = extract(HTML, BASE);
  assert.ok(r.description.includes('huraan'));
  assert.strictEqual(r.type, 'article');
  assert.strictEqual(typeof r.quality, 'number');
  assert.ok(r.quality >= 0 && r.quality <= 100);
  assert.ok(r.wordCount >= 1);
});

test('extract: fallback — tiada <title> guna finalUrl, tiada canonical guna finalUrl', () => {
  const r = extract('<body><p>x</p></body>', BASE);
  assert.strictEqual(r.title, BASE);
  assert.strictEqual(r.canonical, BASE);
  assert.strictEqual(r.image, '');
});
