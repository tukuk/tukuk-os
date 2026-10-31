'use strict';
// ONE folder on the server — pinned, because the drift was invisible.
//
// The box used to keep its parts in five unrelated top-level places: the app in
// /opt/tukuk-os, the Builder in /opt/tukuk-builder, the published game in
// /var/www/tukuk-play, the weights in /home/tukuk/models and the game source plus the
// Godot binary under /home/tukuk. Nothing was broken. What it cost was that every
// script, backup, canary and rebuild document had to know five roots, and each one that
// forgot a root failed in its own quiet way — a publish that wrote to the old path, a
// backup that skipped the weights, a rebuild doc that sent you to the wrong directory.
//
// deploy/paths.sh is now the single place those paths are written down, and
// scripts/consolidate-layout.sh is what moves a box onto the new layout. These
// assertions are what stops a literal creeping back in: a hardcoded /opt/tukuk-builder
// in a script would keep working today (the old path is still a symlink) and break the
// day `--prune-links` runs, which is the worst possible failure shape.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const PATHS = read('deploy', 'paths.sh');
const MIGRATE = read('scripts', 'consolidate-layout.sh');

// The pre-consolidation locations. Only two callers may name them: the migration that
// moves them and this file that forbids them. Both are checked below.
const LEGACY = [
  '/opt/tukuk-builder',
  '/var/www/tukuk-play',
  '/home/tukuk/models',
  '/home/tukuk/bin',
  '/home/tukuk/station-break',
];

// Every place a path is DEFINED or CONSUMED on this box. Docs (markdown) narrate the
// history and are deliberately not scanned; a stale live path is what this is for.
const CONSUMERS = [
  'deploy/tukuk-builder.service',
  'deploy/tukuk-builder.env.example',
  'deploy/nginx/tukuk-play.conf',
  'deploy/godot/install-on-box.sh',
  'deploy/godot/publish-tukuk-play.sh',
  'deploy/godot/build-web.sh',
  'scripts/deploy-builder.sh',
  'scripts/setup-all.sh',
  'scripts/auto-update.sh',
  'scripts/hf-model-pull.sh',
  'scripts/import-trained-model.sh',
  'scripts/backup-identity.sh',
  'scripts/rebuild-from-offsite.sh',
  'src/config.js',
];

// A line that only TALKS about the old path is fine — the history is worth keeping.
// A line that acts on it is the bug. For the languages in this list that is the whole
// distinction: `#` in shell/nginx/systemd, `//` in JS.
const isComment = (line) => /^\s*(#|\/\/)/.test(line);

test('every box path is derived from the one root, in one file', () => {
  assert.match(PATHS, /TUKUK_ROOT="\$\{TUKUK_ROOT:-\/opt\/tukuk-os\}"/,
    'deploy/paths.sh is the single definition; the root must be /opt/tukuk-os by default');
  // The layout itself: five subdirectories, one per thing that used to live elsewhere.
  for (const [variable, expected] of [
    ['TUKUK_BUILDER_DIR', '$TUKUK_APPS/builder'],
    ['TUKUK_PLAY_DIR', '$TUKUK_APPS/play'],
    ['TUKUK_MODEL_DIR', '$TUKUK_ROOT/models'],
    ['TUKUK_BIN_DIR', '$TUKUK_ROOT/bin'],
    ['TUKUK_GAME_DIR', '$TUKUK_ROOT/game'],
  ]) {
    assert.ok(PATHS.includes(`${variable}="\${${variable}:-${expected}}"`),
      `${variable} must default to ${expected}`);
  }
});

test('the migration and the definitions agree on all five pairs', () => {
  // If one of them grew a sixth directory and the other did not, the box silently keeps
  // a second top-level place — the exact thing "one folder" is about.
  for (const v of ['TUKUK_LEGACY_BUILDER', 'TUKUK_LEGACY_PLAY', 'TUKUK_LEGACY_MODELS',
    'TUKUK_LEGACY_BIN', 'TUKUK_LEGACY_GAME']) {
    assert.ok(PATHS.includes(`${v}=/`), `${v} must be defined in deploy/paths.sh`);
    assert.ok(MIGRATE.includes(`$${v}`), `${v} must be handled by scripts/consolidate-layout.sh`);
  }
  const rows = MIGRATE.split('\n').filter((l) => /^\s+"[a-z]+\|\$TUKUK_LEGACY_/.test(l));
  assert.equal(rows.length, 5, 'five legacy locations, five rows — a missing row leaves a directory behind');
});

test('model weights stay put on purpose, and the file says why', () => {
  // `inward` is not an oversight. litert-lm's registry recorded the absolute
  // ~/models/<file> path at import time and lives outside this repo, so moving the bytes
  // would leave it pointing at nothing — a model that silently stops loading. The
  // symlink gives the one-folder property without invalidating a path we do not control.
  assert.match(MIGRATE, /"models\|\$TUKUK_LEGACY_MODELS\|[^"]*\|inward"/,
    'models must be the inward pair unless the litert registry is rebuilt first');
  assert.match(MIGRATE, /litert-lm/, 'the reason for `inward` must be written down where the decision is');
});

test('no script or unit acts on a pre-consolidation path', () => {
  const offenders = [];
  for (const file of CONSUMERS) {
    const lines = read(...file.split('/')).split('\n');
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      for (const legacy of LEGACY) {
        // `(?<![\w-])` on the left so /home/tukuk/bin does not match a /home/tukuk/binaries,
        // and the same on the right so /opt/tukuk-builder-x is not a false positive.
        if (new RegExp(`(?<![\\w-])${legacy.replace(/[/-]/g, '\\$&')}(?![\\w-])`).test(line)) {
          offenders.push(`${file}:${i + 1} — ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [],
    'these lines still act on an old path: they work only while the compatibility symlink exists');
});

test('every script that needs a box path sources the one file that has it', () => {
  for (const file of [
    'scripts/setup-all.sh',
    'scripts/consolidate-layout.sh',
    'scripts/deploy-builder.sh',
    'scripts/hf-model-pull.sh',
    'scripts/import-trained-model.sh',
    'scripts/backup-identity.sh',
    'scripts/rebuild-from-offsite.sh',
    'deploy/godot/install-on-box.sh',
  ]) {
    const src = read(...file.split('/'));
    // A `source`/`.` line whose argument ends in paths.sh, however it builds the path:
    // `. ./deploy/paths.sh` and `. "$(cd "$(dirname "$0")/.." && pwd)/deploy/paths.sh"`
    // are both in this repo, and the second one defeats a quote-bounded pattern.
    assert.match(src, /^\s*\.\s+.*paths\.sh/m,
      `${file} must source deploy/paths.sh instead of naming the folder itself`);
  }
  // auto-update.sh is deliberately NOT one of them: it reads no box path, it only calls
  // the migration. The assertion below is the one that matters for it.
  assert.doesNotMatch(read('scripts', 'auto-update.sh'), /\$\(TUKUK_|\$TUKUK_/,
    'the updater should not need a path of its own — if it does, source paths.sh');
});

test('both deploy paths run the migration, and neither aborts the update on failure', () => {
  // A box that pulls this change WITHOUT running the migration has a unit pointing at a
  // directory that does not exist yet, so the two entry points that can land the change
  // both have to converge it.
  for (const file of ['scripts/auto-update.sh', 'scripts/setup-all.sh']) {
    const src = read(...file.split('/'));
    assert.match(src, /consolidate-layout\.sh/, `${file} must run the layout migration`);
    assert.doesNotMatch(src, /consolidate-layout\.sh[^\n]*\|\|\s*die|consolidate-layout\.sh[^\n]*\|\|\s*exit [1-9]/,
      `${file} must not abort on a migration failure: the compatibility symlinks mean the box still serves`);
  }
});

test('the installed publisher agrees with paths.sh', () => {
  // It is installed to /usr/local/sbin, where it cannot source deploy/paths.sh, so its
  // default is a literal. A literal that disagrees publishes the game into a directory
  // nginx does not serve, and the build still reports success.
  const publisher = read('deploy', 'godot', 'publish-tukuk-play.sh');
  assert.match(publisher, /DEST="\$\{TUKUK_PLAY_DIR:-\/opt\/tukuk-os\/apps\/play\}"/,
    'the published game must land in the folder nginx serves (/opt/tukuk-os/apps/play)');
});

test('the app resolves its models dir from its own location', () => {
  // src/config.js cannot source shell. Resolving from __dirname keeps it correct wherever
  // the checkout is, and means the app does not depend on the compatibility symlink.
  const config = read('src', 'config.js');
  assert.match(config, /localDir:\s*process\.env\.TUKUK_MODEL_DIR\s*\|\|\s*path\.join\(__dirname, '\.\.', 'models'\)/,
    'models must resolve relative to the app, not from a hardcoded home directory');
});

test('setup-all cannot delete the payloads with its --delete', () => {
  // The rsync that copies a checkout over /opt/tukuk-os runs with --delete. Now that the
  // Builder's clone, the weights and the published game live INSIDE the checkout, an
  // exclusion list that forgot them would delete 1-2 GB of node_modules and the live
  // game on the next rebuild-from-a-different-checkout. `--exclude` is what protects a
  // path from --delete; .gitignore does not.
  const setup = read('scripts', 'setup-all.sh');
  const rsyncLine = setup.split('\n').find((l) => /rsync -a --delete/.test(l)) || '';
  const continued = setup.slice(setup.indexOf(rsyncLine), setup.indexOf(rsyncLine) + 400);
  for (const dir of ['apps', 'models', 'bin', 'game']) {
    assert.match(continued, new RegExp(`--exclude ${dir}\\b`),
      `the setup rsync must --exclude ${dir}: it holds live box data and the rsync deletes`);
  }
});

test('the gitignore covers what now lives inside the checkout', () => {
  const ignore = read('.gitignore');
  // /bin is deliberately NOT a directory rule: bin/tukuk-os.js is tracked, and a bare
  // `bin/` would hide it (test/repo-ignore-hygiene.test.js fails on exactly that).
  for (const rule of ['/apps/', '/bin/godot*', '/game/']) {
    assert.ok(ignore.split('\n').includes(rule),
      `${rule} must be ignored: it is box-local data inside the repo, and an untracked path can refuse a merge`);
  }
  assert.ok(!ignore.split('\n').includes('/bin/'),
    'a bare /bin/ hides the tracked bin/tukuk-os.js — ignore the Godot binary, not the directory');
  // models/ was already ignored for the same reason (large weights, re-downloadable).
  assert.match(ignore, /^models\/$/m, 'models/ must stay ignored');
});

test('the migration is idempotent and refuses to merge two live trees', () => {
  // The two properties that make it safe to run from a timer on every deploy: a second run
  // is a no-op, and an ambiguous box is left alone rather than half-moved.
  assert.match(MIGRATE, /--dry-run/, 'a dry run must exist: this script moves production data');
  assert.match(MIGRATE, /already consolidated/, 'a rerun must recognise the finished state');
  assert.match(MIGRATE, /BOTH .* exist as real directories/, 'it must refuse when both sides hold data');
  assert.match(MIGRATE, /exists but is empty/,
    'an EMPTY destination must be replaced, not refused: a stale empty models/ would otherwise shadow the real weights');
  assert.match(MIGRATE, /before="\$\(find "\$legacy"/, 'it must count the tree before moving it');
  assert.match(MIGRATE, /if \[ "\$before" != "\$after" \]/, 'and verify the count after, restoring on a mismatch');
  // --prune-links must refuse while the repo still ACTS on a legacy path, or the deletion
  // removes the thing that was keeping a stale reference alive. It must not be blocked by
  // a comment that merely mentions the history, or the prune could never be run at all.
  assert.match(MIGRATE, /still used by/, 'pruning must be gated on the repo no longer using the path');
  assert.match(MIGRATE, /\[\[ "\$body" =~ \^\[\[:space:\]\]\*\(#\|\/\/\) \]\] && continue/,
    'the prune scan must skip comment lines — a history note is not a live reference');
});

test('the GCP mirror is not this box and stays out of the folder', () => {
  // /var/www/tukuk-mirror is the failover VM. One folder describes THIS machine; folding a
  // different machine's paths in here is how a restore script starts writing to the wrong host.
  assert.match(PATHS, /tukuk-mirror/, 'paths.sh must say out loud that the mirror is not on this box');
  const gcp = read('deploy', 'gcp', 'setup-mirror.sh');
  assert.match(gcp, /\/var\/www\/tukuk-mirror/, 'the mirror script keeps its own path: it runs on the VM');
});
