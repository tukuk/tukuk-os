// Secret hygiene: what this repo publishes must never grant access.
//
// Why a test rather than a rule in someone's head: deploy/env.defaults carried the live
// Cloudflare tunnel token, the account API token, the admin credential, the agent bearer
// and the off-site upload secret for months. That is what made the repository
// un-publishable — and a tunnel token is not a mild leak, because the edge authenticates
// the TOKEN: whoever holds it can point tukuk.org at their own machine. The values now
// live in deploy/env.secrets (gitignored), merged into .env by scripts/make-env.sh.
//
// The shapes below came out of the audit that found them, including the one the first
// pass MISSED: a key written as a JS fallback (`process.env.NASA_API_KEY || '<40 chars>'`)
// is invisible to a KEY=value scanner. src/config.js had two of those plus the admin
// address and a bootstrap password.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.wasm',
  '.ttf', '.woff', '.woff2', '.mp4', '.mp3', '.zip', '.gz', '.apk', '.aab', '.jar', '.so',
  '.sqlite', '.sqlite-shm', '.sqlite-wal', '.pdf', '.jks', '.keystore']);

// Credential FORMATS. None of these is a secret; a line matching one of them is.
const LIVE_SHAPES = [
  [/eyJ[A-Za-z0-9_-]{18,}\./, 'a JWT (cloudflared tunnel tokens start eyJ)'],
  [/(?:cfut_|gh[pousr]_|github_pat_|xox[abposr]-|AKIA)[A-Za-z0-9_-]{12,}/, 'a provider token prefix'],
  [/AIza[0-9A-Za-z_-]{20,}/, 'a Google API key'],
  // A 40+ hex run ONLY counts next to a key-shaped name. The first version of this rule
  // flagged apk/gradlew line 60, which is the upstream Gradle commit SHA inside a
  // documentation URL — a hex string that names a version of a public file. Requiring the
  // name keeps the rule able to catch a real key while refusing to guess from entropy.
  [/[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE)[A-Za-z0-9_]*[^\n]{0,40}\b[0-9a-f]{40,}\b/, 'a 40+ char hex secret assigned to a key-named variable'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY/, 'a private key'],
];

// `NAME || 'literal'` / `NAME: 'literal'` where NAME is a key — the JS-shaped leak.
const LITERAL_DEFAULT = /[A-Z0-9_]*(?:API_KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSPHRASE)[A-Z0-9_]*[^|]{0,40}\|\|\s*['"][^'"]{12,}['"]/;

// Values that are public on purpose. Each one is public because a CLIENT needs it, which
// is the only honest test for this list: if it must reach a browser or be fetchable from
// the site, secrecy was never the protection, and pretending otherwise breaks the feature.
const PUBLIC_BY_DESIGN = {
  AGENT_FREE_TOKEN: 'compiled into the Builder browser bundle (providers/tukuk.ts)',
  INDEXNOW_KEY: 'IndexNow fetches it from https://tukuk.org/<key>.txt',
  ADSENSE: 'ca-pub/slot ids ship in every page source',
};

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((p) => p && !BINARY.has(extname(p).toLowerCase()));

function linesOf(file) {
  return readFileSync(join(ROOT, file), 'utf8').split('\n');
}

// A placeholder is allowed to look like anything; only non-placeholder text is judged.
const PLACEHOLDER = /REPLACE|CHANGE ME|YOUR_|PLACEHOLDER|EXAMPLE|xxxx|<[^>]*>|\$\{|secrets\.[A-Z]|process\.env|os\.environ|getenv|\.example\/|\.\.\./i;

// Two exemptions the first run of this test produced out of real lines, both legitimate:
//   • a digest. apk/gradlew pins the Gradle distribution by sha256 — 40+ hex characters
//     that look exactly like a secret and protect nothing. A checksum is verified against
//     a public download; a secret is what you must not have to check.
//   • a shell expansion. `export CLOUDFLARE_API_TOKEN="$CF_API"` and
//     `BACKUP_UPLOAD_SECRET="$(get_env BACKUP_UPLOAD_SECRET)"` (scripts/setup-all.sh) name
//     the variable they read from .env. Nothing is in the file; the value arrives at run
//     time. Exempting the SHAPE would defeat the point, so the test exempts the `$`.
const NOT_A_SECRET = /sha256|sha512|checksum|integrity|digest|distributionSha/i;
const DYNAMIC_VALUE = /=\s*["']?\$/;

test('no tracked file carries a live-shaped credential', () => {
  const hits = [];
  for (const file of tracked) {
    linesOf(file).forEach((line, i) => {
      if (PLACEHOLDER.test(line) || NOT_A_SECRET.test(line)) return;
      // The names above are exempt only for their own assignment, not for anything else.
      const deliberate = Object.keys(PUBLIC_BY_DESIGN).find((k) => new RegExp(`^\\s*#?\\s*${k}\\s*[:=]`).test(line)
        || new RegExp(`${k}$`).test(line.trim().split(/[=:]/)[0] || ''));
      if (deliberate) return;
      for (const [re, what] of LIVE_SHAPES) {
        if (re.test(line)) hits.push(`${file}:${i + 1}  ${what}`);
      }
      if (LITERAL_DEFAULT.test(line)) hits.push(`${file}:${i + 1}  a key hardcoded as a JS/TS fallback`);
    });
  }
  assert.deepEqual(hits, [], 'these tracked lines look like real credentials:\n' + hits.join('\n'));
});

test('the six access-granting names are nowhere in the tracked tree', () => {
  // Not "must not contain a value" — the NAME must not be assigned in a tracked file at
  // all. An empty `CF_TUNNEL_TOKEN=` line in a published example is what invites someone
  // to fill it in on the server and commit the result, which is exactly how this started.
  const assigned = /(?:^|\s)(CF_TUNNEL_TOKEN|CLOUDFLARE_API_TOKEN|ADMIN_PASSWORD|ADMIN_EMAIL|BACKUP_UPLOAD_SECRET)\s*[=:]\s*\S/;
  const hits = [];
  for (const file of tracked) {
    linesOf(file).forEach((line, i) => {
      if (line.trim().startsWith('#')) return; // docs may name it in prose
      if (DYNAMIC_VALUE.test(line)) return;    // it is read from .env at run time
      const m = line.match(assigned);
      if (m && !PLACEHOLDER.test(line)) hits.push(`${file}:${i + 1}  ${m[1]} has a value in a tracked file`);
    });
  }
  assert.deepEqual(hits, [], 'the private half leaked into git:\n' + hits.join('\n'));
});

test('the private half is ignored, and the merge script exists', () => {
  // The rule only holds if the file CANNOT be staged by a careless `git add -A`.
  const out = execFileSync('git', ['check-ignore', '-v', 'deploy/env.secrets'],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.match(out, /deploy\/env\.secrets/, 'deploy/env.secrets must be gitignored');
  const makeEnv = readFileSync(join(ROOT, 'scripts', 'make-env.sh'), 'utf8');
  assert.match(makeEnv, /env\.secrets/, 'make-env.sh is the single place the two halves meet');
  assert.match(makeEnv, /chmod 600/, '.env holds secrets, so it must not be world-readable');
});

test('no local runtime state is tracked', () => {
  // .wrangler/state is a miniflare dev database (and was committed, and published once).
  // It is empty scaffolding today, which is luck, not a control: the next `wrangler dev`
  // run could put real rows in a public repo.
  for (const pattern of ['.wrangler', 'meili_data', 'snapshots', 'data/']) {
    const found = tracked.filter((p) => p.startsWith(pattern));
    assert.deepEqual(found, [], `${pattern} must not be tracked (${found.join(', ')})`);
  }
});
