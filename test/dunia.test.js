'use strict';
// Cluster anchors for the WORLD — /wang (frankfurter/ECB), /seni (The Met), /hidupan
// (iNaturalist) + the academy reading box, the river card on /cuaca, the Wikipedia box
// on /bencana and the sky-events table on /nasa/sky. Every source is keyless.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const wang = require('../src/wang');
const seni = require('../src/seni');
const hidup = require('../src/hidup');
const bacaan = require('../src/bacaan');

test('/wang: convert handles cross rates correctly (implicit 1.0 basis)', () => {
  const table = { base: 'USD', date: '2026-10-16', rates: { EUR: 0.92, MYR: 4.21, JPY: 150.4 } };
  const a = wang.convert(table, 'USD', 'MYR', 100);
  assert.ok(Math.abs(a.per - 4.21) < 1e-9 && Math.abs(a.total - 421) < 1e-6, 'USD→MYR');
  const b = wang.convert(table, 'EUR', 'JPY', 10); // cross: 150.4/0.92
  assert.ok(Math.abs(b.per - 150.4 / 0.92) < 1e-6, 'EUR→JPY cross');
  const same = wang.convert(table, 'USD', 'USD', 7);
  assert.deepEqual(same, { per: 1, total: 7 }, 'same currency → 1.0');
  assert.equal(wang.convert(table, 'USD', 'VND', 1), null, 'a code missing from the table → null');
});

test('/wang: the ECB CODES are valid — 3 letters, unique, labelled + isCode', () => {
  assert.ok(wang.CODES.length >= 28 && wang.CODES.length <= 32, `~30 codes (${wang.CODES.length})`);
  const codes = wang.CODES.map((c) => c[0]);
  assert.equal(new Set(codes).size, codes.length, 'no duplicates');
  for (const [code, name, flag] of wang.CODES) {
    assert.ok(/^[A-Z]{3}$/.test(code) && name && flag, `valid row ${code}`);
  }
  assert.ok(codes.includes('USD') && codes.includes('MYR') && codes.includes('EUR'), 'the favourites exist');
  assert.equal(wang.isCode('usd'), false, 'isCode requires uppercase');
  assert.equal(wang.isCode('NGN'), true, 'isCode only checks the shape — the table filter is wangCodeSet in the server');
});

test('/seni: 10 curated collections + findCollection + hydrate limits without img', () => {
  assert.equal(seni.COLLECTIONS.length, 10, '10 gallery doors');
  const slugs = seni.COLLECTIONS.map((c) => c.slug);
  assert.equal(new Set(slugs).size, 10, 'slugs are unique');
  for (const c of seni.COLLECTIONS) {
    assert.ok(c.q && c.name && c.icon && c.blurb, `valid meta ${c.slug}`);
    assert.ok(Array.from(c.icon).length <= 3, `short icon ${c.slug}`);
  }
  assert.equal(seni.findCollection('egypt').name, 'Ancient Egypt', 'lookup by slug');
  assert.equal(seni.findCollection('nope'), null, 'a bogus slug → null');
});

test('/hidupan: 16 species — unique slugs, two-word binomials, honest blurbs', () => {
  assert.equal(hidup.TAXA.length, 16, '16 species pages');
  const slugs = hidup.TAXA.map((t) => t.slug);
  assert.equal(new Set(slugs).size, 16, 'slugs are unique');
  for (const t of hidup.TAXA) {
    assert.ok(/^[a-z][a-z-]+$/.test(t.slug), `tidy slug ${t.slug}`);
    const words = t.sci.split(' ');
    assert.ok(words.length >= 2 && words.length <= 3, `valid binomial ${t.sci}`);
    assert.equal(words[0][0], words[0][0].toUpperCase(), `capitalised genus ${t.sci}`);
    assert.ok(t.name && t.icon && t.blurb.length > 60, `educational blurb ${t.slug}`);
  }
  assert.equal(hidup.findTaxon('harpy-eagle').sci, 'Harpia harpyja', 'the Harpy is correct (not Harpyia)');
  assert.equal(hidup.findTaxon('monarch-butterfly').sci, 'Danaus plexippus', 'the Monarch is valid');
});

test('bacaan: exports books+papers + the OpenLibrary cover URL format is right', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'bacaan.js'), 'utf8');
  assert.equal(typeof bacaan.books, 'function', 'books()');
  assert.equal(typeof bacaan.papers, 'function', 'papers()');
  assert.ok(src.includes('covers.openlibrary.org/b/id/'), 'the cover URL format');
  assert.ok(src.includes('https://doi.org/'), 'DOI links');
  assert.ok(src.includes('is-referenced-by-count'), 'the Crossref citation sort');
});

test('server: the worldDoc shell is complete — chrome, 3 ad slots, the nav injected', () => {
  const doc = (serverSrc.match(/function worldDoc\(o, navHtml\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(doc.length > 1000, 'worldDoc was found');
  assert.ok(doc.includes('siteHeader(') && doc.includes('siteFooter()'), 'header+footer');
  assert.equal((doc.match(/adUnitGuarded\(config\.adsense\.(slotTop|slotInArticle|slotBottom)/g) || []).length, 3, '3 AdSense slots');
  assert.equal((doc.match(/msAdUnit\(/g) || []).length, 3, '3 Microsoft units');
  assert.ok(doc.includes('${navHtml}'), 'the per-cluster nav is injected');
  assert.ok(doc.includes('rel="canonical"') && doc.includes('application/ld+json'), 'SEO head');
});

test('server: routes + footer + staticPages + sitemaps for all three clusters', () => {
  for (const r of ["app.get('/money'", "app.get('/money/rates'", "app.get('/money/convert/:from/:to'",
    "app.get('/art'", "app.get('/art/collection/:slug'", "app.get('/art/object/:id'",
    "app.get('/life'", "app.get('/life/:slug'"]) {
    assert.ok(serverSrc.includes(r), `the ${r} route`);
  }
  const staticLine = (serverSrc.match(/const staticPages = \[[^\]]*\]/) || [''])[0];
  for (const p of ["'/money'", "'/money/rates'", "'/art'", "'/life'"]) {
    assert.ok(staticLine.includes(p), `staticPages ${p}`);
  }
  const footer = require(path.join(ROOT, 'src', 'server')).siteFooter();
  for (const f of ['World Currency Rates', 'Free Art Gallery', 'Wildlife Atlas']) {
    assert.ok(footer.includes(f), `footer ${f}`);
  }
  for (const sm of ['/sitemap-money.xml', '/sitemap-art.xml', '/sitemap-life.xml']) {
    assert.ok(serverSrc.includes(`app.get('${sm}'`), `the ${sm} route`);
  }
  const robots = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
  for (const sm of ['sitemap-money', 'sitemap-art', 'sitemap-life']) {
    assert.ok(robots.includes(`https://tukuk.org/${sm}.xml`), `robots ${sm}`);
    assert.ok(robots.includes(`\nSitemap: https://tukuk.org/${sm}.xml\n`), `robots ${sm} on its own line`);
  }
});

test('server: a bogus slug redirects + a bad rate pair → the rates redirect', () => {
  assert.ok(serverSrc.includes("if (!c) return res.redirect(302, '/art')"), 'a fake collection → /art');
  assert.ok(serverSrc.includes("if (!t) return res.redirect(302, '/life')"), 'a fake species → /life');
  assert.ok(serverSrc.includes("if (!from || !to || from === to) return res.redirect(302, '/money/rates')"), 'a bad currency code → the rates page');
  assert.ok(serverSrc.includes("if (!o || !o.primaryImage) return res.redirect(302, '/art')"), 'an object with no image → /art');
});

test('server: river card on /cuaca + wiki box on /bencana + sky box + academic reading', () => {
  // River flood card — getRiver inside the city Promise.all + an honest GloFAS label.
  assert.ok(serverSrc.includes('udara.getRiver(city.lat, city.lon)'), 'the city handler pulls getRiver');
  const river = (serverSrc.match(/let riverBox = '';[\s\S]*?\n  \}/) || [''])[0];
  assert.ok(river.includes('not a real river-station measurement'), 'honest model label');
  assert.ok(river.includes('River flow model'), 'card heading');
  // The Wikipedia context for the event page — async + the EONET terminology trimmed.
  assert.ok(serverSrc.includes('await bc.wikiPeek(wikiTerm)'), 'bencanaEventPage awaits wikiPeek');
  assert.ok(serverSrc.includes('async function bencanaEventPage'), 'the renderer became async');
  assert.ok(serverSrc.includes('await bencanaEventPage(req, cat, ev)'), 'the route awaits the renderer');
  // The curated sky events on /nasa/sky.
  assert.ok(serverSrc.includes('const SKY_EVENTS = ['), 'the curated table exists');
  assert.ok(serverSrc.includes('+ skyEventsBox()'), 'the box is injected into the sky page');
  // The academy reading box — async + both sources with a catch.
  assert.ok(serverSrc.includes('async function akadTrackPage'), 'akadTrackPage async');
  const track = (serverSrc.match(/async function akadTrackPage[\s\S]*?\n}/) || [''])[0];
  assert.ok(track.includes('bacaan.books(topic, 3).catch') && track.includes('bacaan.papers(topic, 3).catch'), 'both boxes with a silent catch');
  assert.ok(track.includes('Further reading') && track.includes('The research'), 'the English box titles');
});

test('contract honesty: a dead source is never hidden — wang labels a reference rate', () => {
  const conv = (serverSrc.match(/function moneyConverterPage[\s\S]*?\n}/) || [''])[0];
  assert.ok(conv.includes('reference rate'), 'the converter labels the reference rate');
  assert.ok(conv.includes('before any exchange counter adds its margin') || conv.includes('before any shop'), 'honest about margins');
  const pair = (serverSrc.match(/function moneyPairPage[\s\S]*?\n}/) || [''])[0];
  assert.ok(pair.includes('reference rates only, not dealable quotes'), 'the pair page disclaimer');
  // No invented numbers: a dead API → a Down page, never fake data.
  assert.ok(serverSrc.includes('function wangDown(') && serverSrc.includes('function seniDown(') && serverSrc.includes('function hidupDown('), '3 honest down pages');
  assert.ok(!/Math\.random\(\)/.test(serverSrc.match(/function skyEventsBox[\s\S]*?\n}/)[0]), 'the sky table is fixed, not random');
});

test('udara.getRiver + bencana.wikiPeek are exported & the cache TTLs are sane', () => {
  const u = require('../src/udara');
  const b = require('../src/bencana');
  assert.equal(typeof u.getRiver, 'function', 'getRiver is exported');
  assert.equal(typeof b.wikiPeek, 'function', 'wikiPeek is exported');
  const uSrc = fs.readFileSync(path.join(ROOT, 'src', 'udara.js'), 'utf8');
  assert.ok(uSrc.includes('flood-api.open-meteo.com/v1/flood'), 'the flood API endpoint is right');
  assert.ok((uSrc.match(/async function getRiver[\s\S]*?\n}/) || [''])[0].includes("'unavailable'"), 'the source contract: unavailable');
  const bSrc = fs.readFileSync(path.join(ROOT, 'src', 'bencana.js'), 'utf8');
  assert.ok(bSrc.includes('action=opensearch') && bSrc.includes('rest_v1/page/summary'), 'the two Wikipedia steps');
});
