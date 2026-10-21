'use strict';
// Ujian indeks hub kluster geo — dokumen yang membolehkan /search & /ask
// menjawab soalan tentang konten kami sendiri (bukan cuma berita crawl).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { geoClusters } = require('../src/server');
const { hubToDoc, indexGeoHubs, stripHtml, tally, faqLines } = require('../src/cluster-index');

const clusters = geoClusters();
const docs = clusters.map(hubToDoc).filter(Boolean);

test('geoClusters(): semua kluster geo mendaftarkan cfg + modul sekali', () => {
  assert.ok(clusters.length > 500, `jangka ratusan kluster, dapat ${clusters.length}`);
  assert.equal(clusters.length, docs.length, 'setiap kluster wajar menghasilkan dokumen hub');
  const bases = new Set(clusters.map((c) => c.base));
  assert.equal(bases.size, clusters.length, 'base mesti unik');
});

test('hubToDoc(): dokumen hub lengkap + boleh dicari sebagai konten kami', () => {
  const ca = docs.find((d) => d.url === 'https://tukuk.org/california-counties');
  assert.ok(ca, 'kluster california-counties mesti terindeks');
  assert.equal(ca.host, 'tukuk.org');
  assert.equal(ca.type, 'cluster');
  assert.equal(ca.siteName, 'Tukuk-OS');
  // Fakta yang ditanya pengguna — mesti ada dalam kandungan, bukan hanya di HTML.
  assert.match(ca.content, /divided into 58 counties/);
  assert.match(ca.content, /Total in this cluster: 58 counties\./);
  assert.match(ca.content, /United States \(58\)/);
  // Baris FAQ: soalan pengguna dalam bentuk BM25 boleh memandu — tanpanya
  // dokumen kami kalah kepada blog yang cuma menyebut "how" + "many".
  assert.match(ca.content, /How many counties does California have\? California has 58 counties\./);
  assert.match(ca.content, /Berapa banyak county di California\?/);
  assert.ok(ca.id.length === 16, 'id deterministik 16 hex');
});

test('faqLines(): kluster global guna soalan tanpa yurisdiksi', () => {
  const lines = faqLines({ subject: '', unit: 'bays', singular: 'bay', count: 52, top: 'Norway (11 bays)' });
  assert.deepEqual(lines, [
    'How many bays are there in total? There are 52 bays.',
    'Which country has the most bays? Norway (11 bays).',
    'List of bays worldwide (52 entries): names, country and region.'
  ]);
  const none = faqLines({ subject: '', unit: 'lagoons', singular: 'lagoon', count: 60, top: '' });
  assert.equal(none.length, 2, 'tiada negara mendominasi → buang baris "most"');
});

test('faqLines(): kluster bernegara menyahut bentuk soalan sebenar', () => {
  const lines = faqLines({ subject: 'Kenya', unit: 'counties', singular: 'county', count: 47, top: '' });
  assert.ok(lines.some((l) => l === 'How many counties does Kenya have? Kenya has 47 counties.'));
  assert.ok(lines.some((l) => l.includes('Berapa banyak county di Kenya')));
});

test('hubToDoc(): idempotent — id & hash tak berubah antara dua binaan', () => {
  const one = hubToDoc(clusters[0]);
  const two = hubToDoc(clusters[0]);
  assert.equal(one.id, two.id);
  assert.equal(one.hash, two.hash, 'hash hanya daripada kandungan, bukan masa');
});

test('hubToDoc(): kluster besar dipotong tapi tetap lengkap dinyatakan', () => {
  const big = docs.slice().sort((a, b) => b.content.length - a.content.length)[0];
  assert.ok(big.content.length < 40000, `dokumen tidak wajar meletup (${big.content.length})`);
  assert.match(big.content, /\(and \d+ more\)\./, 'baki nama dinyatakan, disenyapkan');
});

test('indexGeoHubs(): tolak sekali, skip bila data belum berubah', async () => {
  const store = new Map();
  let pushes = 0;
  const index = {
    async updateDocuments(list) { pushes += 1; list.forEach((d) => store.set(d.id, d)); return { taskUid: 1 }; },
    async getDocument(id) { const d = store.get(id); if (!d) throw new Error('not found'); return d; },
    async search() { return { estimatedTotalHits: store.size }; }
  };
  const first = await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 1);
  assert.equal(first.skipped, false);
  assert.equal(first.count, docs.length);

  const second = await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 1, 'data sama → tiada penolakan semula ke Meilisearch');
  assert.equal(second.skipped, true);

  // Data berubah (hash sentinel berbeza) → perlu tolak semula.
  store.set([...store.keys()][0], { hash: 'berubah' });
  await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushes, 2, 'perubahan data mesti masuk indeks');
});

test('indexGeoHubs(): index kosong/roboh → cuba tolak, jangan buang dokumen', async () => {
  let pushed = 0;
  const index = {
    async updateDocuments(list) { pushed = list.length; return { taskUid: 7 }; },
    async getDocument() { throw new Error('meili down'); },
    async search() { throw new Error('meili down'); }
  };
  const out = await indexGeoHubs(index, clusters, { logger: { log() {} } });
  assert.equal(pushed, docs.length);
  assert.equal(out.taskUid, 7);
});

test('indexGeoHubs(): tiada kluster → tanpa kerja', async () => {
  const out = await indexGeoHubs({ async updateDocuments() { throw new Error('tak patut panggil'); } }, [], { logger: { log() {} } });
  assert.deepEqual(out, { count: 0, skipped: true, taskUid: null });
});

test('bantu: stripHtml buang tag + entity, tally kira & susun turun', () => {
  assert.equal(stripHtml('<b>58</b> counties &mdash; mapped&nbsp;&#8212;'), '58 counties mapped');
  assert.deepEqual(tally(['a', 'b', 'a', 'a', 'c', '']), [['a', 3], ['b', 1], ['c', 1]]);
});
