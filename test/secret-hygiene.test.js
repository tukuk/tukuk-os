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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.wasm',
  '.ttf', '.woff', '.woff2', '.mp4', '.mp3', '.zip', '.gz', '.apk', '.aab', '.jar', '.so',
  '.sqlite', '.sqlite-shm', '.sqlite-wal', '.pdf', '.jks', '.keystore']);

// Credential FORMATS. None of these is a secret; a line matching one of them is.
const LIVE_SHAPES = [
  [/eyJ[A-Za-z0-9_-]{18,}\./, 'a JWT (cloudflared tunnel tokens start eyJ)'],
  // …but a CONNECTOR token is NOT a JWT: it is one base64 JSON blob with no dots, written
  // under the yaml key `tunnel-token`, not the env name. That combination walked past both
  // original guards and reached a tracked file on 2026-11-01 (deploy/cloudflared/config.frozen.yml).
  // Whoever holds it points tukuk.org at their own machine, so the KEY NAME is the shape here.
  [/\btunnel[-_]token\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{20,}/, 'a cloudflared connector token (base64 JSON, no dots, under a tunnel-token key)'],
  [/(?:cfut_|gh[pousr]_|github_pat_|xox[abposr]-|AKIA)[A-Za-z0-9_-]{12,}/, 'a provider token prefix'],
  [/AIza[0-9A-Za-z_-]{20,}/, 'a Google API key'],
  // A 40+ hex run ONLY counts next to a key-shaped name. The first version of this rule
  // flagged apk/gradlew line 60, which is the upstream Gradle commit SHA inside a
  // documentation URL — a hex string that names a version of a public file. Requiring the
  // name keeps the rule able to catch a real key while refusing to guess from entropy.
  [/[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE)[A-Za-z0-9_]*[^\n]{0,40}\b[0-9a-f]{40,}\b/, 'a 40+ char hex secret assigned to a key-named variable'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY/, 'a private key'],
];

// `NAME || 'literal'` — the JS-shaped leak, and the one a KEY=value scanner cannot see.
// It gets its own rule with its own filters instead of sharing the placeholder exemption
// below, because the shape ALWAYS contains `process.env`: applying the placeholder filter
// to it made the rule dead code, silently never firing on the exact class the audit found
// in src/config.js (NASA key, OpenWeather key, admin email, 'tukuk123'). The name is
// matched case-sensitively because these are env-var names; a lowercase `token` in prose
// is not a config line.
const FALLBACK = /([A-Z0-9_]*(?:API_KEY|APIKEY|TOKEN|SECRET|PASSPHRASE|PASSWORD|PIN|ADMIN_EMAIL)[A-Z0-9_]*)\s*\|\|\s*['"]([^'"]+)['"]/;
// A password fallback is worth catching shorter than an API key: 'tukuk123' is 8 characters
// and was the admin credential of a live site.
const FALLBACK_MIN_LEN = (name) => (/(?:PASSWORD|PIN)/.test(name) ? 6 : 12);
const OBVIOUS_DOC_VALUE = /your|example|replace|placeholder|change|dummy|sample|xxxx|edit[-_]?me/i;

function isLiveFallback(line) {
  const m = line.match(FALLBACK);
  if (!m) return false;
  const [, name, literal] = m;
  if (OBVIOUS_DOC_VALUE.test(literal)) return false;
  if (literal.includes('$')) return false;                 // reads another variable
  if (!/^[A-Za-z0-9_@.:\/+ -]+$/.test(literal)) return false; // not a single-token value
  return literal.length >= FALLBACK_MIN_LEN(name);
}

// Values that are public on purpose. Each one is public because a CLIENT needs it, which
// is the only honest test for this list: if it must reach a browser or be fetchable from
// the site, secrecy was never the protection, and pretending otherwise breaks the feature.
const PUBLIC_BY_DESIGN = {
  AGENT_FREE_TOKEN: 'compiled into the Builder browser bundle (providers/tukuk.ts)',
  INDEXNOW_KEY: 'IndexNow fetches it from https://tukuk.org/<key>.txt',
  ADSENSE: 'if the owner configures a client id it ships in page source by design (none hardcoded since 2026-11-01)',
};

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((p) => p && !BINARY.has(extname(p).toLowerCase()));

function linesOf(file) {
  return readFileSync(join(ROOT, file), 'utf8').split('\n');
}

// A placeholder is allowed to look like anything; only non-placeholder text is judged.
// `process.env` is deliberately NOT in here (see isLiveFallback): the JS fallback shape
// always contains it, and exempting it here silently killed that rule.
const PLACEHOLDER = /REPLACE|CHANGE ME|YOUR_|PLACEHOLDER|EXAMPLE|xxxx|<[^>]*>|\$\{|secrets\.[A-Z]|os\.environ|getenv|\.example\/|\.\.\./i;

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

// One judgement, two users: the tree scan below and the fixture test that proves the
// rules fire. A guard nobody has demonstrated to be capable of failing is a comment.
function judgeLine(line) {
  const found = [];
  if (isLiveFallback(line)) found.push('a key hardcoded as a JS/TS fallback');
  const deliberate = Object.keys(PUBLIC_BY_DESIGN).some((k) =>
    new RegExp(`^\\s*#?\\s*${k}\\s*[:=]`).test(line)
    || new RegExp(`${k}$`).test(line.trim().split(/[=:]/)[0] || ''));
  if (PLACEHOLDER.test(line) || NOT_A_SECRET.test(line) || deliberate) return found;
  for (const [re, what] of LIVE_SHAPES) {
    if (re.test(line)) found.push(what);
  }
  return found;
}

test('no tracked file carries a live-shaped credential', () => {
  const hits = [];
  for (const file of tracked) {
    linesOf(file).forEach((line, i) => {
      for (const what of judgeLine(line)) hits.push(`${file}:${i + 1}  ${what}`);
    });
  }
  assert.deepEqual(hits, [], 'these tracked lines look like real credentials:\n' + hits.join('\n'));
});

test('the guard catches the shapes it was written for, and only those', () => {
  // A guard that has never been demonstrated to fire is a comment, so this test hands it
  // the exact lines the audit found (generic values, same shapes). It also proves the
  // other half: the exemptions are for real lines in this repo, not for convenience.
  //
  // The fixtures are ASSEMBLED, not written out — same trick as repo-identity.test.js.
  // A literal `CF_TUNNEL_TOKEN=eyJ….…` in this file would be a tracked line carrying a
  // live-shaped credential, and the first test would (correctly) fail on the guard itself.
  const JWT = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiJ0dWt1ay1vcy1hZG1pbiJ9', 'abcDEF123'].join('.');
  const CFUT = ['cfut_', 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6'].join('');
  // A shaped-but-fake connector token: eyJ + a long base64 run, NO dots — the exact form
  // the JWT rule cannot see. Assembled for the same reason as everything else here.
  const CONNECTOR = ['eyJhIjoi', 'deadbeefdeadbeef', 'deadbeefdeadbeef'].join('');
  // Fake-but-shaped secrets for the fallback fixtures. The first version of this test used
  // the real OpenWeather key as the fixture, which the new comparison test then caught:
  // "assembled from fragments" only keeps a guard honest if the fragments are not the
  // credential. 'deadbeef' repeated is the same length and charset and could not be less
  // real.
  const HEX40 = 'deadbeef'.repeat(5);
  const HEX32 = 'deadbeef'.repeat(4);
  // `NAME || 'value'` — built here so no source line of this file contains the shape.
  const fallback = (name, value) => `process.env.${name} || '${value}',`;

  const mustCatch = [
    // the class a KEY=value scanner cannot see, all four of them
    fallback('NASA_API_KEY', HEX40),
    fallback('OPENWEATHER_API_KEY', HEX32),
    fallback('ADMIN_PASSWORD', 'tukuk123'),          // 8 chars: caught by the PASSWORD floor
    fallback('ADMIN_EMAIL', 'operator.name77@gmail.com'),
    // the class a KEY=value scanner does see
    `CF_TUNNEL_TOKEN=${JWT}`,
    `tunnel-token: ${CONNECTOR}`,                     // the yaml shape that walked past the dot rule
    `CLOUDFLARE_API_TOKEN=${CFUT}`,
  ];

  // Real lines from this repo that must stay unflagged. If one of these starts failing,
  // the rule is guessing rather than matching, and the fix is a narrower shape — not a
  // new exception.
  const mustIgnore = [
    fallback('MY_API_KEY', 'your-api-key-here'),     // documented placeholder
    'GEMINI_API_KEY=REPLACE_ME',                     // .env.example
    "distributionSha256Sum='470ac12e7aa8cf1a4256945a9bc72a108ea88d733e0c435bfbf22f802b162b26'", // checksum
    'export CLOUDFLARE_API_TOKEN="$CF_API"',         // names the var, value at run time
    'INDEXNOW_KEY=bd8f2c1a4e6d7f90b3c5d8e1f2a4b6c8', // public by design
    'AGENT_FREE_TOKEN=041aab9c7d2e4f6081a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f',
    '# CLOUDFLARE_API_TOKEN (cfut_\u2026) is in env.secrets', // prose, no value
    'url = "https://example.com/api/v1"',            // not a key at all
    'tunnel-token: <paste from the box — never commit>', // the placeholder the frozen config uses
  ];

  for (const line of mustCatch) {
    assert.ok(judgeLine(line).length > 0, `should have been flagged: ${line.slice(0, 34)}\u2026`);
  }
  for (const line of mustIgnore) {
    assert.deepEqual(judgeLine(line), [], `should NOT have been flagged: ${line.slice(0, 34)}\u2026`);
  }
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

test('no value from the private half appears anywhere in the tracked tree', (t) => {
  // The shape-based rules above cannot answer the question that actually matters: IS THIS
  // VALUE STILL A SECRET? A name-based exemption can. AGENT_FREE_TOKEN is deliberately
  // public (it is compiled into the Builder bundle), so the scan ignores it — and that
  // exemption also hid the fact that its value was the SAME string as the private
  // AGENT_TOKEN, which src/agent.js checks first (line 61). Every free client was
  // therefore handed a full-tier bearer, and the private half held a value that three
  // tracked files already published. The fix for a hole like that is to compare against
  // the secret itself, not against the shape of the line it sits on.
  //
  // This can only run on a box that HAS deploy/env.secrets, which is exactly the box
  // where a mistake is cheap to make. CI has no secrets file, so it skips — and says so.
  const secretsPath = join(ROOT, 'deploy', 'env.secrets');
  if (!existsSync(secretsPath)) {
    t.skip('no deploy/env.secrets here (CI): nothing to compare the tracked tree against');
    return;
  }
  const values = readFileSync(secretsPath, 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter((m) => m && m[2].length >= 8)
    .map((m) => ({ name: m[1], value: m[2] }));
  assert.ok(values.length >= 6, `env.secrets looks truncated: only ${values.length} usable values`);

  const hits = [];
  for (const file of tracked) {
    const content = readFileSync(join(ROOT, file), 'utf8');
    for (const { name, value } of values) {
      if (!content.includes(value)) continue;
      const line = content.split('\n').findIndex((l) => l.includes(value)) + 1;
      hits.push(`${name} is in the private half and also in ${file}:${line}`);
    }
  }
  assert.deepEqual(hits, [], 'these credentials are published in git while also living in env.secrets:\n'
    + hits.join('\n') + '\nRotate the value, and remove it from the tracked file.');
});

test('make-env.sh rebuilds .env without deleting the keys it does not own', () => {
  // The one destructive thing a configuration split can do: setup-all.sh GENERATES
  // API_KEY (the mutation-route guard) and MEILI_MASTER_KEY into .env on a box that has
  // neither, and they are in neither half. A naive `--force` would drop them, and that
  // is an outage rather than a cosmetic diff — meilisearch.service reads the key through
  // EnvironmentFile=.env, so the service would come up with a key the data dir was not
  // written with: every search 403, /health still claiming "meilisearch":"available".
  // This runs the real script against a throwaway tree, because the claim is about
  // behaviour, not about a regex over the source. The credentials below are one-letter
  // fakes written into a temp directory under /tmp, never into a tracked file.
  const dir = mkdtempSync(join(tmpdir(), 'tukuk-make-env-'));
  try {
    mkdirSync(join(dir, 'deploy'));
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(join(ROOT, 'scripts', 'make-env.sh'), join(dir, 'scripts', 'make-env.sh'));
    writeFileSync(join(dir, 'deploy', 'env.defaults'), 'FOO=1\nBAR=2\n');
    writeFileSync(join(dir, 'deploy', 'env.secrets'),
      'CF_TUNNEL_TOKEN=t\nCLOUDFLARE_API_TOKEN=a\nADMIN_EMAIL=e@x.y\n'
      + 'ADMIN_PASSWORD=p\nAGENT_TOKEN=g\nBACKUP_UPLOAD_SECRET=u\n');
    writeFileSync(join(dir, '.env'), 'FOO=999\nAPI_KEY=generated-on-the-box\nMEILI_MASTER_KEY=old-key\n');

    execFileSync('bash', [join(dir, 'scripts', 'make-env.sh'), '--force'], { encoding: 'utf8' });
    const env = readFileSync(join(dir, '.env'), 'utf8');

    assert.match(env, /^FOO=1$/m, 'a value the two halves own wins over a stale .env');
    assert.match(env, /^BAR=2$/m);
    assert.match(env, /^API_KEY=generated-on-the-box$/m, 'a generated key must survive the rebuild');
    assert.match(env, /^MEILI_MASTER_KEY=old-key$/m, 'including the one meilisearch.service reads');
    // Mask the group/other bits: the property that matters is that nobody but the owner
    // can read the rebuilt .env, whatever owner-read style the box umask left behind.
    assert.equal(statSync(join(dir, '.env')).mode & 0o077, 0, 'and the result is not group/world readable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
