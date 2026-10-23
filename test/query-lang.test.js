// The site publishes English, and the search corpus is English. A visitor may still type a
// Malay query — Meili cannot match across languages, so it returns nothing. src/query-lang.js
// rewrites the vocabulary those queries are built from, and src/server.js only uses it when a
// query found ZERO hits. This file pins both halves: the rewrite, and the fact that it can
// never touch a query that already worked.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { toEnglishQuery } = require('../src/query-lang');
const { app } = require('../src/server');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

test('toEnglishQuery(): a Malay geo question becomes the English one the corpus holds', () => {
  const out = toEnglishQuery('berapa banyak pulau di jepun');
  assert.equal(out.query, 'how many island in japan');
  assert.equal(out.changed, true);
  assert.deepEqual(out.terms, ['berapa banyak', 'pulau', 'di', 'jepun']);
});

test('toEnglishQuery(): phrases win over their component words', () => {
  // "gunung berapi" is a volcano, not a "mountain" + something.
  assert.equal(toEnglishQuery('senarai gunung berapi di indonesia').query, 'list volcano in indonesia');
  assert.equal(toEnglishQuery('negara mana paling banyak tasik').query, 'which country most many lake');
  // A trailing question mark belongs to the sentence, not to the word lookup.
  assert.equal(toEnglishQuery('berapa banyak negara di dunia?').query, 'how many country in world');
  // Conjunctions matter too: without "dan" the two nouns would run together.
  assert.equal(toEnglishQuery('gunung dan danau').query, 'mountain and lake');
});

test('toEnglishQuery(): English passes through untouched', () => {
  for (const q of ['how many islands in japan', 'california counties', 'climate change', 'cloudflare tunnel']) {
    const out = toEnglishQuery(q);
    assert.equal(out.query, q, `${q} must not be rewritten`);
    assert.equal(out.changed, false);
  }
});

test('toEnglishQuery(): words that are also English are never rewritten', () => {
  // "air" (air quality) and "api" are ordinary English/technical terms — both appear in the
  // real query log. "kota" and "batu" start place names (Kota Kinabalu, Batu Caves).
  for (const q of ['air quality', 'api', 'kota kinabalu', 'batu caves', 'harga emas']) {
    assert.deepEqual(toEnglishQuery(q), { query: q, changed: false, terms: [] }, `${q} must be left alone`);
  }
});

test('toEnglishQuery(): a function word alone leaves no query to run', () => {
  const out = toEnglishQuery('yang');
  assert.equal(out.query, '');
  assert.equal(out.changed, false, 'nothing to search → the caller must not retry');
  assert.deepEqual(toEnglishQuery(''), { query: '', changed: false, terms: [] });
});

test('toEnglishQuery(): unknown words are kept, never dropped', () => {
  assert.equal(toEnglishQuery('pulau pinang').query, 'island pinang');
  assert.equal(toEnglishQuery('gunung kinabalu 2026').query, 'mountain kinabalu 2026');
});

test('/search retries in English only after a zero-hit result', () => {
  // The whole safety argument rests on this: a rewrite runs inside the `totalOf(result) === 0`
  // branch, so a query that already worked can never be replaced.
  assert.match(serverSrc, /if \(totalOf\(result\) === 0\) \{\n\s+const alt = queryLang\.toEnglishQuery\(qq\);/);
  assert.match(serverSrc, /if \(totalOf\(retry\) > 0\) \{ result = retry; translation = alt; \}/,
    'a retry that finds nothing must not replace the original result');
  assert.match(serverSrc, /\.\.\.\(translation \? \{ translatedQuery: translation\.query \} : \{\}\)/);
});

test('GET /search answers a Malay query without failing', async () => {
  // The document set differs between a laptop and the server (mock index vs Meili), so this
  // asserts the wiring — the route accepts the query, echoes it, and states what it searched
  // in English when that is what produced the hits.
  const res = await fetch(`${base}/search?q=${encodeURIComponent('berapa banyak pulau di jepun')}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.query, 'berapa banyak pulau di jepun', 'the query is echoed as typed');
  assert.ok(Array.isArray(body.hits));
  if (body.translatedQuery) {
    assert.equal(body.translatedQuery, 'how many island in japan');
    assert.ok(body.hits.length > 0, 'translatedQuery is only reported when the retry found hits');
  }
});
