'use strict';
// scripts/ship-to-box.sh — the only way work gets from this laptop to production.
//
// Two transports. Normally the box fetches from GitHub itself, over the read-only deploy
// key at /root/.ssh/tukuk_deploy; then this script pushes, starts tukuk-update.service
// and reads the proof. When the box cannot reach GitHub — which is not hypothetical, the
// key disappeared from /root/.ssh sometime before 29 Oct 2026 and origin got repointed at
// a git bundle on the box's own disk — it builds, transfers, verifies and installs that
// bundle instead, and puts origin back when it is done. The incident the shape of this
// script comes from is the quiet kind: with `origin` on a bundle nobody refreshed, the
// nightly timer reported "Already up to date" for days while four commits waited on
// GitHub. A deploy that reports success and changed nothing is the failure mode worth
// testing for, so these tests pin the ordering and the refusals rather than the prose.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ship-to-box.sh');
const src = fs.readFileSync(SCRIPT, 'utf8');

/** line number of the first match, for "must happen before" assertions */
function line(pattern, what) {
  const i = src.search(pattern);
  assert.notEqual(i, -1, `${what} is gone from ship-to-box.sh`);
  return src.slice(0, i).split('\n').length;
}

test('a bad argument is refused before anything can be touched', () => {
  // This is the one path that can be executed in a test without touching the network:
  // argument parsing is the first thing in the file, so `--nope` must die there and not
  // halfway through a bundle copy.
  let err = null;
  try {
    execFileSync('/bin/bash', [SCRIPT, '--nope'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'an unknown flag must exit non-zero, not deploy anyway');
  assert.match(err.stderr, /unknown argument '--nope'/);
  assert.ok(!/\[ship\] shipping/.test(err.stdout + err.stderr), 'it must not have got as far as shipping');
});

// ── ordering: the checks are only worth anything if they run first ────────────────
test('GitHub gets the commit before the bundle is built', () => {
  // The bundle is a delivery mechanism, not a backup. Shipping first and pushing later
  // means there is a window where the only copy of production is a laptop.
  const push = line(/git push -q origin/, 'the push to origin');
  const bundle = line(/git bundle create/, 'building the bundle');
  assert.ok(push < bundle, `push (line ${push}) must precede the bundle (line ${bundle})`);
  assert.match(src, /is not on origin/, 'and the script must refuse if the push did not land');
  // The other direction matters more than a rejected push. The Actions bot commits
  // straight to GitHub every day; a bundle built from a branch that never pulled those
  // commits simply does not contain them, and a box that cannot ask GitHub what it is
  // missing never learns.
  assert.match(src, /git rev-list --count "\$BRANCH\.\.origin\/\$BRANCH"/, 'behind-ness must be counted');
  assert.match(src, /those commits never reach the box/, 'and named as the loss it is');
});

test('the transport is asked of the box, not of the README, before a bundle is built', () => {
  // Whether the box can fetch for itself decides whether 40 MB needs to move at all, and
  // the answer has to come from the machine: "the deploy key is missing" is a note in a
  // README, and notes in READMEs go stale the day someone fixes the thing.
  const probe = line(/GITHUB_OK=0/, 'the transport probe');
  const bundle = line(/git bundle create/, 'building the bundle');
  assert.ok(probe < bundle, `the probe (line ${probe}) must precede the bundle (line ${bundle})`);
  assert.match(src, /remote get-url origin/, 'by reading what origin actually is');
  assert.match(src, /git ls-remote origin HEAD/, 'and asking GitHub through it');
  assert.match(src, /if \[\[ "\$GITHUB_OK" == "0" \]\]; then/, 'the whole bundle dance lives inside that guard');
  assert.match(src, /cannot fetch from GitHub/, 'and the degraded path says so out loud');
});

test('a box left pointing at a stale bundle is the bug being prevented', () => {
  // The fallback repoints origin at the bundle so auto-update.sh can fetch it. Leaving it
  // there is what made the timer useless for days: a bundle remote always answers, and it
  // answers about the code it already has. So the restore is registered the moment the
  // repoint succeeds, on the EXIT trap, not at the end of the happy path.
  const repoint = line(/git remote set-url origin '\$BUNDLE_ON_BOX'/, 'repointing origin at the bundle');
  const trap = line(/trap 'rm -f "\$\{TMP:-\}"; restore_origin' EXIT/, 'the EXIT trap that restores origin');
  assert.ok(repoint < trap, `the restore (line ${trap}) must be armed after the repoint (line ${repoint})`);
  assert.match(src, /restore_origin\(\) \{/, 'the helper exists');
  assert.match(src, /git remote set-url origin '\$ORIGIN_WAS'/, 'and puts back what was there, not a URL copied from docs');
  assert.match(src, /COULD NOT RESTORE origin/, 'and if it cannot, that is printed with the command to run');
});

test('a privileged command with && in it runs as root entirely', () => {
  // `printf pw | sudo -S -p '' cd /opt/x && git fetch` is a precedence trap: the && binds
  // outside sudo, so the fetch runs unprivileged against a root-owned .git directory and
  // fails in a way that looks like a permissions bug. One helper, one wrapper, so no call
  // site has to think about it.
  const helper = src.split('\n').find((l) => /sudo -S/.test(l) && !/^\s*#/.test(l));
  assert.match(helper, /sudo -S -p '' bash -c/, 'the whole command string runs inside bash -c as root');
});

test('the transfer is measured and verified before the old bundle is replaced', () => {
  const bytes = line(/REMOTE_BYTES.*LOCAL_BYTES/, 'the byte-count comparison');
  const verify = line(/bundle verify '\$BUNDLE_ON_BOX\.new'/, 'verifying inside the real repo');
  const rotate = line(/mv '\$BUNDLE_ON_BOX' '\$BUNDLE_ON_BOX\.pre/, 'rotating the bundle into place');
  assert.ok(bytes < rotate, `byte count (line ${bytes}) before the swap (line ${rotate})`);
  assert.ok(verify < rotate, `in-repo verify (line ${verify}) before the swap (line ${rotate})`);
  // A truncated transfer still leaves a file, and scp is not picky about calling that
  // success; a bundle with no tip in it then fails at the merge, several steps later.
  assert.match(src, /the bundle arrived as .* bytes, expected/, 'a short transfer must be fatal');
  // and the previous bundle survives, so a bad ship is one `mv` away from being undone
  assert.match(src, /\.pre-\$SHORT/, 'the replaced bundle must be kept, not deleted');
});

test('the deploy is not believed until the box reports the shipped sha', () => {
  assert.match(src, /LIVE="\$\(box .*rev-parse HEAD/, 'HEAD on the box has to be read back');
  assert.match(src, /\[\[ "\$LIVE" == "\$SHA" \]\]/, 'and compared, not assumed');
  assert.match(src, /is at \$LIVE, not \$SHA/, 'with the disagreement printed');
  // git HEAD alone is still not the running service: the box keeps its own record of
  // every update and publishes it on /health (src/update-status.js). That record is the
  // only thing that distinguishes "merged" from "merged and restarted onto it".
  assert.ok(src.includes('grep -qF "\\"to\\":\\"$SHA\\""'), 'the /health update record must be checked too');
});

test('a server that is still booting is not reported unhealthy', () => {
  // auto-update.sh logs "done" the moment `systemctl restart` returns, and this app
  // takes a few seconds to bind 3000. The first live ship read /health three seconds
  // after that and got an empty string back — on a deploy whose own record said ok 17
  // seconds later. A warning that fires on success is worse than no warning, so both
  // post-deploy reads (journal and health) are polls with a deadline.
  assert.match(src, /HEALTH=""\nfor _ in \$\(seq 1 15\); do/, 'the health read has to be a loop');
  assert.match(src, /never answered ok in 30 s/, 'and the warning has to name the deadline it missed');
  const journal = line(/JOURNAL=""\nfor _ in \$\(seq 1 20\); do/, 'polling the journal');
  const health = line(/HEALTH=""\nfor _ in \$\(seq 1 15\); do/, 'polling /health');
  assert.ok(journal < health, 'the journal is read before health: a merge that never happened cannot be healthy');
});

test('re-shipping a sha that is already live is a no-op, not a failed deploy', () => {
  // auto-update.sh merges with --ff-only and logs "Already up to date" when there is
  // nothing to do — which contains no sha, so the journal assertion below it would kill
  // a perfectly healthy re-run. The early exit has to come before the unit is started.
  const noop = line(/the box is already at \$SHORT/, 'the already-deployed no-op');
  // the invocation, not the human advice printed by `--no-deploy` — which is a sentence
  // mentioning systemctl, and matched first when this anchor was loose
  const start = line(/rootcmd "systemctl start tukuk-update\.service"/, 'starting the update unit');
  assert.ok(noop < start, `no-op (line ${noop}) must precede the start (line ${start})`);
  // and precede the transport probe too: when the box already runs this commit there is
  // nothing to stage, so a 40 MB bundle should not be built to deliver it twice.
  const probe = line(/GITHUB_OK=0/, 'the transport probe');
  assert.ok(noop < probe, `no-op (line ${noop}) must precede the transport work (line ${probe})`);
});

// ── the two failure modes that are invisible unless you go looking ────────────────
test('shipped means reachable at tukuk.org, not merely listening on the box', () => {
  // Every other read in this script goes through ssh to 127.0.0.1:3000. The public site is
  // that app reached through the Cloudflare tunnel, so a green loopback check and a 530 at
  // the edge can happen in the same minute — the connector, not the app, is the thing down.
  // The edge read therefore has to come AFTER the loopback one (a merge that never happened
  // is not a routing problem) and must not be fatal (the deploy is already a fact by then).
  const loopback = line(/HEALTH=""\nfor _ in \$\(seq 1 15\); do/, 'polling /health on the box');
  const edge = line(/EDGE=""\nfor _ in \$\(seq 1 15\); do/, 'polling /health through the edge');
  assert.ok(loopback < edge, `the loopback read (line ${loopback}) must come first, so the edge warning means routing`);
  assert.match(src, /curl -s --max-time 15 "https:\/\/\$ZONE\/health"/, 'the edge read is https, from this machine, not from the box');
  assert.match(src, /never answered ok from this machine/, 'a dead tunnel is named as a routing failure');
  assert.match(src, /systemctl status cloudflared/, 'and the thing to check is printed');
  assert.ok(!/die .*cloudflared/.test(src), 'but it stays a warning: the app being deployed is decided on the box');
});

test('an untracked file on the box is caught before the merge, not in its aftermath', () => {
  // A newly tracked path that already exists untracked on the box makes `merge --ff-only`
  // refuse the WHOLE update, and the nightly timer dies with it and says nothing.
  assert.match(src, /--diff-filter=A "\$ONBOX"/, 'the diff has to be against what the box runs');
  assert.match(src, /--untracked-files=all/, 'and untracked directories must be expanded to files');
  assert.ok(!/@\{1\}/.test(src), 'the reflog is not a deploy baseline: it is empty the day after a commit');
});

test('the box cannot hold a commit that main does not', () => {
  // Hot-patching /opt/tukuk-os by hand is how that happens, and --ff-only is where it
  // surfaces — as a journal nobody reads. Check it while there is still nothing to undo.
  assert.match(src, /merge-base --is-ancestor "\$ONBOX" "\$SHA"/, 'the ancestor test must run');
  assert.match(src, /would refuse; reconcile/, 'and the refusal has to say what to do');
});

test('the sudo password is read on the box and never becomes this machine\'s business', () => {
  // Not hygiene as decoration: the password file lives at 0600 on the VPS, and the
  // moment a script takes it as an argument it is in `ps`, in shell history, and in the
  // scp line of a log file. Everything here goes through one helper.
  assert.match(src, /PWFILE="\/home\/tukuk\/\.ssh\/initial-password\.txt"/, 'the path is on the box');
  const rootcalls = src.split('\n').filter((l) => /sudo -S/.test(l) && !/^\s*#/.test(l));
  assert.equal(rootcalls.length, 1, `sudo must appear in exactly one helper, found ${rootcalls.length}`);
  assert.match(rootcalls[0], /\$\(cat '\$PWFILE'\)/, 'inside a string expanded by the REMOTE shell');
  assert.match(src, /rootcmd /, 'and every privileged command goes through it');
  // The shape this started with was `PW=$(cat …); printf "$PW" | sudo -S` written twice.
  // A variable that only exists inside a quoted ssh string is an unbound read as far as
  // this repo is concerned — and the scan is not pedantry, it is what keeps a secret out
  // of `ps`, shell history and the transcript of whoever debugs the deploy tomorrow.
  assert.ok(!/^PW=/m.test(src), 'no local variable may hold the password');
  assert.ok(!/echo ["']?\$\{?PW/.test(src), 'and nothing may print it');
});
