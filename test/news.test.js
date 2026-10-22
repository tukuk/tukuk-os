'use strict';
// Unit tests for src/news.js — the RSS/Atom parsers & HTML stripping (pure logic).
const { test } = require('node:test');
const assert = require('node:assert');

const { stripHtml, parseFeed } = require('../src/news');

// ── stripHtml ──
test('stripHtml: drops tags, decodes entities, collapses whitespace', () => {
  assert.strictEqual(stripHtml('<p>Hi &amp; bye</p>'), 'Hi & bye');
  assert.strictEqual(stripHtml('a<b>x</b>c'), 'a x c');
  assert.strictEqual(stripHtml('land&#8217;s'), "land's");
  assert.strictEqual(stripHtml('   lots    of   space  '), 'lots of space');
  assert.strictEqual(stripHtml(null), '');
});

// ── parseFeed (RSS <item>) ──
const RSS = `<rss><channel>
<item>
  <title>Fake &amp; News <b>bold</b></title>
  <link>https://a.example/1</link>
  <description>Summary of the first item.</description>
  <pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate>
</item>
<item><title>No link</title><link></link></item>
<item><title>Not http</title><link>ftp://x.example/y</link></item>
</channel></rss>`;

test('parseFeed: RSS — valid items come out, no-link/non-http are dropped', () => {
  const out = parseFeed(RSS, 'Src');
  assert.strictEqual(out.length, 1);
  const it = out[0];
  assert.strictEqual(it.title, 'Fake & News bold');
  assert.strictEqual(it.url, 'https://a.example/1');
  assert.strictEqual(it.description, 'Summary of the first item.');
  assert.strictEqual(it.source, 'Src');
  assert.strictEqual(it.image, '');
  assert.ok(Number.isFinite(it.publishedAt) && it.publishedAt > 0);
});

// ── parseFeed (Atom <entry>, link via the href attribute) ──
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>Entry Two</title>
  <link href="https://b.example/2"/>
  <summary>a short summary</summary>
  <updated>2026-10-01T00:00:00Z</updated>
</entry>
</feed>`;

test('parseFeed: Atom — falls back to <entry>, link read from the href attribute', () => {
  const out = parseFeed(ATOM, 'AtomSrc');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].url, 'https://b.example/2');
  assert.strictEqual(out[0].description, 'a short summary');
  assert.strictEqual(out[0].source, 'AtomSrc');
  assert.ok(out[0].publishedAt > 0);
});

test('parseFeed: an empty feed → an empty array', () => {
  assert.deepStrictEqual(parseFeed('<rss><channel></channel></rss>', 'X'), []);
});
