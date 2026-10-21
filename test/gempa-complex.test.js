'use strict';
// Earthquake Complex invariants: keyless USGS feed + 7 English sections + sitemap-gempa + cross links.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const gempaSrc = fs.readFileSync(path.join(ROOT, 'src', 'gempa.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

const SECTIONS = ['/gempa', '/gempa/malaysia', '/gempa/asia-tenggara', '/gempa/jepun',
  '/gempa/pasifik-timur', '/gempa/dunia', '/gempa/penjelasan'];

test('GEMPA_SECTIONS + REGIONS list 7 sections (6 regions + explanation)', () => {
  for (const p of SECTIONS) assert.ok(serverSrc.includes(`'${p}'`), `section ${p} present in the nav`);
  assert.match(gempaSrc, /slug: 'malaysia'/, 'the malaysia region is defined in the module');
  assert.match(gempaSrc, /slug: 'dunia'/, 'the world feed is defined');
});

test('the quake renderers are defined and wrapped through gempaDoc (3 slots + nav + lang en)', () => {
  for (const fn of ['gempaHubPage', 'gempaRegionPage', 'gempaExplainPage', 'gempaDoc', 'gempaNav', 'gempaBusy']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} is defined`);
  }
  const idx = serverSrc.indexOf('function gempaDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) assert.ok(doc.includes(slot), `gempaDoc renders ${slot}`);
  assert.ok(doc.includes('gempaNav()'), 'gempaDoc embeds the earthquake nav (hub links)');
  assert.ok(doc.includes('<html lang="en">'), 'quake pages are lang="en"');
});

test('the /gempa* routes register in order: hub, literal explanation, then :region', () => {
  const hub = serverSrc.indexOf("app.get('/gempa'");
  const pen = serverSrc.indexOf("app.get('/gempa/penjelasan'");
  const reg = serverSrc.indexOf("app.get('/gempa/:region'");
  assert.ok(hub > -1 && pen > hub && reg > pen, 'registration order: /gempa < penjelasan < :region');
  assert.match(serverSrc, /gp\.findRegion\(req\.params\.region\)/, 'the region slug is validated INSIDE the handler (no TDZ)');
  assert.doesNotMatch(serverSrc, /for \(const r of gp\.REGIONS\)\s*app\.get/, 'looping over REGIONS to register routes is forbidden');
});

test('feed failure → 503, wrong region → 404, both through noindex gempaBusy', () => {
  const busy = serverSrc.slice(serverSrc.indexOf('function gempaBusy'), serverSrc.indexOf('function gempaBusy') + 900);
  assert.ok(busy.includes('noindex,follow'), 'gempaBusy is noindex,follow');
  assert.ok(busy.includes('Back to the Earthquake Complex'), 'gempaBusy escape hatch is in English');
  assert.match(serverSrc, /status\(503\)\.type\('html'\)\.send\(gempaBusy/, 'the 503 path uses gempaBusy');
  assert.match(serverSrc, /status\(404\)\.type\('html'\)\.send\(gempaBusy/, 'the bad-region 404 uses gempaBusy');
});

test('USGS: no API key, valid FDSN parameters, 10-minute cache', () => {
  assert.ok(gempaSrc.includes('earthquake.usgs.gov/fdsnws/event/1/query'), 'the FDSN query endpoint');
  assert.doesNotMatch(gempaSrc, /apikey|api_key|appid|token/, 'no key required (public data)');
  assert.ok(gempaSrc.includes('minlongitude') && gempaSrc.includes('maxlatitude'), 'bbox sent in FDSN form (not "bbox")');
  assert.doesNotMatch(gempaSrc, /params\.bbox\b/, 'the wrong "bbox" parameter is not used');
  assert.match(gempaSrc, /TTL = 10 \* 60 \* 1000/, 'cached for 10 minutes');
});

test('the quake copy is English: labels translated, public slugs preserved', () => {
  const pages = serverSrc.slice(serverSrc.indexOf('function gempaRegionPage'), serverSrc.indexOf('const CUTI_SECTIONS'));
  assert.ok(pages.includes("inLanguage: 'en'"), 'the explanation article declares inLanguage en');
  assert.ok(pages.includes('Drop, Cover, Hold') || pages.includes('Drop \\u2014 Cover'), 'the safety protocol uses the English wording');
  assert.doesNotMatch(pages, /Reda|Lindungi|Tahan|Bahasa Melayu/, 'no Malay safety wording remains on the quake pages');
  assert.match(gempaSrc, /slug: 'asia-tenggara', name: 'Southeast Asia'/, 'region labels are English while the URL slug stays Malay');
});

test('sitemap-gempa.xml + robots + weather↔quake cross links & footer', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-gempa\.xml'/, 'the sitemap-gempa route exists');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-gempa.xml'"), serverSrc.indexOf("app.get('/sitemap-gempa.xml'") + 1300);
  assert.ok(sm.includes('gp.REGIONS.map'), 'every region goes into the sitemap');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-gempa\.xml/, 'robots advertises sitemap-gempa');
  assert.ok(serverSrc.includes('<li><a href="/gempa">World Earthquakes</a></li>'), 'the footer links to the world quake hub');
  assert.ok(serverSrc.includes('<a href="/gempa">Earthquake Complex</a>'), 'the weather hub cross-links to the earthquake complex');
  assert.ok(serverSrc.includes("'/gempa', '/gempa/penjelasan'"), 'the main sitemap lists /gempa');
});
