// ═══ Tests: the calculator/generator pages added to /alat (Oct 2026) ═══
// These pages are SSR strings with inline client logic, so the contract worth
// testing is the one a visitor (or a crawler) actually sees: 200, real HTML,
// the right title/JSON-LD, the interactive control IDs the script binds to,
// and — the classic SSR regression — no literal "undefined" leaking into markup.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/server');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const PAGES = [
  { path: '/alat/peratus', marker: 'Percentage Calculator', ids: ['p-mode', 'p-x', 'p-y', 'p-go', 'p-out'] },
  { path: '/alat/pinjaman', marker: 'Loan &amp; Interest Calculator', ids: ['l-p', 'l-go', 'l-out', 'c-p', 'c-go', 'c-out'] },
  { path: '/alat/qr', marker: 'QR Code Generator', ids: ['q-text', 'q-ec', 'q-size', 'q-cv', 'q-dl', 'q-mode', 'q-ssid'] },
  { path: '/alat/ip', marker: 'What Is My IP?', ids: ['i-out', 'i-copy'] },
  { path: '/alat/epoch', marker: 'Unix Timestamp Converter', ids: ['e-now', 'e-in', 'e-unit', 'e-go', 'e-local', 'e-back', 'e-zones'] },
  { path: '/alat/rawak', marker: 'Random Number, Dice &amp; List Picker', ids: ['r-min', 'r-go', 'r-out', 'd-sides', 'd-go', 'l-items', 'l-go'] }
];

for (const page of PAGES) {
  test(`GET ${page.path} renders a complete page`, async () => {
    const res = await fetch(base + page.path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.ok(html.includes(page.marker), 'hero title must be present');
    for (const id of page.ids) {
      assert.ok(html.includes(`id="${id}"`), `missing control #${id}`);
    }
    assert.ok(html.includes('"@type":"WebApplication"'), 'WebApplication JSON-LD expected');
    assert.ok(html.includes('href="/alat"'), 'must link back to the tools hub');
    assert.ok(!/\bundefined\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no literal undefined in rendered markup');
  });
}

test('every new tool is reachable from the hub and the cross-tool nav', async () => {
  const res = await fetch(base + '/alat');
  const html = await res.text();
  for (const page of PAGES) {
    assert.ok(html.includes(`href="${page.path}"`), `hub does not link ${page.path}`);
  }
  // toolsNav() is rendered on every tool page — the network of internal links
  // is what lets a visitor discover the rest without returning to the hub.
  const tool = await (await fetch(base + '/alat/peratus')).text();
  for (const page of PAGES) {
    assert.ok(tool.includes(`href="${page.path}"`), `tool nav misses ${page.path}`);
  }
});

test('sitemap.xml lists all six new tools', async () => {
  const xml = await (await fetch(base + '/sitemap.xml')).text();
  // The <loc> host follows the request host (tukuk.org in production, the test
  // listener here), so assert on the path only.
  for (const page of PAGES) {
    assert.ok(xml.includes(`${page.path}</loc>`), `sitemap misses ${page.path}`);
  }
});

// The report-only policy is the site's own measuring stick: every host a page embeds
// has to appear in it, or each view produces a violation report that says nothing new
// (production was emitting ~330 per 6 hours from exactly this drift).
test('report-only CSP covers the third parties the pages embed', async () => {
  const res = await fetch(base + '/alat/peratus');
  const reportOnly = res.headers.get('content-security-policy-report-only') || '';
  for (const host of ['https://googleads.g.doubleclick.net', 'https://www.google.com', 'https://www.clarity.ms', 'https://static.cloudflareinsights.com', 'https://unpkg.com']) {
    assert.ok(reportOnly.includes(host), `report-only CSP misses ${host}`);
  }
  // The enforced policy stays structural (no script-src) — that part is deliberate.
  const enforced = res.headers.get('content-security-policy') || '';
  assert.match(enforced, /object-src 'none'/);
  assert.ok(!enforced.includes('script-src'), 'script-src must not be enforced on interactive pages');
});
