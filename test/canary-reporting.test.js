'use strict';
// The canary is the only monitor in this project that does not live inside the failure it
// watches, so its reporting path gets the same treatment as the watchdog classifier: pull the
// block out, run it for real against a fake `gh`, and assert what it actually does with a red
// probe. And run the probe itself against a fake edge, so "503 is a failure" is evidence and
// not a hope.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WF_TEXT = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'canary.yml'), 'utf8');
const PROBE = path.join(ROOT, 'scripts', 'public-canary.sh');

// The negative assertions below are about what the runner EXECUTES, not about what the prose
// explains — this file documents the bug it now prevents, so grep the code with comments out.
const WF_CODE = WF_TEXT.split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

// --- extracting the reporting step ---------------------------------------------------------
function runBlock(marker) {
  const start = WF_TEXT.indexOf(marker);
  assert.ok(start >= 0, `no such workflow step: ${marker}`);
  const runAt = WF_TEXT.indexOf('run: |', start);
  assert.ok(runAt > start, `${marker} has no run: | block to extract`);
  const out = [];
  for (const line of WF_TEXT.slice(runAt + 6).split('\n')) {
    if (/^\s*$/.test(line)) { out.push(''); continue; }
    if (!line.startsWith('          ')) break; // dedent to the step body's own indent
    out.push(line.slice(10));
  }
  assert.ok(out.length > 8, 'extracted an implausibly short block — the marker moved');
  return out.join('\n');
}

const REPORT = runBlock('name: Open or close the tracking issue');

// Run the reporting step with `gh` replaced by a recorder, so the assertions are about which
// API calls a given probe rc provokes.
function report(rc, existingIssue) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `canary-report-${rc || 'unset'}-`));
  const bin = path.join(dir, 'bin');
  const calls = path.join(dir, 'calls.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    `echo "$*" >> "${calls}"`,
    // `gh issue list --jq '.[0].number // empty'` — emulate an empty or a 42 result.
    `if [ "$1" = "issue" ] && [ "$2" = "list" ]; then printf '%s\\n' '${existingIssue || ''}'; fi`,
    'exit 0',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  // Deliberately verdict-free text: this file is cat'd into the issue body, and if it contained
  // the word EDGE_DOWN then the "must not claim EDGE_DOWN" assertions would pass on the fixture
  // rather than on the mapping being tested.
  fs.writeFileSync(path.join(dir, 'canary.log'), '16 checks, 5 failed, 1 skipped\nFAIL health\n');
  fs.writeFileSync(path.join(dir, 'report.sh'), REPORT);
  const child = spawnSync('bash', ['report.sh'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RC: rc, RUN_URL: 'https://run/example', GH_TOKEN: 'x' },
  });
  const log = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: child.status, out: child.stdout, calls: log };
}

// --- the workflow's own contract -----------------------------------------------------------
test('nothing in the canary workflow is allowed to swallow a failure', () => {
  // This is the bug that made the monitor useless: continue-on-error turns a step that exits 2
  // into outcome=success, and the reporting step branched on outcome. A canary that found the
  // edge down printed "canary passed" and closed its own issue.
  assert.doesNotMatch(WF_CODE, /steps\.probe\.outcome/, 'outcome lies whenever a step is allowed to fail');
  assert.doesNotMatch(WF_CODE, /continue-on-error/, 'a monitor may not opt out of its own verdict');
  assert.match(WF_CODE, /PIPESTATUS\[0\]/, 'the probe rc is behind `| tee`, so take it from the pipe');
  assert.match(WF_CODE, /steps\.probe\.outputs\.rc/, 'and the reporting step must read the recorded rc');
});

test('rc=2 — a dead edge opens the issue it used to print "canary passed" for', () => {
  const r = report('2', null);
  assert.doesNotMatch(r.out, /canary passed/, 'this is exactly the false green that hid the outage');
  assert.match(r.calls, /issue create --title canary: the public site is not healthy/);
  assert.match(r.calls, /Verdict: EDGE_DOWN/, 'and it must say the edge is down, not merely "failed"');
  assert.equal(r.status, 1, 'the run itself goes red, so the schedule is visibly broken');
});

test('rc=2 with an issue already open — comment, never duplicate, never close', () => {
  const r = report('2', '42');
  assert.match(r.calls, /issue comment 42/);
  assert.doesNotMatch(r.calls, /issue create/, 'half-hourly cron must not spam forty issues a day');
  assert.doesNotMatch(r.calls, /issue close/, 'a dead edge must never close its own tracking issue');
});

test('rc=0 closes the issue, and a lost rc counts as broken', () => {
  const green = report('0', '42');
  assert.match(green.out, /canary passed/);
  assert.match(green.calls, /issue close 42/);
  assert.equal(green.status, 0);

  const quiet = report('0', null);
  assert.doesNotMatch(quiet.calls, /issue (create|close)/, 'a passing canary stays out of the issue tracker');
  assert.equal(quiet.status, 0);

  // If the output ever fails to be recorded, the monitor must fail open towards LOUD.
  const lost = report('', null);
  assert.match(lost.calls, /issue create/, 'no rc is not a pass');
  assert.equal(lost.status, 1);
});

test('rc=3 says BLOCKED, because a refused client and a dead origin want different fixes', () => {
  const r = report('3', null);
  assert.match(r.calls, /Verdict: BLOCKED/);
  assert.doesNotMatch(r.calls, /EDGE_DOWN/, 'do not tell anyone to restart a tunnel that is fine');
  assert.equal(r.status, 1);
});

// --- the probe against a fake edge ---------------------------------------------------------
function withEdge(handler, fn) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', async () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      try {
        resolve(await fn(base));
      } catch (e) {
        reject(e);
      } finally {
        srv.close();
      }
    });
  });
}

// Async on purpose. `spawnSync` parks the event loop, which means the fake edge above cannot
// answer a single request: every curl times out to 000 and the probe reports UNREACHABLE rather
// than the 503 it is supposed to be demonstrating. A test that passes that way proves nothing.
function probe(base, dash) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [PROBE], {
      env: { ...process.env, CANARY_BASE: base, CANARY_DASHBOARD_URL: dash, CANARY_TIMEOUT: '5' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('the live fault: every path 503 is EDGE_DOWN with exit 2', () => withEdge(
  (_req, res) => { res.writeHead(503, { 'content-type': 'text/plain' }); res.end('API unavailable'); },
  async (base) => {
    const r = await probe(base, `${base}/dashboard`);
    assert.match(r.stdout, /^EDGE_DOWN/m, 'an edge that never reaches the origin must be named as such');
    assert.match(r.stdout, /FAIL\s+health/, '/health is the path that told us the apex was shadowed');
    assert.match(r.stdout, /origin-down/);
    assert.equal(r.status, 2, 'exit 2 is what the workflow maps to EDGE_DOWN');
  },
));

test('a 403 that is Cloudflare blocking US is BLOCKED with exit 3, not a fake site outage', () => withEdge(
  (_req, res) => {
    res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare', 'cf-mitigated': 'challenge' });
    res.end('Sorry, you have been blocked');
  },
  async (base) => {
    const r = await probe(base, `${base}/dashboard`);
    assert.match(r.stdout, /^BLOCKED/m, 'the edge is alive; it has simply decided not to talk to this IP');
    assert.doesNotMatch(r.stdout, /EDGE_DOWN/, 'and saying EDGE_DOWN here would send someone to restart the tunnel');
    assert.match(r.stdout, /server=cloudflare/, 'the row must name who answered');
    assert.match(r.stdout, /mitigated=challenge/);
    assert.match(r.stdout, /body=Sorry, you have been blocked/);
    assert.equal(r.status, 3, 'exit 3 is what the workflow maps to BLOCKED');
  },
));

test('a plain app 403 with no Cloudflare block shape is DEGRADED, not blame laid on the WAF', () => withEdge(
  (_req, res) => { res.writeHead(403, { server: 'cloudflare' }); res.end('Forbidden'); },
  async (base) => {
    // `server: cloudflare` is on every response on this zone, so it cannot be the evidence.
    const r = await probe(base, `${base}/dashboard`);
    assert.match(r.stdout, /^DEGRADED/m);
    assert.doesNotMatch(r.stdout, /BLOCKED/);
    assert.equal(r.status, 1);
  },
));

test('a 200 that is wrong is DEGRADED with exit 1 — not the same verdict, not the same fix', () => withEdge(
  (_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(''); },
  async (base) => {
    // All 200, all empty: the origin answered and got things wrong, which deploying can fix.
    const r = await probe(base, `${base}/dashboard`);
    assert.match(r.stdout, /^DEGRADED/m);
    assert.doesNotMatch(r.stdout, /EDGE_DOWN/, 'the two tragedies must not be conflated');
    assert.match(r.stdout, /404 is a real 404/);
    assert.equal(r.status, 1);
  },
));

test('the retired dashboard hostname failing to resolve is not reported as a site outage', () => withEdge(
  (_req, res) => { res.writeHead(200); res.end('<html>ok</html>'); },
  async (base) => {
    // Point the retired-host check at something that cannot answer at all, the way a deleted
    // DNS record does. A dead hostname must not be counted against the apex.
    const r = await probe(base, 'http://127.0.0.1:1/');
    assert.match(r.stdout, /PASS\s+dashboard hostname stays retired/);
  },
));
