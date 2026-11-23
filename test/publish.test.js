'use strict';
// Tests for the publish helpers (/builder → public /a/<slug> link). Pure — no server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const publish = require('../src/publish');

test('slugify: human name → safe slug root', () => {
  assert.equal(publish.slugify('Hello World 2!'), 'hello-world-2');
  assert.equal(publish.slugify('Ünïcode Akça'), 'unicode-akca');
  assert.equal(publish.slugify('   '), 'app', 'empty → fallback');
  assert.equal(publish.slugify('###'), 'app', 'symbols only → fallback');
});

test('slugify: length capped at 32 characters', () => {
  const long = publish.slugify('a'.repeat(50));
  assert.equal(long.length, 32);
});

test('isSlug: accepts valid formats, rejects invalid ones', () => {
  for (const ok of ['abc', 'a1-b2', 'app-9', 'my-todo-list']) assert.ok(publish.isSlug(ok), ok);
  for (const bad of ['ab', 'A-bc', '-abc', 'abc!', 'a b', 'a/b', '../../etc', '']) assert.ok(!publish.isSlug(bad), 'reject: ' + bad);
});

test('looksLikeHtml: only a full HTML document is accepted', () => {
  assert.ok(publish.looksLikeHtml('<!DOCTYPE html><html></html>'));
  assert.ok(publish.looksLikeHtml('<html lang="en">'));
  assert.ok(!publish.looksLikeHtml('<div>hi</div>'), 'a fragment is not a document');
  assert.ok(!publish.looksLikeHtml(''), 'empty is rejected');
});

test('PUBLISH_CSP: sandboxed opaque origin (NO allow-same-origin) + inline scripts', () => {
  assert.match(publish.PUBLISH_CSP, /sandbox allow-scripts/);
  assert.ok(!publish.PUBLISH_CSP.includes('allow-same-origin'), 'must stay opaque-origin (origin isolation)');
  assert.match(publish.PUBLISH_CSP, /script-src 'unsafe-inline'/, 'standalone apps rely on inline scripts');
  assert.match(publish.PUBLISH_CSP, /img-src data:/, 'dataURL images are allowed');
});

test('publicOrigin: honours x-forwarded-proto https + host', () => {
  const req = { headers: { 'x-forwarded-proto': 'https' }, secure: false, protocol: 'http', get: (h) => (h === 'host' ? 'tukuk.org' : '') };
  assert.equal(publish.publicOrigin(req), 'https://tukuk.org');
  const local = { headers: {}, secure: false, protocol: 'http', get: () => 'localhost:3000' };
  assert.equal(publish.publicOrigin(local), 'http://localhost:3000');
});

test('PUBLISH_MAX_BYTES: 4MB for a single 3D file, below the dedicated /api/publish parser limit (6MB)', () => {
  assert.equal(publish.PUBLISH_MAX_BYTES, 4 * 1024 * 1024);
  assert.ok(publish.PUBLISH_MAX_BYTES < 6 * 1024 * 1024, 'need headroom for the JSON body wrapper');
});

test('isEditKey: accepts a valid 32-char hex string, rejects anything else', () => {
  assert.ok(publish.isEditKey('0'.repeat(32)));
  assert.ok(publish.isEditKey('a1b2c3d4e5f60718293a4b5c6d7e8f90'), '32 lowercase hex');
  assert.ok(publish.isEditKey('ABCDEF0123456789ABCDEF0123456789'), 'uppercase hex is accepted');
  for (const bad of ['', 'z'.repeat(32), 'f'.repeat(31), 'f'.repeat(33), 'abc', null, undefined]) assert.ok(!publish.isEditKey(bad), 'reject: ' + bad);
});

test('extractTitle: reads <title>, sanitises whitespace, falls back and caps at 80', () => {
  assert.equal(publish.extractTitle('<!DOCTYPE html><html><head><title>My App</title></head>'), 'My App');
  assert.equal(publish.extractTitle('<TITLE>  Lots   Of   Space  </TITLE>'), 'Lots Of Space', 'case-insensitive + collapsed whitespace');
  assert.equal(publish.extractTitle('<html>no title here</html>', 'Application'), 'Application', 'fallback when there is no <title>');
  assert.equal(publish.extractTitle('<title>' + 'x'.repeat(120) + '</title>').length, 80, '80-character cap');
});

test('publishCspFor: adds a self-host connect-src, stays opaque-origin (no allow-same-origin)', () => {
  const csp = publish.publishCspFor('tukuk.org', 'https');
  assert.match(csp, /connect-src https:\/\/tukuk\.org/, 'connect-src is wired to the https host');
  assert.ok(!csp.includes('allow-same-origin'), 'must stay opaque-origin');
  const http = publish.publishCspFor('192.168.8.100:3000', 'http');
  assert.match(http, /connect-src http:\/\/192\.168\.8\.100:3000/, 'http scheme + port are preserved');
  assert.equal(publish.publishCspFor('', 'https'), publish.PUBLISH_CSP, 'no host → original CSP without connect-src');
});

// ── Comment board: pure sanitisation + UI injection (no server) ──
test('cmtSlug: valid slug passes, invalid → empty', () => {
  assert.equal(publish.cmtSlug('my-app-9'), 'my-app-9');
  for (const bad of ['ab', 'A-bc', '-abc', 'a b', '../../etc', '', null, undefined]) assert.equal(publish.cmtSlug(bad), '', 'reject: ' + bad);
});

test('cmtName: strips newlines/tabs, trims to 20, empty → Anon', () => {
  assert.equal(publish.cmtName('Ali\nBin\tQasim'), 'Ali Bin Qasim');
  assert.equal(publish.cmtName('   ').length, 4, 'empty → Anon');
  assert.equal(publish.cmtName('x'.repeat(50)).length, 20, '20-character cap');
});

test('cmtText: strips HTML tags, collapses whitespace, trims to 300', () => {
  assert.equal(publish.cmtText('<script>alert(1)<\/script> halo'), 'alert(1) halo', 'tags removed, text kept');
  assert.equal(publish.cmtText('a   b\n\nc'), 'a b c', 'whitespace runs are collapsed');
  assert.ok(publish.cmtText('<b>x</b>').indexOf('<') === -1, 'no angle bracket leaks through');
  assert.equal(publish.cmtText('y'.repeat(500)).length, 300, '300-character cap');
});

test('commentsWidget: references /api/comments + form + safely embedded SLUG', () => {
  const w = publish.commentsWidget('app-1');
  assert.ok(w.includes('/api/comments'), 'the script fetches /api/comments');
  assert.ok(w.includes('id="tc-form"'), 'the form exists');
  assert.ok(w.includes('var SLUG="app-1"'), 'the slug is embedded as a literal');
  assert.ok(w.includes('</' + 'script>'), 'the script block is closed properly');
  // Escape attempt out of the script → only alphanumerics/underscores survive, quotes and symbols are dropped.
  const evil = publish.commentsWidget('a";alert(1);//');
  assert.ok(evil.includes('var SLUG="aalert1"'), 'the slug is sanitised to alphanumerics only');
  assert.ok(!evil.includes('alert(1)'), 'code scaffolding must not leak as raw text');
  assert.ok(!evil.includes('var SLUG="a"'), 'a closing quote cannot break out of the literal');
});

test('injectComments: inserts before the last </body>; appends when there is none', () => {
  const doc = '<html><body><h1>App</h1><script>var x=1;<' + '/script></body></html>';
  const out = publish.injectComments(doc, 'app-1');
  const iBody = out.lastIndexOf('</body>');
  assert.ok(out.indexOf('id="tukuk-comments"') < iBody, 'the widget goes before </body>');
  assert.ok(out.includes('<h1>App</h1>'), 'the original content is kept');
  assert.ok(out.includes('</html>'), 'the closing structure is kept');
  const frag = publish.injectComments('<div>no body here</div>', 'zz-1');
  assert.ok(frag.includes('id="tukuk-comments"'), 'no </body> → appended at the end');
});

// ── Game genres (PURE; moved into publish.js so they can be tested without a server) ──
test('guessGameGenre: 3D takes precedence (Three.js/WebGL/open-world)', () => {
  assert.equal(publish.guessGameGenre('Neon Racer 3D'), '3d');
  assert.equal(publish.guessGameGenre('built with three.js'), '3d');
  assert.equal(publish.guessGameGenre('WebGL shooter'), '3d', 'webgl → 3d even though "shooter" is present');
  assert.equal(publish.guessGameGenre('open world survival'), '3d');
});

test('guessGameGenre: the existing branches still work', () => {
  assert.equal(publish.guessGameGenre('2048 blok'), 'teki-teki');
  assert.equal(publish.guessGameGenre('lumba kereta drift'), 'kereta');
  assert.equal(publish.guessGameGenre('Super Mola .io'), 'io');
  assert.equal(publish.guessGameGenre('totally unknown title'), 'arkad', 'arkad fallback');
});

test('normalizeGenre: synonyms + the new 3D value are normalised', () => {
  assert.equal(publish.normalizeGenre('3D'), '3d');
  assert.equal(publish.normalizeGenre('threejs'), '3d');
  assert.equal(publish.normalizeGenre('arcade'), 'arkad');
  assert.equal(publish.normalizeGenre('puzzle'), 'teki-teki');
  assert.equal(publish.normalizeGenre('no-such-genre'), null, 'unknown → null');
});

test('GENRE_UI: the 3D display label is "3D" (public surface is English)', () => {
  assert.equal(publish.GENRE_UI['3d'], '3D');
});

// ── Stateless arcade (/games): score widget + injection (PURE, no server) ──
test('arcadeWidget: has a <style> and an inline script that posts /api/score, reads /api/scores and exposes __tkScore', () => {
  const w = publish.arcadeWidget('fps3d');
  assert.ok(w.includes('<style>'), 'the panel styles are included');
  assert.ok(w.includes('/api/score'), 'the script submits scores');
  assert.ok(w.includes('/api/scores'), 'the script reads the leaderboard');
  assert.ok(w.includes('window.__tkScore'), 'the score API is exposed to the game');
  assert.ok(w.includes('var G="fps3d"'), 'the game key is embedded safely');
  assert.ok(w.includes('</' + 'script>'), 'the script block is closed properly');
  // Hostile key → unsafe characters removed (no literal break or script closing).
  const evil = publish.arcadeWidget('a";alert(1);//');
  assert.ok(evil.includes('var G="aalert1"'), 'the key is sanitised to [a-z0-9_-] only');
  assert.ok(!evil.includes('alert(1)'), 'code scaffolding must not leak through');
});

test('arcadeWidget: the generated inline JS is valid JavaScript (parse check)', () => {
  const m = publish.arcadeWidget('racer3d').match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'a script block was found');
  // new Function() wraps the parse without executing it → SyntaxError if malformed.
  assert.doesNotThrow(() => new Function(m[1]), 'the widget script must parse');
});

test('injectArcade: /store links → /games; the score widget is injected only when showScore', () => {
  const doc = '<html><body><header><a href="/store">x</a></header><script>1<\/script></body></html>';
  const on = publish.injectArcade(doc, 'soccer3d', true);
  assert.ok(on.includes('href="/games"'), 'the back link points at the arcade');
  assert.ok(!on.includes('href="/store"'), 'the old /store link is gone');
  assert.ok(on.includes('window.__tkScore'), 'the widget is injected for games');
  assert.ok(on.lastIndexOf('__tkScore') < on.lastIndexOf('</body>'), 'the widget is before </body>');
  const off = publish.injectArcade(doc, 'notes', false);
  assert.ok(!off.includes('__tkScore'), 'not a game → no score widget');
  assert.ok(off.includes('href="/games"'), 'the link is still rewritten without the widget');
});
