// Catalogue hygiene: the checks that were run by hand after every expansion batch,
// turned permanent so CI runs them on every push (test.yml → npm test).
//
// Why each one exists — all of these are bugs that actually happened while the
// catalogue grew from 27 to 878 shelves:
//   • a duplicated `travel-writing` slug slipped into the third pass (two entries
//     cannot share one /books/<slug> page);
//   • a malformed chunk left `]` + `const BATCH3_TAIL = [` where the SUBJECTS
//     array should have closed, and a CJK fragment "条码" bled into an English
//     blurb — copy-paste from tool output writes bytes nobody proofreads;
//   • twins (lawyers↔law, pain↔painting, catalysis↔cats) collide with existing
//     shelves and, in two documented cases, broke test example terms.
// The rule the last one teaches: identical stem sets are the hard no — twins
// among curated entries like law/lawns are tolerated (they carry different
// books), so only exact duplicate shelf identities are banned here.
//
// What this file deliberately does NOT check: books.rejected(). It returned
// false alarms on 60 curated entries (poetry, tea, data structures …) on the
// day this test was written — rejected() is a guard for the auto-shelf crawler
// reading catalogue labels, and the human curator overrides it on purpose.
// And slug is NOT required to equal shelfSlug(term): 'motion pictures' living
// at /books/film is a chosen URL, not an accident. These are notes from the
// first run, kept because deleting them would let someone re-add the same
// false invariant.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const books = require('../src/books.js');
const build = require('../scripts/books-build.js');

const SUBJECTS = books.SUBJECTS;

// The generated copy is English-first (global-facing pages) and every blurb so
// far is ASCII typographic quotes/dashes at most. Any Han/Hiragana/Katakana or
// fullwidth codepoint is a bleed-in from tool output, not content.
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

test('the catalogue is not empty and keeps growing', () => {
  // A lower bound, not an equality: a merge that silently drops half the
  // catalogue must fail here, but adding shelves must never require a test edit.
  assert.ok(SUBJECTS.length >= 878, `expected at least 878 curated shelves, got ${SUBJECTS.length}`);
});

test('every entry carries the four fields a shelf page renders from', () => {
  for (const s of SUBJECTS) {
    for (const key of ['slug', 'title', 'term', 'blurb']) {
      assert.strictEqual(typeof s[key], 'string', `${JSON.stringify(s)} missing ${key}`);
      assert.ok(s[key].trim().length > 0, `${s.slug || '?'}: empty ${key}`);
    }
  }
});

test('slugs are clean URL tokens (and nothing more is promised)', () => {
  // A curated slug is chosen by a human for the reader; the term is chosen for
  // Open Library. They may legitimately disagree ('motion pictures' at
  // /books/film), so the only rule here is that the slug is a valid, stable
  // path segment: lowercase, single hyphens, no leading/trailing, ≤ 60 chars
  // (shelfSlug's cap, so an auto shelf and a curated one cannot outgrow the
  // same url shape).
  for (const s of SUBJECTS) {
    assert.match(s.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${s.slug}: not a clean slug`);
    assert.ok(s.slug.length <= 60, `${s.slug}: longer than shelfSlug would allow`);
  }
});

test('terms are lowercase, unique, and no two entries share a slug', () => {
  const slugs = new Set();
  const terms = new Set();
  for (const s of SUBJECTS) {
    assert.strictEqual(s.term, s.term.toLowerCase(), `term ${s.term} is not lowercase`);
    assert.ok(!/\s{2,}|^\s|\s$/.test(s.term), `term "${s.term}" has stray whitespace`);
    assert.ok(!slugs.has(s.slug), `duplicate slug: ${s.slug}`);
    assert.ok(!terms.has(s.term), `duplicate term: ${s.term}`);
    slugs.add(s.slug);
    terms.add(s.term);
  }
});

// Fixture vocabulary from books.test.js and books-index.test.js — mocked
// shelves and example queries the unit tests assert against. These are NOT
// shelves of the product; a batch that curates one of these terms collides
// with the tests, which is exactly what happened twice (batch 1: amateur
// radio, child psychology; batch 2: bees, sun). Cheaper to forbid the four
// than to rediscover it in a third batch.
test('the catalogue never eats the words the unit tests fixture on', () => {
  const fixtures = new Set(['amateur radio', 'child psychology', 'bees', 'sun']);
  for (const s of SUBJECTS) {
    assert.ok(!fixtures.has(s.term),
      `"${s.term}" is test fixture vocabulary, not a shelf — books tests will start failing`);
  }
});

test('no two curated terms are the same shelf written twice', () => {
  // The hard twin rule: identical stem sets (atlas/atlases, lawyer/lawyers) are
  // one heading in two spellings — Open Library returns the same works, so the
  // second entry is a dead page. Prefix-twins (law/lawns) are NOT checked here;
  // they carry different books and are tolerated on purpose.
  const byStems = new Map();
  for (const s of SUBJECTS) {
    const key = build.stemWords(s.term).join('|');
    const first = byStems.get(key);
    if (first !== undefined) {
      assert.fail(`"${s.term}" is the same shelf as "${first}" (stems: ${key})`);
    }
    byStems.set(key, s.term);
  }
});

test('blurbs read like a sentence, not a fragment or an encoding accident', () => {
  for (const s of SUBJECTS) {
    assert.ok(!CJK.test(s.blurb), `${s.slug}: blurb contains CJK/fullwidth characters`);
    assert.ok(s.blurb.length >= 30, `${s.slug}: blurb is only ${s.blurb.length} characters`);
    assert.ok(s.blurb.length <= 400, `${s.slug}: blurb is ${s.blurb.length} characters, too long for a card`);
    // A sentence may end in a quote that closes the last word: …“discovered.”
    assert.ok(/[.!?”"']$/.test(s.blurb), `${s.slug}: blurb does not end in punctuation`);
    assert.ok(!/\b(\w+)\s+\1\b/i.test(s.blurb), `${s.slug}: blurb has a stutter ("word word")`);
  }
});

test('BY_SLUG and SUBJECTS agree, and every curated slug resolves in the map', () => {
  // BY_SLUG is what /books/<slug> reads (subject() is async and may reach the
  // network — a unit test must not call it).
  assert.strictEqual(books.BY_SLUG.size, SUBJECTS.length);
  for (const s of SUBJECTS) {
    const got = books.BY_SLUG.get(s.slug);
    assert.ok(got, `/books/${s.slug} does not resolve`);
    assert.strictEqual(got.term, s.term);
  }
});
