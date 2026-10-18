'use strict';
// Invarian Weather Complex: 6 seksyen SSR BM + kota DB ×3 halaman + geokoding slug
// bebas + sitemap-cuaca.xml. Semua halaman cuaca lalu cuacaDoc → 3 unit iklan.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const weatherSrc = fs.readFileSync(path.join(ROOT, 'src', 'weather.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

const SECTIONS = ['/cuaca', '/cuaca/peta', '/cuaca/ekstrem', '/cuaca/kod', '/cuaca/awan', '/cuaca/angin'];

test('CUACA_SECTIONS menyenaraikan 6 seksyen cuaca', () => {
  for (const p of SECTIONS) {
    assert.ok(serverSrc.includes(`'${p}'`), `seksyen ${p} mesti wujud dalam CUACA_SECTIONS/nav`);
  }
});

test('setiap renderer cuaca ditakrif dan dibungkus melalui cuacaDoc', () => {
  for (const fn of ['cuacaHubPage', 'cuacaCityPage', 'cuacaAirPage', 'cuacaSunPage',
    'cuacaMapPage', 'cuacaExtremesPage', 'cuacaCodesPage', 'cuacaCloudPage', 'cuacaWindPage']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} ditakrif`);
  }
  assert.match(serverSrc, /function cuacaDoc\(o\)/, 'shell cuacaDoc ditakrif');
  const idx = serverSrc.indexOf('function cuacaDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) {
    assert.ok(doc.includes(slot), `cuacaDoc perlu memaparkan ${slot}`);
  }
  assert.ok(doc.includes('cuacaNav()'), 'cuacaDoc perlu nav cuaca (hub pautan)');
  // Cluster Bahasa Melayu: lang + og:locale mesti BM
  assert.ok(doc.includes('<html lang="ms">'), 'halaman cuaca berlang="ms"');
  assert.ok(doc.includes('ms_MY'), 'og:locale ms_MY untuk halaman cuaca');
});

test('laluan /cuaca* berdaftar: 6 statik + cari + :slug (+udara/surya), statik dahulu', () => {
  for (const r of ['/cuaca', '/cuaca/peta', '/cuaca/kod', '/cuaca/awan', '/cuaca/angin',
    '/cuaca/ekstrem', '/cuaca/cari', '/cuaca/:slug/udara', '/cuaca/:slug/surya', '/cuaca/:slug']) {
    assert.ok(serverSrc.includes(`app.get('${r}'`), `laluan ${r} perlu berdaftar`);
  }
  // :slug mesti didaftarkan TERAKHIR supaya nama statik tidak dirampas
  const last = serverSrc.lastIndexOf(`app.get('/cuaca/:slug'`);
  for (const r of ['/cuaca/peta', '/cuaca/cari', '/cuaca/:slug/udara']) {
    assert.ok(serverSrc.indexOf(`app.get('${r}'`) < last, `${r} perlu berdaftar sebelum /cuaca/:slug`);
  }
});

test('tiada loop daftar-route atas `const` (TDZ) — slug kota selesaikan dalam handler', () => {
  assert.doesNotMatch(serverSrc, /for \(const c of wx\.CITIES\)\s*app\.get/, 'loop wx.CITIES diharamkan (TDZ)');
  assert.match(serverSrc, /wx\.resolveCity\(slug\)/, 'resolveCity dipanggil dalam handler');
  assert.match(serverSrc, /redirect\(302, `\/cuaca\/\$\{city\.slug\}`\)/, 'cari → 302 halaman kota');
});

test('kegagalan API / kota unknown → weatherBusy noindex,follow + status bukan-200', () => {
  assert.match(serverSrc, /function weatherBusy\(/, 'weatherBusy ditakrif');
  const busy = serverSrc.slice(serverSrc.indexOf('function weatherBusy'), serverSrc.indexOf('function weatherBusy') + 1200);
  assert.ok(busy.includes('noindex,follow'), 'halaman sibuk mestilah noindex,follow');
  assert.match(serverSrc, /weatherBusy\([\s\S]{0,120}\), 503\)/, 'API down → 503 + weatherBusy');
  assert.match(serverSrc, /weatherBusy\([\s\S]{0,120}\), 404\)/, 'kota tiada → 404 + weatherBusy');
  assert.match(serverSrc, /index,follow,max-image-preview:large/, 'halaman canonical boleh indeks + gambar besar');
});

test('src/weather.js: hanya endpoint tier PERCUMA + pelindung kuota/breaker', () => {
  for (const ep of ['/data/2.5/weather', '/data/2.5/forecast', '/data/2.5/air_pollution', '/geo/1.0/direct']) {
    assert.ok(weatherSrc.includes(ep), `endpoint free-tier ${ep} digunakan`);
  }
  assert.doesNotMatch(weatherSrc, /\/data\/3\.\/onecall|\/data\/2\.5\/history/, 'endpoint BERBAYAR (OneCall/sejarah) diharamkan');
  assert.match(weatherSrc, /dailyBudget/, 'bajet panggilan harian dipagari');
  assert.match(weatherSrc, /WeatherDownError/, 'klas ralat kuota/down wujud');
  assert.ok(weatherSrc.includes('429') && weatherSrc.includes('breakerUntil'), '429 → breaker 15 min');
  // Jubin peta percuma + pautan tiles melalui config
  assert.match(serverSrc, /wx\.tileTemplateUrl/, 'halaman peta guna jubin OpenWeather');
});

test('sitemap-cuaca.xml +robots: 6 statik + setiap kota DB ×3 URL; stats+nav boleh indeks', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-cuaca\.xml'/, 'laluan sitemap-cuaca wujud');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-cuaca.xml'"), serverSrc.indexOf("app.get('/sitemap-cuaca.xml'") + 2000);
  assert.ok(sm.includes('wx.CITIES.map'), 'setiap kota DB tersenarai dalam sitemap');
  for (const suffix of ['/udara', '/surya']) assert.ok(sm.includes(suffix), `kota ×${suffix} dalam sitemap`);
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-cuaca\.xml/, 'robots.txt iklankan sitemap-cuaca');
  // SEO kemas: /cuaca* dalam senarai sitemap utama + nav/footer header situs
  assert.ok(serverSrc.includes("const staticPages = ['', '/nasa'") && serverSrc.includes("'/cuaca/awan'"), 'sitemap utama menyenaraikan halaman /cuaca');
  assert.match(serverSrc, /link\('\/cuaca', 'Weather', 'cuaca'\)/, 'siteHeader ada pautan Weather');
  assert.ok(serverSrc.includes('<li><a href="/cuaca/serian">Cuaca Serian</a></li>'), 'siteFooter ada pautan Cuaca Serian');
});

test('pautan silang NASA sky ↔ cuaca + JSON-LD Place/Dataset pada halaman kota', () => {
  assert.match(serverSrc, /nasa\/sky\?lat=/, 'halaman kota paut ke /nasa/sky?lat&lng');
  assert.ok(serverSrc.includes('hab pautan') || weatherSrc.includes('OpenWeather'), 'sumber data didokumenkan');
  const cityIdx = serverSrc.indexOf('function cuacaCityPage');
  const citySrc = serverSrc.slice(cityIdx, cityIdx + 8000);
  assert.ok(citySrc.includes("'Place'"), 'halaman kota carry JSON-LD Place');
  const airIdx = serverSrc.indexOf('function cuacaAirPage');
  const airSrc = serverSrc.slice(airIdx, airIdx + 8000);
  assert.ok(airSrc.includes("'Dataset'") || airSrc.includes('"Dataset"'), 'halaman udara carry JSON-LD Dataset');
});
