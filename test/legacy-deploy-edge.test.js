'use strict';
// deploy/remote-deploy.sh and deploy/purge-edge-cache.sh — the two things a deploy can
// get wrong that are not the deploy itself.
//
// remote-deploy.sh is the legacy rsync path. It still sits in the repo next to the real
// one, and it does damage in a way that cannot be seen: step 2 rsyncs the working tree
// over /opt/tukuk-os, which is a git clone, so the tree goes dirty; scripts/auto-update.sh
// merges with --ff-only and refuses to overwrite a dirty tree; the nightly timer reports
// nothing interesting and production drifts days behind main while every run looks green.
// So it is now guard-blocked rather than deleted, because the one job it does have left is
// provisioning a box that has no clone. These tests execute the refusal — the guard is the
// first executable statement in the file, so running it here cannot rsync anything, and a
// second test pins that ordering rather than assuming it — and pin the edge numbers, because
// a runbook that names the wrong TTL gets consulted by someone waiting for a stylesheet that
// is already going to refresh in five minutes.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const RSYNC = path.join(ROOT, 'deploy', 'remote-deploy.sh');
const PURGE = path.join(ROOT, 'deploy', 'purge-edge-cache.sh');
const SERVER = path.join(ROOT, 'src', 'server.js');

const rsyncSrc = fs.readFileSync(RSYNC, 'utf8');
const purgeSrc = fs.readFileSync(PURGE, 'utf8');
const serverSrc = fs.readFileSync(SERVER, 'utf8');

/** line number of the first match, for "must happen before" assertions */
function line(src, pattern, what) {
  const i = src.search(pattern);
  assert.notEqual(i, -1, `${what} is gone from ${path.basename(RSYNC)}`);
  return src.slice(0, i).split('\n').length;
}

// ── the legacy path cannot be run by accident ─────────────────────────────────────
test('the rsync deploy refuses unless it is explicitly forced', () => {
  let err = null;
  try {
    execFileSync('/bin/bash', [RSYNC], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'it must exit non-zero without TUKUK_FORCE_RSYNC_DEPLOY=1');
  assert.match(err.stderr, /REFUSING to run/);
  assert.match(err.stderr, /ship-to-box\.sh/, 'and name the script to use instead');
  assert.ok(!/1\. Creating remote directory/.test(err.stdout + err.stderr),
    'the guard must come before any step that touches a server');
});

test('the guard is the first executable statement, not just an early one', () => {
  // The order is the whole safety of the test above: if anything ran before the check,
  // executing this script in a suite would be doing I/O.
  const guard = line(rsyncSrc, /TUKUK_FORCE_RSYNC_DEPLOY:-/, 'the refusal guard');
  // anchored at column 0: the word "sshpass" also appears in the header prose, and a
  // comment mentioning a tool is not the tool being run
  const ssh = line(rsyncSrc, /^sshpass -e ss/m, 'the first sshpass invocation');
  const mkdir = line(rsyncSrc, /Creating remote directory/, 'step 1');
  assert.ok(guard < ssh, `the guard (line ${guard}) must precede sshpass (line ${ssh})`);
  assert.ok(guard < mkdir, `the guard (line ${guard}) must precede step 1 (line ${mkdir})`);
});

test('the reason for the guard is in the file, in terms of what it breaks', () => {
  // "Deprecated" alone has never stopped anyone from running a script that still works.
  // The header has to carry the mechanism — dirty tree, skipped merge, silent timer — so
  // whoever is staring at days-old production understands it without opening auto-update.sh.
  assert.match(rsyncSrc, /--ff-only/, 'it names the merge mode that refuses');
  assert.match(rsyncSrc, /chown -R/, 'and the ownership step that fights the root-owned clone');
  assert.match(rsyncSrc, /\.env/, 'and the secrets file the rsync carries over');
  assert.match(rsyncSrc, /TUKUK_FORCE_RSYNC_DEPLOY=1/, 'with the escape hatch spelled out');
});

test('no password lives in the rsync path, and none reaches ps', () => {
  // There was one: `PASSWORD="1"` plus four `sshpass -p "$PASSWORD"`, which is visible in
  // `ps` to every user on the machine and in the transcript of anyone debugging a deploy.
  assert.ok(!/PASSWORD=/.test(rsyncSrc), 'no password variable at all');
  assert.ok(!/sshpass -p/.test(rsyncSrc), 'and no -p form, which is the leak');
  // every invocation form, so a future `sshpass -p` reintroducing the leak is what fails
  const uses = rsyncSrc.split('\n').filter((l) => /^sshpass /.test(l));
  assert.ok(uses.length >= 4, `expected the four ssh call sites to still be there, found ${uses.length}`);
  for (const l of uses) assert.match(l, /^sshpass -e\b/, `every call site must read SSHPASS: ${l.trim()}`);
  assert.match(rsyncSrc, /\$\{SSHPASS:-\}/, 'with a guard for the environment it depends on');
});

// ── the edge numbers, against what the app actually sends ──────────────────────────
test('the css/js lease the runbooks quote is the lease server.js sets', () => {
  // Pinned to the source of truth rather than to a measurement, because the measurement
  // depends on which file you happen to ask about and whether the edge already holds it.
  const css = serverSrc.match(/\/\\\.\(css\|js\)\$\/[^\n]*Cache-Control', '([^']+)'/);
  assert.ok(css, 'the CSS/JS branch of the static policy is unrecognisable');
  assert.match(css[1], /s-maxage=(\d+)/, 'it must set an edge lease');
  const sMaxage = css[1].match(/s-maxage=(\d+)/)[1];
  // The stale claim this replaces was `s-maxage=3600` — an hour, superseded when the lease
  // was cut (server.js comments the reason). A runbook still quoting it sends someone to
  // purge cache that was going to expire in five minutes.
  assert.ok(!/s-maxage=3600/.test(purgeSrc.split('It used to be')[0]),
    'purge-edge-cache.sh must not present an hour lease as current policy');
  assert.ok(!/s-maxage=3600/.test(rsyncSrc), 'nor may remote-deploy.sh');
  assert.ok(!/an hour past this deploy/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'ship-to-box.sh'), 'utf8')),
    'and ship-to-box.sh must not tell the person shipping that assets linger an hour');
  assert.equal(sMaxage, '300', `server.js says ${sMaxage}; these prose checks exist to catch drift against it`);
});

test('the purge script states which failure the current token produces', () => {
  // Measured 29 Oct 2026: the VPS token verifies active, `GET /zones?name=tukuk.org` answers
  // count 0. Someone reading only "needs Zone:Cache Purge" will go add that scope to a token
  // that cannot see the zone at all and conclude the script is broken.
  assert.match(purgeSrc, /Zone:Read/, 'it must ask for the scope the id lookup needs');
  assert.match(purgeSrc, /ZERO zones|count 0/, 'and say the token on the box sees no zones');
  assert.match(purgeSrc, /not set/, 'with the other outcome — an empty key in .env — distinguished');
  assert.match(purgeSrc, /cannot see \$ZONE_NAME/, 'the failure branch exists as written');
  assert.match(purgeSrc, /nothing was purged/, 'and admits it, instead of exiting 0 on a no-op');
  // Deliberately not executed here, unlike remote-deploy.sh: on the VPS its .env does hold a
  // live token, so running it would put a real API call — and a zone id — into test output.
});
