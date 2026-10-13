// Tukuk Chat — backend multi-pengguna untuk app /apps/chat.
// Akaun (scrypt), sesi bearer-token, bilik global + DM 1-ke-1, mesej dengan
// reply/reaction/edit/padam, kehadiran (online/menaip). Semua dalam satu fail
// JSON di data/chat.json (direpok → tidak boleh dihantar oleh auto-update).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'chat.json');
const MAX_MSG = 500;        // panjang mesej
const KEEP = 200;           // mesej terakhir per bilik
const SESSION_TTL = 30 * 24 * 3600e3;
const ONLINE_MS = 90e3;     // dianggap dalam talian
const TYPING_MS = 4e3;      // paparan "menaip…"

let FILE = DEFAULT_PATH;
let state = null;
let writeTimer = null;
let dirty = false;

// ─── Simpanan ───
function blank() {
  return { users: {}, sessions: {}, rooms: {}, msgs: {}, seen: {}, typing: {} };
}
function load() {
  if (state) return state;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    state = { ...blank(), ...JSON.parse(raw) };
  } catch {
    state = blank();
    state.rooms.global_am = { id: 'global_am', kind: 'global', title: '🌍 Am', members: ['*'], createdBy: 'sistem', createdAt: Date.now() };
  }
  if (!state.rooms.global_am) state.rooms.global_am = { id: 'global_am', kind: 'global', title: '🌍 Am', members: ['*'], createdBy: 'sistem', createdAt: Date.now() };
  return state;
}
function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch { /* best-effort — data tetap di memori */ }
}
function touch() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; flush(); }, 400);
}
function setPath(p) { FILE = p; state = null; load(); }

// ─── Pengesahan ───
function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), salt, 32).toString('hex');
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function eqHex(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function normalizeName(value) {
  const s = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 20) return null;
  if (!/^[\p{L}\p{N} ._-]+$/u.test(s)) return null;
  return s;
}
const key = (name) => String(name || '').toLowerCase();

function register(name, pass) {
  const s = load();
  const clean = normalizeName(name);
  if (!clean) return { error: 'Nama mesti 2–20 aksara (huruf/nombor/spasi sahaja).' };
  if (String(pass || '').length < 4) return { error: 'Kata laluan sekurang-kurangnya 4 aksara.' };
  if (s.users[key(clean)]) return { error: 'Nama sudah digunakan. Cuba login.' };
  const salt = crypto.randomBytes(16).toString('hex');
  s.users[key(clean)] = { name: clean, k: key(clean), salt, hash: hashPass(pass, salt), createdAt: Date.now(), lastSeen: 0 };
  touch();
  return { ok: true, user: s.users[key(clean)] };
}

function login(name, pass) {
  const s = load();
  const u = s.users[key(name)];
  if (!u || !eqHex(u.hash, hashPass(pass, u.salt))) return { error: 'Nama atau kata laluan salah.' };
  u.lastSeen = Date.now(); // login berjaya = memang hadir
  touch();
  return { ok: true, user: u };
}

function issueSession(name) {
  const s = load();
  const token = newToken();
  s.sessions[token] = { name, k: key(name), exp: Date.now() + SESSION_TTL };
  touch();
  return token;
}
function userOf(token) {
  const s = load();
  if (!token) return null;
  const sess = s.sessions[token];
  if (!sess || sess.exp < Date.now()) return null;
  const u = s.users[sess.k];
  if (!u) return null;
  u.lastSeen = Date.now();
  touch();
  return u;
}
function revoke(token) { const s = load(); if (s.sessions[token]) { delete s.sessions[token]; touch(); } }

// ─── Bilik ───
function dmId(a, b) { return 'dm_' + [key(a), key(b)].sort().join('~'); }
function roomsFor(name) {
  const s = load();
  return Object.values(s.rooms).filter(r => r.kind === 'global' || r.members.some(m => key(m) === key(name)));
}
function ensureDm(a, b) {
  const s = load();
  const id = dmId(a, b);
  if (!s.rooms[id]) {
    s.rooms[id] = { id, kind: 'dm', title: null, members: [a, b], createdBy: a, createdAt: Date.now() };
    touch();
  } else if (!s.rooms[id].members.some(m => key(m) === key(a))) {
    s.rooms[id].members.push(a); touch();
  }
  return s.rooms[id];
}
function roomTitle(r, viewer) {
  if (r.kind === 'global') return r.title || '🌍 Am';
  const other = r.members.find(m => key(m) !== key(viewer)) || r.members[0];
  return other || 'DM';
}

// ─── Mesej ───
function canRead(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r) return false;
  if (r.kind === 'global') return true;
  return r.members.some(m => key(m) === key(name));
}
function send(name, roomId, text, replyTo) {
  const s = load();
  const r = s.rooms[roomId];
  if (!r) return { error: 'Bilik tidak ditemui.' };
  if (!r.list) r.list = [];
  if (!r.seq) r.seq = 0;
  const t = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_MSG);
  if (!t) return { error: 'Mesej kosong.' };
  if (replyTo && !r.list.find(m => m.id === replyTo)) replyTo = null;
  const msg = { id: crypto.randomBytes(6).toString('hex'), seq: ++r.seq, from: name, t, ts: Date.now(), to: replyTo || null, rx: {}, edited: false, del: false };
  r.list.push(msg);
  if (r.list.length > KEEP) r.list.splice(0, r.list.length - KEEP);
  delete s.typing[key(name) + '|' + roomId];
  touch();
  return { ok: true, msg, room: r };
}
function since(name, roomId, after) {
  const s = load();
  const r = s.rooms[roomId]; if (!r) return { error: 'Bilik tidak ditemui.' };
  const a = Math.max(0, Number(after) || 0);
  const msgs = (r.list || []).filter(m => m.seq > a);
  const seenKey = roomId + '|' + key(name);
  if (r.seq) s.seen[seenKey] = r.seq;
  touch();
  return { ok: true, msgs, seq: r.seq || 0 };
}
function markSeen(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (r) { s.seen[roomId + '|' + key(name)] = r.seq || 0; touch(); }
}
function unread(name) {
  const s = load(); const out = {};
  for (const r of Object.values(s.rooms)) {
    if (!canRead(name, r.id)) continue;
    const last = s.seen[r.id + '|' + key(name)] || 0;
    out[r.id] = Math.max(0, (r.seq || 0) - last);
  }
  return out;
}
function react(name, roomId, msgId, emo) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Bilik tidak ditemui.' };
  const m = (r.list || []).find(x => x.id === msgId); if (!m) return { error: 'Mesej tidak ditemui.' };
  const e = String(emo).slice(0, 8);
  m.rx = m.rx || {};
  if (m.rx[e]) { delete m.rx[e]; } else { m.rx[e] = 1; }
  touch();
  return { ok: true, msg: m };
}
function edit(name, roomId, msgId, text) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Bilik tidak ditemui.' };
  const m = (r.list || []).find(x => x.id === msgId);
  if (!m) return { error: 'Mesej tidak ditemui.' };
  if (key(m.from) !== key(name)) return { error: 'Hanya mesej sendiri boleh diubah.' };
  const t = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_MSG);
  if (!t) return { error: 'Mesej kosong.' };
  m.t = t; m.edited = true; touch();
  return { ok: true, msg: m };
}
function remove(name, roomId, msgId) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Bilik tidak ditemui.' };
  const i = (r.list || []).findIndex(x => x.id === msgId);
  if (i < 0) return { error: 'Mesej tidak ditemui.' };
  if (key(r.list[i].from) !== key(name)) return { error: 'Hanya mesej sendiri boleh dipadam.' };
  r.list.splice(i, 1); touch();
  return { ok: true };
}
function setTyping(name, roomId) {
  const s = load();
  if (!s.rooms[roomId]) return;
  s.typing[key(name) + '|' + roomId] = Date.now(); touch();
}
function typingIn(roomId) {
  const s = load(); const now = Date.now(); const out = [];
  for (const [k, ts] of Object.entries(s.typing)) {
    if (now - ts > TYPING_MS) { delete s.typing[k]; continue; }
    const [who, rid] = k.split('|');
    if (rid === roomId) out.push(who);
  }
  return out;
}
function people(query) {
  const s = load();
  const q = String(query || '').toLowerCase();
  return Object.values(s.users)
    .filter(u => !q || u.name.toLowerCase().includes(q))
    .map(u => ({ name: u.name, online: Date.now() - (u.lastSeen || 0) < ONLINE_MS }))
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name))
    .slice(0, 50);
}
function onlineMap() {
  const s = load(); const out = {}; const now = Date.now();
  for (const u of Object.values(s.users)) out[key(u.name)] = now - (u.lastSeen || 0) < ONLINE_MS;
  return out;
}

// ─── Pembersihan berkala ───
function sweep() {
  const s = load(); const now = Date.now();
  for (const [tok, sess] of Object.entries(s.sessions)) if (!sess || sess.exp < now) delete s.sessions[tok];
  for (const [k, ts] of Object.entries(s.typing)) if (now - ts > TYPING_MS * 2) delete s.typing[k];
  touch();
}
setInterval(sweep, 10 * 60e3).unref?.();

// ─── Pembantu HTTP ───
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : (req.query.token || '');
}
function cleanBody(x) { return x && typeof x === 'object' ? x : {}; }

// ─── Pemasangan pada Express ───
function mount(app, deps) {
  const d = deps || {};
  if (d.path) setPath(d.path); // ikut direktori data stor sedia ada (bukan hardcoded)
  const rateLimit = d.rateLimit;
  const store = d.store;
  const lim = (opt) => (rateLimit ? rateLimit(opt) : (req, res, next) => next());

  const authOf = (req, res) => {
    const u = userOf(bearer(req));
    if (!u) { res.status(401).json({ error: 'Sesi luput. Sila login semula.' }); return null; }
    return u;
  };
  const event = (m, d) => { if (store && store.event) try { store.event('chat', m, d); } catch { /* noop */ } };

  app.post('/api/chat/register', lim({ windowMs: 3600e3, max: 8, keyPrefix: 'chreg:' }), (req, res) => {
    const b = cleanBody(req.body);
    const r = register(b.name, b.pass);
    if (r.error) return res.status(400).json({ error: r.error });
    const token = issueSession(r.user.name);
    event('Akaun chat baharu: ' + r.user.name, { name: r.user.name });
    res.json({ ok: true, token, name: r.user.name });
  });

  app.post('/api/chat/login', lim({ windowMs: 15 * 60e3, max: 20, keyPrefix: 'chlogin:' }), (req, res) => {
    const b = cleanBody(req.body);
    const r = login(b.name, b.pass);
    if (r.error) return res.status(401).json({ error: r.error });
    res.json({ ok: true, token: issueSession(r.user.name), name: r.user.name });
  });

  app.post('/api/chat/logout', (req, res) => { revoke(bearer(req)); res.json({ ok: true }); });

  app.get('/api/chat/me', (req, res) => {
    const u = userOf(bearer(req));
    if (!u) return res.json({ ok: true, name: null });
    res.json({ ok: true, name: u.name, online: true });
  });

  app.get('/api/chat/rooms', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const un = unread(u.name); const on = onlineMap();
    const rooms = roomsFor(u.name).map(r => {
      const last = (r.list || [])[Math.max(0, (r.list || []).length - 1)];
      return {
        id: r.id, kind: r.kind, title: roomTitle(r, u.name),
        members: r.members, unread: un[r.id] || 0, seq: r.seq || 0,
        last: last ? { from: last.from, t: last.del ? null : last.t, ts: last.ts } : null,
        online: r.kind === 'global' ? Object.values(on).filter(Boolean).length : r.members.some(m => on[key(m)]),
      };
    }).sort((a, b) => (b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0));
    res.json({ ok: true, rooms });
  });

  app.get('/api/chat/messages', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const room = String(req.query.room || '');
    if (!canRead(u.name, room)) return res.status(403).json({ error: 'Bilik bukan milik anda.' });
    if (req.query.full === '1') { const r = state.rooms[room]; return res.json({ ok: true, msgs: (r.list || []).slice(-KEEP), seq: r.seq || 0, typing: typingIn(room), people: people(null).slice(0, 50) }); }
    const out = since(u.name, room, req.query.after);
    res.json({ ok: true, msgs: out.msgs, seq: out.seq, typing: typingIn(room), people: people(null).slice(0, 50) });
  });

  app.post('/api/chat/messages', lim({ windowMs: 60e3, max: 40, keyPrefix: 'chmsg:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const room = String(b.room || '');
    if (!canRead(u.name, room)) return res.status(403).json({ error: 'Bilik bukan milik anda.' });
    const r = send(u.name, room, b.text, b.replyTo);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, msg: r.msg, seq: r.room.seq });
  });

  app.post('/api/chat/room', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const peer = normalizeName(cleanBody(req.body).peer);
    if (!peer) return res.status(400).json({ error: 'Nama pasangan tidak sah.' });
    if (key(peer) === key(u.name)) return res.status(400).json({ error: 'Tidak boleh DM diri sendiri.' });
    const r = ensureDm(u.name, peer);
    res.json({ ok: true, room: { id: r.id, kind: r.kind, title: roomTitle(r, u.name), members: r.members, seq: r.seq || 0 } });
  });

  app.post('/api/chat/typing', (req, res) => {
    const u = userOf(bearer(req)); if (!u) return res.json({ ok: true });
    setTyping(u.name, String(cleanBody(req.body).room || ''));
    res.json({ ok: true });
  });

  app.get('/api/chat/people', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    res.json({ ok: true, people: people(req.query.q).map(p => ({ name: p.name, online: p.online })) });
  });

  app.post('/api/chat/react', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = react(u.name, String(b.room), String(b.id), String(b.emo || '❤️'));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, msg: r.msg });
  });

  app.post('/api/chat/edit', lim({ windowMs: 60e3, max: 30, keyPrefix: 'chedit:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = edit(u.name, String(b.room), String(b.id), b.text);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, msg: r.msg });
  });

  app.post('/api/chat/delete', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = remove(u.name, String(b.room), String(b.id));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/chat/read', (req, res) => {
    const u = userOf(bearer(req)); if (!u) return res.json({ ok: true });
    markSeen(u.name, String(cleanBody(req.body).room || ''));
    res.json({ ok: true });
  });
}

module.exports = {
  mount, register, login, issueSession, userOf, revoke, normalizeName, hashPass, eqHex,
  dmId, ensureDm, roomsFor, roomTitle, send, since, markSeen, unread, canRead,
  react, edit, remove, setTyping, typingIn, people, onlineMap, setPath, load, flush,
};
