'use strict';
// edge-connect.js — the public-surface CONTRACT, checked from outside the box.
//
// The canary (scripts/public-canary.sh, every 30 min) answers "is tukuk.org up?".
// This answers the different question "is tukuk.org still the thing we built?":
//   • robots.txt must exist and advertise the sitemap — crawlers are the entire
//     distribution plan for /books and the daily feeds;
//   • the sitemap must actually list the books cluster (a regression that ships
//     an index without /books silently deindexes 878 shelves);
//   • a real shelf page must return 200, and an invented one must return 404 —
//     the 404 behaviour was proven correct in the 2 Nov audit (crawler-invented
//     /books/* urls), and it is exactly the thing a future refactor would
//     "helpfully" turn into a soft 200;
//   • HTML must arrive gzipped and with HSTS, because the whole project rule is
//     a light fast server, and that rule is easy to break with one well-meaning
//     middleware change.
//
// Exit codes, deliberately mirroring the canary's semantics so the workflow's
// issue logic can stay the shape it already has:
//   0 contract holds · 1 contract broken · 3 the edge is challenging this
//   client (blind monitor — NOT a verdict, the same way BLOCKED is green for
//   the canary: GitHub runner IPs get cf-mitigated:challenge on this zone while
//   real visitors see nothing).
// No secrets, no server access: everything here is observable from the public
// internet, which is also what makes it safe to run on GitHub's machines.
process.on('unhandledRejection', (err) => {
  console.error('[edge-connect] unhandled rejection:', err);
  process.exit(1);
});

const BASE = process.env.CANARY_BASE || 'https://tukuk.org';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) tukuk.org-edge-connect/1.0 (contract check)';

async function get(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, {
    redirect: 'manual',
    headers: { 'user-agent': UA, 'accept-encoding': 'gzip, br', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  return res;
}

// The one page that proves this runner can see anything at all: Cloudflare's
// interstitial is HTML with this marker and a 403, whatever the URL.
function challenged(res, body) {
  return res.status === 403
    && (/cf-mitigated/i.test(res.headers.get('server') || '')
      || /just a moment/i.test(String(body).slice(0, 2000)));
}

const failures = [];
function check(name, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}

async function main() {
  console.log(`[edge-connect] checking ${BASE}`);

  // 1. DNS — before anything TLS-ish; a NXDOMAIN here means the zone moved or the
  // record was deleted, which no in-app test can ever see.
  const { lookup } = require('node:dns/promises');
  const host = new URL(BASE).hostname;
  try {
    const addrs = await lookup(host, { all: true });
    check(`dns: ${host} resolves`, addrs.length > 0, 'no addresses');
    if (addrs.length === 0) process.exit(1);
  } catch (e) {
    console.log(`FAIL dns: ${host} does not resolve — ${e.message}`);
    process.exit(1); // nothing below is meaningful without names
  }

  // 2. robots.txt — 200 and it points at a sitemap.
  let res = await get('/robots.txt');
  let body = await res.text();
  if (challenged(res, body)) { console.log('[edge-connect] the edge is challenging this runner — blind'); process.exit(3); }
  check('robots.txt is 200', res.status === 200, `got ${res.status}`);
  check('robots.txt advertises the sitemap', /sitemap/i.test(body), 'no Sitemap: line');

  // 3. sitemap — present, parseable enough to count <loc>, and it carries the
  // books cluster. The floor is a tripwire against "index shipped, empty".
  res = await get('/sitemap.xml');
  body = await res.text();
  check('sitemap.xml is 200', res.status === 200, `got ${res.status}`);
  const locs = (body.match(/<loc>/g) || []).length;
  check('sitemap lists a substantial site', locs >= 100, `only ${locs} <loc> entries`);
  check('sitemap includes /books/', /\/books\//.test(body), 'the books cluster is not in the index');

  // 4. a real shelf answers. Which slug is checked rotates by day so a whole
  // catalogue eventually sees the light without needing 878 requests.
  const { SUBJECTS } = require('../src/books.js');
  const day = Math.floor(Date.now() / 86400000);
  const s = SUBJECTS[day % SUBJECTS.length];
  res = await get(`/books/${s.slug}`);
  body = await res.text();
  check(`shelf /books/${s.slug} is 200`, res.status === 200, `got ${res.status}`);
  check('the shelf page is html', /text\/html/.test(res.headers.get('content-type') || ''),
    res.headers.get('content-type'));

  // 5. an invented shelf must be a real 404 (audited 2 Nov: correct behaviour,
  // keep it correct).
  res = await get('/books/definitely-not-a-shelf-9k9x');
  check('invented /books/ url is 404', res.status === 404, `got ${res.status}`);

  // 6. the light-server promises on the homepage: gzip-or-br on html, and HSTS.
  res = await get('/');
  body = await res.text();
  check('homepage is 200', res.status === 200, `got ${res.status}`);
  const enc = res.headers.get('content-encoding') || '';
  check('html is compressed at the edge', /gzip|br|zstd/.test(enc), `content-encoding: "${enc}"`);
  check('HSTS is set', /max-age=\d{6,}/i.test(res.headers.get('strict-transport-security') || ''),
    `strict-transport-security: "${res.headers.get('strict-transport-security')}"`);

  // 7. /health answers even when degraded (that was a deliberate design choice:
  // the degraded 503 still reports the benefits counter). 200 or 503 are both
  // "the app is talking"; anything else means the health route changed shape.
  res = await get('/health');
  check('health endpoint answers', res.status === 200 || res.status === 503, `got ${res.status}`);

  // 8. the off-site backup, watched from outside. The nightly drive-backup.timer
  // writes data/backup-last.json and /health publishes its age; this is the only
  // honest way a GitHub-hosted pipeline covers "backup" — it never holds a key to
  // the box, it just refuses to let silence pass for success.
  // Phases, because the human Drive-share step is genuinely pending: no state file
  // or a DRY state (the installer proved the archives but uploaded nothing) is a
  // NOTE; once a real run has happened the lane tightens itself forever after —
  // failed, still-dry-after-a-real-run, or >30h-old becomes a contract break. The
  // whole point of a backup is that someone outside the burning building has the
  // last copy, and "it worked in November" is not that promise.
  try {
    const h = JSON.parse(await res.text());
    const b = h.backup || {};
    if (!b.configured || b.dry) {
      console.log('  note off-site backup not yet proven from this box (only a dry archive run so far) — enforcement starts after the first real upload');
    } else {
      check('off-site backup ran and succeeded', b.ok === true, `ok=${b.ok}`);
      check('off-site backup is fresh', b.ageHours != null && b.ageHours <= 30, `ageHours=${b.ageHours}`);
    }
  } catch (e) {
    check('health reports parseable json', false, e.message);
  }

  console.log(`[edge-connect] ${failures.length ? `CONTRACT BROKEN: ${failures.join(' · ')}` : 'contract holds'}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[edge-connect] crashed:', (err && err.message) || err);
  process.exit(1);
});
