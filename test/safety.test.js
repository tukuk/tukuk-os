// ═══ Tests: the query safety gate (/search, /suggest, /ask choke point) ═══
// The rule under test comes from a real production incident: a CSAM-adjacent
// query returned 29 hits from the scraped index before src/safety.js existed.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const safety = require('../src/safety');

test('blockedQuery catches abuse terms in any position, case and punctuation', () => {
  assert.equal(safety.blockedQuery('candydoll'), true);
  assert.equal(safety.blockedQuery('Laura B CandyDoll videos'), true);
  assert.equal(safety.blockedQuery('  jailbait!! '), true);
  assert.equal(safety.blockedQuery('child-porn'), true);
  assert.equal(safety.blockedQuery('where to find shotacon'), true);
});

test('blockedQuery leaves ordinary vocabulary alone (no over-blocking)', () => {
  assert.equal(safety.blockedQuery('cp command linux'), false);
  assert.equal(safety.blockedQuery('lolita novel summary'), false);
  assert.equal(safety.blockedQuery('pedometer steps'), false);
  assert.equal(safety.blockedQuery('child poverty statistics'), false);
  assert.equal(safety.blockedQuery(''), false);
  assert.equal(safety.blockedQuery(null), false);
});

test('blockedHit flags documents, not titles that merely share a word', () => {
  assert.equal(safety.blockedHit({ title: 'CandyDoll archive', url: 'https://x.test/a' }), true);
  assert.equal(safety.blockedHit({ title: 'Nice page', url: 'https://x.test/candydoll/1' }), true);
  assert.equal(safety.blockedHit({ title: 'Candy shop prices', url: 'https://x.test/shop' }), false);
  assert.equal(safety.blockedHit(null), false);
});

test('filterHits drops only the blocked documents and keeps order', () => {
  const hits = [
    { title: 'Keep me', url: 'https://x.test/1' },
    { title: 'Jailbait gallery', url: 'https://x.test/2' },
    { title: 'Keep me too', url: 'https://x.test/3' }
  ];
  const kept = safety.filterHits(hits);
  assert.deepEqual(kept.map((h) => h.title), ['Keep me', 'Keep me too']);
  assert.deepEqual(safety.filterHits(undefined), undefined);
});
