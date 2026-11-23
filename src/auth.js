/**
 * auth.js — Tukuk-OS admin access control.
 *
 * Security policy:
 *   1. ONLY one e-mail is allowed (config.admin.email). Any other e-mail is rejected.
 *   2. Day-to-day login uses a WebAuthn PASSKEY (biometric/security key).
 *   3. The bootstrap password (config.admin.bootstrapPassword) is used
 *      ONCE to register the first passkey (or to add a new passkey
 *      from inside an already-unlocked dashboard).
 *   4. After a successful login, a random session token is issued and kept
 *      in memory with a TTL. Every /api/admin/* route requires it.
 *
 * WebAuthn is verified with the @simplewebauthn/server library (audited CBOR/COSE)
 * — not a hand-rolled implementation, so it is safe on a public server.
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
// Allowed origins for WebAuthn. WEBAUTHN_ORIGIN may hold a
// comma-separated list (e.g. https://tukuk.org,https://www.tukuk.org).
// localhost/127.0.0.1 (with a local port) is always allowed for testing.
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

// Extra origins taken from the current request. WebAuthn verification stays bound
// to the rpID (tukuk.org) — no other domain can mint an assertion for this rpID
// (the browser blocks it), so accepting the requester's origin is safe and removes
// the "origin mismatch" error when /admin is opened from a different hostname (tunnel/LAN/www).
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

// Pending challenges (registration/authentication) — keyed by e-mail.
const pendingChallenges = new Map(); // email -> { value, type, expiresAt }

// Active login sessions. token -> { email, expiresAt }
const sessions = new Map();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// base64url (string) → Uint8Array — required by the @simplewebauthn/server v14 API,
// which expects the public key stored as raw CBOR bytes.
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

// Purge expired entries periodically so memory doesn't grow unbounded.
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

/** Middleware: reject unless the requester has a valid admin session. */
function requireAdmin(req, res, next) {
  const session = readSession(bearer(req));
  if (!session) {
    return res.status(401).json({ error: 'Administrator not authenticated. Please log in again.' });
  }
  req.admin = session;
  return next();
}

/** Middleware: reject unless the e-mail matches the allowed owner e-mail. */
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

/** Public info for the UI: whether passkeys exist, the RP config.
 *  NOTE: `allowedEmail` is DELIBERATELY not returned — previously the owner's e-mail
 *  leaked to anyone opening /admin (auto-filled into the input). */
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

// ── Registration (needs the allowed e-mail + the bootstrap password) ─────────
async function startRegistration(email) {
  const userId = crypto.randomBytes(16);
  // IMPORTANT: generateRegistrationOptions is ASYNC on v14 — you must `await` it
  // so `options.challenge` exists before it is stored as a short-lived challenge.
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: userId, // v14: bytes (Uint8Array) — base64url strings are no longer accepted
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
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: originsFor(reqOrigin),
      expectedRPID: RP_ID
    });
  } catch (error) {
    // v14 throws for most verification failures (challenge/origin/attestation).
    throw Object.assign(new Error(`Passkey registration could not be verified: ${error && error.message}`), { statusCode: 400 });
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('Passkey could not be verified.'), { statusCode: 400 });
  }
  const info = verification.registrationInfo;
  // v14: the data sits under `credential` (base64url strings + publicKey bytes); v8: top-level fields.
  const credentialId = info.credential?.id || info.credentialID;
  const publicKey = info.credential?.publicKey || info.credentialPublicKey;
  const list = passkeys();
  const idStr = typeof credentialId === 'string' ? credentialId : Buffer.from(credentialId).toString('base64url');
  const pubStr = typeof publicKey === 'string' ? publicKey : Buffer.from(publicKey).toString('base64url');
  list.push({
    id: idStr,
    publicKey: pubStr,
    counter: info.credential?.counter ?? info.counter ?? 0,
    credentialDeviceType: info.credentialDeviceType || 'singleDevice',
    credentialBackedUp: Boolean(info.credentialBackedUp),
    label: (credential.label && String(credential.label).slice(0, 40)) || `Device ${new Date().toLocaleDateString()}`,
    addedAt: new Date().toISOString()
  });
  savePasskeys(list);
  return { id: idStr, total: list.length };
}

// ── Authentication (passkey) ──────────────────────────────────────────────────
async function startAuthentication(email) {
  const keys = passkeys();
  // v14: `allowCredentials[].id` must be a base64url STRING — it throws on Uint8Array
  // (unlike v8, which required a buffer). The challenge stays a base64url string.
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    timeout: CHALLENGE_TTL_MS,
    allowCredentials: keys.map((k) => ({ id: k.id, type: 'public-key' }))
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
  // v14 API: the `credential` parameter (not `authenticator`) with `id`/`publicKey`
  // — id a base64url string, publicKey raw CBOR bytes; failures throw SimpleWebAuthnError.
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: originsFor(reqOrigin),
      expectedRPID: RP_ID,
      credential: {
        id: stored.id,
        publicKey: b64urlToBuf(stored.publicKey),
        counter: stored.counter || 0
      }
    });
  } catch (error) {
    throw Object.assign(new Error(`Passkey verification failed: ${error && error.message}`), { statusCode: 401 });
  }
  if (!verification.verified) {
    throw Object.assign(new Error('Passkey verification failed.'), { statusCode: 401 });
  }
  // Store the new counter (anti-replay for FIDO2 authenticators that increment it).
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
