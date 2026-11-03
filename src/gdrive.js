/**
 * Google Drive transport for the off-site backup — and deliberately NOT
 * google-auth-library. A service-account exchange is one RS256-signed JWT and
 * one form POST; node:crypto signs it as well as any SDK, and the smaller the
 * dependency surface on this box, the less that can break at 5 a.m.
 *
 * The Drive quota belongs to the human account (tukuk.co@gmail.com): a bare
 * service account owns no storage, so a folder must be shared with it and its
 * id given in GDRIVE_FOLDER_ID. Everything uploaded goes into that folder and
 * nowhere else — the `drive.file` scope enforces exactly that, which is why
 * this token is safe to keep on the server: it can only touch files it created
 * and the one folder it was handed.
 *
 * Env (via .env on the box, never committed):
 *   GDRIVE_KEY_PATH   default /etc/tukuk-os/gdrive-key.json (root:root 600)
 *   GDRIVE_FOLDER_ID  the shared "tukuk-backups" folder id from its Drive url
 */
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The unsigned-JWT half of the assertion, split out so a test can verify the
 * signature with the matching public key instead of trusting a vendor SDK.
 */
function signAssertion(privateKeyPem, payload, signer = crypto.createSign('RSA-SHA256')) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify(payload));
  const body = `${header}.${claims}`;
  const sig = signer.update(body).sign(privateKeyPem);
  return `${body}.${b64url(sig)}`;
}

function assertionFor(key, nowSec) {
  return signAssertion(key.private_key, {
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  });
}

function request(urlStr, options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 30000,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`drive http ${res.statusCode}: ${text.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('drive request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

/** Service-account assertion -> short-lived OAuth access token. */
async function accessToken(keyPath) {
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const jwt = assertionFor(key, Math.floor(Date.now() / 1000));
  const form = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`;
  const data = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }, form);
  if (!data.access_token) throw new Error('no access token in reply');
  return data.access_token;
}

/** The multipart body Drive expects: a JSON metadata part and the media part. */
function buildMultipart(token, name, folderId, buffer, mime) {
  const boundary = `tukuk${crypto.randomBytes(8).toString('hex')}`;
  const meta = { name, mimeType: mime };
  if (folderId) meta.parents = [folderId];
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, buffer, tail]),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/related; boundary=${boundary}`,
      'content-length': head.length + buffer.length + tail.length,
    },
  };
}

/** Upload one file into the backup folder; resolves Drive's file record. */
async function upload(token, name, folderId, buffer, mime = 'application/gzip') {
  const { body, headers } = buildMultipart(token, name, folderId, buffer, mime);
  return request(UPLOAD_URL, { method: 'POST', headers }, body);
}

/**
 * The last N backups by name, newest first. Drive's list endpoint, one page,
 * ordered by createdTime desc — enough to answer "is the pipeline alive?" on
 * the admin panel without downloading anything.
 */
async function listRecent(token, folderId, limit = 14) {
  const q = `parent='${String(folderId).replace(/'/g, '')}' and trashed=false`;
  const url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q)
    + `&orderBy=createdTime%20desc&pageSize=${Math.max(1, Math.min(100, limit))}`
    + '&fields=files(id,name,size,createdTime)';
  const data = await request(url, { headers: { authorization: `Bearer ${token}` } });
  return Array.isArray(data.files) ? data.files : [];
}

module.exports = {
  SCOPE,
  signAssertion,
  assertionFor,
  accessToken,
  buildMultipart,
  upload,
  listRecent,
};
