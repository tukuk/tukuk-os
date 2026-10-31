'use strict';
// Tests for the watchdog's tunnel-connector check — the failure class that `is-active` is blind to.
//
// On 30 Oct 2026 `cloudflared-build.service` was running, its process healthy, the wake front door
// answering 200 on 127.0.0.1:5174 — and build/play/tchat.tukuk.org were all serving `530` (Cloudflare
// error 1033, "no connector available"). The edge had dropped the connector's four registrations and
// the connector's re-registration attempts after that were never accepted, so the box was perfectly
// healthy and three hostnames were dead. Nothing in the stack noticed: every earlier check either
// asked systemd (`active`) or probed the local port (`200`).
//
// That second connector has since been retired — every hostname is a route on the ONE tunnel — but
// the failure mode did not go away with it, only the number of units it can happen to. So the
// watchdog still probes two public hostnames and restarts `cloudflared.service` for either.
//
// The instrument that CAN see it is the public status code, and the condition has to be exact:
//   530 + local 200  → the request never arrived; only re-registering the connector helps → restart.
//   502 + local 5xx  → the connector delivered it and the ORIGIN is broken → restarting the tunnel
//                      would fix nothing and would briefly take the working hostnames down too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'watchdog.sh'), 'utf8');

test('the watchdog reads the public code for the build host, not just systemd', () => {
  assert.match(SRC, /WATCHDOG_BUILD_URL/, 'build.tukuk.org must be probed — it was the blind spot');
  assert.match(SRC, /probe_local/, 'and the local origin, so 530 and 502 can be told apart');
});

test('it re-registers ONLY on 530 with a healthy local origin', () => {
  assert.match(SRC, /\[ "\$code" = "530" \] && \[ "\$lcode" = "200" \]/,
    '530 + 200 is the exact stale-connector signature');
  assert.doesNotMatch(SRC, /= "502"[\s\S]{0,80}systemctl restart/,
    '502 means the origin failed — restarting the tunnel would hide an app bug and drop the healthy hostnames');
});

test('both hostnames are covered, and both restart the ONE connector', () => {
  // \s+ not a single space: the two calls are column-aligned in the script for readability.
  // The URL is matched as a WHOLE quoted string ([^"]*") — a pattern that forgets the closing
  // quote cannot match, which is how this test first failed.
  assert.match(SRC, /re_register\s+"[^"]*"\s+5174\s+cloudflared\.service/, 'the build host');
  assert.match(SRC, /re_register\s+"[^"]*"\s+3000\s+cloudflared\.service/, 'and the main one');
  assert.doesNotMatch(SRC, /cloudflared-build/, 'the second connector is gone: restarting it would be a no-op that logs success');
});

test('one fault means one restart, even when two hostnames report it', () => {
  // With one tunnel both hostnames see the same dead registration, and two independent stamps
  // would restart the unit twice within seconds — cancelling the handshake the first restart was
  // making. The gate is therefore keyed on the UNIT (${3%%.*}), not on the hostname.
  assert.match(SRC, /gate="\/tmp\/tukuk-os-watchdog\.\$\{3%%\.\*\}\.gate"/,
    'the gate name derives from the unit');
  assert.match(SRC, /touch "\$4" "\$gate"/, 'the restart stamps the hostname AND the unit gate');
  assert.match(SRC, /find "\$gate" -mmin -30/, 'and the gate is what blocks the second restart');
});

test('restarts are rate-limited, so a genuinely gone tunnel cannot loop', () => {
  // One restart per 30 min per unit: the unit restarts in ~2 s, so a loop would burn CPU forever
  // and still not produce a registration if the problem is on the Cloudflare side.
  const calls = SRC.match(/re_register\s+"[^"]*"\s+\d+\s+[\w.-]+\s+\/tmp\/\S+/g) || [];
  assert.equal(calls.length, 2, 'each re_register call needs its OWN stamp file, or one unit throttles the other');
  assert.match(SRC, /find "\$4" -mmin \+30/, 'the guard is the stamp age');
  const newSet = new Set(calls.map((c) => c.split('/tmp/')[1]));
  assert.equal(newSet.size, 2, 'the two stamp files must differ');
});

test('it says out loud what it did, and that no config or credential was touched', () => {
  // This box's rule is that the way in never changes without a human deciding; a self-heal that
  // silently restarted a tunnel unit would look like exactly that. The log line is the audit trail.
  assert.match(SRC, /lost its edge registrations/, 'name the failure, not just the restart');
  assert.match(SRC, /no config or credential touched/, 'and say the change was bounded');
});
