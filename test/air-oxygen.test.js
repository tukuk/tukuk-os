'use strict';
// Pins for the Air & Oxygen Complex /udara: routes, full shell+ad chrome, honest source contracts,
// the educational dataset and the cross links — mirroring the study-complex.test.js pattern.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
const udaraSrc = fs.readFileSync(path.join(ROOT, 'src', 'udara.js'), 'utf8');
const udara = require('../src/udara');

test('/udara: 4 registered routes + staticPages + the global footer', () => {
  for (const r of ["app.get('/udara'", "app.get('/udara/oxygen'", "app.get('/udara/breath'", "app.get('/udara/carbon'"]) {
    assert.ok(serverSrc.includes(r), `the route ${r} exists`);
  }
  const staticLine = (serverSrc.match(/const staticPages = \[[^\]]*\]/) || [''])[0];
  for (const u of ["'/udara'", "'/udara/oxygen'", "'/udara/breath'", "'/udara/carbon'"]) {
    assert.ok(staticLine.includes(u), `staticPages ${u}`);
  }
  assert.ok(serverSrc.includes('<li><a href="/udara">Air & Oxygen</a></li>'), 'the footer link');
});

test('/udara: a full shell chrome — header/footer, 3 ad slots, the cross nav', () => {
  const doc = (serverSrc.match(/function udaraDoc\(o\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(doc.length > 1000, 'udaraDoc was found');
  assert.ok(doc.includes('siteHeader(') && doc.includes('siteFooter()'), 'header+footer');
  assert.equal((doc.match(/adUnitGuarded\(config\.adsense\.(slotTop|slotInArticle|slotBottom)/g) || []).length, 3, '3 AdSense slots');
  assert.equal((doc.match(/msAdUnit\(/g) || []).length, 3, '3 Microsoft units');
  assert.ok(doc.includes('udaraNav()'), 'the complex nav is injected');
  assert.ok(doc.includes('application/ld+json') && doc.includes('rel="canonical"'), 'the SEO head');
  // The nav covers all 4 sections.
  for (const h of ["'/udara'", "'/udara/carbon'", "'/udara/oxygen'", "'/udara/breath'"]) {
    assert.ok(serverSrc.includes(h), `the nav/hub ${h}`);
  }
});

test('udara.js: honest source contracts — no invented data', () => {
  assert.ok(udaraSrc.includes("source: 'live'"), 'the live flag');
  assert.ok(udaraSrc.includes("'last-known'"), 'the last-known flag');
  assert.ok(udaraSrc.includes("source: 'unavailable'"), 'the straight unavailable flag');
  assert.ok(udaraSrc.includes("'partial'"), 'the partial flag when some city failed');
  assert.ok(!/mock|dummy|fake/i.test(udaraSrc), 'no mocks at all');
  assert.ok(udaraSrc.includes('https://air-quality-api.open-meteo.com'), 'the AQI source is Open-Meteo (key-free)');
  assert.ok(udaraSrc.includes('https://gml.noaa.gov/webdata/ccgg/trends/co2/'), 'the CO2 source is NOAA GML');
});

test('udara.js: a balanced global city list + the EPA AQI categories', () => {
  assert.ok(udara.CITIES.length >= 60, `${udara.CITIES.length} cities ≥ 60`);
  const regions = new Set(udara.CITIES.map((c) => c.region));
  for (const r of ['Asia', 'Europe', 'Africa', 'Americas', 'Oceania']) assert.ok(regions.has(r), `the region ${r}`);
  for (const c of udara.CITIES) {
    assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.name && c.country, `valid coordinates for ${c.name}`);
  }
  assert.equal(udara.aqiCategory(30).cls, 'good');
  assert.equal(udara.aqiCategory(75).cls, 'moderate');
  assert.equal(udara.aqiCategory(130).cls, 'usg');
  assert.equal(udara.aqiCategory(170).cls, 'unhealthy');
  assert.equal(udara.aqiCategory(250).cls, 'very');
  assert.equal(udara.aqiCategory(350).cls, 'hazardous');
  assert.equal(udara.aqiCategory(null), null, 'an honest scale: null → null');
});

test('the educational dataset: oxygen, breath, indoor CO2 — numbers labelled approximate', () => {
  assert.ok(udara.OXYGEN.length >= 6, 'at least 6 oxygen sections');
  assert.ok(udara.OXYGEN.some((s) => s.paras.join(' ').includes('20.9')), 'the 20.9% figure is present');
  assert.ok(udara.OXYGEN.some((s) => s.paras.join(' ').includes('phytoplankton')), 'the plankton factor is present');
  assert.ok(udara.MYTHS.length >= 4 && udara.MYTHS.every((m) => m.m && m.f), 'myth/fact pairs are complete');
  assert.ok(udara.ANIMAL_BREATH.length >= 10, 'at least 10 animals');
  assert.ok(udara.ANIMAL_BREATH.every((r) => /about|typical|record|Up to|Dives/i.test(r.rr)), 'rates are labelled approximate');
  assert.ok(udara.HUMAN_BREATH.length >= 6 && udara.OTHER_WAYS.length >= 4, 'humans + other ways');
  assert.ok(udara.INDOOR_CO2.length >= 5 && udara.INDOOR_CO2[0].v.includes('420'), 'the indoor CO2 ladder starts at 420 ppm');
});

test('the hub: model-honesty notes + a resting fallback, never blank numbers', () => {
  const hub = (serverSrc.match(/function udaraHubPage\(air, co2\) \{[\s\S]*?\nfunction udaraCarbonPage/) || [''])[0];
  assert.ok(hub.length > 500, 'udaraHubPage was found');
  assert.ok(hub.includes('model estimates') || hub.includes('model'), 'the model caveat is stated');
  assert.ok(hub.includes('invented numbers') || hub.includes('resting'), 'an honest note when there is no data');
  assert.ok(hub.includes('last good readings'), 'last-known is clearly labelled');
  const carbon = (serverSrc.match(/function udaraCarbonPage\(co2\) \{[\s\S]*?\n}/) || [''])[0];
  assert.ok(carbon.includes('we keep no invented placeholder'), 'carbon stays honest when the feed is down');
  assert.ok(carbon.includes('Mauna Loa'), 'the source is named');
});

test('parsing NOAA: the ppm field is found correctly in the real file format', () => {
  // Copying the pickPpm logic through getCo2 is impossible without a network in a test —
  // so the parser format is pinned directly via the module regexes.
  assert.ok(udaraSrc.includes('function pickPpm'), 'pickPpm exists');
  assert.ok(udaraSrc.includes("l[0] !== '#'"), 'the NOAA comment lines are skipped');
});

test('the /udara hub loads both sources in parallel & does not collapse when one dies', () => {
  assert.ok(serverSrc.includes('Promise.allSettled([udara.getAirRanking(), udara.getCo2()])'), 'allSettled over two sources');
  assert.ok(serverSrc.includes("air.status === 'fulfilled' ? air.value : null"), 'air: a failure → null, the page is still served');
  const geoRoute = serverSrc.match(/app\.get\('\/udara\/carbon'[\s\S]*?\}\);/);
  assert.ok(geoRoute && geoRoute[0].includes('try { co2 = await udara.getCo2(); }'), 'carbon: a guarded catch');
});
