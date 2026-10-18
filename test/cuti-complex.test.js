'use strict';
// Invarian Cuti Complex: API cuti MY tanpa kunci + 16 negeri + hujung minggu
// panjang + sitemap-cuti + pautan silang cuaca/gempa & footer.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const cutiSrc = fs.readFileSync(path.join(ROOT, 'src', 'cuti.js'), 'utf8');
const robotsTxt = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');

const SECTIONS = ['/cuti', '/cuti/2026', '/cuti/2027', '/cuti/hujung-minggu-panjang', '/cuti/penjelasan'];
const NEGARI = ['johor', 'kedah', 'kelantan', 'melaka', 'negeri-sembilan', 'pahang', 'perak', 'perlis',
  'pulau-pinang', 'sabah', 'sarawak', 'selangor', 'terengganu', 'kuala-lumpur', 'putrajaya', 'labuan'];

test('src/cuti.js: 16 negeri/wilayah + tanpa kunci API + cache 30 hari', () => {
  for (const slug of NEGARI) assert.ok(cutiSrc.includes(`'${slug}'`), `slug negeri ${slug} ditakrif`);
  assert.match(cutiSrc, /TTL = 30 \* 24 \* 60 \* 60 \* 1000/, 'cache 30 hari (jadual jarang berubah)');
  assert.doesNotMatch(cutiSrc, /apikey|api_key|appid|token/, 'tiada kunci diperlukan');
  assert.ok(cutiSrc.includes('malaysia-holiday.dydxsoft.my/api/v1'), 'endpoint API awam');
  assert.match(cutiSrc, /YEAR_MIN = 2026[\s\S]*YEAR_MAX = 2027/, 'liputan 2026–2027 sahaja');
});

test('edge IPv4 CDN memulangkan 403 → permintaan dipaksa IPv6 dengan fallback', () => {
  assert.ok(cutiSrc.includes("new https.Agent({ family: 6"), 'agent IPv6-paksa wujud');
  assert.ok(cutiSrc.includes('httpsAgent: v6Agent') && cutiSrc.includes('httpsAgent: plainAgent'), 'v6 dahulu, fallback biasa');
  assert.ok(cutiSrc.includes('let queueTail = Promise.resolve()'), 'permintaan digilirkan (tiada hon konon CDN)');
});

test('pengiraan hujung minggu panjang: run berturutan + appendix hujung minggu + jambatan', () => {
  assert.match(cutiSrc, /function longWeekends\(rows\)/, 'longWeekends ditakrif');
  assert.match(cutiSrc, /if \(ld === 5\) span \+= 2/, 'cuti berakhir Jumaat +2');
  assert.match(cutiSrc, /if \(fd === 1\) span \+= 2/, 'cuti bermula Isnin +2');
  assert.match(cutiSrc, /return d === 2 \|\| d === 4/, 'Selasa/Khamis tunggal = jambatan');
  assert.match(cutiSrc, /filter\(\(w\) => w\.spanDays >= 3 \|\| w\.bridge\)/, 'hanya 3 hari atau jambatan dipaparkan');
  assert.match(cutiSrc, /function forState\(rows, code\)/, 'tapis nasional ikut negeri (run tak boleh campur)');
  const real = require(path.join(ROOT, 'src', 'cuti.js'));
  const kl = [
    { name: 'Hari X', date: '2026-05-01', state_codes: ['KUL'] },   // Jumaat → 3 hari
    { name: 'Hari Y', date: '2026-08-25', state_codes: ['KUL'] },   // Isnin → 3 hari
    { name: 'Hari Z', date: '2027-02-09', state_codes: ['KUL'] },   // Selasa → jambatan
  ];
  const lw = real.longWeekends(kl);
  assert.strictEqual(lw.length, 3, 'ketiga-tiga gabungan layak dipaparkan');
  assert.ok(lw.some((w) => w.spanDays === 3 && w.auto), 'Jumaat/Isin tunggal jadi 3 hari automatik');
  assert.ok(lw.some((w) => w.bridge === 1), 'cuti Selasa dikesan sebagai jambatan');
});

test('renderer cuti ditakrif dan dibungkus melalui cutiDoc (3 slot + nav + lang ms)', () => {
  for (const fn of ['cutiHubPage', 'cutiYearPage', 'cutiLongWeekendPage', 'cutiStatePage', 'cutiExplainPage', 'cutiDoc', 'cutiNav', 'cutiBusy']) {
    assert.match(serverSrc, new RegExp(`function ${fn}\\(`), `${fn} ditakrif`);
  }
  const idx = serverSrc.indexOf('function cutiDoc(o)');
  const doc = serverSrc.slice(idx, idx + 12000);
  for (const slot of ['slotTop', 'slotInArticle', 'slotBottom']) assert.ok(doc.includes(slot), `cutiDoc ada ${slot}`);
  assert.ok(doc.includes('cutiNav()'), 'cutiDoc ada nav cuti (hab pautan)');
  assert.ok(doc.includes('<html lang="ms">'), 'halaman cuti berlang="ms"');
  assert.ok(doc.includes('ms_MY'), 'og:locale ms_MY');
});

test('CUTI_SECTIONS menyenaraikan hab + 2 tahun + hujung minggu + penjelasan + 16 negeri', () => {
  for (const p of SECTIONS) assert.ok(serverSrc.includes(`'${p}'`), `seksyen ${p} dalam nav`);
  assert.match(serverSrc, /for \(const st of cu\.STATES\) CUTI_SECTIONS\.push/, '16 halaman negeri masuk nav');
  const navIdx = serverSrc.indexOf('function cutiNav()');
  assert.ok(navIdx > 0 && serverSrc.slice(navIdx, navIdx + 600).includes('Jelajahi Kompleks Cuti'), 'tajuk nav cuti');
});

test('laluan /cuti* berdaftar ikut tertib: hub, literal, tahun regex, baru :negeri', () => {
  const hub = serverSrc.indexOf("app.get('/cuti'");
  const pen = serverSrc.indexOf("app.get('/cuti/penjelasan'");
  const lw = serverSrc.indexOf("app.get('/cuti/hujung-minggu-panjang'");
  const yr = serverSrc.indexOf('app.get(/^\\/cuti\\/');
  const reg = serverSrc.indexOf("app.get('/cuti/:negeri'");
  assert.ok(hub > -1 && pen > hub && lw > pen && yr > lw && reg > yr, 'tertib daftar: hub < penjelasan < hujung-minggu < tahun < :negeri');
  assert.match(serverSrc, /cu\.findState\(req\.params\.negeri\)/, 'slug negeri disahkan DALAM handler (tiada TDZ)');
  assert.doesNotMatch(serverSrc, /for \(const st of cu\.STATES\)\s*\n?\s*app\.get\('\/cuti/, 'loop daftar-route atas STATES diharamkan');
});

test('kegagalan API → 503, negeri/tahun salah → 404, dua-dua cutiBusy noindex', () => {
  const busy = serverSrc.slice(serverSrc.indexOf('function cutiBusy'), serverSrc.indexOf('function cutiBusy') + 900);
  assert.ok(busy.includes('noindex,follow'), 'cutiBusy noindex,follow');
  assert.match(serverSrc, /status\(503\)\.type\('html'\)\.send\(cutiBusy/, '503 guna cutiBusy');
  assert.match(serverSrc, /status\(404\)\.type\('html'\)\.send\(cutiBusy/, '404 negeri salah guna cutiBusy');
  assert.match(serverSrc, /year < cu\.YEAR_MIN \|\| year > cu\.YEAR_MAX\) year = cu\.YEAR_MIN/, '?tahun di luar liputan jatuh ke YEAR_MIN');
});

test('sitemap-cuti.xml + robots + footer + pautan silang cuaca/gempa↔cuti', () => {
  assert.match(serverSrc, /app\.get\('\/sitemap-cuti\.xml'/, 'laluan sitemap-cuti wujud');
  const sm = serverSrc.slice(serverSrc.indexOf("app.get('/sitemap-cuti.xml'"), serverSrc.indexOf("app.get('/sitemap-cuti.xml'") + 1600);
  assert.ok(sm.includes('cu.STATES.map'), 'semua negeri masuk sitemap');
  assert.ok(sm.includes('cu.YEAR_MAX'), 'versi 2027 (?)tahun masuk sitemap');
  assert.match(robotsTxt, /Sitemap: https:\/\/tukuk\.org\/sitemap-cuti\.xml/, 'robots iklankan sitemap-cuti');
  assert.ok(serverSrc.includes('<li><a href="/cuti">Public holidays 2026</a></li>'), 'footer ada pautan cuti');
  assert.ok(serverSrc.includes('<a href="/cuti">cuti umum 2026 &amp; 2027</a>'), 'hab cuaca paut silang ke cuti');
  assert.ok(serverSrc.includes('<a href="/cuti">jadual cuti umum</a>'), 'hab/rantau gempa paut silang ke cuti');
  assert.ok(serverSrc.includes("'/cuti', '/cuti/2026', '/cuti/2027'"), 'sitemap utama menyenaraikan halaman cuti');
});
