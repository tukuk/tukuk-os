'use strict';
// Systemd units must not carry secrets, and must not be given a working directory the
// unit's own user cannot write. Both went wrong on the box on 28 Oct 2026:
//
//  * meilisearch.service had the master key interpolated into ExecStart, so it sat
//    world-readable in /etc/systemd/system — and, worse, stayed frozen at whatever .env
//    said when the unit was written. After the key was rotated, Meilisearch answered 403
//    to every call and src/meili.js fell back to its 30-document mock. The site kept
//    serving "results" from a fake index while /health reported meilisearch:"available".
//  * chat-backup.service runs as `tukuk` and wrote its snapshot into /opt/tukuk-os/
//    snapshots, a root-owned tree. tar never even created the archive.
//
// These are cheap string facts, but they are the kind that a later "tidy up the unit"
// commit silently undoes, so they are pinned here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the meilisearch unit reads the key from .env instead of baking it in', () => {
  const setup = read('scripts/setup-all.sh');
  const start = setup.indexOf('/etc/systemd/system/meilisearch.service');
  const unit = setup.slice(start, setup.indexOf('EOF', setup.indexOf('ExecStart=', start)));
  assert.match(unit, /EnvironmentFile=\$INSTALL_DIR\/\.env/, 'the unit must load .env itself');
  assert.match(
    unit,
    /--master-key \\\$\{MEILI_MASTER_KEY\}/,
    'ExecStart must defer the key to systemd (escaped in the heredoc), not interpolate it',
  );
  // The exact bug: the shell substituted $MEILI_KEY while writing the unit.
  assert.ok(
    !/--master-key \$MEILI_KEY/.test(setup),
    'the key is being interpolated into the unit again — a rotated .env will silently stop matching',
  );
});

test('no unit in deploy/ embeds a literal secret', () => {
  const units = fs.readdirSync(path.join(ROOT, 'deploy')).filter((f) => /\.(service|timer)$/.test(f));
  assert.ok(units.length > 3, 'deploy/ should hold the box units');
  for (const f of units) {
    const body = read(`deploy/${f}`);
    for (const line of body.split('\n')) {
      if (!/^\s*(ExecStart|Environment)=/.test(line)) continue;
      // A 20+ character unbroken alphanumeric run after a key-ish flag is a secret.
      const leak = /(--master-key|MASTER_KEY=|UPLOAD_SECRET=|_TOKEN=)\s*([A-Za-z0-9+/_-]{20,})/.exec(line);
      assert.equal(leak, null, `${f} embeds a literal secret: ${line.trim().slice(0, 60)}…`);
    }
  }
});

test('the chat backup unit can write where it is told to write', () => {
  const setup = read('scripts/setup-all.sh');
  const start = setup.indexOf('/etc/systemd/system/chat-backup.service');
  const unit = setup.slice(start, setup.indexOf('EOF', setup.indexOf('ExecStart=', start)));
  assert.match(unit, /^User=tukuk$/m, 'this unit runs unprivileged; that is the reason for the trap');
  assert.match(unit, /Environment=SNAP_DIR=\/var\/backups\/tukuk-chat/, 'SNAP_DIR must not be the root-owned $INSTALL_DIR/snapshots');
  // …and the directory has to exist with the right owner, or tar fails the same way again.
  assert.match(setup, /install -d -o tukuk -g tukuk -m 750 \/var\/backups\/tukuk-chat/);

  const ref = read('deploy/chat-backup.service');
  assert.match(ref, /SNAP_DIR=\/var\/backups\/tukuk-chat/);
  // The hand-made r2.env never existed on the live box; the real .env does. Comments may
  // name the dead path (that is how the next reader learns why), directives may not.
  const directives = ref.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/r2\.env/.test(directives), 'deploy/chat-backup.service still points at the never-created r2.env');
});

test('both backups read the same .env the app reads', () => {
  const setup = read('scripts/setup-all.sh');
  const chat = setup.slice(setup.indexOf('/etc/systemd/system/chat-backup.service'));
  assert.match(chat.slice(0, 600), /EnvironmentFile=-\$INSTALL_DIR\/\.env/);
  // meili-backup reads .env at runtime, which is only correct now that the key lives there.
  assert.match(read('deploy/meili-backup.service'), /EnvironmentFile=-\/opt\/tukuk-os\/\.env/);
  assert.match(read('deploy/meilisearch.service'), /EnvironmentFile=-\/opt\/tukuk-os\/\.env/);
});
