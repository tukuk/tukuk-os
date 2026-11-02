'use strict';
// The single Google tag. tukuk.org's GA4 property is G-HLPDZPEYMN; the site hardcodes ONE
// Google tag in <head> (googleTagHead) — either a GTM container (gtm.js) or a GA4
// measurement ID (gtag.js). Google's "install manually" snippet and the container must never
// both fire on a page, because two tags means every pageview counted twice. This test pins
// the shipped default and the either/or rule on real rendered pages.
//
// The two rendering paths are pinned against EACH OTHER, not against a remembered constant:
// server-rendered pages carry the tag inline, every SPA page gets it from
// public/adsense-loader.js reading /api/public/settings. Those two disagreeing is exactly how
// the property ended up reporting blog traffic and no homepage traffic.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { app, normalizeAdsClient, resolveGoogleTagId } = require('../src/server');

let srv = null;
let base = '';
async function get(pathname) {
  if (!base) {
    srv = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      srv.once('listening', resolve);
      srv.once('error', reject);
    });
    base = `http://127.0.0.1:${srv.address().port}`;
  }
  const res = await fetch(base + pathname);
  assert.equal(res.status, 200, `${pathname} should render`);
  return res.text();
}
after(() => { if (srv) srv.close(); });

test('content pages carry the GA4 Google tag installed manually, exactly once', async () => {
  const html = await get('/');
  assert.ok(html.includes('https://www.googletagmanager.com/gtag/js?id=G-HLPDZPEYMN'), 'gtag.js loader with the tukuk.org measurement ID');
  assert.ok(html.includes(`gtag('config',"G-HLPDZPEYMN")`), 'the config call the Google snippet requires');
  assert.ok(!html.includes('gtm.js?id='), 'no second Google tag (container) alongside gtag.js — that would double-count');
  const loaders = html.match(/googletagmanager\.com\/(?:gtag\/js|gtm\.js)/g) || [];
  assert.equal(loaders.length, 1, `one Google tag script per page (found ${loaders.length})`);
});

test('Consent Mode bootstrap is emitted before the Google tag loads', async () => {
  const html = await get('/blog');
  const consent = html.indexOf('consent\u0027,\u0027default'); // g('consent','default',…)
  const tag = html.indexOf('googletagmanager.com/gtag/js');
  assert.ok(consent !== -1, 'consent defaults present');
  assert.ok(tag !== -1, 'Google tag present');
  assert.ok(consent < tag, 'denied-by-default consent must precede the tag, per Google Consent Mode v2');
});

test('Clarity still rides alongside the Google tag', async () => {
  const html = await get('/build');
  assert.ok(html.includes('https://www.clarity.ms/tag/'), 'Clarity remains installed');
});

test('the AdSense console\'s own spelling of the publisher id is accepted, junk is not', () => {
  // What a human pastes out of the account page is `pub-…`; what the ad tag and the client
  // loader require is `ca-pub-…`. Rejecting the paste form silently means no ads and a
  // "configured" Admin field, which is the worst kind of nothing-happens bug.
  assert.equal(normalizeAdsClient('pub-2797331455354322'), 'ca-pub-2797331455354322');
  assert.equal(normalizeAdsClient('  CA-PUB-2797331455354322  '), 'ca-pub-2797331455354322');
  assert.equal(normalizeAdsClient('ca-pub-2797331455354322'), 'ca-pub-2797331455354322');
  // Half-pasted, decorated, or somebody else's account: every one of these must render nothing.
  for (const junk of ['', 'pub-', 'pub-abc', 'pub-123;evil', 'pub-123 456', 'ca-pub-123-extra',
    'http://pub-1', 'google.com, pub-123, DIRECT', null, undefined]) {
    assert.equal(normalizeAdsClient(junk), '', `${JSON.stringify(junk)} must never reach a page`);
  }
});

test('the tag and the ad client the server renders are the ones the SPA loader is told to use', async () => {
  const html = await get('/');
  const settings = JSON.parse(await get('/api/public/settings'));
  // If an admin configured a client, the feed must hand the loader the canonical form — the
  // homepage used to read a store-only value and render nothing while /blog served ads.
  assert.match(settings.adsClient, /^(ca-pub-\d+)?$/, 'adsClient is canonical or absent');
  const feedTag = html.match(/googletagmanager\.com\/(?:gtag\/js|gtm\.js)\?id=([A-Za-z0-9-]+)/);
  if (settings.gtmEnabled) {
    assert.ok(feedTag, 'the feed says the tag is on, so the page must carry it');
    assert.equal(feedTag[1].toUpperCase(), settings.gtmId.toUpperCase(),
      'one Google id for both rendering paths — a page tag and a feed tag may not differ');
  } else {
    assert.ok(!feedTag, 'the tag is switched off, so no page may load it');
  }
  if (settings.adsEnabled) {
    assert.ok(html.includes(`adsbygoogle.js?client=${settings.adsClient}`),
      'an enabled account must appear in the loader the page actually fetches');
  } else {
    assert.ok(!/pagead2\.googlesyndication\.com/.test(html), 'a disabled or unapproved account loads no ad library');
  }
});

test('the client loader declares consent before the tag and never gates the tag on a grant', () => {
  // The file is plain JS served to the browser, so this reads it as shipped.
  const loader = readFileSync(join(__dirname, '..', 'public', 'adsense-loader.js'), 'utf8');
  const consent = loader.indexOf("gtag('consent', 'default'");
  const tag = loader.indexOf('googletagmanager.com/gtag/js');
  assert.ok(consent >= 0, 'the loader seeds Consent Mode v2 defaults itself');
  assert.ok(tag >= 0, 'the loader can install a GA4 measurement id, not only a container');
  assert.ok(/gtm\.js\?id=/.test(loader), '…and a GTM/GT- container, one id at a time');
  assert.ok(consent < tag, 'the state must be declared before anything that could report a hit');
  // Google's contract: the tag is always present and Google decides what the state permits, so
  // a grant-gated tag does not protect anyone — it just measures nobody. Clarity has no such
  // contract and stays behind the grant.
  assert.match(loader, /if \(granted && s\.clarityEnabled\)/, 'Clarity waits for a grant');
  assert.match(loader, /if \(s\.gtmEnabled\)/, 'the Google tag waits only for its own switch');
  assert.doesNotMatch(loader, /if \(granted\) \{/, 'no blanket grant block may swallow the tag');
});

test('the Google id follows Admin store > env > code default, except for the retired container', () => {
  // The live box stores `GT-PZXWTWW8` — the id this code used to hardcode — and the Admin store
  // beats env. Deploying the new default alone would have changed nothing on that box, which is
  // why the legacy value is read back as "never configured" rather than as a choice.
  assert.equal(resolveGoogleTagId('GT-PZXWTWW8'), 'G-HLPDZPEYMN');
  assert.equal(resolveGoogleTagId(' gt-pzxwtww8 '), 'G-HLPDZPEYMN');
  // Escape hatch for anyone who really does own that container.
  process.env.GTM_KEEP_LEGACY_ID = '1';
  assert.equal(resolveGoogleTagId('GT-PZXWTWW8'), 'GT-PZXWTWW8');
  delete process.env.GTM_KEEP_LEGACY_ID;
  // Never configured → env first, then the shipped default; an admin's own value always wins.
  assert.equal(resolveGoogleTagId(null), 'G-HLPDZPEYMN');
  assert.equal(resolveGoogleTagId(undefined, 'GTM-ABC1234'), 'GTM-ABC1234');
  assert.equal(resolveGoogleTagId('G-OWNEDID', 'GTM-ABC1234'), 'G-OWNEDID');
  // A field cleared on purpose stays cleared: `gtmEnabled` is the switch that means "off".
  assert.equal(resolveGoogleTagId(''), '');
});
