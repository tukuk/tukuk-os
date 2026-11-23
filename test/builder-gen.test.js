'use strict';
// Tests for the Builder auto-generator (src/builder-gen.js). Pure — no server/LLM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/builder-gen');

test('heuristicBuild: a complete app + exactly one game, valid theme', () => {
  const a = g.heuristicBuild('coffee');
  assert.equal(a.appName, 'Coffee');
  assert.ok(a.theme.accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a.theme.accent), 'accent is hex');
  const games = a.widgets.filter((w) => g.GAMES.includes(w.type));
  assert.equal(games.length, 1, 'exactly one game widget');
  assert.ok(a.widgets.some((w) => w.type === 'heading'), 'there is a heading');
  // deterministic: same word → same result
  assert.deepEqual(g.heuristicBuild('coffee'), a);
});

test('pickGame: keyword → matching genre; otherwise a deterministic hash inside GAMES', () => {
  assert.equal(g.pickGame('lari laju'), 'runner');
  assert.equal(g.pickGame('teka nombor'), 'guess');
  assert.equal(g.pickGame('tembak musuh'), 'br');
  assert.equal(g.pickGame('ingat padanan'), 'memory');
  const r = g.pickGame('xyzabc');
  assert.ok(g.GAMES.includes(r), 'the fallback is in the game list');
  assert.equal(g.pickGame('xyzabc'), r);
});

test('parseGenJson: extracts the first object from fences/surrounding text + nested brackets', () => {
  assert.deepEqual(g.parseGenJson('{"a":1}'), { a: 1 });
  assert.deepEqual(g.parseGenJson('prefix ```json\n{"appName":"X"}\n``` suffix'), { appName: 'X' });
  assert.deepEqual(g.parseGenJson('ok {"w":{"x":{"y":2}}} done'), { w: { x: { y: 2 } } });
  assert.deepEqual(g.parseGenJson('{"t":"a}b\\"c"}'), { t: 'a}b"c' }); // brackets/quotes inside a string are ignored
  assert.equal(g.parseGenJson('no json here'), null);
  assert.equal(g.parseGenJson('{not valid}'), null);
});

test('sanitizeApp: drops unknown types, clamps numbers, rejects hostile colours, caps at 16 widgets', () => {
  const raw = {
    appName: '  Long Name '.padEnd(80, 'x'),
    theme: { accent: '#38bdf8', bg: 'red;url(x)', fg: '#fff', dark: 'yes', sub: 's'.repeat(200), desc: 'd'.repeat(300) },
    widgets: [
      { type: 'heading', text: 'H', level: 99, align: 'middle' },
      { type: 'script', code: 'alert(1)' }, // unknown → dropped
      { type: 'image', src: 'https://evil/x.png', alt: 'a' }, // src is forced empty
      { type: 'counter', value: '42', step: -5 },
      ...Array.from({ length: 20 }, (_, i) => ({ type: 'divider', i }))
    ]
  };
  const s = g.sanitizeApp(raw);
  assert.equal(s.appName.length, 40, 'appName is cut to 40');
  assert.equal(s.theme.accent, '#38bdf8');
  assert.ok(!('bg' in s.theme), 'the hostile bg is rejected');
  assert.equal(s.theme.fg, '#fff');
  assert.equal(s.theme.dark, undefined, 'not a boolean → absent');
  assert.equal(s.theme.sub.length, 80);
  const types = s.widgets.map((w) => w.type);
  assert.ok(!types.includes('script'), 'unknown types are dropped');
  assert.ok(!types.includes('unknown'), 'no script left');
  const img = s.widgets.find((w) => w.type === 'image');
  assert.ok(!img.src || img.src === '', 'the image src is emptied');
  const head = s.widgets.find((w) => w.type === 'heading');
  assert.equal(head.level, 3, 'level is clamped to a max of 3');
  assert.equal(head.align, 'left', 'unknown align → fallback left');
  const ctr = s.widgets.find((w) => w.type === 'counter');
  assert.equal(ctr.value, 42, 'a numeric string → number');
  assert.equal(ctr.step, 1, 'a negative step → clamped to min 1');
  assert.ok(s.widgets.length <= 16, 'cap of 16 widgets');
});

test('sanitizeApp: garbage input → a safe empty shape', () => {
  for (const bad of [null, undefined, 42, 'str', [], {}]) {
    const s = g.sanitizeApp(bad);
    assert.equal(typeof s.appName, 'string');
    assert.ok(Array.isArray(s.widgets));
    assert.equal(typeof s.theme, 'object');
  }
});

test('SYSTEM_PROMPT: states JSON-only + lists the types and games', () => {
  assert.ok(g.SYSTEM_PROMPT.includes('JSON'));
  for (const t of ['heading', 'quiz', 'br', 'fps', 'runner']) assert.ok(g.SYSTEM_PROMPT.includes(t), 'the prompt mentions ' + t);
});

test('heuristicVariants: N different candidates (palette+game); salt 0 = heuristicBuild; each has 1 game', () => {
  const vs = g.heuristicVariants('coffee', 3);
  assert.equal(vs.length, 3);
  assert.deepEqual(vs[0], g.heuristicBuild('coffee'), 'the first variant equals heuristicBuild');
  const accents = new Set(vs.map((v) => v.theme.accent));
  const games = new Set(vs.map((v) => (v.widgets.find((w) => g.GAMES.includes(w.type)) || {}).type));
  assert.ok(accents.size >= 2, 'different palettes across variants');
  assert.ok(games.size >= 2, 'different games across variants');
  for (const v of vs) assert.equal(v.widgets.filter((w) => g.GAMES.includes(w.type)).length, 1, 'exactly one game per candidate');
  // clamp count
  assert.equal(g.heuristicVariants('x', 0).length, 1);
  assert.equal(g.heuristicVariants('x', 99).length, 6);
});

test('needsAI: short/game genre → false (saves tokens); long/explicit → true', () => {
  assert.equal(g.needsAI('coffee'), false, 'a single word → template');
  assert.equal(g.needsAI('snake game'), false, 'short genre → template');
  assert.equal(g.needsAI('teka nombor'), false, 'a matching game hint → template');
  assert.equal(g.needsAI('coffee', { ai: true }), true, 'the AI button is forced');
  assert.equal(g.needsAI('a shop application with a payment trolley and seller inventory'), true, 'a long brief → AI');
  assert.equal(g.needsAI('buat app khas untuk gym'), true, 'the custom/khas keyword → AI');
});

test('genCacheKey: stable normalisation; useAI and seed make the key differ', () => {
  const a = g.genCacheKey({ idea: ' Coffee ', style: 'Dark', seed: 0, count: 3 });
  const b = g.genCacheKey({ idea: 'coffee', style: 'dark', seed: 0, count: 3 });
  assert.equal(a, b, 'case/whitespace are normalised');
  assert.notEqual(a, g.genCacheKey({ idea: 'coffee', style: 'dark', seed: 1, count: 3 }), 'the seed differs');
  assert.notEqual(a, g.genCacheKey({ idea: 'coffee', style: 'dark', seed: 0, count: 3, useAI: true }), 'useAI differs');
});

test('style: gelap/dark → dark palettes only; cerah/minimalis → light palettes', () => {
  for (let i = 0; i < 4; i++) {
    const d = g.buildOne('coffee', i, 'gelap');
    assert.ok(d.theme.dark === true || parseInt(String(d.theme.bg).slice(1, 3), 16) < 0x60, 'gelap → dark bg (variant ' + i + ')');
  }
  for (let i = 0; i < 2; i++) {
    const l = g.buildOne('coffee', i, 'minimalis');
    assert.equal(l.theme.dark, false, 'minimalis → light (dark=false)');
  }
  // an empty style = the original behaviour (no regression)
  assert.deepEqual(g.buildOne('coffee', 0, ''), g.heuristicBuild('coffee'));
});

test('heuristicVariants offset: Regenerate yields different candidates (the salt moves on)', () => {
  const first = g.heuristicVariants('coffee', 3, '', 0);
  const next = g.heuristicVariants('coffee', 3, '', 1);
  const accA = first.map((v) => v.theme.accent).join(',');
  const accB = next.map((v) => v.theme.accent).join(',');
  assert.notEqual(accA, accB, 'the offset changes the palette set');
  assert.equal(next.length, 3);
});

test('opts.color: the main colour forces the accent + bg by luminance; hostile hex is ignored', () => {
  const bright = g.buildOne('coffee', 0, '', { color: '#ffee66' }); // bright → dark bg
  assert.equal(bright.theme.accent, '#ffee66');
  assert.equal(bright.theme.dark, true, 'a bright accent → dark background');
  const dark = g.buildOne('coffee', 0, '', { color: '#1133aa' }); // dark → light bg
  assert.equal(dark.theme.accent, '#1133aa');
  assert.equal(dark.theme.dark, false, 'a dark accent → light background');
  const bad = g.buildOne('coffee', 0, '', { color: 'red' }); // not hex → ignored, original palette
  assert.notEqual(bad.theme.accent, 'red');
  assert.deepEqual(bad, g.buildOne('coffee', 0, ''));
});

test('opts.lang: the text is always English (an English-only site)', () => {
  const en = g.buildOne('coffee', 0, '', { lang: 'English' });
  assert.match(en.widgets.find((w) => w.type === 'text').text, /All about/);
  const id = g.buildOne('coffee', 0, '', { lang: 'Indonesia' });
  assert.match(id.widgets.find((w) => w.type === 'text').text, /All about/, 'any lang → English');
});

test('matchWords: two-way relevance filter; empty → []; cap n', () => {
  const list = [{ word: 'coffee' }, { word: 'rocket' }, { word: 'cat' }, { word: 'cloud' }];
  assert.deepEqual(g.matchWords(list, 'coffee', 6).map((x) => x.word), ['coffee']);
  const co = g.matchWords(list, 'co', 6).map((x) => x.word);
  assert.ok(co.includes('coffee') && !co.includes('rocket'), 'only the ones containing "co"');
  assert.deepEqual(g.matchWords(list, '', 6), [], 'an empty query → []');
  assert.equal(g.matchWords(list, 'a', 1).length <= 1, true, 'the cap is honoured');
});
