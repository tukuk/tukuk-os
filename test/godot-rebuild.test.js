'use strict';
// Tests for the two files that make play.tukuk.org reproducible from git alone:
// deploy/godot/build-web.sh (the export builder, rescued into git after the box that
// held the only copy was wiped) and deploy/godot/publish-tukuk-play.sh (the publisher
// that enforces the Cloudflare Free cache contract).
//
// Neither can be run end to end here — that needs a Godot binary, export templates and
// a running nginx — so these tests execute the DECISION parts of them directly: the
// blocks are extracted from the committed scripts by anchor, not retyped, so a test
// cannot quietly start passing against code that no longer ships.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'deploy/godot/build-web.sh');
const PUBLISH = path.join(ROOT, 'deploy/godot/publish-tukuk-play.sh');
const HEAD = path.join(ROOT, 'deploy/godot/web-head.html');

// Extract a block from a script by its first and last line (exact match), so the test
// runs the shipped bytes rather than a copy that can drift.
function block(file, first, last) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const a = lines.indexOf(first);
  assert.notEqual(a, -1, `${file}: anchor line not found: ${first}`);
  const b = lines.indexOf(last, a);
  assert.notEqual(b, -1, `${file}: end line not found: ${last}`);
  return lines.slice(a, b + 1).join('\n');
}

function bash(script, env = {}) {
  try {
    return { code: 0, out: execFileSync('/bin/bash', ['-c', script], { env: { ...process.env, ...env } }).toString() };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout?.toString() || '') + (e.stderr?.toString() || '') };
  }
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-godot-'));
}

// ── the boot overlay itself ──────────────────────────────────────────────────────
test('web-head.html: the fragment is the production one, not the pre-fix draft', () => {
  const html = fs.readFileSync(HEAD, 'utf8');
  assert.ok(html.includes('id = \'tb-bytes\''), 'overlay must create the readout element');
  // The two defects tmp-fix-overlay.py was written to repair. If either anchor reappears
  // the file has been replaced by the older draft and the readout flashes "0 MB / 0 MB".
  assert.ok(!html.includes('bar.max || manifest'), 'stale max fallback: the bare <progress> reports max==1');
  assert.ok(html.includes('if (max < MB) {'), 'the manifest fallback has to be size-gated');
  assert.ok(!html.includes('html/head_include. Godot'), 'comment must not send readers to the ignored preset key');
  assert.ok(html.includes('custom_html_shell'), 'comment must name the key that actually works');
});

test('web-head.html: its script is valid JavaScript', () => {
  const html = fs.readFileSync(HEAD, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'no <script> block found');
  // Compile without executing — a syntax error here would break the game boot screen
  // for every visitor and is invisible to every other test.
  new Function(m[1]);
});

// ── build-web.sh: which overlay gets spliced in ──────────────────────────────────
test('build-web.sh: overlay resolution prefers the box copy, falls back to git, refuses with none', () => {
  const t = scratch();
  const proj = path.join(t, 'proj');
  const selfdir = path.join(t, 'self');
  fs.mkdirSync(proj);
  fs.mkdirSync(selfdir);
  fs.copyFileSync(HEAD, path.join(selfdir, 'web-head.html'));
  const code = block(BUILD, 'if [ -z "${WEB_HEAD:-}" ]; then', 'echo "overlay: $WEB_HEAD"')
    + "\nprintf 'RESOLVED=%s\\n' \"$WEB_HEAD\"\n";
  // SELF/PROJ are the script's own variables; WEB_HEAD is cleared the way a fresh shell
  // would have it, and `set -e` is on because setup-all.sh runs the builder under it.
  const run = () => bash(`set -euo pipefail; PROJ='${proj}'; SELF='${selfdir}'; WEB_HEAD=''
     ${code}`);
  // 1. no project copy -> the committed copy beside the builder
  let r = run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`RESOLVED=${selfdir}/web-head\\.html`), 'must fall back to the git copy');
  // 2. project copy present -> it wins, so work in progress on a live box still builds
  fs.copyFileSync(HEAD, path.join(proj, 'web-head.html'));
  r = run();
  assert.match(r.out, new RegExp(`RESOLVED=${proj}/web-head\\.html`), 'the box copy must take precedence');
  // 3. neither -> hard failure, never a silent bare shell
  fs.rmSync(path.join(proj, 'web-head.html'));
  fs.rmSync(path.join(selfdir, 'web-head.html'));
  r = run();
  assert.notEqual(r.code, 0, 'missing overlay must abort');
  assert.match(r.out, /FATAL: no boot overlay found/);
});

test('build-web.sh: the splice injects the overlay and aborts if the engine template changed', () => {
  const t = scratch();
  // The python body, taken verbatim from between the heredoc markers.
  const lines = fs.readFileSync(BUILD, 'utf8').split('\n');
  const start = lines.indexOf('python3 - "$WEB_HEAD" <<\'PY\'') + 1;
  assert.ok(start > 0, 'splice invocation not found');
  const py = lines.slice(start, lines.indexOf('PY', start)).join('\n');
  fs.writeFileSync(path.join(t, 'splice.py'), py);

  fs.writeFileSync('/tmp/godot-shell.template', '<head>$GODOT_HEAD_INCLUDE</head><body>engine</body>');
  let r = bash(`cd '${t}' && python3 '${t}/splice.py' '${HEAD}' && cat web-shell.html`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /tb-bytes/, 'the readout has to end up inside the shell');
  assert.ok(!r.out.includes('$GODOT_HEAD_INCLUDE'), 'the placeholder must be consumed');

  // A renamed placeholder must fail the build rather than ship the stock shell: the
  // engine's own template is the one thing this cannot be re-checked after publishing.
  fs.writeFileSync('/tmp/godot-shell.template', '<head>no placeholder</head>');
  r = bash(`cd '${t}' && python3 '${t}/splice.py' '${HEAD}'`);
  assert.notEqual(r.code, 0, 'a shell without the placeholder must abort');
  assert.match(r.out, /FATAL/);
});

test('build-web.sh: the export preset uses the exclusions that keep the pack under 512 MB', () => {
  const src = fs.readFileSync(BUILD, 'utf8');
  assert.match(src, /EXCLUDES='[^']*level\/level\.exr/, 'the 97 MB unreferenced texture must stay excluded');
  assert.match(src, /html\/custom_html_shell="res:\/\/web-shell\.html"/, 'the generated shell has to be the one exported');
  assert.match(src, /grep -q "tb-bytes"/, 'the builder must assert its own overlay instead of shipping blind');
});

test('build-web.sh: --deploy delegates to the publisher the sudoers grant actually allows', () => {
  const src = fs.readFileSync(BUILD, 'utf8');
  // Two failures hidden in one line: `sudo cp` is not in /etc/sudoers.d/tukuk-play, so a
  // detached build would die on authorization; and even where sudo is broad, copying the
  // artifacts by hand skips the index.pck.zip alias, quietly un-caching the pack.
  assert.ok(!/sudo cp|sudo chmod/.test(src), 'the builder may not publish by hand');
  assert.match(src, /sudo "\$PUB" "\$PROJ\/web-build"/, 'it must call the granted publisher');
  const sudoers = fs.readFileSync(path.join(ROOT, 'deploy/godot/sudoers-tukuk-play'), 'utf8');
  assert.match(sudoers, /^tukuk ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/publish-tukuk-play$/m,
    'the grant covers exactly the script the builder calls');
});

// ── publish-tukuk-play.sh: the CDN contract ──────────────────────────────────────
function fakeExport(t, html) {
  const src = path.join(t, 'web-build');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'index.html'), html);
  fs.writeFileSync(path.join(src, 'index.pck'), 'packbytes');
  fs.writeFileSync(path.join(src, 'index.wasm'), 'wasmbytes');
  fs.writeFileSync(path.join(src, 'index.icon.png'), 'pngbytes');
  fs.writeFileSync(path.join(src, 'index.js'), 'js');
  fs.writeFileSync(path.join(src, 'index.js.debug.wasm.import'), 'editor only');
  return src;
}

const SHELL_HTML = () => `<html><body><script>
const GODOT_CONFIG = {"args":[],"canvasResizePolicy":2,"executable":"index",
"virtualFileSystem":{"index":{"loadDeferred":false,"remote":false}},
"mainPack":"index.pck",
"fileSizes":{"index.pck":486543210,"index.wasm":34567890}};
</script></body></html>`;

function publish(src, dest, env = {}) {
  return bash(`TUKUK_PLAY_DIR='${dest}' SKIP_LOCAL_CHECK=1 SKIP_EDGE_CHECK=1 ${env.__raw || ''} bash '${PUBLISH}' '${src}'`);
}

test('publish: aliases the pack to index.pck.zip?v=pck<hash> so the CDN can hold it', () => {
  const t = scratch();
  const src = fakeExport(t, SHELL_HTML());
  const dest = path.join(t, 'www');
  const r = publish(src, dest);
  assert.equal(r.code, 0, r.out);
  const hash = require('node:crypto').createHash('sha256').update('packbytes').digest('hex').slice(0, 12);
  assert.ok(fs.existsSync(path.join(dest, 'index.pck.zip')), 'the .zip alias must be published');
  assert.deepEqual(
    fs.readFileSync(path.join(dest, 'index.pck.zip')),
    fs.readFileSync(path.join(dest, 'index.pck')),
    'the alias must be byte-identical to the pack',
  );
  const out = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  assert.ok(out.includes(`"mainPack":"index.pck.zip?v=pck${hash}"`), `mainPack not aliased:\n${out}`);
  // fileSizes key is renamed to the same string, so any lookup by mainPack still matches.
  assert.ok(!out.includes('"index.pck"'), 'a bare index.pck reference would bypass the cache');
  assert.ok(!fs.existsSync(path.join(dest, 'index.html.pre-pckzip.bak')), 'a clean publish leaves no backup litter');
  assert.ok(fs.existsSync(path.join(dest, 'favicon.ico')), 'the shell must not 404 a favicon on every boot');
  assert.ok(!fs.existsSync(path.join(dest, 'index.js.debug.wasm.import')), '*.import sidecars are editor-only');
});

test('publish: refuses to ship when it finds no pack reference, and leaves the shell untouched', () => {
  const t = scratch();
  const src = fakeExport(t, '<html>engine format changed, no pack token here</html>');
  const dest = path.join(t, 'www');
  const r = publish(src, dest);
  assert.notEqual(r.code, 0, 'an unaliased pack means origin streaming; it must not pass silently');
  assert.match(r.out, /FATAL: no mainPack reference/);
  const out = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  assert.ok(out.includes('engine format changed'), 'the refusal must restore the original shell');
  assert.ok(!out.includes('index.pck.zip'), 'and leave no half-applied rewrite');
});

test('publish: blocks a pack over the 512 MB CDN limit', () => {
  const t = scratch();
  const src = fakeExport(t, SHELL_HTML());
  // Sparse file: the size check reads the logical length, so this costs no disk.
  execFileSync('/bin/bash', ['-c', `truncate -s 600M '${path.join(src, 'index.pck')}'`]);
  const dest = path.join(t, 'www');
  const r = publish(src, dest);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /above the 512 MB CDN cache limit/);
  const allowed = publish(src, dest, { __raw: 'ALLOW_BIG_PACK=1' });
  assert.equal(allowed.code, 0, allowed.out);
});

test('publish: rejects an unfinished export before it can replace a working game', () => {
  const t = scratch();
  const src = path.join(t, 'web-build');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'index.html'), '<html></html>');
  const dest = path.join(t, 'www');
  const r = publish(src, dest);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /index\.pck missing -- export did not finish/);
  assert.equal(fs.existsSync(dest), false, 'nothing may be created for a rejected export');
});
