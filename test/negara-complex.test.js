'use strict';
// Invariants of the Country Complex: key-free sources + hub/continent/country renderers
// + the country sitemap + robots + cross links. No network — static checks only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const negaraSrc = fs.readFileSync(path.join(ROOT, 'src', 'negara.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

test('negara.js: key-free sources (jsDelivr + World Bank + flagcdn), 30-day cache', () => {
  assert.ok(negaraSrc.includes('cdn.jsdelivr.net/npm/world-countries'), 'world-countries dataset via jsDelivr');
  assert.ok(negaraSrc.includes('api.worldbank.org/v2/country/all/indicator'), 'World Bank Open Data indicators');
  assert.ok(negaraSrc.includes('flagcdn.com'), 'flags from flagcdn');
  assert.doesNotMatch(negaraSrc, /apikey|api_key|appid|Bearer|token/i, 'no keyed / signup-gated API');
  assert.match(negaraSrc, /TTL = 30 \* 24 \* 60 \* 60 \* 1000/, '30-day cache');
  assert.ok(negaraSrc.includes('restcountries'), 'the drop of restcountries v3.1 (deprecated) is documented');
  assert.doesNotMatch(negaraSrc, /restcountries\.com\/v3|all\.json/, 'the dead restcountries endpoint is not used');
});

test('negara.js: the holiday-module IPv6 pitfall is handled — family 6 first, fallback 4', () => {
  assert.match(negaraSrc, /new https\.Agent\(\{ family: 6/, 'v6Agent exists');
  assert.match(negaraSrc, /new https\.Agent\(\{ family: 4/, 'v4Agent fallback exists');
});

test('negara.js: 6 regions + slug + cca3→slug borders are exported', () => {
  for (const slug of ['asia', 'africa', 'europe', 'americas', 'oceania', 'antarctic']) {
    assert.ok(negaraSrc.includes(`slug: '${slug}'`), `region ${slug} is defined`);
  }
  const ex = negaraSrc.slice(negaraSrc.indexOf('module.exports'));
  for (const fn of ['loadCountries', 'findCountry', 'inRegion', 'findRegion', 'REGIONS', 'flagUrl', 'slugify']) {
    assert.ok(ex.includes(fn), `${fn} is exported`);
  }
  assert.ok(!ex.includes('BM_NAMES') && !ex.includes('REGION_BM'), 'the Malay name tables are no longer exported');
  assert.ok(negaraSrc.includes('borderSlugs'), 'the cca3→slug neighbour map is built');
});

test('the country data model is English-only: no bm field survives', () => {
  const ng = require(path.join(ROOT, 'src', 'negara.js'));
  assert.doesNotMatch(negaraSrc, /\bbm:/, 'the merged rows carry no bm label');
  assert.doesNotMatch(negaraSrc, /BM_NAMES|REGION_BM/, 'the Malay name lookup tables are deleted');
  for (const r of ng.REGIONS) assert.deepStrictEqual(Object.keys(r), ['slug', 'en'], `${r.slug} is {slug,en}`);
  // inRegion must resolve our slug back onto the restcountries English region value.
  assert.match(negaraSrc, /c\.region === \(r \? r\.en : ''\)/, 'inRegion filters on the English region name');
  assert.deepStrictEqual(ng.inRegion([{ region: 'Asia', name: 'B' }, { region: 'Europe', name: 'A' }, { region: 'Asia', name: 'C' }], 'asia').map((c) => c.name), ['B', 'C'], 'the Asian subset is picked and sorted');
  assert.strictEqual(ng.inRegion([{ region: 'Asia', name: 'A' }], 'nope').length, 0, 'an unknown slug yields an empty list');
});

test('the country copy is English: labels translated, public slugs preserved', () => {
  // Anchor on the next complex's own declaration: internal identifiers are never renamed.
  const pages = serverSrc.slice(serverSrc.indexOf('const NEGARA_SECTIONS'), serverSrc.indexOf('const STAT_SECTIONS'));
  assert.ok(pages.length > 5000, 'the slice really covers the country pages');
  assert.doesNotMatch(pages, /buah negara|ibu negara|belum sempat|tiada data|pedalan|jiran|Kompleks Negara|Bahasa Melayu|KDNK|benua & subwilayah/i, 'no Malay editorial copy left');
  assert.ok(pages.includes('Sovereign state') && pages.includes('Dependent territory'), 'the status row is English');
  assert.ok(pages.includes('Capital:') && pages.includes('Neighbours (land borders)'), 'the profile rows are English');
  // URLs are public contracts too, and English is the public language: /countries, /holidays.
  assert.ok(pages.includes('/countries/${c.slug}'), 'country links keep the English-derived slugs');
  assert.ok(pages.includes('/holidays/world/${cutiCoun.slug}'), 'the holiday cross-link keeps its Nager slug');
  assert.ok(pages.includes('flagcdn.com') && pages.includes('ng.REGIONS'), 'the flag CDN and region loop are intact');
  assert.ok(pages.includes('/countries/${r.slug}'), 'continent links keep the six public slugs');
  assert.ok(pages.includes("name: c.name"), 'the schema.org Country node is named in English');
});

test('the country pages are defined and wrapped through negaraDoc (3 ad slots + nav + lang en)', () => {
  for (const fn of ['negaraHubPage', 'negaraRegionPage', 'negaraCountryPage', 'negaraDoc', 'negaraNav', 'negaraBusy']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} is defined`);
  }
  const idx = serverSrc.indexOf('function negaraDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) assert.ok(doc.includes(slot), `negaraDoc has ${slot}`);
  assert.ok(doc.includes('negaraNav()'), 'negaraDoc embeds the country nav (hub links)');
  assert.ok(doc.includes('<html lang="en">'), 'country pages are lang="en"');
  assert.ok(doc.includes('og:locale" content="en_US"'), 'og locale en_US');
});

test('the /countries* routes register in order: literal hub first, then :slug', () => {
  const hub = serverSrc.indexOf("app.get('/countries'");
  const one = serverSrc.indexOf("app.get('/countries/:slug'");
  assert.ok(hub > -1 && one > hub, 'registration order: /countries < :slug');
  assert.match(serverSrc, /ng\.findRegion\(slug\)/, 'the continent is validated INSIDE the handler (no TDZ)');
  assert.match(serverSrc, /ng\.findCountry\(rows, slug\)/, 'the country is validated INSIDE the handler');
  assert.doesNotMatch(serverSrc, /for \(const r of ng\.REGIONS\)\s*app\.get/, 'a route-registration loop over REGIONS is forbidden');
  const staticIdx = serverSrc.indexOf('app.use(express.static(PUBLIC_DIR');
  assert.ok(one < staticIdx, 'the country routes come before the static middleware');
});

test('a dataset failure → 503, a wrong slug → 404, both through the noindex negaraBusy', () => {
  const busy = serverSrc.slice(serverSrc.indexOf('function negaraBusy'), serverSrc.indexOf('function negaraBusy') + 900);
  assert.ok(busy.includes('noindex,follow'), 'negaraBusy is noindex,follow');
  assert.ok(busy.includes('Back to the Country Complex'), 'negaraBusy links back in English');
  assert.match(serverSrc, /status\(503\)\.type\('html'\)\.send\(negaraBusy/, 'the 503 uses negaraBusy');
  assert.match(serverSrc, /status\(404\)\.type\('html'\)\.send\(negaraBusy/, 'the 404 (bad slug) uses negaraBusy');
});

test('sitemap-countries.xml + robots + footer + cross links from the other three complexes', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-countries\.xml'/, 'the sitemap-countries route exists');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-countries.xml'"), serverSrc.indexOf("app.get('/sitemap-countries.xml'") + 1500);
  assert.ok(sm.includes('ng.REGIONS.map'), 'the 6 continents enter the sitemap');
  assert.ok(sm.includes('loadCountries'), 'the ±250 countries enter the sitemap once the cache is warm');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-countries\.xml/, 'robots advertises sitemap-countries');
  assert.ok(require(path.join(ROOT, 'src', 'server')).siteFooter().includes('<li><a href="/countries">Countries of the World</a></li>'), 'the SSR footer links to the country hub');
  assert.ok(serverSrc.includes('<a href="/countries">Country Complex</a>'), 'the weather page cross-links to the country complex');
  assert.ok(serverSrc.includes("'/countries', '/countries/asia'"), 'the main sitemap lists /countries');
});

test('deeper country data: per-country World Bank facts + derived world share, cache-reused', () => {
  // A single country profile now also shows a handful of World Bank indicators looked up
  // for that cca3, reusing the SAME cached maps /statistics ranks from — no new keyed API.
  assert.match(serverSrc, /async function countryFacts\(c\)/, 'countryFacts builds the deeper indicators');
  assert.match(serverSrc, /st\.loadWbMap\(ind\.code, ind\.yr\)/, 'facts reuse the statistics World Bank cache (no new source)');
  assert.match(serverSrc, /NG_FACT_NAMES/, 'the deeper-fact indicator set is declared');
  assert.match(serverSrc, /Development &amp; environment in numbers/, 'the deeper-facts section renders');
  assert.match(serverSrc, /Share of world population/, 'the derived world-population share row is present');
  // The route fetches facts (safely) before rendering the country page.
  assert.match(serverSrc, /await countryFacts\(country\)/, 'the :slug route loads the deeper facts');
});
