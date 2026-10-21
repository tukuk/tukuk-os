'use strict';
// Invariants of the Statistics + Disaster Complexes: key-free sources (World Bank /
// NASA EONET), the render shells (lang en + 3 ad slots), TDZ-safe routes, sitemaps,
// robots, the footer and the cross links. No network — static checks only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const statSrc = fs.readFileSync(path.join(ROOT, 'src', 'statistik.js'), 'utf8');
const bcSrc = fs.readFileSync(path.join(ROOT, 'src', 'bencana.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const osHtml = fs.readFileSync(path.join(ROOT, 'public', 'os.html'), 'utf8');

test('statistik.js: World Bank without a key, 30-day cache, ≥12 indicators, IPv6 first', () => {
  assert.ok(statSrc.includes('api.worldbank.org/v2/country/all/indicator'), 'the public WB indicator endpoint');
  assert.ok(!/api_key|apikey|Bearer/i.test(statSrc), 'no API key');
  assert.ok(statSrc.includes('30 * 24 * 60 * 60 * 1000'), '30-day cache');
  assert.ok(statSrc.includes('family: 6'), 'the IPv6 agent goes first (the ipv4first pitfall)');
  const n = (statSrc.match(/slug: '/g) || []).length;
  assert.ok(n >= 12, `at least 12 indicators (got ${n - 1})`);
  assert.ok(statSrc.includes('loadRanking(ind, countries)'), 'the negara.js rows are borrowed as a parameter (English name/slug/flag)');
  assert.ok(!statSrc.includes('ST.INT.ARVL'), 'the tourist indicator (empty data) was dropped');
});

test('the statistics copy is English: labels translated, public slugs preserved', () => {
  const st = require(path.join(ROOT, 'src', 'statistik.js'));
  assert.ok(st.INDICATORS.length >= 12, 'the catalogue still covers at least 12 indicators');
  for (const i of st.INDICATORS) {
    assert.ok(!('bm' in i), `${i.slug} has no bm field left`);
    assert.ok(i.en && i.en.length > 2, `${i.slug} carries an English label`);
    assert.doesNotMatch(i.en, /Populasi|Kadar|Jangka|Penduduk|Liputan|Pelepasan|Pengguna|Pertumbuhan|Kematian|Kanak|Tenaga Boleh/i, `${i.slug} label is English`);
    assert.doesNotMatch(i.intro, /\b(buah negara|penduduk|wanita|tahun|orang|kanak|kelahiran|peratus)\b/, `${i.slug} intro is English`);
    assert.doesNotMatch(i.unit, /^(orang|tahun|tan CO₂|anak\/wanita)$/, `${i.slug} unit is English`);
  }
  // The slugs are the public URLs of this complex — they must not move with the copy.
  assert.deepStrictEqual(st.INDICATORS.map((i) => i.slug).sort(), [
    'populasi', 'kdnk-kapita', 'jangka-hayat', 'internet', 'urbanisasi', 'kesuburan', 'literasi',
    'pengangguran', 'inflasi', 'tenaga-boleh-diperbaharui', 'pelepasan-co2', 'liputan-hutan',
    'kematian-bayi', 'pertumbuhan-penduduk', 'kematian-kanak',
  ].sort(), 'every indicator keeps its public URL slug');
  // Anchor on the next complex's own declaration: internal identifiers are never renamed.
  const pages = serverSrc.slice(serverSrc.indexOf('const STAT_SECTIONS'), serverSrc.indexOf('const BENCANA_SECTIONS'));
  assert.ok(pages.length > 4000, 'the slice really covers the statistics pages');
  assert.doesNotMatch(pages, /buah negara|belum sempat|Paling tinggi|Paling rendah|purata dunia|Taburan global|daripada|Bahasa Melayu|Kembali ke Kompleks|indikator|Negara\b/, 'no Malay wording remains on the statistics pages');
  assert.ok(pages.includes('All Indicators') && pages.includes('World average') && pages.includes('Countries reporting'), 'the hub and indicator tables are English');
  assert.ok(pages.includes('ind.en'), 'the pages read the English label field');
  // The hero names the winner, so the wording must flip with the direction of "better".
  assert.ok(/ind\.better === 'low' \? 'Best value for' : 'World leader for'/.test(pages), 'the hero label follows ind.better');
  assert.ok(pages.includes('The best value in every indicator'), 'the hub section title stays neutral about direction');
  // Country names reach the meta description raw: statistikDoc escapes it again (double-escape pitfall).
  assert.ok(/desc: `\$\{ind\.en\} \$\{yr\}: \$\{best\.name\} leads/.test(pages), 'the indicator description passes the unescaped name');
  // The number formats are shared with the Country Complex, and stFmt keeps its unit rules.
  const fmt = serverSrc.slice(serverSrc.indexOf('function stFmt(ind, v)'), serverSrc.indexOf('function bestOf'));
  assert.ok(fmt.includes("ind.unit === 'USD'") && fmt.includes("ind.unit === '%'"), 'stFmt still special-cases dollars and percent');
  const busy = serverSrc.slice(serverSrc.indexOf('function statistikBusy'), serverSrc.indexOf('function statistikBusy') + 900);
  assert.ok(busy.includes('noindex,follow'), 'statistikBusy is noindex,follow');
  assert.ok(busy.includes('Back to the Statistics Complex'), 'the escape page links back in English');
});

test('bencana.js: NASA EONET without a key, include=geo, EONET_\d+ ids validated', () => {
  assert.ok(bcSrc.includes('eonet.gsfc.nasa.gov/api/v3'), 'the EONET v3 feed');
  assert.ok(!/api_key|apikey|Bearer/i.test(bcSrc), 'no API key');
  assert.ok(bcSrc.includes('include=geo'), 'the coordinate geometry comes with the list');
  assert.ok(/EONET_\\d\+\$/.test(bcSrc), 'event ids are validated by regex');
  assert.ok(bcSrc.includes('body.geometry'), 'EONET detail: the `geometry` key is normalised → geometries');
  assert.ok(bcSrc.includes("body.created == null"), 'created/updated are derived from the geometry timeline');
  assert.ok(bcSrc.includes('family: 6'), 'the IPv6 agent goes first');
  const n = (bcSrc.match(/id: '/g) || []).length;
  assert.ok(n >= 10, `at least 10 categories (got ${n})`);
  assert.ok(!/[\u4e00-\u9fff]/.test(bcSrc), 'no CJK character leaks into the module');
});

test('server.js: routes + renderers + sitemaps of both complexes (static first, then :slug)', () => {
  for (const route of [
    "app.get('/statistik'", "app.get('/statistik/:slug'",
    "app.get('/bencana'", "app.get('/bencana/:cat'", "app.get('/bencana/:cat/:id'",
    "app.get('/sitemap-statistik.xml'", "app.get('/sitemap-bencana.xml'",
  ]) {
    assert.ok(serverSrc.includes(route), `the ${route} route`);
  }
  const staticIdx = serverSrc.indexOf("app.get('/statistik'");
  const dynIdx = serverSrc.indexOf('app.use(express.static(PUBLIC_DIR');
  assert.ok(staticIdx > 0 && staticIdx < dynIdx, 'the complex routes come before express.static');
  for (const fn of ['function statistikDoc', 'function statistikHubPage', 'function statistikIndPage',
    'function statistikBusy', 'function bencanaDoc', 'function bencanaHubPage',
    'function bencanaCatPage', 'function bencanaEventPage', 'function bencanaBusy']) {
    assert.ok(serverSrc.includes(fn), fn);
  }
  // Shell: lang en + three ad slots + the canonical link.
  const stBlock = serverSrc.slice(serverSrc.indexOf('function statistikDoc'), serverSrc.indexOf('function statistikHubPage'));
  assert.ok(stBlock.includes('<html lang="en">'), 'statistikDoc is lang en');
  assert.ok(stBlock.includes("adUnitGuarded(config.adsense.slotTop, 'top')"), 'the top slot');
  assert.ok(stBlock.includes("adUnitGuarded(config.adsense.slotInArticle, 'in-article')"), 'the in-article slot');
  assert.ok(stBlock.includes("adUnitGuarded(config.adsense.slotBottom, 'bottom')"), 'the bottom slot');
  const bcBlock = serverSrc.slice(serverSrc.indexOf('function bencanaDoc'), serverSrc.indexOf('const BC_DATE_FMT'));
  assert.ok(bcBlock.includes('<html lang="en">'), 'bencanaDoc is lang en');
  assert.ok(bcBlock.includes("adUnitGuarded(config.adsense.slotTop, 'top')"), 'the bencana top slot');
  // A failed page gets the noindex,follow busy shell.
  assert.ok(serverSrc.includes('function statistikBusy') && serverSrc.includes('function bencanaBusy'), 'both busy shells exist');
  const busyIdx = serverSrc.indexOf('function bencanaBusy');
  assert.ok(serverSrc.slice(busyIdx, busyIdx + 400).includes('noindex,follow'), 'the busy shell is noindex');
  // SVG dots on the event page map.
  const evBlock = serverSrc.slice(serverSrc.indexOf('function bencanaEventPage'), serverSrc.indexOf('function bencanaEventPage') + 6000);
  assert.ok(evBlock.includes('<circle'), 'location dots on the equirectangular map');
});

test('SEO: robots, staticPages, footer SSR, tile index, OS catalogue', () => {
  assert.ok(robotsTxt.includes('Sitemap: https://tukuk.org/sitemap-statistik.xml'), 'robots lists the statistik sitemap');
  assert.ok(robotsTxt.includes('Sitemap: https://tukuk.org/sitemap-bencana.xml'), 'robots lists the bencana sitemap');
  assert.ok(serverSrc.includes("'/statistik', '/bencana'"), 'the main sitemap staticPages');
  const footer = serverSrc.slice(serverSrc.indexOf('function siteFooter()'), serverSrc.indexOf('function siteFooter()') + 3000);
  assert.ok(footer.includes('<a href="/statistik">World statistics</a>'), 'the footer statistik link');
  assert.ok(footer.includes('<a href="/bencana">Live disaster watch</a>'), 'the footer bencana link');
  assert.ok(indexHtml.includes('href="/statistik"') && indexHtml.includes('href="/bencana"'), 'the tile index links both');
  assert.ok(osHtml.includes("'/statistik'") && osHtml.includes("['bencana'"), 'the OS catalogue has both entries');
  // Cross links out of the Country Complex hub page.
  assert.ok(serverSrc.includes('<a href="/bencana">Disaster Complex</a>'), 'country hub → disaster complex');
  assert.ok(serverSrc.includes('<a href="/statistik">Statistics Complex</a>'), 'country hub → statistics complex');
});
