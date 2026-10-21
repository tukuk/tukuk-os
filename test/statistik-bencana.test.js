'use strict';
// Invarian Statistik + Bencana Complex: sumber tanpa kunci (World Bank / NASA
// EONET), renderer shell ms + 3 slot iklan, laluan TDZ-selamat, sitemap, robots,
// footer dan pautan silang. Tiada rangkaian — statik sahaja.
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

test('statistik.js: World Bank tanpa kunci, cache 30 hari, ≥12 indikator, IPv6 dulu', () => {
  assert.ok(statSrc.includes('api.worldbank.org/v2/country/all/indicator'), 'indikator WB awam');
  assert.ok(!/api_key|apikey|Bearer/i.test(statSrc), 'tiada kunci API');
  assert.ok(statSrc.includes('30 * 24 * 60 * 60 * 1000'), 'cache 30 hari');
  assert.ok(statSrc.includes('family: 6'), 'agent IPv6 didahulukan (pitfall ipv4first)');
  const n = (statSrc.match(/slug: '/g) || []).length;
  assert.ok(n >= 12, `sekurang-kurangnya 12 indikator (dapat ${n - 1})`);
  assert.ok(statSrc.includes('loadRanking(ind, countries)'), 'pinjam rows negara.js sebagai parameter (nama BM/slug/bendera)');
  assert.ok(!statSrc.includes('ST.INT.ARVL'), 'sari kata pelancong (data kosong) dibuang');
});

test('bencana.js: NASA EONET tanpa kunci, include=geo, id EONET_\d+ divalidasi', () => {
  assert.ok(bcSrc.includes('eonet.gsfc.nasa.gov/api/v3'), 'suapan EONET v3');
  assert.ok(!/api_key|apikey|Bearer/i.test(bcSrc), 'tiada kunci API');
  assert.ok(bcSrc.includes('include=geo'), 'geometri coordinate ikut senarai');
  assert.ok(/EONET_\\d\+\$/.test(bcSrc), 'id acara divalidasi regex');
  assert.ok(bcSrc.includes('body.geometry'), 'detail EONET: kunci `geometry` dinormal → geometries');
  assert.ok(bcSrc.includes("body.created == null"), 'created/updated diterbitkan daripada garis masa geometri');
  assert.ok(bcSrc.includes('family: 6'), 'agent IPv6 didahulukan');
  const n = (bcSrc.match(/id: '/g) || []).length;
  assert.ok(n >= 10, `sekurang-kurangnya 10 kategori (dapat ${n})`);
  assert.ok(!/[\u4e00-\u9fff]/.test(bcSrc), 'tiada bocor aksara CJK');
});

test('server.js: laluan + renderer + sitemap kedua-dua kompleks (statik dahulu, :slug kemudian)', () => {
  for (const route of [
    "app.get('/statistik'", "app.get('/statistik/:slug'",
    "app.get('/bencana'", "app.get('/bencana/:cat'", "app.get('/bencana/:cat/:id'",
    "app.get('/sitemap-statistik.xml'", "app.get('/sitemap-bencana.xml'",
  ]) {
    assert.ok(serverSrc.includes(route), `laluan ${route}`);
  }
  const staticIdx = serverSrc.indexOf("app.get('/statistik'");
  const dynIdx = serverSrc.indexOf('app.use(express.static(PUBLIC_DIR');
  assert.ok(staticIdx > 0 && staticIdx < dynIdx, 'laluan kompleks sebelum express.static');
  for (const fn of ['function statistikDoc', 'function statistikHubPage', 'function statistikIndPage',
    'function statistikBusy', 'function bencanaDoc', 'function bencanaHubPage',
    'function bencanaCatPage', 'function bencanaEventPage', 'function bencanaBusy']) {
    assert.ok(serverSrc.includes(fn), fn);
  }
  // Shell: lang en + three ad slots + the canonical link.
  const stBlock = serverSrc.slice(serverSrc.indexOf('function statistikDoc'), serverSrc.indexOf('function statistikHubPage'));
  assert.ok(stBlock.includes('<html lang="en">'), 'statistikDoc lang en');
  assert.ok(stBlock.includes("adUnitGuarded(config.adsense.slotTop, 'top')"), 'slot top');
  assert.ok(stBlock.includes("adUnitGuarded(config.adsense.slotInArticle, 'in-article')"), 'slot in-article');
  assert.ok(stBlock.includes("adUnitGuarded(config.adsense.slotBottom, 'bottom')"), 'slot bottom');
  const bcBlock = serverSrc.slice(serverSrc.indexOf('function bencanaDoc'), serverSrc.indexOf('const BC_DATE_FMT'));
  assert.ok(bcBlock.includes('<html lang="en">'), 'bencanaDoc lang en');
  assert.ok(bcBlock.includes("adUnitGuarded(config.adsense.slotTop, 'top')"), 'bencana slot top');
  // Halaman gagal → noindex,follow (shell busy).
  assert.ok(serverSrc.includes('function statistikBusy') && serverSrc.includes('function bencanaBusy'), 'shell busy wujud');
  const busyIdx = serverSrc.indexOf('function bencanaBusy');
  assert.ok(serverSrc.slice(busyIdx, busyIdx + 400).includes('noindex,follow'), 'busy noindex');
  // Peta SVG dots pada halaman acara.
  const evBlock = serverSrc.slice(serverSrc.indexOf('function bencanaEventPage'), serverSrc.indexOf('function bencanaEventPage') + 6000);
  assert.ok(evBlock.includes('<circle'), 'dot lokasi pada peta equirektangular');
});

test('SEO: robots, staticPages, footer SSR, tile index, katalog OS', () => {
  assert.ok(robotsTxt.includes('Sitemap: https://tukuk.org/sitemap-statistik.xml'), 'sitemap statistik di robots');
  assert.ok(robotsTxt.includes('Sitemap: https://tukuk.org/sitemap-bencana.xml'), 'sitemap bencana di robots');
  assert.ok(serverSrc.includes("'/statistik', '/bencana'"), 'staticPages utama (sitemap.xml)');
  const footer = serverSrc.slice(serverSrc.indexOf('function siteFooter()'), serverSrc.indexOf('function siteFooter()') + 3000);
  assert.ok(footer.includes('<a href="/statistik">World statistics</a>'), 'footer statistik');
  assert.ok(footer.includes('<a href="/bencana">Live disaster watch</a>'), 'footer bencana');
  assert.ok(indexHtml.includes('href="/statistik"') && indexHtml.includes('href="/bencana"'), 'tile/index paut kedua-duanya');
  assert.ok(osHtml.includes("'/statistik'") && osHtml.includes("['bencana'"), 'katalog OS ada entri');
  // Cross links out of the Country Complex hub page.
  assert.ok(serverSrc.includes('<a href="/bencana">Disaster Complex</a>'), 'country hub → disaster complex');
  assert.ok(serverSrc.includes('<a href="/statistik">Statistics Complex</a>'), 'country hub → statistics complex');
});
