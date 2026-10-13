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
const FIRST_ID = 100001;    // Tukuk ID pertama (nombor kekal, bukan nama)
function blank() {
  return { users: {}, sessions: {}, rooms: {}, msgs: {}, seen: {}, typing: {}, nextId: FIRST_ID };
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
  migrate();
  return state;
}
// Naik taraf data lama: beri Tukuk ID pada akaun tanpa id, dan kunci bilik DM
// berasaskan nombor ID (sebelum ini guna nama → nama bertukar = DM rosak).
function migrate() {
  const s = state;
  if (!s.nextId) s.nextId = FIRST_ID;
  let changed = false;
  for (const u of Object.values(s.users)) if (!u.id) { u.id = s.nextId++; changed = true; }
  for (const [id, r] of Object.entries(s.rooms)) {
    if (r.kind !== 'dm') continue;
    if (!r.memberIds) {
      const us = [];
      for (const n of (r.members || [])) { const u = s.users[key(n)]; if (u && u.id && !us.some(x => x.id === u.id)) us.push(u); }
      if (us.length >= 2) { r.memberIds = us.slice(0, 2).map(u => u.id); r.members = r.memberIds.map(nameOfUser); changed = true; }
    }
    if (!r.memberIds || r.memberIds.length < 2) continue;
    const nid = dmId(r.memberIds[0], r.memberIds[1]);
    if (nid !== id) {
      s.rooms[nid] = Object.assign({}, r, { id: nid });
      delete s.rooms[id];
      for (const [k, v] of Object.entries(s.seen)) {
        if (k.startsWith(id + '|')) { delete s.seen[k]; s.seen[nid + '|' + k.slice(id.length + 1)] = v; }
      }
      changed = true;
    }
  }
  for (const sess of Object.values(s.sessions)) if (!sess.uid) {
    const u = s.users[sess.k];
    if (u) { sess.uid = u.id; changed = true; }
  }
  if (changed) dirty = true;
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
// Mesej boleh berbilang baris: kekalkan \n, buang aksara kawalan lain.
function cleanText(v) {
  return String(v || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, MAX_MSG);
}

// ─── Tukuk ID ───
// Setiap akaun dapat nombor kekal (100001+). Nama hanya paparan; DM, karangan
// mesej dan carian "siapa punya ID ini" semua berpaut pada nombor itu.
function byId(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return Object.values(load().users).find(u => u.id === n) || null;
}
function userByName(name) { return load().users[key(name)] || null; }
function nameOfUser(id) { const u = byId(id); return u ? u.name : null; }
// Input pengguna: boleh Tukuk ID (nombor) atau nama → objek pengguna atau null.
function findUser(q) {
  if (q && typeof q === 'object') return q.id ? q : userByName(q.name);
  const raw = String(q == null ? '' : q).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= FIRST_ID) { const u = byId(n); if (u) return u; }
  return userByName(raw);
}
const uid = (who) => { const u = (who && typeof who === 'object') ? who : findUser(who); return u && u.id ? u.id : null; };
const uname = (who) => { const u = (who && typeof who === 'object') ? who : findUser(who); return (u && u.name) || (who && who.name) || String(who || ''); };
const isOnline = (u) => Date.now() - (u.lastSeen || 0) < ONLINE_MS;

function register(name, pass) {
  const s = load();
  const clean = normalizeName(name);
  if (!clean) return { error: 'Nama mesti 2–20 aksara (huruf/nombor/spasi sahaja).' };
  if (String(pass || '').length < 4) return { error: 'Kata laluan sekurang-kurangnya 4 aksara.' };
  if (s.users[key(clean)]) return { error: 'Nama sudah digunakan. Cuba login.' };
  if (/^\d{6}$/.test(key(clean))) return { error: 'Nama tidak boleh berupa 6 angka (format Tukuk ID).' };
  const salt = crypto.randomBytes(16).toString('hex');
  s.users[key(clean)] = { name: clean, k: key(clean), id: s.nextId++, salt, hash: hashPass(pass, salt), createdAt: Date.now(), lastSeen: 0, bio: '' };
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
  const u = s.users[key(name)];
  s.sessions[token] = { name, k: key(name), uid: u ? u.id : null, exp: Date.now() + SESSION_TTL };
  touch();
  return token;
}
function userOf(token) {
  const s = load();
  if (!token) return null;
  const sess = s.sessions[token];
  if (!sess || sess.exp < Date.now()) return null;
  // id dahulu — nama boleh bertukar, id tidak
  const u = (sess.uid ? byId(sess.uid) : null) || s.users[sess.k];
  if (!u) return null;
  u.lastSeen = Date.now();
  touch();
  return u;
}
function revoke(token) { const s = load(); if (s.sessions[token]) { delete s.sessions[token]; touch(); } }

// ─── Bilik ───
// Bilik DM dikunci pada pasangan Tukuk ID, bukan nama — nama bertukar, DM selamat.
function dmId(a, b) {
  const na = Number(a), nb = Number(b);
  if (Number.isInteger(na) && Number.isInteger(nb) && na >= FIRST_ID && nb >= FIRST_ID)
    return 'dm_' + [na, nb].sort((x, y) => x - y).join('~');
  return 'dm_' + [key(a), key(b)].sort().join('~');
}
function isMember(r, who) {
  if (!r) return false;
  const u = (who && typeof who === 'object') ? who : findUser(who);
  if (u && u.id && r.memberIds && r.memberIds.length) return r.memberIds.includes(u.id);
  const n = key(u ? u.name : uname(who));
  return (r.members || []).some(m => key(m) === n);
}
// Nama paparan ahli disegerakkan daripada ID (nama lama kekal jika akaun hilang).
function syncNames(r) {
  if (!r || !r.memberIds || !r.memberIds.length) return;
  const names = r.memberIds.map(nameOfUser);
  if (names.some(n => !n)) return;
  if (names.join('\u0001') !== (r.members || []).join('\u0001')) { r.members = names; touch(); }
}
function roomsFor(name) {
  const s = load();
  return Object.values(s.rooms).filter(r => r.kind === 'global' || isMember(r, name));
}
function ensureDm(a, b) {
  const s = load();
  const ua = (a && typeof a === 'object') ? a : findUser(a);
  const ub = (b && typeof b === 'object') ? b : findUser(b);
  if (!ua || !ub || !ua.id || !ub.id || ua.id === ub.id) return null; // belum daftar → tiada DM
  const pair = [ua.id, ub.id].sort((x, y) => x - y);
  const id = dmId(pair[0], pair[1]);
  let r = s.rooms[id];
  if (!r) {
    r = s.rooms[id] = { id, kind: 'dm', title: null, memberIds: pair, members: pair.map(nameOfUser), createdBy: ua.name, createdAt: Date.now() };
    touch();
    return r;
  }
  if (!r.memberIds || r.memberIds.length !== 2) { r.memberIds = pair; touch(); }
  syncNames(r);
  return r;
}
function peerId(r, mine) {
  if (!r || r.kind !== 'dm' || !r.memberIds) return null;
  const m = uid(mine);
  return r.memberIds.find(i => i !== m) || null;
}
function roomTitle(r, viewer) {
  if (!r || r.kind === 'global') return (r && r.title) || '🌍 Am';
  const v = (viewer && typeof viewer === 'object') ? viewer : findUser(viewer);
  if (r.memberIds && v && v.id) {
    const nm = nameOfUser(r.memberIds.find(i => i !== v.id));
    if (nm) return nm;
  }
  syncNames(r);
  const vk = key(v ? v.name : uname(viewer));
  return (r.members || []).find(m => key(m) !== vk) || (r.members || [])[0] || 'DM';
}

// ─── Mesej ───
function canRead(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r) return false;
  if (r.kind === 'global') return true;
  return isMember(r, name);
}
// Pemilik mesej: id penghantar lebih autoritatif daripada nama (nama boleh tukar).
function sameAuthor(m, who) {
  if (!m) return false;
  const i = uid(who);
  if (i && m.fid) return m.fid === i;
  return key(m.from) === key(uname(who));
}
function authorName(m) {
  if (!m) return null;
  const nm = m.fid ? nameOfUser(m.fid) : null;
  return nm || m.from || null;
}
function send(name, roomId, text, replyTo) {
  const s = load();
  const r = s.rooms[roomId];
  if (!r) return { error: 'Bilik tidak ditemui.' };
  if (!r.list) r.list = [];
  if (!r.seq) r.seq = 0;
  const t = cleanText(text);
  if (!t) return { error: 'Mesej kosong.' };
  if (replyTo && !r.list.find(m => m.id === replyTo)) replyTo = null;
  const su = findUser(name);
  const msg = { id: crypto.randomBytes(6).toString('hex'), seq: ++r.seq, from: su ? su.name : name, fid: su ? su.id : null, t, ts: Date.now(), to: replyTo || null, rx: {}, edited: false, del: false };
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
    // hanya mesej orang lain yang melebihi titik baca dikira belum-dibaca
    out[r.id] = (r.list || []).filter(m => m.seq > last && !sameAuthor(m, name)).length;
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
  if (!sameAuthor(m, name)) return { error: 'Hanya mesej sendiri boleh diubah.' };
  const t = cleanText(text);
  if (!t) return { error: 'Mesej kosong.' };
  m.t = t; m.edited = true; touch();
  return { ok: true, msg: m };
}
function remove(name, roomId, msgId) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Bilik tidak ditemui.' };
  const i = (r.list || []).findIndex(x => x.id === msgId);
  if (i < 0) return { error: 'Mesej tidak ditemui.' };
  if (!sameAuthor(r.list[i], name)) return { error: 'Hanya mesej sendiri boleh dipadam.' };
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
function people(query, limit) {
  const s = load();
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const qid = Number(q);
  return Object.values(s.users)
    .filter(u => !q || u.name.toLowerCase().includes(q) || (Number.isInteger(qid) && qid >= FIRST_ID && u.id === qid))
    .map(u => ({ id: u.id, name: u.name, bio: u.bio || '', online: isOnline(u) }))
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name))
    .slice(0, limit || 50);
}
// Paparan awam: "siapa punya ID/nama ini?" — nama, bio, tarikh sertai, kehadiran.
function profile(query) {
  const u = findUser(query);
  if (!u) return null;
  return { id: u.id, name: u.name, bio: u.bio || '', joined: u.createdAt || null, online: isOnline(u) };
}
function setBio(name, bio) {
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  u.bio = String(bio == null ? '' : bio).replace(/\s+/g, ' ').trim().slice(0, 120);
  touch();
  return { ok: true, user: u };
}
// Tukar nama paparan. Tukuk ID kekal → bilik DM, mesej dan unread tidak rosak.
function rename(name, next) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  const clean = normalizeName(next);
  if (!clean) return { error: 'Nama mesti 2–20 aksara (huruf/nombor/spasi sahaja).' };
  if (/^\d{6}$/.test(clean)) return { error: 'Nama tidak boleh berupa 6 angka (format Tukuk ID).' };
  const old = key(u.name);
  if (old === key(clean)) return { ok: true, user: u, changed: false };
  if (s.users[key(clean)]) return { error: 'Nama itu sudah digunakan orang lain.' };
  delete s.users[old];
  u.name = clean; u.k = key(clean);
  s.users[u.k] = u;
  for (const r of Object.values(s.rooms)) {
    if (r.kind !== 'dm' || !r.memberIds) continue;
    const i = r.memberIds.indexOf(u.id);
    if (i >= 0 && r.members && r.members[i] !== clean) { r.members[i] = clean; }
  }
  for (const sess of Object.values(s.sessions)) if (sess.uid === u.id) { sess.k = u.k; sess.name = clean; }
  for (const [k2, v] of Object.entries(s.seen)) {
    const p = k2.split('|');
    if (p.length === 2 && p[1] === old) { delete s.seen[k2]; s.seen[p[0] + '|' + u.k] = v; }
  }
  for (const k2 of Object.keys(s.typing)) {
    const p = k2.split('|');
    if (p.length === 2 && p[1] === old) delete s.typing[k2];
  }
  touch();
  return { ok: true, user: u, changed: true };
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
    event('Akaun chat baharu: ' + r.user.name, { name: r.user.name, id: r.user.id });
    res.json({ ok: true, token, name: r.user.name, id: r.user.id });
  });

  app.post('/api/chat/login', lim({ windowMs: 15 * 60e3, max: 20, keyPrefix: 'chlogin:' }), (req, res) => {
    const b = cleanBody(req.body);
    const r = login(b.name, b.pass);
    if (r.error) return res.status(401).json({ error: r.error });
    res.json({ ok: true, token: issueSession(r.user.name), name: r.user.name, id: r.user.id });
  });

  app.post('/api/chat/logout', (req, res) => { revoke(bearer(req)); res.json({ ok: true }); });

  app.get('/api/chat/me', (req, res) => {
    const u = userOf(bearer(req));
    if (!u) return res.json({ ok: true, name: null });
    res.json({ ok: true, name: u.name, id: u.id, bio: u.bio || '', joined: u.createdAt || null, online: true });
  });

  // Boleh dipanggil mana-mana app di tukuk.org — token chat yang sama = identitas sama.
  app.get('/api/whoami', (req, res) => {
    const u = userOf(bearer(req));
    if (!u) return res.json({ ok: true, id: null, name: null });
    res.json({ ok: true, id: u.id, name: u.name, bio: u.bio || '', joined: u.createdAt || null });
  });

  app.get('/api/chat/rooms', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const un = unread(u.name); const on = onlineMap();
    const rooms = roomsFor(u.name).map(r => {
      const last = (r.list || [])[Math.max(0, (r.list || []).length - 1)];
      const pid = peerId(r, u.id);
      const peer = pid ? byId(pid) : null;
      return {
        id: r.id, kind: r.kind, title: roomTitle(r, u),
        members: r.members, peerId: pid, unread: un[r.id] || 0, seq: r.seq || 0,
        peer: peer ? { id: peer.id, name: peer.name, bio: peer.bio || '' } : null,
        last: last ? { from: authorName(last), fid: last.fid || null, t: last.del ? null : last.t, ts: last.ts } : null,
        online: r.kind === 'global' ? Object.values(on).filter(Boolean).length : !!(peer && isOnline(peer)),
      };
    }).sort((a, b) => (b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0));
    res.json({ ok: true, rooms });
  });

  app.get('/api/chat/messages', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const room = String(req.query.room || '');
    if (!canRead(u.name, room)) return res.status(403).json({ error: 'Bilik bukan milik anda.' });
    // hanya tandakan "dibaca" bila kliennya memang paparkan bilik itu (elak badge hilang di mobile)
    if (req.query.read === '1') markSeen(u.name, room);
    // Senarai pengguna hanya dihantar pada refresh penuh — elak poll 2.5s membazir bandwidth.
    if (req.query.full === '1') { const r = state.rooms[room]; return res.json({ ok: true, msgs: (r.list || []).slice(-KEEP), seq: r.seq || 0, typing: typingIn(room), people: people(null, 300) }); }
    const out = since(u.name, room, req.query.after);
    res.json({ ok: true, msgs: out.msgs, seq: out.seq, typing: typingIn(room) });
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
    const raw = cleanBody(req.body).peer;
    const peer = findUser(raw);   // boleh Tukuk ID (nombor) atau nama
    if (!peer) return res.status(400).json({ error: normalizeName(raw) ? 'Pengguna itu belum mendaftar di Tukuk Chat.' : 'Tiada ID atau nama begitu.' });
    if (peer.id === u.id) return res.status(400).json({ error: 'Tidak boleh DM diri sendiri.' });
    const r = ensureDm(u, peer);
    if (!r) return res.status(400).json({ error: 'Tiada ID atau nama begitu.' });
    res.json({ ok: true, room: { id: r.id, kind: r.kind, title: roomTitle(r, u), members: r.members, peerId: peer.id, seq: r.seq || 0 }, profile: profile(peer) });
  });

  app.get('/api/chat/user', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const p = profile(req.query.q);
    if (!p) return res.status(404).json({ error: 'Pengguna tidak ditemui.' });
    res.json({ ok: true, profile: p });
  });

  app.post('/api/chat/profile', lim({ windowMs: 3600e3, max: 30, keyPrefix: 'chprof:' }), (req, res) => {
    let u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    if (b.name != null && String(b.name).trim() !== u.name) {
      const r = rename(u.name, b.name);
      if (r.error) return res.status(400).json({ error: r.error });
      u = r.user || u;
    }
    if (b.bio != null) {
      const r = setBio(u.name, b.bio);
      if (r.error) return res.status(400).json({ error: r.error });
    }
    event('Profil dikemas kini: ' + u.name, { id: u.id });
    res.json({ ok: true, name: u.name, id: u.id, profile: profile(u.name) });
  });

  app.post('/api/chat/typing', (req, res) => {
    const u = userOf(bearer(req)); if (!u) return res.json({ ok: true });
    setTyping(u.name, String(cleanBody(req.body).room || ''));
    res.json({ ok: true });
  });

  app.get('/api/chat/people', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    res.json({ ok: true, people: people(req.query.q, 50) });
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
  byId, findUser, nameOfUser, peerId, isMember, sameAuthor, authorName,
  profile, rename, setBio, isOnline, cleanText,
};
