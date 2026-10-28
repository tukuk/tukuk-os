'use strict';
// The CSP is a claim about every page on the site, and it is written in a place no page
// owns. On 28 Oct 2026 the claim had quietly gone false: /about, /privacy, /docs, /terms and
// /access were in CSP_STRICT_PAGES (script-src 'self', enforced) while carrying an AdSense
// loader, so the loader was blocked on every view and the pages were reporting violations
// nobody was reading. Three days of /csp-report also named two frame hosts the allowlist
// did not have (pagead2.googlesyndication.com, build.tukuk.org).
//
// So these tests do not snapshot the policy string. They re-derive it from the pages and
// from the repo: the hosts a page actually loads must be allowed, a "proven clean" page
// must still be clean, and the report-only policy must describe the policy that ships.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
const PUBLIC = path.join(ROOT, 'public');

/** The quoted strings of `const NAME = [ … ]`, with ${CSP_FRAME_SRC} expanded. */
function policy(name, frames) {
  const start = SERVER.indexOf(`const ${name} = [`);
  assert.ok(start > -1, `const ${name} = [ … ] is gone from src/server.js`);
  const end = SERVER.indexOf('].join', start);
  assert.ok(end > start, `${name} is not built with ].join() any more`);
  const block = SERVER.slice(start, end).replace(/\$\{CSP_FRAME_SRC\}/g, frames.join(' '));
  const entries = [];
  for (const m of block.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) entries.push(m[1] ?? m[2] ?? m[3]);
  // One directive per entry ("img-src 'self' data:") — the array element is the whole line.
  const map = new Map();
  for (const entry of entries) {
    const cut = entry.indexOf(' ');
    assert.ok(cut > 0, `a policy entry has no sources: ${entry}`);
    map.set(entry.slice(0, cut), entry.slice(cut + 1).trim().split(/\s+/));
  }
  return map;
}

const frameStart = SERVER.indexOf('const CSP_FRAME_SRC = [');
assert.ok(frameStart > -1, 'const CSP_FRAME_SRC = [ … ] is gone from src/server.js');
const FRAMES = [...SERVER.slice(frameStart, SERVER.indexOf('].join', frameStart)).matchAll(/'([^']+)'/g)]
  .map((m) => m[1]);
const ENFORCED = policy('CSP_ENFORCED', FRAMES);
const REPORT_ONLY = policy('CSP_REPORT_ONLY', FRAMES);
const STRICT = policy('CSP_STRICT', FRAMES);

const pageFiles = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

function strictPages() {
  const m = SERVER.match(/const CSP_STRICT_PAGES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'CSP_STRICT_PAGES is gone');
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}
const STRICT_PAGES = strictPages();

function pageSource(file) {
  return fs.readFileSync(path.join(PUBLIC, file), 'utf8');
}

function externalScriptHosts(html) {
  const hosts = new Set();
  for (const m of html.matchAll(/<script[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    hosts.add(new URL(m[1]).host);
  }
  return hosts;
}

test('the enforced policy never touches script-src or default-src', () => {
  // default-src is script-src's fallback: shipping either one here would block the inline
  // <script> blocks and the onclick/onerror handlers that every interactive page carries.
  // This single assertion is what keeps "enforce the CSP" from taking the site down.
  assert.ok(!ENFORCED.has('script-src'), "script-src is enforced — every inline script on the site is now blocked");
  assert.ok(!ENFORCED.has('default-src'), "default-src is enforced and it falls back to script-src — inline scripts are blocked");
  // …but the directives with real value are enforced.
  for (const d of ['object-src', 'base-uri', 'form-action', 'frame-ancestors', 'img-src', 'style-src', 'frame-src']) {
    assert.ok(ENFORCED.has(d), `${d} is not enforced`);
  }
  // A blocked resource has to leave a trace, or breakage is invisible until someone notices.
  assert.deepEqual(ENFORCED.get('report-uri'), ['/csp-report']);
});

test('the report-only policy describes the policy that actually ships', () => {
  // Otherwise the stream measures a policy nobody deploys: a "clean" directive in the
  // report-only header says nothing about the enforced one, and vice versa.
  for (const [directive, sources] of ENFORCED) {
    assert.ok(REPORT_ONLY.has(directive), `${directive} is enforced but missing from the report-only policy`);
    assert.deepEqual(REPORT_ONLY.get(directive), sources, `${directive} differs between enforced and report-only`);
  }
  // The one extra directive is the next step: script-src still allows inline scripts, which
  // is exactly what an "extract the inline scripts" migration has to measure first.
  assert.ok(REPORT_ONLY.has('script-src'), 'the report-only script-src allowlist is gone — nothing is measuring it');
  assert.ok(REPORT_ONLY.get('script-src').includes("'unsafe-inline'"), 'reporting inline separately would flood the journal');
});

test('every external script a page loads is in the report-only allowlist', () => {
  // Derived from the pages, so a new analytics tag cannot slip in and be blocked the day
  // script-src is enforced. Strict pages are excluded on purpose: they may load nothing.
  const missing = [];
  for (const file of pageFiles) {
    const page = file.replace(/\.html$/, '');
    if (STRICT_PAGES.has(page)) continue;
    for (const host of externalScriptHosts(pageSource(file))) {
      if (!REPORT_ONLY.get('script-src').includes(`https://${host}`)) missing.push(`${host} (public/${file})`);
    }
  }
  assert.deepEqual(missing, [], `these script hosts are not allowed by script-src: ${missing.join(', ')}`);
});

test('a page in CSP_STRICT_PAGES is still clean enough to deserve it', () => {
  // The strict policy is script-src 'self' with no unsafe-inline. A single ad or analytics
  // tag on one of these pages is a blocked request on every view — which is what happened.
  const broken = [];
  for (const page of STRICT_PAGES) {
    const file = `${page}.html`;
    if (!fs.existsSync(path.join(PUBLIC, file))) continue;
    const html = pageSource(file);
    for (const host of externalScriptHosts(html)) broken.push(`${file} loads ${host}`);
    for (const tag of ['adsbygoogle', 'clarity.ms', 'googletagmanager', 'google-analytics', 'cloudflareinsights']) {
      if (html.includes(tag)) broken.push(`${file} references ${tag}`);
    }
    if (/\son[a-z]+\s*=\s*["']/i.test(html)) broken.push(`${file} has an inline event handler`);
  }
  assert.deepEqual(broken, [], `strict pages are not clean: ${broken.join('; ')}`);
  // And the policy itself has to be the strict one.
  assert.deepEqual(STRICT.get('script-src'), ["'self'"]);
});

test('every strict page name resolves to something that exists', () => {
  // PAGE_ALIASES maps the Indonesian routes onto the same static files (tentang → about).
  // A name in the set that resolves to nothing is a typo that silently does nothing; a name
  // that resolves to an interactive page is worse — it would break its scripts.
  const aliasBlock = SERVER.match(/const PAGE_ALIASES = \{([^}]*)\}/);
  assert.ok(aliasBlock, 'PAGE_ALIASES is gone');
  const aliases = new Map([...aliasBlock[1].matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));
  const unresolved = [];
  for (const page of STRICT_PAGES) {
    const target = aliases.get(page) || page;
    if (!fs.existsSync(path.join(PUBLIC, `${target}.html`))) unresolved.push(`${page} → ${target}.html`);
  }
  assert.deepEqual(unresolved, [], `strict pages with no static file behind them: ${unresolved.join(', ')}`);
});

test('frame-src allows every host the repo actually frames', () => {
  // A blocked frame is a blank rectangle: the page looks fine, the embed is simply gone.
  const allowed = FRAMES.map((f) => f.replace(/^https:\/\//, ''));
  const hostAllowed = (host) => allowed.some((a) => (a.startsWith('*.') ? host.endsWith(a.slice(1)) : a === host));
  const framed = new Set();
  for (const file of pageFiles) {
    for (const m of pageSource(file).matchAll(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
      framed.add(new URL(m[1]).host);
    }
  }
  for (const file of fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
    const js = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    for (const m of js.matchAll(/<iframe[^>]+src=["'](https?:\/\/[^"'$]+)/gi)) framed.add(new URL(m[1]).host);
  }
  const missing = [...framed].filter((h) => !hostAllowed(h));
  assert.deepEqual(missing, [], `framed hosts missing from frame-src: ${missing.join(', ')}`);
  // The two hosts production kept reporting before the list was fixed.
  assert.ok(hostAllowed('pagead2.googlesyndication.com'), 'AdSense frames its own slots — pagead2 must be allowed');
  assert.ok(hostAllowed('build.tukuk.org'), 'the Builder preview is framed from /os');
  assert.ok(FRAMES.includes('self'), "own pages are framed by /os and /play — 'self' must be in frame-src");
});
