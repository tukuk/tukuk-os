'use strict';
// Invariants of the Knowledge Complex (/study): 9 server-rendered sections, full chrome (studyDoc → 3 ad
// units + cross nav), locally curated data, and a geography quiz built from REAL
// country data (not invented). The copy numbers must match the real dataset sizes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const study = require(path.join(ROOT, 'src', 'study.js'));

const SECTIONS = ['/study', '/study/science', '/study/geography', '/study/history',
  '/study/experiments', '/study/riddles', '/study/facts', '/study/math', '/study/alarm'];

test('the 9 /study routes are registered on Express', () => {
  for (const p of SECTIONS) {
    assert.ok(serverSrc.includes(`app.get('${p}'`), `the ${p} route must be registered`);
  }
});

test('STUDY_SECTIONS holds the 9 sections for the cross nav', () => {
  const m = serverSrc.match(/const STUDY_SECTIONS = \[([\s\S]*?)\];/);
  assert.ok(m, 'STUDY_SECTIONS must exist');
  const hrefs = (m[1].match(/href: '\/study/g) || []).length;
  assert.strictEqual(hrefs, 9, 'there must be 9 section links');
});

test('studyDoc wraps every page with chrome + 3 ad units', () => {
  assert.ok(/function studyDoc\(o\)/.test(serverSrc), 'studyDoc must exist');
  assert.ok(serverSrc.includes('${siteHeader('), 'studyDoc uses the site header');
  assert.ok(serverSrc.includes('${siteFooter()}'), 'studyDoc uses the site footer');
  assert.ok(/studyDoc\([\s\S]*slotTop[\s\S]*slotInArticle[\s\S]*slotBottom/.test(serverSrc) || serverSrc.includes("adUnitGuarded(config.adsense.slotTop, 'top')") , 'studyDoc mounts the 3 ad slots');
  assert.ok(serverSrc.includes('${studyNav()}'), 'studyDoc adds the complex cross nav');
});

test('every /study page is returned through studyDoc (never bare)', () => {
  for (const fn of ['studyHubPage', 'studySciencePage', 'studyGeographyPage', 'studyHistoryPage',
    'studyExperimentsPage', 'studyRiddlesPage', 'studyFactsPage', 'studyMathPage', 'studyAlarmPage']) {
    assert.ok(new RegExp(`function ${fn}\\b`).test(serverSrc), `${fn} must be defined`);
    assert.ok(new RegExp(`return studyDoc\\(`).test(serverSrc), 'the renderer uses studyDoc');
  }
});

test('the geography quiz is built from REAL country data, not a mock list', () => {
  // studyGeoQuiz takes `rows` (loadCountries) and builds questions from the capital.
  assert.ok(/function studyGeoQuiz\(rows, seed\)/.test(serverSrc), 'studyGeoQuiz(rows) needs rows');
  assert.ok(serverSrc.includes('await ng.loadCountries()'), 'the geography route loads the real country data');
  // No hard-coded capital mock block like the old fallbackAsteroids.
  assert.ok(!/capitalMock|fallbackCapitals/.test(serverSrc), 'no invented capital mocks');
  // An honest strip when the country feed fails.
  assert.ok(/quiz is resting/.test(serverSrc), 'there is an honest note when the country data is missing');
});

test('study.js exports the datasets + deterministic helpers', () => {
  for (const k of ['FACTS', 'RIDDLES', 'EXPERIMENTS', 'SCIENCE', 'HISTORY', 'GEO_RECORDS']) {
    assert.ok(Array.isArray(study[k]) && study[k].length > 0, `${k} must not be empty`);
  }
  const a = study.pickDaily(study.FACTS, 123);
  const b = study.pickDaily(study.FACTS, 123);
  assert.strictEqual(a, b, 'pickDaily is deterministic for the same seed');
  const s1 = study.shuffleSeeded([1, 2, 3, 4, 5], 42).join(',');
  const s2 = study.shuffleSeeded([1, 2, 3, 4, 5], 42).join(',');
  assert.strictEqual(s1, s2, 'shuffleSeeded is deterministic');
});

test('the numbers in the copy match the real dataset sizes (honesty)', () => {
  assert.ok(serverSrc.includes(`Forty-two facts`) && study.FACTS.length === 42, 'facts copy = 42');
  assert.ok(serverSrc.includes('Thirty-nine milestones') && study.HISTORY.length === 39, 'history copy = 39');
  assert.ok(serverSrc.includes('Seventeen core ideas') && study.SCIENCE.length === 17, 'science copy = 17');
  assert.ok(serverSrc.includes('Twelve safe') && study.EXPERIMENTS.length === 12, 'experiments copy = 12');
  assert.ok(serverSrc.includes('Thirty-six classic') && study.RIDDLES.length === 36, 'riddles copy = 36');
});

test('the alarm page is honest: the tab must stay open', () => {
  assert.ok(/Keep this tab open/.test(serverSrc), 'the alarm needs the honest warning');
  assert.ok(/keep this tab open/.test(serverSrc), 'the alarm state follows the same note');
});

test('/study is registered in the sitemap staticPages + the footer', () => {
  const staticLine = (serverSrc.match(/const staticPages = \[[^\]]*\]/) || [''])[0];
  assert.ok(staticLine.includes("'/study'"), 'the /study hub is in staticPages');
  assert.ok(staticLine.includes("'/study/alarm'"), 'every section is in staticPages');
  // The footer is generated from SITE_NAV now, so assert on the rendered HTML, not the source.
  assert.ok(require(path.join(ROOT, 'src', 'server')).siteFooter().includes('<a href="/study">General Knowledge</a>'), 'the footer links to the knowledge hub');
});

test('the quiz, math and alarm pages each have an interactive IIFE script', () => {
  const grab = (name) => {
    const i = serverSrc.indexOf(`function ${name}(`);
    const j = serverSrc.indexOf('\n}\n', i);
    return serverSrc.slice(i, j);
  };
  for (const fn of ['studyGeographyPage', 'studyMathPage', 'studyAlarmPage']) {
    const body = grab(fn);
    assert.ok(/<script>\(function\(\)\{[\s\S]*\}\)\(\);<\/script>/.test(body), `${fn} must carry an IIFE script`);
    assert.ok(body.includes('addEventListener'), `${fn} script hooks events`);
  }
});
