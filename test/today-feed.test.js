// ═══ Tests: /today daily briefing page and its /today.xml RSS companion ═══
// The briefing legs (Open-Meteo, wang.js) are third-party, so the routes look
// getBriefing up through the module property — which is exactly the seam this
// file uses: a fixture is installed before the server is even asked to answer,
// so no test here touches the internet, and the outage paths are reachable on
// purpose instead of only when the network decides to misbehave.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const today = require('../src/today');
const { app } = require('../src/server');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

function useBriefing(b) { today.getBriefing = async () => b; }
function briefingFails(msg) { today.getBriefing = async () => { throw new Error(msg); }; }

// Hand-built fixture — numbers chosen so the expected rendering is derivable
// by eye: round(33.8)=34, 4.182.toFixed(4)='4.1820', round(88)=88%.
const OK = {
  date: '2026-11-03',
  weather: {
    ok: true, stale: false, fetchedAt: Date.now(),
    cities: [
      { name: 'Jakarta', flag: '🇮🇩', tz: 'WIB', temp: 33.8, wind: 12.4, code: 95, isDay: true, asOf: '2026-11-03T13:00', hi: 35.5, lo: 26.4, rain: 88 },
      { name: 'London', flag: '🇬🇧', tz: 'GMT', temp: 11.2, wind: 20, code: 51, isDay: false, asOf: '2026-11-03T11:00', hi: 13, lo: 7, rain: 40 },
    ],
  },
  rates: {
    ok: true, date: '2026-11-03', source: 'live',
    rows: [
      { code: 'MYR', name: 'Malaysian Ringgit', flag: '🇲🇾', rate: 4.182, chg: -0.34 },
      { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵', rate: 153.42, chg: 0.21 },
      { code: 'SGD', name: 'Singapore Dollar', flag: '🇸🇬', rate: 1.29, chg: null },
    ],
  },
};

const stripScripts = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '');

test('GET /today renders the briefing from the stubbed legs', async () => {
  useBriefing(OK);
  const res = await fetch(base + '/today');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /📰 Today/);
  assert.match(html, /Jakarta/);
  assert.match(html, /34°C/); // round(33.8)
  assert.match(html, /thunderstorm/); // WMO 95
  assert.match(html, /🌙 <b>11°C<\/b>/); // London is night in the fixture
  assert.match(html, /88%/); // Jakarta rain risk
  assert.match(html, /4\.1820/); // MYR toFixed(4)
  assert.match(html, /153\.4/); // JPY above 50 goes to the 1-dp locale form
  assert.match(html, /▼ -0\.34%/); // MYR down against USD (toFixed emits an ASCII minus)
  assert.match(html, /▲ \+0\.21%/); // JPY up
  assert.match(html, /live/); // both badges
});

test('GET /today links the RSS companion and hides no template leaks', async () => {
  useBriefing(OK);
  const html = stripScripts(await (await fetch(base + '/today')).text());
  assert.match(html, /href="\/today\.xml"/);
  assert.ok(!html.includes('undefined'), 'literal "undefined" leaked into markup');
  assert.ok(!html.includes('NaN'), 'literal "NaN" leaked into markup');
  assert.ok(!html.includes('[object Object]'), 'object leaked into markup');
});

test('a null change row renders an em dash, never "null%"', async () => {
  useBriefing(OK);
  const html = stripScripts(await (await fetch(base + '/today')).text());
  assert.ok(!html.includes('null'), 'null printed where SGD has no previous publication');
});

test('last-known rate source shows the honest cached badge, not "live"', async () => {
  useBriefing({ ...OK, rates: { ...OK.rates, source: 'last-known' } });
  const html = await (await fetch(base + '/today')).text();
  assert.match(html, /cached snapshot/);
});

test('both legs down: /today is still 200 and says so plainly', async () => {
  useBriefing({
    date: '2026-11-03',
    weather: { ok: false, stale: false, err: 'getaddrinfo EAI_AGAIN api.open-meteo.com' },
    rates: { ok: false, err: 'frankfurter unreachable' },
  });
  const res = await fetch(base + '/today');
  assert.equal(res.status, 200); // an upstream outage is never a 500 on this site
  const html = await res.text();
  assert.match(html, /feed unreachable/);
  assert.match(html, /EAI_AGAIN/); // the err is quoted back, escaped, not swallowed
});

test('GET /today.xml serves parsable RSS built from the same fixture', async () => {
  useBriefing(OK);
  const res = await fetch(base + '/today.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/rss\+xml/);
  const xml = await res.text();
  assert.ok(xml.startsWith('<?xml'), 'missing XML declaration');
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /<\/rss>\s*$/, 'channel does not close');
  assert.match(xml, /<atom:link href="https:\/\/tukuk\.org\/today\.xml" rel="self"/);
  assert.match(xml, /Jakarta 34°C, thunderstorm/);
  assert.match(xml, /USD\/MYR 4\.1820 \(-0\.34%\)/); // biggest-moves line keeps wang's 4-dp precision
  assert.ok(xml.includes('https://tukuk.org/today#weather-2026-11-03'), 'per-day weather guid');
  // every & must be an entity — the classic feed-validator failure this page must not have
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(xml), 'unescaped ampersand in RSS');
  assert.match(xml, /<ttl>720<\/ttl>/);
});

test('both legs down: RSS degrades to one honest item, not an empty channel', async () => {
  useBriefing({ date: '2026-11-03', weather: { ok: false, err: 'boom' }, rates: { ok: false, err: 'boom' } });
  const xml = await (await fetch(base + '/today.xml')).text();
  assert.match(xml, /Today briefing — feeds unreachable/);
  assert.match(xml, /<item>/);
  assert.match(xml, /<\/rss>\s*$/);
});

test('if the module itself throws, /today gives 503 and /today.xml stays well-formed', async () => {
  briefingFails('render exploded');
  const page = await fetch(base + '/today');
  assert.equal(page.status, 503);
  const feed = await fetch(base + '/today.xml');
  assert.equal(feed.status, 503);
  const xml = await feed.text();
  // pins the malformed <channel><<title> typo that once lived in this branch
  assert.ok(!xml.includes('><<'), 'doubled angle bracket in the RSS error branch');
  assert.match(xml, /<channel><title>temporarily unavailable<\/title><\/channel>/);
});

// ── pure unit checks: the two functions the fixtures cannot excuse ──────────
test('prevWeekday steps back over the weekend (Mon 2 Nov → Fri 30 Oct)', () => {
  assert.equal(today.prevWeekday('2026-11-02'), '2026-10-30');
  assert.equal(today.prevWeekday('2026-11-03'), '2026-11-02'); // Tue → Mon, no skipping
});

test('wmoLabel names known codes and never lies about unknown ones', () => {
  assert.match(today.wmoLabel(51), /drizzle/);
  assert.equal(today.wmoLabel(95), 'thunderstorm');
  assert.match(today.wmoLabel(4677), /^weather code 4677$/); // fallback states the number
});
