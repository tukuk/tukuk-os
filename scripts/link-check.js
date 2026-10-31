#!/usr/bin/env node
'use strict';
/**
 * link-check.js — static internal-link integrity for tukuk.org. NO network, NO server, NO deps.
 *
 * Why this exists: the site is ~1 300 hand-rolled page modules emitting HTML strings, and the only
 * thing that noticed a dead internal link was a visitor (or a search engine down-ranking us). A
 * renamed route or a deleted public/ file leaves literal `href="/old/path"` strings scattered
 * across modules, and nothing in the test suite renders them all. This does, statically:
 *
 *   1. Collect the route table: every app.get/app.post/... literal path across src/*.js,
 *      Express `:param` and `*` segments turned into regexes.
 *   2. Collect public/ as a filesystem route table: any static path (or its index.html) exists.
 *   3. Collect every LITERAL internal link (href="/…" and src="/…" without ${…} or ' + "
 *      concatenation) from all files under src/.
 *   4. A link is broken when it matches no route, no public/ file, and no explicit allowlist
 *      entry (forms posted to handlers, links built with a helper prefix, etc.).
 *
 * Exit 1 prints every finding as `file:line /target` so GitHub annotations point at the exact
 * line to fix. A new legitimately-dynamic target belongs in ALLOWED below — the list is
 * reviewed in CI, not silently skipped.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const PUB = path.join(ROOT, 'public');

// Links that are correct but not statically resolvable: form actions handled by app.post with a
// body (matched by step 1 usually), and a few targets built by helpers. Each entry needs a
// reason — an allowlist without reasons rots into a mute button.
const ALLOWED = new Map([
  // ['/example', 'served by an external edge service'],
]);

function* walk(dir, pattern) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, pattern);
    else if (pattern.test(e.name)) yield p;
  }
}

// ---- 1. route table ----
const ROUTE_RE = /\.(get|post|put|delete|all|use)\(\s*['"`](\/[^'"`]*)['"`]/g;
// Second dialect: table-registered routes — `[['/alat/qr', qrPage], ...].forEach(e => app.get(e[0], ...))`
// mounts paths from array literals, invisible to the call-site regex (found by the first CI run).
const TABLE_ROUTE_RE = /\[\s*['"`](\/[\w/:.*-]+)['"`]\s*,/g;
const routes = [];
function addRoute(p) {
  if (routes.includes(p)) return;
  routes.push(p);
}
for (const file of walk(SRC, /\.js$/)) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = ROUTE_RE.exec(src))) {
    // Skip helper-internal strings like .get('key') by requiring a plausible URL shape.
    const p = m[2];
    if (/^\/[\w/:.*-]*$/.test(p) && p.length > 1 && !/\s/.test(p)) addRoute(p);
    else if (p === '/') addRoute(p);
  }
  while ((m = TABLE_ROUTE_RE.exec(src))) addRoute(m[1]);
}
// Routes can also be mounted with a prefix variable (`app.use(base, router)` etc.); the literal
// patterns above plus the catch-alls below cover the current server. `:param` → one segment,
// `*` / trailing wildcard → anything.
function routeToRegex(p) {
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '\\/.*' : '\\' + c));
  return new RegExp('^' + esc.replace(/\/:[\w-]+/g, '/[^/]+') + '/?$');
}
const routeRes = routes.map(routeToRegex);

// ---- 2. public/ as static targets ----
const publicFiles = new Set();
if (fs.existsSync(PUB)) {
  for (const file of walk(PUB, /.*/)) {
    const rel = '/' + path.relative(PUB, file).split(path.sep).join('/');
    publicFiles.add(rel);
  }
}
function isStatic(target) {
  if (publicFiles.has(target)) return true;
  if (publicFiles.has(target + '/index.html')) return true;
  if (publicFiles.has(target.replace(/\//g, '/') + '.html')) return true;
  // Express static also serves /vendor/jquery.js from public/vendor/... — covered by has().
  return false;
}

// ---- 3. literal internal links ----
const LINK_RE = /(?:href|src|action)=["'](\/[^"'`]*)["']/g;
const findings = [];
const seen = new Set();
function resolves(targetRaw) {
  const target = targetRaw.split('?')[0].split('#')[0];
  if (!target || target === '/' || target === '#') return true;
  if (isStatic(target)) return true;
  for (let i = 0; i < routes.length; i++) {
    if (routeRes[i].test(target)) return true;
  }
  // Express params match one segment; a link with MORE segments than the pattern is only OK if
  // some route ends in a wildcard — already handled by the '*' regex above.
  return false;
}
for (const file of walk(SRC, /\.js$/)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    let m;
    while ((m = LINK_RE.exec(line))) {
      const target = m[1];
      // Dynamic-but-quoted remnants ("/${x}") and pure noise: skip anything with interpolation
      // markers or spaces; this checker only ever judges LITERAL strings.
      if (target.includes('${') || /\s/.test(target) || target.startsWith('//')) continue;
      const key = path.relative(ROOT, file) + ' ' + target;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!resolves(target) && !ALLOWED.has(target)) {
        findings.push(`${path.relative(ROOT, file)}:${idx + 1} ${target}`);
      }
    }
    LINK_RE.lastIndex = 0;
  });
}

console.log(`link-check: ${routes.length} routes, ${publicFiles.size} public files, ${seen.size} literal links checked`);
if (findings.length) {
  console.error(`BROKEN INTERNAL LINKS (${findings.length}):`);
  findings.forEach((f) => console.error('  ' + f));
  process.exit(1);
}
console.log('link-check: every literal internal link resolves');
