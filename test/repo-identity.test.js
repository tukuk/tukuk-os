// The repo identity test: tukuk is the personal home, and this project names it everywhere.
//
// Why a test and not a one-off sed: the account appears in ~20 files (units' Documentation=,
// clone commands, the autoinstall recipe, deploy-key registration, rebuild notes). One
// copy-pasted block that still says the old account is a rebuild that clones a repository
// nobody owns — and it fails at 04:30, on a box with no one watching.
//
// Scope is deliberately GitHub only. `fevian448` also appears as a Hugging Face repo owner
// and as Kaggle kernel ids, which are identities on OTHER services: those names must match
// where the weights and kernels actually live, so renaming them here would trade a stale
// URL for a 404. Those are checked in the second test, which asserts they were left alone
// on purpose rather than by accident.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'dist', 'build', 'generated', '.cache']);
const TEXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.sh', '.conf',
  '.service', '.timer', '.yml', '.yaml', '.toml', '.py', '.txt', '.jsonc', '.markdown', '']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (TEXT.has(extname(name)) || name === '.gitignore' || name === 'user-data') out.push(full);
  }
  return out;
}

const GITHUB_OLD_ACCOUNT = /(?:github\.com[:/]|api\.github\.com\/repos\/|raw\.githubusercontent\.com\/)fevian448(?:[/"]|$)/;

test('no GitHub URL in the repo names the old account', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const body = readFileSync(file, 'utf8');
    body.split('\n').forEach((line, i) => {
      if (GITHUB_OLD_ACCOUNT.test(line)) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    'these lines point at the old GitHub account — this project lives under tukuk');
});

test('the non-GitHub identities are left where the data actually lives', () => {
  // Hugging Face answered with an empty model list for `tukuk` when this was written, so
  // these two must keep naming the owner that holds the weights. Kaggle kernel ids are
  // account-bound the same way: `kaggle kernels push` targets the pushing account.
  const registry = readFileSync(join(ROOT, 'ai-models', 'registry.json'), 'utf8');
  assert.match(registry, /"hfRepo":\s*"fevian448\/tukuk-builder-mini"/,
    'the Hub repo id is a location, not branding: changing it without moving the weights gives a 404 mid-download');
  const job = readFileSync(join(ROOT, 'kaggle-jobs', 'tukuk-builder-mini.py'), 'utf8');
  assert.match(job, /"fevian448\/tukuk-builder-mini"/, 'same for the training job that publishes those weights');
});

test('the one repo named in the update path is the one the box pulls', () => {
  // Every place that sets an origin, clones, or registers a deploy key must agree, because
  // the box only ever sees those strings — never the .git/config this repo was cloned with.
  const expect = 'tukuk/tukuk-os';
  const files = ['scripts/setup-autosync.sh', 'scripts/install-from-usb.sh', 'deploy/quick-install.sh'];
  for (const rel of files) {
    const body = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(body.includes(expect), `${rel} must name ${expect}`);
    assert.doesNotMatch(body, /tukuk-os-v2\.git/, `${rel} must not still clone the archived v2 repo`);
  }
});
