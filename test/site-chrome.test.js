'use strict';
// The site chrome contract. Header and footer used to be two hand-written copies of the same
// navigation, and they drifted until the menu was three tidy six-link groups and the footer was a
// 32-link "Explore" column whose em-dash taglines existed nowhere else — plus a wrapped lone last
// column, because six boxes had been dropped into a five-track grid. Tests that grep the template
// source could not see any of that: they were asserting that the source still looked like the
// memory of the output. So this file asserts against the rendered HTML, which is the only thing a
// visitor or a crawler ever receives, and against the single SITE_NAV array both renderers now read.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, siteHeader, siteFooter, SITE_NAV, SITE_LEGAL } = require('../src/server');

const hrefsOf = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const navLinks = () => SITE_NAV.flatMap((g) => g.links.map((l) => ({ ...l, group: g.title })));
const legalLinks = () => SITE_LEGAL.map((l) => ({ ...l, group: 'Legal line' }));
const topLinks = () => navLinks().filter((l) => l.top);
const menuGroups = () => SITE_NAV.filter((g) => g.links.some((l) => l.top));

const footer = siteFooter();
const header = siteHeader('');

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

test('the nav array is well-formed enough to render without a second thought', () => {
  assert.ok(SITE_NAV.length >= 4, 'a footer of one or two columns is not a directory');
  const seen = new Set();
  for (const l of [...navLinks(), ...legalLinks()]) {
    assert.ok(l.href && l.href.length > 0, `every link needs an href (${l.label})`);
    assert.ok(l.label && l.label.length > 0, `every link needs a label (${l.href})`);
    assert.match(l.href, /^(\/|https?:\/\/)/, `"${l.href}" is neither an absolute path nor a full URL`);
    assert.ok(!/[<>"']/.test(l.href), `an href carrying markup would break the anchor: ${l.href}`);
    assert.ok(!/[<>]/.test(l.label), `a label carrying markup would break the anchor: ${l.label}`);
    // The footer prints the whole array, the menu prints the `top` subset. One href living in both
    // halves of the footer (a column and the legal line) would read as duplicate content.
    assert.ok(!seen.has(l.href), `"${l.href}" appears twice in the site chrome`);
    seen.add(l.href);
    if (l.top) {
      assert.ok(l.short, `"${l.label}" is in the menu, so it needs a one-word \`short\` label`);
      // An internal menu link with no `key` can never be highlighted, so the page it points at
      // would render as if it were nowhere in the menu. An external link has no key by definition:
      // it is never the current page.
      if (!l.ext) assert.ok(l.key, `"${l.label}" is an in-menu page and needs a \`key\` to mark it active`);
    }
  }
  const titles = SITE_NAV.map((g) => g.title);
  assert.equal(new Set(titles).size, titles.length, 'two columns with the same title are one column too many');
  for (const g of SITE_NAV) assert.ok(g.links.length > 0, `column "${g.title}" renders an empty list`);
});

test('the footer is the array: nothing added, nothing dropped, same order', () => {
  const want = navLinks().concat(legalLinks()).map((l) => l.href);
  // index 0 is the brand link back to '/', which the array does not carry.
  const got = hrefsOf(footer).slice(1);
  assert.deepEqual(got, want, 'the footer HTML and SITE_NAV/SITE_LEGAL disagree');
});

test('the footer grid counts its columns from the array, so the CSS cannot disagree', () => {
  assert.match(footer, new RegExp(`--foot-cols:${SITE_NAV.length}\\b`),
    'the column count must come from the array, not from a number in the stylesheet');
  const titles = [...footer.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(titles, SITE_NAV.map((g) => g.title), 'one heading per column, in array order');
});

test('the menu is a projection of the same array, not a copy of it', () => {
  const panel = header.match(/<div class="nav-panel"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual(hrefsOf(panel), topLinks().map((l) => l.href),
    'every `top` link is in the menu and nothing else is');
  assert.match(header, new RegExp(`--nav-cols:${menuGroups().length}\\b`),
    'the menu grid must count its columns from the same array');
  // Short labels only: the menu is a compact grid, and a 30-character footer title in a six-link
  // column is how the two drifted apart in the first place.
  for (const l of topLinks()) {
    assert.ok(l.short.length <= 12, `menu label too long for a column: "${l.short}"`);
    assert.ok(panel.includes(`>${l.short}</a>`), `the menu shows "${l.short}" for ${l.href}`);
  }
});

test('exactly one menu link is marked for the current page', () => {
  assert.equal((header.match(/aria-current="page"/g) || []).length, 0, 'no page key, no active link');
  const marked = siteHeader('cuaca');
  const actives = [...marked.matchAll(/<a href="([^"]+)" class="active" aria-current="page">([^<]*)</g)];
  assert.equal(actives.length, 1, `the current page must be marked once, saw ${actives.length}`);
  assert.equal(actives[0][1], '/weather');
  assert.equal(actives[0][2], 'Weather');
  // The `active` class belongs to the menu alone: a footer that also highlighted the current page
  // would double-mark it, and an unknown key must not light anything up, or every page renders a
  // plausible-looking wrong highlight.
  assert.doesNotMatch(footer, /aria-current|class="active"/, 'the footer never marks the current page');
  assert.doesNotMatch(siteHeader('no-such-page'), /aria-current/);
  assert.doesNotMatch(siteHeader(''), /aria-current/);
});

test('outbound links say so, and internal ones are not nofollowed away', () => {
  for (const l of navLinks().filter((x) => x.ext)) {
    assert.match(footer, new RegExp(`href="${l.href}" rel="noopener"`), `${l.href} needs rel=noopener in the footer`);
    assert.match(header, new RegExp(`href="${l.href}" rel="noopener"`), `${l.href} needs rel=noopener in the menu`);
  }
  assert.ok(!/rel="nofollow"/.test(footer), 'a nofollowed footer link removes a page from the crawl graph');
});

test('the legal line is a line, not a column competing for width', () => {
  const line = footer.match(/<nav class="foot-legal"[\s\S]*?<\/nav>/);
  assert.ok(line, 'the legal navigation must be present');
  assert.deepEqual(hrefsOf(line[0]), SITE_LEGAL.map((l) => l.href));
  assert.ok(!/foot-cols[\s\S]*Site<\/h3>/.test(footer), 'legal links belong on the line, not in a column');
});

test('no footer link is a dead end', async () => {
  const origin = await listen();
  const internal = [...new Set(hrefsOf(footer))].filter((h) => h.startsWith('/') && h !== '/');
  assert.ok(internal.length > 60, `the footer should still be the site map, saw ${internal.length} routes`);
  const dead = [];
  // Seven at a time: sequential, these 70 navigations take a minute and a half, and a slow test
  // file is one people skip.
  const queue = internal.slice();
  await Promise.all(Array.from({ length: 7 }, async () => {
    while (queue.length) {
      const href = queue.shift();
      // Only 404 is a broken chrome link. A 5xx here is an upstream data source being down, which
      // is a real outage but not one this file can pin, and failing the chrome on it would train
      // everyone to ignore the test.
      const res = await fetch(`${origin}${href}`, { redirect: 'manual' }).catch(() => ({ status: 0 }));
      if (res.status === 404) dead.push(href);
    }
  }));
  assert.deepEqual(dead.sort(), [], 'footer routes that no longer resolve');
});
