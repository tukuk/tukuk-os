'use strict';
// Geo cluster hub index tests — the documents that let /search & /ask answer
// questions about our own content (not just crawled news).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { geoClusters, isOwnFrontDoor } = require('../src/server');
const { hubToDoc, indexGeoHubs, stripHtml, tally, faqLines } = require('../src/cluster-index');

const clusters = geoClusters();
const docs = clusters.map(hubToDoc).filter(Boolean);

test('geoClusters(): every geo cluster registers its cfg + module once', () => {
  assert.ok(clusters.length > 500, `expected hundreds of clusters, got ${clusters.length}`);
  assert.equal(clusters.length, docs.length, 'every cluster should produce a hub document');
  const bases = new Set(clusters.map((c) => c.base));
  assert.equal(bases.size, clusters.length, 'base must be unique');
});

test('hubToDoc(): complete hub document + findable as our own content', () => {
  const ca = docs.find((d) => d.url === 'https://tukuk.org/california-counties');
  assert.ok(ca, 'the california-counties cluster must be indexed');
  assert.equal(ca.host, 'tukuk.org');
  assert.equal(ca.type, 'cluster');
  assert.equal(ca.siteName, 'Tukuk-OS');
  // Facts users ask about — must be in the content, not only in the HTML.
  assert.match(ca.content, /divided into 58 counties/);
  assert.match(ca.content, /Total in this cluster: 58 counties\./);
  assert.match(ca.content, /United States \(58\)/);
  // FAQ lines: user questions in a BM25-friendly shape — without them our
  // document loses to blogs that merely mention "how" + "many".
  assert.match(ca.content, /How many counties does California have\? California has 58 counties\./);
  // English only: the Malay template is gone, so nothing may carry a second
  // language into an /ask answer.
  assert.doesNotMatch(ca.content, /Berapa|Negara mana|Terdapat|mempunyai/);
  assert.ok(ca.id.length === 16, 'deterministic 16-hex id');
});

test('faqLines(): global clusters use jurisdiction-free questions', () => {
  const lines = faqLines({ subject: '', unit: 'bays', singular: 'bay', count: 52, top: 'Norway (11 bays)' });
  assert.deepEqual(lines, [
    'How many bays are there in total? There are 52 bays.',
    'Which country has the most bays? Norway (11 bays).',
    'List of bays worldwide (52 entries): names, country and region.',
    'Every bay on this page lists its country and region.'
  ]);
  const none = faqLines({ subject: '', unit: 'lagoons', singular: 'lagoon', count: 60, top: '' });
  assert.equal(none.length, 3, 'no dominant country → drop the "most" line');
});

test('faqLines(): the corpus stays English — no Malay question templates', () => {
  const global = faqLines({ subject: '', unit: 'bays', singular: 'bay', count: 52, top: 'Norway (11 bays)' });
  const scoped = faqLines({ subject: 'Kenya', unit: 'counties', singular: 'county', count: 47, top: '' });
  for (const line of [...global, ...scoped]) {
    assert.doesNotMatch(line, /Berapa|Negara|Terdapat|mempunyai/i, `a Malay line leaked into the corpus: ${line}`);
  }
  // Meili has no stemming — 'bay' ≠ 'bays' — so both forms have to appear somewhere
  // in the lines for BM25 to match either.
  const joined = global.join(' ');
  assert.ok(/\bbay\b/.test(joined) && /\bbays\b/.test(joined), 'both the singular and the plural appear');
});

test('faqLines(): country-scoped clusters answer real question shapes', () => {
  const lines = faqLines({ subject: 'Kenya', unit: 'counties', singular: 'county', count: 47, top: '' });
  assert.ok(lines.some((l) => l === 'How many counties does Kenya have? Kenya has 47 counties.'));
  assert.ok(lines.some((l) => l === 'List of counties in Kenya (47 entries): names, country and region.'));
});

test('hubToDoc(): facts fit inside the /ask snippet window', () => {
  // Real regression on the server: BRAIN_SNIPPET_CHARS=450 truncates content from
  // the START of the document. When a long intro comes first, the line "Which
  // country has the most bays? United States (541 bays)." is cut mid-word and an
  // honest cloud model answers "I don't know" — even though we wrote the fact.
  for (const d of docs) {
    const i = d.content.indexOf('How many');
    assert.ok(i >= 0 && i < 120, `${d.url}: the first question must be at the head of the document (got ${i})`);
  }
  const bays = docs.find((d) => d.url === 'https://tukuk.org/bays');
  assert.ok(bays, 'the bays cluster must exist');
  const start = bays.content.indexOf('Which country has the most');
  const end = bays.content.indexOf('\n', start);
  assert.ok(start > 0 && end < 450, 'the "most bays" question + answer must fit within 450 chars');
});

test('hubToDoc(): idempotent — id & hash stable between two builds', () => {
  const one = hubToDoc(clusters[0]);
  const two = hubToDoc(clusters[0]);
  assert.equal(one.id, two.id);
  assert.equal(one.hash, two.hash, 'hash comes only from content, never from time');
});

test('geoClusters(): the nine hand-written hubs are part of the corpus too', () => {
  // These pages predate the geo cluster factory and were never registered with geoSitemap(), so
  // they had no document at all: /search for "islands" could not reach our own front door and /ask
  // could not read it. The list is duplicated here on purpose — if one of them stops producing a
  // document, nothing else in the suite notices.
  const legacy = ['islands', 'rivers', 'waterfalls', 'caves', 'glaciers', 'mountains', 'lakes', 'heritage', 'conservation-areas'];
  for (const base of legacy) {
    const doc = docs.find((d) => d.url === `https://tukuk.org/${base}`);
    assert.ok(doc, `/${base} must produce a hub document`);
    assert.equal(doc.type, 'cluster');
    assert.equal(doc.quality, 0.9);
    assert.match(doc.content, /How many /, `${base}: the question line must be there for /ask`);
  }
});

test('isOwnFrontDoor(): a hub name is navigation, a phrase about it is not', () => {
  // The reranker is skipped for a query that is exactly a page we publish (see /search in
  // src/server.js); it kept demoting /waterfalls and /conservation-areas below a BBC article.
  assert.equal(isOwnFrontDoor('waterfalls'), true);
  assert.equal(isOwnFrontDoor('Conservation Areas'), true);
  assert.equal(isOwnFrontDoor('california counties'), true);
  assert.equal(isOwnFrontDoor('waterfalls in iceland'), false);
  assert.equal(isOwnFrontDoor(''), false);
});

test('hubToDoc(): an unrecorded country is never quoted as the leader', () => {
  // 2,585 islands carry country "Unknown" — that is a missing field, not a country, so the
  // "Which country has the most islands?" line must be dropped rather than answered with it.
  const islands = docs.find((d) => d.url === 'https://tukuk.org/islands');
  assert.ok(islands, 'the islands hub must be indexed');
  assert.doesNotMatch(islands.content, /has the most islands\? Unknown/);
  assert.match(islands.content, /How many islands are there in total\? There are \d+ islands\./);
});

test('hubToDoc(): big clusters are trimmed but still fully described', () => {
  const big = docs.slice().sort((a, b) => b.content.length - a.content.length)[0];
  assert.ok(big.content.length < 40000, `document should not explode (got ${big.content.length})`);
  assert.match(big.content, /\(and \d+ more\)\./, 'the remaining names are stated, not silenced');
});

test('indexGeoHubs(): pushes once, skips when the data has not changed', async () => {
  const store = new Map();
  let pushes = 0;
  const index = {
    async updateDocuments(list) { pushes += 1; list.forEach((d) => store.set(d.id, d)); return { taskUid: 1 }; },
    // Real Meili: `getDocuments({ filter, fields: ['hash'] })` returns the hash of
    // every `cluster` document — that is what this guard compares.
    async getDocuments() { return { results: [...store.values()].map((d) => ({ hash: d.hash })), total: store.size }; }
  };
  const first = await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 1);
  assert.equal(first.skipped, false);
  assert.equal(first.count, docs.length);

  const second = await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 1, 'same data → no re-push into Meilisearch');
  assert.equal(second.skipped, true);

  // Data changed (different sentinel hash) → must push again.
  store.set([...store.keys()][0], { hash: 'changed' });
  await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 2, 'a data change must reach the index');
});

test('indexGeoHubs(): a change in ONE non-sentinel hub is still detected', async () => {
  const store = new Map();
  let pushes = 0;
  const index = {
    async updateDocuments(list) { pushes += 1; list.forEach((d) => store.set(d.id, d)); return { taskUid: 1 }; },
    async getDocuments() { return { results: [...store.values()].map((d) => ({ hash: d.hash })), total: store.size }; }
  };
  await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 1);

  // Real scenario: editing the New Jersey borough data file changes the hash of
  // ONE document. The old sentinel-only guard would SKIP the push and the index
  // would keep serving stale data.
  const nj = docs.find((d) => d.url === 'https://tukuk.org/new-jersey-boroughs');
  assert.ok(nj, 'the new-jersey-boroughs cluster must exist');
  store.set(nj.id, Object.assign({}, store.get(nj.id), { hash: 'stale-255-borough' }));
  await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 2, 'even one changed document must be re-pushed');
});

test('indexGeoHubs(): a renamed cluster does not leave its old document behind', async () => {
  // The id is derived from the base (`geo-hub:` + base), so renaming /kepulauan → /archipelagos
  // creates a NEW document and never overwrites the old one. Before this, search kept
  // advertising https://tukuk.org/kepulauan — a Malay address that only 301s now.
  const store = new Map();
  let deleted = [];
  const index = {
    async updateDocuments(list) { list.forEach((d) => store.set(d.id, d)); return { taskUid: 2 }; },
    async getDocuments() { return { results: [...store.values()].map((d) => ({ id: d.id, hash: d.hash })), total: store.size }; },
    async deleteDocuments(ids) { deleted = ids; ids.forEach((id) => store.delete(id)); return { taskUid: 3 }; }
  };
  await indexGeoHubs(index, clusters, { logger: { log() {} } });
  store.set('geo-hub:kepulauan', { id: 'geo-hub:kepulauan', hash: 'stale', url: 'https://tukuk.org/kepulauan' });

  await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.deepEqual(deleted, ['geo-hub:kepulauan']);
  assert.equal(store.has('geo-hub:kepulauan'), false, 'the old hub must be gone from the index');
  assert.ok(store.size === docs.length, 'every current hub is still there');
});

test('indexGeoHubs(): empty/broken index → try to push, never drop documents', async () => {
  let pushed = 0;
  const index = {
    async updateDocuments(list) { pushed = list.length; return { taskUid: 7 }; },
    async getDocuments() { throw new Error('meili down'); }
  };
  const out = await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushed, docs.length);
  assert.equal(out.taskUid, 7);
});

test('indexGeoHubs(): no clusters → no work', async () => {
  const out = await indexGeoHubs({ async updateDocuments() { throw new Error('should not be called'); } }, [], { logger: { log() {} } });
  assert.deepEqual(out, { count: 0, skipped: true, taskUid: null });
});

test('indexGeoHubs(): unreadable hash (hidden attributes) → push', async () => {
  // Real regression on the server: `search` trims attributes by
  // `displayedAttributes`, which does not contain `hash`, so a guard asking for
  // hashes through search would see an empty list and push 610 documents on
  // EVERY boot — making things worse, not better.
  let pushes = 0;
  const index = {
    async updateDocuments(list) { pushes += 1; return { taskUid: 1 }; },
    async getDocuments() { return { results: [{ hash: undefined }], total: 1 }; }
  };
  await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 1, 'an inconclusive read → assume a push is needed');
});

test('helpers: stripHtml drops tags + entities, tally counts & sorts descending', () => {
  assert.equal(stripHtml('<b>58</b> counties &mdash; mapped&nbsp;&#8212;'), '58 counties mapped');
  assert.deepEqual(tally(['a', 'b', 'a', 'a', 'c', '']), [['a', 3], ['b', 1], ['c', 1]]);
});
