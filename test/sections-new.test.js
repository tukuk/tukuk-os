// ═══ Tests: /word, /health, /nasa/launches, /nasa/iss/pass ═══
// The contract for the 2026-11 additions: deterministic selection for the word
// archive, sourced-figure chrome for health (disclaimer + urgent block on every
// page), and the two NASA pages render as real pages or as an honest 503 — an
// empty 200 is never acceptable. Registries must feed the sitemap and /index.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');
const words = require('../src/words');
const sihat = require('../src/sihat');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function get(p) {
  const res = await fetch(base + p);
  return { status: res.status, html: await res.text() };
}

test('the word bank is real-sized, and the pick is a stable function of the date', () => {
  assert.ok(words.WORDS.length >= 150, `bank too small: ${words.WORDS.length}`);
  assert.ok(words.WORDS.every((w) => /^[a-z-]{4,15}$/.test(w)), 'every entry lower-case a-z/hyphen, 4-15 chars');
  const a = words.pickForDate('2026-11-06');
  assert.ok(a && words.WORDS.includes(a));
  assert.equal(words.pickForDate('2026-11-06'), a, 'same date must give the same word forever');
  assert.notEqual(words.pickForDate('2026-11-07'), a, 'neighbouring dates must differ');
  assert.equal(words.pickForDate('not-a-date'), null);
});

test('GET /word serves today with a definition, recent strip and language nav', async () => {
  const { status, html } = await get('/word');
  assert.equal(status, 200);
  assert.match(html, /<title>Word of the Day:[^<]*<\/title>/);
  assert.ok(html.includes(`href="https://tukuk.org/word/${new Date().toISOString().slice(0, 10)}"`), 'canonical = today');
  assert.ok(/The last fifteen days/.test(html), 'recent strip expected');
  assert.ok(/Where the meaning comes from/.test(html), 'sourcing prose expected');
  assert.ok(html.includes('/alat/dictionary'), 'link to the dictionary tool');
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no literal undefined');
});

test('GET /word/:date is permanent; malformed dates fall through to 404', async () => {
  const { status, html } = await get('/word/2026-01-01');
  assert.equal(status, 200);
  assert.ok(html.includes('href="https://tukuk.org/word/2026-01-01"'), 'canonical = the requested date');
  assert.ok(html.includes(words.pickForDate('2026-01-01')), 'the body must carry that day\'s word');
  for (const bad of ['/word/garbage', '/word/1999-01-01', '/word/2026-13-40']) {
    assert.equal((await fetch(base + bad)).status, 404, `${bad} must be a normal 404`);
  }
});

test('GET /health is the hub: six cards, disclaimer first', async () => {
  const { status, html } = await get('/health');
  assert.equal(status, 200);
  assert.match(html, /<title>Health Basics[^<]*<\/title>/);
  assert.ok(/not medical advice/.test(html), 'disclaimer must be on the page');
  for (const t of sihat.TOPICS) assert.ok(html.includes(`/health/${t.slug}`), `hub must link ${t.slug}`);
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
});

test('every health topic page carries sourced figures, an urgent list and sources', async () => {
  for (const t of sihat.TOPICS) {
    const { status, html } = await get(`/health/${t.slug}`);
    assert.equal(status, 200, `/health/${t.slug} must be live`);
    assert.ok(/not medical advice/.test(html), `${t.slug}: disclaimer`);
    assert.ok(/Whose number it is/.test(html), `${t.slug}: facts table header`);
    assert.ok(/See a doctor without delay/.test(html), `${t.slug}: urgent block`);
    assert.ok(/rel="nofollow noopener"/.test(html), `${t.slug}: outbound sources rel`);
    for (const s of t.sources) assert.ok(html.includes(s.u.slice(8, 40)), `${t.slug}: source link ${s.t} must appear`);
  }
  assert.equal((await fetch(base + '/health/cures-cancer')).status, 404, 'unknown slug = normal 404');
});

test('GET /nasa/launches: a real schedule page or an honest 503, never an empty 200', async () => {
  const { status, html } = await get('/nasa/launches');
  assert.ok(status === 200 || status === 503, `unexpected status ${status}`);
  if (status === 200) {
    assert.match(html, /<title>Rocket Launch Schedule[^<]*<\/title>/);
    assert.ok(html.includes('href="https://tukuk.org/nasa/launches"'));
    assert.ok(/Launch Library 2/.test(html), 'the feed must be credited');
    assert.ok(/How to read a launch schedule/.test(html), 'educational prose expected');
    assert.ok(/nasa-table/.test(html), 'the schedule table expected');
    assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
  }
});

test('GET /nasa/iss/pass answers any coordinates, indexed base, noindex query', async () => {
  const plain = await get('/nasa/iss/pass');
  assert.equal(plain.status, 200);
  assert.ok(/When Will the ISS Be Visible Over You/.test(plain.html));
  assert.ok(plain.html.includes('content="index,follow,max-image-preview:large"'), 'base page indexed');
  assert.ok(plain.html.includes('/nasa/iss/pass?lat=3.15'), 'city quick-links expected');
  const q = await get('/nasa/iss/pass?lat=51.51&lon=-0.13');
  assert.equal(q.status, 200);
  assert.ok(q.html.includes('content="noindex,follow"'), 'coordinate views are noindex');
  assert.ok(/Why the ISS is visible at all/.test(q.html), 'prose must be present either way');
  const bad = await get('/nasa/iss/pass?lat=999&lon=0');
  assert.ok(bad.status === 200 || bad.status === 503, 'invalid coords fall back to the base form or busy page');
});

test('sitemap + cross-nav + /index carry every new page', async () => {
  // In tests the host is 127.0.0.1, so the sitemap's base is relative to that —
  // match the path against the closing tag instead of a hardcoded hostname.
  const sm = await (await fetch(base + '/sitemap.xml')).text();
  for (const p of ['/nasa/launches', '/nasa/iss/pass', '/word', '/health', '/health/sleep', '/health/temperature']) {
    assert.ok(sm.includes(`${p}</loc>`), `sitemap must list ${p}`);
  }
  // The NASA cross-nav is generated from NASA_SECTIONS — both new pages must show on every NASA page.
  const moon = await get('/nasa/moon');
  assert.ok(moon.html.includes('href="/nasa/launches"') && moon.html.includes('href="/nasa/iss/pass"'), 'cross-nav');
  const idx = await get('/index');
  assert.equal(idx.status, 200);
  assert.ok(idx.html.includes('Word of the Day'), '/index lists /word');
  assert.ok(idx.html.includes('Health Basics'), '/index lists /health');
  assert.ok(idx.html.includes('/nasa/launches'), '/index lists the NASA complex including launches');
});
