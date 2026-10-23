// A single word is a pure tie. "weather" matches 275 documents and Meili scores every one of
// them identically on words/typo/proximity/attribute/sort/exactness, so the order falls to
// insertion — which is how a 2023 BBC article ended up at #1 and our own /weather at #46.
// The fix is one custom ranking rule on `quality`. These tests pin the three things that make
// it work: the rule exists, every document carries the field, and the rule actually reaches a
// live index (it only ever used to be written when the index was created).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { settings, syncRankingRules, backfillQuality, CRAWLED_QUALITY } = require('../src/meili');
const { postToDoc } = require('../src/blog-index');
const { hubToDoc, sectionToDoc } = require('../src/cluster-index');

const BUILT_IN = ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'];

test('ranking: the tie-break is a custom quality rule, placed where it can decide', () => {
  const rules = settings().rankingRules;
  // The built-ins keep their relative order; the custom rule is spliced in before exactness.
  assert.deepEqual(rules.filter((rule) => BUILT_IN.includes(rule)), BUILT_IN, 'the built-in rules keep their order');
  assert.equal(rules.length, BUILT_IN.length + 1, 'one custom rule, no more');
  assert.equal(rules.indexOf('quality:desc'), rules.indexOf('exactness') - 1,
    'measured: the documents that outrank ours differ on exactness alone, so the rule must come first');
  assert.ok(rules.indexOf('quality:desc') > rules.indexOf('attribute'),
    'never above attribute — a better-matching attribute still wins');
  // Meilisearch rejects `attribute` together with `attributeRank`/`wordPosition`.
  assert.ok(!rules.some((rule) => rule === 'attributeRank' || rule === 'wordPosition'));
});

test('ranking: every document we write carries a numeric quality', () => {
  // Meilisearch documents a custom ranking rule as UNDEFINED when a document lacks the field,
  // so a writer that forgets `quality` silently breaks the order for everyone.
  const post = postToDoc({ slug: 'x', title: 'Hello', content: 'One two three four five.' });
  const hub = hubToDoc({
    base: 'bays',
    cfg: { titleCase: 'Bays', singular: 'bay', unit: 'bays' },
    mod: { list: [{ name: 'Bay of Fundy', country: 'Canada' }] },
    listKey: 'list'
  });
  const section = sectionToDoc({ url: '/weather', title: 'World Weather', lines: ['Today.'] });
  for (const [name, doc] of [['blog post', post], ['geo hub', hub], ['section hub', section]]) {
    assert.equal(typeof doc.quality, 'number', `${name} must carry a numeric quality`);
    assert.ok(Number.isFinite(doc.quality), `${name} quality must be a finite number`);
  }
  assert.ok(post.quality > CRAWLED_QUALITY && hub.quality > CRAWLED_QUALITY,
    'a page we wrote must score above an unrated crawl');
  assert.ok(section.quality > post.quality && post.quality > hub.quality,
    'front door > blog post > data hub — otherwise the hub loses its own name to an article');
});

test('ranking: the crawler stamps every crawled page with the neutral score', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'crawler.js'), 'utf8');
  assert.match(source, /const \{ CRAWLED_QUALITY \} = require\('\.\/meili'\);/);
  assert.ok(source.includes('quality: CRAWLED_QUALITY,'),
    'the document the crawler returns must carry quality');
});

test('ranking: a live index keeps the rules the code holds, not the ones it was created with', async () => {
  // The index already exists on the server, so updateSettings() at creation time never runs
  // again — a new rule added to the code would otherwise never reach production.
  const stale = {
    current: {
      rankingRules: BUILT_IN,
      searchableAttributes: ['title']
    },
    written: null,
    async getSettings() { return this.current; },
    async updateSettings(next) { this.written = next; return { taskUid: 7 }; }
  };
  assert.equal(await syncRankingRules(stale, { logger: { log() {} } }), true);
  assert.deepEqual(stale.written, { rankingRules: settings().rankingRules });

  const current = {
    calls: 0,
    async getSettings() { return { rankingRules: settings().rankingRules }; },
    async updateSettings() { this.calls += 1; return { taskUid: 8 }; }
  };
  assert.equal(await syncRankingRules(current, { logger: { log() {} } }), false, 'no change, no task');
  assert.equal(current.calls, 0);

  const unreadable = {
    async getSettings() { throw new Error('meili down'); },
    async updateSettings() { throw new Error('must not be called'); }
  };
  assert.equal(await syncRankingRules(unreadable, { logger: { log() {} } }), false, 'fail soft at boot');
});

/** An index handle that pages like Meilisearch's documents endpoint (offset/limit + total). */
function fakeIndex(docs) {
  const state = { docs: docs.map((d) => ({ ...d })), writes: [] };
  return {
    state,
    async getDocuments({ limit = 20, offset = 0, fields } = {}) {
      const rows = state.docs.slice(offset, offset + limit).map((doc) => {
        if (!fields) return { ...doc };
        const picked = fields.includes('id') ? { id: doc.id } : {};
        if (fields.includes('quality') && doc.quality != null) picked.quality = doc.quality;
        return picked;
      });
      return { results: rows, total: state.docs.length, limit, offset };
    },
    async updateDocuments(list) {
      state.writes.push(list);
      for (const patch of list) {
        const target = state.docs.find((doc) => doc.id === patch.id);
        if (target) Object.assign(target, patch);
      }
      return { taskUid: state.writes.length };
    }
  };
}

test('ranking: the backfill fills only the documents that have no score', async () => {
  const docs = [];
  for (let i = 0; i < 2500; i += 1) {
    // Every third document is one of ours and already carries a score.
    docs.push(i % 3 === 0 ? { id: `own-${i}`, quality: 0.9 } : { id: `crawl-${i}` });
  }
  const index = fakeIndex(docs);
  const result = await backfillQuality(index, { logger: { log() {} }, pageSize: 500, batchSize: 1000 });

  assert.equal(result.scanned, 2500, 'every document is read, across several pages');
  assert.equal(result.updated, 1666, 'exactly the documents without a score');
  const written = index.state.writes.flat();
  assert.equal(written.length, 1666);
  assert.ok(written.every((patch) => patch.quality === CRAWLED_QUALITY));
  assert.ok(written.every((patch) => patch.id.startsWith('crawl-')), 'a score already there is never overwritten');
  assert.ok(index.state.writes.length >= 2, 'the updates are batched');

  // Re-running it must find nothing: the rule is applied at boot by hand once.
  const again = await backfillQuality(index, { logger: { log() {} }, pageSize: 500, batchSize: 1000 });
  assert.equal(again.updated, 0);
  assert.equal(index.state.writes.length, 2, 'no empty batch is written');
});
