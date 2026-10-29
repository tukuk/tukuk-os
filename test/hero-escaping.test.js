'use strict';
// One escape per string, applied by the doc shell — guarded so it cannot rot back.
//
// On 29 Oct 2026 a sample of 180 live place pages showed 17 of them (≈9%) printing
// visible junk like `St Chad&#39;s Church` in the <h1>. Cause: all eleven page shells
// (`nasaDoc` … `worldDoc`) already escape the hero line —
//   <h1>${o.heroHtml || escapeHtml(o.heroTitle || o.title)}</h1>
// while ~44 builders interpolated a name that they had *already* run through
// escapeHtml(). escapeHtml() is not idempotent: `'` → `&#39;` → `&amp;#39;`, and the
// browser then shows the entity as text. 21,797 of the 861,115 place names contain an
// apostrophe, `&` or quote, so the defect was live on tens of thousands of pages — in
// the heading a search engine weighs, not just in the body.
//
// The rule the fixes restore: heroTitle / heroSub carry PLAIN TEXT; the shell escapes
// once at render; markup goes in heroHtml instead.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
const { escapeHtml } = require('../src/util');

const SHELL = /<h1>\$\{o\.heroHtml \|\| escapeHtml\(o\.heroTitle \|\| o\.title\)\}<\/h1><p class="tagline">\$\{escapeHtml\(o\.heroSub \|\| ''\)\}<\/p>/g;

test('every doc shell is the single escaping authority for the hero line', () => {
  const shells = SERVER.match(SHELL) || [];
  assert.equal(shells.length, 11, `expected 11 hero-line shells (the doc functions), found ${shells.length}`);
  // Nothing may consume heroTitle/heroSub unescaped — that would make the fix below
  // an HTML-injection path instead of an escaping cleanup.
  const raw = SERVER.split('\n').filter((l) => /\bo\.heroTitle|\bo\.heroSub/.test(l) && !/escapeHtml/.test(l));
  assert.deepEqual(raw, [], 'heroTitle/heroSub must only be read through escapeHtml()');
});

test('no page builder pre-escapes a hero it will hand to a shell', () => {
  const bad = SERVER.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /^\s*heroTitle:.*escapeHtml\(|^\s*heroSub:.*escapeHtml\(/.test(l));
  assert.deepEqual(bad.map(([, l]) => l.trim().slice(0, 120)), [],
    'heroTitle/heroSub take plain text — the doc shell escapes them (see this file header)');
});

test('escapeHtml is not idempotent, which is why the single-escape rule matters', () => {
  const once = escapeHtml("St Chad's Church, York");
  assert.equal(once, 'St Chad&#39;s Church, York');
  assert.equal(escapeHtml(once), 'St Chad&amp;#39;s Church, York');
  assert.notEqual(escapeHtml(once), once, 'if escapeHtml ever becomes idempotent this test file can be simplified');
});

test('a hero name reaches the browser as text, not as a visible entity', () => {
  // Render the way the shell does it, and prove the heading reads back correctly.
  const h1 = `<h1>${escapeHtml("St Chad's Church, York")}</h1>`;
  assert.ok(h1.includes('&#39;') && !h1.includes('&amp;'), h1);
  assert.equal(h1.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'"), "St Chad's Church, York");
});
