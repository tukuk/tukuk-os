'use strict';
// Ujian bulat-penuh WebAuthn (v14) dengan authenticator sintetik:
// daftar passkey → login assertasi ES256 → tolak main-semula.
// CBOR ditulis manual (peta kecil sahaja) supaya tiada bergantung pada
// dependencies dalaman @simplewebauthn/server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Penyoal CBOR minimal (int/text/bytes/list/map, panjang terkecil) ─────────
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

// ── Authenticator sintetik ───────────────────────────────────────────────────
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

// Nota: authenticator sebenar menghantar tandatangan ECDSA dalam format DER/ASN.1
// (bukan raw r||s) — v14 membuka DER sendiri sebelum menghantar ke WebCrypto.

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

test('webauthn v14: pendaftaran passkey sintetik lulus dan tersimpan', async () => {
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
  assert.equal(typeof stored[0].publicKey, 'string', 'publicKey disimpan sebagai base64url');
});

test('webauthn v14: login assertasi lulus → sesi; cabaran sekali-pakai', async () => {
  const auth = freshAuth();
  // daftar dahulu
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

  // kemudian log masuk
  const authOptions = await auth.startAuthentication(EMAIL);
  assert.equal(authOptions.allowCredentials[0].id, b64url(CRED_ID), 'allowCredentials id string base64url (v14)');
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
  assert.ok(typeof token === 'string' && token.length === 64, 'token sesi dikeluarkan');
  assert.equal(auth.readSession(token).email, EMAIL);
  assert.equal(auth.passkeys()[0].counter, 2, 'counter baharu tersimpan (anti-replay)');

  // main semula: cabaran sudah dipakai → 400
  await assert.rejects(
    () => auth.finishAuthentication(EMAIL, assertion, ORIGIN),
    (e) => e.statusCode === 400 && /Challenge/.test(e.message)
  );
});

test('webauthn v14: origin palsu ditolak semasa pendaftaran', async () => {
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
