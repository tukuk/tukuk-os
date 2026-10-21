'use strict';
// Cuti Complex invariants: the WORLD hub (Nager.Date, no key) + 5 continents + country
// pages + world long weekends + the 16-state MY tables + sitemap-cuti.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const cutiSrc = fs.readFileSync(path.join(ROOT, 'src', 'cuti.js'), 'utf8');
const duniaSrc = fs.readFileSync(path.join(ROOT, 'src', 'cuti-dunia.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

const SECTIONS = ['/cuti', '/cuti/2026', '/cuti/2027', '/cuti/hujung-minggu-panjang', '/cuti/penjelasan'];
const NEGARI = ['johor', 'kedah', 'kelantan', 'melaka', 'negeri-sembilan', 'pahang', 'perak', 'perlis',
  'pulau-pinang', 'sabah', 'sarawak', 'selangor', 'terengganu', 'kuala-lumpur', 'putrajaya', 'labuan'];

test('src/cuti.js: 16 states/territories + no API key + 30-day cache', () => {
  for (const slug of NEGARI) assert.ok(cutiSrc.includes(`'${slug}'`), `state slug ${slug} is defined`);
  assert.match(cutiSrc, /TTL = 30 \* 24 \* 60 \* 60 \* 1000/, '30-day cache (schedules rarely change)');
  assert.doesNotMatch(cutiSrc, /apikey|api_key|appid|token/, 'no key required');
  assert.ok(cutiSrc.includes('malaysia-holiday.dydxsoft.my/api/v1'), 'public API endpoint');
  assert.match(cutiSrc, /YEAR_MIN = 2026[\s\S]*YEAR_MAX = 2027/, 'coverage is 2026–2027 only');
});

test('the IPv4 CDN edge returns 403 → requests are forced over IPv6 with a fallback', () => {
  assert.ok(cutiSrc.includes("new https.Agent({ family: 6"), 'the forced-IPv6 agent exists');
  assert.ok(cutiSrc.includes('httpsAgent: v6Agent') && cutiSrc.includes('httpsAgent: plainAgent'), 'IPv6 first, plain fallback');
  assert.ok(cutiSrc.includes('let queueTail = Promise.resolve()'), 'requests are serialised (no fake CDN honeypot)');
});

test('long-weekend maths: consecutive runs + weekend attachment + bridge days', () => {
  assert.match(cutiSrc, /function longWeekends\(rows\)/, 'longWeekends is defined');
  assert.match(cutiSrc, /if \(ld === 5\) span \+= 2/, 'a holiday ending Friday adds 2');
  assert.match(cutiSrc, /if \(fd === 1\) span \+= 2/, 'a holiday starting Monday adds 2');
  assert.match(cutiSrc, /return d === 2 \|\| d === 4/, 'a lone Tuesday/Thursday = a bridge');
  assert.match(cutiSrc, /filter\(\(w\) => w\.spanDays >= 3 \|\| w\.bridge\)/, 'only runs of 3+ days or bridges are shown');
  assert.match(cutiSrc, /function forState\(rows, code\)/, 'national rows are filtered per state (runs must not merge)');
  const real = require(path.join(ROOT, 'src', 'cuti.js'));
  const kl = [
    { name: 'Day X', date: '2026-05-01', state_codes: ['KUL'] },   // Friday → 3 days
    { name: 'Day Y', date: '2026-08-25', state_codes: ['KUL'] },   // Monday → 3 days
    { name: 'Day Z', date: '2027-02-09', state_codes: ['KUL'] },   // Tuesday → bridge
  ];
  const lw = real.longWeekends(kl);
  assert.strictEqual(lw.length, 3, 'all three combinations qualify for display');
  assert.ok(lw.some((w) => w.spanDays === 3 && w.auto), 'a lone Friday/Monday holiday becomes an automatic 3 days');
  assert.ok(lw.some((w) => w.bridge === 1), 'the Tuesday holiday is detected as a bridge');
});

test('the holiday renderers are defined and wrapped by cutiDoc (3 slots + nav + lang en)', () => {
  for (const fn of ['cutiHubPage', 'cutiYearPage', 'cutiLongWeekendPage', 'cutiStatePage', 'cutiExplainPage', 'cutiDoc', 'cutiNav', 'cutiBusy']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} is defined`);
  }
  const idx = serverSrc.indexOf('function cutiDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) assert.ok(doc.includes(slot), `cutiDoc carries ${slot}`);
  assert.ok(doc.includes('cutiNav()'), 'cutiDoc renders the holiday nav (the link hub)');
  assert.ok(doc.includes('<html lang="en">'), 'holiday pages are lang="en"');
  assert.ok(doc.includes('en_US'), 'og:locale en_US');
});

test('CUTI_SECTIONS lists the hub + 5 continents + long weekends + 2 MY years + the guide', () => {
  for (const p of SECTIONS) assert.ok(serverSrc.includes(`'${p}'`), `section ${p} is in the nav`);
  assert.match(serverSrc, /for \(const rg of cd\.REGIONS\) CUTI_SECTIONS\.push/, 'the 5 continent pages are in the nav');
  assert.doesNotMatch(serverSrc, /for \(const st of cu\.STATES\) CUTI_SECTIONS\.push/, 'MY states no longer flood the world nav');
  const navIdx = serverSrc.indexOf('function cutiNav()');
  assert.ok(navIdx > 0 && serverSrc.slice(navIdx, navIdx + 600).includes('Explore the Tukuk-OS World Holiday Complex'), 'the world nav heading');
});

test('the /cuti* routes register in order: hub, literals, the year regex, then :negeri', () => {
  const hub = serverSrc.indexOf("app.get('/cuti'");
  const pen = serverSrc.indexOf("app.get('/cuti/penjelasan'");
  const lw = serverSrc.indexOf("app.get('/cuti/hujung-minggu-panjang'");
  const dun = serverSrc.indexOf("app.get('/cuti/dunia/:slug'");
  const yr = serverSrc.indexOf('app.get(/^\\/cuti\\/');
  const reg = serverSrc.indexOf("app.get('/cuti/:negeri'");
  assert.ok(hub > -1 && pen > hub && lw > pen && yr > lw && dun > yr && reg > dun, 'registration order: hub < penjelasan < hujung-minggu < year < dunia < :negeri');
  assert.match(serverSrc, /cu\.findState\(req\.params\.negeri\)/, 'the state slug is validated INSIDE the handler (no TDZ)');
  assert.match(serverSrc, /cd\.findRegion\(slug\)[\s\S]*cd\.findCountryBySlug\(slug\)/, 'dunia checks the region THEN the country in the handler');
});

test('API failure → 503, a wrong state/year → 404, both through the noindex cutiBusy', () => {
  const busy = serverSrc.slice(serverSrc.indexOf('function cutiBusy'), serverSrc.indexOf('function cutiBusy') + 900);
  assert.ok(busy.includes('noindex,follow'), 'cutiBusy is noindex,follow');
  assert.ok(busy.includes('Back to the Holiday Complex'), 'the escape page links back in English');
  assert.match(serverSrc, /status\(503\)\.type\('html'\)\.send\(cutiBusy/, '503 uses cutiBusy');
  assert.match(serverSrc, /status\(404\)\.type\('html'\)\.send\(cutiBusy/, 'a bad state slug uses cutiBusy for 404');
  assert.match(serverSrc, /year < cu\.YEAR_MIN \|\| year > cu\.YEAR_MAX\) year = cu\.YEAR_MIN/, 'a ?tahun outside coverage falls back to YEAR_MIN');
});

test('sitemap-cuti.xml + robots + footer + the weather/quake ↔ holiday cross links', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-cuti\.xml'/, 'the sitemap-cuti route exists');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-cuti.xml'"), serverSrc.indexOf("app.get('/sitemap-cuti.xml'") + 1600);
  assert.ok(sm.includes('cu.STATES.map'), 'every state is in the sitemap');
  assert.ok(sm.includes('cu.YEAR_MAX'), 'the 2027 (?tahun) variants are in the sitemap');
  assert.ok(sm.includes('cd.REGIONS.map') && sm.includes('cd.COUNTRIES.map'), 'continents + countries are in the sitemap');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-cuti\.xml/, 'robots advertises sitemap-cuti');
  // World policy: the footer chrome promotes the world label, NOT a MY-specific one.
  assert.ok(!serverSrc.includes('<li><a href="/cuti">Public holidays 2026</a></li>'), 'the footer no longer carries a MY holiday label');
  assert.ok(!serverSrc.includes('<li><a href="/cuti/hujung-minggu-panjang">Long weekends MY</a></li>'), 'the footer no longer carries Long weekends MY');
  assert.ok(serverSrc.includes('<li><a href="/cuti">World public holidays</a></li>'), 'the footer carries the world holiday label');
  assert.ok(serverSrc.includes('<a href="/cuti">world public holidays</a>'), 'the weather hub cross-links to the world holidays');
  assert.ok(serverSrc.includes('<a href="/cuti">the public-holiday calendar</a>'), 'the quake pages cross-link to the holiday calendar');
  assert.ok(serverSrc.includes("'/cuti', ") && serverSrc.includes("'/cuti/2026', '/cuti/2027'"), 'the main sitemap lists the holiday pages');
});

test('cuti-dunia.js: Nager.Date without a key, an IPv6 agent, a 30-day cache, a pool of 6', () => {
  assert.ok(duniaSrc.includes('date.nager.at/api/v3'), 'the Nager.Date v3 endpoint');
  assert.doesNotMatch(duniaSrc, /apikey|api_key|appid|token/, 'Nager needs no key');
  assert.ok(duniaSrc.includes('new https.Agent({ family: 6'), 'the forced-IPv6 agent');
  assert.match(duniaSrc, /TTL = 30 \* 24 \* 60 \* 60 \* 1000/, '30-day cache');
  assert.ok(duniaSrc.includes('mapPool(COUNTRIES, 6'), 'a pool of 6 countries at a time');
  assert.ok(duniaSrc.includes('res.statusCode === 204'), 'a 204 (no data) is treated as null');
  const cd = require(path.join(ROOT, 'src', 'cuti-dunia.js'));
  assert.ok(cd.COUNTRIES.length >= 50, 'broad country coverage');
  assert.strictEqual(cd.REGIONS.length, 5, '5 continents');
  // Countries Nager does not support must be dropped so their pages never 503 forever.
  for (const gone of ['India', 'Thailand', 'Israel', 'Saudi Arabia', 'Nepal', 'Malaysia'])
    assert.ok(!cd.COUNTRIES.some(([, en]) => en === gone), `${gone} dropped (no Nager data)`);
  // Our own ASCII slugs, not the diacritic-stripped country slugs.
  assert.strictEqual(cd.findCountryBySlug('turkey').cca2, 'TR', 'the turkey slug works (not t-rkiye)');
  assert.strictEqual(cd.findCountryBySlug('t-rkiye'), null, 'a diacritic-mangled slug was never registered');
  assert.ok(!('bm' in cd.REGIONS[0]), 'regions carry no Malay display field any more');
});

test('the world renderers + helpers + 503/404 pages are supported by server.js', () => {
  for (const fn of ['cutiHubPage', 'cutiRegionPage', 'cutiCountryPage', 'ctWorldTable', 'ctWorldLwTable', 'ctNation', 'CT_REGION_NOTES']) {
    assert.ok(serverSrc.includes(fn), `${fn} exists`);
  }
  assert.ok(serverSrc.includes('function ctWorldLwTable'), 'ctWorldLwTable is defined');
  // Nager's LongWeekend gives startDate/endDate — normalised to start/end before rendering.
  const route = serverSrc.slice(serverSrc.indexOf("app.get('/cuti/dunia/:slug'"), serverSrc.indexOf("app.get('/cuti/:negeri'"));
  assert.ok(route.includes('start: w.startDate') && route.includes('needBridge: !!w.needBridgeDay'), 'the country LW rows are normalised');
  assert.ok(route.includes('cd.loadHolidays(2026'), 'the country page loads the holidays');
  assert.match(route, /status\(404\)[\s\S]*status\(503\)/, 'outside coverage → 404, a load failure → 503');
});

test('the holiday copy is English: labels translated, public slugs preserved', () => {
  // Anchor on the next complex's own declaration: internal identifiers are never renamed.
  const pages = serverSrc.slice(serverSrc.indexOf('const CUTI_SECTIONS'), serverSrc.indexOf('const NEGARA_SECTIONS'));
  assert.ok(pages.length > 5000, 'the slice really covers the holiday pages');
  assert.ok(pages.includes("inLanguage: 'en'"), 'the holiday articles declare inLanguage en');
  assert.doesNotMatch(pages, /inLanguage: 'ms'/, 'no holiday page still claims Malay structured data');
  assert.doesNotMatch(pages, /Jumaat|Sabtu|Ahad|Isnin|belum sempat|tiada data|Kompleks Cuti|cuti umum|Bahasa Melayu/, 'no Malay wording remains on the holiday pages');
  assert.match(pages, /function cutiBusy\(msg\)[\s\S]*The holiday calendar source did not answer in time/, 'the escape page reads in English');
  // Slugs and query keys stay Malay — they are public URLs, not editorial copy.
  for (const slug of ['/cuti/hujung-minggu-panjang', '/cuti/penjelasan', '?tahun=', '/cuti/dunia/'])
    assert.ok(pages.includes(slug), `the public slug ${slug} is preserved`);
});

test('the state page compares the weekend label against the value cuti.js really stores', () => {
  const cu = require(path.join(ROOT, 'src', 'cuti.js'));
  const fridayStates = cu.STATES.filter((s) => s.weekend === 'Friday–Saturday').map((s) => s.name).sort();
  assert.deepStrictEqual(fridayStates, ['Johor', 'Kedah', 'Kelantan', 'Terengganu'], 'four states keep the Friday–Saturday weekend');
  assert.doesNotMatch(cutiSrc, /Jumaat|Sabtu|Ahad|Isnin/, 'the weekend labels in cuti.js are English');
  // server.js branches on the same string, so the substitute-day sentence still fires.
  assert.ok(serverSrc.includes("'Friday\\u2013Saturday'") || serverSrc.includes("'Friday–Saturday'"), 'the state page tests the English weekend label');
});
