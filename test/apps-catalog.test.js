'use strict';
// Invariants after the content+AdSense pivot: tukuk.org is a content site, NOT an app store.
// Only T Chat (`chat`) remains as an app surface; the app/game catalogue + heavy AI pages were
// dropped; the old /cari & /apps links → 301 to '/' (the content hub); /nasa is an SSR SEO page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const PUBLIC = path.join(ROOT, 'public');

function appNames(src) {
  const m = src.match(/const APPS = \[([^\]]*)\]/);
  assert.ok(m, 'the APPS array exists in server.js');
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

test('tukuk.org = a content site: the only app left is chat', () => {
  assert.deepStrictEqual(appNames(serverSrc), ['chat'], 'APPS must be exactly ["chat"]');
});

test('only chat.html stays in public/apps (the other apps/games were dropped)', () => {
  const dir = path.join(PUBLIC, 'apps');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  assert.deepStrictEqual(files, ['chat.html'], `the remaining app files should be chat.html only, got: ${files.join(', ')}`);
});

test('the store + heavy AI pages are removed from public/', () => {
  for (const gone of ['store.html', 'explore.html', 'builder.html', 'nasa.html', 'studio.html', 'design.html', 'editor.html', 'editor-video.html', 'movie.html', 'collage.html', 'converter.html', 'bg-remover.html', '3d.html']) {
    assert.ok(!fs.existsSync(path.join(PUBLIC, gone)), `${gone} must already be removed`);
  }
});

test("root serves the content hub, /apps → 301 to /, /cari is revived as a SPA", () => {
  assert.match(serverSrc, /app\.get\('\/\',\s*\(req, res\) =>[\s\S]*?renderBlogListPage\(req, true\)/, "root '/' calls renderBlogListPage(asHome=true)");
  assert.match(serverSrc, /app\.get\('\/cari',\s*\(req, res\) =>[\s\S]*?readFileSync[\s\S]*?index\.html/, "/cari serves the SPA index.html (noindex + ad-free)");
  assert.doesNotMatch(serverSrc, /app\.get\('\/cari',\s*\(req, res\) => res\.redirect\(301/, '/cari is no longer a 301');
  assert.match(serverSrc, /app\.get\(\['\/apps', '\/apps\/'\],\s*\(req, res\) => res\.redirect\(301, '\/'\)/, "/apps → 301 '/'");
});

test('/nasa is an ad-bearing SSR content page (not the old noindex SPA)', () => {
  assert.match(serverSrc, /app\.get\('\/nasa'/, 'the /nasa route exists');
  assert.match(serverSrc, /function renderNasaApodPage/, 'renderNasaApodPage is defined');
  assert.match(serverSrc, /renderNasaApodPage\(req, apod\)/, 'the /nasa route renders via renderNasaApodPage');
});

test('wiki articles get the in-article ad unit (on par with blog: top+in-article+bottom)', () => {
  const fn = serverSrc.slice(serverSrc.indexOf('function wikiArticlePage'), serverSrc.indexOf('function wikiSearchPage'));
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) {
    assert.ok(fn.includes(`config.adsense.${slot}`), `wikiArticlePage must render ${slot}`);
  }
});
