'use strict';
// .gitignore in this repo is a production-safety file, not a tidiness file.
//
// /opt/tukuk-os is a git clone that updates itself with `git merge --ff-only`
// (scripts/auto-update.sh, on a timer). Such a merge REFUSES when a path it must write is
// modified locally, and it refuses the same way when that path exists on the box UNTRACKED
// — both measured in a scratch repo: rc=1, "The following untracked working tree files would
// be overwritten by merge", HEAD unchanged, and the same merge fast-forwards once the file is
// removed. So the moment a scratch file gets committed while an untracked copy sits on the
// server, every nightly update fails, each one exiting 0 and reporting nothing interesting —
// production quietly stops being production. Measured on the box 29 Oct 2026, its untracked
// set is three files under etc-netplan-reference/ — its `.artifacts/` carries only the five
// paths this repo means to keep — so the exposure today is a laptop-side `git add -A`, and
// the ignore rule is what makes that harmless.
//
// House precedent for the same reasoning is in .gitignore itself, on the
// public/downloads/tukuk-km*.apk rule. These tests pin the rule and the three ways I have
// personally gotten it wrong while writing it: over-matching (an unanchored `build/` also
// swallowed public/build/, i.e. shipped PWA icons), under-matching (a negated directory
// re-includes everything inside it, so new scratch there is stageable again), and a comment
// line typed without its `#`, which became a pattern and ignored the test writing this
// sentence. The last one is why the source-directory check below exists at all.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const GITIGNORE = path.join(ROOT, '.gitignore');

/** run git in this repo; safe.directory because the server clone is root-owned */
function git(args) {
  return execFileSync('git', ['-c', `safe.directory=${ROOT}`, ...args],
    { cwd: ROOT, encoding: 'utf8' });
}

/**
 * git grep exits 1 for "no matches", which is the wanted answer here, not an error.
 * `skip` is a list of pathspecs to exclude. This file has to CONTAIN the string it searches
 * for, and `git grep` only reads tracked files — so the assertion below passed on the laptop
 * (this file was still untracked when it was first run) and failed on the server, where the
 * ship had made it tracked. Same trap as the ignore rules it tests: green that came from
 * looking at nothing, and only the real deploy target exposed it.
 */
function gitGrep(pattern, skip = []) {
  const args = ['grep', '-l', '-e', pattern];
  if (skip.length) args.push('--', ...skip.map((s) => `:(exclude)${s}`));
  try {
    return git(args).trim().split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

/** git's own answer about one path, so no test re-implements pattern matching */
function ignored(p) {
  try {
    git(['check-ignore', '-q', p]);
    return true;
  } catch {
    return false;
  }
}

/** which of many paths hit an exclude rule; --no-index so tracked files are judged too */
function ignoreHits(paths) {
  try {
    return execFileSync('git',
      ['-c', `safe.directory=${ROOT}`, 'check-ignore', '--no-index', '--stdin'],
      { cwd: ROOT, encoding: 'utf8', input: paths.join('\n') + '\n' })
      .trim().split('\n').filter(Boolean);
  } catch (e) {
    // exit 1 means "nothing matched", the wanted answer; the stdout is still on the error
    if (e.status === 1) return String(e.stdout || '').trim().split('\n').filter(Boolean);
    throw e;
  }
}

const trackedArtifacts = git(['ls-files', '.artifacts']).trim().split('\n').filter(Boolean);

test('fresh scratch under .artifacts/ cannot be staged by accident', () => {
  // The whole point of the section: the next debug session can drop files here and `git add -A`
  // must not pick them up. Probed with names that do not exist yet, which git answers fine.
  assert.ok(ignored('.artifacts/some-new-probe.js'), '.artifacts/* must cover anything new');
  assert.ok(ignored('.artifacts/sub/whatever.png'), 'including a subdirectory nobody thought of');
  // The directory the negation below opens up must not silently re-open with it.
  assert.ok(ignored('.artifacts/d0a2208f-c940-48a0-ae36-17d63af3a2dd/scratch.txt'),
    'a negated directory re-includes ALL of its contents unless they are re-excluded');
});

test('the five .artifacts files that are real history stay tracked and un-ignored', () => {
  assert.deepEqual(trackedArtifacts.sort(), [
    '.artifacts/aliyun_probe.py',
    '.artifacts/d0a2208f-c940-48a0-ae36-17d63af3a2dd/deploy_iso_guide.artifact.md',
    '.artifacts/geo-fix-redirects.js',
    '.artifacts/geo-migrate.js',
    '.artifacts/sitemap-migrate.js',
  ], 'the ignore rules must not orphan committed history (or accidentally keep more of it)');
  for (const f of trackedArtifacts) assert.ok(!ignored(f), `${f} is tracked; an ignore hit hides it from status`);
});

test('the doc that cites a scratch file still cites a tracked one', () => {
  // deploy/GCP-FREE-TIER.md points a reader at a file inside the ignored tree. If that file
  // ever stops being tracked, the doc sends someone to a path that exists on one laptop only.
  const doc = fs.readFileSync(path.join(ROOT, 'deploy', 'GCP-FREE-TIER.md'), 'utf8');
  const cited = [...doc.matchAll(/`(\.artifacts\/[^`]+)`/g)].map((m) => m[1]);
  assert.ok(cited.length > 0, 'expected GCP-FREE-TIER.md to cite at least one probe script');
  for (const p of cited) {
    assert.ok(trackedArtifacts.includes(p), `${p} is cited but not tracked`);
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} is cited but not on disk`);
  }
});

test('the scratch file with a hardcoded sudo password is out of the repo root', () => {
  // tmp-survey.sh ran `echo 1 | sudo -S` — a literal password in a root-level shell script,
  // untracked and referenced by nothing. It now lives under .artifacts/, which is ignored.
  assert.ok(!fs.existsSync(path.join(ROOT, 'tmp-survey.sh')), 'it must not be back at the root');
  assert.ok(ignored('.artifacts/tmp-survey.sh'), 'and the location it moved to must be ignored');
  // Nothing else in the tracked tree may carry that shape of credential handling.
  assert.deepEqual(gitGrep('echo 1 | sudo -S', ['test/repo-ignore-hygiene.test.js']), [],
    'a tracked file pipes a password to sudo -S');
});

test('no tracked file is newly ignored — the over-match check', () => {
  // `git ls-files -i -c` is how I found that an unanchored `build/` had swallowed the shipped
  // PWA icons in public/build/. Tracked-but-ignored is exactly the state where a file stops
  // being noticed in status and eventually gets dropped without anyone deciding to.
  // The .wrangler/state sqlite files are grandfathered: they were committed before the rule
  // existed, and `git rm --cached`-ing them would make the next merge DELETE them on the box —
  // the inverse of the hazard above, and just as silent. Untracking is its own decision.
  const WRENS = /^\.wrangler\/state\//;
  const offenders = git(['ls-files', '-i', '-c', '--exclude-standard'])
    .trim().split('\n').filter(Boolean).filter((f) => !WRENS.test(f));
  assert.deepEqual(offenders, [], 'these tracked files are hidden by an ignore rule');
});

test('build output is ignored without eating delivered assets', () => {
  assert.ok(ignored('build/linux/station-break.x86_64'), 'the Godot target dir is scratch');
  assert.ok(!ignored('public/build/icon-192.png'), 'public/build/ is served to real browsers');
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'build', 'icon-192.png')), 'and is still tracked');
});

test('the ignore file states the production reason next to the rule', () => {
  // Rules that only say "scratch" get deleted by the next person pruning noise, and this one
  // is load-bearing. The comment above `.artifacts/*` has to carry the failing merge.
  const src = fs.readFileSync(GITIGNORE, 'utf8');
  const i = src.search(/^!\.artifacts\/aliyun_probe\.py/m);
  assert.notEqual(i, -1, 'the .artifacts negations are gone');
  const section = src.slice(Math.max(0, i - 1200), i);
  assert.match(section, /merge --ff-only/, 'the rule must name what it protects');
  assert.match(section, /\/opt\/tukuk-os/, 'and name the machine that would break');
});

test('no source file in test/, scripts/ or deploy/ is ignored', () => {
  // The check above can only see files that are ALREADY tracked. The gap is a new file that
  // matches a rule: `git add` needs -f for it, status never shows it, and the thing simply is
  // not in the repo while looking like it is. Writing this very file produced the case — a
  // .gitignore line meant as a comment (`test/repo-ignore-hygiene.test.js pins this list…`,
  // no leading `#`) became a pattern and ignored the test that was about to detect it.
  // Judged with --no-index, because git refuses to call a tracked file ignored otherwise.
  const paths = [];
  for (const dir of ['test', 'scripts', 'deploy']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (f.isFile() && /\.(js|sh|env)$/.test(f.name)) paths.push(`${dir}/${f.name}`);
    }
  }
  assert.ok(paths.length > 100, `expected the source dirs to still be full, saw ${paths.length} files`);
  assert.deepEqual(ignoreHits(paths), [], 'a source file is hidden by an ignore rule');
});

test('the paths measured untracked on the box cannot be staged here', () => {
  // `git status --porcelain --untracked-files=all` on /opt/tukuk-os, 29 Oct 2026: three yaml
  // files under etc-netplan-reference/, and nothing else. Those names must never become
  // tracked, so they are ignored rather than merely avoided — and this assertion is the one
  // that says why, because a reader cannot see the server from a laptop checkout.
  for (const f of ['00-installer-config.yaml', '01-network-manager-all.yaml']) {
    assert.ok(ignored(`etc-netplan-reference/${f}`), `box-local path etc-netplan-reference/${f} is stageable`);
  }
  // If this repo ever does carry one of them, that is the collision — say so loudly.
  assert.deepEqual(git(['ls-files', 'etc-netplan-reference']).trim(), '',
    'etc-netplan-reference/ is tracked here and untracked on the box: the merge will refuse');
});

test('nested clones cannot be absorbed as gitlinks', () => {
  // Each of these is a working copy with its own origin (bolt.diy → tukuk-builder,
  // Map-Ai---Version-1, tps-demo → station-break, code-server → the fork). A stray `git add .`
  // turns one into a 160000 entry whose commit exists only on this machine.
  //
  // apps/builder and game are the same hazard on the BOX: deploy/paths.sh puts the
  // Builder's clone and the game's clone INSIDE this checkout, so there they are nested
  // repos too. They do not exist in a laptop checkout, which is exactly why the rule has
  // to be written down rather than inferred from what `ls` shows here.
  for (const dir of ['bolt.diy', 'code-server', 'Map-Ai---Version-1', 'tps-demo', 'apps/builder', 'game']) {
    assert.ok(ignored(`${dir}/README.md`), `${dir}/ must stay ignored as a directory rule`);
  }
});
