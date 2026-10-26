#!/usr/bin/env node
'use strict';
// ——— IndexNow bulk submitter (sitemap-driven) ———
// The publish route only pings IndexNow for blog posts; the big generated
// clusters (weather/cities, countries, holidays, flags, …) are the bulk of the
// sitemap and were never pushed. IndexNow is the fastest, legitimate way to get
// Bing / Yandex / Naver / Seznam to crawl new URLs on a young domain.
//
// This script: collects every <loc> from the sitemap index + the per-cluster
// sitemaps, HEAD/GET-verifies each one is a live 200 (never submit broken URLs —
// search engines distrust a submit full of 404s), then POSTs them to
// api.indexnow.org in batches of <=1000. It is idempotent — safe to run on a
// timer to keep the index fresh after redeploys.
//
//   INDEXNOW_KEY=<key> node scripts/indexnow-submit.js [--dry]
const https = require('https');

const KEY = (process.env.INDEXNOW_KEY || 'bd8f0317c5ab4cddb9a3dc62f7ec15ae').trim();
const HOST = 'tukuk.org';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const DRY = process.argv.includes('--dry');

const SITEMAPS = [
  'https://tukuk.org/sitemap.xml',
  'https://tukuk.org/sitemap-nasa.xml',
  'https://tukuk.org/sitemap-weather.xml',
  'https://tukuk.org/sitemap-earthquakes.xml',
  'https://tukuk.org/sitemap-holidays.xml',
  'https://tukuk.org/sitemap-countries.xml',
];

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'TukukOSBot/2.1 (+https://tukuk.org)' } }, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 2 * 1024 * 1024) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}

function postIndexNow(urlList) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList });
    const req = https.request('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', (e) => resolve({ status: 0, body: String(e) }));
    req.write(payload); req.end();
  });
}

(async () => {
  if (!KEY) { console.error('no INDEXNOW_KEY'); process.exit(1); }
  // 1) collect URLs from all sitemaps
  const set = new Set();
  for (const sm of SITEMAPS) {
    const { status, body } = await get(sm);
    const locs = (body.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, '').trim());
    locs.forEach((u) => { if (u.startsWith(`https://${HOST}/`)) set.add(u); });
    console.log(`  ${sm} -> ${status} (${locs.length} urls)`);
  }
  const all = [...set].filter((u) => !u.includes('/cari') && !u.includes('/admin'));
  console.log(`collected ${all.length} unique tukuk.org URLs`);

  // 2) verify each is a live 200 before submitting (never push broken URLs)
  const live = [];
  let i = 0;
  const verify = async (url) => { const { status } = await get(url); if (status === 200) live.push(url); return ++i; };
  const CONC = 12;
  const queue = all.slice();
  await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { const u = queue.shift(); const n = await verify(u); if (n % 200 === 0) console.log(`  verified ${n}/${all.length}`); } }));
  console.log(`verified 200: ${live.length}/${all.length} (dropped ${all.length - live.length} non-200)`);

  if (DRY) { console.log('--dry: not submitting'); return; }

  // 3) submit in batches of 1000 (IndexNow accepts up to 10,000; 1000 is polite)
  let accepted = 0;
  for (let b = 0; b < live.length; b += 1000) {
    const batch = live.slice(b, b + 1000);
    const { status, body } = await postIndexNow(batch);
    const ok = status === 200 || status === 202;
    if (ok) accepted += batch.length;
    console.log(`  batch ${b / 1000 + 1} (${batch.length}) -> HTTP ${status}${ok ? ' ✓' : '  ' + body.slice(0, 120)}`);
  }
  console.log(`IndexNow accepted ${accepted}/${live.length} URLs. Bing/Yandex/Naver/Seznam will re-crawl soon.`);
})();
