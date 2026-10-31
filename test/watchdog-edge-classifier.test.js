'use strict';
// Pull scripts/watchdog.sh's edge classifier out and run it for real, the way the
// systemd unit does, so a pattern bug cannot hide.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'watchdog.sh'), 'utf8');
const start = SRC.indexOf('bump()');
const stop = SRC.indexOf('\nesac', SRC.indexOf('case "$CODE" in'));
assert.ok(start >= 0 && stop > start, 'could not find the classifier block');
const BLOCK = SRC.slice(start, stop + 5);

function classify(code, prev) {
  const file = path.join(os.tmpdir(), `wd-classify-${code}-${Date.now()}-${Math.random()}.sh`);
  fs.writeFileSync(file, [
    'set -uo pipefail',
    // stdout stays reserved for the verdict; the harness's log goes to stderr exactly as
    // `logger` does in the real unit, and both streams are captured for the assertions.
    'log() { echo "LOGGED $*" >&2; }',
    'PUB=https://x/y',
    `PUB_STAMP=${JSON.stringify(path.join(os.tmpdir(), `wd-stamp-${Date.now()}-${Math.random()}`))}`,
    'CODE=' + code,
    `PREV=${JSON.stringify(prev)}`,
    BLOCK,
    'cat "$PUB_STAMP" 2>/dev/null || echo RECOVERED',
    'rm -f "$PUB_STAMP"',
    '',
  ].join('\n'));
  try {
    // stdout = what the branch wrote into its stamp (or RECOVERED for the healthy path);
    // the classifier must never die, so a non-zero exit is a test failure, not a verdict.
    const child = require('node:child_process').spawnSync('bash', [file], { encoding: 'utf8' });
    assert.equal(child.status, 0, `the classifier exited ${child.status} — stderr: ${child.stderr}`);
    return { stamp: child.stdout.trim(), log: child.stderr };
  } finally {
    fs.unlinkSync(file);
  }
}

test('a 530/503 from the edge is NOT read as healthy', () => {
  assert.equal(classify('200', 'err:3').stamp, 'RECOVERED', 'a real 2xx clears a bad streak');
  assert.equal(classify('204', 'ok').stamp, 'RECOVERED', 'no stamp to clear, nothing logged');
  for (const dead of ['530', '503', '502', '522', '403', '301', '404']) {
    assert.match(classify(dead, 'ok').stamp, /^err:1$/, `${dead} must count as a bad edge, never as recovered`);
  }
  // A code that is not three digits, or is 2 followed by junk, is the reason `2??` was never
  // a digit class: only a real 2xx may clear the streak.
  assert.match(classify('2xx', 'ok').stamp, /^err:1$/, 'a non-numeric 2-code is not health');
});

test('the old `2??` pattern is a wrong way to write 2xx, but it was NOT the silence', () => {
  assert.doesNotMatch(SRC, /case "\$CODE" in[\s\S]{0,120}?2\?\?\)/,
    '2?? means "a 2 then ANY two characters", not 2xx — spell the digits out');
  assert.doesNotMatch(SRC, /case "\$ACODE" in[\s\S]{0,120}?2\?\?\)/, 'same pattern, same defect, second probe');
  assert.match(SRC, /2\[0-9\]\[0-9\]\)/, 'match the digits explicitly');
  // Pinned so nobody re-tells this wrong: `?` matches exactly one character and curl's
  // %{http_code} is always three digits, so a 5xx never started with "2" and fell through to
  // the `*)` branch — where the `${N:-0}` counter below killed the script before it could log.
  const old = 'set -u\ncase "530" in 2??) echo healthy ;; *) echo err ;; esac';
  assert.equal(execFileSync('bash', ['-c', old], { encoding: 'utf8' }).trim(), 'err',
    '530 reached the error branch all along; attributing the outage to this pattern hides the real bug');
});

test('the counter survives a non-numeric previous value, which ${N:-0} did not', () => {
  // `${N:-0}` only fires for unset-or-empty. With no stamp file PREV is the literal "ok",
  // the prefix strip matches nothing, N is SET to "ok" — and `$(( ok + 1 ))` looks up an
  // unset identifier inside arithmetic, which `set -u` makes fatal. That is the exact
  // "ok: unbound variable" the box logged every two minutes on 31 Oct 2026.
  assert.equal(classify('530', 'err:7').stamp, 'err:8', 'a numeric stamp keeps counting');
  assert.equal(classify('429', 'garbage').stamp, '429:1', 'a corrupt stamp restarts the count instead of dying');
  assert.equal(classify('000', '').stamp, '000:1', 'an empty stamp is attempt 1');
  assert.doesNotMatch(BLOCK, /N=\$\(\( \$\{N:-0\} \+ 1 \)\)/, 'the old guard is the crash, not the fix');
  assert.match(SRC, /^bump\(\) \{/m, 'one helper owns the counter, so no branch can reintroduce it');
});

test('the crash reproduced with the old form, with the very message from the journal', () => {
  const old = 'set -uo pipefail\nPREV=ok\nN=${PREV#err:}\nN=$(( ${N:-0} + 1 ))\necho "survived $N"';
  let crashed = false;
  let message = '';
  try {
    execFileSync('bash', ['-c', old], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    crashed = true;
    message = String(e.stderr || e.message);
  }
  assert.equal(crashed, true, 'the ${N:-0} form MUST fail on PREV="ok" — that is the bug being pinned');
  assert.match(message, /ok: unbound variable/, 'and with exactly what journalctl showed on the box');
});

test('a bad edge is LOUD in the log, because the local :3000 check cannot see it', () => {
  const r = classify('503', 'ok');
  assert.match(r.log, /Public edge answered HTTP 503/, 'name the code and the URL');
  assert.match(r.log, /workers\/routes/, 'and point at the one API that proves a Worker owns the apex');
  assert.match(classify('530', 'err:14').log, /attempt 15/, 'every 15th ≈ 30 min, so a long outage keeps saying it');
});

test('the unit does not need `-e`, so a false test in a log branch cannot fail it', () => {
  // `[ a ] || [ b ] && log ...` returns 1 when both tests are false. That is harmless only
  // because the unit is Type=oneshot with a plain `set -uo pipefail` — no `set -e`. If anyone
  // adds -e, every 16th edge probe becomes a red unit again, so pin the assumption.
  const unit = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'tukuk-os-watchdog.service'), 'utf8');
  assert.doesNotMatch(unit, /ExecStart=.*bash -e/, 'no -e on the interpreter');
  assert.doesNotMatch(SRC.slice(0, SRC.indexOf('\n', SRC.indexOf('set -uo pipefail')) + 1), /set -[a-z]*e/,
    'and the script itself must not enable errexit — its log branches return false by design');
});
