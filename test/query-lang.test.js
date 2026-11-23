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
  assert.equal(out.query, 'how many islands in japan');
  assert.equal(out.changed, true);
  assert.deepEqual(out.terms, ['berapa banyak', 'pulau', 'di', 'jepun']);
});

test('toEnglishQuery(): phrases win over their component words', () => {
  // "gunung berapi" is a volcano, not a "mountain" + something.
  assert.equal(toEnglishQuery('senarai gunung berapi di indonesia').query, 'list volcanoes in indonesia');
  assert.equal(toEnglishQuery('negara mana paling banyak tasik').query, 'which country most many lakes');
  // A trailing question mark belongs to the sentence, not to the word lookup.
  assert.equal(toEnglishQuery('berapa banyak negara di dunia?').query, 'how many countries in world');
  // Conjunctions matter too: without "dan" the two nouns would run together.
  assert.equal(toEnglishQuery('gunung dan danau').query, 'mountains and lakes');
});

test('toEnglishQuery(): class nouns come out plural, because the pages they reach are', () => {
  // Measured live on 25 Oct 2026: "berapa banyak negara di dunia" was asked three times, rewrote
  // to "how many country in world", found zero documents — and /countries answers it. Meilisearch
  // does not stem, so the lexicon has to match the hub's spelling, not the dictionary's.
  assert.equal(toEnglishQuery('berapa banyak negara di dunia').query, 'how many countries in world');
  assert.equal(toEnglishQuery('senarai muzium di jerman').query, 'list museums in germany');
  // …while a noun that arrives inside a proper name keeps the singular: the Strait of Malacca and
  // the Sea of Japan are pages with those words in their titles, not rows in a list.
  assert.equal(toEnglishQuery('selat melaka').query, 'strait melaka');
  assert.equal(toEnglishQuery('laut jepun').query, 'sea japan');
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
    assert.deepEqual(toEnglishQuery(q), { query: q, changed: false, terms: [], coverage: 0 }, `${q} must be left alone`);
  }
});

test('toEnglishQuery(): coverage says how much of the query was Malay', () => {
  // /search only switches when MORE THAN HALF the words were Malay. A place name that happens
  // to contain one Malay word must stay as typed.
  assert.equal(toEnglishQuery('berapa banyak pulau di jepun').coverage, 1);
  assert.equal(toEnglishQuery('gunung dan danau').coverage, 1);
  assert.equal(toEnglishQuery('pulau pinang').coverage, 0.5, 'one of two words — not enough to call it Malay');
  assert.equal(toEnglishQuery('dan brown').coverage, 0.5, 'a personal name must not be rewritten');
});

test('toEnglishQuery(): a function word alone leaves no query to run', () => {
  const out = toEnglishQuery('yang');
  assert.equal(out.query, '');
  assert.equal(out.changed, false, 'nothing to search → the caller must not retry');
  assert.deepEqual(toEnglishQuery(''), { query: '', changed: false, terms: [], coverage: 0 });
});

test('toEnglishQuery(): unknown words are kept, never dropped', () => {
  // Both of these are place names, and the rewrite would still make a plural of the class noun.
  // It never gets the chance: coverage is exactly half, and /search only switches above half.
  assert.equal(toEnglishQuery('pulau pinang').query, 'islands pinang');
  assert.equal(toEnglishQuery('gunung kinabalu 2026').query, 'mountains kinabalu 2026');
});

test('/search switches to English only when the rewrite finds more', () => {
  // Meili's default matching strategy still answers a Malay query with junk (it matched the
  // word "di"), so "zero hits" is not the trigger. Two conditions guard the switch, and both
  // are in the source: mostly-Malay coverage, and strictly more documents.
  assert.match(serverSrc, /const alt = queryLang\.toEnglishQuery\(qq\);\n\s+if \(alt\.changed && alt\.coverage > 0\.5\) \{/);
  assert.match(serverSrc, /if \(totalOf\(retry\) > totalOf\(result\)\) \{ result = retry; translation = alt; \}/,
    'the English result must only win by finding more documents');
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
    assert.equal(body.translatedQuery, 'how many islands in japan');
    assert.ok(body.hits.length > 0, 'translatedQuery is only reported when the retry found hits');
  }
});
