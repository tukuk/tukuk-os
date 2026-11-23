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
const BOOT = path.join(ROOT, 'deploy/godot/cdp-boot.js');
const NGINX = path.join(ROOT, 'deploy/nginx/tukuk-play.conf');

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

test('web-head.html: every script it injects is valid JavaScript', () => {
  const html = fs.readFileSync(HEAD, 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  // The readout and the gate: a syntax error in either one breaks the boot screen for
  // every visitor and is invisible to every other test.
  assert.ok(blocks.length >= 2, `expected the readout and the gate, found ${blocks.length}`);
  // Compile without executing.
  for (const [, body] of blocks) new Function(body);
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
  const start = lines.indexOf('python3 - "$WEB_HEAD" "$SHELL_TPL" <<\'PY\'') + 1;
  assert.ok(start > 0, 'splice invocation not found');
  const py = lines.slice(start, lines.indexOf('PY', start)).join('\n');
  fs.writeFileSync(path.join(t, 'splice.py'), py);
  // The template has to be read from the per-run path the builder passes, not from a
  // fixed /tmp file: two runs (or a root run then a user run) collide on one shared name.
  assert.match(fs.readFileSync(BUILD, 'utf8'), /SHELL_TPL="\$\(mktemp /, 'the engine template must go to a per-run temp file');

  const tpl = path.join(t, 'engine-shell.html');
  fs.writeFileSync(tpl, '<head>$GODOT_HEAD_INCLUDE</head><body>engine</body>');
  let r = bash(`cd '${t}' && python3 '${t}/splice.py' '${HEAD}' '${tpl}' && cat web-shell.html`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /tb-bytes/, 'the readout has to end up inside the shell');
  assert.ok(!r.out.includes('$GODOT_HEAD_INCLUDE'), 'the placeholder must be consumed');

  // A renamed placeholder must fail the build rather than ship the stock shell: the
  // engine's own template is the one thing this cannot be re-checked after publishing.
  fs.writeFileSync(tpl, '<head>no placeholder</head>');
  r = bash(`cd '${t}' && python3 '${t}/splice.py' '${HEAD}' '${tpl}'`);
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
// The fixtures below are the shapes the 4.7 exporter actually emits, quoted from a real
// web-build/. They have to stay that way: the first version of SHELL_HTML carried a
// "mainPack" key that no real export writes, and the publisher was tested against it --
// so the script could (and did) ship a shell whose pack reference lived only in
// fileSizes, which is not what decides the URL the engine fetches.
const ENGINE_JS = [
  'const GodotAudio={sampleNodes:null,SampleNode:class SampleNode{',
  'static getSampleNode(id){if(!GodotAudio.sampleNodes.has(id)){throw new ReferenceError("no such node")}'
  + 'return GodotAudio.sampleNodes.get(id)}',
  'static getSampleNodeOrNull(id){return GodotAudio.sampleNodes.get(id)??null}',
  '}}};',
  'function _godot_audio_sample_node_exists(playbackObjectIdStrPtr){',
  'const playbackObjectId=GodotRuntime.parseString(playbackObjectIdStrPtr);',
  'return Number(GodotAudio.sampleNodes.has(playbackObjectId))}',
  'loadPromise = preloader.loadPromise(`${loadPath}.wasm`, size, true);',
  '} else if (path.endsWith(\'.wasm\')) {',
  'return `${loadPath}.wasm`;',
  'return `${loadPath}.audio.worklet.js`;',
  'return `${loadPath}.audio.position.worklet.js`;',
].join('\n');

function fakeExport(t, html) {
  const src = path.join(t, 'web-build');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'index.html'), html);
  fs.writeFileSync(path.join(src, 'index.pck'), 'packbytes');
  fs.writeFileSync(path.join(src, 'index.wasm'), 'wasmbytes');
  fs.writeFileSync(path.join(src, 'index.icon.png'), 'pngbytes');
  fs.writeFileSync(path.join(src, 'index.js'), ENGINE_JS);
  fs.writeFileSync(path.join(src, 'index.audio.worklet.js'), 'worklet bytes');
  fs.writeFileSync(path.join(src, 'index.audio.position.worklet.js'), 'position worklet bytes');
  fs.writeFileSync(path.join(src, 'index.js.debug.wasm.import'), 'editor only');
  return src;
}

const sha = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex').slice(0, 12);

// What a Godot 4.7 Web export actually writes: no mainPack, a bare script tag.
const SHELL_HTML = () => `<html><body><script src="index.js"></script><script>
const GODOT_CONFIG = {"args":[],"canvasResizePolicy":2,"executable":"index",
"fileSizes":{"index.pck":486543210,"index.wasm":34567890}};
const engine = new Engine(GODOT_CONFIG);
</script></body></html>`;

function publish(src, dest, env = {}) {
  return bash(`TUKUK_PLAY_DIR='${dest}' SKIP_LOCAL_CHECK=1 SKIP_EDGE_CHECK=1 ${env.__raw || ''} bash '${PUBLISH}' '${src}'`);
}

test('publish: aliases the pack AND writes mainPack, which is what decides the URL', () => {
  const t = scratch();
  const src = fakeExport(t, SHELL_HTML());
  const dest = path.join(t, 'www');
  const r = publish(src, dest);
  assert.equal(r.code, 0, r.out);
  const hash = sha('packbytes');
  assert.ok(fs.existsSync(path.join(dest, 'index.pck.zip')), 'the .zip alias must be published');
  assert.deepEqual(
    fs.readFileSync(path.join(dest, 'index.pck.zip')),
    fs.readFileSync(path.join(dest, 'index.pck')),
    'the alias must be byte-identical to the pack',
  );
  const out = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  // fileSizes is only a progress hint; startGame fetches `config.mainPack || exe + '.pck'`.
  // A publisher that renames the key without writing mainPack leaves the engine asking
  // for the unaliased 478 MB pack, and every other check in the script still passes.
  assert.ok(out.includes(`"mainPack":"index.pck.zip?v=pck${hash}"`), `mainPack not written:\n${out}`);
  assert.ok(out.includes(`"fileSizes":{"index.pck.zip?v=pck${hash}"`), 'the size key must follow');
  assert.ok(!out.includes('"index.pck"'), 'a bare index.pck reference would bypass the cache');
  assert.ok(!fs.existsSync(path.join(dest, 'index.html.pre-alias.bak')), 'a clean publish leaves no backup litter');
  assert.ok(fs.existsSync(path.join(dest, 'favicon.ico')), 'the shell must not 404 a favicon on every boot');
  assert.ok(!fs.existsSync(path.join(dest, 'index.js.debug.wasm.import')), '*.import sidecars are editor-only');
});

test('publish: aliases the engine binary the same way -- 39 MB of DYNAMIC is 39 MB per visitor', () => {
  const t = scratch();
  const src = fakeExport(t, SHELL_HTML());
  const dest = path.join(t, 'www');
  const r = publish(src, dest);
  assert.equal(r.code, 0, r.out);
  const hash = sha('wasmbytes');
  assert.deepEqual(
    fs.readFileSync(path.join(dest, 'index.wasm.zip')),
    fs.readFileSync(path.join(dest, 'index.wasm')),
    'the .zip alias must be byte-identical to the binary',
  );
  const js = fs.readFileSync(path.join(dest, 'index.js'), 'utf8');
  // Both request sites: the preloader (progress) and locateFile (the fallback path).
  // Not "index.wasm.zip" -- the engine builds the URL as `${loadPath}.wasm.zip`, so the
  // literal name appears nowhere in it (a grep for the name would fail forever).
  assert.equal(js.match(/\.wasm\.zip\?v=wasm/g).length, 2, 'both wasm URLs must be aliased');
  assert.ok(js.includes(`wasm.zip?v=wasm${hash}`), 'the URL must carry the binary hash');
  // The size lookup key stays bare: Engine.load reads fileSizes[`${basePath}.wasm`].
  const out = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  assert.ok(out.includes('"index.wasm":34567890'), 'renaming the wasm key kills the progress bar');
});

test('publish: versions the shell script tag with the hash of the js it just patched', () => {
  const t = scratch();
  const src = fakeExport(t, SHELL_HTML().replace('src="index.js"', 'src="index.js?v=audiofix1"'));
  const dest = path.join(t, 'www');
  assert.equal(publish(src, dest).code, 0);
  const out = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  const m = out.match(/src="index\.js\?v=js([0-9a-f]{12})"/);
  assert.ok(m, `the script tag must be versioned:\n${out}`);
  assert.ok(!out.includes('audiofix1'), 'a hand-written label must not survive; it outlives its fix');
  // Self-consistency, not a re-implementation: the label has to be the shipped bytes.
  assert.equal(m[1], sha(fs.readFileSync(path.join(dest, 'index.js'))),
    'the version must be the hash of the published js, or a rebuild serves stale code 7 days');
});

test('publish: versions the audio worklets it ships alongside the engine', () => {
  const t = scratch();
  const src = fakeExport(t, SHELL_HTML());
  const dest = path.join(t, 'www');
  assert.equal(publish(src, dest).code, 0);
  const js = fs.readFileSync(path.join(dest, 'index.js'), 'utf8');
  assert.ok(js.includes(`audio.worklet.js?v=aw${sha('worklet bytes')}`), js.slice(0, 400));
  assert.ok(js.includes(`audio.position.worklet.js?v=ap${sha('position worklet bytes')}`),
    'the position worklet too -- it is what feeds the latency readout');
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
  assert.ok(!fs.existsSync(path.join(dest, 'index.pck.zip')), 'no aliases for a build that was refused');
  assert.equal(fs.readFileSync(path.join(dest, 'index.js'), 'utf8'), ENGINE_JS,
    'the engine js must come back unpatched, not half-rewritten');
});

test('publish: refuses an export whose engine js lost the wasm anchors', () => {
  const t = scratch();
  const src = fakeExport(t, SHELL_HTML());
  // An engine upgrade that renames the loader is exactly when the alias must not be
  // dropped quietly -- the symptom is only visible on the CDN, days later.
  fs.writeFileSync(path.join(src, 'index.js'), 'no anchors here');
  const dest = path.join(t, 'www');
  const r = publish(src, dest);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /FATAL: index\.js anchors did not hold/);
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

// ── build-web.sh: the two patches that make the shipped bytes the built bytes ─────
function pyBlock(file, opener) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.indexOf(opener) + 1;
  assert.ok(start > 0, `${file}: block opener not found: ${opener}`);
  return lines.slice(start, lines.indexOf('PY', start)).join('\n');
}

test('build-web.sh: the audio patch lands on every pre-init read and aborts when an anchor moves', () => {
  const t = scratch();
  fs.writeFileSync(path.join(t, 'patch.py'), pyBlock(BUILD, 'python3 - "$PROJ/web-build/index.js" <<\'PY\''));
  const js = path.join(t, 'index.js');

  fs.writeFileSync(js, ENGINE_JS);
  let r = bash(`cd '${t}' && python3 patch.py '${js}'`);
  assert.equal(r.code, 0, r.out);
  const patched = fs.readFileSync(js, 'utf8');
  // Godot defers GodotAudio.initialize() to a user gesture, so sampleNodes is still the
  // literal `null` the class declares when WASM calls in. Each of these three reads used
  // to throw a TypeError into the engine; the third is the very first call it makes.
  assert.equal((patched.match(/sampleNodes\?\./g) || []).length, 3, `expected three guards:\n${patched}`);
  // The three reads that used to throw, by their exact unguarded form. A blanket "no
  // unguarded sampleNodes.get survives" would be wrong: inside getSampleNode the .get
  // follows the now-guarded .has, so it is only reached once the Map exists.
  for (const raw of [
    'if(!GodotAudio.sampleNodes.has(id)){',
    'static getSampleNodeOrNull(id){return GodotAudio.sampleNodes.get(id)??null}',
    'return Number(GodotAudio.sampleNodes.has(playbackObjectId))',
  ]) assert.ok(!patched.includes(raw), `an unguarded read survived: ${raw}`);
  // Idempotent: re-running the builder over an already-patched file must not fail.
  r = bash(`cd '${t}' && python3 patch.py '${js}'`);
  assert.equal(r.code, 0, 'a second pass must be a no-op, not an error: ' + r.out);

  r = bash(`cd '${t}' && printf 'engine moved on\n' > bad.js && python3 patch.py bad.js`);
  assert.notEqual(r.code, 0, 'a moved anchor must fail the build');
  assert.match(r.out, /FATAL: engine js anchors did not hold/);
});

test('build-web.sh: the download gate is wired to the engine and cannot ship half-present', () => {
  const t = scratch();
  fs.writeFileSync(path.join(t, 'gate.py'), pyBlock(BUILD, 'python3 - "$PROJ/web-build/index.html" <<\'PY\''));
  const html = path.join(t, 'index.html');
  fs.writeFileSync(html, SHELL_HTML());
  let r = bash(`cd '${t}' && python3 gate.py '${html}' && cat '${html}'`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /if \(window\.tukukGate\) \{ tukukGate\(engine\); \}/, 'the start must be deferred');
  // 500 MB spent on a page parse is the thing this prevents; the call site must not be
  // able to appear without the helper that answers it.
  const head = fs.readFileSync(HEAD, 'utf8');
  assert.ok(head.includes('window.tukukGate = function'), 'web-head.html must define the gate');
  assert.match(fs.readFileSync(BUILD, 'utf8'), /grep -q 'window\.tukukGate = function'/,
    'and the builder must assert it made it into the shell');

  r = bash(`cd '${t}' && printf 'no engine line here\n' > bare.html && python3 gate.py bare.html`);
  assert.notEqual(r.code, 0, 'a shell without the anchor must abort the build');
  assert.match(r.out, /FATAL/);
});

// ── cdp-boot.js: the only thing that proves the shipped bytes run ────────────────
test('cdp-boot.js: it drives the gate the overlay actually builds', () => {
  const drv = fs.readFileSync(BOOT, 'utf8');
  const head = fs.readFileSync(HEAD, 'utf8');
  // The selector is the seam between the two files: rename the panel in the overlay and
  // the driver stops pressing, which looks like a boot that never gets going.
  assert.ok(drv.includes("querySelector('#tb-gate button')"), 'the driver must press by the panel selector');
  assert.ok(head.includes("panel.id = 'tb-gate'"), 'the overlay must build that panel');
  assert.ok(head.includes("'<button type=\"button\">Download and play</button>'"),
    'and exactly one button inside it');
  // Compile without executing: a syntax error here would only surface as a boot proof
  // that mysteriously never runs, on a box where nothing else checks this file.
  const r = bash(`node --check '${BOOT}'`);
  assert.equal(r.code, 0, r.out);
});

test('cdp-boot.js: the allowlist silences platform noise, never engine defects', () => {
  const drv = fs.readFileSync(BOOT, 'utf8');
  const body = drv.slice(drv.indexOf('const BENIGN'), drv.indexOf('];', drv.indexOf('const BENIGN')));
  const entries = [...body.matchAll(/^\s*\/(.*?)\/[a-z]*(?:,|$)/gm).map((m) => m[1])];
  assert.ok(entries.length >= 3, `expected the measured warning classes, got ${entries.length}`);
  for (const src of entries) {
    // A catch-all here turns the boot proof into a formality: it would have hidden the
    // dangling-UID error, which is the one defect this project is looking for.
    assert.ok(!/^\.{0,2}\*?\(?\.\*\)?\/?\$?$/.test(src), `allowlist entry is a wildcard: ${src}`);
    assert.ok(!src.includes('.*'), `allowlist entry spans .*, which can swallow a defect: ${src}`);
  }
  const swallows = (line) => entries.some((src) => new RegExp(src).test(line));
  assert.ok(swallows('console: WARNING: Occlusion culling is disabled at build-time.'), 'the known noise must be silenced');
  assert.ok(!swallows('console: ERROR: Unrecognized UID: "uid://vtdn63d3ksc2".'), 'the real defect must stay fatal');
});

// ── the origin config the publisher's URLs are only fast if it agrees with ────────
// A regex location in nginx does not inherit the server-level add_header pair, and an
// alias that exists in one file but not the other is either a 404 or a 500 MB origin
// stream. Neither is visible from the machine that wrote it, so the two files are pinned
// to each other here.
test('tukuk-play.conf: serves every alias the publisher writes, and nothing unaliased', () => {
  const conf = fs.readFileSync(NGINX, 'utf8');
  const blocks = [...conf.matchAll(/location\s+([=~]\S*)\s+([^ {]+)\s*\{([^}]*)\}/g)]
    .map((m) => ({ kind: m[1], target: m[2], body: m[3] }));
  assert.ok(blocks.length >= 6, `the config parsed into ${blocks.length} locations -- the format changed`);

  for (const b of blocks) {
    if (/add_header/.test(b.body)) {
      assert.ok(/Cross-Origin-Opener-Policy/.test(b.body), `${b.target}: a location with add_header drops the inherited COOP`);
      assert.ok(/Cross-Origin-Resource-Policy/.test(b.body), `${b.target}: a location with add_header drops the inherited CORP`);
    }
  }

  // The aliases, taken from the publisher's own cp lines rather than retyped here. The
  // favicon reuse is the same shape but not a CDN workaround, so only .zip targets count.
  const pub = fs.readFileSync(PUBLISH, 'utf8');
  const aliases = [...pub.matchAll(/cp -f "\$DEST\/[^"]+" "\$DEST\/([^"]+\.zip)"/g)].map((m) => m[1]);
  assert.deepEqual(aliases, ['index.pck.zip', 'index.wasm.zip'], 'the publisher must alias exactly the two heavy artifacts');
  for (const name of aliases) {
    const b = blocks.find((x) => x.target === `/${name}`);
    assert.ok(b, `/${name} is published but the origin has no location for it`);
    // try_files, not a rewrite: a rewrite re-enters location matching and lands on the
    // =404 further down, which reads as if the alias itself were broken.
    const bare = name.replace(/\.zip$/, '').replace(/\./g, '\\.');
    assert.match(b.body, new RegExp(`try_files /${bare} =404;`), `${name} must serve the real file off disk`);
    if (name.endsWith('.wasm.zip')) {
      assert.match(b.body, /default_type application\/wasm/, 'instantiateStreaming refuses any other type');
    }
  }
  for (const bare of ['index.pck', 'index.wasm']) {
    const b = blocks.find((x) => x.kind === '=' && x.target === `/${bare}`);
    assert.ok(b && /return 404;/.test(b.body), `/${bare} must be closed; reachable, it is a DYNAMIC 500 MB door`);
  }
});
