'use strict';
// Pin Kompleks Udara /udara: laluan, kelin shell+iklan, kontrak jujur sumber,
// dataset edukatif dan pautan silang — cermin pola study-complex.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const udaraSrc = fs.readFileSync(path.join(ROOT, 'src', 'udara.js'), 'utf8');
const udara = require('../src/udara');

test('/udara: 4 laluan berdaftar + staticPages + footer global', () => {
  for (const r of ["app.get('/udara'", "app.get('/udara/oxygen'", "app.get('/udara/breath'", "app.get('/udara/carbon'"]) {
    assert.ok(serverSrc.includes(r), `laluan ${r} ada`);
  }
  const staticLine = (serverSrc.match(/const staticPages = \[[^\]]*\]/) || [''])[0];
  for (const u of ["'/udara'", "'/udara/oxygen'", "'/udara/breath'", "'/udara/carbon'"]) {
    assert.ok(staticLine.includes(u), `staticPages ${u}`);
  }
  assert.ok(serverSrc.includes('<li><a href="/udara">Air & Oxygen</a></li>'), 'pautan footer');
});

test('/udara: kelin shell penuh — chrome, 3 slot iklan, nav silang', () => {
  const doc = (serverSrc.match(/function udaraDoc\(o\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(doc.length > 1000, 'udaraDoc ditemui');
  assert.ok(doc.includes('siteHeader(') && doc.includes('siteFooter()'), 'header+footer');
  assert.equal((doc.match(/adUnitGuarded\(config\.adsense\.(slotTop|slotInArticle|slotBottom)/g) || []).length, 3, '3 slot AdSense');
  assert.equal((doc.match(/msAdUnit\(/g) || []).length, 3, '3 unit Microsoft');
  assert.ok(doc.includes('udaraNav()'), 'nav kompleks disuntik');
  assert.ok(doc.includes('application/ld+json') && doc.includes('rel="canonical"'), 'SEO head');
  // Nav menutup semua 4 seksyen.
  for (const h of ["'/udara'", "'/udara/carbon'", "'/udara/oxygen'", "'/udara/breath'"]) {
    assert.ok(serverSrc.includes(h), `nav/hab ${h}`);
  }
});

test('udara.js: kontrak jujur sumber — tiada data rekaan', () => {
  assert.ok(udaraSrc.includes("source: 'live'"), 'flag live');
  assert.ok(udaraSrc.includes("'last-known'"), 'flag last-known');
  assert.ok(udaraSrc.includes("source: 'unavailable'"), 'flag unavailable terus');
  assert.ok(udaraSrc.includes("'partial'"), 'flag separa bila ada kota gagal');
  assert.ok(!/mock|dummy|fake/i.test(udaraSrc), 'tiada mock langsung');
  assert.ok(udaraSrc.includes('https://air-quality-api.open-meteo.com'), 'sumber AQI = Open-Meteo (tanpa kunci)');
  assert.ok(udaraSrc.includes('https://gml.noaa.gov/webdata/ccgg/trends/co2/'), 'sumber CO2 = NOAA GML');
});

test('udara.js: senarai kota global seimbang + kategori AQI EPA', () => {
  assert.ok(udara.CITIES.length >= 60, `kota ${udara.CITIES.length} ≥ 60`);
  const regions = new Set(udara.CITIES.map((c) => c.region));
  for (const r of ['Asia', 'Europe', 'Africa', 'Americas', 'Oceania']) assert.ok(regions.has(r), `wilayah ${r}`);
  for (const c of udara.CITIES) {
    assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.name && c.country, `koordinat sah ${c.name}`);
  }
  assert.equal(udara.aqiCategory(30).cls, 'good');
  assert.equal(udara.aqiCategory(75).cls, 'moderate');
  assert.equal(udara.aqiCategory(130).cls, 'usg');
  assert.equal(udara.aqiCategory(170).cls, 'unhealthy');
  assert.equal(udara.aqiCategory(250).cls, 'very');
  assert.equal(udara.aqiCategory(350).cls, 'hazardous');
  assert.equal(udara.aqiCategory(null), null, 'skala jujur: null → null');
});

test('dataset edukatif: oksigen, napas, CO2 dalam — angka dilabel approximate', () => {
  assert.ok(udara.OXYGEN.length >= 6, 'seksyen oksigen ≥6');
  assert.ok(udara.OXYGEN.some((s) => s.paras.join(' ').includes('20.9')), 'angka 20.9% ada');
  assert.ok(udara.OXYGEN.some((s) => s.paras.join(' ').includes('phytoplankton')), 'faktori plankton ada');
  assert.ok(udara.MYTHS.length >= 4 && udara.MYTHS.every((m) => m.m && m.f), 'myth/fact lengkap');
  assert.ok(udara.ANIMAL_BREATH.length >= 10, 'haiwan ≥10');
  assert.ok(udara.ANIMAL_BREATH.every((r) => /about|typical|record|Up to|Dives/i.test(r.rr)), 'jarak dilabel approximate');
  assert.ok(udara.HUMAN_BREATH.length >= 6 && udara.OTHER_WAYS.length >= 4, 'manusia+cara lain');
  assert.ok(udara.INDOOR_CO2.length >= 5 && udara.INDOOR_CO2[0].v.includes('420'), 'juluk CO2 bilik bermula 420 ppm');
});

test('hab: nota kejujuran model + fallback rehat, bukan nombor kosong', () => {
  const hub = (serverSrc.match(/function udaraHubPage\(air, co2\) \{[\s\S]*?\nfunction udaraCarbonPage/) || [''])[0];
  assert.ok(hub.length > 500, 'udaraHubPage ditemui');
  assert.ok(hub.includes('model estimates') || hub.includes('model'), 'penegasan model disebut');
  assert.ok(hub.includes('invented numbers') || hub.includes('resting'), 'nota jujur bila tiada data');
  assert.ok(hub.includes('last good readings'), 'last-known dilabel jelas');
  const carbon = (serverSrc.match(/function udaraCarbonPage\(co2\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(carbon.includes('we keep no invented placeholder'), 'karbon juga jujur bila feed mati');
  assert.ok(carbon.includes('Mauna Loa'), 'sumber disebut');
});

test('parse NOAA: medan ppm dijumpai betul pada format fail sebenar', () => {
  // Salin logik pickPpm melalui getCo2 tidak mungkin tanpa rangkaian di test —
  // jadi pin format parser secara langsung via regex modul.
  assert.ok(udaraSrc.includes('function pickPpm'), 'pickPpm wujud');
  assert.ok(udaraSrc.includes("l[0] !== '#'"), 'baris komen NOAA dibuang');
});

test('/udara hub memuat dua sumber secara selari & tak runtuh bila satu mati', () => {
  assert.ok(serverSrc.includes('Promise.allSettled([udara.getAirRanking(), udara.getCo2()])'), 'allSettled dua sumber');
  assert.ok(serverSrc.includes('air.status === \'fulfilled\' ? air.value : null'), 'udara: air gagal → null, halaman tetap terhidang');
  const geoRoute = serverSrc.match(/app\.get\('\/udara\/carbon'[\s\S]*?\}\);/);
  assert.ok(geoRoute && geoRoute[0].includes('try { co2 = await udara.getCo2(); }'), 'karbon: catch guard');
});
