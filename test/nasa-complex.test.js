'use strict';
// Invarian NASA Space Complex: 11 seksyen SSR + arkib APOD per-tarikh (±11k halaman
// SEO) + sitemap-nasa ber-years. Semua halaman lalu melalui nasaDoc → 3 unit iklan.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

const SECTIONS = ['/nasa', '/nasa/archive', '/nasa/sky', '/nasa/iss', '/nasa/asteroids',
  '/nasa/space-weather', '/nasa/mars', '/nasa/earth', '/nasa/exoplanets', '/nasa/sounds', '/nasa/satellites'];

test('NASA_SECTSEN menyenaraikan 11 seksyen ruang angkas', () => {
  for (const p of SECTIONS) {
    assert.ok(serverSrc.includes(`'${p}'`), `seksyen ${p} mesti wujud dalam NASA_SECTIONS/nav`);
  }
});

test('setiap renderer seksyen ditakrif dan dibungkus melalui nasaDoc', () => {
  for (const fn of ['nasaApodDatePage', 'nasaArchivePage', 'nasaSkyPage', 'nasaIssPage',
    'nasaAsteroidsPage', 'nasaSpaceWeatherPage', 'nasaMarsPage', 'nasaEarthPage',
    'nasaExoplanetsPage', 'nasaSoundsPage', 'nasaSatellitesPage']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} ditakrif`);
  }
  assert.match(serverSrc, /function nasaDoc\(o\)/, 'shell nasaDoc ditakrif');
  // nasaDoc mesti hidang 3 slot iklan + loader + nav silang-paut
  const doc = serverSrc.slice(serverSrc.indexOf('function nasaDoc(o)'), serverSrc.indexOf('function nasaDoc(o)') + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) {
    assert.ok(doc.includes(slot), `nasaDoc perlu memaparkan ${slot}`);
  }
  assert.ok(doc.includes('nasaSpaceNav()'), 'nasaDoc perlu nav ruang angkasa (hub pautan)');
});

test('laluan /nasa/* berdaftar: archive, apod/:date, random, 9 seksyen parameterized', () => {
  for (const r of ['/nasa/random', '/nasa/archive', '/nasa/apod/:date', '/nasa/sky', '/nasa/iss',
    '/nasa/asteroids', '/nasa/space-weather', '/nasa/mars', '/nasa/mars/:slug', '/nasa/earth',
    '/nasa/exoplanets', '/nasa/sounds', '/nasa/sounds/:topic', '/nasa/satellites', '/nasa/satellites/:group']) {
    assert.ok(serverSrc.includes(`app.get('${r}'`), `laluan ${r} perlu berdaftar`);
  }
});

test('tiada loop daftar-route atas `const` (TDZ) — slug disahkan dalam handler + 301', () => {
  assert.doesNotMatch(serverSrc, /for \(const rv of MARS_ROVERS\)\s*app\.get/, 'loop MARS_ROVERS diharamkan (TDZ)');
  assert.match(serverSrc, /redirect\(301, '\/nasa\/mars'\)/, 'slug mars salah → 301');
  assert.match(serverSrc, /redirect\(301, '\/nasa\/sounds'\)/, 'topic sounds salah → 301');
  assert.match(serverSrc, /redirect\(301, '\/nasa\/satellites'\)/, 'group satellites salah → 301');
});

test('halaman filter/query → noindex,follow; halaman canonical → index,follow', () => {
  assert.match(serverSrc, /noindex,follow/, 'token noindex untuk paparan ?q/?d/?lat');
  assert.match(serverSrc, /index,follow,max-image-preview:large/, 'canonical boleh indeks + gambar besar');
});

test('sitemap-nasa: indeks ber-years + laluan regex tahun; robots.txt mengiklankannya', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-nasa\.xml'/, 'indeks sitemap NASA wujud');
  assert.ok(serverSrc.includes('sitemap-nasa-(\\d{4})'), 'laluan regex tahun wujud');
  assert.match(serverSrc, /function apodDatesInYear/, 'penjana tarikh APOD setahun wujud');
  assert.match(serverSrc, /1995-06-16/, 'APOD first day 1995-06-16 menjadi floor');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-nasa\.xml/, 'robots.txt iklankan sitemap-nasa');
});

test('kegagalan API → 503 + nasaBusy noindex (kosong tak masuk indeks)', () => {
  assert.match(serverSrc, /function nasaBusy\(/, 'nasaBusy ditakrif');
  assert.match(serverSrc, /status\(503\)[\s\S]{0,80}nasaBusy|nasaBusy\([\s\S]{0,120}503/, 'laluan NASA guna 503 semasa API down');
});

test('APOD video ("Sonified:") → iframe player + poster, BUKAN <img src=youtube> rosak', () => {
  assert.match(serverSrc, /function nasaVideoId\(/, 'pengenal ID YouTube berpusat');
  assert.match(serverSrc, /function nasaVideoPlayer\(/, 'player iframe disediakan');
  assert.match(serverSrc, /function nasaVideoPoster\(/, 'poster untuk og:image');
  const today = serverSrc.slice(serverSrc.indexOf('function renderNasaApodPage'), serverSrc.indexOf('function nasaSpaceNav'));
  assert.ok(today.includes('nasaVideoPlayer(a.url, title, true)'), 'halaman hari ini guna player utk video');
  assert.ok(!/mediaType === 'video'[\s\S]{0,160}String\(a\.url \|\| ''\)\)/.test(today), 'URL video tidak pernah jadi nilai <img>/og terus');
  assert.match(today, /'@type': 'VideoObject'/, 'JSON-LD video untuk media_type=video');
  const dated = serverSrc.slice(serverSrc.indexOf('function nasaApodDatePage'), serverSrc.indexOf('function nasaArchivePage'));
  assert.ok(dated.includes('nasaVideoPlayer(a.url, title, true)'), 'halaman arkib ikut tarikh guna player juga');
  assert.match(dated, /'@type': 'VideoObject'/, 'LD arkib ikut tarikh sedar video');
  const arch = serverSrc.slice(serverSrc.indexOf('function nasaArchivePage'), serverSrc.indexOf('function nasaSkyPage'));
  assert.ok(arch.includes('nasaVideoPoster(e)'), 'thumbnail arkib papar poster video');
});
