'use strict';
// The web app and the index engine must not run as root.
//
// On 28 Oct 2026 the live tukuk-os.service had no User=, so it ran as root with
// ProtectSystem=off and the full capability set — while /api/admin/terminal
// (src/server.js) execs whatever shell command an admin types. One bug in the
// admin session (a stolen cookie, a missing auth check on a new route, a bypass
// in the destructive-command list) was therefore a root shell on the box.
//
// The fix has two halves that both have to survive later edits:
//   1. the units run as `tukuk-os` with a read-only code tree, and
//   2. the runtime dirs belong to that user — including the ones ROOT timers
//      write into, or the app silently stops persisting after the first
//      root-written file (same failure shape as a frozen secret: no error,
//      just stale data).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The live unit heredoc for `name`, from its `cat >` up to the closing EOF that follows ExecStart.
function unitBlock(setup, name) {
  const at = setup.indexOf(`/etc/systemd/system/${name}`);
  assert.ok(at > -1, `${name} is not written by setup-all.sh any more`);
  const exec = setup.indexOf('ExecStart=', at);
  const end = setup.indexOf('\nEOF', exec);
  return setup.slice(at, end < 0 ? at + 2000 : end);
}

test('the web app unit runs as the unprivileged service user, never root', () => {
  const unit = unitBlock(read('scripts/setup-all.sh'), 'tukuk-os.service');
  assert.match(unit, /^User=\$SVC_USER$/m, 'tukuk-os.service must set User= — without it systemd runs Node as root');
  assert.match(unit, /^Group=\$SVC_USER$/m);
  assert.ok(!/^User=root$/m.test(unit), 'root again: /api/admin/terminal would be a root shell');
  assert.ok(!/^User=tukuk$/m.test(unit), 'the box SSH/sudo user must not also run the public web service');
  // One definition, one name: every unit below refers to it through $SVC_USER.
  assert.match(read('scripts/setup-all.sh'), /^SVC_USER="tukuk-os"$/m);
  // The lightweight installer writes its own unit; it must not resurrect User=root.
  assert.ok(!/^User=root$/m.test(read('deploy/quick-install.sh')), 'deploy/quick-install.sh writes a root-run unit again');
});

test('the web app is sandboxed and can only write the runtime dirs', () => {
  const unit = unitBlock(read('scripts/setup-all.sh'), 'tukuk-os.service');
  for (const directive of [
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'PrivateDevices=true',
    'ProtectSystem=strict',
    'ProtectHome=yes',
    'ProtectKernelTunables=true',
    'ProtectKernelModules=true',
    'ProtectControlGroups=true',
    'RestrictSUIDSGID=true',
    'CapabilityBoundingSet=',
    'AmbientCapabilities=',
  ]) {
    assert.ok(unit.includes(directive), `missing sandbox directive: ${directive}`);
  }
  // An empty CapabilityBoundingSet plus no CAP_ line anywhere: the service holds nothing.
  assert.ok(!/^CapabilityBoundingSet=cap_/m.test(unit), 'the service must not keep capabilities');
  // ProtectSystem=strict makes the whole tree read-only; these are the exceptions.
  const rw = /^ReadWritePaths=(.+)$/m.exec(unit);
  assert.ok(rw, 'ReadWritePaths is what makes the strict sandbox usable');
  for (const dir of ['data', 'content/blog', 'public/downloads']) {
    assert.ok(rw[1].includes(dir), `ReadWritePaths must include ${dir} — the app writes there`);
  }
  assert.ok(!/ReadWritePaths=\$INSTALL_DIR(\s|$)/.test(rw[1]), 'the repo root must stay read-only to the app');
});

test('the index engine unit runs unprivileged too', () => {
  const setup = read('scripts/setup-all.sh');
  const unit = unitBlock(setup, 'meilisearch.service');
  assert.match(unit, /^User=\$SVC_USER$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^ReadWritePaths=\$INSTALL_DIR\/meili_data$/m);

  const ref = read('deploy/meilisearch.service');
  assert.match(ref, /^User=tukuk-os$/m, 'reference unit drifted back to root');
  assert.match(ref, /^ProtectSystem=strict$/m);
});

test('setup-all.sh creates the service user and hands over the runtime dirs', () => {
  const setup = read('scripts/setup-all.sh');
  assert.match(setup, /useradd --system --no-create-home --home-dir \/var\/lib\/tukuk-os/, 'no useradd — install fails on a fresh box');
  // Every dir the service or a root timer writes into must be listed for the chown loop.
  const loop = /for d in ([^;]+); do/.exec(setup.slice(setup.indexOf('Hand the RUNTIME dirs')));
  assert.ok(loop, 'the runtime-dir ownership loop disappeared');
  for (const d of ['data', 'snapshots', 'dumps', 'meili_data', 'content/blog', 'public/downloads']) {
    assert.ok(loop[1].split(/\s+/).includes(d), `${d} is no longer handed to the service user`);
  }
  assert.match(setup, /chown -R "\$SVC_USER:\$SVC_USER" "\$INSTALL_DIR\/\$d"/);
  // A root-written file in those dirs must stay group-writable, or the app stops persisting.
  assert.match(setup, /find "\$INSTALL_DIR\/\$d" -type d -exec setfacl -m "d:g:\$SVC_USER:rwX" \{\} \+/,
    'the default ACL is what keeps root-timer files writable by the app');
  // .env keeps its 0600 owner and is shared through a named-user ACL, not a group change.
  assert.match(setup, /setfacl -m "u:\$SVC_USER:r--" "\$INSTALL_DIR\/\.env"/);
});

test('the admin terminal is the reason the service user matters, and it still exists', () => {
  const server = read('src/server.js');
  const at = server.indexOf("app.post('/api/admin/terminal'");
  assert.ok(at > -1, 'the admin terminal route moved — re-check which user it runs as');
  const handler = server.slice(at, at + 900);
  assert.match(handler, /auth\.requireAdmin/, 'the terminal must stay behind an admin session');
  assert.match(handler, /dangerous/, 'the destructive-command list must stay');
});
