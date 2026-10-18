'use strict';
// Invarian Negara Complex: sumber tanpa kunci + hab/rantau/negara renderer +
// sitemap-negara + robots + pautan silang. Tiada rangkaian — statik sahaja.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const negaraSrc = fs.readFileSync(path.join(ROOT, 'src', 'negara.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

test('negara.js: sumber tanpa kunci (jsDelivr + World Bank + flagcdn), cache 30 hari', () => {
  assert.ok(negaraSrc.includes('cdn.jsdelivr.net/npm/world-countries'), 'dataset world-countries via jsDelivr');
  assert.ok(negaraSrc.includes('api.worldbank.org/v2/country/all/indicator'), 'indikator World Bank Open Data');
  assert.ok(negaraSrc.includes('flagcdn.com'), 'bendera flagcdn');
  assert.doesNotMatch(negaraSrc, /apikey|api_key|appid|Bearer|token/i, 'tiada kunci/API bersyarat daftar');
  assert.match(negaraSrc, /TTL = 30 \* 24 \* 60 \* 60 \* 1000/, 'cache 30 hari');
  assert.ok(negaraSrc.includes('restcountries'), 'nota pembuangan restcountries v3.1 (depremadi) didokumentasi');
  assert.doesNotMatch(negaraSrc, /restcountries\.com\/v3|all\.json/, 'endpoint restcountries mati tidak diguna');
});

test('negara.js: pitfall IPv6 cuti ditangani — agent family 6 dahulu, fallback 4', () => {
  assert.match(negaraSrc, /new https\.Agent\(\{ family: 6/, 'v6Agent wujud');
  assert.match(negaraSrc, /new https\.Agent\(\{ family: 4/, 'v4Agent fallback wujud');
});

test('negara.js: 6 region + BM_NAMES + slug + sempadan cca3→slug dieksport', () => {
  for (const slug of ['asia', 'africa', 'europe', 'americas', 'oceania', 'antarctic']) {
    assert.ok(negaraSrc.includes(`slug: '${slug}'`), `region ${slug} ditakrif`);
  }
  assert.ok(negaraSrc.includes("'south korea': 'Korea Selatan'"), 'alias BM utama wujud');
  const ex = negaraSrc.slice(negaraSrc.indexOf('module.exports'));
  for (const fn of ['loadCountries', 'findCountry', 'inRegion', 'findRegion', 'REGIONS', 'flagUrl', 'slugify']) {
    assert.ok(ex.includes(fn), `${fn} dieksport`);
  }
  assert.ok(negaraSrc.includes('borderSlugs'), 'peta jiran cca3→slug dijana');
});

test('renderer negara ditakrif dan dibungkus melalui negaraDoc (3 slot + nav + lang ms)', () => {
  for (const fn of ['negaraHubPage', 'negaraRegionPage', 'negaraCountryPage', 'negaraDoc', 'negaraNav', 'negaraBusy']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} ditakrif`);
  }
  const idx = serverSrc.indexOf('function negaraDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) assert.ok(doc.includes(slot), `negaraDoc ada ${slot}`);
  assert.ok(doc.includes('negaraNav()'), 'negaraDoc ada nav negara (hub pautan)');
  assert.ok(doc.includes('<html lang="ms">'), 'halaman negara berlang="ms"');
  assert.ok(doc.includes('og:locale" content="ms_MY"'), 'og locale ms_MY');
});

test('laluan /negara* berdaftar ikut tertib: hub literal dahulu, kemudian :slug', () => {
  const hub = serverSrc.indexOf("app.get('/negara'");
  const one = serverSrc.indexOf("app.get('/negara/:slug'");
  assert.ok(hub > -1 && one > hub, 'tertib daftar: /negara < :slug');
  assert.match(serverSrc, /ng\.findRegion\(slug\)/, 'rantau disahkan DALAM handler (tiada TDZ)');
  assert.match(serverSrc, /ng\.findCountry\(rows, slug\)/, 'negara disahkan DALAM handler');
  assert.doesNotMatch(serverSrc, /for \(const r of ng\.REGIONS\)\s*app\.get/, 'loop daftar-route atas REGIONS diharamkan');
  const staticIdx = serverSrc.indexOf('app.use(express.static(PUBLIC_DIR');
  assert.ok(one < staticIdx, 'laluan negara sebelum static middleware');
});

test('kegagalan dataset → 503, slug salah → 404, dua-dua negaraBusy noindex', () => {
  const busy = serverSrc.slice(serverSrc.indexOf('function negaraBusy'), serverSrc.indexOf('function negaraBusy') + 900);
  assert.ok(busy.includes('noindex,follow'), 'negaraBusy noindex,follow');
  assert.match(serverSrc, /status\(503\)\.type\('html'\)\.send\(negaraBusy/, '503 guna negaraBusy');
  assert.match(serverSrc, /status\(404\)\.type\('html'\)\.send\(negaraBusy/, '404 slug salah guna negaraBusy');
});

test('sitemap-negara.xml + robots + footer + pautan silang tiga kompleks lain', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-negara\.xml'/, 'laluan sitemap-negara wujud');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-negara.xml'"), serverSrc.indexOf("app.get('/sitemap-negara.xml'") + 1500);
  assert.ok(sm.includes('ng.REGIONS.map'), '6 rantau masuk sitemap');
  assert.ok(sm.includes('loadCountries'), '250 negara masuk sitemap bila cache siap');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-negara\.xml/, 'robots iklankan sitemap-negara');
  assert.ok(serverSrc.includes('<li><a href="/negara">World countries</a></li>'), 'footer SSR ada pautan negara');
  assert.ok(serverSrc.includes('<a href="/negara">Kompleks Negara</a>'), 'cuaca & cuti paut silang ke negara');
  assert.ok(serverSrc.includes("'/negara', '/negara/asia'"), 'sitemap utama menyenaraikan /negara');
});
