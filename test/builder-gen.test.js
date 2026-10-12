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
