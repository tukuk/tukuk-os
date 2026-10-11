'use strict';
// Ujian unit src/news.js — parser RSS/Atom & penanggalan HTML (logik tulen).
const { test } = require('node:test');
const assert = require('node:assert');

const { stripHtml, parseFeed } = require('../src/news');

// ── stripHtml ──
test('stripHtml: buang tag, nyah entity, runtuh ruang', () => {
  assert.strictEqual(stripHtml('<p>Hi &amp; bye</p>'), 'Hi & bye');
  assert.strictEqual(stripHtml('a<b>x</b>c'), 'a x c');
  assert.strictEqual(stripHtml('ia&#8217;lah'), "ia'lah");
  assert.strictEqual(stripHtml('   banyak    ruang  '), 'banyak ruang');
  assert.strictEqual(stripHtml(null), '');
});

// ── parseFeed (RSS <item>) ──
const RSS = `<rss><channel>
<item>
  <title>Berita &amp; Palsu <b>bold</b></title>
  <link>https://a.example/1</link>
  <description>Huraan item pertama.</description>
  <pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate>
</item>
<item><title>Tiada link</title><link></link></item>
<item><title>Bukan http</title><link>ftp://x.example/y</link></item>
</channel></rss>`;

test('parseFeed: RSS — item sah keluar, tanpa-link/bukan-http dibuang', () => {
  const out = parseFeed(RSS, 'Src');
  assert.strictEqual(out.length, 1);
  const it = out[0];
  assert.strictEqual(it.title, 'Berita & Palsu bold');
  assert.strictEqual(it.url, 'https://a.example/1');
  assert.strictEqual(it.description, 'Huraan item pertama.');
  assert.strictEqual(it.source, 'Src');
  assert.strictEqual(it.image, '');
  assert.ok(Number.isFinite(it.publishedAt) && it.publishedAt > 0);
});

// ── parseFeed (Atom <entry>, link melalui atribut href) ──
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>Entri Dua</title>
  <link href="https://b.example/2"/>
  <summary>sari ringkas</summary>
  <updated>2026-10-01T00:00:00Z</updated>
</entry>
</feed>`;

test('parseFeed: Atom — fallback ke <entry>, link dari atribut href', () => {
  const out = parseFeed(ATOM, 'AtomSrc');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].url, 'https://b.example/2');
  assert.strictEqual(out[0].description, 'sari ringkas');
  assert.strictEqual(out[0].source, 'AtomSrc');
  assert.ok(out[0].publishedAt > 0);
});

test('parseFeed: umpan kosong → array kosong', () => {
  assert.deepStrictEqual(parseFeed('<rss><channel></channel></rss>', 'X'), []);
});
