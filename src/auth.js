/**
 * auth.js — Kawalan akses pentadbir Tukuk-OS.
 *
 * Dasar keselamatan:
 *   1. HANYA satu e-mel dibenarkan (config.admin.email). E-mel lain ditolak.
 *   2. Login harian menggunakan WebAuthn PASSKEY (biometrik/peranti).
 *   3. Kata laluan bootstrap (config.admin.bootstrapPassword) hanya dipakai
 *      SEKALI untuk mendaftarkan passkey pertama (atau menambah passkey baru
 *      daripada dalam papan pemuka yang sudah dibuka kuncinya).
 *   4. Selepas login berjaya, satu token sesi rawak dikeluarkan dan disimpan
 *      dalam memori dengan TTL. Semua route /api/admin/* memerlukannya.
 *
 * WebAuthn disahkan menggunakan pustaka @simplewebauthn/server (CBOR/COSE yang
 * diaudit) — bukan pelaksanaan sendiri, supaya selamat untuk pelayan awam.
 */

const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const config = require('./config');
const store = require('./store');

const RP_ID = config.webauthn.rpID;
const RP_NAME = config.webauthn.rpName;
// Origin yang dibenarkan untuk WebAuthn. WEBAUTHN_ORIGIN boleh mengandungi
// senarai dipisahkan koma (cth: https://tukuk.org,https://dashboard.tukuk.org).
// localhost/127.0.0.1 (dengan port tempatan) sentiasa dibenarkan untuk ujian.
const EXPECTED_ORIGIN = config.webauthn.origin;
const EXPECTED_ORIGINS = String(EXPECTED_ORIGIN)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
for (const host of ['localhost', '127.0.0.1']) {
  for (const port of [config.port, 3000, 8080]) {
    EXPECTED_ORIGINS.push(`http://${host}:${port}`);
  }
  EXPECTED_ORIGINS.push(`http://${host}`, `https://${host}`);
}
const ALLOWED_EMAIL = String(config.admin.email || '').trim().toLowerCase();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Origin tambahan daripada permintaan semasa. Pengesahan WebAuthn TETAP terikat
// pada rpID (tukuk.org) — domain lain tidak boleh mengeluarkan assertion untuk rpID
// ini (browser sekat), jadi menerima origin peminta adalah selamat dan menghapuskan
// ralat "origin mismatch" bila /admin dibuka dari hostname berbeza (tunnel/LAN/www).
function originsFor(reqOrigin) {
  const o = String(reqOrigin || '').trim().replace(/\/+$/, '');
  if (o && /^https?:\/\/.+/i.test(o) && !EXPECTED_ORIGINS.includes(o)) return [...EXPECTED_ORIGINS, o];
  return EXPECTED_ORIGINS;
}

/** @type {{ id: string, publicKey: string, counter: number, credentialDeviceType: string, credentialBackedUp: boolean, label: string, addedAt: string }[]} */
function passkeys() {
  const list = store.getSetting('passkeys', []);
  return Array.isArray(list) ? list : [];
}
function savePasskeys(list) {
  store.setSetting('passkeys', list);
}

// Cabaran tertunda (registration/authentication) — keyed by e-mel.
const pendingChallenges = new Map(); // email -> { value, type, expiresAt }

// Sesi login yang aktif. token -> { email, expiresAt }
const sessions = new Map();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// base64url (string) → Uint8Array — perlu untuk API @simplewebauthn/server v8
// yang menerima/memulang buffer mentah, bukan string.
function b64urlToBuf(b64url) {
  return new Uint8Array(Buffer.from(String(b64url), 'base64url'));
}

function isAllowedEmail(value) {
  return normalizeEmail(value) === ALLOWED_EMAIL;
}

function setChallenge(email, value, type) {
  pendingChallenges.set(email, { value, type, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}
function takeChallenge(email, type) {
  const entry = pendingChallenges.get(email);
  pendingChallenges.delete(email);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  if (entry.type !== type) return null;
  return entry.value;
}

function issueSession(email) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { email, expiresAt: Date.now() + config.admin.sessionTtlMs });
  return token;
}
function readSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}
function revokeSession(token) {
  sessions.delete(token);
}

// Buang entri luput secara berkala supaya memori tidak membengkak.
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expiresAt < now) sessions.delete(token);
  for (const [email, c] of pendingChallenges) if (c.expiresAt < now) pendingChallenges.delete(email);
}, 10 * 60 * 1000).unref?.();

function bearer(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return String(req.headers['x-admin-token'] || '').trim();
}

/** Middleware: tolak melainkan peminta mempunyai sesi pentadbir yang sah. */
function requireAdmin(req, res, next) {
  const session = readSession(bearer(req));
  if (!session) {
    return res.status(401).json({ error: 'Administrator not authenticated. Please log in again.' });
  }
  req.admin = session;
  return next();
}

/** Middleware: tolak melainkan e-mel padan dengan e-mel pemilik yang dibenarkan. */
function requireAllowedEmail(req, res, next) {
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ error: 'This email is not authorized to access the admin panel.' });
  }
  return next();
}

function checkBootstrapPassword(value) {
  const expected = String(config.admin.bootstrapPassword || '');
  if (!expected) return false;
  const a = Buffer.from(String(value || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Maklumat awam untuk UI: ada/tidak passkey, konfigurasi RP.
 *  NOTA: `allowedEmail` SENGAJA tidak dipulangkan — sebelum ini e-mel pemilik
 *  dibocorkan kepada sesiapa yang membuka /admin (auto-fill pada input). */
function publicConfig() {
  const keys = passkeys();
  return {
    rpID: RP_ID,
    rpName: RP_NAME,
    passkeyCount: keys.length,
    passkeysRegistered: keys.length > 0,
    requiresBootstrap: keys.length === 0
  };
}

// ── Registration (perlu e-mel yang dibenarkan + kata laluan bootstrap) ─────────
async function startRegistration(email) {
  const userId = crypto.randomBytes(16);
  // PENTING: generateRegistrationOptions ialah ASINKRON pada v8 — mesti `await`
  // supaya `options.challenge` wujud sebelum disimpan sebagai cabaran jangka pendek.
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(userId).toString('base64url'),
    userName: ALLOWED_EMAIL,
    userDisplayName: ALLOWED_EMAIL,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred'
    },
    timeout: CHALLENGE_TTL_MS
  });
  setChallenge(normalizeEmail(email), options.challenge, 'register');
  return options;
}

async function finishRegistration(email, credential, reqOrigin) {
  const expectedChallenge = takeChallenge(normalizeEmail(email), 'register');
  if (!expectedChallenge) {
    throw Object.assign(new Error('Challenge is invalid or expired. Try again.'), { statusCode: 400 });
  }
  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: originsFor(reqOrigin),
    expectedRPID: RP_ID
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('Passkey could not be verified.'), { statusCode: 400 });
  }
  const info = verification.registrationInfo;
  const credentialId = info.credentialID || info.credential?.id;
  const publicKey = info.credentialPublicKey || info.credential?.publicKey;
  const list = passkeys();
  const idStr = typeof credentialId === 'string' ? credentialId : Buffer.from(credentialId).toString('base64url');
  const pubStr = typeof publicKey === 'string' ? publicKey : Buffer.from(publicKey).toString('base64url');
  list.push({
    id: idStr,
    publicKey: pubStr,
    counter: info.counter || 0,
    credentialDeviceType: info.credentialDeviceType || 'singleDevice',
    credentialBackedUp: Boolean(info.credentialBackedUp),
    label: (credential.label && String(credential.label).slice(0, 40)) || `Peranti ${new Date().toLocaleDateString()}`,
    addedAt: new Date().toISOString()
  });
  savePasskeys(list);
  return { id: idStr, total: list.length };
}

// ── Authentication (passkey) ──────────────────────────────────────────────────
async function startAuthentication(email) {
  const keys = passkeys();
  // v8: generateAuthenticationOptions ASINKRON (mesti await), dan `allowCredentials[].id`
  // kena Uint8Array (bukan string base64url) — kalau string, id jadi kosong.
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    timeout: CHALLENGE_TTL_MS,
    allowCredentials: keys.map((k) => ({ id: b64urlToBuf(k.id), type: 'public-key' }))
  });
  setChallenge(normalizeEmail(email), options.challenge, 'authenticate');
  return options;
}

async function finishAuthentication(email, credential, reqOrigin) {
  const expectedChallenge = takeChallenge(normalizeEmail(email), 'authenticate');
  if (!expectedChallenge) {
    throw Object.assign(new Error('Challenge is invalid or expired. Try again.'), { statusCode: 400 });
  }
  const keys = passkeys();
  const stored = keys.find((k) => k.id === credential.id);
  if (!stored) {
    throw Object.assign(new Error('This passkey is not registered on the server.'), { statusCode: 401 });
  }
  // v8 API: parameter `authenticator` (bukan `credential`) dengan field
  // `credentialID`/`credentialPublicKey` sebagai Uint8Array; keputusan dibaca
  // daripada `authenticationInfo` (bukan `authenticationResult`).
  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: originsFor(reqOrigin),
    expectedRPID: RP_ID,
    authenticator: {
      credentialID: b64urlToBuf(stored.id),
      credentialPublicKey: b64urlToBuf(stored.publicKey),
      counter: stored.counter || 0
    }
  });
  if (!verification.verified) {
    throw Object.assign(new Error('Passkey verification failed.'), { statusCode: 401 });
  }
  // Simpan counter baharu (anti-replay untuk authenticator FIDO2 yangincrements).
  const idx = keys.findIndex((k) => k.id === credential.id);
  const authInfo = verification.authenticationInfo;
  if (idx !== -1 && authInfo) {
    keys[idx].counter = authInfo.newCounter ?? keys[idx].counter;
    savePasskeys(keys);
  }
  return issueSession(normalizeEmail(email));
}

function removePasskey(id) {
  const keys = passkeys();
  const next = keys.filter((k) => k.id !== id);
  savePasskeys(next);
  return { removed: keys.length - next.length, total: next.length };
}

module.exports = {
  requireAdmin,
  requireAllowedEmail,
  checkBootstrapPassword,
  isAllowedEmail,
  normalizeEmail,
  originsFor,
  b64urlToBuf,
  bearer,
  setChallenge,
  takeChallenge,
  publicConfig,
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  issueSession,
  revokeSession,
  readSession,
  removePasskey,
  passkeys
};
