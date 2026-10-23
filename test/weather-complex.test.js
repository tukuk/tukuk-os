'use strict';
// Weather Complex invariants: 6 SSR sections in English + 3 pages per city in the
// database + free slug geocoding + sitemap-cuaca.xml. Every weather page goes through
// cuacaDoc → 3 ad units. URLs keep their Malay slugs for stability.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const weatherSrc = fs.readFileSync(path.join(ROOT, 'src', 'weather.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

const SECTIONS = ['/weather', '/weather/map', '/weather/extremes', '/weather/codes', '/weather/clouds', '/weather/wind'];

test('CUACA_SECTIONS lists the 6 weather sections', () => {
  for (const p of SECTIONS) {
    assert.ok(serverSrc.includes(`'${p}'`), `section ${p} must exist in CUACA_SECTIONS/nav`);
  }
});

test('every weather renderer is defined and wrapped by cuacaDoc', () => {
  for (const fn of ['cuacaHubPage', 'cuacaCityPage', 'cuacaAirPage', 'cuacaSunPage',
    'cuacaMapPage', 'cuacaExtremesPage', 'cuacaCodesPage', 'cuacaCloudPage', 'cuacaWindPage']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} is defined`);
  }
  assert.match(serverSrc, /function cuacaDoc\(o\)/, 'the cuacaDoc shell is defined');
  const idx = serverSrc.indexOf('function cuacaDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) {
    assert.ok(doc.includes(slot), `cuacaDoc must render ${slot}`);
  }
  assert.ok(doc.includes('cuacaNav()'), 'cuacaDoc must carry the weather nav (link hub)');
  // International English cluster: lang + og:locale must be English (slugs stay Malay).
  assert.ok(doc.includes('<html lang="en">'), 'weather pages are lang="en"');
  assert.ok(doc.includes('en_US'), 'weather pages use og:locale en_US');
  assert.ok(!doc.includes('lang="ms"'), 'no Malay lang attribute left in the weather shell');
});

test('the weather copy is English: no Malay condition-field access remains', () => {
  // describe() now returns { label, meaning, emoji }; the old `.ms` key is gone.
  assert.match(weatherSrc, /return \{ label, meaning: c\.meaning, emoji \}/, 'describe() returns an English label + meaning');
  assert.doesNotMatch(serverSrc, /escapeHtml\(d\.ms\)|escapeHtml\(c\.ms\)/, 'no server.js page reads a Malay .ms field');
});

test('routes /weather* are registered: 6 static + search + :slug (+air/sun), static first', () => {
  for (const r of ['/weather', '/weather/map', '/weather/codes', '/weather/clouds', '/weather/wind',
    '/weather/extremes', '/weather/search', '/weather/:slug/air', '/weather/:slug/sun', '/weather/:slug']) {
    assert.ok(serverSrc.includes(`app.get('${r}'`), `route ${r} must be registered`);
  }
  // :slug must be registered LAST so static names are not captured by it
  const last = serverSrc.lastIndexOf(`app.get('/weather/:slug'`);
  for (const r of ['/weather/map', '/weather/search', '/weather/:slug/air']) {
    assert.ok(serverSrc.indexOf(`app.get('${r}'`) < last, `${r} must be registered before /weather/:slug`);
  }
});

test('no route-registration loop over a `const` (TDZ) — the city slug resolves in the handler', () => {
  assert.doesNotMatch(serverSrc, /for \(const c of wx\.CITIES\)\s*app\.get/, 'a wx.CITIES loop is forbidden (TDZ)');
  assert.match(serverSrc, /wx\.resolveCity\(slug\)/, 'resolveCity is called inside the handler');
  assert.match(serverSrc, /redirect\(302, `\/weather\/\$\{city\.slug\}`\)/, 'search → 302 to the city page');
});

test('API failure / unknown city → weatherBusy noindex,follow + non-200 status', () => {
  assert.match(serverSrc, /function weatherBusy\(/, 'weatherBusy is defined');
  const busy = serverSrc.slice(serverSrc.indexOf('function weatherBusy'), serverSrc.indexOf('function weatherBusy') + 1200);
  assert.ok(busy.includes('noindex,follow'), 'the busy page must be noindex,follow');
  assert.match(serverSrc, /weatherBusy\([\s\S]{0,120}\), 503\)/, 'API down → 503 + weatherBusy');
  assert.match(serverSrc, /weatherBusy\([\s\S]{0,120}\), 404\)/, 'missing city → 404 + weatherBusy');
  assert.match(serverSrc, /index,follow,max-image-preview:large/, 'canonical pages are indexable + large image');
});

test('src/weather.js: only FREE-tier endpoints + budget/breaker guards', () => {
  for (const ep of ['/data/2.5/weather', '/data/2.5/forecast', '/data/2.5/air_pollution', '/geo/1.0/direct']) {
    assert.ok(weatherSrc.includes(ep), `free-tier endpoint ${ep} is used`);
  }
  assert.doesNotMatch(weatherSrc, /\/data\/3\.\/onecall|\/data\/2\.5\/history/, 'PAID endpoints (OneCall/history) are forbidden');
  assert.match(weatherSrc, /dailyBudget/, 'the daily call budget is fenced');
  assert.match(weatherSrc, /WeatherDownError/, 'a quota/down error class exists');
  assert.ok(weatherSrc.includes('429') && weatherSrc.includes('breakerUntil'), '429 → 15-minute breaker');
  // Free map tiles + tile links go through config
  assert.match(serverSrc, /wx\.tileTemplateUrl/, 'the map page uses OpenWeather tiles');
});

test('sitemap-cuaca.xml + robots: 6 static + every DB city ×3 URLs; stats+nav indexable', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-cuaca\.xml'/, 'the sitemap-cuaca route exists');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-cuaca.xml'"), serverSrc.indexOf("app.get('/sitemap-cuaca.xml'") + 2000);
  assert.ok(sm.includes('wx.CITIES.map'), 'every DB city is listed in the sitemap');
  for (const suffix of ['/air', '/sun']) assert.ok(sm.includes(suffix), `city ×${suffix} in the sitemap`);
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-cuaca\.xml/, 'robots.txt advertises sitemap-cuaca');
  // Tidy SEO: /weather* in the main sitemap list + site header/footer nav
  assert.ok(serverSrc.includes("const staticPages = ['', '/nasa'") && serverSrc.includes("'/weather/clouds'"), 'the main sitemap lists the /weather pages');
  assert.match(serverSrc, /link\('\/weather', 'Weather', 'cuaca'\)/, 'siteHeader has a Weather link');
  const footerCol = serverSrc.slice(serverSrc.indexOf('<h4>Weather</h4>'), serverSrc.indexOf('<h4>Weather</h4>') + 1200);
  assert.ok(footerCol.includes('<li><a href="/weather/clouds">Cloud types</a></li>'), 'siteFooter has the world education page');
  assert.ok(footerCol.includes('<li><a href="/weather/wind">Beaufort wind scale</a></li>'), 'siteFooter has the wind scale page');
  // Policy: site chrome does NOT promote specific local city pages (global traffic).
  assert.ok(!footerCol.includes('/weather/kuala-lumpur') && !footerCol.includes('/weather/serian'), 'no local city labels in the footer');
});

test('NASA sky ↔ weather cross-links + JSON-LD Place/Dataset on city pages', () => {
  assert.match(serverSrc, /nasa\/sky\?lat=/, 'city pages link to /nasa/sky?lat&lng');
  assert.ok(weatherSrc.includes('OpenWeather'), 'the data source is documented');
  const cityIdx = serverSrc.indexOf('function cuacaCityPage');
  const citySrc = serverSrc.slice(cityIdx, cityIdx + 8000);
  assert.ok(citySrc.includes("'Place'"), 'city pages carry JSON-LD Place');
  const airIdx = serverSrc.indexOf('function cuacaAirPage');
  const airSrc = serverSrc.slice(airIdx, airIdx + 8000);
  assert.ok(airSrc.includes("'Dataset'") || airSrc.includes('"Dataset"'), 'air pages carry JSON-LD Dataset');
});
