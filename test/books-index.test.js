'use strict';
// src/books-index.js — the reading lists, in the search corpus.
//
// The failure this module exists for was measured, not imagined: 2,550 shelves were published
// and only the /books hub was in the index, so "beekeeping" and "climate change" reached a
// crawled BBC article while /books/bees and /books/climate-change sat on the same disk. What is
// worth testing here is the document shape (a page that answers the question must carry the
// question's words) and the guard that stops 2,550 documents being re-sent on every restart.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { shelfDoc, shelfDocs, indexBooksShelves, workLines, SHELF_QUALITY, WORKS_CAP } = require('../src/books-index');

const shelf = (over = {}) => ({
  slug: 'beekeeping', term: 'beekeeping', title: 'Beekeeping', found: 249, works: 30,
  at: '2026-10-24T00:00:00.000Z', curated: false, ...over
});
const works = [
  { title: 'First lessons in beekeeping', author: 'Camille Pierre Dadant', year: 1917, editions: 12 },
  { title: 'Bee-keeping for all', author: 'Frank Pellett', year: 1900, editions: 1 },
  { title: '', author: 'nobody' },
];

test('a shelf document carries the words the shelf is the answer to', () => {
  const doc = shelfDoc(shelf(), works);
  assert.strictEqual(doc.id, shelfDoc(shelf(), works).id, 'the id is derived from the slug, so a re-run upserts');
  assert.strictEqual(doc.url, 'https://tukuk.org/books/beekeeping');
  assert.strictEqual(doc.title, 'Beekeeping — Books by Subject');
  assert.strictEqual(doc.host, 'tukuk.org');
  assert.strictEqual(doc.type, 'books');
  assert.strictEqual(doc.quality, SHELF_QUALITY);
  // The three things that make it answer a question rather than mention a word: the subject,
  // the question itself, and the actual titles.
  assert.match(doc.content, /what to read about beekeeping/);
  assert.match(doc.content, /What should I read about beekeeping\?/);
  assert.match(doc.content, /First lessons in beekeeping — Camille Pierre Dadant, 1917 — 12 editions/);
  assert.match(doc.content, /where it holds 249 works/, 'the catalogue count is stated, not invented');
  assert.ok(doc.wordCount > 10 && doc.hash.length === 16, 'a real document, with a hash the guard can compare');
  assert.ok(Array.isArray(doc.keywords) && doc.keywords.includes('beekeeping'));
});

test('an empty edition count and an untitled record are left out, not printed as blanks', () => {
  const lines = workLines(works);
  assert.strictEqual(lines.length, 2, 'the untitled record is dropped');
  assert.strictEqual(lines[1], 'Bee-keeping for all — Frank Pellett, 1900', 'one edition is not worth a suffix');
  assert.strictEqual(workLines([]).length, 0);
  assert.strictEqual(workLines(undefined).length, 0);
  assert.ok(workLines(Array.from({ length: 40 }, (_, i) => ({ title: `T${i}` }))).length <= WORKS_CAP,
    'the document does not grow past the number the page shows');
});

test('a curated shelf is indexed from its title and blurb — it keeps no work file to read', () => {
  // The two gaps the query log exposed are curated: "Climate Change" is filed by the catalogue
  // under "Climatic changes" and "Movies & Film" under "Motion pictures". Both headings have to
  // be in the document, or the page answers the reader's word and misses the catalogue's.
  const doc = shelfDoc(shelf({ slug: 'climate-change', term: 'climatic changes', title: 'Climate Change', found: undefined, blurb: 'What seventy years of measurement show.' }), []);
  assert.strictEqual(doc.url, 'https://tukuk.org/books/climate-change');
  assert.match(doc.content, /climatic changes/, "the catalogue's own heading is searchable");
  assert.match(doc.content, /What seventy years of measurement show\./, 'the blurb is the description');
  assert.strictEqual(doc.description, 'What seventy years of measurement show.');
  assert.ok(doc.publishedAt, 'a curated shelf has no build date, so the index gets a fixed one');
});

test('a shelf row with no file behind it is not indexed, and a retired shelf is deleted', async () => {
  const lib = {
    allShelves: () => [
      shelf(),
      shelf({ slug: 'jazz', term: 'jazz', title: 'Jazz' }),
      shelf({ slug: 'ghost', term: 'ghost', title: 'Ghost' }),
      shelf({ slug: 'film', term: 'motion pictures', title: 'Movies & Film', curated: true }),
    ],
    shelfWorks: (slug) => (slug === 'ghost' ? [] : works)
  };
  const docs = shelfDocs(lib);
  assert.deepStrictEqual(docs.map((d) => d.url), [
    'https://tukuk.org/books/beekeeping',
    'https://tukuk.org/books/jazz',
    'https://tukuk.org/books/film',
  ], 'the ghost row is skipped and the curated shelf is kept');

  const index = fakeIndex();
  const first = await indexBooksShelves(index, lib, { logger: null });
  assert.deepStrictEqual([first.count, first.skipped], [3, false], 'three documents pushed');
  assert.strictEqual(index.store.size, 3);

  const again = await indexBooksShelves(index, lib, { logger: null });
  assert.deepStrictEqual([again.count, again.skipped], [3, true], 'nothing changed, nothing sent');
  assert.strictEqual(index.pushes, 1, 'the guard is what saves the push, not luck');

  // A shelf that no longer exists must leave the index with it.
  lib.allShelves = () => [shelf(), shelf({ slug: 'film', term: 'motion pictures', title: 'Movies & Film', curated: true })];
  const pruned = await indexBooksShelves(index, lib, { logger: null });
  assert.strictEqual(pruned.removed, 1, 'the jazz document is retired with its shelf');
  assert.deepStrictEqual(index.deleted.length, 1);
  assert.strictEqual(index.store.size, 2);

  // And an edit to a work list re-sends: the guard compares content, not count.
  lib.shelfWorks = () => [...works, { title: 'The bee book', author: 'A Beekeeper', year: 1950, editions: 3 }];
  const edited = await indexBooksShelves(index, lib, { logger: null });
  assert.strictEqual(edited.skipped, false, 'a rewritten shelf file is re-indexed');
  assert.strictEqual(index.pushes, 3);
});

test('the boot path calls it, after the cluster and section hubs', () => {
  const boot = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(boot, /const \{ indexBooksShelves \} = require\('\.\/src\/books-index'\)/);
  const cluster = boot.indexOf('indexGeoHubs(index, geoClusters())');
  const sections = boot.indexOf('indexSectionHubs(index, hubs)');
  const booksAt = boot.indexOf('indexBooksShelves(index, books)');
  assert.ok(cluster > 0 && sections > 0 && booksAt > 0, 'all three indexers are wired');
  assert.ok(booksAt > sections, 'the reading lists go after the two small clusters, not before the page server');
  assert.match(boot, /\[books-index\] skipped/, 'a failure is logged and swallowed, never fatal at boot');
});

function fakeIndex() {
  const index = {
    store: new Map(),
    stamps: new Map(),
    pushes: 0,
    deleted: [],
    async getDocuments() {
      const rows = [...index.store.values()].map((d) => ({ id: d.id, hash: d.hash }));
      return { results: rows, total: rows.length };
    },
    async updateDocuments(docs) {
      index.pushes += 1;
      for (const d of docs) index.store.set(d.id, d);
      return { taskUid: index.pushes };
    },
    async deleteDocuments(ids) {
      index.deleted.push(...ids);
      for (const id of ids) index.store.delete(id);
    }
  };
  return index;
}
