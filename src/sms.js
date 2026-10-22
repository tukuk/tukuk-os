/**
 * sms.js — Tukuk-OS SMS gateway (paired-Android relay, two-way + inbox).
 *
 * The server has no GSM modem, so one paired Android device acts as the radio:
 * the server stores/generates the outbox, the phone polls that queue, sends the
 * real SMS through SmsManager and reports the status; incoming SMS are pushed
 * back by the phone to the server.
 *
 * Two API surfaces:
 *   • ADMIN   (/api/sms/*)          — protected by auth.requireAdmin (passkey session).
 *   • DEVICE  (/api/sms/device/*)   — protected by the pairing token (x-sms-token header).
 *
 * State lives in one JSON file (data/sms.json) with atomic writes + debounce, just
 * like chat.js. Low-bandwidth, self-hosted design: no external dependencies.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'sms.json');
const KEEP = 500;            // last messages kept
const MAX_BODY = 480;        // ±3 concat-SMS segments
const ONLINE_MS = 3 * 60e3;  // a device counts as online when its heartbeat is younger than this

let FILE = DEFAULT_PATH;
let state = null;
let writeTimer = null;
let dirty = false;
let auth = null;
let limiterFactory = null;
// Listeners for inbound SMS (used by the Chat ⇄ Cell bridge). Register via onInbound().
let inboundHooks = [];

// ─── Storage ───
function blank() {
  return { version: 1, device: null, messages: [], nextId: 1 };
}
function load() {
  if (state) return state;
  try {
    state = { ...blank(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    state = blank();
  }
  if (!Array.isArray(state.messages)) state.messages = [];
  if (state.device && typeof state.device.token !== 'string') state.device = null;
  return state;
}
function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);
  } catch (error) {
    console.error('[sms] write failed:', error.message);
  }
}
function touch() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; flush(); }, 400);
  writeTimer.unref?.();
}
function setPath(p) { FILE = p; state = null; load(); }

// ─── Sanitisation ───
// Phone number: keep a leading '+' and digits only; drop spaces/punctuation.
function normalizeNumber(value) {
  let s = String(value || '').trim();
  const plus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;
  return (plus ? '+' : '') + s.slice(0, 24);
}
// Message body: keep \n, drop other control characters, cap the length.
function cleanBody(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_BODY);
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function eqToken(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function idOf() { const s = load(); return (s.nextId++).toString(36) + crypto.randomBytes(2).toString('hex'); }

function pushMessage(msg) {
  const s = load();
  s.messages.push(msg);
  if (s.messages.length > KEEP) s.messages = s.messages.slice(-KEEP);
  touch();
  return msg;
}

// Hand an SMS to the outbox WITHOUT HTTP/authentication — used by the Chat bridge.
// Same semantics as POST /api/sms/send (always queues, even when no device exists
// yet); the caller decides when it is worth sending (see isPaired).
function enqueue(toNumber, body) {
  const peer = normalizeNumber(toNumber);
  const clean = cleanBody(body);
  if (!peer) return { error: 'Invalid recipient number.' };
  if (!clean) return { error: 'The message body is empty.' };
  const msg = pushMessage({ id: idOf(), dir: 'out', peer, body: clean, status: 'queued', ts: Date.now(), updatedAt: Date.now(), read: true, error: null });
  return { ok: true, message: msg };
}
// Is a relay device paired? Only then is sending an SMS actually possible.
function isPaired() { const s = load(); return Boolean(s && s.device && s.device.token); }
// Register an inbound-SMS listener; called with { from, body, msg } after it is stored.
function onInbound(fn) { if (typeof fn === 'function') inboundHooks.push(fn); return fn; }

// Count the outbox statuses for the admin status view.
function counts() {
  const s = load();
  const out = { queued: 0, sending: 0, sent: 0, delivered: 0, failed: 0 };
  let inbound = 0;
  for (const m of s.messages) {
    if (m.dir === 'out') { if (out[m.status] !== undefined) out[m.status] += 1; }
    else inbound += 1;
  }
  return { ...out, inbound };
}

// Thread list — grouped by the peer on the other end.
function threads() {
  const s = load();
  const map = new Map();
  for (const m of s.messages) {
    let t = map.get(m.peer);
    if (!t) { t = { peer: m.peer, total: 0, unread: 0, last: null }; map.set(m.peer, t); }
    t.total += 1;
    if (m.dir === 'in' && !m.read) t.unread += 1;
    if (!t.last || m.ts >= t.last.ts) t.last = { dir: m.dir, body: m.body, status: m.status, ts: m.ts };
  }
  return [...map.values()].sort((a, b) => (b.last.ts || 0) - (a.last.ts || 0));
}

// ─── Device authentication ───
function deviceTokenOf(req) {
  const h = req.headers['x-sms-token'] || req.headers.authorization || '';
  const m = String(h).match(/^(?:Bearer\s+)?([a-f0-9]{32,64})$/i);
  return m ? m[1] : String(req.body && req.body.token || '');
}
function requireDevice(req, res, next) {
  const s = load();
  // 409 (not 503) — the tukuk.org edge worker reads any generic 5xx as
  // "server dead" and swaps in the fallback mode; 4xx passes through intact.
  if (!s.device || !s.device.token) return res.status(409).json({ error: 'No SMS device paired yet. Generate a pairing token in the admin panel.' });
  if (!eqToken(deviceTokenOf(req), s.device.token)) return res.status(401).json({ error: 'Invalid device token.' });
  s.device.lastSeenAt = Date.now();
  touch();
  return next();
}

// ─── Route mounting ───
function mount(app, deps) {
  auth = deps.auth;
  limiterFactory = deps.rateLimit ? deps.rateLimit : null;
  if (deps.path) setPath(deps.path);

  const sendLimiter = limiterFactory
    ? limiterFactory({ windowMs: 60e3, max: 30, keyPrefix: 'smssend:' })
    : (req, res, next) => next();
  const devLimiter = limiterFactory
    ? limiterFactory({ windowMs: 60e3, max: 240, keyPrefix: 'smsdev:' })
    : (req, res, next) => next();

  // ── ADMIN ──
  // Gateway state: device info + queue depth + status counts.
  app.get('/api/sms/status', auth.requireAdmin, (req, res) => {
    const s = load();
    const d = s.device;
    res.json({
      ok: true,
      paired: Boolean(d && d.token),
      device: d ? {
        name: d.name || 'Android relay', number: d.number || null, carrier: d.carrier || null,
        pairedAt: d.pairedAt || null, lastSeenAt: d.lastSeenAt || null, online: Date.now() - (d.lastSeenAt || 0) < ONLINE_MS,
      } : null,
      counts: counts(),
    });
  });

  // Generate/rotate the device pairing token. The token is returned ONCE ONLY.
  app.post('/api/sms/device/rotate', auth.requireAdmin, (req, res) => {
    const s = load();
    s.device = { token: newToken(), name: null, number: null, carrier: null, pairedAt: Date.now(), lastSeenAt: 0 };
    touch();
    res.json({ ok: true, token: s.device.token, note: 'This token is only returned once. Enter it in the relay app on the phone.' });
  });

  // Remove the device pairing (turns sending off).
  app.post('/api/sms/device/unpair', auth.requireAdmin, (req, res) => {
    const s = load(); s.device = null; touch(); res.json({ ok: true });
  });

  // Submit a new SMS (puts it in the outbox).
  app.post('/api/sms/send', auth.requireAdmin, sendLimiter, (req, res) => {
    const r = enqueue(req.body && req.body.to, req.body && req.body.body);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, message: r.message });
  });

  // List the inbox threads.
  app.get('/api/sms/threads', auth.requireAdmin, (req, res) => {
    res.json({ ok: true, threads: threads(), device: load().device ? { online: Date.now() - (load().device.lastSeenAt || 0) < ONLINE_MS } : null });
  });

  // Every message for one number + mark the inbound ones as read.
  app.get('/api/sms/thread', auth.requireAdmin, (req, res) => {
    const peer = normalizeNumber(req.query.peer);
    if (!peer) return res.status(400).json({ error: 'peer (a number) is required.' });
    let changed = false;
    const msgs = load().messages.filter((m) => m.peer === peer).map((m) => {
      if (m.dir === 'in' && !m.read) { m.read = true; changed = true; }
      return m;
    });
    if (changed) touch();
    res.json({ ok: true, peer, messages: msgs });
  });

  // Delete one message (inbox hygiene).
  app.post('/api/sms/delete', auth.requireAdmin, (req, res) => {
    const s = load();
    const before = s.messages.length;
    s.messages = s.messages.filter((m) => m.id !== String(req.body && req.body.id));
    touch();
    res.json({ ok: true, removed: before - s.messages.length });
  });

  // ── DEVICE (Android relay) ──
  // The phone reports its presence + SIM details.
  app.post('/api/sms/device/heartbeat', devLimiter, requireDevice, (req, res) => {
    const s = load();
    if (req.body.name) s.device.name = String(req.body.name).slice(0, 40);
    const num = normalizeNumber(req.body.number); if (num) s.device.number = num;
    if (req.body.carrier) s.device.carrier = String(req.body.carrier).slice(0, 40);
    s.device.lastSeenAt = Date.now();
    touch();
    res.json({ ok: true, online: true });
  });

  // The phone pulls the outbox → mark them 'sending' so nothing is sent twice.
  app.post('/api/sms/device/outbox', devLimiter, requireDevice, (req, res) => {
    const s = load();
    const max = Math.min(20, Number(req.body && req.body.max) || 10);
    const due = s.messages.filter((m) => m.dir === 'out' && m.status === 'queued').slice(0, max);
    for (const m of due) { m.status = 'sending'; m.updatedAt = Date.now(); }
    if (due.length) touch();
    res.json({ ok: true, messages: due.map((m) => ({ id: m.id, to: m.peer, body: m.body })) });
  });

  // The phone reports the delivery result of one message.
  app.post('/api/sms/device/report', devLimiter, requireDevice, (req, res) => {
    const s = load();
    const m = s.messages.find((x) => x.id === String(req.body && req.body.id));
    if (!m) return res.status(404).json({ error: 'Unknown message id.' });
    const status = String(req.body.status || '').toLowerCase();
    if (!['sent', 'delivered', 'failed'].includes(status)) return res.status(400).json({ error: 'status must be sent|delivered|failed.' });
    m.status = status; m.updatedAt = Date.now();
    if (status === 'failed') m.error = cleanBody(req.body.error || '').slice(0, 120) || 'unknown';
    touch();
    res.json({ ok: true, id: m.id, status: m.status });
  });

  // The phone pushes inbound SMS to the server (deduplicated by from+ts+body).
  app.post('/api/sms/device/inbox', devLimiter, requireDevice, (req, res) => {
    const s = load();
    const peer = normalizeNumber(req.body.from);
    const body = cleanBody(req.body.body);
    if (!peer || !body) return res.status(400).json({ error: 'from and body are required.' });
    const ts = Number(req.body.ts) || Date.now();
    const dup = s.messages.find((m) => m.dir === 'in' && m.peer === peer && m.ts === ts && m.body === body);
    if (dup) return res.json({ ok: true, duplicate: true, id: dup.id });
    const msg = pushMessage({ id: idOf(), dir: 'in', peer, body, status: 'received', ts, updatedAt: Date.now(), read: false, error: null });
    // Hand it to the Chat bridge (a failing listener must not break the inbox).
    for (const fn of inboundHooks) { try { fn({ from: peer, body, msg }); } catch { /* bridge failed — the SMS is still stored */ } }
    res.json({ ok: true, id: msg.id });
  });

  return { load, setPath, counts, threads, enqueue, isPaired, onInbound };
}

module.exports = { mount, normalizeNumber, cleanBody, enqueue, isPaired, onInbound, setPath };
