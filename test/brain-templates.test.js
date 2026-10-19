// ═══ Tests: brain/templates — 1 prompt → terus siap (perpustakaan templat) ═══
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const templates = require('../src/brain/templates');

// ── REGISTRY ↔ cakera ────────────────────────────────────────────────────────
test('REGISTRY: setiap entri tunjuk fail .html yang benar-benar wujud', () => {
  assert.ok(templates.REGISTRY.length >= 40, 'sekurang-kurangnya 40 templat');
  for (const r of templates.REGISTRY) {
    const file = path.join(templates.TEMPLATES_DIR, `${r.key}.html`);
    assert.ok(fs.existsSync(file), `fail hilang untuk key: ${r.key}`);
  }
});

test('REGISTRY: struktur konsisten (key unik, kind game|app, hints tak kosong)', () => {
  const seen = new Set();
  for (const r of templates.REGISTRY) {
    assert.ok(r.key && /^[a-z0-9]+$/.test(r.key), `key tak sah: ${r.key}`);
    assert.ok(!seen.has(r.key), `key berganda: ${r.key}`);
    seen.add(r.key);
    assert.ok(r.kind === 'game' || r.kind === 'app', `kind tak sah: ${r.key}=${r.kind}`);
    assert.ok(typeof r.title === 'string' && r.title.length, `tajuk kosong: ${r.key}`);
    assert.ok(typeof r.hints === 'string' && r.hints.trim().length, `hints kosong: ${r.key}`);
  }
});

// ── sanitize ─────────────────────────────────────────────────────────────────
test('sanitize: buang <script src>, <link> (theme.css/canonical/icon) & suntik tema', () => {
  const raw = '<!DOCTYPE html><html><head>'
    + '<link rel="stylesheet" href="/theme.css">'
    + '<link rel="canonical" href="https://tukuk.org/snake">'
    + '<link rel="icon" href="/favicon.ico">'
    + '<title>Snake</title></head><body>'
    + '<script src="/theme.js"></script>'
    + '<script>var x=1;</script></body></html>';
  const out = templates.sanitize(raw);
  assert.ok(!/<script[^>]*\bsrc=/i.test(out), 'tiada <script src=');
  assert.ok(!/<link\b/i.test(out), 'tiada <link>');
  assert.ok(out.includes('id="tk-theme"'), 'token tema suntik');
  assert.ok(/<script>var x=1;<\/script>/.test(out), 'inline script dikekalkan');
  assert.match(out, /^\s*<!DOCTYPE html>/i, 'DOKErTYPE hadapan');
});

test('sanitize: output self-contained — tiada rujukan http/https luar', () => {
  for (const r of templates.REGISTRY) {
    const html = templates.get(r.key);
    assert.ok(html, `get kosong: ${r.key}`);
    assert.ok(!/<script[^>]*\bsrc\s*=/i.test(html), `script luar: ${r.key}`);
    assert.ok(!/<link\b/i.test(html), `link luar: ${r.key}`);
    assert.match(html, /^\s*<!DOCTYPE html>/i, `DOCTYPE: ${r.key}`);
  }
});

// ── detect ───────────────────────────────────────────────────────────────────
test('detect: petakan huraian ms/en → key yang betul', () => {
  const cases = [
    ['buat game tic tac toe', 'tictactoe'],
    ['snake ular makan tumbuh', 'snake'],
    ['a simple calculator app', 'calc'],
    ['todolist tugas senarai', 'todo'],
    ['game 2048 geser gabung tile', 'number2048'],
    ['minesweeper ranjau bendera', 'mines'],
  ];
  for (const [goal, expect] of cases) {
    const m = templates.detect(goal);
    assert.ok(m, `tiada padanan untuk: ${goal}`);
    assert.equal(m.key, expect, `jangka ${expect} dpt ${m.key} untuk: ${goal}`);
  }
});

test('detect: null untuk teks kosong / tak berkaitan', () => {
  assert.equal(templates.detect(''), null);
  assert.equal(templates.detect('   '), null);
  assert.equal(templates.detect('zzz qqq www'), null);
});

test('detect: keputusan deterministik (seri → hash stabil)', () => {
  const a = templates.detect('snake ular');
  const b = templates.detect('snake ular');
  assert.deepEqual(a, b, 'dua panggilan sama → keputusan sama');
});

// ── nearest ──────────────────────────────────────────────────────────────────
test('nearest: sentiasa pulang entri REGISTRY ikut kind', () => {
  const g = templates.nearest('xyz takde padanan', 'game');
  assert.ok(g && g.kind === 'game', 'nearest game → game');
  const ap = templates.nearest('xyz takde padanan', 'app');
  assert.ok(ap && ap.kind === 'app', 'nearest app → app');
  assert.ok(templates.REGISTRY.some((r) => r.key === g.key), 'nearest dalam registry');
});

// ── personalize ──────────────────────────────────────────────────────────────
test('personalize: kemas kini <title> + <h1> + accent, struktur kekal', () => {
  const html = '<!DOCTYPE html><html><head><title>Lama</title></head>'
    + '<body><h1>Tajuk Lama</h1><p>isi</p></body></html>';
  const out = templates.personalize(html, { name: 'Kedai Saya', accent: '#ff8800' });
  assert.match(out, /<title>Kedai Saya<\/title>/, 'title diganti');
  assert.match(out, /<h1>Kedai Saya<\/h1>/, 'h1 diganti');
  assert.ok(out.includes('--accent:#ff8800'), 'accent disuntik');
  assert.ok(out.includes('<p>isi</p>'), 'isi tak disentuh');
});

test('personalize: escape HTML pada nama (elak sisipan)', () => {
  const out = templates.personalize('<title>x</title><h1>y</h1>', { name: '<script>bad</script>' });
  assert.ok(!/<title><script>/.test(out), 'nama di-escape dalam title');
});

test('personalize: accent bukan hex sah diabaikan', () => {
  const out = templates.personalize('<head></head>', { accent: 'red' });
  assert.ok(!out.includes('--accent:red'), 'accent haram diabaikan');
});

// ── get ──────────────────────────────────────────────────────────────────────
test('get: kunci diketahui → HTML <!DOCTYPE; kunci salah → null', () => {
  const h = templates.get('snake');
  assert.match(h, /^\s*<!DOCTYPE html>/i);
  assert.equal(templates.get('tiada-kunci-ini'), null);
});

// ── list ─────────────────────────────────────────────────────────────────────
test('list: ringkasan galeri sepadan REGISTRY (tiada HTML)', () => {
  const items = templates.list();
  assert.equal(items.length, templates.REGISTRY.length);
  for (const it of items) {
    assert.deepEqual(Object.keys(it).sort(), ['genre', 'ic', 'key', 'kind', 'title']);
  }
});

// ── extractHtml ──────────────────────────────────────────────────────────────
test('extractHtml: keluar dokumen daripada ``` fence & teks berselirat', () => {
  const fenced = 'Here you go:\n```html\n<!DOCTYPE html><html><body><canvas></canvas></body></html>\n```\nDone.';
  const doc = templates.extractHtml(fenced);
  assert.ok(doc && /^<!DOCTYPE html>/i.test(doc), 'fence diekstrak');
  assert.ok(doc.endsWith('</html>'), 'potong sampai </html>');
  const bare = 'prefix <!DOCTYPE html><html><h1>hi</h1></html> suffix';
  assert.ok(templates.extractHtml(bare), 'DOCTYPE tanpa fence');
  assert.equal(templates.extractHtml('tiada html langsung'), null);
});

// ── LLM_SYS ──────────────────────────────────────────────────────────────────
test('LLM_SYS: arahan self-contained (tiada sumber luar, satu fail)', () => {
  assert.ok(/self-contained/i.test(templates.LLM_SYS));
  assert.ok(/NEVER reference any external resource/i.test(templates.LLM_SYS));
});
