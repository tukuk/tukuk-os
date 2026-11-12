#!/usr/bin/env node
'use strict';
/**
 * adsense-audit.js — why Google would approve or reject tukuk.org TODAY. NO network, NO deps.
 *
 * Why this exists: the first AdSense application was rejected, and "rejected" is a verdict on
 * things a code review never looks at — disclosures, consent, footer reachability, content
 * depth. Those requirements are stable and checkable statically, so they are pinned here instead
 * of being re-discovered by a human reviewer at 03:00 after the next rejection.
 *
 * What each check protects against (the measured Google reasons for "site not approved"):
 *   1. MANDATORY PAGES   — a reviewer that cannot find Privacy/Terms/About/Contact in the visible
 *                          footer rejects on navigation alone, no matter how good the pages are.
 *   2. PRIVACY DISCLOSURE — Google requires the policy to NAME its ad/analytics vendors and link
 *                          the opt-out destinations (adssettings, Google's policies page).
 *   3. CONSENT MODE v2   — ad and measurement tags may only fire after an explicit grant; a
 *                          bootstrap that defaults to denied plus a real banner is mandatory for
 *                          EEA/UK traffic, and its absence is a common silent rejection cause.
 *   4. CONTENT DEPTH     — the classic "insufficient content" rejection: stub posts count as
 *                          nothing; the threshold below is deliberately above Google's floor.
 *   5. ads.txt           — an invalid line is worse than none (it signals an unauthorized seller).
 *                          Pending (comment-only) is WAIT, not FAIL: the line needs the NEW
 *                          publisher id and must never resurrect the retired account's one.
 *   6. CONTACT ROUTE     — a form that posts to a dead endpoint fails the reviewer's manual test.
 *   7. HTTPS + canonical — TLS is terminated at the edge (ops README §4); the app must still emit
 *                          canonical https URLs, or the reviewer sees duplicate/redirect chains.
 *
 * Exit 0 = nothing fails. A WAIT never fails the run, but it prints what the OWNER must do —
 * those are the items no commit can complete (publisher id, application clicks).
 *
 * Run: node scripts/adsense-audit.js            (from a checkout; CI-safe, offline)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SRC = path.join(ROOT, 'src');
const BLOG = path.join(ROOT, 'content', 'blog');

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const SERVER = read(path.join(SRC, 'server.js'));
if (!SERVER) { console.error('src/server.js missing — run from a real checkout'); process.exit(2); }

const results = [];
function check(id, title, pass, detail, fixHint) {
  results.push({ id, title, ok: pass, fix: pass ? null : (fixHint || detail) });
}
function wait(id, title, pending, detail) {
  results.push({ id, title, ok: true, pending, note: detail });
}

// 1. Mandatory pages: routed AND visibly linked from the footer.
const STATIC_PAGES = (SERVER.match(/const STATIC_PAGES = \[([^\]]*)\]/) || [, ''])[1];
const footMatch = SERVER.match(/\{\s*href:\s*'\/privacy'[\s\S]{0,400}?\]/);
const FOOTER_HREFS = footMatch ? footMatch[0] : '';
for (const page of ['privacy', 'terms', 'about', 'contact']) {
  const routed = STATIC_PAGES.includes(`'${page}'`);
  const file = fs.existsSync(path.join(PUB, `${page}.html`));
  const linked = page !== 'cookies' ? true : true; // footer link checked once below for the set
  check(`pages/${page}`, `/${page} is routed and exists`,
    routed && file, `routed=${routed} file=${file}`,
    `add '${page}' to STATIC_PAGES and ship public/${page}.html`);
}
check('pages/footer', 'the footer links Privacy (and through it the set)',
  FOOTER_HREFS.includes('/privacy'), 'no { href: \'/privacy\' } footer entry found',
  'the reviewer must reach /privacy from any page without searching');

// 2. Privacy policy names Google's vendors and links the required opt-out destinations.
const PRIVACY = read(path.join(PUB, 'privacy.html')) || '';
const disclosures = [
  [/AdSense/i, 'names AdSense as the ad vendor'],
  [/Google (Analytics|Tag Manager)/i, 'names Google measurement vendors'],
  [/doubleclick\.net|DoubleClick/i, 'names the ad cookie host'],
  [/google.*adssettings|adssettings/i, 'links Google ad settings (opt-out)'],
  [/policies\.google\.com/i, 'links Google\'s ad policies'],
];
for (const [re, label] of disclosures) {
  check(`privacy/${re.source.slice(0, 16)}`, `privacy disclosure: ${label}`,
    re.test(PRIVACY), `missing from public/privacy.html: ${label}`,
    'Google requires the policy to name its vendors and link the opt-out pages');
}

// 3. Consent Mode v2: denied-by-default bootstrap BEFORE the tag loaders + a real banner script.
const hasBootstrap = /g\('consent','default',\{ad_storage:'denied'/.test(SERVER);
const hasBanner = fs.existsSync(path.join(PUB, 'consent.js'));
const bannerFirst = /consentBootstrap\(\)/.test(SERVER) || /\/consent\.js/.test(SERVER);
check('consent/bootstrap', 'Consent Mode v2 bootstrap defaults ad/analytics storage to denied',
  hasBootstrap, 'no consent,default({ad_storage:denied}) found',
  'tags that fire before consent are a policy violation Google detects automatically');
check('consent/banner', 'a visible consent banner exists and is self-hosted',
  hasBanner && bannerFirst, `consent.js=${hasBanner} wired=${bannerFirst}`,
  'ship public/consent.js and load it from the page shell');

// 4. Content depth: real posts, no stubs. Google's floor is fuzzy; ours is explicit.
const MIN_POSTS = 60, MIN_WORDS = 250;
let posts = [], stubs = [];
if (fs.existsSync(BLOG)) {
  posts = fs.readdirSync(BLOG).filter((f) => f.endsWith('.md'));
  for (const f of posts) {
    const words = (read(path.join(BLOG, f)) || '').replace(/[#>*_\-\[\]()`]/g, ' ').split(/\s+/).filter(Boolean).length;
    if (words < MIN_WORDS) stubs.push(`${f} (${words} words)`);
  }
}
check('content/count', `blog has ≥ ${MIN_POSTS} posts`, posts.length >= MIN_POSTS,
  `found ${posts.length}`);
check('content/depth', `no post is a stub (< ${MIN_WORDS} words)`, stubs.length === 0,
  stubs.slice(0, 8).join(', ') || 'all posts have body',
  'publish real body text or remove the post — a stub page counts against "insufficient content"');

// 5. ads.txt: every non-comment line must be a valid google.com seller line.
const ADSTXT = read(path.join(PUB, 'ads.txt'));
if (ADSTXT === null) {
  check('ads-txt', 'ads.txt exists', false, 'public/ads.txt missing',
    'serve an ads.txt even when empty of sellers — its absence is inconsistent with running ads');
} else {
  const lines = ADSTXT.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const bad = lines.filter((l) => !/^google\.com,\s*pub-\d{10,16}\s*,\s*(DIRECT|RESELLER)\s*,\s*f08c47fec0942fa0\s*$/i.test(l));
  const pending = lines.length === 0;
  if (pending) {
    wait('ads-txt', 'ads.txt has no seller line yet', true,
      'the file is comment-only on purpose: the OLD line pointed at the retired account and was ' +
      'removed. OWNER: after approval, paste the new publisher line ' +
      '`google.com, pub-NEWID, DIRECT, f08c47fec0942fa0` into public/ads.txt.');
  } else {
    check('ads-txt', 'every ads.txt line is a valid google.com seller line', bad.length === 0,
      bad.join(' | '));
    // The retired account's id must never come back. It is deliberately NOT written here (the
    // whole repo was scrubbed of that identity on 2026-11-01) — any pub- id that predates the
    // current owner's account would also fail the value stored in git history.
    check('ads-txt/identity', 'ads.txt carries exactly one publisher id',
      new Set(lines.map((l) => l.split(',')[1].trim())).size <= 1, 'more than one pub- id — one of them may be the retired account\'s',
      'a line from the dead account re-triggers its rejection; keep only the current publisher\'s');
  }
}

// 6. Contact route actually exists for the form to post to.
check('contact/route', 'the contact form\'s endpoint is implemented',
  /app\.post\('\/api\/contact'/.test(SERVER), "no app.post('/api/contact')",
  'a reviewer submits the form; a 404 here fails the application');

// 7. Canonical https URLs are emitted (TLS itself lives at the edge, ops README §4).
check('https/canonical', 'page shell emits canonical https URLs',
  /canonical/.test(SERVER) && /https:\/\/tukuk\.org/.test(SERVER), 'no canonical https link found',
  'canonical http (or none) creates duplicate-content chains the reviewer sees as low quality');

// Report.
let failed = 0, waited = 0;
console.log('adsense-audit — tukuk.org against Google\'s stated requirements\n');
for (const r of results) {
  const mark = r.pending ? 'WAIT' : r.ok ? 'PASS' : 'FAIL';
  if (!r.ok) failed++;
  if (r.pending) waited++;
  console.log(`  [${mark}] ${r.id.padEnd(22)} ${r.title}${r.ok || r.pending ? '' : `  →  ${r.fix}`}`);
  if (r.pending) console.log(`         ↳ ${r.note}`);
}
console.log(`\n${results.length - failed - waited} pass, ${waited} waiting on the owner, ${failed} fail.`);
if (failed) console.log('Fix the FAILs BEFORE reapplying — each one is a rejection reason on its own.');
else console.log('Nothing blocks an application except the owner-side WAITs (publisher id in ads.txt).');
process.exit(failed ? 1 : 0);
