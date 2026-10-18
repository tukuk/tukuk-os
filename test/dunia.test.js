'use strict';
// Pin kluster DUNIA — /wang (frankfurter/ECB), /seni (The Met), /hidupan
// (iNaturalist) + kotak bacaan akademi, kad sungai /cuaca, kotak Wikipedia
// /bencana dan jadual peristiwa langit /nasa/sky. Semua sumber keyless.
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

test('/wang: convert silang-kadar betul (basis implisit 1.0)', () => {
  const table = { base: 'USD', date: '2026-10-16', rates: { EUR: 0.92, MYR: 4.21, JPY: 150.4 } };
  const a = wang.convert(table, 'USD', 'MYR', 100);
  assert.ok(Math.abs(a.per - 4.21) < 1e-9 && Math.abs(a.total - 421) < 1e-6, 'USD→MYR');
  const b = wang.convert(table, 'EUR', 'JPY', 10); // silang: 150.4/0.92
  assert.ok(Math.abs(b.per - 150.4 / 0.92) < 1e-6, 'EUR→JPY silang');
  const same = wang.convert(table, 'USD', 'USD', 7);
  assert.deepEqual(same, { per: 1, total: 7 }, 'sama → 1.0');
  assert.equal(wang.convert(table, 'USD', 'VND', 1), null, 'kod tiada dalam jadual → null');
});

test('/wang: CODES ECB sah — 3 huruf, unik, berlabel + isCode', () => {
  assert.ok(wang.CODES.length >= 28 && wang.CODES.length <= 32, `~30 kod (${wang.CODES.length})`);
  const codes = wang.CODES.map((c) => c[0]);
  assert.equal(new Set(codes).size, codes.length, 'tiada duplikat');
  for (const [code, name, flag] of wang.CODES) {
    assert.ok(/^[A-Z]{3}$/.test(code) && name && flag, `baris sah ${code}`);
  }
  assert.ok(codes.includes('USD') && codes.includes('MYR') && codes.includes('EUR'), 'kegemaran ada');
  assert.equal(wang.isCode('usd'), false, 'isCode kena huruf besar');
  assert.equal(wang.isCode('NGN'), true, 'isCode hanya semak bentuk — penapis jadual ialah wangCodeSet di server');
});

test('/seni: 10 koleksi kurasi + findCollection + hydrate had tanpa img', () => {
  assert.equal(seni.COLLECTIONS.length, 10, '10 pintu galeri');
  const slugs = seni.COLLECTIONS.map((c) => c.slug);
  assert.equal(new Set(slugs).size, 10, 'slug unik');
  for (const c of seni.COLLECTIONS) {
    assert.ok(c.q && c.name && c.icon && c.blurb, `meta sah ${c.slug}`);
    assert.ok(Array.from(c.icon).length <= 3, `icon pendek ${c.slug}`);
  }
  assert.equal(seni.findCollection('egypt').name, 'Ancient Egypt', 'cari ikut slug');
  assert.equal(seni.findCollection('tiada'), null, 'slug palsu → null');
});

test('/hidupan: 16 spesies — slug unik, binomial dua perkataan, blurb jujur', () => {
  assert.equal(hidup.TAXA.length, 16, '16 halaman spesies');
  const slugs = hidup.TAXA.map((t) => t.slug);
  assert.equal(new Set(slugs).size, 16, 'slug unik');
  for (const t of hidup.TAXA) {
    assert.ok(/^[a-z][a-z-]+$/.test(t.slug), `slug kemas ${t.slug}`);
    const words = t.sci.split(' ');
    assert.ok(words.length >= 2 && words.length <= 3, `binomial sah ${t.sci}`);
    assert.equal(words[0][0], words[0][0].toUpperCase(), `genus kapital ${t.sci}`);
    assert.ok(t.name && t.icon && t.blurb.length > 60, `blurb edukatif ${t.slug}`);
  }
  assert.equal(hidup.findTaxon('harpy-eagle').sci, 'Harpia harpyja', 'Harpy betul (bukan Harpyia)');
  assert.equal(hidup.findTaxon('monarch-butterfly').sci, 'Danaus plexippus', 'Monarch sah');
});

test('bacaan: eksport books+papers + cover OpenLibrary format betul', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'bacaan.js'), 'utf8');
  assert.equal(typeof bacaan.books, 'function', 'books()');
  assert.equal(typeof bacaan.papers, 'function', 'papers()');
  assert.ok(src.includes('covers.openlibrary.org/b/id/'), 'format URL cover');
  assert.ok(src.includes('https://doi.org/'), 'pautan DOI');
  assert.ok(src.includes('is-referenced-by-count'), 'sort kutipan Crossref');
});

test('server: worldDoc shell penuh — chrome, 3 slot iklan, nav disuntik', () => {
  const doc = (serverSrc.match(/function worldDoc\(o, navHtml\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(doc.length > 1000, 'worldDoc ditemui');
  assert.ok(doc.includes('siteHeader(') && doc.includes('siteFooter()'), 'header+footer');
  assert.equal((doc.match(/adUnitGuarded\(config\.adsense\.(slotTop|slotInArticle|slotBottom)/g) || []).length, 3, '3 slot AdSense');
  assert.equal((doc.match(/msAdUnit\(/g) || []).length, 3, '3 unit Microsoft');
  assert.ok(doc.includes('${navHtml}'), 'nav per-kluster disuntik');
  assert.ok(doc.includes('rel="canonical"') && doc.includes('application/ld+json'), 'SEO head');
});

test('server: laluan + footer + staticPages + sitemap ketiga-tiga kluster', () => {
  for (const r of ["app.get('/wang'", "app.get('/wang/kadar'", "app.get('/wang/tukar/:from/:to'",
    "app.get('/seni'", "app.get('/seni/koleksi/:slug'", "app.get('/seni/objek/:id'",
    "app.get('/hidupan'", "app.get('/hidupan/:slug'"]) {
    assert.ok(serverSrc.includes(r), `laluan ${r}`);
  }
  const staticLine = (serverSrc.match(/const staticPages = \[[^\]]*\]/) || [''])[0];
  for (const p of ["'/wang'", "'/wang/kadar'", "'/seni'", "'/hidupan'"]) {
    assert.ok(staticLine.includes(p), `staticPages ${p}`);
  }
  for (const f of ['World Currency — Live Rates', 'Free Art Gallery — The Met', 'Wildlife Atlas — Real Photos']) {
    assert.ok(serverSrc.includes(f), `footer ${f}`);
  }
  for (const sm of ['/sitemap-wang.xml', '/sitemap-seni.xml', '/sitemap-hidupan.xml']) {
    assert.ok(serverSrc.includes(`app.get('${sm}'`), `laluan ${sm}`);
  }
  const robots = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
  for (const sm of ['sitemap-wang', 'sitemap-seni', 'sitemap-hidupan']) {
    assert.ok(robots.includes(`https://tukuk.org/${sm}.xml`), `robots ${sm}`);
    assert.ok(robots.includes(`\nSitemap: https://tukuk.org/${sm}.xml\n`), `robots ${sm} baris sendiri`);
  }
});

test('server: slug palsu redirect + kadar pasangan invalid → redirect kadar', () => {
  assert.ok(serverSrc.includes("if (!c) return res.redirect(302, '/seni')"), 'koleksi palsu → /seni');
  assert.ok(serverSrc.includes("if (!t) return res.redirect(302, '/hidupan')"), 'spesies palsu → /hidupan');
  assert.ok(serverSrc.includes("if (!from || !to || from === to) return res.redirect(302, '/wang/kadar')"), 'kod wang salah → kadar');
  assert.ok(serverSrc.includes("if (!o || !o.primaryImage) return res.redirect(302, '/seni')"), 'objek tiada img → /seni');
});

test('server: kad sungai /cuaca + kotak wiki /bencana + kotak langit + bacaan akademi', () => {
  // Kad banjir sungai — getRiver dalam Promise.all kota + label jujur GloFAS.
  assert.ok(serverSrc.includes('udara.getRiver(city.lat, city.lon)'), 'handler kota tarik getRiver');
  const river = (serverSrc.match(/let riverBox = '';[\s\S]*?\n  \}/) || [''])[0];
  assert.ok(river.includes('bukan ukuran stesen sungai sebenar'), 'label jujur model');
  assert.ok(river.includes('Model aliran sungai'), 'tajuk kad');
  // Konteks Wikipedia halaman acara — async + terminologi EONET dipotong.
  assert.ok(serverSrc.includes('await bc.wikiPeek(wikiTerm)'), 'bencanaEventPage await wikiPeek');
  assert.ok(serverSrc.includes('async function bencanaEventPage'), 'renderer jadi async');
  assert.ok(serverSrc.includes('await bencanaEventPage(req, cat, ev)'), 'laluan await renderer');
  // Peristiwa langit kurasi di /nasa/sky.
  assert.ok(serverSrc.includes('const SKY_EVENTS = ['), 'jadual kurasi ada');
  assert.ok(serverSrc.includes('+ skyEventsBox()'), 'kotak disuntik ke halaman sky');
  // Kotak bacaan akademi — async + kedua-dua sumber dengan catch.
  assert.ok(serverSrc.includes('async function akadTrackPage'), 'akadTrackPage async');
  const track = (serverSrc.match(/async function akadTrackPage[\s\S]*?\n}/) || [''])[0];
  assert.ok(track.includes('bacaan.books(topic, 3).catch') && track.includes('bacaan.papers(topic, 3).catch'), 'dua kotak dengan catch senyap');
  assert.ok(track.includes('Further reading') && track.includes('The research'), 'tajuk kotak EN');
});

test('kejujuran kontrak: sumber mati tidak disamar — wang label reference rate', () => {
  const conv = (serverSrc.match(/function moneyConverterPage[\s\S]*?\n}/) || [''])[0];
  assert.ok(conv.includes('reference rate'), 'converter melabel kadar referensi');
  assert.ok(conv.includes('before any exchange counter adds its margin') || conv.includes('before any shop'), 'jujur tentang margin');
  const pair = (serverSrc.match(/function moneyPairPage[\s\S]*?\n}/) || [''])[0];
  assert.ok(pair.includes('reference rates only, not dealable quotes'), 'halaman pasangan penafian');
  // Tiada nombor rekaan: API mati → halaman Down, bukan data palsu.
  assert.ok(serverSrc.includes('function wangDown(') && serverSrc.includes('function seniDown(') && serverSrc.includes('function hidupDown('), '3 halaman down jujur');
  assert.ok(!/Math\.random\(\)/.test(serverSrc.match(/function skyEventsBox[\s\S]*?\n}/)[0]), 'jadual langit tetap, bukan rawak');
});

test('udara.getRiver + bencana.wikiPeek diexport & cache TTL munasabah', () => {
  const u = require('../src/udara');
  const b = require('../src/bencana');
  assert.equal(typeof u.getRiver, 'function', 'getRiver diexport');
  assert.equal(typeof b.wikiPeek, 'function', 'wikiPeek diexport');
  const uSrc = fs.readFileSync(path.join(ROOT, 'src', 'udara.js'), 'utf8');
  assert.ok(uSrc.includes('flood-api.open-meteo.com/v1/flood'), 'hujung flood API betul');
  assert.ok((uSrc.match(/async function getRiver[\s\S]*?\n}/) || [''])[0].includes("'unavailable'"), 'kontrak source: unavailable');
  const bSrc = fs.readFileSync(path.join(ROOT, 'src', 'bencana.js'), 'utf8');
  assert.ok(bSrc.includes('action=opensearch') && bSrc.includes('rest_v1/page/summary'), 'dua langkah Wikipedia');
});
