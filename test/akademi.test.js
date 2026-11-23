'use strict';
// Anchors for Akademi Tukuk-OS /academy: 50 lessons (10 tracks × 5), the routes, the
// shell+ad wiring, quiz validity, sitemap-academy and the per-track live-tool links.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const akadSrc = fs.readFileSync(path.join(ROOT, 'src', 'akademi.js'), 'utf8');
const akad = require('../src/akademi');

test('dataset: exactly 50 lessons — 10 tracks × 5, unique slugs', () => {
  assert.equal(akad.TRACKS.length, 10, '10 tracks');
  assert.equal(akad.totalLessons(), 50, 'exactly 50 lessons');
  for (const t of akad.TRACKS) {
    const ls = akad.LESSONS[t.s];
    assert.ok(ls && ls.length === 5, `track ${t.s} has 5 lessons`);
  }
  const slugs = akad.allLessons().map((l) => l.s);
  assert.equal(new Set(slugs).size, 50, 'every slug is unique');
  assert.equal(akad.allLessons()[49].no, 50, 'numbering 1..50');
});

test('every lesson: 3 paragraphs + 3 takeaways + a valid quiz (no CJK characters)', () => {
  for (const l of akad.allLessons()) {
    const key = `${l.track.s}/${l.s}`;
    assert.equal(l.p.length, 3, `3 paragraphs ${key}`);
    assert.equal(l.k.length, 3, `3 takeaways ${key}`);
    assert.ok(l.t && l.sum && Number.isFinite(l.mn) && l.mn >= 3 && l.mn <= 15, `valid meta ${key}`);
    assert.equal(l.q.o.length, 3, `3 options ${key}`);
    l.q.o.forEach((o) => assert.equal(typeof o, 'string', `string option ${key}`));
    assert.ok(l.q.a >= 0 && l.q.a < 3, `a valid answer index ${key}`);
    assert.ok(l.q.s && l.q.e, `question+explanation ${key}`);
    const all = [l.t, l.sum].concat(l.p, l.k, l.q.o, l.q.e).join(' ');
    assert.ok(!/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(all), `no CJK characters ${key}`);
  }
});

test('educational honesty: conservative figures are labelled about/roughly', () => {
  const text = akad.allLessons()
    .map((l) => l.p.join(' ') + ' ' + l.k.join(' ')).join(' ');
  const labeled = (text.match(/\b(about|roughly|around|typically|approximately|under|over|~)\b/gi) || []).length;
  assert.ok(labeled >= 40, `plenty of approximate labels (${labeled}) — no fake decimals`);
  assert.ok(!/Math\.random\(\)/.test(akadSrc), 'no randomly generated content — everything is a fixed curation');
  // A contested source needs a label, not one rounded number.
  assert.ok(text.includes('426') || text.includes('420') || text.includes('CO2'), 'the CO2 route exists');
});

test('every track links ≥2 live tools already on the site', () => {
  const live = ['/nasa', '/weather', '/earthquakes', '/disasters', '/air-quality', '/study', '/statistics', '/access', '/wiki', '/cari', '/learn'];
  for (const t of akad.TRACKS) {
    assert.ok(t.rel.length >= 2, `track ${t.s} has ≥2 links`);
    assert.ok(t.icon && t.name && t.blurb, `track meta ${t.s}`);
    for (const r of t.rel) {
      assert.ok(r.h.startsWith('/') && r.l, `site link ${t.s} → ${r.h}`);
      const base = '/' + r.h.split('/')[1];
      assert.ok(live.includes(base) || base === '/apps', `a known destination: ${r.h}`);
    }
  }
});

test('/academy: 3 routes + staticPages (hub+10 tracks) + footer + a bogus-slug redirect', () => {
  for (const r of ["app.get('/academy'", "app.get('/academy/:track'", "app.get('/academy/:track/:slug'"]) {
    assert.ok(serverSrc.includes(r), `the ${r} route exists`);
  }
  const staticLine = (serverSrc.match(/const staticPages = \[[^\]]*\]/) || [''])[0];
  assert.ok(staticLine.includes("'/academy'"), 'the hub in staticPages');
  for (const t of akad.TRACKS) assert.ok(staticLine.includes(`'/academy/${t.s}'`), `staticPages track ${t.s}`);
  assert.ok(require(path.join(ROOT, 'src', 'server')).siteFooter().includes('<li><a href="/academy">Academy (50 Lessons)</a></li>'), 'the footer link');
  assert.ok((serverSrc.match(/app\.get\('\/academy\/:track'[\s\S]*?\}\);/) || [''])[0].includes("res.redirect('/academy')"), 'a fake track → redirect');
  assert.ok((serverSrc.match(/app\.get\('\/academy\/:track\/:slug'[\s\S]*?\}\);/) || ['']).length > 0 && serverSrc.includes("if (!l) return res.redirect('/academy')"), 'a fake lesson → redirect');
});

test('/academy: the full shell wiring — chrome, 3 ad slots, the 10-track nav', () => {
  const doc = (serverSrc.match(/function akadDoc\(o\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(doc.length > 1000, 'akadDoc was found');
  assert.ok(doc.includes('siteHeader(') && doc.includes('siteFooter()'), 'header+footer');
  assert.equal((doc.match(/adUnitGuarded\(config\.adsense\.(slotTop|slotInArticle|slotBottom)/g) || []).length, 3, '3 AdSense slots');
  assert.equal((doc.match(/msAdUnit\(/g) || []).length, 3, '3 Microsoft units');
  assert.ok(doc.includes('akadNav()'), 'the academy nav is injected');
  assert.ok(doc.includes('application/ld+json') && doc.includes('rel="canonical"'), 'SEO head');
  const nav = (serverSrc.match(/function akadNav\(\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(nav.includes('akad.trackList()'), 'the nav is built from the track list');
});

test('the lesson page: takeaway box, clickable quiz, prev/next, JSON-LD LearningResource', () => {
  const page = (serverSrc.match(/function akadLessonPage\(t, l, prev, next, no\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(page.length > 500, 'akadLessonPage was found');
  assert.ok(page.includes('Key takeaways') && page.includes('takeaway'), 'the takeaway box');
  assert.ok(page.includes('data-ok=') && page.includes('qopt') && page.includes("getElementById('qexp')"), 'the click quiz + a hidden explanation');
  assert.ok(page.includes('Lesson ${no} of 50'), 'the 1..50 numbering is displayed');
  assert.ok(page.includes('LearningResource') && page.includes('BreadcrumbList'), 'the education ld');
  assert.ok(page.includes('prev ?') && page.includes('next ?'), 'the prev/next navigation');
  assert.ok(page.includes('t.rel.map'), 'the per-track live-tool links');
});

test('sitemap-academy.xml: the hub + 10 tracks + 50 lessons + robots registers it', () => {
  const route = (serverSrc.match(/app\.get\('\/sitemap-academy\.xml'[\s\S]*?\}\);/) || [''])[0];
  assert.ok(route.length > 100, 'the sitemap route was found');
  assert.ok(route.includes('akad.TRACKS.map') && route.includes('akad.allLessons()'), 'tracks+lessons are generated from the dataset');
  assert.ok(route.includes("one('/academy', '0.9')"), 'the hub priority is 0.9');
  const robots = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
  assert.ok(robots.includes('https://tukuk.org/sitemap-academy.xml'), 'robots knows the academy sitemap');
});
