'use strict';
// Tests for the diagnosis the upload scripts make when their Worker transport says "429".
//
// On this box that single status code decided whether off-site copies existed at all, and it was
// read WRONG for a week: `*.workers.dev` answering `error code: 1027` was written down as "this
// worker has no workers.dev route bound" and "the zone has a rate rule no credential can read",
// so a route was hunted that was never missing (workers/domains had `enabled: true` all along).
// 1027 is Cloudflare's PLAN-LIMIT page: Workers Free gets 100,000 requests/day for the whole
// account, resetting at 00:00 UTC. Proof was obtained by crossing the reset — 429/1027 at 23:59
// UTC, the worker's own 403 at 00:02 UTC, and all four backup tracks then landed within a minute.
//
// Two code-level facts follow, and both are easy to lose again in a refactor:
//   1. the reason must be read from the response BODY, because `curl -f` exits non-zero for every
//      4xx AND discards the body — so `-f` alone makes a spent cap look exactly like congestion;
//   2. a spent cap must NOT be slept on: 8+20+45 s of backoff cannot move a limit that only
//      midnight UTC moves, and on the ~60-object snapshot it burned half an hour per run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Every script that POSTs an archive through the backup Worker.
const TRANSPORTS = [
  'scripts/backup-data.sh',
  'scripts/backup-identity.sh',
  'scripts/snapshot-r2.sh',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

for (const rel of TRANSPORTS) {
  test(`${rel}: keeps the HTTP status and the error page, instead of letting -f eat them`, () => {
    const text = read(rel);
    // status captured with -w … and the body redirected to a file with -o
    assert.match(text, /-w '%\{http_code\}'/, 'the status code must be captured, not inferred from the exit code');
    assert.match(text, /-o "\$(RBODY|body)"/, 'the response body must be written somewhere readable');
    // the old shape — POST straight to the worker with -f and the body thrown away — must be gone
    assert.doesNotMatch(text, /curl [^"\n]*-fsS[^;]*\$\{?WURL/, '-f on the worker POST discards the 1027 page');
    assert.doesNotMatch(text, /"\$WURL\/\?key=\$[Kk][Ee][Yy]?" >\/dev\/null/, 'the POST body must not be sent to /dev/null');
  });

  test(`${rel}: names the daily free Worker request cap when it sees 1027`, () => {
    const text = read(rel);
    assert.ok(text.includes('error code: 1027'), '1027 must be detected explicitly, it is the plan-limit page');
    assert.match(text, /100,?000/, 'the message should say what the limit is');
    assert.match(text, /00:00 UTC|00:00\s?UTC/i, '…and when it resets, because that is the only fix');
  });

  test(`${rel}: decides about 1027 BEFORE it starts sleeping`, () => {
    const text = read(rel);
    const cap = text.indexOf('error code: 1027');
    const firstSleep = text.search(/\bsleep /);
    assert.ok(cap > -1, 'the cap check must exist');
    assert.ok(firstSleep === -1 || cap < firstSleep,
      'a spent cap is immune to backoff, so checking it after the first sleep wastes the run');
  });
}

test('a genuine transient is still retried — the fix must not become "give up on any 429"', () => {
  // The distinction is the whole point: congestion clears in seconds and is worth sleeping for.
  assert.match(read('scripts/backup-data.sh'), /SLEEP=45/, 'backup-data.sh must keep its backoff ladder');
  assert.match(read('scripts/backup-data.sh'), /\[\[ "\$RCODE" =~ \^2 \]\] && break/, 'and treat 2xx as success');
  assert.match(read('scripts/snapshot-r2.sh'), /sleep \$\(\(n \* 5\)\)/, 'the snapshot keeps its light backoff');
});

test('the Workers-independent track exists, because a cap day kills all four box tracks at once', () => {
  // All four timers upload through ONE worker endpoint, so one spent cap = zero off-site copies.
  // backup-laptop.sh writes to the same bucket with the wrangler OAuth token (no Worker request),
  // and it is what kept the corpus safe while the transport was being misread.
  const text = read('scripts/backup-laptop.sh');
  assert.match(text, /wrangler r2 object put "\$R2_BUCKET/, 'it must push into R2 with the OAuth token, not merely keep a local file');
  assert.ok(!/curl [^\n]*-fs?S[^\n]*\$\{?WURL/.test(text),
    'the laptop track must not depend on the Worker endpoint — that is the point of it');
});
