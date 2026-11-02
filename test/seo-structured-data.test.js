'use strict';
/*
 * SEO structured-data regression guard.
 *
 * Google Search Console flagged three things on 2026-10-26:
 *   - Video report: a VideoObject was INVALID for missing the required `uploadDate`.
 *   - Image-metadata report: 192 flag ImageObjects were missing license/copyright/acquire.
 *   - Lighthouse a11y: the shared footer jumped h2 → h4 (skipped h3).
 * These are cheap to re-break, so lock them to the source that is actually served.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const serverSrc = fs.readFileSync(require.resolve('../src/server.js'), 'utf8');
// The footer is now generated from SITE_NAV, so grep of the template source would look for
// column titles that no longer appear as literals. Assert against the rendered HTML instead —
// the only thing a visitor or Lighthouse ever receives.
const { siteFooter, SITE_NAV } = require('../src/server');

test('every VideoObject we emit carries the required uploadDate', () => {
  const count = (serverSrc.match(/'@type': 'VideoObject'/g) || []).length;
  assert.ok(count >= 2, 'both the live APOD and the dated-archive video blocks must exist');
  // No VideoObject block may lack uploadDate: scan a small window after each marker.
  let idx = -1;
  while ((idx = serverSrc.indexOf("'@type': 'VideoObject'", idx + 1)) !== -1) {
    const block = serverSrc.slice(idx, idx + 600);
    assert.ok(/uploadDate/.test(block), 'a VideoObject must declare uploadDate');
  }
});

test('flag ImageObjects declare license, copyrightNotice and acquireLicensePage', () => {
  const i = serverSrc.indexOf('name: `Flag of ${c.name}`');
  assert.ok(i !== -1, 'the flag ImageObject block must exist');
  const block = serverSrc.slice(i - 200, i + 600);
  assert.ok(block.includes('https://creativecommons.org/publicdomain/mark/1.0/'), 'flag license points to the public-domain marker');
  assert.ok(/copyrightNotice:/.test(block), 'flag ImageObject has a copyrightNotice');
  assert.ok(/acquireLicensePage:/.test(block), 'flag ImageObject has an acquireLicensePage');
});

test('the shared footer uses h3, not h4, so heading order stays sequential', () => {
  const footer = siteFooter();
  assert.ok(!/<h4>/.test(footer), 'no h4 in the footer (h2 content → h4 skipped a level)');
  // One h3 per column title, taken from the array the footer is built from.
  for (const g of SITE_NAV) {
    assert.ok(footer.includes(`<h3>${g.title}</h3>`), `column title "${g.title}" renders as h3`);
  }
  // The CSS that styles them must follow the new level or the titles lose their look.
  assert.ok(/\.foot-cols h3 \{/.test(serverSrc), '.foot-cols h3 CSS rule exists');
});
