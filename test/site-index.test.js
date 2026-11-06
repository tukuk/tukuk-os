// ═══ Tests: /index — the site's own table of contents ═══
// The index is generated from the registries (SITE_NAV, tool shelves, academy
// tracks, book subjects, recipe shelves, the geo registry), so the contract is
// that a cluster which EXISTS is also LISTED — plus the page answers 200 with
// indexable chrome and the master sitemap advertises it.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');
const CATS = require('../src/tool-categories');
const books = require('../src/books');
const rcp = require('../src/recipes');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function indexHtml() {
  const res = await fetch(base + '/index');
  assert.equal(res.status, 200);
  return res.text();
}

test('GET /index renders the index chrome', async () => {
  const html = await indexHtml();
  assert.match(html, /<title>Site Index[^<]*<\/title>/);
  assert.ok(html.includes('href="https://tukuk.org/index"'), 'canonical must be /index');
  assert.ok(html.includes('<meta name="robots" content="index,follow">'), 'the index is indexable');
  assert.ok(html.includes('"@type":"CollectionPage"'), 'CollectionPage JSON-LD expected');
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no literal undefined in rendered markup');
});

test('the index links every tool shelf, academy track and recipe shelf', async () => {
  const html = await indexHtml();
  for (const c of CATS.CATEGORIES) assert.ok(html.includes(`href="/alat/c/${c.id}"`), `missing tool shelf ${c.id}`);
  assert.ok(html.includes('href="/alat"'), 'must link the tools hub');
  assert.ok(html.includes('href="/academy/sky"') && html.includes('href="/academy/thinking"'), 'missing academy tracks');
  for (const s of rcp.SECTIONS) assert.ok(html.includes(`href="/recipes/${s.slug}"`), `missing recipe shelf ${s.slug}`);
});

test('the index lists every book subject and every geo directory hub', async () => {
  const html = await indexHtml();
  const missingBooks = books.SUBJECTS.filter((s) => !html.includes(`href="/books/${encodeURIComponent(s.slug)}"`));
  assert.deepEqual(missingBooks.map((s) => s.slug).slice(0, 5), [], 'book subjects missing from the index');
  // A spread of geo hubs, from the obvious to the deep tail of the registry.
  for (const p of ['/mountains', '/lakes', '/geoglyphs', '/brochs', '/texas-counties', '/conservation-areas']) {
    assert.ok(html.includes(`href="${p}"`), `geo directory ${p} missing from the index`);
  }
});

test('a sample of index links actually resolves', async () => {
  const html = await indexHtml();
  for (const p of ['/today', '/proverbs', '/elements', '/messier', '/cities', '/conservation-areas', '/records', '/history']) {
    assert.ok(html.includes(`href="${p}"`), `index must link ${p}`);
    const res = await fetch(base + p);
    assert.equal(res.status, 200, `${p} from the index must resolve`);
  }
});

test('the master sitemap advertises /index and the footer links it', async () => {
  const sm = await (await fetch(base + '/sitemap.xml')).text();
  assert.ok(sm.includes('/index</loc>'), 'the master sitemap must carry the site index');
  const html = await indexHtml();
  assert.ok(html.includes('href="/index"'), 'the nav/footer chrome must link the index');
});
