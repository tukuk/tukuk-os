'use strict';
// The owner's way into the server — and the guard against ever optimising it away.
//
// Cockpit is not a convenience here, it is the management plane: the owner logs into the box
// through https://<lan-ip>:9090. On 2026-10-31 deploy/lighten-server.sh switched it off while
// annotating it "unused", and on 2026-11-01 the script whose only job is to notice that
// (scripts/selfheal-access.sh) reported "no cockpit.socket unit found" on a box where it was
// installed, enabled and listening — because `systemctl list-unit-files | grep -q` returns 141
// from SIGPIPE under `set -o pipefail` even when the pattern MATCHES, so the then-branch with the
// enable/start calls never ran and the else-branch only warned.
//
// So this file does two things: proves the shell primitive is broken, and pins the two rules that
// follow from the incidents — nothing may disable the console, and something must check it answers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SELFHEAL = read('scripts/selfheal-access.sh');
const WATCHDOG = read('scripts/watchdog.sh');
const LIGHTEN = read('deploy/lighten-server.sh');

// ---------------------------------------------------------------------------
// 1. the primitive itself, measured rather than argued about.
// ---------------------------------------------------------------------------
test('a large producer piped into `grep -q` really does return SIGPIPE under pipefail', () => {
  // Match on the FIRST line and then emit ~1 MB: grep leaves immediately, the writer is still
  // blocked on a full pipe, and EPIPE kills it. `if …; then` therefore takes the ELSE branch while
  // the pattern is present — the exact shape of the bug that hid the owner's console.
  const PIPE =
    "awk 'BEGIN{print \"cockpit.socket\"; for (i = 0; i < 20000; i++) printf \"%04d padpadpadpadpadpadpadpadpadpad\\n\", i}'" +
    ' | grep -qE "^cockpit\\.socket"';
  const run = (pipeline) =>
    execFileSync('/bin/bash', ['-c', `set -uo pipefail; ${pipeline}; echo $?`]).toString().trim();

  assert.equal(run(PIPE), '141',
    'the assumption this file is built on has changed — re-measure before editing the scripts');
  // The correct form, measured right next to it: same match, writer runs to completion, rc 0.
  assert.equal(run(PIPE.replace('grep -qE', 'grep -E') + ' >/dev/null'), '0');
  // And the primitive the scripts now use answers without a pipeline at all.
  assert.equal(run('systemctl cat cockpit.socket >/dev/null 2>&1 || true'), '0');
});

test('the access monitor no longer asks systemd a question with a broken primitive', () => {
  // Comments in these scripts RECORD the broken form on purpose, so the guard reads code only.
  const code = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const SELFHEAL_CODE = code(SELFHEAL);
  assert.ok(
    !/list-unit-files[^|]*\|\s*grep\s+-q/.test(SELFHEAL_CODE),
    'selfheal-access.sh is back to `list-unit-files | grep -q` — it will report installed units as missing',
  );
  assert.match(SELFHEAL_CODE, /has_unit\(\)\s*\{\s*systemctl cat/, 'existence must be tested with systemctl cat');
  assert.match(SELFHEAL_CODE, /has_unit cockpit\.socket/);
  // Socket activation is this box's real sshd setup (ssh.socket enabled, ssh.service disabled).
  assert.match(SELFHEAL_CODE, /ssh\.socket/, 'must not force-enable ssh.service on a socket-activated box');
});

// ---------------------------------------------------------------------------
// 2. cockpit is off-limits for lightening, and watched as health.
// ---------------------------------------------------------------------------
test('nothing on this box is allowed to switch the console off', () => {
  // The UNITS assignment, not the whole file: the file documents cockpit.socket in prose and those
  // mentions are the point — a reader has to learn why it is spared.
  const units = LIGHTEN.match(/^UNITS="([^"]*)"/m);
  assert.ok(units, 'lighten-server.sh must keep a single quoted UNITS line for this guard to read');
  assert.ok(
    !/\bcockpit\b/.test(units[1]),
    'cockpit.socket is on the switch-off list again — the owner loses https://<lan-ip>:9090',
  );
  assert.match(LIGHTEN, /for k in[^;]*cockpit\.socket/, 'and it must appear in the DELIBERATELY KEPT report');
});

test('the console is checked by answering, not by existing', () => {
  // A listening fd is not a reachable console: cockpit.socket can hold a tunnel address no client
  // can route to. Both monitors must ask for the LOGIN PAGE, which answers 200 unauthenticated.
  // `/cockpit/login` is the package endpoint and answers 401 — checking that would pass on a
  // console whose login page cannot be opened.
  assert.match(WATCHDOG, /https:\/\/127\.0\.0\.1:9090\/login/, 'watchdog must probe the console every cycle');
  assert.match(SELFHEAL, /:9090\/login/, 'selfheal must verify each bound address actually answers');
  // And it must be re-ENABLED, not merely started — a running-but-disabled unit dies on the reboot
  // that will need it.
  assert.match(SELFHEAL, /systemctl enable cockpit\.socket/);
  // No `grep -q` in the watchdog's access block either (same SIGPIPE class, different file).
  const accessBlock = WATCHDOG.slice(WATCHDOG.indexOf('ACCESS_STAMP='), WATCHDOG.indexOf('if ! systemctl is-active --quiet "$MEILI"'));
  assert.ok(accessBlock.length > 200, 'the access check moved out of the watchdog — update this guard');
  assert.ok(!/grep\s+-q/.test(accessBlock), 'the watchdog access check uses grep -q again');
});
