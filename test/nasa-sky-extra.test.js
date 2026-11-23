// ═══ Tests: /nasa/moon, /nasa/eclipses, /nasa/meteor-showers ═══
// The three additions to the Space Complex are computed/static pages (no API to
// fail), so the contract is: indexable chrome, real content from the registries
// (lunar maths, the eclipse catalog, the shower table), the cross-nav and the
// master sitemap carry them, and /index lists the whole NASA complex.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');
const nasa = require('../src/nasa');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function get(p) {
  const res = await fetch(base + p);
  return { status: res.status, html: await res.text() };
}

test('moon calendar maths is sane and exported', () => {
  const cal = nasa.moonCalendar(2026);
  assert.ok(cal.length >= 48 && cal.length <= 52, `expected ~50 phase events in 2026, got ${cal.length}`);
  // Cross-check against the published 2026 dates (mean phases may sit a day off).
  const fulls = cal.filter((e) => e.name === 'Full Moon').map((e) => e.date);
  assert.ok(fulls.includes('2026-03-03'), 'the total lunar eclipse of 3 Mar 2026 must fall on a full moon');
  const news = cal.filter((e) => e.name === 'New Moon').map((e) => e.date);
  assert.ok(news.includes('2026-02-17'), 'the annular eclipse of 17 Feb 2026 must fall on a new moon');
  const m = nasa.moonPhaseInfo(Date.now());
  assert.ok(m.illum_percent >= 0 && m.illum_percent <= 100);
  assert.ok(m.age_days >= 0 && m.age_days < 29.6);
});

test('GET /nasa/moon renders today\'s phase and the calendar', async () => {
  const { status, html } = await get('/nasa/moon');
  assert.equal(status, 200);
  assert.match(html, /<title>Moon Phase Today[^<]*<\/title>/);
  assert.ok(html.includes('href="https://tukuk.org/nasa/moon"'), 'canonical must be /nasa/moon');
  assert.ok(html.includes('<meta name="robots" content="index,follow,max-image-preview:large">'));
  assert.ok(/Phase today/.test(html) && /Illumination/.test(html), 'phase cards expected');
  assert.ok(html.includes('The coming phase events') && /in \d+ nights?/.test(html), 'countdown table expected');
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no literal undefined');
});

test('GET /nasa/eclipses lists the upcoming eclipses', async () => {
  const { status, html } = await get('/nasa/eclipses');
  assert.equal(status, 200);
  assert.match(html, /<title>Eclipse Calendar[^<]*<\/title>/);
  assert.ok(html.includes('href="https://tukuk.org/nasa/eclipses"'));
  assert.ok(html.includes('2 August 2027') || html.includes('Aug 2027'), 'the Egypt 2027 totality must appear');
  assert.ok(/Total .* eclipse/.test(html) && /Annular/.test(html), 'eclipse types expected');
  assert.ok(html.includes('ISO 12312-2'), 'safe-viewing rules must be on the page');
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
});

test('GET /nasa/meteor-showers lists the shower year', async () => {
  const { status, html } = await get('/nasa/meteor-showers');
  assert.equal(status, 200);
  assert.match(html, /<title>Meteor Shower Calendar[^<]*<\/title>/);
  assert.ok(html.includes('href="https://tukuk.org/nasa/meteor-showers"'));
  for (const name of ['Perseids', 'Geminids', 'Quadrantids', 'Leonids', 'Orionids']) {
    assert.ok(html.includes(name), `${name} must be listed`);
  }
  assert.ok(html.includes('Swift-Tuttle') && html.includes('3200 Phaethon'), 'parent bodies expected');
  assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
});

test('the space cross-nav and the master sitemap carry all three pages', async () => {
  const { html: hub } = await get('/nasa/moon');
  for (const p of ['/nasa/eclipses', '/nasa/meteor-showers', '/nasa/sky']) {
    assert.ok(hub.includes(`href="${p}"`), `cross-nav must link ${p}`);
  }
  const sm = await (await fetch(base + '/sitemap.xml')).text();
  for (const p of ['/nasa/moon', '/nasa/eclipses', '/nasa/meteor-showers']) {
    assert.ok(sm.includes(`${p}</loc>`), `sitemap must carry ${p}`);
  }
});

test('the site index lists the whole NASA complex', async () => {
  const { html } = await get('/index');
  assert.ok(html.includes('Space — the NASA complex'), 'the index must carry the space block');
  for (const p of ['/nasa', '/nasa/moon', '/nasa/eclipses', '/nasa/meteor-showers', '/nasa/iss', '/nasa/asteroids', '/nasa/mars', '/nasa/satellites']) {
    assert.ok(html.includes(`href="${p}"`), `index must link ${p}`);
  }
});
