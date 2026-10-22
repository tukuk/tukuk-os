// ═══ Tests: brain/templates — 1 prompt → done straight away (the template library) ═══
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const templates = require('../src/brain/templates');

// ── REGISTRY ↔ disk ──────────────────────────────────────────────────────────
test('REGISTRY: every entry points at an .html file that really exists', () => {
  assert.ok(templates.REGISTRY.length >= 15, 'at least 15 app templates');
  for (const r of templates.REGISTRY) {
    const file = path.join(templates.TEMPLATES_DIR, `${r.key}.html`);
    assert.ok(fs.existsSync(file), `missing file for key: ${r.key}`);
  }
});

test('REGISTRY: consistent shape (unique key, kind game|app, non-empty hints)', () => {
  const seen = new Set();
  for (const r of templates.REGISTRY) {
    assert.ok(r.key && /^[a-z0-9]+$/.test(r.key), `invalid key: ${r.key}`);
    assert.ok(!seen.has(r.key), `duplicate key: ${r.key}`);
    seen.add(r.key);
    assert.ok(r.kind === 'game' || r.kind === 'app', `invalid kind: ${r.key}=${r.kind}`);
    assert.ok(typeof r.title === 'string' && r.title.length, `empty title: ${r.key}`);
    assert.ok(typeof r.hints === 'string' && r.hints.trim().length, `empty hints: ${r.key}`);
  }
});

// ── sanitize ─────────────────────────────────────────────────────────────────
test('sanitize: drops <script src>, <link> (theme.css/canonical/icon) and injects the theme', () => {
  const raw = '<!DOCTYPE html><html><head>'
    + '<link rel="stylesheet" href="/theme.css">'
    + '<link rel="canonical" href="https://tukuk.org/snake">'
    + '<link rel="icon" href="/favicon.ico">'
    + '<title>Snake</title></head><body>'
    + '<script src="/theme.js"></script>'
    + '<script>var x=1;</script></body></html>';
  const out = templates.sanitize(raw);
  assert.ok(!/<script[^>]*\bsrc=/i.test(out), 'no <script src=');
  assert.ok(!/<link\b/i.test(out), 'no <link>');
  assert.ok(out.includes('id="tk-theme"'), 'the theme token is injected');
  assert.ok(/<script>var x=1;<\/script>/.test(out), 'the inline script is kept');
  assert.match(out, /^\s*<!DOCTYPE html>/i, 'DOCTYPE comes first');
});

test('sanitize: the output is self-contained — no external http/https references', () => {
  for (const r of templates.REGISTRY) {
    const html = templates.get(r.key);
    assert.ok(html, `empty get: ${r.key}`);
    assert.ok(!/<script[^>]*\bsrc\s*=/i.test(html), `external script: ${r.key}`);
    assert.ok(!/<link\b/i.test(html), `external link: ${r.key}`);
    assert.match(html, /^\s*<!DOCTYPE html>/i, `DOCTYPE: ${r.key}`);
  }
});

// ── detect ───────────────────────────────────────────────────────────────────
test('detect: maps Malay/English descriptions → the right key', () => {
  const cases = [
    ['a simple calculator app', 'calc'],
    ['todolist tugas senarai', 'todo'],
  ];
  for (const [goal, expect] of cases) {
    const m = templates.detect(goal);
    assert.ok(m, `no match for: ${goal}`);
    assert.equal(m.key, expect, `expected ${expect} got ${m.key} for: ${goal}`);
  }
});

test('detect: null for empty / unrelated text', () => {
  assert.equal(templates.detect(''), null);
  assert.equal(templates.detect('   '), null);
  assert.equal(templates.detect('zzz qqq www'), null);
});

test('detect: avoids substrings inside words (regression "ber"+"bil"+"ang" → tip)', () => {
  // "bil" is a tip hint; as a substring it also appears inside "berbilang". Matching
  // must be word-based → no match rather than 'tip'.
  const m = templates.detect('aplikasi berbilang modul gudang automatik');
  assert.ok(!m || m.key !== 'tip', 'must not match tip through the substring "bil"');
});

test('detect: deterministic result (tie → stable hash)', () => {
  const a = templates.detect('snake ular');
  const b = templates.detect('snake ular');
  assert.deepEqual(a, b, 'two identical calls → identical result');
});

// ── nearest ──────────────────────────────────────────────────────────────────
test('nearest: app → a REGISTRY entry; game → null (no hardcoded games left)', () => {
  const ap = templates.nearest('xyz no match at all', 'app');
  assert.ok(ap && ap.kind === 'app', 'nearest app → app');
  assert.equal(templates.nearest('xyz no match at all', 'game'), null, 'no games in REGISTRY → null');
});

// ── personalize ──────────────────────────────────────────────────────────────
test('personalize: updates <title> + <h1> + accent, keeps the structure', () => {
  const html = '<!DOCTYPE html><html><head><title>Old</title></head>'
    + '<body><h1>Old Heading</h1><p>content</p></body></html>';
  const out = templates.personalize(html, { name: 'My Shop', accent: '#ff8800' });
  assert.match(out, /<title>My Shop<\/title>/, 'the title is replaced');
  assert.ok(out.includes('<h1>My Shop</h1>'), 'the h1 is replaced');
  assert.ok(out.includes('--accent:#ff8800'), 'the accent is injected');
  assert.ok(out.includes('<p>content</p>'), 'the content is untouched');
});

test('personalize: escapes HTML in the name (prevents injection)', () => {
  const out = templates.personalize('<title>x</title><h1>y</h1>', { name: '<script>bad</script>' });
  assert.ok(!/<title><script>/.test(out), 'the name is escaped inside title');
});

test('personalize: an accent that is not valid hex is ignored', () => {
  const out = templates.personalize('<head></head>', { accent: 'red' });
  assert.ok(!out.includes('--accent:red'), 'an invalid accent is ignored');
});

// ── get ──────────────────────────────────────────────────────────────────────
test('get: known key → <!DOCTYPE html; wrong key → null', () => {
  const h = templates.get('notes');
  assert.match(h, /^\s*<!DOCTYPE html>/i);
  assert.equal(templates.get('no-such-key'), null);
});

// ── list ─────────────────────────────────────────────────────────────────────
test('list: the gallery summary mirrors REGISTRY (no HTML payloads)', () => {
  const items = templates.list();
  assert.equal(items.length, templates.REGISTRY.length);
  for (const it of items) {
    assert.deepEqual(Object.keys(it).sort(), ['genre', 'ic', 'key', 'kind', 'title']);
  }
});

// ── extractHtml ──────────────────────────────────────────────────────────────
test('extractHtml: pulls the document out of a ``` fence and from messy text', () => {
  const fenced = 'Here you go:\n```html\n<!DOCTYPE html><html><body><canvas></canvas></body></html>\n```\nDone.';
  const doc = templates.extractHtml(fenced);
  assert.ok(doc && /^<!DOCTYPE html>/i.test(doc), 'the fence is extracted');
  assert.ok(doc.endsWith('</html>'), 'cut off at </html>');
  const bare = 'prefix <!DOCTYPE html><html><h1>hi</h1></html> suffix';
  assert.ok(templates.extractHtml(bare), 'DOCTYPE without a fence');
  assert.equal(templates.extractHtml('no html at all'), null);
});

// ── LLM_SYS ──────────────────────────────────────────────────────────────────
test('LLM_SYS: self-contained instructions (no external resources, single file)', () => {
  assert.ok(/self-contained/i.test(templates.LLM_SYS));
  assert.ok(/NEVER reference any external resource/i.test(templates.LLM_SYS));
});
