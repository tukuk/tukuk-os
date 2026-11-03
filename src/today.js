'use strict';
// today.js — the /today daily briefing feed and its /today.xml RSS companion (Nov 2026).
//
// Why this page exists: feeds are what turn a one-time visitor into a repeat one, and the
// two things genuinely worth checking every day that we can offer with NO key and NO cost
// are world-city weather (Open-Meteo answers a keyless multi-city request in one call —
// probed live before committing to it) and the ECB reference exchange rates (already
// fetched, cached and guarded by src/wang.js). The original plan said "harga barang" —
// goods prices. The open data.gov.my price endpoints returned 404 across the board in the
// November 2026 probe, and there is no other keyless daily source we would trust; this
// page says exactly that instead of dressing currency rates up as a cost-of-living index.
// No prayer-times feed by owner direction (Nov 2026).
//
// Resilience doctrine, copied from the house pattern (weather.js, wang.js): cache-then-
// network with serve-stale on failure, a per-request timeout, and legs that resolve
// independently — a dead weather call must never blank the rates, and a third-party
// outage must never turn /today into a 500. The test suite patches getBriefing outright,
// so page and feed tests never depend on the internet answering.

const axios = require('axios');
const https = require('https');
const { attachGuard } = require('./outbound');
const wang = require('./wang');

const http = axios.create({
  timeout: 9000,
  httpsAgent: new https.Agent({ family: 4 }), // VPS: IPv6 is awkward (NOAA pitfall)
  headers: { 'User-Agent': 'TukukOS-Today-Client/1.0 (+https://tukuk.org)' },
});
// Same guard shape as the /wang and /muzik cases in src/outbound.js: one page, one call,
// nobody queues behind a slow upstream.
attachGuard(http, { name: 'today' });

// Eight cities chosen for reach, not for nationality of the reader: four the site's
// audience actually lives in or trades with, four world reference points.
const CITIES = [
  ['Jakarta', '🇮🇩', -6.21, 106.84], ['Kuala Lumpur', '🇲🇾', 3.14, 101.69],
  ['Singapore', '🇸🇬', 1.35, 103.82], ['Bangkok', '🇹🇭', 13.75, 100.5],
  ['Tokyo', '🇯🇵', 35.68, 139.69], ['London', '🇬🇧', 51.51, -0.13],
  ['New York', '🇺🇸', 40.71, -74.01], ['Sydney', '🇦🇺', -33.87, 151.21],
];
// The rates table leads with what our readers get paid in and what they pay for imports in.
const RATE_ROWS = ['EUR', 'GBP', 'JPY', 'MYR', 'SGD', 'IDR', 'INR', 'CNY', 'AUD', 'SAR'];

// WMO 4677 interpretation codes — the numbers Open-Meteo's weathercode field carries.
const WMO = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
};
function wmoLabel(code) { return WMO[code] || ('weather code ' + code); }

const cache = new Map();
function cacheGet(key) { const h = cache.get(key); if (!h) return null; return { data: h.data, stale: Date.now() > h.expiresAt }; }
function cacheSet(key, data, ttlMs) { cache.set(key, { data, expiresAt: Date.now() + ttlMs }); }
const TTL_WEATHER = 15 * 60 * 1000; // Open-Meteo refreshes every 15 min anyway

// Previous ECB publication day: frankfurter updates Mon–Fri, so step back over the weekend.
function prevWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// ── leg 1: weather, one keyless call for all eight cities ────────────────────
async function getWeather() {
  const hit = cacheGet('today-weather');
  if (hit && !hit.stale) return hit.data;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + CITIES.map((c) => c[2]).join(',')
    + '&longitude=' + CITIES.map((c) => c[3]).join(',')
    + '&current_weather=true'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&forecast_days=1&timezone=auto';
  try {
    const res = await http.get(url);
    const arr = Array.isArray(res.data) ? res.data : [res.data]; // multi-location replies come back as an array
    const cities = CITIES.map((c, i) => {
      const r = arr[i] || {};
      const cw = r.current_weather || {};
      const d = r.daily || {};
      return {
        name: c[0], flag: c[1], tz: r.timezone_abbreviation || '',
        temp: cw.temperature, wind: cw.windspeed, code: cw.weathercode,
        isDay: cw.is_day !== 0, asOf: cw.time,
        hi: (d.temperature_2m_max || [])[0], lo: (d.temperature_2m_min || [])[0],
        rain: (d.precipitation_probability_max || [])[0],
      };
    }).filter((x) => typeof x.temp === 'number');
    if (!cities.length) throw new Error('empty weather payload');
    const out = { ok: true, stale: false, fetchedAt: Date.now(), cities };
    cacheSet('today-weather', out, TTL_WEATHER);
    return out;
  } catch (err) {
    if (hit && hit.data) return Object.assign({}, hit.data, { stale: true });
    return { ok: false, stale: false, err: String((err && err.message) || err) };
  }
}

// ── leg 2: ECB reference rates through the existing wang.js cache ────────────
async function getRates() {
  try {
    const latest = await wang.getLatest('USD');
    let prev = null;
    try {
      const p = await wang.getOnDate('USD', prevWeekday(latest.date));
      if (p && p.rates && Object.keys(p.rates).length) prev = p.rates;
    } catch (e) { /* bank holiday publication gap: show levels without the change column */ }
    const rows = RATE_ROWS.filter((c) => latest.rates[c] != null).map((c) => {
      const meta = wang.CODES.find((x) => x[0] === c) || [c, c, ''];
      const pv = prev && prev[c];
      return {
        code: c, name: meta[1], flag: meta[2], rate: latest.rates[c],
        chg: pv ? (latest.rates[c] / pv - 1) * 100 : null,
      };
    });
    return { ok: true, date: latest.date, source: latest.source, rows };
  } catch (err) {
    return { ok: false, err: String((err && err.message) || err) };
  }
}

async function getBriefing() {
  const [weather, rates] = await Promise.all([getWeather(), getRates()]);
  return { date: new Date().toISOString().slice(0, 10), weather, rates };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function badge(ok, stale) {
  return ok ? (stale
    ? '<span class="tl-badge tl-no">cached snapshot</span>'
    : '<span class="tl-badge tl-ok">live</span>')
    : '<span class="tl-badge tl-no">feed unreachable</span>';
}

// ── the page ─────────────────────────────────────────────────────────────────
function todayPage(b, ctx) {
  const { worldDoc, TOOLS_CSS, navHtml } = ctx;
  const wRows = b.weather.ok ? b.weather.cities.map((c) =>
    `<tr><td>${c.flag} <b>${esc(c.name)}</b></td>`
    + `<td>${c.isDay ? '☀️' : '🌙'} <b>${Math.round(c.temp)}°C</b> ${esc(wmoLabel(c.code))}</td>`
    + `<td>${c.hi == null ? '—' : Math.round(c.lo) + '–' + Math.round(c.hi) + '°C'}</td>`
    + `<td>${c.rain == null ? '—' : Math.round(c.rain) + '%'}</td>`
    + `<td>${Math.round(c.wind || 0)} km/h</td></tr>`).join('')
    : `<tr><td colspan="5">Weather feed unreachable (${esc(b.weather.err)}) — the retry is every 15 minutes; nothing you did broke it.</td></tr>`;
  const rRows = b.rates.ok ? b.rates.rows.map((r) =>
    `<tr><td>${r.flag} <b>${r.code}</b> ${esc(r.name)}</td>`
    + `<td>${r.rate >= 50 ? r.rate.toLocaleString('en-US', { maximumFractionDigits: 1 }) : r.rate.toFixed(4)}</td>`
    + `<td>${r.chg == null ? '—' : (r.chg >= 0 ? '▲ +' : '▼ ') + r.chg.toFixed(2) + '%'}</td></tr>`).join('')
    : `<tr><td colspan="3">Rates feed unreachable (${esc(b.rates.err)}) — <a href="/money">/money</a> serves the same ECB table with a longer fallback cache.</td></tr>`;
  const body = `<p>This is the <b>one-screen daily check</b>: what the world's weather is doing right now, and what the day's official
  currency rates came in at — both without a single account, API key or cookie. Weather comes from <b>Open-Meteo</b> (one keyless
  request covering all eight cities, refreshed on this page every 15 minutes); rates are the <b>European Central Bank reference
  rates</b> as published on weekdays around 16:00 CET, the same table <a href="/money">World Money</a> runs on. The change column
  compares against the previous publication day.</p>
  <h2 class="section-title">🌦 Weather right now ${badge(b.weather.ok, b.weather.stale)}</h2>
  <table class="tl-tab"><thead><tr><th>City</th><th>Now</th><th>Today</th><th>Rain risk</th><th>Wind</th></tr></thead><tbody>${wRows}</tbody></table>
  <p class="meta">${b.weather.ok ? 'Local times shown per city (their “now”, not yours). Rain risk is the day\'s maximum precipitation probability — useful, but a forecast is a forecast.' : ''}</p>
  <h2 class="section-title">💱 Reference rates — 1 USD equals ${badge(b.rates.ok, b.rates.source === 'last-known')}</h2>
  <table class="tl-tab"><thead><tr><th>Currency</th><th>Rate</th><th>vs previous publication</th></tr></thead><tbody>${rRows}</tbody></table>
  <h2 class="section-title">Why there is no goods-price row</h2>
  <p>The plan for this page was <i>harga barang</i> — daily prices of rice, oil, fuel and the rest. Every keyless source we probed
  for it (the Malaysian open-data portal's price and CPI endpoints) answers 404 as of November 2026, and the survivors are paid
  terminals. A feed that quietly substitutes stale or scraped numbers would be worse than an honest gap: exchange rates are the
  daily figure we can publish with a named, current, verifiable source — and the honest note that reference rates are not the
  rate any counter will actually give you.</p>
  <p class="meta"><a href="/today.xml">📡 RSS 2.0 companion at /today.xml</a> — subscribe once and both briefings land in your reader each refresh; the entries are per-day, so yesterday's digest stays in your archive.</p>`;
  return worldDoc({
    title: 'Today — World Weather & Currency Rates Briefing | Tukuk-OS',
    desc: 'One screen, twice a day: live weather for eight world cities from Open-Meteo and the ECB reference exchange rates, with an RSS 2.0 companion. No account, no key, no tracking.',
    selfUrl: 'https://tukuk.org/today',
    heroTitle: '📰 Today', heroSub: 'world weather now · ECB rates · one screen · RSS included',
    css: TOOLS_CSS, body,
    ld: JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Tukuk Today Briefing',
      applicationCategory: 'NewsApplication', operatingSystem: 'Web browser, Android, iOS',
      description: 'Daily weather and currency-rate briefing with RSS feed.',
      url: 'https://tukuk.org/today',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    }).replace(/</g, '\\u003c'),
  }, navHtml);
}

// ── the RSS 2.0 companion ────────────────────────────────────────────────────
function rssItem(title, link, desc, pubDate, guid) {
  return `<item>\n  <title>${esc(title)}</title>\n  <link>${esc(link)}</link>\n`
    + `  <guid isPermaLink="false">${esc(guid)}</guid>\n  <pubDate>${pubDate}</pubDate>\n`
    + `  <description>${esc(desc)}</description>\n</item>`;
}

function rssXml(b, origin) {
  const base = origin || 'https://tukuk.org';
  // pubDate at 07:00 UTC — after the ECB morning publication, before Asia's evening read.
  const stamp = new Date(b.date + 'T07:00:00Z').toUTCString();
  const items = [];
  if (b.weather.ok) {
    items.push(rssItem(
      'World weather briefing — ' + b.date,
      base + '/today#weather',
      b.weather.cities.map((c) => c.name + ' ' + Math.round(c.temp) + '°C, ' + wmoLabel(c.code)).join('; ') + '.',
      stamp, base + '/today#weather-' + b.date));
  }
  if (b.rates.ok) {
    const moves = b.rates.rows.filter((r) => r.chg != null)
      .slice().sort((x, y) => Math.abs(y.chg) - Math.abs(x.chg)).slice(0, 3)
      .map((r) => 'USD/' + r.code + ' ' + r.rate.toFixed(4) + ' (' + (r.chg >= 0 ? '+' : '') + r.chg.toFixed(2) + '%)');
    items.push(rssItem(
      'ECB reference rates — ' + b.rates.date,
      base + '/today#rates',
      (moves.length ? 'Biggest moves: ' + moves.join(', ') + '. ' : '')
      + '1 USD = ' + b.rates.rows.map((r) => r.code + ' ' + r.rate.toFixed(2)).join(', ') + '.',
      stamp, base + '/today#rates-' + b.rates.date));
  }
  if (!items.length) {
    items.push(rssItem('Today briefing — feeds unreachable',
      base + '/today',
      'Both upstream feeds were unreachable when this was generated; the page retries every 15 minutes.',
      new Date().toUTCString(), base + '/today-' + b.date));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n'
    + '  <title>Tukuk-OS Today</title>\n'
    + `  <link>${base}/today</link>\n`
    + `  <atom:link href="${base}/today.xml" rel="self" type="application/rss+xml"/>\n`
    + '  <description>Daily world-weather and ECB reference-rate briefing from tukuk.org.</description>\n'
    + '  <language>en</language>\n'
    + `  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`
    + '  <ttl>720</ttl>\n'
    + items.join('\n') + '\n</channel>\n</rss>\n';
}

module.exports = { getBriefing, getWeather, getRates, todayPage, rssXml, wmoLabel, prevWeekday, CITIES };
