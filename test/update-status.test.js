'use strict';
// src/update-status.js — the record scripts/auto-update.sh leaves behind.
//
// /health is public, so the important property is not "it parses" but "it can only ever
// publish a whitelisted field". A future edit that copies a raw error string into the
// file must not turn into a public path/hostname dump, so free text is dropped here and
// the shape is pinned.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const updateStatus = require('../src/update-status');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-status-'));
const file = path.join(dir, 'update-status.json');
const write = (obj) => fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a completed update is dated, describes the commit, and is not stale', () => {
  write({ at: new Date().toISOString(), ok: true, stage: 'done', from: 'b57b9a3aaaa', to: 'd8283d8bbbb', seconds: 96 });
  const s = updateStatus.read(file);
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.stage, 'done');
  assert.strictEqual(s.from, 'b57b9a3aaaa');
  assert.strictEqual(s.to, 'd8283d8bbbb');
  assert.strictEqual(s.seconds, 96);
  assert.strictEqual(s.stale, false);
  assert.ok(s.ageSeconds >= 0 && s.ageSeconds < 60);
});

test('a record older than the daily timer period is stale — silence is not health', () => {
  const old = new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString();
  write({ at: old, ok: true, stage: 'done', from: 'a', to: 'b', seconds: 10 });
  const s = updateStatus.read(file);
  assert.strictEqual(s.stale, true, '40 h with no run means the timer, not the day, is the problem');
  assert.ok(s.ageSeconds > 39 * 3600);
});

test('a wedged run stays visible: stage=fetch with ok=false reads as a failure, not a success', () => {
  write({ at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), ok: false, stage: 'fetch', from: 'abc', to: 'abc', seconds: 0 });
  const s = updateStatus.read(file);
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.stage, 'fetch');
  assert.strictEqual(s.stale, false, 'three hours is a long fetch, not yet a dead timer');
});

test('free text cannot ride out through /health', () => {
  write({
    at: new Date().toISOString(),
    ok: false,
    stage: 'fetch-failed',
    from: 'abc',
    to: 'abc',
    seconds: 600,
    message: 'fatal: could not read from /opt/tukuk-os at 10.0.0.1',
    stderr: '/opt/tukuk-os/scripts/auto-update.sh: line 44: permission denied',
  });
  const s = updateStatus.read(file);
  assert.deepStrictEqual(Object.keys(s).sort(), ['ageSeconds', 'at', 'from', 'ok', 'seconds', 'stage', 'stale', 'to']);
  assert.ok(!JSON.stringify(s).includes('/opt/'), 'no path from the box is published');
  assert.ok(!JSON.stringify(s).includes('10.0.0.1'), 'no host from the box is published');
});

test('a stage or commit that is not a token is dropped rather than echoed', () => {
  write({ at: new Date().toISOString(), ok: true, stage: 'done: /opt/x', from: '$(rm -rf /)', to: 'ok-commit' });
  const s = updateStatus.read(file);
  assert.strictEqual(s.stage, null);
  assert.strictEqual(s.from, null);
  assert.strictEqual(s.to, 'ok-commit');
});

test('never ran / unreadable / nonsense all answer null or stale, never throw', () => {
  fs.rmSync(file, { force: true });
  assert.strictEqual(updateStatus.read(file), null, 'no file = never ran, and /health says so by omission');
  write('{not json');
  assert.strictEqual(updateStatus.read(file), null);
  write('"just a string"');
  assert.strictEqual(updateStatus.read(file), null);
  write({ ok: true });
  const s = updateStatus.read(file);
  assert.strictEqual(s.at, null);
  assert.strictEqual(s.stale, true, 'a status that cannot be dated is stale by definition');
  assert.strictEqual(s.seconds, null);
});

test('the shipped script writes exactly the fields this reader expects', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'auto-update.sh'), 'utf8');
  for (const field of ['at:', 'ok:', 'stage', 'from:', 'to:', 'seconds:']) {
    assert.ok(script.includes(field), `auto-update.sh still writes ${field}`);
  }
  assert.ok(script.includes('data/update-status.json'), 'the script writes where src/update-status.js reads');
  assert.ok(/timeout \d+ git fetch/.test(script), 'the fetch is bounded — an unbounded fetch is the 31-hour wedge');
  assert.ok(script.includes('GIT_TERMINAL_PROMPT=0'), 'no credential prompt can hang a timer');
});
