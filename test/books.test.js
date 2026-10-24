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
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const books = require('../src/books');
const config = require('../src/config');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'books.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

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

// ── The scale layer: turning a catalogue subject string into a page ───────────────
// A thousand of these are built by scripts/books-build.js from strings nobody chose, so the
// rules that decide whether a string becomes a url are the product. Each case below is a
// subject string that really came back from the harvest on 24 Oct 2026.

test('a subject string is folded into a title and a slug without inventing a word', () => {
  assert.strictEqual(books.titleCase('beekeeping'), 'Beekeeping');
  assert.strictEqual(books.titleCase('history of science'), 'History of Science', 'a small word stays down');
  assert.strictEqual(books.titleCase('unitarianism and christian science'), 'Unitarianism and Christian Science');
  assert.strictEqual(books.shelfSlug('chimie  organique'), 'chimie-organique');
  assert.strictEqual(books.shelfSlug("manuels d'enseignement supérieur"), 'manuels-d-enseignement-superieur',
    'accents fold, because a url cannot carry them and a %-escape is worse');
  assert.strictEqual(books.shelfSlug('  beekeeping -- history  '), 'beekeeping-history', 'no trailing dash');
  assert.strictEqual(books.shelfSlug('!!'), 'subject', 'a label with nothing in it still yields a safe slug');
});

test('the six families of subject string that never become a page', () => {
  const gone = {
    'beekeeping--history': 'a subdivision',
    'juvenile fiction': 'a form tag',
    nonfiction: 'a form tag',
    'science textbooks': 'a form tag wherever it sits in the label',
    'laboratory manuals': 'a form tag wherever it sits in the label',
    'popular works': 'a form tag wherever it sits in the label',
    'cell physiological phenomena': 'MeSH machinery, not a reading list',
    'religious aspects': 'an LC subdivision with the dashes flattened',
    'psychological aspects of success': 'an LC subdivision with the dashes flattened',
    'chemistry, problems, exercises, etc.': 'punctuation, i.e. the inverted subdivision order',
    'study and teaching (secondary)': 'punctuation, i.e. catalogue machinery',
    open_syllabus_project: 'punctuation, i.e. catalogue machinery',
    'problèmes et exercices': 'punctuation, i.e. not an English label',
    'translations into english': 'a label for what the book is, not what it is about',
    // Every one of these was a live page on the 150-shelf proof run (24 Oct 2026) and was
    // pruned by the rule added after it: their books are written in the language of the label,
    // so the title-coverage gate below cannot see them — a French subject really does find
    // French titles. "Genetica"/"Genetik" and "Anatomie Humaine" all cleared 15%.
    'anatomie humaine': 'a French spelling of a shelf we already had',
    cellules: 'a French label on an English site',
    'exito en los negocios': 'a Spanish label on an English site',
    'strategisch management': 'a German label on an English site',
    denken: 'a German label that its own German titles happily confirmed',
    methods: 'a subdivision standing on its own',
    origin: 'a subdivision standing on its own',
    history: 'a bare umbrella word',
    science: 'a bare umbrella word',
    '1234': 'a number',
    'abc': 'too short',
  };
  for (const [term, why] of Object.entries(gone)) {
    assert.ok(books.rejected(term), `“${term}” must be rejected — ${why}`);
  }
  // And the ones that must survive, each a real topic a reader might ask for.
  for (const term of ['beekeeping', 'world war', 'history of science', 'photography', 'mountaineering',
    'numismatics', 'organic chemistry', 'problem solving', 'amateur radio']) {
    assert.strictEqual(books.rejected(term), null, `“${term}” is a subject, not a label`);
  }
  // Anchored on purpose: the umbrella list must not eat a qualified phrase.
  assert.ok(!books.rejected('history of science'), '"history" is a shrug, "history of science" is a shelf');
  // And the foreign list must not eat an English label that merely sits near one.
  assert.strictEqual(books.rejected('genes'), null, 'the foreign rule is about spellings, not letters');
  assert.strictEqual(books.rejected('genetic engineering'), null, '"genetic" is the English spelling and stays');
  assert.strictEqual(books.rejected('atlas'), null, 'a plural twin is caught by the build, not by the label rules');
});

test('a shelf that is another shelf with an s on the end is not published twice', () => {
  // The rule that costs no search: it runs on the term string before the catalogue is asked.
  const build = require('../scripts/books-build.js');
  assert.deepStrictEqual(build.stemWords('Social Sciences'), build.stemWords('social science'));
  const state = { published: [{ term: 'social science', slug: 'social-science' }, { term: 'beekeeping', slug: 'beekeeping' }] };
  assert.strictEqual(build.twinOfPublished('social sciences', state), 'social science');
  assert.strictEqual(build.twinOfPublished('atlases', { published: [{ term: 'atlas' }] }), 'atlas',
    'stem prefixes both ways, so "atlas"/"atlases" match');
  assert.strictEqual(build.twinOfPublished('cells', { published: [{ term: 'cellules' }] }), 'cellules');
  // What must NOT be called a twin: two different topics that happen to share a small word.
  assert.strictEqual(build.twinOfPublished('child development', state), null);
  assert.strictEqual(build.twinOfPublished('children', { published: [{ term: 'child' }] }), 'child',
    'deliberately generous: the catalogue writes "Child" and "Children" as two spellings of one heading, and a crawler handed both finds the same books');
  assert.strictEqual(build.twinOfPublished('vessels', { published: [{ term: 'cells' }] }), null,
    '"cell" is not a prefix of "vessel", so a lookalike is not blocked');
  assert.strictEqual(build.twinOfPublished('adolescent psychology', { published: [{ term: 'developmental psychology' }] }), null);
  assert.strictEqual(build.twinOfPublished('beekeeping', { published: [] }), null, 'nothing published, nothing to duplicate');
});

test('a label has to be a word its own books use', () => {
  const titles = ['The Country Beekeeper', 'Beekeeping for beginners', 'Letters on Beekeeping',
    'The bee book', 'Practical beekeeping in the garden', 'Wisdom of the hive',
    'Bee, the', 'Honey and men', 'Apiary notes', 'Small farms of England'];
  const good = books.labelCoverage('beekeeping', titles);
  assert.ok(good.coverage > books.LABEL_MIN_TITLE_COVERAGE, `beekeeping scores ${good.coverage}`);
  // A stem, so a label is credited by the form the title actually uses: "photograph" is matched
  // by "Photography", and the plural in "coins" is folded away.
  assert.strictEqual(books.labelCoverage('photograph', ['The photography year-book']).coverage, 1);
  assert.strictEqual(books.labelCoverage('coins', ['Coin and medal']).coverage, 1);
  // Measured on the catalogue: no English book on the "histoire" shelf is called histoire.
  assert.ok(books.labelCoverage('histoire', titles).coverage < books.LABEL_MIN_TITLE_COVERAGE);
  assert.strictEqual(books.labelCoverage('art', titles), null, 'a label with no testable word is kept, not judged');
  assert.strictEqual(books.labelCoverage('beekeeping', []), null, 'no titles, no opinion');
});

test('a sitemap index never advertises a chunk that does not exist', () => {
  // Measured live on the VPS before its first build: /sitemap-book-works.xml listed chunk 0 and
  // chunk 0 answered 404, because the count was clamped to a minimum of one.
  assert.strictEqual(books.workSitemapChunks(0, 10000), 0, 'nothing built, nothing advertised');
  assert.strictEqual(books.workSitemapChunks(1, 10000), 1);
  assert.strictEqual(books.workSitemapChunks(10000, 10000), 1, 'a full chunk is one file, not two');
  assert.strictEqual(books.workSitemapChunks(10001, 10000), 2, 'one work over the cap starts a second file');
  assert.strictEqual(books.workSitemapChunks(30000, 10000), 3, 'the scale this build is aimed at');
  assert.strictEqual(books.workSitemapChunks('nonsense', 10000), 0, 'a bad count is an empty cluster, not NaN chunks');
});

test('a work id finds its shard with no lookup table, from either shape of key', () => {
  const a = books.shardOf('OL2941508W');
  assert.strictEqual(a, books.shardOf('/works/OL2941508W'), 'the path and the bare id must agree');
  assert.ok(a >= 0 && a < books.WORK_SHARDS, `shard ${a} is a file that saveWorks could have written`);
  assert.strictEqual(books.shardOf('OL2941508W'), books.shardOf('OL2941508W'), 'stable across calls');
  assert.strictEqual(books.shardOf('not-an-id'), 0, 'junk buckets to a real shard rather than NaN');
  assert.strictEqual(books.work('nope'), null, 'a url segment that is not a work id is not a page');
});

test('a built shelf, its index and its works round-trip off disk in a fresh directory', () => {
  // A child process, because MIRROR_FILE (and with it every books path) is fixed at require
  // time — and because the alternative is writing test shelves into the data directory the
  // live build is using.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-books-'));
  const probe = `
    process.env.BOOKS_MIRROR_PATH = ${JSON.stringify(path.join(dir, 'books-last.json'))};
    const b = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'books.js'))});
    const at = new Date(0).toISOString();
    const work = { id: 'OL2941508W', title: 'The Country Beekeeper', author: 'Charles Ferry Ormerod',
      year: 1891, editions: 24, subjects: ['beekeeping'], ia: ['countrybeekeep00ormer'], shelves: ['beekeeping'], at };
    b.saveShelf({ slug: 'beekeeping', term: 'beekeeping', title: 'Beekeeping', found: 249, at,
      works: [work] });
    b.saveShelfIndex([
      { slug: 'beekeeping', term: 'beekeeping', title: 'Beekeeping', works: 1, found: 249, at },
      { slug: 'ghost', term: 'ghost', title: 'Ghost', works: 9, at },
    ]);
    b.saveWorks([work]);
    console.log(JSON.stringify({
      meta: b.shelfMeta('beekeeping'),
      curated: b.shelfMeta('physics') && b.shelfMeta('physics').curated !== true,
      works: b.shelfWorks('beekeeping'),
      byPath: b.work('/works/OL2941508W'),
      byId: b.work('OL2941508W'),
      inventory: b.inventory(),
      status: b.status(),
    }));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8', cwd: path.join(__dirname, '..') }));

  assert.strictEqual(out.meta.title, 'Beekeeping');
  assert.strictEqual(out.meta.found, 249, 'the catalogue count reaches the page, which is what says how much of a subject is shown');
  assert.strictEqual(out.works.length, 1, 'a shelf page reads one small file');
  assert.strictEqual(out.byId.title, 'The Country Beekeeper', 'a work is reachable by id');
  assert.strictEqual(out.byPath.title, 'The Country Beekeeper', 'and by the path shape the record carries');
  assert.strictEqual(out.curated, true, 'a curated slug still resolves beside the built ones');

  // The honest inventory: only shelves whose own file is there, and only works that were written.
  const slugs = out.inventory.shelves.map((s) => s.slug);
  assert.ok(slugs.includes('beekeeping'), 'the built shelf is publishable');
  assert.ok(!slugs.includes('ghost'), 'a shelf in the index with no file behind it is not promised to a crawler');
  assert.strictEqual(out.inventory.shelves.find((s) => s.slug === 'beekeeping').curated, false);
  assert.strictEqual(out.inventory.works.length, 1);
  assert.strictEqual(out.status.built, 2, 'status counts the index it was written; the ghost is missing from the sitemap, which is the file that must not lie');
  assert.strictEqual(out.status.records, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the books routes answer in the order that keeps them all reachable', () => {
  // /books/a-z registered after /books/:slug would be swallowed by the subject route, and the
  // A–Z page — the only page that makes a thousand shelves navigable — would 404 forever with
  // every route still looking correct in the file.
  const az = serverSrc.indexOf("app.get('/books/a-z'");
  const any = serverSrc.indexOf("app.get('/books/:slug'");
  assert.ok(az > 0 && any > 0, 'both routes are found');
  assert.ok(az < any, '/books/a-z must be registered before /books/:slug');
  assert.ok(serverSrc.includes("app.get('/book/:id'"), 'the per-work page has its own prefix, so no subject can shadow it');
  // A shelf row links internally only when the records exist; before the first build it must
  // link out to the catalogue instead of 404ing thirty times from one page.
  assert.ok(/books\.workIds\(\)\.length > 0/.test(serverSrc), 'internal book links are gated on the work index');
});
