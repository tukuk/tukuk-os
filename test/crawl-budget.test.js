'use strict';
// Crawl budget + AdSense approval gate — the two policy decisions that decide whether Google
// sees a reference library or 816k near-identical pages, and whether an unapproved account is
// shipping ad units. Both are one careless edit away from silently reverting, so both are
// pinned here rather than left to a comment.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { app, CRAWL_INDEX_MAX_ITEMS, clusterItemRobots } = require('../src/server');

let srv = null;
let base = '';
async function listen() {
  if (base) return base;
  srv = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    srv.once('listening', resolve);
    srv.once('error', reject);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
  return base;
}
after(() => { if (srv) srv.close(); });

const locs = (xml) => (xml.match(/<loc>/g) || []).length;
const get = async (p) => (await fetch(`${await listen()}${p}`)).text();

test('crawl budget: the threshold is a number and the decision is monotonic', () => {
  assert.equal(typeof CRAWL_INDEX_MAX_ITEMS, 'number');
  assert.ok(CRAWL_INDEX_MAX_ITEMS >= 0, 'a negative line would index everything');
  assert.equal(clusterItemRobots(0), 'index,follow');
  assert.equal(clusterItemRobots(CRAWL_INDEX_MAX_ITEMS), 'index,follow', 'the line itself is inclusive');
  assert.equal(clusterItemRobots(CRAWL_INDEX_MAX_ITEMS + 1), 'noindex,follow');
  assert.equal(clusterItemRobots(254655), 'noindex,follow', 'settlements must never be indexable at any sane line');
});

test('crawl budget: the settlements sitemap advertises hubs, not 254k items', async () => {
  const xml = await get('/sitemap-settlements.xml');
  const n = locs(xml);
  assert.ok(n > 0, 'the hub and its continents must still be advertised');
  assert.ok(n <= 20, `settlements must not list item URLs — found ${n} <loc>`);
  assert.match(xml, /tukuk\.org\/settlements</);
});

test('crawl budget: a cluster under the line keeps every item in its sitemap', async () => {
  const xml = await get('/sitemap-rivers.xml');
  assert.ok(locs(xml) > 100, 'rivers is under the line — dropping its items would be a regression');
});

test('crawl budget: the three biggest shards are all excluded', async () => {
  for (const base of ['settlements', 'railway-stations', 'french-communes']) {
    const xml = await get(`/sitemap-${base}.xml`);
    assert.ok(locs(xml) <= 20, `${base} still advertises ${locs(xml)} URLs — the crawl budget is not applying`);
  }
});

test('crawl budget: the geo index still reaches every child sitemap', async () => {
  const idx = await get('/sitemap-geo.xml');
  const n = locs(idx);
  assert.ok(n >= 600, `geo index should declare every child sitemap, got ${n}`);
  assert.match(idx, /sitemap-settlements\.xml/);
});

test('crawl budget: the master sitemap never lists a cluster item', async () => {
  const xml = await get('/sitemap.xml');
  // Hub URLs only: /<base>/<slug> would mean a 3-deep path under a cluster that is not a hub.
  const itemLike = [...xml.matchAll(/<loc>https:\/\/tukuk\.org\/(settlements|railway-stations|french-communes)\/[^<]+<\/loc>/g)];
  assert.deepEqual(itemLike.map((m) => m[0]), [], 'the master sitemap must not smuggle thin items back in');
});

// The gate lives in config so it can be flipped without a code change. Both directions are
// proven in a clean child process: the parent's environment must not decide the answer.
function approvedInChild(env) {
  const clean = { ...process.env };
  delete clean.ADSENSE_APPROVED;
  Object.assign(clean, env);
  return execFileSync(process.execPath, ["-e", "process.stdout.write(String(require('./src/config').adsense.approved))"], {
    cwd: ROOT, env: clean, encoding: 'utf8',
  }).trim();
}

test('adsense: unapproved by default, and the flip actually flips', () => {
  assert.equal(approvedInChild({}), 'false', 'an unapproved account must serve nothing by default');
  assert.equal(approvedInChild({ ADSENSE_APPROVED: '1' }), 'true', 'ADSENSE_APPROVED=1 must re-enable ads');
  assert.equal(approvedInChild({ ADSENSE_APPROVED: '0' }), 'false');
});

test('adsense: no page may ship the library loader while unapproved', async () => {
  // With the gate shut every page is ad-free, including the ones that used to hardcode the tag.
  for (const page of ['/', '/blog', '/privacy', '/contact']) {
    const html = await get(page);
    assert.ok(!/pagead2\.googlesyndication\.com\/pagead/.test(html), `${page} still loads the AdSense library`);
    assert.ok(!/<ins class="adsbygoogle"/.test(html), `${page} still contains an ad unit`);
  }
  // The publisher meta tag stays: it is ownership verification, not an ad.
  const home = await get('/');
  assert.match(home, /google-adsense-account/);
});
