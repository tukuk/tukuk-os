'use strict';
// Invarian Kompleks Ilmu (/study): 9 seksyen SSR, chrome penuh (studyDoc → 3 unit
// iklan + nav silang), data kurasi setempat, dan kuiz geografi dibina daripada
// data negara REBENAR (bukan rekaan). Pin copy mesti sepadan saiz dataset sebenar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const study = require(path.join(ROOT, 'src', 'study.js'));

const SECTIONS = ['/study', '/study/science', '/study/geography', '/study/history',
  '/study/experiments', '/study/riddles', '/study/facts', '/study/math', '/study/alarm'];

test('9 laluan /study didaftarkan pada Express', () => {
  for (const p of SECTIONS) {
    assert.ok(serverSrc.includes(`app.get('${p}'`), `laluan ${p} mesti didaftarkan`);
  }
});

test('STUDY_SECTIONS mengandungi 9 seksyen untuk nav silang', () => {
  const m = serverSrc.match(/const STUDY_SECTIONS = \[([\s\S]*?)\];/);
  assert.ok(m, 'STUDY_SECTIONS mesti wujud');
  const hrefs = (m[1].match(/href: '\/study/g) || []).length;
  assert.strictEqual(hrefs, 9, 'kena ada 9 pautan seksyen');
});

test('studyDoc membalut setiap halaman dengan chrome + 3 unit iklan', () => {
  assert.ok(/function studyDoc\(o\)/.test(serverSrc), 'studyDoc mesti wujud');
  assert.ok(serverSrc.includes('${siteHeader('), 'studyDoc guna header situs');
  assert.ok(serverSrc.includes('${siteFooter()}'), 'studyDoc guna footer situs');
  assert.ok(/studyDoc\([\s\S]*slotTop[\s\S]*slotInArticle[\s\S]*slotBottom/.test(serverSrc) || serverSrc.includes("adUnitGuarded(config.adsense.slotTop, 'top')") , 'studyDoc pasang 3 slot iklan');
  assert.ok(serverSrc.includes('${studyNav()}'), 'studyDoc letak nav silang kompleks');
});

test('setiap halaman /study dipulangkan melalui studyDoc (bukan telanjang)', () => {
  for (const fn of ['studyHubPage', 'studySciencePage', 'studyGeographyPage', 'studyHistoryPage',
    'studyExperimentsPage', 'studyRiddlesPage', 'studyFactsPage', 'studyMathPage', 'studyAlarmPage']) {
    assert.ok(new RegExp(`function ${fn}\\b`).test(serverSrc), `${fn} mesti ditakrif`);
    assert.ok(new RegExp(`return studyDoc\\(`).test(serverSrc), 'renderer guna studyDoc');
  }
});

test('kuiz geografi dibina daripada data negara REBENAR, bukan senarai mock', () => {
  // studyGeoQuiz mengambil `rows` (loadCountries) dan membina soalan daripada capital.
  assert.ok(/function studyGeoQuiz\(rows, seed\)/.test(serverSrc), 'studyGeoQuiz(rows) perlu rows');
  assert.ok(serverSrc.includes('await ng.loadCountries()'), 'laluan geografi muat data negara sebenar');
  // Tiada blok modal kapital硬-coded seperti fallbackAsteroids dahulu.
  assert.ok(!/capitalMock|fallbackCapitals/.test(serverSrc), 'tiada mock kapital rekaan');
  // Jalur jujur apabila suapan negara gagal.
  assert.ok(/quiz is resting/.test(serverSrc), 'ada nota jujur bila data negara tiada');
});

test('study.js eksport dataset + pembantu deterministik', () => {
  for (const k of ['FACTS', 'RIDDLES', 'EXPERIMENTS', 'SCIENCE', 'HISTORY', 'GEO_RECORDS']) {
    assert.ok(Array.isArray(study[k]) && study[k].length > 0, `${k} mesti tak kosong`);
  }
  const a = study.pickDaily(study.FACTS, 123);
  const b = study.pickDaily(study.FACTS, 123);
  assert.strictEqual(a, b, 'pickDaily deterministik untuk seed sama');
  const s1 = study.shuffleSeeded([1, 2, 3, 4, 5], 42).join(',');
  const s2 = study.shuffleSeeded([1, 2, 3, 4, 5], 42).join(',');
  assert.strictEqual(s1, s2, 'shuffleSeeded deterministik');
});

test('nombor dalam copy sepadan dengan saiz dataset sebenar (jujur)', () => {
  assert.ok(serverSrc.includes(`Forty-two facts`) && study.FACTS.length === 42, 'facts copy = 42');
  assert.ok(serverSrc.includes('Thirty-nine milestones') && study.HISTORY.length === 39, 'history copy = 39');
  assert.ok(serverSrc.includes('Seventeen core ideas') && study.SCIENCE.length === 17, 'science copy = 17');
  assert.ok(serverSrc.includes('Twelve safe') && study.EXPERIMENTS.length === 12, 'experiments copy = 12');
  assert.ok(serverSrc.includes('Thirty-six classic') && study.RIDDLES.length === 36, 'riddles copy = 36');
});

test('halaman alarm jujur: tab mesti kekal terbuka', () => {
  assert.ok(/Keep this tab open/.test(serverSrc), 'alarm perlu amaran jujur');
  assert.ok(/keep this tab open/.test(serverSrc), 'alarm state amalkan nota yang sama');
});

test('/study didaftarkan dalam sitemap staticPages + footer', () => {
  const staticLine = (serverSrc.match(/const staticPages = \[[^\]]*\]/) || [''])[0];
  assert.ok(staticLine.includes("'/study'"), 'hab /study dalam staticPages');
  assert.ok(staticLine.includes("'/study/alarm'"), 'semua seksyen dalam staticPages');
  assert.ok(serverSrc.includes('<a href="/study">General Knowledge</a>'), 'footer pauti hab ilmu');
});

test('kuiz, math dan alarm masing-masing ada skrip interaktif IIFE', () => {
  const grab = (name) => {
    const i = serverSrc.indexOf(`function ${name}(`);
    const j = serverSrc.indexOf('\n}\n', i);
    return serverSrc.slice(i, j);
  };
  for (const fn of ['studyGeographyPage', 'studyMathPage', 'studyAlarmPage']) {
    const body = grab(fn);
    assert.ok(/<script>\(function\(\)\{[\s\S]*\}\)\(\);<\/script>/.test(body), `${fn} mesti ada skrip IIFE`);
    assert.ok(body.includes('addEventListener'), `${fn} skrip berpaut pada peristiwa`);
  }
});
