// The repo identity test: `tukuk` is this project's one identity.
//
// Why a test and not a one-off rename: the old account appears in ~25 files (units'
// Documentation=, clone commands, the autoinstall recipe, deploy-key registration, the model
// registry, the Kaggle kernels). One copy-pasted block that still names the other account is a
// rebuild that clones a repository nobody owns, or a model pull aimed at a namespace that is not
// ours — and it fails at 04:30 on a box with no one watching.
//
// Built deliberately WITHOUT writing the name into this file: a scan that quotes the string it
// forbids fails its own rule, and the honest fix is to assemble it rather than to carve out an
// exception nobody reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OTHER_ACCOUNT = ['fevian', '448'].join('');
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'dist', 'build', 'generated', '.cache']);
const TEXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.sh', '.conf',
  '.service', '.timer', '.yml', '.yaml', '.toml', '.py', '.txt', '.jsonc', '.markdown', '']);

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (TEXT.has(extname(name)) || name === '.gitignore' || name === 'user-data') out.push(full);
  }
  return out;
}

const scan = (predicate) => {
  const hits = [];
  for (const file of files(ROOT)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (predicate(line)) hits.push(`${join('.', file.slice(ROOT.length + 1))}:${i + 1}`);
    });
  }
  return hits;
};

test('no file names the other account anywhere — GitHub, the Hub, or Kaggle', () => {
  // The first sweep rewrote GitHub URLs only and left the Hugging Face repo id plus the Kaggle
  // kernel ids alone, reasoning that those name where data physically lives. That was overruled:
  // this project's home is tukuk across all of it, and putting the data there is the project's
  // own job, not a reason to keep another account in the source.
  //
  // What it costs, written where it will be read: registry.json now points at
  // tukuk/tukuk-builder-mini, and the Hub had no models under this name when that call was
  // made — so until the model is published or moved there, scripts/hf-model-pull.sh cannot
  // download it and /api/models links a 404. The override that keeps the pipeline working in the
  // meantime is HF_REPO=<owner>/<repo>, read by kaggle-jobs/tukuk-builder-mini.py.
  assert.deepEqual(scan((line) => line.includes(OTHER_ACCOUNT)), [],
    'these lines still name the other account — this project is tukuk');
});

test('the update path agrees on one repository, everywhere', () => {
  // Every place that clones, sets an origin, or registers a deploy key must agree, because the
  // box only ever sees those strings — never the .git/config this repo was cloned with. A rebuild
  // that follows a stale one installs the archived subset and calls it current.
  const files_that_pull = ['scripts/setup-autosync.sh', 'scripts/install-from-usb.sh',
    'deploy/quick-install.sh', 'scripts/setup-all.sh', 'deploy/autoinstall/user-data'];
  for (const rel of files_that_pull) {
    const body = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(body.includes('tukuk/tukuk-os'), `${rel} must name tukuk/tukuk-os`);
    assert.doesNotMatch(body, /tukuk-os-v2\.git/, `${rel} must not still clone the archived v2 repo`);
  }
});

test('the Hub registry stays machine-readable, since it is read at request time', () => {
  // src/brain/modelhub.js parses this file on every /api/models call and server.js renders it, so
  // a hand edit that breaks the JSON takes a page down rather than failing a script.
  const registry = JSON.parse(readFileSync(join(ROOT, 'ai-models', 'registry.json'), 'utf8'));
  assert.ok(Array.isArray(registry.models) && registry.models.length > 0, 'registry must list models');
  for (const model of registry.models) {
    assert.match(model.hfRepo, /^tukuk\//, `${model.id}: the Hub repo must live under tukuk`);
    assert.ok(model.hfFile, `${model.id}: hfFile is what "installed" is derived from`);
  }
});
