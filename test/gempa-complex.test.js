'use strict';
// Invarian Gempa Complex: USGS tanpa kunci + 7 seksyen BM + sitemap-gempa + pautan silang.
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

test('GEMPA_SECTIONS + REGIONS menyenaraikan 7 seksyen (6 + penjelasan)', () => {
  for (const p of SECTIONS) assert.ok(serverSrc.includes(`'${p}'`), `seksyen ${p} dalam nav`);
  assert.match(gempaSrc, /slug: 'malaysia'/, 'wilayah malaysia ditakrif dalam modul');
  assert.match(gempaSrc, /slug: 'dunia'/, 'suapan dunia ditakrif');
});

test('renderer gempa ditakrif dan dibungkus melalui gempaDoc (3 slot + nav + lang ms)', () => {
  for (const fn of ['gempaHubPage', 'gempaRegionPage', 'gempaExplainPage', 'gempaDoc', 'gempaNav', 'gempaBusy']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} ditakrif`);
  }
  const idx = serverSrc.indexOf('function gempaDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) assert.ok(doc.includes(slot), `gempaDoc ada ${slot}`);
  assert.ok(doc.includes('gempaNav()'), 'gempaDoc ada nav gempa (hub pautan)');
  assert.ok(doc.includes('<html lang="ms">'), 'halaman gempa berlang="ms"');
});

test('laluan /gempa* berdaftar ikut tertib: hub, penjelasan literal, baru :region', () => {
  const hub = serverSrc.indexOf("app.get('/gempa'");
  const pen = serverSrc.indexOf("app.get('/gempa/penjelasan'");
  const reg = serverSrc.indexOf("app.get('/gempa/:region'");
  assert.ok(hub > -1 && pen > hub && reg > pen, 'tertib daftar: /gempa < penjelasan < :region');
  assert.match(serverSrc, /gp\.findRegion\(req\.params\.region\)/, 'slug rantau disahkan DALAM handler (tiada TDZ)');
  assert.doesNotMatch(serverSrc, /for \(const r of gp\.REGIONS\)\s*app\.get/, 'loop daftar-route atas REGIONS diharamkan');
});

test('kegagalan suapan → 503, rantau salah → 404, dua-dua gempaBusy noindex', () => {
  const busy = serverSrc.slice(serverSrc.indexOf('function gempaBusy'), serverSrc.indexOf('function gempaBusy') + 900);
  assert.ok(busy.includes('noindex,follow'), 'gempaBusy noindex,follow');
  assert.match(serverSrc, /status\(503\)\.type\('html'\)\.send\(gempaBusy/, '503 guna gempaBusy');
  assert.match(serverSrc, /status\(404\)\.type\('html'\)\.send\(gempaBusy/, '404 rantau salah guna gempaBusy');
});

test('USGS: tanpa kunci API, parameter FDSN yang sah, cache 10 minit', () => {
  assert.ok(gempaSrc.includes('earthquake.usgs.gov/fdsnws/event/1/query'), 'endpoint FDSN query');
  assert.doesNotMatch(gempaSrc, /apikey|api_key|appid|token/, 'tiada kunci diperlukan (data awam)');
  assert.ok(gempaSrc.includes('minlongitude') && gempaSrc.includes('maxlatitude'), 'parameter bbox bentuk FDSN (bukan "bbox")');
  assert.doesNotMatch(gempaSrc, /params\.bbox\b/, 'parameter "bbox" salah tidak digunakan');
  assert.match(gempaSrc, /TTL = 10 \* 60 \* 1000/, 'cache 10 minit');
});

test('sitemap-gempa.xml + robots + pautan silang cuaca↔gempa & footer', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-gempa\.xml'/, 'laluan sitemap-gempa wujud');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-gempa.xml'"), serverSrc.indexOf("app.get('/sitemap-gempa.xml'") + 1300);
  assert.ok(sm.includes('gp.REGIONS.map'), 'semua rantau masuk sitemap');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-gempa\.xml/, 'robots iklankan sitemap-gempa');
  assert.ok(serverSrc.includes('<li><a href="/gempa">World Earthquakes</a></li>'), 'footer ada pautan gempa dunia');
  assert.ok(serverSrc.includes('<a href="/gempa">Kompleks Gempa</a>'), 'hab cuaca paut silang ke gempa');
  assert.ok(serverSrc.includes("'/gempa', '/gempa/penjelasan'"), 'sitemap utama menyenaraikan /gempa');
});
