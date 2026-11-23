// ═══ Tests: /dictionary, /horoscope, /health expansion ═══
// The contract for this batch: the dictionary is a CURATED shelf (a word not on
// it is a normal 404, never an API proxy), the zodiac pages always carry the
// entertainment frame and the real astronomy, and every added health topic
// keeps the disclaimer + urgent-list + sources chrome of the original six.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');
const diction = require('../src/diction');
const bintang = require('../src/bintang');
const sihat = require('../src/sihat');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function get(p) {
  const res = await fetch(base + p);
  return { status: res.status, html: await res.text() };
}

test('the dictionary shelf is curated: real words, sane slugs, a finite set', () => {
  assert.ok(diction.COLLECTIONS.length >= 6, 'at least six collections');
  for (const c of diction.COLLECTIONS) {
    assert.match(c.slug, /^[a-z-]+$/);
    assert.ok(c.words.length >= 20, `${c.slug} carries a shelf, not a sample`);
    for (const w of c.words) assert.match(w, /^[a-z][a-z'-]{1,23}$/, `${c.slug}/${w}`);
  }
  assert.ok(diction.ALL_WORDS.length >= 150, `published set too small: ${diction.ALL_WORDS.length}`);
  assert.ok(diction.isPublished('rain') && diction.isPublished('kettle'));
  assert.ok(!diction.isPublished('zxqf'), 'anything else is not a page of ours');
  assert.ok(diction.collectionsOf('rain').some((c) => c.slug === 'weather'));
});

test('the zodiac module is twelve signs and the daily line is a fixed rule', () => {
  assert.equal(bintang.SIGNS.length, 12);
  const l = bintang.pickLine('leo', '2026-11-06');
  assert.ok(l && l.length > 20);
  assert.equal(bintang.pickLine('leo', '2026-11-06'), l, 'same sign + date must never change');
  assert.notEqual(bintang.pickLine('leo', '2026-11-07'), l, 'or repeat helplessly the next day');
  assert.equal(bintang.pickLine('leo', 'not-a-date'), null);
  assert.equal(bintang.findSign('kitty'), null);
  const c = bintang.compatFor('leo');
  assert.deepEqual(c.peers.slice().sort(), ['aries', 'sagittarius'], 'fire peers');
  assert.equal(c.opposite, 'aquarius', 'six signs across the wheel');
});

test('GET /dictionary: hub with search form, every collection, the WordNet credit', async () => {
  const { status, html } = await get('/dictionary');
  assert.equal(status, 200);
  assert.match(html, /<title>Dictionary[^<]*<\/title>/);
  assert.ok(html.includes('action="/alat/dictionary"'), 'the search box feeds the tool');
  for (const c of diction.COLLECTIONS) assert.ok(html.includes(`/dictionary/c/${c.slug}`), `hub links ${c.slug}`);
  assert.ok(/Princeton WordNet/.test(html), 'the bank is credited');
  assert.ok(!/&amp;amp;/.test(html), 'no double-escaped entities');
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
});

test('collection pages list their words; word pages are real entries; the rest 404s', async () => {
  const col = await get('/dictionary/c/weather');
  assert.equal(col.status, 200);
  assert.ok(col.html.includes('/dictionary/drizzle'), 'shelf words link out');
  assert.ok(col.html.includes('Where these words come from'));
  assert.ok(!/&amp;amp;/.test(col.html), 'shelf names with & must escape exactly once');
  assert.equal((await fetch(base + '/dictionary/c/nope')).status, 404);

  const w = await get('/dictionary/rain');
  assert.equal(w.status, 200);
  assert.ok(w.html.includes('href="https://tukuk.org/dictionary/rain"'), 'canonical');
  assert.ok(/DefinedTerm/.test(w.html), 'definition ld');
  // Neighbours are whatever sits either side of 'rain' on the weather shelf —
  // assert them from the module so reordering words never breaks this test.
  const shelf = diction.findCollection('weather').words;
  const ri = shelf.indexOf('rain');
  assert.ok(w.html.includes(`/dictionary/${shelf[ri - 1]}`) && w.html.includes(`/dictionary/${shelf[ri + 1]}`), 'shelf neighbours link');
  assert.ok(!/&amp;amp;/.test(w.html), 'no double-escaped entities');
  assert.equal((await fetch(base + '/dictionary/blahbogusword')).status, 404, 'unpublished word is not a page');
  assert.equal((await fetch(base + '/dictionary/Rain')).status, 404, 'only lowercase shelf slugs');
});

test('GET /horoscope: all twelve signs under the honest frame', async () => {
  const { status, html } = await get('/horoscope');
  assert.equal(status, 200);
  assert.match(html, /<title>The Zodiac, Honestly[^<]*<\/title>/);
  assert.ok(/fun page, not a forecast/.test(html), 'the frame leads');
  for (const s of bintang.SIGNS) assert.ok(html.includes(`/horoscope/${s.slug}`), `hub links ${s.slug}`);
  assert.ok(/Ophiuchus/.test(html) && /precession/.test(html), 'the real astronomy is present');
});

test('every sign page carries line, profile, lore, compatibility — all labelled', async () => {
  for (const s of bintang.SIGNS) {
    const { status, html } = await get(`/horoscope/${s.slug}`);
    assert.equal(status, 200, `${s.slug} must be live`);
    assert.ok(/fun page, not a forecast/.test(html), `${s.slug}: frame`);
    assert.ok(/entertainment<\/span>/.test(html), `${s.slug}: the line is badged`);
    assert.ok(html.includes(`ruled by ${s.ruler}`), `${s.slug}: profile`);
    assert.ok(html.includes(s.lore.slice(0, 40)), `${s.slug}: lore present`);
    const c = bintang.compatFor(s.slug);
    assert.ok(html.includes(`/horoscope/${c.peers[0]}`), `${s.slug}: compatibility links`);
    assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), `${s.slug}: no undefined`);
  }
  assert.equal((await fetch(base + '/horoscope/kitty')).status, 404);
});

test('health grew to twelve topics and the new ones keep every rule', async () => {
  assert.ok(sihat.TOPICS.length >= 12, `expected ≥12 topics, got ${sihat.TOPICS.length}`);
  const hub = await get('/health');
  assert.ok(hub.html.includes('ordinary topics'), 'hub wording follows the count');
  for (const t of sihat.TOPICS.slice(6)) {
    const { status, html } = await get(`/health/${t.slug}`);
    assert.equal(status, 200, `/health/${t.slug} must be live`);
    assert.ok(/not medical advice/.test(html), `${t.slug}: disclaimer`);
    assert.ok(/Whose number it is/.test(html), `${t.slug}: facts table`);
    assert.ok(/See a doctor without delay/.test(html), `${t.slug}: urgent block`);
    for (const s of t.sources) assert.ok(html.includes(s.u.slice(8, 40)), `${t.slug}: source ${s.t}`);
  }
});

test('sitemap + /index carry the shelf, the zodiac and the new topics', async () => {
  const sm = await (await fetch(base + '/sitemap.xml')).text();
  for (const p of ['/dictionary', '/dictionary/rain', '/dictionary/c/weather', '/horoscope', '/horoscope/leo', '/health/eyes', '/health/cold']) {
    assert.ok(sm.includes(`${p}</loc>`), `sitemap must list ${p}`);
  }
  const idx = await get('/index');
  assert.equal(idx.status, 200);
  assert.ok(idx.html.includes('The Zodiac, Honestly'), '/index lists the zodiac');
  assert.ok(idx.html.includes('/dictionary'), '/index lists the dictionary');
  assert.ok(idx.html.includes('Eyes ') || idx.html.includes('Eyes &'), '/index lists a new health topic');
});
