// The Drive transport is hand-rolled instead of google-auth-library, so the
// hand-rolled part carries the burden of proof: a real signature, the claims
// Google requires, and a multipart body Drive will parse.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const gdrive = require('../src/gdrive.js');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const pubPem = publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();

test('the assertion is a real RS256 JWT — verifiable with the matching public key', () => {
  const payload = { iss: 'bot@x.iam.gserviceaccount.com', scope: gdrive.SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600 };
  const jwt = gdrive.signAssertion(privPem, payload);
  const [h, c, s] = jwt.split('.');
  assert.strictEqual(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'RS256');
  assert.deepStrictEqual(JSON.parse(Buffer.from(c, 'base64url').toString()), payload);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), pubPem, Buffer.from(s, 'base64url')),
    'the signature verifies — this is exactly what Google checks');
});

test('the service-account claims are the four Google demands, with a one-hour life', () => {
  const key = { private_key: privPem, client_email: 'gdrive-bot@tukuk-org-web.iam.gserviceaccount.com' };
  const jwt = gdrive.assertionFor(key, 1000);
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  assert.strictEqual(claims.iss, key.client_email);
  assert.strictEqual(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.strictEqual(claims.scope, 'https://www.googleapis.com/auth/drive.file');
  assert.strictEqual(claims.exp - claims.iat, 3600, 'one hour: the token dies with the run, not with the box');
});

test('the multipart body carries metadata with the parent folder and the bytes intact', () => {
  const buf = Buffer.from('the tar.gz bytes, pretend');
  const { body, headers } = gdrive.buildMultipart('tok', 'tukuk-data-2026-11-03.tar.gz', 'FOLDER123', buf, 'application/gzip');
  const text = body.toString('latin1');
  assert.ok(text.includes('"name":"tukuk-data-2026-11-03.tar.gz"'), 'the filename travels in the metadata part');
  assert.ok(text.includes('"parents":["FOLDER123"]'), 'and the folder it is allowed to land in');
  assert.ok(text.includes('Content-Type: application/gzip'), 'the media part declares its type');
  assert.ok(body.includes(buf), 'the payload is inside, unchanged');
  assert.strictEqual(Number(headers['content-length']), body.length, 'length agrees with the body');
  assert.strictEqual(headers.authorization, 'Bearer tok');
  const boundary = headers['content-type'].match(/boundary=(\S+)/)[1];
  assert.ok(text.endsWith(`--${boundary}--\r\n`), 'and the body closes on the boundary');
});

test('no folder id means no parents key — Drive would guess My Drive, we refuse to', () => {
  const { body } = gdrive.buildMultipart('tok', 'x.gz', '', Buffer.from('y'), 'application/gzip');
  assert.ok(!body.toString('latin1').includes('parents'), 'the script checks FOLDER_ID before ever calling this');
});
