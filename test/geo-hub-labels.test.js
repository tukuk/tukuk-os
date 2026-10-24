'use strict';
// Geo cluster labels: the browse pills and "Other continents" lists are built from
// REGIONS objects ({ name, slug, count }), so interpolating the object straight into the
// template rendered "[object Object]" as the anchor text on every hub and continent page —
// visible to readers and to crawlers, which is what this test guards.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const HUBS = ['/cities', '/heritage', '/conservation-areas', '/mountains', '/lakes', '/islands', '/volcanoes', '/impact-craters'];
const REGIONS = [
  ['/cities/europe', 'africa'],
  ['/heritage/africa', 'europe'],
  ['/conservation-areas/asia', 'africa'],
  ['/mountains/africa', 'europe'],
  ['/lakes/asia', 'africa'],
  ['/islands/africa', 'europe'],
  ['/volcanoes/europe', 'asia'],
  ['/impact-craters/africa', 'europe'],
];

for (const path of HUBS) {
  test(`GET ${path} labels every continent by name, not by object`, async () => {
    const res = await fetch(base + path);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes('[object Object]'), 'a REGIONS object leaked into the markup');
    // The browse strip is `<a class="btn ghost" ...>Africa (23)</a>` — name then count.
    assert.match(html, /href="\/[a-z-]+\/africa">Africa( \(\d+\))?<\/a>/, 'Africa pill missing its label');
  });
}

for (const [path, other] of REGIONS) {
  test(`GET ${path} lists the other continents by name`, async () => {
    const res = await fetch(base + path);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes('[object Object]'), 'a REGIONS object leaked into the markup');
    assert.ok(html.includes(`>${other[0].toUpperCase()}${other.slice(1)}</a>`), `"${other}" link in the other-continents list is not labelled`);
  });
}

test('/store redirects to the OS shell instead of 404ing', async () => {
  const res = await fetch(base + '/store', { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/os');
});

test('no page links to the retired /store storefront', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const links = [...src.matchAll(/href="\/store"/g)];
  assert.equal(links.length, 0, 'a hardcoded /store link survived the redirect');
});
