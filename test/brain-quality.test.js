'use strict';
// Ujian gate kualiti jawapan (/ask): pemakan-echo + penghasil ekstraktif.
// Dua kerosakan nyata yang diuji di sini:
//   1. Jawapan awan yang RINGKAS (atau penolakan jujur "I don't know") dahulu
//      dibuang sebagai echo → sistem jatuh ke perenggan ekstraktif.
//   2. Ayat yang hanya memadam kata soal ("how", "many") cukup untuk menjadi
//      "jawapan" bagi soalan tentang entiti yang sama sekali berbeza.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isEcho, extractiveAnswer, contentTerms } = require('../src/brain/quality');

const PROMPT = [
  'QUESTION: how many counties does California have',
  'SOURCES (source [1] is the closest match):',
  '[1] California counties — California is a state in the United States.'
].join('\n\n');

test('isEcho: model kecil tetap menolak jawapan bawah 40 aksara', () => {
  assert.equal(isEcho('California has 58 counties.', PROMPT), true);
});

test('isEcho: model awan besar menerima jawapan ringkas yang sah', () => {
  assert.equal(isEcho('California has 58 counties.', PROMPT, { smallModel: false }), false);
});

test('isEcho: penolakan jujur diterima (bukan ditukar jadi karangan salah)', () => {
  assert.equal(isEcho("I don't know.", PROMPT, { smallModel: false }), false);
});

test('isEcho: salin semula soalan/label prompt ditolak walaupun oleh awan', () => {
  assert.equal(isEcho('how many counties does California have', PROMPT, { smallModel: false }), true);
  assert.equal(isEcho('QUESTION: how many counties does California have', PROMPT, { smallModel: false }), true);
});

test('isEcho: ayat berulang (litar ulang) masih ditolak oleh kedua-dua mod', () => {
  const loop = 'It is a county. It is a county. It is a county. It is a county indeed.';
  assert.equal(isEcho(loop, PROMPT), true);
  assert.equal(isEcho(loop, PROMPT, { smallModel: false }), true);
});

test('isEcho: petikan mentah berlabel sumber — longgar untuk awan, ketat untuk model kecil', () => {
  const cited = 'California has fifty-eight counties in total, of which Los Angeles is the most populous.\n\n(Sources: California counties)';
  assert.equal(isEcho(cited, PROMPT), true);
  assert.equal(isEcho(cited, PROMPT, { smallModel: false }), false);
});

test('contentTerms: kata soal/kuantiti dibuang, entiti dikekalkan', () => {
  assert.deepEqual(
    contentTerms(['how', 'many', 'counties', 'does', 'california', 'have']),
    ['counties', 'california']
  );
});

test('extractiveAnswer: ayat yang hanya memadam kata soal BUKAN jawapan', () => {
  // Ini tepat kes produksi: soalan bilangan county California dipetik daripada
  // blog pemuliharaan yang menyebut "how many?" — bukan fakta California.
  const hits = [{
    title: 'The Data Gap in Biology',
    url: '/blog/data-gap',
    content: 'Every conservation decision starts with a boring question: where are they, and how many? '
      + 'You cannot protect a population you have never located.'
  }];
  const out = extractiveAnswer('how many counties does California have', hits);
  assert.equal(out.method, 'extractive-fallback-list');
  assert.ok(!out.answer.includes('conservation'), 'perenggan tak berkaitan tidak boleh jadi jawapan');
});

test('extractiveAnswer: ayat berpadanan entiti dipakai', () => {
  const out = extractiveAnswer('capital of Kenya', [{
    title: 'Kenya',
    url: '/wiki/kenya',
    content: 'Nairobi is the capital and largest city of Kenya, sitting on a high plateau.'
  }]);
  assert.equal(out.method, 'extractive');
  assert.ok(out.answer.includes('Nairobi is the capital'));
});

test('extractiveAnswer: hanya SATU dokumen — tiada campur aduk artikel', () => {
  const hits = [{
    title: 'Kenya',
    url: '/wiki/kenya',
    content: 'Nairobi is the capital and largest city of Kenya, sitting on a high plateau.'
  }, {
    title: 'Fashion Week',
    url: '/blog/fashion',
    content: 'The capital of fashion week dates are announced every season in advance.'
  }];
  const out = extractiveAnswer('capital of Kenya', hits);
  assert.equal(out.method, 'extractive');
  assert.ok(out.answer.includes('Nairobi'), 'dokumen teratas mesti menang');
  assert.ok(!out.answer.includes('fashion'), 'artikel kedua tidak boleh dijahit masuk');
  assert.ok(!out.answer.includes('Fashion Week'), 'label sumber hanya menyebut satu dokumen');
});

test('extractiveAnswer: soalan Melayu masih berfungsi', () => {
  const out = extractiveAnswer('apa itu lagoon', [{
    title: 'Lagoon',
    url: '/lagoons/world',
    content: 'A lagoon is a shallow body of water separated from a larger sea by reef or barrier islands.'
  }]);
  assert.equal(out.method, 'extractive');
  assert.ok(/lagoon/i.test(out.answer));
});

test('extractiveAnswer: skrip tanpa-ruang (CJK) tidak rosak tanpa terma kandungan', () => {
  const out = extractiveAnswer('ケニアの首都', [{
    title: 'ナイロビ',
    url: '/wiki/nairobi',
    content: 'ナイロビはケニアの首都であり、東アフリカ有数の大都市でもあります。'
  }]);
  assert.equal(out.method, 'extractive');
  assert.ok(out.answer.includes('ナイロビ'));
});
