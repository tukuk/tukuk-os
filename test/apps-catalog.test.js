'use strict';
// Invarian selepas pivot konten+AdSense: tukuk.org ialah laman konten, BUKAN gedung app.
// Hanya T Chat (`chat`) kekal sebagai permukaan app; katalog app/game + halaman AI berat
// dibuang; /cari & /apps pautan lama → 301 ke '/' (hub konten); /nasa ialah halaman SEO SSR.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const PUBLIC = path.join(ROOT, 'public');

function appNames(src) {
  const m = src.match(/const APPS = \[([^\]]*)\]/);
  assert.ok(m, 'array APPS wujud di server.js');
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

test('tukuk.org = laman konten: satu-satunya app ialah chat', () => {
  assert.deepStrictEqual(appNames(serverSrc), ['chat'], 'APPS mesti tepat ["chat"]');
});

test('hanya chat.html tinggal di public/apps (app/game lain dibuang)', () => {
  const dir = path.join(PUBLIC, 'apps');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  assert.deepStrictEqual(files, ['chat.html'], `baki fail apps harus chat.html sahaja, dapat: ${files.join(', ')}`);
});

test('halaman store + AI berat dibuang dari public/', () => {
  for (const gone of ['store.html', 'explore.html', 'builder.html', 'nasa.html', 'studio.html', 'design.html', 'editor.html', 'editor-video.html', 'movie.html', 'collage.html', 'converter.html', 'bg-remover.html', '3d.html']) {
    assert.ok(!fs.existsSync(path.join(PUBLIC, gone)), `${gone} harus sudah dibuang`);
  }
});

test("root hidang hub konten, /apps → 301 ke /, /cari dihidupkan semula sebagai SPA", () => {
  assert.match(serverSrc, /app\.get\('\/\',\s*\(req, res\) =>[\s\S]*?renderBlogListPage\(req, true\)/, "root '/' panggil renderBlogListPage(asHome=true)");
  assert.match(serverSrc, /app\.get\('\/cari',\s*\(req, res\) =>[\s\S]*?readFileSync[\s\S]*?index\.html/, "/cari hidang SPA index.html (noindex+bebas iklan)");
  assert.doesNotMatch(serverSrc, /app\.get\('\/cari',\s*\(req, res\) => res\.redirect\(301/, '/cari bukan lagi 301');
  assert.match(serverSrc, /app\.get\(\['\/apps', '\/apps\/'\],\s*\(req, res\) => res\.redirect\(301, '\/'\)/, "/apps → 301 '/'");
});

test('/nasa ialah halaman konten SSR beriklan (bukan SPA noindex lama)', () => {
  assert.match(serverSrc, /app\.get\('\/nasa'/, 'laluan /nasa wujud');
  assert.match(serverSrc, /function renderNasaApodPage/, 'renderNasaApodPage ditakrif');
  assert.match(serverSrc, /renderNasaApodPage\(req, apod\)/, 'laluan /nasa hidang renderNasaApodPage');
});

test('artikel wiki dapat unit in-article (setaraf blog: top+in-article+bottom)', () => {
  const fn = serverSrc.slice(serverSrc.indexOf('function wikiArticlePage'), serverSrc.indexOf('function wikiSearchPage'));
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) {
    assert.ok(fn.includes(`config.adsense.${slot}`), `wikiArticlePage perlu memaparkan ${slot}`);
  }
});
