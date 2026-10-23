// The corpus used to hold blog posts and the geo clusters only, so searching "weather",
// "holidays" or "how many countries" reached the BBC and the Olympics page — never the
// section hub that answers the question. src/section-hubs.js describes those front doors and
// src/cluster-index.js turns each one into a search document. This file pins the two things
// that can silently go wrong: a document that is not English, and a count that disagrees
// with the data the page renders.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sectionHubs } = require('../src/section-hubs');
const { sectionToDoc, indexSectionHubs } = require('../src/cluster-index');
const negara = require('../src/negara');

// Malay function words — the same shape test/to-english.js uses, so a translated sentence
// that slipped back in is caught here rather than in an /ask answer.
const MALAY = /\b(yang|untuk|dengan|tidak|daripada|kepada|ialah|adalah|sebagai|boleh|ialah|senarai|berapa|negara|gunung|pulau|adalah|dan|atau|pada|dari|ini|itu)\b/i;

const hubs = sectionHubs({ warn() {} });

test('sectionHubs(): the front doors are described, English only', async () => {
  const list = await hubs;
  assert.ok(list.length >= 10, `expected the main hubs, got ${list.length}`);
  for (const h of list) {
    assert.match(h.url, /^\/[a-z-]+$/, `${h.url} must be a root path`);
    assert.ok(h.title && h.description, `${h.url} needs a title and a description`);
    assert.doesNotMatch(h.title + ' ' + h.description + ' ' + h.lines.join(' '), MALAY,
      `${h.url} must be written in English only`);
  }
  const urls = list.map((h) => h.url);
  for (const url of ['/countries', '/weather', '/earthquakes', '/holidays', '/statistics', '/disasters', '/flags', '/maps', '/air-quality', '/academy']) {
    assert.ok(urls.includes(url), `${url} must be in the corpus`);
  }
});

test('sectionHubs(): the country count comes from the data, not from a typed sentence', async () => {
  const list = await hubs;
  const rows = await negara.loadCountries();
  const countries = list.find((h) => h.url === '/countries');
  assert.ok(rows.length > 100, 'the country list must be real');
  assert.match(countries.lines.join('\n'), new RegExp(`profiles ${rows.length} countries`),
    'the sentence must quote the number of countries the page actually renders');
});

test('sectionToDoc(): a uniform document that the geo guard will never mistake for a hub', async () => {
  const [first] = await hubs;
  const doc = sectionToDoc(first);
  assert.equal(doc.type, 'section', "NOT 'cluster' — indexGeoHubs prunes unknown cluster ids");
  assert.equal(doc.lang, 'en');
  assert.equal(doc.host, 'tukuk.org');
  assert.equal(doc.url, `https://tukuk.org${first.url}`);
  assert.equal(doc.id.length, 16);
  assert.equal(doc.hash.length, 16);
  assert.match(doc.content.split('\n')[0], /hub at tukuk\.org\//, 'the first line states where it lives');
  assert.equal(sectionToDoc(null), null);
});

test('sectionToDoc(): id and hash are stable between two builds', async () => {
  const [first] = await hubs;
  const a = sectionToDoc(first);
  const b = sectionToDoc(first);
  assert.equal(a.id, b.id);
  assert.equal(a.hash, b.hash, 'the hash comes from the content only, never from time');
});

test('indexSectionHubs(): pushes every hub once and reports the count', async () => {
  let pushed = [];
  const index = { async updateDocuments(list) { pushed = list; return { taskUid: 9 }; } };
  const out = await indexSectionHubs(index, await hubs, { logger: { log() {} } });
  assert.equal(out.count, (await hubs).length);
  assert.equal(pushed.length, out.count);
  assert.ok(pushed.every((d) => d.type === 'section'));
});
