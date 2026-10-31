'use strict';
// Unit tests for src/auth.js — focused on the real/security logic that does not need
// an actual WebAuthn browser (session lifecycle, the e-mail gate, origins, bearer).
//
// These three lines MUST stay above the requires. config.admin.email and
// bootstrapPassword have no literal fallback on purpose (see src/config.js:138 — a default
// there shipped the owner's address and a usable password into every clone), so without an
// .env they are empty and this file's gate tests assert against '' — which passed on a
// laptop that happens to have a .env and failed in CI, where none exists. Test-local values
// only; dotenv will not overwrite a variable already set, so this wins over any .env and the
// real owner credentials are never read by the suite.
process.env.ADMIN_EMAIL ||= 'owner@example.test';
process.env.ADMIN_PASSWORD ||= 'bootstrap-password-for-tests';
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

// ── isAllowedEmail (bound to config.admin.email) ──
test('isAllowedEmail: the owner e-mail passes, others are rejected', () => {
  const owner = config.admin.email;
  assert.ok(owner, 'config.admin.email must exist (default or env)');
  assert.strictEqual(auth.isAllowedEmail(owner), true);
  assert.strictEqual(auth.isAllowedEmail(owner.toUpperCase()), true); // case insensitive
  assert.strictEqual(auth.isAllowedEmail('someone-not-the-owner@example.test'), false);
});

// ── checkBootstrapPassword ──
test('checkBootstrapPassword: an exact match passes, a wrong/added X fails', () => {
  const pw = config.admin.bootstrapPassword;
  assert.ok(pw, 'the test env must supply a bootstrap password (see the header of this file)');
  assert.strictEqual(auth.checkBootstrapPassword(pw), true);
  assert.strictEqual(auth.checkBootstrapPassword(pw + 'X'), false);
  assert.strictEqual(auth.checkBootstrapPassword(''), pw ? false : false);
  // a different length must be false (against timingSafeEqual for short/long input)
  assert.strictEqual(auth.checkBootstrapPassword('x'), pw.length === 1);
});

// ── originsFor ──
test('originsFor: always includes the config origin, adds a new https one', () => {
  const base = auth.originsFor();
  assert.ok(Array.isArray(base));
  const primary = String(config.webauthn.origin).split(',')[0].trim();
  assert.ok(base.includes(primary), 'contains the configured WebAuthn origin');
  assert.ok(base.includes('http://localhost:3000'), 'contains localhost for tests');
  const withExtra = auth.originsFor('https://admin.tukuk.org');
  assert.ok(withExtra.length >= base.length);
  assert.ok(withExtra.includes('https://admin.tukuk.org'));
  // a non http(s) value is not added
  assert.deepStrictEqual(auth.originsFor('not-a-origin'), base);
});

// ── b64urlToBuf ──
test('b64urlToBuf: a Uint8Array matching the base64url buffer bytes', () => {
  const s = Buffer.from('hello tukuk').toString('base64url');
  const buf = auth.b64urlToBuf(s);
  assert.ok(buf instanceof Uint8Array);
  assert.deepStrictEqual(Buffer.from(buf).toString('base64url'), s);
});

// ── bearer ──
test('bearer: reads the Bearer header & falls back to x-admin-token', () => {
  assert.strictEqual(auth.bearer({ headers: { authorization: 'Bearer abc123' } }), 'abc123');
  assert.strictEqual(auth.bearer({ headers: { authorization: 'bearer  spaced  ' } }), 'spaced');
  assert.strictEqual(auth.bearer({ headers: { 'x-admin-token': 'tok-xyz' } }), 'tok-xyz');
  assert.strictEqual(auth.bearer({ headers: {} }), '');
});

// ── The session cycle: issue → read → revoke ──
test('session: a full issue/read/revoke round trip', () => {
  const token = auth.issueSession('owner@example.com');
  assert.match(token, /^[0-9a-f]{64}$/, 'a 32-byte hex token');
  const s = auth.readSession(token);
  assert.ok(s);
  assert.strictEqual(s.email, 'owner@example.com');
  // an unknown / empty token → null
  assert.strictEqual(auth.readSession('not-a-token'), null);
  assert.strictEqual(auth.readSession(''), null);
  assert.strictEqual(auth.readSession(null), null);
  // after revoke → dead
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
test('requireAdmin: a valid session calls next, without a session 401', () => {
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
test('requireAllowedEmail: 400 without an e-mail, 403 when wrong, next when right', () => {
  const r1 = mockRes(); let n1 = false;
  auth.requireAllowedEmail({ body: {} }, r1, () => { n1 = true; });
  assert.strictEqual(n1, false);
  assert.strictEqual(r1.statusCode, 400);

  const r2 = mockRes(); let n2 = false;
  auth.requireAllowedEmail({ body: { email: 'not-the-owner@example.test' } }, r2, () => { n2 = true; });
  assert.strictEqual(n2, false);
  assert.strictEqual(r2.statusCode, 403);

  const r3 = mockRes(); let n3 = false;
  auth.requireAllowedEmail({ body: { email: config.admin.email } }, r3, () => { n3 = true; });
  assert.strictEqual(n3, true);
});

// ── Challenges: set/take + type expiry ──
test('takeChallenge: single use, per type, null when absent', () => {
  auth.setChallenge('c@x.com', 'chal-value', 'register');
  assert.strictEqual(auth.takeChallenge('c@x.com', 'login'), null); // the wrong type → consumed (single use)
  auth.setChallenge('d@x.com', 'v2', 'authenticate');
  assert.strictEqual(auth.takeChallenge('d@x.com', 'authenticate'), 'v2');
  assert.strictEqual(auth.takeChallenge('d@x.com', 'authenticate'), null); // already taken
});
