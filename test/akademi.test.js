'use strict';
// Pin Akademi Tukuk-OS /akademi: 50 pelajaran (10 trek × 5), laluan, kelin
// shell+iklan, kesahihan kuiz, sitemap-akademi dan pautan alat hidup per trek.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const akadSrc = fs.readFileSync(path.join(ROOT, 'src', 'akademi.js'), 'utf8');
const akad = require('../src/akademi');

test('dataset: tepat 50 pelajaran — 10 trek × 5, slug unik', () => {
  assert.equal(akad.TRACKS.length, 10, '10 trek');
  assert.equal(akad.totalLessons(), 50, 'tepat 50 pelajaran');
  for (const t of akad.TRACKS) {
    const ls = akad.LESSONS[t.s];
    assert.ok(ls && ls.length === 5, `trek ${t.s} ada 5 pelajaran`);
  }
  const slugs = akad.allLessons().map((l) => l.s);
  assert.equal(new Set(slugs).size, 50, 'semua slug unik');
  assert.equal(akad.allLessons()[49].no, 50, 'penomboran 1..50');
});

test('setiap pelajaran: 3 perenggan + 3 pengajaran + kuiz sah (Bukan Melayu/CJK)', () => {
  for (const l of akad.allLessons()) {
    const key = `${l.track.s}/${l.s}`;
    assert.equal(l.p.length, 3, `3 perenggan ${key}`);
    assert.equal(l.k.length, 3, `3 pengajaran ${key}`);
    assert.ok(l.t && l.sum && Number.isFinite(l.mn) && l.mn >= 3 && l.mn <= 15, `meta sah ${key}`);
    assert.equal(l.q.o.length, 3, `3 pilihan ${key}`);
    l.q.o.forEach((o) => assert.equal(typeof o, 'string', `pilihan string ${key}`));
    assert.ok(l.q.a >= 0 && l.q.a < 3, `indeks jawapan sah ${key}`);
    assert.ok(l.q.s && l.q.e, `soalan+penerangan ${key}`);
    const all = [l.t, l.sum].concat(l.p, l.k, l.q.o, l.q.e).join(' ');
    assert.ok(!/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(all), `tiada aksara CJK ${key}`);
  }
});

test('kejujuran edukatif: angka konservatif dilabel about/roughly', () => {
  const text = akad.allLessons()
    .map((l) => l.p.join(' ') + ' ' + l.k.join(' ')).join(' ');
  const labeled = (text.match(/\b(about|roughly|around|typically|approximately|under|over|~)\b/gi) || []).length;
  assert.ok(labeled >= 40, `label approximate ramai (${labeled}) — bukan dezimal palsu`);
  assert.ok(!/Math\.random\(\)/.test(akadSrc), 'tiada kandungan dijana rawak — semuanya kurasi tetap');
  // Sumber yang dipertikaikan perlu label, bukan angka tunggal bulat.
  assert.ok(text.includes('426') || text.includes('420') || text.includes('CO2'), 'ruta CO2 ada');
});

test('setiap trek memaut ≥2 alat hidup sedia ada di tapak', () => {
  const live = ['/nasa', '/cuaca', '/gempa', '/bencana', '/udara', '/study', '/statistik', '/access', '/wiki', '/cari', '/learn'];
  for (const t of akad.TRACKS) {
    assert.ok(t.rel.length >= 2, `trek ${t.s} ≥2 pautan`);
    assert.ok(t.icon && t.name && t.blurb, `meta trek ${t.s}`);
    for (const r of t.rel) {
      assert.ok(r.h.startsWith('/') && r.l, `pautan laman ${t.s} → ${r.h}`);
      const base = '/' + r.h.split('/')[1];
      assert.ok(live.includes(base) || base === '/apps', `destinasi diketahui: ${r.h}`);
    }
  }
});

test('/akademi: 3 laluan + staticPages (hab+10 trek) + footer + redirect slug palsu', () => {
  for (const r of ["app.get('/akademi'", "app.get('/akademi/:track'", "app.get('/akademi/:track/:slug'"]) {
    assert.ok(serverSrc.includes(r), `laluan ${r} ada`);
  }
  const staticLine = (serverSrc.match(/const staticPages = \[[^\]]*\]/) || [''])[0];
  assert.ok(staticLine.includes("'/akademi'"), 'staticPages hab');
  for (const t of akad.TRACKS) assert.ok(staticLine.includes(`'/akademi/${t.s}'`), `staticPages trek ${t.s}`);
  assert.ok(serverSrc.includes('<li><a href="/akademi">Academy — 50 Lessons</a></li>'), 'pautan footer');
  assert.ok((serverSrc.match(/app\.get\('\/akademi\/:track'[\s\S]*?\}\);/) || [''])[0].includes("res.redirect('/akademi')"), 'trek palsu → redirect');
  assert.ok((serverSrc.match(/app\.get\('\/akademi\/:track\/:slug'[\s\S]*?\}\);/) || ['']).length > 0 && serverSrc.includes("if (!l) return res.redirect('/akademi')"), 'pelajaran palsu → redirect');
});

test('/akademi: kelin shell penuh — chrome, 3 slot iklan, nav 10 trek', () => {
  const doc = (serverSrc.match(/function akadDoc\(o\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(doc.length > 1000, 'akadDoc ditemui');
  assert.ok(doc.includes('siteHeader(') && doc.includes('siteFooter()'), 'header+footer');
  assert.equal((doc.match(/adUnitGuarded\(config\.adsense\.(slotTop|slotInArticle|slotBottom)/g) || []).length, 3, '3 slot AdSense');
  assert.equal((doc.match(/msAdUnit\(/g) || []).length, 3, '3 unit Microsoft');
  assert.ok(doc.includes('akadNav()'), 'nav akademi disuntik');
  assert.ok(doc.includes('application/ld+json') && doc.includes('rel="canonical"'), 'SEO head');
  const nav = (serverSrc.match(/function akadNav\(\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(nav.includes('akad.trackList()'), 'nav dibina dari senarai trek');
});

test('halaman pelajaran: takeaway box, kuiz klik, prev/next, JSON-LD LearningResource', () => {
  const page = (serverSrc.match(/function akadLessonPage\(t, l, prev, next, no\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(page.length > 500, 'akadLessonPage ditemui');
  assert.ok(page.includes('Key takeaways') && page.includes('takeaway'), 'kotak pengajaran');
  assert.ok(page.includes('data-ok=') && page.includes('qopt') && page.includes("getElementById('qexp')"), 'kuiz klik + penerangan tersembunyi');
  assert.ok(page.includes('Lesson ${no} of 50'), 'penomboran 1..50 dipaparkan');
  assert.ok(page.includes('LearningResource') && page.includes('BreadcrumbList'), 'ld pendidikan');
  assert.ok(page.includes('prev ?') && page.includes('next ?'), 'navigasi prev/next');
  assert.ok(page.includes('t.rel.map'), 'pautan alat hidup per trek');
});

test('sitemap-akademi.xml: hab + 10 trek + 50 pelajaran + robots mendaftarkannya', () => {
  const route = (serverSrc.match(/app\.get\('\/sitemap-akademi\.xml'[\s\S]*?\}\);/) || [''])[0];
  assert.ok(route.length > 100, 'laluan sitemap ditemui');
  assert.ok(route.includes('akad.TRACKS.map') && route.includes('akad.allLessons()'), 'trek+pelajaran dijana dari dataset');
  assert.ok(route.includes("one('/akademi', '0.9')"), 'hab keutamaan 0.9');
  const robots = fs.readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
  assert.ok(robots.includes('https://tukuk.org/sitemap-akademi.xml'), 'robots mengiktiraf sitemap akademi');
});
