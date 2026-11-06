// ═══ Tests: /thesaurus, /rhymes, /idioms (batch 3) ═══
// The contract for this batch: three more CURATED language shelves. Anything
// off the shelf is a normal 404 — never a generated guess — the synonym rings
// carry the "when to pick which" notes that machine dumps skip, the rhyme
// families are keyed to sound rather than spelling, and every idiom origin is
// dated where the print trail is solid and hedged out loud where it is not.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');
const tesaurus = require('../src/tesaurus');
const rima = require('../src/rima');
const ungkapan = require('../src/ungkapan');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function get(p) {
  const res = await fetch(base + p);
  return { status: res.status, html: await res.text() };
}
const noUndefined = (html) => !/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, ''));

test('the rhyme shelf is curated: families keyed to sound, words checked twice', () => {
  assert.equal(rima.FAMILIES.length, 20);
  for (const f of rima.FAMILIES) {
    assert.match(f.slug, /^[a-z][a-z-]{1,15}$/, f.slug);
    assert.ok(f.sound.startsWith('/'), `${f.slug}: IPA-style sound`);
    assert.ok(f.words.length >= 8, `${f.slug}: a family, not a sample`);
    assert.ok(f.tip.length > 40, `${f.slug}: every family names its trap`);
    for (const w of f.words) assert.match(w, /^[a-z][a-z'-]{1,23}$/, `${f.slug}/${w}`);
  }
  assert.ok(rima.ALL_WORDS.length >= 200, `published set too small: ${rima.ALL_WORDS.length}`);
  assert.ok(rima.familiesOf('light').some((f) => f.slug === 'night'), 'light rhymes with night');
  assert.equal(rima.findFamily('nope'), null);
  assert.ok(!rima.isPublished('zxqf'), 'anything else is not a page of ours');
});

test('the thesaurus shelf: topics, senses with picks, and antonyms only where real', () => {
  assert.equal(tesaurus.TOPICS.length, 5);
  assert.equal(tesaurus.ENTRIES.length, 40);
  for (const t of tesaurus.TOPICS) assert.equal(tesaurus.wordsOfTopic(t.slug).length, 8, `${t.slug}: eight entries each`);
  for (const e of tesaurus.ENTRIES) {
    assert.ok(tesaurus.topicOf(e.topic), `${e.word}: topic exists`);
    assert.ok(e.senses.length >= 1 && e.senses.length <= 2, `${e.word}: sense count`);
    for (const s of e.senses) {
      assert.ok(s.pos && s.gloss && s.pick, `${e.word}: every sense has pos, gloss and pick`);
      assert.ok(s.syn.length >= 5, `${e.word}: a ring, not a pair`);
      assert.ok(s.pick.length > 30, `${e.word}: the discriminator note is real`);
    }
    assert.ok(Array.isArray(e.ant), `${e.word}: ant is a list (possibly empty)`);
  }
  assert.deepEqual(tesaurus.findEntry('big').ant, ['small', 'little']);
  assert.equal(tesaurus.findEntry('zxqfnotaword'), null);
  assert.ok(tesaurus.isPublished('happy') && !tesaurus.isPublished('zxqf'));
});

test('the idiom shelf: five themes, six idioms each, every origin written', () => {
  assert.equal(ungkapan.THEMES.length, 5);
  assert.equal(ungkapan.IDIOMS.length, 30);
  for (const t of ungkapan.THEMES) assert.equal(ungkapan.idiomsOfTheme(t.slug).length, 6, `${t.slug}: six per theme`);
  for (const i of ungkapan.IDIOMS) {
    assert.match(i.slug, /^[a-z0-9][a-z0-9-]{2,43}$/, i.slug);
    assert.ok(ungkapan.findTheme(i.theme), `${i.slug}: theme exists`);
    assert.ok(i.phrase.length > 3 && i.meaning.length > 15, `${i.slug}: phrase and meaning`);
    const last = i.phrase.split(' ').pop();
    assert.ok(i.example.toLowerCase().includes(last), `${i.slug}: example uses the phrase`);
    assert.ok(i.origin.length > 40, `${i.slug}: origin is written, not stubbed`);
  }
  // The honesty rule: debunked tales are called out, not repeated as fact.
  const cats = ungkapan.findIdiom('raining-cats-and-dogs');
  assert.match(cats.origin, /without evidence|modern invention/i);
  assert.equal(ungkapan.findIdiom('nope-slug'), null);
});

test('GET /thesaurus: hub with search form, topic rings, shared language nav', async () => {
  const { status, html } = await get('/thesaurus');
  assert.equal(status, 200);
  assert.match(html, /<title>Thesaurus[^<]*<\/title>/);
  assert.ok(html.includes('action="/alat/dictionary"'), 'the search box feeds the tool');
  for (const w of tesaurus.ALL_WORDS) assert.ok(html.includes(`/thesaurus/${w}`), `hub links ${w}`);
  assert.ok(html.includes('href="/rhymes"') && html.includes('href="/dictionary"'), 'language shelves cross-link');
  assert.ok(!/&amp;amp;/.test(html), 'no double-escaped entities');
  assert.ok(noUndefined(html));
});

test('thesaurus word pages: rings, picks, antonyms, chips that only link real pages', async () => {
  const w = await get('/thesaurus/happy');
  assert.equal(w.status, 200);
  assert.ok(w.html.includes('href="https://tukuk.org/thesaurus/happy"'), 'canonical');
  assert.ok(/\.ts-sense\{/.test(w.html) && w.html.includes('feeling pleasure or contentment'), 'sense cards with glosses');
  assert.ok(w.html.includes('<a href="/thesaurus/sad"'), 'published synonym becomes a chip link');
  const m = await get('/thesaurus/many');
  assert.ok(m.html.includes('<span>a host of</span>'), 'multi-word synonym stays plain text');
  const b = await get('/thesaurus/big');
  assert.ok(b.html.includes('The other end:'), 'antonyms listed');
  assert.ok(b.html.includes('<a href="/thesaurus/small"'), 'ants with pages link to them');
  assert.ok(b.html.includes('<span>little</span>'), 'ants without a page stay plain — no dead chips');
  assert.ok(!/&amp;amp;/.test(b.html) && noUndefined(b.html));
  assert.equal((await fetch(base + '/thesaurus/zxqfnotaword')).status, 404, 'off-shelf word is no page');
  assert.equal((await fetch(base + '/thesaurus/Big')).status, 404, 'only lowercase shelf slugs');
});

test('GET /rhymes: hub states the sound-not-spelling rule and lists all families', async () => {
  const { status, html } = await get('/rhymes');
  assert.equal(status, 200);
  assert.match(html, /<title>Rhymes[^<]*<\/title>/);
  assert.ok(/Rhyme lives in the sound, not the spelling/.test(html), 'the rule leads');
  assert.ok(/Write rhymes with night/.test(html) && /love does not rhyme with move/.test(html), 'the traps are named up front');
  assert.ok(/homophone/.test(html) && /feminine/.test(html), 'perfect vs slant vs feminine explained');
  for (const f of rima.FAMILIES) assert.ok(html.includes(`/rhymes/f/${f.slug}`), `hub links ${f.slug}`);
  assert.ok(!/&amp;amp;/.test(html) && noUndefined(html));
});

test('rhyme family and word pages: same sound, different spellings, honest tips', async () => {
  const f = await get('/rhymes/f/night');
  assert.equal(f.status, 200);
  assert.ok(f.html.includes('knight') && f.html.includes('write') && f.html.includes('/aɪt/'), 'family carries its spellings and its sound');
  assert.ok(f.html.includes('<a href="/rhymes/knight"'), 'members link to their own pages');
  assert.ok(/class="rm-tip"/.test(f.html), 'the tip block renders');

  const w = await get('/rhymes/knight');
  assert.equal(w.status, 200);
  assert.ok(w.html.includes('<a href="/rhymes/light"'), 'knight finds light across the spelling wall');
  assert.ok(!w.html.includes('<a href="/rhymes/knight"'), 'a word never rhymes with itself');
  assert.equal((await fetch(base + '/rhymes/f/nope')).status, 404);
  assert.equal((await fetch(base + '/rhymes/zzznotaword')).status, 404, 'off-shelf word is no page');
  assert.equal((await fetch(base + '/rhymes/Knight')).status, 404, 'only lowercase shelf slugs');
});

test('GET /idioms: hub, theme pages, and idiom pages with dated or hedged origins', async () => {
  const hub = await get('/idioms');
  assert.equal(hub.status, 200);
  assert.ok(/frozen history/.test(hub.html), 'the frame leads');
  assert.ok(/The hedging is the point/.test(hub.html), 'honesty section present');
  for (const t of ungkapan.THEMES) assert.ok(hub.html.includes(`/idioms/t/${t.slug}`), `hub links ${t.slug}`);

  const th = await get('/idioms/t/body');
  assert.equal(th.status, 200);
  assert.ok(th.html.includes('/idioms/play-it-by-ear'), 'theme lists its idioms');
  assert.ok(!/&amp;amp;/.test(th.html), 'theme names with & escape exactly once');

  const i = await get('/idioms/spill-the-beans');
  assert.equal(i.status, 200);
  assert.ok(i.html.includes('reveal a secret'), 'meaning printed');
  assert.ok(/class="idm-example"/.test(i.html), 'example block present');
  assert.ok(i.html.includes('Where it comes from'), 'origin section present');
  assert.ok(!/&amp;amp;/.test(i.html) && noUndefined(i.html));

  assert.equal((await fetch(base + '/idioms/nope-slug')).status, 404, 'off-shelf phrase is no page');
  assert.equal((await fetch(base + '/idioms/t/nope')).status, 404);
});

test('sitemap + /index carry all three shelves', async () => {
  const sm = await (await fetch(base + '/sitemap.xml')).text();
  for (const p of ['/thesaurus', '/thesaurus/big', '/rhymes', '/rhymes/f/night', '/rhymes/knight', '/idioms', '/idioms/t/body', '/idioms/spill-the-beans']) {
    assert.ok(sm.includes(`${p}</loc>`), `sitemap must list ${p}`);
  }
  const idx = await get('/index');
  assert.equal(idx.status, 200);
  assert.ok(idx.html.includes('Thesaurus'), '/index lists the thesaurus');
  assert.ok(idx.html.includes('Rhymes'), '/index lists the rhymes shelf');
  assert.ok(idx.html.includes('Idioms'), '/index lists the idiom shelf');
});
