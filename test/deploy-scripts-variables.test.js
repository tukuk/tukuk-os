'use strict';
// Tests for scripts/check-shell-vars.js — the guard against the bug class that stopped two real
// rebuilds on a fresh box in a row: a variable READ under `set -u` that the script never assigns.
// `bash -n` accepts it happily (it is valid syntax), the script then dies mid-restore, and the log
// reads like a hardware problem: the server is left half-built with a plausible error line.
//
// The first test group proves the scanner is not vacuous (a deliberately bad fixture IS flagged),
// the second group asserts the shipped install path is clean, recursively, so a script added later
// is covered without anyone remembering to list it, and the one between them pins that the CLI
// cannot answer "all clean" when it was handed no files at all.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scan } = require('../scripts/check-shell-vars.js');

const ROOT = path.join(__dirname, '..');

function names(text) {
  return scan(text).map((f) => f.name);
}

// ── the scanner itself: it has to be able to see the bug ─────────────────────────
test('scanner flags exactly the incident: an assigned CFGID read as CFGRID', () => {
  const script = `set -euo pipefail
CFGID=$(grep -oE 'tunnel: x' /etc/cloudflared/config.yml | cut -d' ' -f2)
echo "CF_TUNNEL_ID=$CFGRID" >> "$ENV"
`;
  assert.deepEqual(names(script), ['CFGRID', 'ENV'], 'the typo and the never-assigned ENV must both surface');
  // …and the corrected shape is clean, which is what ships: the real script assigns ENV at the
  // top and reads CFGID, so only a default on ENV is needed to make the fixture pass.
  assert.deepEqual(names(script.replace('$CFGRID', '$CFGID').replace('"$ENV"', '"${ENV:-/tmp/app.env}"')), []);
});

test('scanner flags a plain unbound read under set -u', () => {
  assert.deepEqual(names('set -u\necho "$NEVER_SET_ANYWHERE"\n'), ['NEVER_SET_ANYWHERE']);
});

test('scanner stays quiet on the shapes that cannot be fatal', () => {
  // defaults: `${X:-y}` is legal under set -u by construction
  assert.deepEqual(names('set -u\necho "${MAYBE:-fallback}" ${OTHER:=x}\n'), []);
  // bash built-ins and the operator's environment
  assert.deepEqual(names('set -u\necho "$PATH $HOME $1 $SUDO_USER ${COLUMNS:-80}"\n'), []);
  // whole-line and trailing comments
  assert.deepEqual(names('set -u\n# $NOTE_TO_SELF\ntrue # $ANOTHER\n'), []);
  // declarations with no value, array fills, multi-target read, loop variables
  assert.deepEqual(names(`set -u
  local -a FILES
  local f
  mapfile -t URLS < <(printf 'a\\n')
  read -r slug pkg label
  for item in "$URLS[@]"; do echo "$item $slug $pkg $label $f \${FILES[*]:-}"; done
  `), []);
  // a quoted heredoc body is not shell: the Godot splice writes $GODOT_HEAD_INCLUDE in Python
  assert.deepEqual(names(`set -u
python3 - "$WEB_HEAD" <<'PY'
marker = '$GODOT_HEAD_INCLUDE'
print(marker)
PY
echo done
`), []);
  // single-quoted awk: $NF is an awk field count, not a shell variable
  assert.deepEqual(names(`set -u
port_owner() { ss -ltnp | awk -v p="127.0.0.1:\$1" '$4==p{print $NF}' | head -1; }
`), []);
  // multi-line node -e program: its template literals are JavaScript
  assert.deepEqual(names(`set -u
node -e '
  for (const x of s.services) console.log(\`  \${x.unit.padEnd(24)} \${String(x.state)}\`);
' 2>&1 | sed 's/^/   /'
echo "$x $String"
`), ['x', 'String'], 'reads AFTER the closing quote are still real shell reads');
});

// ── the command line, not just the exported scan() ───────────────────────────────
const CLI = path.join(ROOT, 'scripts', 'check-shell-vars.js');

test('the command line refuses to report success over zero files', () => {
  // `node scripts/check-shell-vars.js` with no arguments looped over nothing and exited 0.
  // That is the answer a human gets when they type the command from memory, and it reads
  // exactly like "every script is clean" — so the empty case now costs a usage error, kept a
  // distinct code from "findings" (1) to leave the difference observable.
  let err = null;
  try {
    execFileSync(process.execPath, [CLI], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'a bare run must not exit 0');
  assert.equal(err.status, 2, 'usage error, not a finding');
  assert.match(err.stderr, /nothing to scan/);
  // …and the documented form still works, on a script this suite already knows is clean.
  const out = execFileSync(process.execPath, [CLI, path.join(ROOT, 'deploy', 'purge-edge-cache.sh')],
    { encoding: 'utf8' });
  assert.match(out, /^OK .*purge-edge-cache\.sh\n$/, `got: ${JSON.stringify(out)}`);
});

// ── the shipped install path ─────────────────────────────────────────────────────
function shellFiles() {
  const out = [];
  for (const dir of ['scripts', 'deploy']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name), `${rel}/${e.name}`);
        else if (e.name.endsWith('.sh')) out.push(`${rel}/${e.name}`);
      }
    };
    walk(abs, dir);
  }
  return out.sort();
}

test('every set -u install script parses, and none reads an unassigned variable', () => {
  const files = shellFiles();
  assert.ok(files.length >= 30, `expected the install path to have many scripts, found ${files.length}`);
  const unChecked = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!/set -[a-z]*u/.test(text)) continue; // without set -u an unbound read is just empty
    unChecked.push(rel);
    // bash -n first: if the file does not even parse, the variable scan means nothing
    try {
      execFileSync('/bin/bash', ['-n', path.join(ROOT, rel)], { stdio: 'pipe' });
    } catch (e) {
      assert.fail(`${rel}: bash -n failed: ${e.stderr?.toString().trim() || e.message}`);
    }
    const found = scan(text);
    assert.deepEqual(found, [], `${rel}: ${found.map((f) => `$${f.name} read at line ${f.at}`).join(', ')}`);
  }
  assert.ok(unChecked.length >= 25, `only ${unChecked.length} scripts run under set -u — did the glob break?`);
});

test('the tunnel self-heal that was mistyped twice still does its job', () => {
  // It exists because /etc/cloudflared/config.yml holds the working tunnel identity while .env is
  // gitignored: without this, a rebuilt box restores config.yml but has no CF_TUNNEL_TOKEN at all.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/rebuild-from-offsite.sh'), 'utf8');
  assert.match(src, /^\s*CFGID=\$\(grep -oE '\^tunnel/m, 'CFGID must be assigned before it is used');
  assert.match(src, /^\s*CFGTOK=\$\(grep -oE '\^token/m, 'CFGTOK must be assigned too');
  assert.match(src, /CF_TUNNEL_ID=\$CFGID/, 'and written into .env under its real name');
  assert.match(src, /CF_TUNNEL_TOKEN=\$CFGTOK/, 'the token from config.yml must land in .env too');
  // The two names that were shipped by mistake, in the order they were mistaken.
  assert.ok(!/CFGRID/.test(src), 'the CFGRID typo must not come back');
  assert.ok(!/\$CFID\b/.test(src), 'and neither must the well-meaning shortening of CFGID');
});

test('the .env bootstrap runs before the preflight reads it (run #1 died on this)', () => {
  // rebuild-from-offsite.sh gates on BACKUP_WORKER_URL/BACKUP_UPLOAD_SECRET, which only live in
  // .env — a file setup-all.sh creates and git keeps out of the clone. On an empty box the gate
  // therefore fired before anything could satisfy it.
  const lines = fs.readFileSync(path.join(ROOT, 'scripts/rebuild-from-offsite.sh'), 'utf8').split('\n');
  // The bootstrap used to be `cp deploy/env.defaults $ENV`; it is now make-env.sh, which
  // merges the public defaults with the gitignored env.secrets. Same obligation, one
  // fewer place that knows how .env is built.
  const boot = lines.findIndex((l) => l.includes('make-env.sh') && l.includes('scripts'));
  const gate = lines.findIndex((l) => l.includes('BACKUP_WORKER_URL') && l.includes('empty in'));
  assert.ok(boot !== -1, 'no .env bootstrap step found (expected a make-env.sh call)');
  assert.ok(gate !== -1, 'the worker preflight was removed, so this test needs updating with it');
  assert.ok(boot < gate, `.env bootstrap (line ${boot + 1}) must precede the preflight (line ${gate + 1})`);
});

test('the Meilisearch unit is re-keyed after the restored .env lands, not before', () => {
  // setup-all.sh generates MEILI_MASTER_KEY on an empty box and bakes it into meilisearch.service;
  // the identity restore then overwrites .env with the archive's key. Without the re-key every
  // search returns 401 and looks like a broken app.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/rebuild-from-offsite.sh'), 'utf8');
  const restore = src.indexOf('.env (real keys, not the bundled defaults)');
  const rekey = src.indexOf('meilisearch unit re-keyed');
  assert.ok(restore !== -1 && rekey !== -1, 'either the .env restore or the re-key step is gone');
  assert.ok(rekey > restore, 'the re-key has to happen after the archive .env is installed');
  assert.match(src, /systemctl restart meilisearch/, 'and it has to restart the service to take effect');
  // a key with shell metacharacters must not be sed-injected into a unit file
  assert.match(src, /if \[\[ "\$MK" =~ \^\[A-Za-z0-9_-\]\+\$ \]\]/, 're-key only a quoting-safe key');
});

// ── the traps that are one step beyond an unbound variable ──────────────────────
test('store_shape is defined before step 3 calls it', () => {
  // Bash only knows a function once execution has passed its definition. `store_shape` is used in
  // the data guard (step 3) and in the verify table (step 5); the definition has to sit above both,
  // because a `VAR=$(undefined_function …)` returns non-zero and takes the whole `set -e` script
  // down -- the same class of death as an unbound variable, one layer up.
  const lines = fs.readFileSync(path.join(ROOT, 'scripts/rebuild-from-offsite.sh'), 'utf8').split('\n');
  const def = lines.findIndex((l) => l.startsWith('store_shape() {'));
  const call = lines.findIndex((l) => l.includes('LIVE=$(store_shape'));
  assert.ok(def !== -1, 'store_shape is gone; the runtime-store row needs a new home');
  assert.ok(call !== -1, 'the data guard no longer calls store_shape; update this test with it');
  assert.ok(def < call, `definition (line ${def + 1}) must precede the first call (line ${call + 1})`);
});

test('a data/ restore stops the app and the watchdog first, and reports failure', () => {
  // The app keeps its stores in memory, so restoring data/ under a running service can be flushed
  // straight back out again -- ✓ in the log, empty store in the file. And the restore itself must
  // not be a `&&` chain whose middle can fail silently.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/rebuild-from-offsite.sh'), 'utf8');
  const stop = src.indexOf('systemctl stop tukuk-os.service tukuk-os-watchdog.service');
  const untar = src.indexOf('tar xzf "$TMP/data.tar.gz" -C "$APP"');
  assert.ok(stop !== -1 && untar !== -1, 'the stop-before-restore pair is gone');
  assert.ok(stop < untar, 'the writers have to be stopped before the archive is unpacked');
  assert.match(src, /RESTORED_DATA=1/, 'and the script has to remember that it restored, for the verify row');
  assert.match(src, /bad "data restore"/, 'a failed download must be a FAIL row, not a missing line');
});

test('the runtime store is measured as JSON, not grepped for a token that does not exist', () => {
  // credentials are stored as { id, publicKey, counter, … } under settings.passkeys (src/auth.js);
  // the first version of this row counted occurrences of "credentialId" and therefore reported
  // "0 credential(s)" as a failure on every box, restored or not.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/rebuild-from-offsite.sh'), 'utf8');
  // The word may appear in the prose that explains why it was wrong; it may not appear in code.
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/credentialId/.test(code), 'the store has no such key; the count has to read settings.passkeys');
  assert.match(src, /d\.settings&&Array\.isArray\(d\.settings\.passkeys\)/, 'the measured shape is settings.passkeys[]');
  const auth = fs.readFileSync(path.join(ROOT, 'src/auth.js'), 'utf8');
  assert.match(auth, /passkeys/, 'and that is the field the app itself uses');
});
