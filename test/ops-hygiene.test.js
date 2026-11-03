// Ops hygiene: the devops layer checked by the same `npm test` that gates every push.
//
// The repo carries agent config (kilo.json), systemd units (deploy/*), and CI
// workflow files (.github/workflows/*) — none of which any linter ever looked at
// before this file existed. The bug classes here are the boring fatal ones:
//   • a unit file pointing at a script that was renamed and never committed —
//     systemd fails at 05:20 with "status=203/EXEC", which nobody sees until the
//     backup it was supposed to run turns out not to have run for two weeks;
//   • a workflow calling `bash scripts/whatever.sh` from a machine that only has
//     this repo — red at the worst possible time (the canary lane itself);
//   • a .timer without [Install] WantedBy=timers.target: `systemctl enable`
//     enables nothing, and the install script still prints "timer enabled".
// Everything here is a repo fact checkable with fs — no network, no server.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function filesIn(dir, re) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => re.test(f))
    .map((f) => `${dir}/${f}`);
}

// ── agent configuration ──────────────────────────────────────────────────────
test('kilo.json parses and keeps the shape the agents depend on', () => {
  const kilo = JSON.parse(read('kilo.json'));
  assert.ok(kilo.$schema, 'kilo.json must declare its $schema');
  assert.ok(kilo.cloudflare && kilo.cloudflare.url, 'the cloudflare MCP block must keep its url');
  for (const [name, agent] of Object.entries(kilo.agents || {})) {
    assert.ok(Array.isArray(agent.tools) && agent.tools.length > 0, `agent ${name} has no tools`);
    assert.ok(agent.description, `agent ${name} has no description`);
  }
  for (const [name, cmd] of Object.entries(kilo.commands || {})) {
    assert.ok(cmd.description, `command ${name} has no description`);
  }
});

// ── systemd units ────────────────────────────────────────────────────────────
test('every .service we ship is structurally sound', () => {
  for (const rel of filesIn('deploy', /\.service$/)) {
    const text = read(rel);
    assert.ok(/^\[Unit\]/m.test(text), `${rel}: no [Unit] section`);
    assert.ok(/^\[Service\]/m.test(text), `${rel}: no [Service] section`);
    const execs = text.match(/^ExecStart=/gm) || [];
    assert.strictEqual(execs.length, 1, `${rel}: exactly one ExecStart expected, found ${execs.length}`);
  }
});

test('every .timer fires on a schedule and is actually enable-able', () => {
  for (const rel of filesIn('deploy', /\.timer$/)) {
    const text = read(rel);
    // OnCalendar, or one of the On*Sec forms — a timer with none of these never runs.
    assert.ok(/^(OnCalendar|OnBootSec|OnUnitActiveSec|OnUnitInactiveSec)=/m.test(text),
      `${rel}: no scheduling directive`);
    assert.ok(/^\[Install\]/m.test(text), `${rel}: no [Install] — enable would enable nothing`);
    assert.ok(/WantedBy=timers\.target/m.test(text), `${rel}: [Install] must pull timers.target`);
  }
});

test('unit files only point at repo files that exist', () => {
  // Tokens like /opt/tukuk-os/scripts/drive-backup.js in an ExecStart are a
  // promise that the checkout on the box contains that file. Renaming a script
  // without updating the unit used to be discoverable only at 05:20 the next
  // morning, by which time the real subject is "why is there no backup".
  const seen = [];
  for (const rel of filesIn('deploy', /\.service$/)) {
    const text = read(rel);
    for (const m of text.matchAll(/\/opt\/tukuk-os\/([\w./-]+\.(?:js|sh|py))/g)) {
      const target = m[1];
      seen.push(`${rel} -> ${target}`);
      assert.ok(fs.existsSync(path.join(ROOT, target)),
        `${rel}: ExecStart references ${target}, which is not in the repo`);
    }
  }
  // The scan must not be vacuous: if a refactor ever renames the checkout path
  // itself, an empty pass here would silently disable this whole test.
  assert.ok(seen.length > 5, `expected the units to reference repo scripts, saw ${seen.length}`);
});

// ── CI workflow files ────────────────────────────────────────────────────────
test('every script a workflow invokes is committed to the repo', () => {
  const workflowDir = path.join(ROOT, '.github', 'workflows');
  let checked = 0;
  for (const f of fs.readdirSync(workflowDir).filter((n) => n.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(workflowDir, f), 'utf8');
    for (const m of text.matchAll(/(?:^|\s|\/)((?:scripts|deploy|test)\/[\w./-]+\.(?:js|sh))/g)) {
      checked++;
      assert.ok(fs.existsSync(path.join(ROOT, m[1])),
        `.github/workflows/${f}: references ${m[1]}, which is not in the repo`);
    }
  }
  assert.ok(checked > 0, 'the scan found no script references at all — it has gone vacuous');
});

test('each workflow declares a name, a trigger and least-privilege permissions', () => {
  const workflowDir = path.join(ROOT, '.github', 'workflows');
  for (const f of fs.readdirSync(workflowDir).filter((n) => n.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(workflowDir, f), 'utf8');
    assert.ok(/^name:/m.test(text), `${f}: no name:`);
    assert.ok(/^on:/m.test(text), `${f}: no on: trigger`);
    assert.ok(/^jobs:/m.test(text), `${f}: no jobs:`);
    // House rule: a workflow that needs write must say so at the top; one that
    // needs nothing must pin contents:read. GITHUB_TOKEN defaults to whatever
    // the repo-wide setting is, and repo-wide settings drift.
    assert.ok(/^permissions:/m.test(text), `${f}: no explicit permissions block`);
  }
});

// ── the contract npm test itself is run under ────────────────────────────────
test('the scripts CI calls exist in package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const need of ['start', 'lint', 'test', 'repair']) {
    assert.ok(pkg.scripts[need], `package.json has no "${need}" script — CI and the server depend on it`);
  }
});
