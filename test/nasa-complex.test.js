'use strict';
// Invariants of the NASA Space Complex: 11 server-rendered sections + a per-date APOD archive
// (±11k SEO pages) + a year-bucketed sitemap-nasa. Every page goes through nasaDoc → 3 ad slots.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

const SECTIONS = ['/nasa', '/nasa/archive', '/nasa/sky', '/nasa/iss', '/nasa/asteroids',
  '/nasa/space-weather', '/nasa/mars', '/nasa/earth', '/nasa/exoplanets', '/nasa/sounds', '/nasa/satellites'];

test('NASA_SECTIONS lists the 11 space sections', () => {
  for (const p of SECTIONS) {
    assert.ok(serverSrc.includes(`'${p}'`), `section ${p} must exist in NASA_SECTIONS/nav`);
  }
});

test('every section renderer is defined and wrapped through nasaDoc', () => {
  for (const fn of ['nasaApodDatePage', 'nasaArchivePage', 'nasaSkyPage', 'nasaIssPage',
    'nasaAsteroidsPage', 'nasaSpaceWeatherPage', 'nasaMarsPage', 'nasaEarthPage',
    'nasaExoplanetsPage', 'nasaSoundsPage', 'nasaSatellitesPage']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} is defined`);
  }
  assert.match(serverSrc, /function nasaDoc\(o\)/, 'the nasaDoc shell is defined');
  // nasaDoc must serve 3 ad slots + the loader + the cross-linked nav
  const doc = serverSrc.slice(serverSrc.indexOf('function nasaDoc(o)'), serverSrc.indexOf('function nasaDoc(o)') + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) {
    assert.ok(doc.includes(slot), `nasaDoc needs to render ${slot}`);
  }
  assert.ok(doc.includes('nasaSpaceNav()'), 'nasaDoc needs the space nav (link hub)');
});

test('the /nasa/* routes are registered: archive, apod/:date, random, 9 parameterized sections', () => {
  for (const r of ['/nasa/random', '/nasa/archive', '/nasa/apod/:date', '/nasa/sky', '/nasa/iss',
    '/nasa/asteroids', '/nasa/space-weather', '/nasa/mars', '/nasa/mars/:slug', '/nasa/earth',
    '/nasa/exoplanets', '/nasa/sounds', '/nasa/sounds/:topic', '/nasa/satellites', '/nasa/satellites/:group']) {
    assert.ok(serverSrc.includes(`app.get('${r}'`), `the ${r} route must be registered`);
  }
});

test('no route-registration loop over a `const` (TDZ) — slugs are validated inside the handler + 301', () => {
  assert.doesNotMatch(serverSrc, /for \(const rv of MARS_ROVERS\)\s*app\.get/, 'a MARS_ROVERS loop is forbidden (TDZ)');
  assert.match(serverSrc, /redirect\(301, '\/nasa\/mars'\)/, 'a bad mars slug → 301');
  assert.match(serverSrc, /redirect\(301, '\/nasa\/sounds'\)/, 'a bad sounds topic → 301');
  assert.match(serverSrc, /redirect\(301, '\/nasa\/satellites'\)/, 'a bad satellites group → 301');
});

test('filtered/query pages → noindex,follow; canonical pages → index,follow', () => {
  assert.match(serverSrc, /noindex,follow/, 'the noindex token for ?q/?d/?lat views');
  assert.match(serverSrc, /index,follow,max-image-preview:large/, 'canonical is indexable + large images');
});

test('sitemap-nasa: a year-bucketed index + the year regex route; robots.txt advertises it', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-nasa\.xml'/, 'the NASA sitemap index exists');
  assert.ok(serverSrc.includes('sitemap-nasa-(\\d{4})'), 'the year regex route exists');
  assert.match(serverSrc, /function apodDatesInYear/, 'the one-year APOD date generator exists');
  assert.match(serverSrc, /1995-06-16/, 'the APOD first day 1995-06-16 is the floor');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-nasa\.xml/, 'robots.txt advertises sitemap-nasa');
});

test('an API failure → 503 + nasaBusy noindex (empty pages never reach the index)', () => {
  assert.match(serverSrc, /function nasaBusy\(/, 'nasaBusy is defined');
  assert.match(serverSrc, /status\(503\)[\s\S]{0,80}nasaBusy|nasaBusy\([\s\S]{0,120}503/, 'the NASA routes use 503 while the API is down');
});

test('an APOD video ("Sonified:") → an iframe player + poster, NOT a broken <img src=youtube>', () => {
  assert.match(serverSrc, /function nasaVideoId\(/, 'the YouTube ID extractor is centralised');
  assert.match(serverSrc, /function nasaVideoPlayer\(/, 'the iframe player is provided');
  assert.match(serverSrc, /function nasaVideoPoster\(/, 'a poster for og:image');
  const today = serverSrc.slice(serverSrc.indexOf('function renderNasaApodPage'), serverSrc.indexOf('function nasaSpaceNav'));
  assert.ok(today.includes('nasaVideoPlayer(a.url, title, true)'), 'today\'s page uses the player for video');
  assert.ok(!/mediaType === 'video'[\s\S]{0,160}String\(a\.url \|\| ''\)\)/.test(today), 'a video URL never becomes an <img>/og value directly');
  assert.match(today, /'@type': 'VideoObject'/, 'video JSON-LD for media_type=video');
  const dated = serverSrc.slice(serverSrc.indexOf('function nasaApodDatePage'), serverSrc.indexOf('function nasaArchivePage'));
  assert.ok(dated.includes('nasaVideoPlayer(a.url, title, true)'), 'the dated archive page uses the player too');
  assert.match(dated, /'@type': 'VideoObject'/, 'the dated archive LD is video-aware');
  const arch = serverSrc.slice(serverSrc.indexOf('function nasaArchivePage'), serverSrc.indexOf('function nasaSkyPage'));
  assert.ok(arch.includes('nasaVideoPoster(e)'), 'the archive thumbnail shows the video poster');
});

// ——— Data honesty & quality (October 2026 audit: "don't embarrass NASA") ———
test('asteroids: NO invented data — the fallback is the real archive + an honest notice', () => {
  const nasaSrc = fs.readFileSync(path.join(ROOT, 'src', 'nasa.js'), 'utf8');
  assert.ok(!nasaSrc.includes('fallbackAsteroids'), 'the mock asteroid list must stay deleted');
  assert.ok(nasaSrc.includes("source: 'archive'"), 'a failed route serves the real NeoWs archive');
  assert.ok(nasaSrc.includes("source: 'unavailable'"), 'an empty archive → honest, not mock');
  assert.ok(nasaSrc.includes('latestAsteroids('), 'the archive getter is used');
  // the renderer must carry the archive/unavailable source notice
  assert.match(serverSrc, /week\.source === 'archive'/, 'the archive notice is rendered');
  assert.match(serverSrc, /week\.source === 'unavailable'/, 'the no-feed notice is rendered');
  assert.match(serverSrc, /Nothing below is simulated/, 'the archive honesty text');
});

test('audio: a topic-relevance filter + de-duplication of coverage channels', () => {
  const nasaSrc = fs.readFileSync(path.join(ROOT, 'src', 'nasa.js'), 'utf8');
  assert.match(nasaSrc, /const AUDIO_TOPICS = \{/, 'the audio topic map is defined');
  assert.ok(nasaSrc.includes('cfg.words.some'), 'keyword relevance is filtered');
  assert.ok(nasaSrc.includes('seenKey'), 'identical channel titles are de-duplicated');
  assert.ok(nasaSrc.includes("reject: ['launch coverage']"), 'planets: launch coverage is rejected');
});

test('NASA images: every content <img> has width/height (CLS) + CSS height:auto', () => {
  const imgFn = serverSrc.slice(serverSrc.indexOf('function nasaImg('), serverSrc.indexOf('function nasaVideoId('));
  assert.match(imgFn, /width="1280" height="720"/, 'nasaImg reserves the aspect ratio');
  assert.match(serverSrc, /\.nasa-img\{max-width:100%;height:auto/, 'the nasa-img CSS has height:auto');
  assert.match(serverSrc, /id="epicimg"[^>]*width="1024" height="1024"/, 'the EPIC player carries dimensions');
});

// ── Direct ISS auto-refresh (2026-10-18): a 15s client poll + honest source markers ──
const nasaSrc = fs.readFileSync(path.join(ROOT, 'src', 'nasa.js'), 'utf8');

test('ISS: the live.json route exists and the page polls every 15s', () => {
  assert.ok(serverSrc.includes("app.get('/nasa/iss/live.json'"), 'a JSON route for the auto-refresh');
  assert.ok(serverSrc.includes('setInterval(poll,15000)'), 'the client polls every 15s');
  assert.ok(serverSrc.includes("fetch('/nasa/iss/live.json'"), 'the poll fetches the JSON');
  assert.ok(serverSrc.includes('id="issbase"'), 'the base image has an id for the fallback chain');
  assert.ok(serverSrc.includes('three-globe/example/img/earth-blue-marble.jpg'), 'host 1 is the fallback when Wikimedia fails');
});

test('ISS: honest telemetry — source markers, NO invented 0,0 position', () => {
  assert.ok(nasaSrc.includes("source: 'live'"), 'the current reading is marked live');
  assert.ok(nasaSrc.includes("source: 'last-known'"), 'on failure → the real last position, not an invention');
  assert.ok(nasaSrc.includes("return { source: 'unavailable' }"), 'nothing at all → an honest unavailable');
  assert.ok(!/latitude: 0,/.test(nasaSrc), 'the fake 0,0 fallback is removed for good');
  assert.ok(nasaSrc.includes("setCache('iss:last-good'"), 'last-good is cached for the busy mode');
});
