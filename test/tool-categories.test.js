// ═══ Tests: the /alat taxonomy ═══
// The category model is what keeps a thousand-tool hub navigable: one shelf per tool,
// one page per shelf, and a chip row that links shelves instead of every tool ever
// written. Two ways that silently rot — a tool whose cat is a typo, and a shelf id
// that no CATEGORIES entry declares — are both pinned here, because in each case the
// page still renders and only the navigation is quietly wrong.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const CATS = require('../src/tool-categories');
const toolbox = require('../src/toolbox');

test('every declared shelf carries the fields the hub renders', () => {
  for (const c of CATS.CATEGORIES) {
    for (const k of ['id', 'ic', 'name', 'blurb']) {
      assert.equal(typeof c[k], 'string', `${c.id}: ${k} must be a string`);
      assert.ok(c[k].length > 0, `${c.id}: ${k} is empty`);
    }
    assert.match(c.id, /^[a-z0-9-]+$/, `${c.id} has to be usable in a URL`);
    assert.ok(Array.isArray(c.about) && c.about.length >= 2, `${c.id}: a shelf page needs real prose`);
    // The AdSense policy is >150 words of content per page; two substantial
    // paragraphs is the minimum a shelf page can be built out of.
    const words = c.about.join(' ').split(/\s+/).length;
    assert.ok(words > 120, `${c.id}: shelf copy is only ${words} words`);
  }
});

test('shelf ids are unique and the byId map agrees with the list', () => {
  const ids = CATS.CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'a duplicated id would shadow a shelf');
  assert.equal(Object.keys(CATS.byId).length, ids.length);
  ids.forEach((id) => assert.equal(CATS.byId[id].id, id));
});

test('no slug is mapped to an undeclared shelf', () => {
  const orphans = Object.keys(CATS.CAT_BY_SLUG).filter((s) => !CATS.byId[CATS.CAT_BY_SLUG[s]]);
  assert.deepEqual(orphans, [], `mapped at a category nobody declares: ${orphans.join(', ')}`);
});

test('every registry tool sits on exactly one declared shelf', () => {
  const homeless = toolbox.TOOLKIT.filter((t) => !CATS.byId[t.cat]);
  assert.deepEqual(homeless.map((t) => t.slug), [], 'tools with no shelf would vanish from the hub');
});

test('the registry and the slug map never disagree', () => {
  // A tool added with an explicit cat that contradicts CAT_BY_SLUG is the drift
  // this pins: the hub would file it under one shelf and the map promises another.
  for (const t of toolbox.TOOLKIT) {
    if (!CATS.CAT_BY_SLUG[t.slug]) continue;
    assert.equal(t.cat, CATS.CAT_BY_SLUG[t.slug], `${t.slug}: registry cat differs from the map`);
  }
});

test('an unknown slug falls to the default shelf instead of disappearing', () => {
  assert.equal(CATS.catOf('brand-new-thing'), CATS.DEFAULT_CAT);
  assert.equal(CATS.catOf('/alat/brand-new-thing'), CATS.DEFAULT_CAT, 'hrefs and slugs must agree');
  assert.equal(CATS.catOf(''), CATS.DEFAULT_CAT);
  assert.ok(CATS.byId[CATS.DEFAULT_CAT], 'the default has to be a declared shelf');
});

test('a category page exists for every shelf the hub links', () => {
  // The hub builds /alat/c/<id> from CATEGORIES, so an id that is not URL-safe or
  // is duplicated would either 404 from the hub or shadow another shelf.
  const toolIds = new Set(toolbox.TOOLKIT.map((t) => t.slug));
  assert.ok(!toolIds.has('all'), '/alat/all would be shadowed by a tool called "all"');
  assert.ok(!toolIds.has('c'), '/alat/c/:shelf would collide with a tool called "c"');
});
