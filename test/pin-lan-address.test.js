'use strict';
// Pinning a LAN address is an operation that can lock you out of the box you run it on,
// so the properties that matter are not "does it add an address" but:
//   * it refuses an address someone else is already using,
//   * it arms a self-revert BEFORE the change lands,
//   * --revert works without remembering what was done,
//   * --confirm is refused when nothing was actually applied.
//
// The script is exercised for real against fake `ip` / `nmcli` / `ping` / scheduler
// binaries; a string assertion would happily pass on a script that pins the wrong NIC.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'deploy/pin-lan-address.sh');

// A fake box: one interface `enp1s0`, one NM connection `netplan-enp1s0`, and an address
// list in a file that both fakes read and write.
function fakeBox({ addresses = ['192.168.8.100/24'], occupied = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-lan-'));
  const state = path.join(dir, 'addresses');
  const logFile = path.join(dir, 'calls.log');
  fs.writeFileSync(state, addresses.join('\n') + '\n');
  fs.writeFileSync(logFile, '');
  const log = (line) => fs.appendFileSync(logFile, line + '\n');

  fs.writeFileSync(path.join(dir, 'ip'), `#!/bin/bash
if [[ "$*" == *"route show default"* ]]; then
  echo "default via 192.168.8.1 dev enp1s0 proto dhcp src 192.168.8.100 metric 100"
  exit 0
fi
n=2
while read -r a; do
  [ -n "$a" ] && echo "\$n: enp1s0    inet \$a brd 192.168.8.255 scope global enp1s0"
  n=\$((n+1))
done < ${state}
`, { mode: 0o755 });

  fs.writeFileSync(path.join(dir, 'nmcli'), `#!/bin/bash
echo "nmcli $*" >> ${logFile}
case "$*" in
  *"connection show --active"*) echo "netplan-enp1s0:enp1s0"; exit 0 ;;
  *"-f ipv4.addresses connection show"*) cat ${state}; exit 0 ;;
  *"+ipv4.addresses"*)
    for last; do :; done
    grep -qx "$last" ${state} || echo "$last" >> ${state}
    exit 0 ;;
  *"-ipv4.addresses"*)
    for last; do :; done
    grep -vx "$last" ${state} > ${state}.new || true; mv ${state}.new ${state}
    exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });

  // Free address = "no reply" = non-zero exit; occupied = a reply.
  fs.writeFileSync(path.join(dir, 'ping'), `#!/bin/bash
echo "ping $*" >> ${logFile}
exit ${occupied ? 0 : 1}
`, { mode: 0o755 });

  fs.writeFileSync(path.join(dir, 'sched'), `#!/bin/bash
echo "scheduled $*" >> ${logFile}
`, { mode: 0o755 });

  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    PIN_NMCLI_BIN: path.join(dir, 'nmcli'),
    PIN_IP_BIN: path.join(dir, 'ip'),
    PIN_PING_BIN: path.join(dir, 'ping'),
    PIN_SCHEDULER: path.join(dir, 'sched'),
    PIN_MARKER: path.join(dir, 'confirmed'),
    PIN_GUARD_BIN: path.join(dir, 'guard.sh'),
    PIN_GUARD_SECONDS: '240',
  };
  const run = (...args) => spawnSync('/bin/bash', [SCRIPT, ...args], { env, cwd: dir });
  return {
    dir,
    guard: path.join(dir, 'guard.sh'),
    marker: path.join(dir, 'confirmed'),
    run,
    log: () => fs.readFileSync(logFile, 'utf8'),
    addresses: () => fs.readFileSync(state, 'utf8').split('\n').filter(Boolean),
  };
}

test('a free address is added to the connection that carries the default route', () => {
  const box = fakeBox();
  const res = box.run('--address', '192.168.8.240/24');
  assert.equal(res.status, 0, res.stderr.toString());
  assert.deepEqual(box.addresses(), ['192.168.8.100/24', '192.168.8.240/24']);
  // DAD, so a host that is coming up with the same address is refused instead of fought over.
  assert.match(box.log(), /nmcli connection modify netplan-enp1s0 ipv4\.dad-timeout 2000/);
  assert.match(box.log(), /\+ipv4\.addresses 192\.168\.8\.240\/24/);
});

test('an address another device already answers on is refused, before anything is changed', () => {
  const box = fakeBox({ occupied: true });
  const res = box.run('--address', '192.168.8.240/24');
  assert.notEqual(res.status, 0);
  assert.match(res.stderr.toString(), /another device owns it/);
  // The point: no half-applied state, and no scheduled guard left behind for an abort.
  assert.ok(!/connection modify/.test(box.log()), 'the profile must not be touched when the probe answers');
  assert.ok(!/scheduled/.test(box.log()), 'an aborted run must not arm a guard');
  assert.deepEqual(box.addresses(), ['192.168.8.100/24']);
});

test('the guard is armed before the change, so a lost link still reverts', () => {
  const box = fakeBox();
  box.run('--address', '192.168.8.240/24');
  const calls = box.log().split('\n');
  const scheduledAt = calls.findIndex((l) => l.startsWith('scheduled '));
  const modifiedAt = calls.findIndex((l) => l.includes('+ipv4.addresses'));
  assert.ok(scheduledAt > -1, 'no guard was scheduled at all');
  assert.ok(modifiedAt > -1, 'the address was never added');
  assert.ok(scheduledAt < modifiedAt, 'a guard scheduled after the change cannot rescue a dropped link');
  // The guard has to call the pin script, not itself — `$0` there is the guard.
  const guard = fs.readFileSync(box.guard, 'utf8');
  assert.match(guard, /exec \/bin\/bash .*pin-lan-address\.sh --revert/);
  assert.match(guard, /--address 192\.168\.8\.240\/24/);
});

test('--confirm keeps it, and refuses to confirm what is not there', () => {
  const empty = fakeBox();
  const refused = empty.run('--confirm', '--address', '192.168.8.240/24');
  assert.notEqual(refused.status, 0, 'confirming an address that is not on the NIC hides a failed apply');
  assert.ok(!fs.existsSync(empty.marker));

  const box = fakeBox();
  box.run('--address', '192.168.8.240/24');
  const res = box.run('--confirm', '--address', '192.168.8.240/24');
  assert.equal(res.status, 0, res.stderr.toString());
  assert.ok(fs.existsSync(box.marker), 'the marker is what tells the guard to stand down');
});

test('--revert removes exactly the pinned address and leaves DHCP alone', () => {
  const box = fakeBox();
  box.run('--address', '192.168.8.240/24');
  const res = box.run('--revert', '--address', '192.168.8.240/24');
  assert.equal(res.status, 0, res.stderr.toString());
  assert.deepEqual(box.addresses(), ['192.168.8.100/24'], 'the DHCP address must survive the revert');
  assert.match(box.log(), /-ipv4\.addresses 192\.168\.8\.240\/24/);
  assert.ok(!fs.existsSync(box.marker));
});

test('--revert is a no-op when nothing was pinned', () => {
  const box = fakeBox();
  const res = box.run('--revert', '--address', '192.168.8.240/24');
  assert.equal(res.status, 0);
  assert.match(res.stdout.toString(), /nothing to revert/);
  assert.deepEqual(box.addresses(), ['192.168.8.100/24']);
});

test('--dry-run touches nothing', () => {
  const box = fakeBox();
  const res = box.run('--address', '192.168.8.240/24', '--dry-run');
  assert.equal(res.status, 0, res.stderr.toString());
  assert.match(res.stdout.toString(), /would run: .*\+ipv4\.addresses 192\.168\.8\.240\/24/);
  assert.deepEqual(box.addresses(), ['192.168.8.100/24']);
  assert.ok(!/scheduled/.test(box.log()));
  assert.ok(!fs.existsSync(box.guard));
});

test('the prefix length is not optional', () => {
  const box = fakeBox();
  const res = box.run('--address', '192.168.8.240');
  assert.notEqual(res.status, 0);
  assert.match(res.stderr.toString(), /needs a prefix length/);
});
