'use strict';
// Ujian "Tukuk-Brain Mini" — model AI milik sendiri (softmax MURNI-JS) +
// integrasi celah-regex dalam taskrouter. Deterministik: seed tetap.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const minimodel = require('../src/brain/minimodel');

const DATA = [
  // math
  ...['hitung 12 kali 7', 'berapa 45 bahagi 9', 'calculate 88 minus 39', '17 kali 17 berapa',
    'jumlahkan 340 dan 260', 'what do 7 plus 8 equal', 'square root of 169', 'baki 1000 tolak 378']
    .map((text) => ({ text, label: 'math' })),
  // howto
  ...['macam mana nak pasang nginx', 'cara buat roti canai', 'how to speed up wordpress',
    'langkah daftar domain baru', 'panduan setup ssl', 'tutorial guna git branch']
    .map((text) => ({ text, label: 'howto' })),
  // define
  ...['apa itu blockchain', 'what is api rest', 'maksud algoritma', 'kenapa langit warna biru',
    'siapa linus torvalds', 'definition of webassembly']
    .map((text) => ({ text, label: 'define' })),
  // list
  ...['senarai negara asean', 'top 5 search engine', 'contoh makanan malaysia',
    'sebutkan ibu kota negeri', 'name some open source cms']
    .map((text) => ({ text, label: 'list' })),
  // general
  ...['selamat pagi', 'hello there', 'terima kasih banyak', 'khabar berita', 'jom sembang kosong']
    .map((text) => ({ text, label: 'general' }))
];

test('minimodel: train → predikasi betul pada contoh baru (generalisasi)', () => {
  const { model, stats } = minimodel.train(DATA, { epochs: 200, lr: 0.4, l2: 3e-3, tri: 60, seed: 7, holdout: 0 });
  assert.ok(stats.examples >= 28);
  // GATE KUALITI: mesti ambil sekurang-kurangnya 80% contoh pegang sendiri.
  assert.ok(stats.trainAccuracy >= 0.8, `trainAccuracy terlalu rendah: ${stats.trainAccuracy}`);
  const cases = [
    ['kalikan 22 dengan 4', 'math'],
    ['macam mana nak backup mysql', 'howto'],
    ['apa itu css', 'define'],
    ['senarai aplikasi editing', 'list'],
    ['halo ai', 'general']
  ];
  let ok = 0;
  for (const [text, want] of cases) {
    if (minimodel.predict(model, text).label === want) ok += 1;
  }
  assert.ok(ok >= 4, `generalisasi lemah: ${ok}/${cases.length}`);
});

test('minimodel: save/load roundtrip — ramalan sama & fail sparse', () => {
  const { model } = minimodel.train(DATA, { epochs: 50, seed: 1, tri: 60 });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bm-')), 'm.json');
  minimodel.save(model, file, { name: 'test' });
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.format, 'tukuk-minimodel-v1');
  assert.equal(raw.sparse, true);
  assert.equal(raw.tri, 60);
  const loaded = minimodel.load(file);
  for (const t of ['apa itu cpu', 'hitung 9 kali 9', 'selamat malam']) {
    assert.deepEqual(minimodel.predict(loaded, t).probs, minimodel.predict(model, t).probs);
  }
  assert.equal(loaded.meta.name, 'test');
});

test('minimodel: predict sentiasa softmax sah (jumlah 1) & label sah', () => {
  const { model } = minimodel.train(DATA, { epochs: 10, seed: 3 });
  const r = minimodel.predict(model, 'soalan rawak tentang apa sahaja');
  assert.ok(model.classes.includes(r.label));
  const sum = Object.values(r.probs).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `probs tak normal: ${sum}`);
});

test('minimodel: terlalu sedikit contoh → ralat jelas', () => {
  assert.throws(() => minimodel.train([{ text: 'satu', label: 'math' }]), /too few/);
});

test('taskrouter: tanpa model fail → kelakuan regex lama (regresi)', () => {
  const prev = process.env.BRAIN_MODEL_FILE;
  process.env.BRAIN_MODEL_FILE = path.join(os.tmpdir(), 'tiada-model-' + Date.now() + '.json');
  const taskrouter = require('../src/brain/taskrouter');
  taskrouter._resetModelCache();
  assert.equal(taskrouter.modelInfo().loaded, false);
  assert.equal(taskrouter.classify('apa itu dns').kind, 'define');
  assert.equal(taskrouter.classify('12*7').arithmetic.value, 84);
  assert.equal(taskrouter.classify('cerita sikit').kind, 'general');
  process.env.BRAIN_MODEL_FILE = prev;
});

test('taskrouter: model selamatkan frasa yang regex lepas (with gate)', () => {
  // Latih model kecil dengan gaya frasa BARU yang regex tak nampak.
  const train = [];
  for (const p of [
    'nak tahu procedure mohon passport baru', 'method nak buat duit online', 'guide install linux',
    'macam mana nak senarai fail dalam folder', 'langkah upload ke server', 'cara tukar password email'
  ]) train.push({ text: p, label: 'howto' });
  for (const p of ['oi', 'test', 'hi there', 'ok lah']) train.push({ text: p, label: 'general' });
  const { model } = minimodel.train(train, { epochs: 200, lr: 0.4, l2: 3e-3, tri: 60, seed: 5, holdout: 0 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-int-'));
  const file = path.join(dir, 'tukuk-brain-v1.json');
  minimodel.save(model, file, { name: 'Tukuk-Brain Mini', version: 'test' });

  const prev = process.env.BRAIN_MODEL_FILE;
  process.env.BRAIN_MODEL_FILE = file;
  const taskrouter = require('../src/brain/taskrouter');
  taskrouter._resetModelCache();
  const info = taskrouter.modelInfo();
  assert.equal(info.loaded, true);
  assert.equal(info.name, 'Tukuk-Brain Mini');
  // Frasa yang regex LEPAS → model wajib selamatkan (yakin).
  assert.equal(taskrouter.classifyRawRegex('procedure mohon visa kerja').kind, 'general');
  assert.equal(taskrouter.classify('procedure mohon visa kerja').kind, 'howto');
  // Regex TETAP menang (model tak boleh override keputusan regex).
  assert.equal(taskrouter.classify('cara buat kuih').kind, 'howto');
  assert.equal(taskrouter.classify('12*7').pureMath, true);
  process.env.BRAIN_MODEL_FILE = prev;
  taskrouter._resetModelCache();
});
