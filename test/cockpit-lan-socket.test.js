'use strict';
// Cockpit, LAN-only — the drop-in that decides whether the console exists at all.
//
// On 28 Oct 2026 `systemctl is-active cockpit.socket` said "active" and every LAN
// connection to :9090 was refused, because the drop-in still named 192.168.8.104 after
// the box had moved to .100/.101. setup-all.sh had pinned the lease it happened to see
// at install time. A console you cannot reach is not a console, so the address is now
// re-derived at boot by deploy/cockpit-lan-socket.sh and never stored.
//
// These tests run the real script against a fake `ip` and a scratch drop-in: the shape
// assertion alone would not catch a bound-but-dead listener.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'deploy/cockpit-lan-socket.sh');

/** A stand-in for `ip -4 -o addr show scope global` that reports the given addresses. */
function fakeIp(dir, addresses) {
  const file = path.join(dir, 'ip');
  // A trailing `/len` is passed through: the prefix length is what tells a LAN segment from a
  // point-to-point tunnel address, and one test below depends on the script making that call.
  const lines = addresses.map((a) => {
    const cidr = a.includes('/') ? a : `${a}/24`;
    const ip = cidr.split('/')[0];
    return `1: fake0    inet ${cidr} brd ${ip.replace(/\d+$/, '255')} scope global fake0`;
  }).join('\n');
  // One address per line, exactly as `ip -4 -o addr` prints them — a single printf of a
  // multi-line string would give the parser one line and one address. No addresses at all
  // has to be NO output, not one blank line (which parses as one empty address).
  const body = lines ? `cat <<'IPEOF'\n${lines}\nIPEOF\n` : 'true\n';
  fs.writeFileSync(file, `#!/bin/bash\n${body}`, { mode: 0o755 });
  return file;
}

function render(addresses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-lan-'));
  const conf = path.join(dir, '40-lan-only.conf');
  const run = () => execFileSync('/bin/bash', [SCRIPT], {
    env: {
      ...process.env,
      COCKPIT_SOCKET_CONF: conf,
      COCKPIT_IP_BIN: fakeIp(dir, addresses),
      COCKPIT_SOCKET_RESTART: '0', // dry render: no /etc write, no systemctl, no root
    },
    stdio: 'pipe',
  }).toString();
  return { dir, conf, run, read: () => (fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : null) };
}

test('the drop-in names the addresses the box has now, loopback first', () => {
  const r = render(['192.168.8.100', '192.168.8.101']);
  r.run();
  const conf = r.read();
  assert.ok(conf, 'no drop-in written');
  const lines = conf.trim().split('\n');
  assert.equal(lines[0], '[Socket]');
  // The empty assignment has to survive: systemd list options APPEND, so without it the
  // stock 0.0.0.0/:: listeners stay in the list and "LAN only" is a lie.
  assert.equal(lines[1], 'ListenStream=', 'the clearing assignment must not be optimised away');
  assert.deepEqual(lines.slice(2), [
    'ListenStream=127.0.0.1:9090',
    'ListenStream=192.168.8.100:9090',
    'ListenStream=192.168.8.101:9090',
  ]);
  assert.ok(!/0\.0\.0\.0|\[::\]/.test(conf), 'a wildcard bind would undo the LAN-only intent');
});

test('a changed lease rewrites the drop-in instead of reporting success', () => {
  // The exact failure: the old address stays listed, nothing else happens, and the
  // console answers only on loopback.
  const r = render(['192.168.8.104']);
  r.run();
  assert.match(r.read(), /192\.168\.8\.104:9090/);

  const moved = render(['192.168.8.100', '192.168.8.101']);
  const second = moved.run();
  assert.match(moved.read(), /192\.168\.8\.100:9090/);
  assert.match(moved.read(), /192\.168\.8\.101:9090/);
  assert.ok(!/192\.168\.8\.104/.test(moved.read()), 'the dead address must be gone, not appended to');
  assert.match(second, /bound to 127\.0\.0\.1/);
});

test('a tunnel host address is left out, because a failed bind is a dead console', () => {
  // The live box before this was fixed: `ip -4 -o addr` lists CloudflareWARP's 100.96.0.1/32 next
  // to the two real LAN addresses, and the drop-in took it verbatim. systemd does not bind "what it
  // can" — one bad ListenStream fails the entire cockpit.socket unit. WARP is disabled on this box
  // and its tun device does not survive a reboot, so that entry was a console that dies whenever
  // the socket is restarted while the tunnel is gone.
  const r = render(['192.168.8.104/24', '100.96.0.1/32']);
  r.run();
  const conf = r.read();
  assert.match(conf, /ListenStream=192\.168\.8\.104:9090/);
  assert.ok(
    !/100\.96\.0\.1/.test(conf),
    'a /32 tunnel address was kept — cockpit.socket cannot start once that tunnel is gone',
  );
});

test('an unchanged answer is left alone', () => {
  const r = render(['192.168.8.100']);
  r.run();
  const before = fs.statSync(r.conf).mtimeMs;
  const out = r.run();
  assert.match(out, /unchanged/, 'a rewrite every boot would restart the socket for no reason');
  assert.equal(fs.statSync(r.conf).mtimeMs, before);
});

test('no global IPv4 is a warning, not a silent loopback-only console', () => {
  const r = render([]);
  const res = spawnSync('/bin/bash', [SCRIPT], {
    env: {
      ...process.env,
      COCKPIT_SOCKET_CONF: r.conf,
      COCKPIT_IP_BIN: fakeIp(r.dir, []),
      COCKPIT_SOCKET_RESTART: '0',
    },
  });
  assert.equal(res.status, 0, 'a box that is still coming up must not fail the boot unit');
  assert.match(r.read(), /ListenStream=127\.0\.0\.1:9090/);
  assert.ok(!/0\.0\.0\.0/.test(r.read()));
  // Silent success is how this class of bug hides: the operator has to be told.
  assert.match(res.stderr.toString(), /no global IPv4/);
});

test('setup-all.sh calls the regenerator and never pins a lease again', () => {
  const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-all.sh'), 'utf8');
  assert.match(setup, /cockpit-lan-socket/ , 'setup-all must install/run the regenerator');
  // The bug, verbatim: the printf that baked $LAN_IP into the drop-in.
  assert.ok(
    !/printf '\[Socket\][^\n]*ListenStream=%s:9090/.test(setup),
    'the pinned-address printf is back — the console will die on the next lease change',
  );
  // And the rebuild path has to bring the unit up, or a restored box re-pins nothing and
  // silently keeps whatever the archive left behind.
  const rebuild = fs.readFileSync(path.join(ROOT, 'scripts/rebuild-from-offsite.sh'), 'utf8');
  assert.match(rebuild, /cockpit-lan-socket\.service/, 'rebuild-from-offsite must enable the regenerator');
  // Cockpit answers an unauthenticated GET /login with the login page itself (200). The 401
  // belongs to /cockpit/login, the package endpoint; checking that instead would pass on a
  // console nobody could open a login page on.
  assert.match(rebuild, /chk "cockpit on 9090"\s+200/);
  assert.ok(!/chk "cockpit on 9090"\s+401/.test(rebuild), 'the 401 belonged to /cockpit/login, not /login');
  assert.match(rebuild, /9090\/login/, 'the check must hit /login, the page the operator will open');
});

test('the boot unit runs before cockpit.socket, not after it', () => {
  // cockpit.socket is started by sockets.target; the regenerator is wanted by
  // multi-user.target, which is later. Without an explicit ordering the socket comes up on
  // the previous boot's drop-in and only gets corrected seconds later — still "active",
  // still refusing LAN connections, which is the whole bug wearing a shorter duration.
  const setup = fs.readFileSync(path.join(ROOT, 'scripts/setup-all.sh'), 'utf8');
  const unit = setup.slice(setup.indexOf('cockpit-lan-socket.service << '), setup.indexOf('ExecStart=/usr/local/sbin/cockpit-lan-socket'));
  assert.ok(unit, 'the unit heredoc is gone — setup-all installs the unit inline');
  assert.match(unit, /^Before=cockpit\.socket$/m, 'the regenerator must run before the socket it rewrites for');
  assert.ok(!/^After=cockpit\.socket$/m.test(unit), 'After=cockpit.socket would guarantee the stale bind');
  // The cycle breaker, learned on 4 Nov 2026: without DefaultDependencies=no the implicit
  // After=basic.target routes this unit back through sockets.target, the Before= becomes a
  // loop, systemd deletes cockpit.socket's start job — and a blocking restart from inside
  // the unit waits on a job ordered behind itself.
  assert.match(unit, /^DefaultDependencies=no$/m, 'implicit deps put this unit in an ordering cycle with sockets.target');
  // …and REBUILD.md has to say why, or the next handover drops the line as noise.
  const doc = fs.readFileSync(path.join(ROOT, 'deploy/REBUILD.md'), 'utf8');
  assert.match(doc, /Before=cockpit\.socket/);
});

test('the boot path restarts the socket without blocking on its own ordering', () => {
  // On 4 Nov 2026 the console was unreachable because this deadlock fired: the unit is
  // ordered Before=cockpit.socket, and its ExecStart ran a BLOCKING `systemctl restart
  // cockpit.socket` — a job ordered after the very unit job it was running inside, so the
  // service hung in `activating (start)` forever and cockpit.socket's start job was deleted
  // at boot to break the ordering cycle. The script must therefore queue the job
  // (--no-block) when it runs under systemd, and only block when an operator runs it by
  // hand. The assertion reads the source because the restart must never be executed here.
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /\$\{INVOCATION_ID:-\}/, 'the script cannot tell a boot run from an interactive one');
  assert.match(src, /restart --no-block cockpit\.socket/, 'a blocking restart inside the unit deadlocks the console');
  assert.match(src, /start --no-block cockpit\.socket/, 'a deleted boot job still needs a plain start queued');
  // Unchanged drop-in must still queue the start: the boot cycle deletes cockpit.socket's own
  // job, so an early `exit 0` on "unchanged" leaves a console that never comes up.
  assert.ok(!/^\s*exit 0$/m.test(src), 'an early exit skips the start the deleted boot job needs');
  // The interactive branch keeps the blocking restart so setup-all/pin-lan-address still wait.
  assert.match(src, /systemctl restart cockpit\.socket/, 'interactive runs must still see the outcome');
  assert.match(src, /systemctl daemon-reload/, 'systemd re-reads the drop-in only after a reload');
});
