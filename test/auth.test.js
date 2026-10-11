'use strict';
// Ujian unit src/auth.js — fokus logik tulen/keselamatan yang tidak memerlukan
// I/O pelayar WebAuthn sebenar (kewujudan sesi, gerbang e-mel, origin, bearer).
const { test } = require('node:test');
const assert = require('node:assert');

const auth = require('../src/auth');
const config = require('../src/config');

// ── normalizeEmail ──
test('normalizeEmail: trim + lowercase', () => {
  assert.strictEqual(auth.normalizeEmail('  FeViAn@Example.COM  '), 'fevian@example.com');
  assert.strictEqual(auth.normalizeEmail(null), '');
  assert.strictEqual(auth.normalizeEmail(undefined), '');
});

// ── isAllowedEmail (terikat pada config.admin.email) ──
test('isAllowedEmail: e-mel pemilik lulus, lain ditolak', () => {
  const owner = config.admin.email;
  assert.ok(owner, 'config.admin.email mestilah ada (default atau env)');
  assert.strictEqual(auth.isAllowedEmail(owner), true);
  assert.strictEqual(auth.isAllowedEmail(owner.toUpperCase()), true); // tak peka kes
  assert.strictEqual(auth.isAllowedEmail('seseorang-yang-bukan-pemilik@example.test'), false);
});

// ── checkBootstrapPassword ──
test('checkBootstrapPassword: padan tepat lulus, salah/x lwn gagal', () => {
  const pw = config.admin.bootstrapPassword;
  assert.strictEqual(auth.checkBootstrapPassword(pw), true);
  assert.strictEqual(auth.checkBootstrapPassword(pw + 'X'), false);
  assert.strictEqual(auth.checkBootstrapPassword(''), pw ? false : false);
  // panjang berbeza mestilah false (lwn timingSafeEqual pendek/panjang)
  assert.strictEqual(auth.checkBootstrapPassword('x'), pw.length === 1);
});

// ── originsFor ──
test('originsFor: sentiasa sertakan origin config, tambah https baharu', () => {
  const base = auth.originsFor();
  assert.ok(Array.isArray(base));
  const primary = String(config.webauthn.origin).split(',')[0].trim();
  assert.ok(base.includes(primary), 'mengandungi origin WebAuthn config');
  assert.ok(base.includes('http://localhost:3000'), 'mengandungi localhost untuk ujian');
  const withExtra = auth.originsFor('https://admin.tukuk.org');
  assert.ok(withExtra.length >= base.length);
  assert.ok(withExtra.includes('https://admin.tukuk.org'));
  // bukan http(s) tidak ditambah
  assert.deepStrictEqual(auth.originsFor('not-a-origin'), base);
});

// ── b64urlToBuf ──
test('b64urlToBuf: Uint8Array padan bait Buffer base64url', () => {
  const s = Buffer.from('hello tukuk').toString('base64url');
  const buf = auth.b64urlToBuf(s);
  assert.ok(buf instanceof Uint8Array);
  assert.deepStrictEqual(Buffer.from(buf).toString('base64url'), s);
});

// ── bearer ──
test('bearer: baca Bearer header & fallback x-admin-token', () => {
  assert.strictEqual(auth.bearer({ headers: { authorization: 'Bearer abc123' } }), 'abc123');
  assert.strictEqual(auth.bearer({ headers: { authorization: 'bearer  spaced  ' } }), 'spaced');
  assert.strictEqual(auth.bearer({ headers: { 'x-admin-token': 'tok-xyz' } }), 'tok-xyz');
  assert.strictEqual(auth.bearer({ headers: {} }), '');
});

// ── Kitaran sesi: issue → read → revoke ──
test('session: issue/read/revoke bulat penuh', () => {
  const token = auth.issueSession('pemilik@example.com');
  assert.match(token, /^[0-9a-f]{64}$/, 'token hex 32 bait');
  const s = auth.readSession(token);
  assert.ok(s);
  assert.strictEqual(s.email, 'pemilik@example.com');
  // token tak dikenali / kosong → null
  assert.strictEqual(auth.readSession('bukan-token'), null);
  assert.strictEqual(auth.readSession(''), null);
  assert.strictEqual(auth.readSession(null), null);
  // selepas revoke → mati
  auth.revokeSession(token);
  assert.strictEqual(auth.readSession(token), null);
});

// ── requireAdmin middleware ──
function mockRes() {
  const res = { statusCode: 0, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
test('requireAdmin: sesi sah panggil next, tanpa sesi 401', () => {
  const token = auth.issueSession('a@b.com');
  const req = { headers: { authorization: 'Bearer ' + token } };
  const res = mockRes();
  let nexted = false;
  auth.requireAdmin(req, res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
  assert.strictEqual(req.admin.email, 'a@b.com');
  auth.revokeSession(token);

  const bad = { headers: {} };
  const res2 = mockRes();
  let nexted2 = false;
  auth.requireAdmin(bad, res2, () => { nexted2 = true; });
  assert.strictEqual(nexted2, false);
  assert.strictEqual(res2.statusCode, 401);
});

// ── requireAllowedEmail middleware ──
test('requireAllowedEmail: 400 tanpa e-mel, 403 salah, next betul', () => {
  const r1 = mockRes(); let n1 = false;
  auth.requireAllowedEmail({ body: {} }, r1, () => { n1 = true; });
  assert.strictEqual(n1, false);
  assert.strictEqual(r1.statusCode, 400);

  const r2 = mockRes(); let n2 = false;
  auth.requireAllowedEmail({ body: { email: 'bukan-pemilik@example.test' } }, r2, () => { n2 = true; });
  assert.strictEqual(n2, false);
  assert.strictEqual(r2.statusCode, 403);

  const r3 = mockRes(); let n3 = false;
  auth.requireAllowedEmail({ body: { email: config.admin.email } }, r3, () => { n3 = true; });
  assert.strictEqual(n3, true);
});

// ── Cabaran: set/take + luput jenis ──
test('takeChallenge: sekali pakai, ikut jenis, null bila tiada', () => {
  auth.setChallenge('c@x.com', 'chal-value', 'register');
  assert.strictEqual(auth.takeChallenge('c@x.com', 'login'), null); // jenis salah → dimakan (sekali pakai)
  auth.setChallenge('d@x.com', 'v2', 'authenticate');
  assert.strictEqual(auth.takeChallenge('d@x.com', 'authenticate'), 'v2');
  assert.strictEqual(auth.takeChallenge('d@x.com', 'authenticate'), null); // sudah diambil
});
