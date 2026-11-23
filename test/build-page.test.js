'use strict';
// /build — the no-AI Tukuk Builder page. The subdomain build.tukuk.org never got an
// edge route (CPU-only box, one tunnel), so every "Build an app" link on the site now
// points at this same-origin page which drives /api/builder/build with ai=off. These
// tests pin the promise: the page renders, its inline script actually parses, no link
// leaks back to the dead subdomain, and the template pipeline can be told to skip AI.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('../src/server');

let srv = null;
let base = '';
async function get(pathname, opts) {
  if (!base) {
    srv = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      srv.once('listening', resolve);
      srv.once('error', reject);
    });
    base = `http://127.0.0.1:${srv.address().port}`;
  }
  return fetch(base + pathname, opts);
}
after(() => { if (srv) srv.close(); });

test('GET /build renders the Builder page with a sane head and the form', async () => {
  const res = await get('/build');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('id="bd-idea"'), 'the idea input exists');
  assert.ok(html.includes('id="bd-go"'), 'the build button exists');
  const cards = html.match(/class="world-card"/g) || [];
  assert.ok(cards.length >= 5, `the template gallery is server-rendered (${cards.length} cards)`);
  const d = (html.match(/<meta name="description" content="([^"]*)">/) || [])[1] || '';
  assert.ok(d.length >= 50 && d.length <= 160, `meta description in band (${d.length})`);
});

test('the Builder inline script parses — no stray parentheses in the page JS', async () => {
  const html = await (await get('/build')).text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.includes('bd-go'));
  assert.equal(scripts.length, 1, 'exactly one builder IIFE on the page');
  assert.doesNotThrow(() => new Function(scripts[0]), 'inline script must be valid JS');
});

test('no user-facing link points at the dead build.tukuk.org any more', async () => {
  for (const p of ['/', '/build', '/games', '/apps/chat', '/os']) {
    const res = await get(p);
    if (res.status !== 200) continue; // /os may gate on the chat host locally
    const html = await res.text();
    assert.ok(!html.includes('href="https://build.tukuk.org'), `${p} links to the dead subdomain`);
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  // The CSP frame allowlist and the watchdog keep knowing the host; nothing user-facing does.
  const hrefs = src.match(/href="https:\/\/build\.tukuk\.org[^"]*"/g) || [];
  assert.equal(hrefs.length, 0, `no href to build.tukuk.org may remain (${hrefs.join(', ')})`);
});

test('/builder 301s to /build, and ai=off is honoured by the pipeline source', async () => {
  const res = await get('/builder', { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/build');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.match(src, /const noAI = body\.ai === 'off'/, 'the API reads the no-AI flag');
  assert.match(src, /if \(!html && !noAI && config\.brain\.enabled/, 'stage 2 (the LLM) is skipped when noAI');
});
