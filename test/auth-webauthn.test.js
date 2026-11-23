'use strict';
// Full-round WebAuthn (v14) tests with a synthetic authenticator:
// register a passkey → log in with an ES256 assertion → reject a replay.
// CBOR is written by hand (only a small map) so there is no dependency on
// @simplewebauthn/server internals.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── A minimal CBOR writer (int/text/bytes/list/map, shortest length) ─────────
function cborHead(major, n) {
  const m = major << 5;
  if (n < 24) return Buffer.from([m | n]);
  if (n < 0x100) return Buffer.from([m | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = m | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = m | 26; b.writeUInt32BE(n, 1); return b;
}
function cborInt(n) {
  return n >= 0 ? cborHead(0, n) : cborHead(1, -n - 1);
}
function cborBytes(buf) { return Buffer.concat([cborHead(2, buf.length), buf]); }
function cborText(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([cborHead(3, b.length), b]); }
function cborMap(entries) {
  const parts = [cborHead(5, entries.length)];
  for (const [k, v] of entries) parts.push(typeof k === 'number' ? cborInt(k) : cborText(k), v);
  return Buffer.concat(parts);
}

// ── The synthetic authenticator ─────────────────────────────────────────────────
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = publicKey.export({ format: 'jwk' });
const X = Buffer.from(jwk.x, 'base64url');
const Y = Buffer.from(jwk.y, 'base64url');
const COSE_PUB = cborMap([[1, cborInt(2)], [3, cborInt(-7)], [-1, cborInt(1)], [-2, cborBytes(X)], [-3, cborBytes(Y)]]);
const CRED_ID = crypto.randomBytes(16);
const RP_ID = 'tukuk.org';
const ORIGIN = 'https://tukuk.org';
const EMAIL = 'owner@tukuk.org';

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

// Note: a real authenticator sends the ECDSA signature in DER/ASN.1 format
// (not raw r||s) — v14 parses the DER itself before handing it to WebCrypto.

function makeAuthData(counter, payload) {
  const flags = Buffer.from([payload ? 0x45 : 0x05]); // reg: UP|UV|AT · auth: UP|UV
  const ctr = Buffer.alloc(4);
  ctr.writeUInt32BE(counter, 0);
  const parts = [sha256(Buffer.from(RP_ID)), flags, ctr];
  if (payload) {
    parts.push(Buffer.alloc(16)); // aaguid
    const len = Buffer.alloc(2);
    len.writeUInt16BE(CRED_ID.length, 0);
    parts.push(len, CRED_ID, payload);
  }
  return Buffer.concat(parts);
}

function freshAuth() {
  const storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-wa-')), 'store.json');
  process.env.STORE_PATH = storePath;
  process.env.WEBAUTHN_RP_ID = RP_ID;
  process.env.WEBAUTHN_ORIGIN = ORIGIN;
  process.env.ADMIN_EMAIL = EMAIL;
  process.env.ADMIN_PASSWORD = 'bootstrap-123';
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/src/')) delete require.cache[k];
  }
  return require('../src/auth');
}

test('webauthn v14: a synthetic passkey registration passes and is stored', async () => {
  const auth = freshAuth();
  const options = await auth.startRegistration(EMAIL);
  assert.ok(typeof options.challenge === 'string' && options.challenge.length > 20, 'challenge base64url string');

  const clientDataJSON = b64url(Buffer.from(JSON.stringify({
    type: 'webauthn.create', challenge: options.challenge, origin: ORIGIN
  })));
  const attestationObject = cborMap([
    ['fmt', cborText('none')],
    ['authData', cborBytes(makeAuthData(1, COSE_PUB))],
    ['attStmt', cborMap([])]
  ]);
  const credential = {
    id: b64url(CRED_ID), rawId: b64url(CRED_ID), type: 'public-key',
    response: { attestationObject: b64url(attestationObject), clientDataJSON }
  };
  const result = await auth.finishRegistration(EMAIL, credential, ORIGIN);
  assert.equal(result.id, b64url(CRED_ID));
  const stored = auth.passkeys();
  assert.equal(stored.length, 1);
  assert.equal(typeof stored[0].publicKey, 'string', 'publicKey is stored as base64url');
});

test('webauthn v14: an assertion login passes → a session; the challenge is single-use', async () => {
  const auth = freshAuth();
  // register first
  const regOptions = await auth.startRegistration(EMAIL);
  const regClientData = b64url(Buffer.from(JSON.stringify({
    type: 'webauthn.create', challenge: regOptions.challenge, origin: ORIGIN
  })));
  const attObj = cborMap([
    ['fmt', cborText('none')],
    ['authData', cborBytes(makeAuthData(1, COSE_PUB))],
    ['attStmt', cborMap([])]
  ]);
  await auth.finishRegistration(EMAIL, {
    id: b64url(CRED_ID), rawId: b64url(CRED_ID), type: 'public-key',
    response: { attestationObject: b64url(attObj), clientDataJSON: regClientData }
  }, ORIGIN);

  // then log in
  const authOptions = await auth.startAuthentication(EMAIL);
  assert.equal(authOptions.allowCredentials[0].id, b64url(CRED_ID), 'allowCredentials id is a base64url string (v14)');
  const clientDataHash = sha256(Buffer.from(JSON.stringify({
    type: 'webauthn.get', challenge: authOptions.challenge, origin: ORIGIN
  })));
  const authData = makeAuthData(2, null);
  const signature = crypto.sign(null, Buffer.concat([authData, clientDataHash]), privateKey);
  const assertion = {
    id: b64url(CRED_ID), rawId: b64url(CRED_ID), type: 'public-key',
    response: {
      authenticatorData: b64url(authData),
      clientDataJSON: b64url(Buffer.from(JSON.stringify({
        type: 'webauthn.get', challenge: authOptions.challenge, origin: ORIGIN
      }))),
      signature: b64url(signature),
      userHandle: null
    }
  };
  const token = await auth.finishAuthentication(EMAIL, assertion, ORIGIN);
  assert.ok(typeof token === 'string' && token.length === 64, 'a session token is issued');
  assert.equal(auth.readSession(token).email, EMAIL);
  assert.equal(auth.passkeys()[0].counter, 2, 'the new counter is stored (anti-replay)');

  // replay: the challenge is already used → 400
  await assert.rejects(
    () => auth.finishAuthentication(EMAIL, assertion, ORIGIN),
    (e) => e.statusCode === 400 && /Challenge/.test(e.message)
  );
});

test('webauthn v14: a forged origin is rejected during registration', async () => {
  const auth = freshAuth();
  const options = await auth.startRegistration(EMAIL);
  const clientDataJSON = b64url(Buffer.from(JSON.stringify({
    type: 'webauthn.create', challenge: options.challenge, origin: 'https://evil.example'
  })));
  const attObj = cborMap([
    ['fmt', cborText('none')],
    ['authData', cborBytes(makeAuthData(1, COSE_PUB))],
    ['attStmt', cborMap([])]
  ]);
  await assert.rejects(
    () => auth.finishRegistration(EMAIL, {
      id: b64url(CRED_ID), rawId: b64url(CRED_ID), type: 'public-key',
      response: { attestationObject: b64url(attObj), clientDataJSON }
    }, ORIGIN),
    (e) => e.statusCode === 400
  );
});
