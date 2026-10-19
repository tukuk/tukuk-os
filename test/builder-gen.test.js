'use strict';
// Ujian penjana auto Pembina (src/builder-gen.js). Murni — tiada pelayan/LLM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/builder-gen');

test('heuristicBuild: hasil app lengkap + tepat satu game, tema valid', () => {
  const a = g.heuristicBuild('kopi');
  assert.equal(a.appName, 'Kopi');
  assert.ok(a.theme.accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a.theme.accent), 'accent hex');
  const games = a.widgets.filter((w) => g.GAMES.includes(w.type));
  assert.equal(games.length, 1, 'tepat satu widget game');
  assert.ok(a.widgets.some((w) => w.type === 'heading'), 'ada heading');
  // deterministik: kata sama → hasil sama
  assert.deepEqual(g.heuristicBuild('kopi'), a);
});

test('pickGame: kata kunci → genre padan; lain → hash deterministik dalam GAMES', () => {
  assert.equal(g.pickGame('lari laju'), 'runner');
  assert.equal(g.pickGame('teka nombor'), 'guess');
  assert.equal(g.pickGame('tembak musuh'), 'br');
  assert.equal(g.pickGame('ingat padanan'), 'memory');
  const r = g.pickGame('xyzabc');
  assert.ok(g.GAMES.includes(r), 'fallback dalam senarai game');
  assert.equal(g.pickGame('xyzabc'), r);
});

test('parseGenJson: keluar objek pertama daripada fence/teks sekitar + sarang kurung', () => {
  assert.deepEqual(g.parseGenJson('{"a":1}'), { a: 1 });
  assert.deepEqual(g.parseGenJson('prefix ```json\n{"appName":"X"}\n``` suffix'), { appName: 'X' });
  assert.deepEqual(g.parseGenJson('ok {"w":{"x":{"y":2}}} done'), { w: { x: { y: 2 } } });
  assert.deepEqual(g.parseGenJson('{"t":"a}b\\"c"}'), { t: 'a}b"c' }); // kurung/quote dalam string diabaikan
  assert.equal(g.parseGenJson('tiada json'), null);
  assert.equal(g.parseGenJson('{tidak sah}'), null);
});

test('sanitizeApp: buang types unknown, clamp nombor, tolak warna jahat, had 16 widget', () => {
  const raw = {
    appName: '  Nama Panjang '.padEnd(80, 'x'),
    theme: { accent: '#38bdf8', bg: 'red;url(x)', fg: '#fff', dark: 'yes', sub: 's'.repeat(200), desc: 'd'.repeat(300) },
    widgets: [
      { type: 'heading', text: 'H', level: 99, align: 'middle' },
      { type: 'script', code: 'alert(1)' }, // unknown → dibuang
      { type: 'image', src: 'https://evil/x.png', alt: 'a' }, // src dipaksa kosong
      { type: 'counter', value: '42', step: -5 },
      ...Array.from({ length: 20 }, (_, i) => ({ type: 'divider', i }))
    ]
  };
  const s = g.sanitizeApp(raw);
  assert.equal(s.appName.length, 40, 'appName dipotong 40');
  assert.equal(s.theme.accent, '#38bdf8');
  assert.ok(!('bg' in s.theme), 'bg jahat ditolak');
  assert.equal(s.theme.fg, '#fff');
  assert.equal(s.theme.dark, undefined, 'bukan boolean → tiada');
  assert.equal(s.theme.sub.length, 80);
  const types = s.widgets.map((w) => w.type);
  assert.ok(!types.includes('script'), 'types unknown dibuang');
  assert.ok(!types.includes('unknown'), 'tiada script');
  const img = s.widgets.find((w) => w.type === 'image');
  assert.ok(!img.src || img.src === '', 'src image dikosongkan');
  const head = s.widgets.find((w) => w.type === 'heading');
  assert.equal(head.level, 3, 'level di-clamp ke maks 3');
  assert.equal(head.align, 'left', 'align unknown → fallback left');
  const ctr = s.widgets.find((w) => w.type === 'counter');
  assert.equal(ctr.value, 42, 'string angka → nombor');
  assert.equal(ctr.step, 1, 'step negatif → clamp min 1');
  assert.ok(s.widgets.length <= 16, 'had 16 widget');
});

test('sanitizeApp: input sampah → bentuk kosong yang selamat', () => {
  for (const bad of [null, undefined, 42, 'str', [], {}]) {
    const s = g.sanitizeApp(bad);
    assert.equal(typeof s.appName, 'string');
    assert.ok(Array.isArray(s.widgets));
    assert.equal(typeof s.theme, 'object');
  }
});

test('SYSTEM_PROMPT: nyatakan JSON sahaja + ada senarai types & game', () => {
  assert.ok(g.SYSTEM_PROMPT.includes('JSON'));
  for (const t of ['heading', 'quiz', 'br', 'fps', 'runner']) assert.ok(g.SYSTEM_PROMPT.includes(t), 'prompt sebut ' + t);
});

test('heuristicVariants: N calon berbeza (palet+game); salt 0 = heuristicBuild; tiap satu 1 game', () => {
  const vs = g.heuristicVariants('kopi', 3);
  assert.equal(vs.length, 3);
  assert.deepEqual(vs[0], g.heuristicBuild('kopi'), 'varian pertama sama dengan heuristicBuild');
  const accents = new Set(vs.map((v) => v.theme.accent));
  const games = new Set(vs.map((v) => (v.widgets.find((w) => g.GAMES.includes(w.type)) || {}).type));
  assert.ok(accents.size >= 2, 'palet berbeza antara varian');
  assert.ok(games.size >= 2, 'game berbeza antara varian');
  for (const v of vs) assert.equal(v.widgets.filter((w) => g.GAMES.includes(w.type)).length, 1, 'tepat satu game per calon');
  // clamp count
  assert.equal(g.heuristicVariants('x', 0).length, 1);
  assert.equal(g.heuristicVariants('x', 99).length, 6);
});

test('needsAI: pendek/genre game → false (jimat token); panjang/eksplisit → true', () => {
  assert.equal(g.needsAI('kopi'), false, 'satu patah → template');
  assert.equal(g.needsAI('snake game'), false, 'genre pendek → template');
  assert.equal(g.needsAI('teka nombor'), false, 'hint game padan → template');
  assert.equal(g.needsAI('kopi', { ai: true }), true, 'butang AI dipaksa');
  assert.equal(g.needsAI('aplikasi kedai dengan troli pembayaran dan inventori penjual'), true, 'brief panjang → AI');
  assert.equal(g.needsAI('buat app khas untuk gym'), true, 'kata kunci custom/khas → AI');
});

test('genCacheKey: normalisasi stabil; useAI & seed bezakan kunci', () => {
  const a = g.genCacheKey({ idea: ' Kopi ', style: 'Dark', seed: 0, count: 3 });
  const b = g.genCacheKey({ idea: 'kopi', style: 'dark', seed: 0, count: 3 });
  assert.equal(a, b, 'kasus/spasi dinormalkan');
  assert.notEqual(a, g.genCacheKey({ idea: 'kopi', style: 'dark', seed: 1, count: 3 }), 'seed bezakan');
  assert.notEqual(a, g.genCacheKey({ idea: 'kopi', style: 'dark', seed: 0, count: 3, useAI: true }), 'useAI bezakan');
});

test('style: gelap/dark → hanya palet gelap; cerah/minimalis → palet cerah', () => {
  for (let i = 0; i < 4; i++) {
    const d = g.buildOne('kopi', i, 'gelap');
    assert.ok(d.theme.dark === true || parseInt(String(d.theme.bg).slice(1, 3), 16) < 0x60, 'gelap → bg gelap (varian ' + i + ')');
  }
  for (let i = 0; i < 2; i++) {
    const l = g.buildOne('kopi', i, 'minimalis');
    assert.equal(l.theme.dark, false, 'minimalis → cerah (dark=false)');
  }
  // gaya kosong = tingkah laku asal (tak rosuh)
  assert.deepEqual(g.buildOne('kopi', 0, ''), g.heuristicBuild('kopi'));
});

test('heuristicVariants offset: Jana semula beri calon berbeza (salt beralih)', () => {
  const first = g.heuristicVariants('kopi', 3, '', 0);
  const next = g.heuristicVariants('kopi', 3, '', 1);
  const accA = first.map((v) => v.theme.accent).join(',');
  const accB = next.map((v) => v.theme.accent).join(',');
  assert.notEqual(accA, accB, 'offset mengubah set palet');
  assert.equal(next.length, 3);
});

test('opts.color: warna utama memaksa aksen + bg ikut luminans; hex jahat diabaikan', () => {
  const bright = g.buildOne('kopi', 0, '', { color: '#ffee66' }); // terang → bg gelap
  assert.equal(bright.theme.accent, '#ffee66');
  assert.equal(bright.theme.dark, true, 'aksen terang → latar gelap');
  const dark = g.buildOne('kopi', 0, '', { color: '#1133aa' }); // gelap → bg cerah
  assert.equal(dark.theme.accent, '#1133aa');
  assert.equal(dark.theme.dark, false, 'aksen gelap → latar cerah');
  const bad = g.buildOne('kopi', 0, '', { color: 'red' }); // bukan hex → abai, ikut palet asal
  assert.notEqual(bad.theme.accent, 'red');
  assert.deepEqual(bad, g.buildOne('kopi', 0, ''));
});

test('opts.lang: teks sentiasa Inggeris (laman English-sahaja)', () => {
  const en = g.buildOne('kopi', 0, '', { lang: 'English' });
  assert.match(en.widgets.find((w) => w.type === 'text').text, /All about/);
  const id = g.buildOne('kopi', 0, '', { lang: 'Indonesia' });
  assert.match(id.widgets.find((w) => w.type === 'text').text, /All about/, 'lang apa pun → Inggeris');
});

test('matchWords: saring berkaitan dua hala; kosong → []; cap n', () => {
  const list = [{ word: 'kopi' }, { word: 'roket' }, { word: 'kucing' }, { word: 'awan' }];
  assert.deepEqual(g.matchWords(list, 'kopi', 6).map((x) => x.word), ['kopi']);
  const ko = g.matchWords(list, 'ko', 6).map((x) => x.word);
  assert.ok(ko.includes('kopi') && !ko.includes('roket'), 'hanya yang mengandungi "ko"');
  assert.deepEqual(g.matchWords(list, '', 6), [], 'kuari kosong → []');
  assert.equal(g.matchWords(list, 'a', 1).length <= 1, true, 'cap dipatuhi');
});
