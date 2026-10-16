/**
 * sms.js — Gerbang SMS Tukuk-OS (paired-Android relay, dua hala + inbox).
 *
 * Tiada modem GSM pada pelayan, jadi satu peranti Android yang dipasangkan
 * bertindak sebagai radio: pelayan menyimpan/menjana katus keluar, telefon
 * menarik (poll) katus itu, menghantar SMS sebenar menerusi SmsManager, lalu
 * melaporkan status; SMS masuk ditolak (push) telefon kembali ke pelayan.
 *
 * Dua permukaan API:
 *   • ADMIN  (/api/sms/*)   — dilindungi auth.requireAdmin (sesi passkey).
 *   • PERANTI (/api/sms/device/*) — dilindungi token pasangan (header x-sms-token).
 *
 * Keadaan disimpan dalam satu JSON (data/sms.json) dengan tulis atomik + debounce,
 * sama seperti chat.js. Reka bentuk low-bandwidth & self-hosted: tanpa deps luar.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'sms.json');
const KEEP = 500;            // mesej terakhir yang disimpan
const MAX_BODY = 480;        // ±3 segmen SMS concat
const ONLINE_MS = 3 * 60e3;  // peranti dianggap dalam talian jika heartbeat < ini

let FILE = DEFAULT_PATH;
let state = null;
let writeTimer = null;
let dirty = false;
let auth = null;
let limiterFactory = null;

// ─── Simpanan ───
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

// ─── Sanitasi ───
// Nombor telefon: kekalkan '+' awal & digit sahaja; buang jarak/tanda.
function normalizeNumber(value) {
  let s = String(value || '').trim();
  const plus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;
  return (plus ? '+' : '') + s.slice(0, 24);
}
// Isi mesej: kekalkan \n, buang aksara kawalan lain, had panjang.
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

// Kira status katus keluar untuk paparan status pentadbir.
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

// Senarai utas (thread) — dikumpul ikut rakan sehubungan (peer).
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

// ─── Pengesahan peranti ───
function deviceTokenOf(req) {
  const h = req.headers['x-sms-token'] || req.headers.authorization || '';
  const m = String(h).match(/^(?:Bearer\s+)?([a-f0-9]{32,64})$/i);
  return m ? m[1] : String(req.body && req.body.token || '');
}
function requireDevice(req, res, next) {
  const s = load();
  // 409 (bukan 503) — worker tepi tukuk.org menafsir sebarang 5xx asal sebagai
  // "pelayan mati" dan ganti dengan mod sandaran; 4xx lalu utuh sampai klien.
  if (!s.device || !s.device.token) return res.status(409).json({ error: 'No SMS device paired yet. Generate a pairing token in the admin panel.' });
  if (!eqToken(deviceTokenOf(req), s.device.token)) return res.status(401).json({ error: 'Invalid device token.' });
  s.device.lastSeenAt = Date.now();
  touch();
  return next();
}

// ─── Pemasangan laluan ───
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
  // Keadaan gerbang: info peranti + kedalaman katus + kiraan status.
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

  // Jana/mutar semula token pasangan peranti. Token hanya dipulang SEKALI.
  app.post('/api/sms/device/rotate', auth.requireAdmin, (req, res) => {
    const s = load();
    s.device = { token: newToken(), name: null, number: null, carrier: null, pairedAt: Date.now(), lastSeenAt: 0 };
    touch();
    res.json({ ok: true, token: s.device.token, note: 'Token ini hanya dipulang sekali. Masukkan dalam apl relay pada telefon.' });
  });

  // Buang pasangan peranti (matikan penghantaran).
  app.post('/api/sms/device/unpair', auth.requireAdmin, (req, res) => {
    const s = load(); s.device = null; touch(); res.json({ ok: true });
  });

  // Serahkan SMS baru (masukkan katus keluar).
  app.post('/api/sms/send', auth.requireAdmin, sendLimiter, (req, res) => {
    const peer = normalizeNumber(req.body && req.body.to);
    const body = cleanBody(req.body && req.body.body);
    if (!peer) return res.status(400).json({ error: 'Nombor penerima tidak sah.' });
    if (!body) return res.status(400).json({ error: 'Isi mesej kosong.' });
    const msg = pushMessage({ id: idOf(), dir: 'out', peer, body, status: 'queued', ts: Date.now(), updatedAt: Date.now(), read: true, error: null });
    res.json({ ok: true, message: msg });
  });

  // Senarai utas inbox.
  app.get('/api/sms/threads', auth.requireAdmin, (req, res) => {
    res.json({ ok: true, threads: threads(), device: load().device ? { online: Date.now() - (load().device.lastSeenAt || 0) < ONLINE_MS } : null });
  });

  // Semua mesej satu nombor + tandai masuk sebagai dibaca.
  app.get('/api/sms/thread', auth.requireAdmin, (req, res) => {
    const peer = normalizeNumber(req.query.peer);
    if (!peer) return res.status(400).json({ error: 'peer (nombor) diperlukan.' });
    let changed = false;
    const msgs = load().messages.filter((m) => m.peer === peer).map((m) => {
      if (m.dir === 'in' && !m.read) { m.read = true; changed = true; }
      return m;
    });
    if (changed) touch();
    res.json({ ok: true, peer, messages: msgs });
  });

  // Padam satu mesej (kebersihan inbox).
  app.post('/api/sms/delete', auth.requireAdmin, (req, res) => {
    const s = load();
    const before = s.messages.length;
    s.messages = s.messages.filter((m) => m.id !== String(req.body && req.body.id));
    touch();
    res.json({ ok: true, removed: before - s.messages.length });
  });

  // ── PERANTI (relay Android) ──
  // Telefon melaporkan kehadiran + maklumat SIM.
  app.post('/api/sms/device/heartbeat', devLimiter, requireDevice, (req, res) => {
    const s = load();
    if (req.body.name) s.device.name = String(req.body.name).slice(0, 40);
    const num = normalizeNumber(req.body.number); if (num) s.device.number = num;
    if (req.body.carrier) s.device.carrier = String(req.body.carrier).slice(0, 40);
    s.device.lastSeenAt = Date.now();
    touch();
    res.json({ ok: true, online: true });
  });

  // Telefon menarik katus keluar → tandai 'sending' supaya tidak dihantar berganda.
  app.post('/api/sms/device/outbox', devLimiter, requireDevice, (req, res) => {
    const s = load();
    const max = Math.min(20, Number(req.body && req.body.max) || 10);
    const due = s.messages.filter((m) => m.dir === 'out' && m.status === 'queued').slice(0, max);
    for (const m of due) { m.status = 'sending'; m.updatedAt = Date.now(); }
    if (due.length) touch();
    res.json({ ok: true, messages: due.map((m) => ({ id: m.id, to: m.peer, body: m.body })) });
  });

  // Telefon melaporkan hasil penghantaran satu mesej.
  app.post('/api/sms/device/report', devLimiter, requireDevice, (req, res) => {
    const s = load();
    const m = s.messages.find((x) => x.id === String(req.body && req.body.id));
    if (!m) return res.status(404).json({ error: 'Unknown message id.' });
    const status = String(req.body.status || '').toLowerCase();
    if (!['sent', 'delivered', 'failed'].includes(status)) return res.status(400).json({ error: 'status mestilah sent|delivered|failed.' });
    m.status = status; m.updatedAt = Date.now();
    if (status === 'failed') m.error = cleanBody(req.body.error || '').slice(0, 120) || 'unknown';
    touch();
    res.json({ ok: true, id: m.id, status: m.status });
  });

  // Telefon menolak SMS masuk ke pelayan (didedu oleh from+ts+isi).
  app.post('/api/sms/device/inbox', devLimiter, requireDevice, (req, res) => {
    const s = load();
    const peer = normalizeNumber(req.body.from);
    const body = cleanBody(req.body.body);
    if (!peer || !body) return res.status(400).json({ error: 'from dan body diperlukan.' });
    const ts = Number(req.body.ts) || Date.now();
    const dup = s.messages.find((m) => m.dir === 'in' && m.peer === peer && m.ts === ts && m.body === body);
    if (dup) return res.json({ ok: true, duplicate: true, id: dup.id });
    const msg = pushMessage({ id: idOf(), dir: 'in', peer, body, status: 'received', ts, updatedAt: Date.now(), read: false, error: null });
    res.json({ ok: true, id: msg.id });
  });

  return { load, setPath, counts, threads };
}

module.exports = { mount, normalizeNumber, cleanBody };
