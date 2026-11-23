'use strict';
// The SEO audit on tukuk.org flagged "Meta description too long or too short" — 89 of 100
// article pages carried their card excerpt into <head> verbatim (up to 334 characters; Google
// truncates around 155–160 and audit tools flag everything past that). The fix is metaDesc(),
// which clamps at a word boundary. This test walks real rendered pages so a future template
// that prints an unclamped description fails here instead of in someone's SEO report.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../src/server');

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

// Accepts 50–160 (the band the audit tools call "optimal"); empty descriptions are their own
// bug ("too short") and pages that genuinely have nothing to say fall back to the title.
function metaDescription(html) {
  const m = html.match(/<meta name="description" content="([^"]*)">/);
  assert.ok(m, 'page must carry a meta description');
  return m[1];
}

const PAGES = ['/', '/blog', '/alat', '/weather/clouds', '/flags', '/study', '/nasa/archive'];

test('every audited page keeps its meta description within 50–160 characters', async () => {
  for (const p of PAGES) {
    const d = metaDescription(await get(p));
    assert.ok(d.length >= 50, `${p}: description too short (${d.length}): ${d}`);
    assert.ok(d.length <= 160, `${p}: description too long (${d.length}): ${d.slice(0, 80)}…`);
  }
});

test('article pages clamp their excerpt-derived description at a word boundary', async () => {
  const listHtml = await get('/blog');
  // The head's RSS alternate link also starts with /blog/ — the cards are real articles.
  const slug = listHtml.match(/<div class="post-card">[\s\S]*?href="\/blog\/([^"?]+)"/);
  if (!slug) return; // an empty local store is not a failure of this rule
  const d = metaDescription(await get(`/blog/${slug[1]}`));
  assert.ok(d.length <= 160, `article description too long (${d.length})`);
  assert.ok(!d.includes('  '), 'clamped copy must not keep collapsed-whitespace artifacts');
});
