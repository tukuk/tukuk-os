'use strict';
// src/books.js — the reading lists.
//
// What is worth testing here is not the HTTP call, it is the four rules that keep a list
// about its subject. Every one of them exists because the Open Library catalogue broke the
// list in a specific, measured way on 24 Oct 2026: asking the server to sort returned Dickens
// on a climate page; its subject pages return works that do not carry the subject; historical
// romances headed the ancient-history list; and a record literally titled "Laws, etc" — a
// country's statute book — came first on the law page. rankWorks() is pure, so all four are
// checked without the network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const books = require('../src/books');
const config = require('../src/config');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'books.js'), 'utf8');

/** An Open Library search doc, in the shape `fields=` asks for. */
function doc(title, opts = {}) {
  return {
    key: `/works/${opts.key || title.replace(/\W+/g, '').slice(0, 12)}`,
    title,
    author_name: opts.author ? [opts.author] : undefined,
    first_publish_year: opts.year,
    edition_count: opts.editions,
    subject: opts.subjects || [],
  };
}

const PHYSICS = { slug: 'physics', term: 'physics', title: 'Physics' };

test('a work must carry the subject on its own record to reach the list', () => {
  // Measured: the catalogue's search also matches on other fields, and its subject pages
  // return works whose records do not mention the subject at all. A list of books that are
  // merely near the subject is worse than no list, because it looks like an editorial choice.
  const works = books.rankWorks([
    doc('Fundamentals of Physics', { subjects: ['physics'], editions: 45, author: 'David Halliday', year: 1970, key: 'W1' }),
    doc('Notre Dame de Paris', { subjects: ['Fiction', 'Man-woman relationships'], editions: 300, author: 'Victor Hugo', year: 1831, key: 'W2' }),
  ], PHYSICS);
  assert.strictEqual(works.length, 1, 'the novel that does not carry the subject is dropped');
  assert.strictEqual(works[0].title, 'Fundamentals of Physics');
});

test('the comparison is case- and spacing-insensitive, because the catalogue is untidy', () => {
  const works = books.rankWorks([doc('Astronomy', { subjects: ['Astronomy'], editions: 10, key: 'W3' })],
    { slug: 'astronomy', term: 'astronomy' });
  assert.strictEqual(works.length, 1, 'a capitalised subject tag still counts');
});

test('a novel is left out of a non-literary list and kept on a literary one', () => {
  const pool = [
    doc('Historiae Philippicae', { subjects: ['ancient history'], editions: 73, author: 'Justin', key: 'H1' }),
    doc('Die Nilbraut', { subjects: ['ancient history', 'Fiction', 'German fiction'], editions: 69, author: 'Georg Ebers', key: 'H2' }),
  ];
  const history = books.rankWorks(pool, { slug: 'ancient-history', term: 'ancient history' });
  assert.deepStrictEqual(history.map((w) => w.title), ['Historiae Philippicae'],
    'the historical romance is not ancient history to read');
  const poetry = books.rankWorks(pool, { slug: 'ancient-history', term: 'ancient history', literary: true });
  assert.strictEqual(poetry.length, 2, 'a literary subject keeps its fiction — Homer is fiction by this test');
});

test('statute compilations and proceedings are not books to read', () => {
  assert.ok(books.isSerial(doc('Laws, etc', {})), 'the label the record of the UK statute book carries');
  assert.ok(books.isSerial(doc('Proceedings of the Royal Society', {})));
  assert.ok(!books.isSerial(doc('The Principles of the Civil Code', {})), 'a real book about law is kept');
  const works = books.rankWorks([
    doc('Laws, etc', { subjects: ['law'], editions: 3456, key: 'L1' }),
    doc('Commentaries on the Laws of England', { subjects: ['law'], editions: 214, author: 'William Blackstone', key: 'L2' }),
  ], { slug: 'law', term: 'law' });
  assert.deepStrictEqual(works.map((w) => w.title), ['Commentaries on the Laws of England']);
});

test('no author takes more than two slots, and the cap never empties the list', () => {
  const pool = [
    doc('Historical Mysteries', { subjects: ['world history'], editions: 89, author: 'Andrew Lang', key: 'A1' }),
    doc('A Short History of Scotland', { subjects: ['world history'], editions: 80, author: 'Andrew Lang', key: 'A2' }),
    doc('The Clyde Mystery', { subjects: ['world history'], editions: 52, author: 'Andrew Lang', key: 'A3' }),
  ];
  for (let i = 0; i < 40; i++) {
    pool.push(doc(`Other Book ${i}`, { subjects: ['world history'], editions: 50 - i, author: `Author ${i}`, key: `O${i}` }));
  }
  const capped = books.rankWorks(pool, { slug: 'world-history', term: 'world history' });
  assert.strictEqual(capped.filter((w) => w.author === 'Andrew Lang').length, 2, 'three Lang titles become two');
  assert.strictEqual(capped.length, books.LIMIT, 'and the list is still full');
  // The opposite failure: a subject with four records must show four, not two.
  const thin = books.rankWorks(pool.slice(0, 3), { slug: 'world-history', term: 'world history' });
  assert.strictEqual(thin.length, 3, 'a cap that would starve a short list is relaxed rather than obeyed');
});

test('the list is ordered by editions in print, and an uncounted work goes last', () => {
  const works = books.rankWorks([
    doc('No count', { subjects: ['poetry'], key: 'P1' }),
    doc('Eleven', { subjects: ['poetry'], editions: 11, key: 'P2' }),
    doc('One thousand', { subjects: ['poetry'], editions: 1000, key: 'P3' }),
  ], { slug: 'poetry', term: 'poetry', literary: true });
  assert.deepStrictEqual(works.map((w) => w.title), ['One thousand', 'Eleven', 'No count']);
});

test('the catalogue is asked for matches, never for a sorted list', () => {
  // `sort=editions` ignores the subject and ranks the whole index: asking Open Library for
  // the most-editioned works on climatology returned Nicholas Nickleby. The ordering is ours.
  const fetchBlock = src.slice(src.indexOf("http.get('https://openlibrary.org/search.json'"), src.indexOf('const docs ='));
  assert.ok(fetchBlock.length > 80, 'the catalogue call is found');
  assert.ok(!/sort\s*:/.test(fetchBlock), 'no server-side sort is requested');
  assert.ok(fetchBlock.includes('subject'), 'the subject field is asked for, because the filter needs it');
  assert.ok(fetchBlock.includes('limit: PER_SEARCH'), 'the whole match page is pulled, not one page of ten');
});

test('the list is mirrored beside the store, written atomically, and served stale if the catalogue dies', () => {
  // Same convention as every other cluster on this box: a restart must never wait on the
  // network for a page that rendered yesterday.
  assert.strictEqual(books.MIRROR_FILE, path.join(path.dirname(config.store.path), 'books-last.json'));
  const writer = src.slice(src.indexOf('function writeMirror'), src.indexOf('/**\n * The reading list'));
  assert.ok(writer.includes('writeFileSync(tmp'), 'written to a temp name first');
  assert.ok(writer.includes('renameSync(tmp, MIRROR_FILE)'), 'then renamed, so a reader never sees half a file');
  assert.ok(writer.includes('catch {'), 'a failed mirror is a slow restart later, not a broken page now');
});

test('prime walks every subject, survives one that throws, and retries the empties once', async () => {
  const asked = [];
  const failing = new Set(['biology']); // a real timeout seen while testing: one bad second, not a bad day
  const got = await books.prime({
    gapMs: 0,
    log: () => {},
    fetchOne: async (slug) => {
      asked.push(slug);
      if (failing.has(slug)) return { works: [], at: null, stale: false };
      return { works: [{ title: 'x' }], at: Date.now(), stale: false };
    },
  });
  const n = books.SUBJECTS.length;
  assert.strictEqual(asked.filter((s) => s === 'biology').length, 2, 'the empty subject got a second turn');
  assert.strictEqual(asked.filter((s) => s === 'poetry').length, 1, 'and a good subject was not asked twice');
  assert.strictEqual(asked.length, n + 1, 'one full pass plus one retry of what came back empty');
  assert.strictEqual(got, n - 1, 'reported honestly: it primed everything except the failure');
  // A fetcher that throws must not stop the walk — prime is called unhandled at boot.
  const before = asked.length;
  await books.prime({
    gapMs: 0,
    log: () => {},
    fetchOne: async (slug) => { asked.push(slug); throw new Error('socket hang up'); },
  });
  assert.strictEqual(asked.length, before + 2 * n, 'every subject is attempted twice even when the network is dead');
});

test('a subject the table does not know returns an empty list rather than throwing', async () => {
  const r = await books.subject('not-a-subject');
  assert.deepStrictEqual(r, { works: [], at: null, stale: false });
});

test('every subject in the table has a distinct, url-safe slug and a real subject string', () => {
  const seen = new Set();
  for (const s of books.SUBJECTS) {
    assert.match(s.slug, /^[a-z][a-z0-9-]*$/, `${s.slug}: a slug goes in a url`);
    assert.ok(!seen.has(s.slug), `${s.slug} appears once`);
    seen.add(s.slug);
    assert.ok(s.term && s.term === s.term.trim().toLowerCase(), `${s.slug}: the Open Library term is lower case`);
    assert.ok(s.blurb.length > 40, `${s.slug}: a subject without a reason to read it is a link farm`);
    assert.ok(books.BY_SLUG.get(s.slug) === s, `${s.slug} resolves through BY_SLUG`);
  }
});
