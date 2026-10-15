// T Chat — backend multi-pengguna untuk app /apps/chat.
// Akaun (scrypt), sesi bearer-token, bilik global + DM 1-ke-1, mesej dengan
// reply/reaction/edit/padam, lampiran gambar & video, kehadiran (online/menaip).
// Metadata dalam satu fail JSON di data/chat.json; fail media di data/chat-media/.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'chat.json');
const MAX_MSG = 500;        // panjang mesej
const KEEP = 200;           // mesej terakhir per bilik
const SESSION_TTL = 30 * 24 * 3600e3;
const ONLINE_MS = 90e3;     // dianggap dalam talian
const TYPING_MS = 4e3;      // paparan "menaip…"
const MAX_IMG = 8 * 1024 * 1024;            // had fail gambar (selepas mampat klien)
const MAX_VID = 64 * 1024 * 1024;           // had fail video
const MAX_AUDIO = 8 * 1024 * 1024;          // had mesej suara (opus/webm/ogg)
const MAX_PER_MSG = 4;                      // media satu mesej (album)
const QUOTA_FILES = 40;                     // fail per jam per pengguna
const QUOTA_BYTES = 512 * 1024 * 1024;      // saiz per jam per pengguna
const QUOTA_WIN = 3600e3;
const STORE_CAP = 3 * 1024 * 1024 * 1024;   // jumlah stor media seluruh tapak
const ORPHAN_TTL = 3600e3;                  // muat naik tak dihantar → buang

let FILE = DEFAULT_PATH;
let MEDIA = path.join(path.dirname(DEFAULT_PATH), 'chat-media');
let state = null;
let writeTimer = null;
let dirty = false;

// ─── Simpanan ───
const FIRST_ID = 100001;    // Tukuk ID pertama (nombor kekal, bukan nama)
function blank() {
  return { users: {}, sessions: {}, rooms: {}, msgs: {}, seen: {}, typing: {}, media: {}, quota: {}, mediaBytes: 0, mediaKey: '', nextId: FIRST_ID, pushSubs: {}, vapid: null };
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
  for (const u of Object.values(s.users)) {
    if (!u.id) { u.id = s.nextId++; changed = true; }
    // Akaun lama belum punya senarai kawan/sekat — kosongkan supaya kod lain
    // tidak perlu memeriksa kewujudannya setiap masa.
    if (!Array.isArray(u.friends)) { u.friends = []; changed = true; }
    if (!Array.isArray(u.blocked)) { u.blocked = []; changed = true; }
  }
  for (const [id, r] of Object.entries(s.rooms)) {
    if (r.kind === 'group') {
      if (!Array.isArray(r.admins)) { r.admins = r.memberIds && r.memberIds.length ? [r.memberIds[0]] : []; changed = true; }
      if (r.createdById == null) { const cu = Object.values(s.users).find(u => u.name === r.createdBy); r.createdById = cu ? cu.id : (r.admins[0] || null); changed = true; }
      continue;
    }
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
function setPath(p) { FILE = p; MEDIA = path.join(path.dirname(p), 'chat-media'); state = null; load(); }

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

// ─── Media (gambar + video) ───
// Fail mentah disimpan di data/chat-media/<id>.<ext>; metadata dalam JSON. Jenis
// ditentukan daripada bait ajaib (magic bytes), BUKAN header Content-Type klien.
function sniff(b) {
  if (!b || b.length < 16) return null;
  const at = (o, n) => b.toString('latin1', o, o + n);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && at(1, 3) === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (at(0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  if (at(0, 4) === 'RIFF' && at(8, 4) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (at(4, 4) === 'ftyp') {
    const brand = at(8, 4);
    if (/^(avif|avis)$/.test(brand)) return { ext: 'avif', mime: 'image/avif' };
    if (/^(hei[ctsm]|mif1|msf1|iso8)$/.test(brand)) return { ext: 'heic', mime: 'image/heic' };
    if (/^qt/.test(brand)) return { ext: 'mov', mime: 'video/quicktime' };
    return { ext: 'mp4', mime: 'video/mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', mime: 'video/webm' };
  if (at(0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg' };
  return null;
}
const isImage = (mime) => String(mime).startsWith('image/');
const isAudio = (mime) => String(mime).startsWith('audio/');
function mediaFile(rec) { return path.join(MEDIA, rec.id + '.' + rec.ext); }
function num(v, max) { const n = Math.round(Number(v) || 0); return n > 0 && n <= max ? n : 0; }
// Pautan media TIDAK boleh membawa token sesi (token masuk log pelayan), jadi
// setiap URL ditandatangani HMAC dengan tarikh luput. <img>/<video> boleh hantar
// terus dan sokong julat bayaran (Range) untuk lompat video.
const MEDIA_TTL = 6 * 3600e3;
function mediaSecret() {
  const s = load();
  if (!s.mediaKey) { s.mediaKey = crypto.randomBytes(32).toString('hex'); dirty = true; }
  return s.mediaKey;
}
const mac = (id, exp) => crypto.createHmac('sha256', mediaSecret()).update(id + '.' + exp).digest('hex').slice(0, 32);
// Tarikh luput dijana pada sempadan tempoh (bukan "sekarang + 6 jam") supaya URL
// yang sama kekal stabil — jika tidak, setiap poll menghasilkan pautan baharu dan
// pelayar memuat turun semula gambar/video yang sama.
function mediaUrl(id) {
  const exp = (Math.floor(Date.now() / MEDIA_TTL) + 2) * MEDIA_TTL;
  return '/api/chat/media/' + id + '?k=' + exp + '.' + mac(id, exp);
}
function mediaAllowed(id, k) {
  if (!/^[a-f0-9]{12}$/.test(String(id))) return false;
  const p = String(k || '').split('.');
  if (p.length !== 2) return false;
  const exp = Number(p[0]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const a = Buffer.from(mac(id, exp)), b = Buffer.from(p[1]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Rekod media untuk paparan (jalan hanya dengan tandatangan yang sah).
function mediaSrc(id) {
  const rec = (load().media || {})[/^[a-f0-9]{12}$/.test(String(id)) ? String(id) : ''];
  if (!rec || !fs.existsSync(mediaFile(rec))) return null;
  return rec;
}

function quotaCheck(u, size) {
  const s = load(); const now = Date.now();
  s.quota = s.quota || {};
  const q = s.quota[u.k] || { t: now, n: 0, b: 0 };
  if (now - q.t > QUOTA_WIN) { q.t = now; q.n = 0; q.b = 0; }
  if (q.n >= QUOTA_FILES) return { error: 'Terlalu banyak fail jam ini — cuba lagi sebentar.' };
  if (q.b + size > QUOTA_BYTES) return { error: 'Muat naik anda bulan ini sudah sampai had.' };
  if ((s.mediaBytes || 0) + size > STORE_CAP) return { error: 'Stor media tapak sudah penuh.' };
  q.n++; q.b += size; s.quota[u.k] = q;
  return { ok: true };
}
function addMedia(user, buf, meta) {
  const s = load();
  const t = sniff(buf);
  if (!t) return { error: 'Fail itu bukan gambar, video atau suara yang disokong.', status: 415 };
  const img = isImage(t.mime);
  // Klien boleh menanda mesej suara (audio=1); ogg/opus juga dikesan menerusi
  // bait ajaib. WebM audio mempunyai magic byte sama seperti video → bergantung
  // pada flag klien untuk membezakan jenis paparan.
  const audio = !img && (String((meta && meta.audio)) === '1' || isAudio(t.mime));
  const cap = img ? MAX_IMG : audio ? MAX_AUDIO : MAX_VID;
  if (buf.length > cap) return { error: img ? 'Gambar terlalu besar (had 8MB).' : audio ? 'Rekod suara terlalu besar (had 8MB).' : 'Video terlalu besar (had 64MB).', status: 413 };
  const q = quotaCheck(user, buf.length);
  if (q.error) return { error: q.error, status: 429 };
  const id = crypto.randomBytes(6).toString('hex');
  const mime = audio && t.mime === 'video/webm' ? 'audio/webm' : t.mime;
  const rec = {
    id, ext: t.ext, mime, kind: img ? 'image' : audio ? 'audio' : 'video', size: buf.length,
    uid: user.id || null, by: user.k, ts: Date.now(), rooms: [], msgs: [],
  };
  const w = num(meta && meta.w, 10000), h = num(meta && meta.h, 10000), dur = num(meta && meta.dur, 3600);
  if (w && h) { rec.w = w; rec.h = h; }
  if (!img && dur) rec.dur = dur;
  try {
    fs.mkdirSync(MEDIA, { recursive: true });
    fs.writeFileSync(mediaFile(rec), buf);
  } catch { return { error: 'Gagal menyimpan fail di pelayan.', status: 500 }; }
  s.media = s.media || {};
  s.media[id] = rec;
  s.mediaBytes = (s.mediaBytes || 0) + buf.length;
  touch();
  return { ok: true, media: rec };
}
// Ringkasan yang disemat dalam mesej (supaya paparan tak perlu satu lagi GET).
function projectMedia(rec) {
  const out = { id: rec.id, kind: rec.kind, ext: rec.ext };
  if (rec.w && rec.h) { out.w = rec.w; out.h = rec.h; }
  if (rec.dur) out.dur = rec.dur;
  if (rec.size) out.size = rec.size;
  return out;
}
// Tandatangan dijana semula setiap kali dihantar — jadi mesej yang disimpan
// tidak pernah mengandungi URL yang boleh luput.
function hydrate(m) {
  if (!m || !m.media || !m.media.length) return m;
  const out = Object.assign({}, m);
  out.media = m.media.map(x => Object.assign({}, x, { url: mediaUrl(x.id) }));
  return out;
}
const hydrateAll = (list) => (list || []).map(hydrate);
// Lampirkan fail yang sudah dimuat naik pada mesej bilik ini. Hak = pemilik muat
// naik, atau sesiapa yang boleh baca bilik yang sudah memaparkan fail itu (membolehkan
// "teruskan" gambar kawan tanpa menyalin fail di disk).
function ownsMedia(user, rec) {
  if (user.k && rec.by === user.k) return true;
  if (!user.name) return false;
  return (rec.rooms || []).some(rid => canRead(user.name, rid));
}
function attachMedia(user, roomId, ids, msgId) {
  const s = load();
  const out = [];
  for (const raw of ids || []) {
    const id = String(raw && raw.id ? raw.id : raw);
    const rec = (s.media || {})[/^[a-f0-9]{12}$/.test(id) ? id : ''];
    if (!rec || !fs.existsSync(mediaFile(rec))) continue;
    if (!ownsMedia(user, rec)) continue;
    if (!rec.msgs.includes(msgId)) rec.msgs.push(msgId);
    if (!rec.rooms.includes(roomId)) rec.rooms.push(roomId);
    out.push(projectMedia(rec));
    if (out.length >= MAX_PER_MSG) break;
  }
  return out;
}
function dropMedia(id) {
  const s = load(); const rec = (s.media || {})[id];
  if (!rec) return;
  try { fs.unlinkSync(mediaFile(rec)); } catch { /* sudah tiada */ }
  s.mediaBytes = Math.max(0, (s.mediaBytes || 0) - (rec.size || 0));
  delete s.media[id];
  touch();
}
// Buang rujukan mesej; fail dipadam bila tiada lagi mesej yang memakainya.
function releaseMedia(items, msgId) {
  const s = load();
  for (const it of items || []) {
    const rec = (s.media || {})[it && it.id];
    if (!rec) continue;
    rec.msgs = (rec.msgs || []).filter(x => x !== msgId);
    if (!rec.msgs.length) dropMedia(rec.id);
  }
}
// Pembaca badan mentah — muat naik gambar/video bukan JSON, jadi tak guna
// express.json. Had saiz dikuatkuasakan sendiri supaya ralat boleh difahami.
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('Fail terlalu besar.')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('aborted', () => reject(new Error('Muat naik dibatalkan.')));
    req.on('error', () => reject(new Error('Muat naik gagal.')));
  });
}

function register(name, pass) {
  const s = load();
  const clean = normalizeName(name);
  if (!clean) return { error: 'Nama mesti 2–20 aksara (huruf/nombor/spasi sahaja).' };
  if (String(pass || '').length < 4) return { error: 'Kata laluan sekurang-kurangnya 4 aksara.' };
  if (s.users[key(clean)]) return { error: 'Nama sudah digunakan. Cuba login.' };
  if (/^\d{6}$/.test(key(clean))) return { error: 'Nama tidak boleh berupa 6 angka (format Tukuk ID).' };
  const salt = crypto.randomBytes(16).toString('hex');
  s.users[key(clean)] = { name: clean, k: key(clean), id: s.nextId++, salt, hash: hashPass(pass, salt), createdAt: Date.now(), lastSeen: 0, bio: '', friends: [], blocked: [] };
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
    pubRoom(r, 'room', { room: r.id });   // pasangan terus nampak bilik baharu
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
// ─── Bilik kumpulan ───
function createGroup(creatorName, title, memberIds) {
  const s = load();
  const t = String(title || '').trim().slice(0, 40);
  if (!t) return { error: 'Nama kumpulan diperlukan.' };
  const creator = findUser(creatorName);
  if (!creator) return { error: 'Pengguna tidak ditemui.' };
  const members = [creator];
  for (const id of (memberIds || [])) {
    const u = byId(id);
    if (u && u.id !== creator.id && !members.some(m => m.id === u.id)) members.push(u);
  }
  if (members.length < 2) return { error: 'Perlukan sekurang-kurangnya seorang ahli lain.' };
  if (members.length > 50) return { error: 'Melebihi 50 ahli.' };
  const id = 'grp_' + crypto.randomBytes(6).toString('hex');
  const r = { id, kind: 'group', title: t, memberIds: members.map(u => u.id), members: members.map(u => u.name), admins: [creator.id], createdBy: creator.name, createdById: creator.id, createdAt: Date.now(), seq: 0, list: [] };
  s.rooms[id] = r; touch();
  pubRoom(r, 'room', { room: id });
  return { ok: true, room: r };
}
function addToGroup(name, roomId, memberId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r || r.kind !== 'group') return { error: 'Kumpulan tidak ditemui.' };
  if (!isMember(r, name)) return { error: 'Anda bukan ahli kumpulan ini.' };
  const u = byId(memberId);
  if (!u) return { error: 'Pengguna tidak ditemui.' };
  if (r.memberIds.includes(u.id)) return { ok: true, already: true };
  if (r.memberIds.length >= 50) return { error: 'Kumpulan sudah penuh (50 ahli).' };
  r.memberIds.push(u.id);
  r.members = r.memberIds.map(id2 => nameOfUser(id2));
  touch();
  pubRoom(r, 'room', { room: roomId });
  return { ok: true };
}
const adminsOf = (r) => (r && Array.isArray(r.admins) ? r.admins : []);
const isGroupAdmin = (r, name) => adminsOf(r).includes(uid(name));
// Buang satu ID daripada senarai admin; jika tiada baki, promosikan ahli terakhir
// supaya kumpulan tidak pernah kehilangan pentadbir.
function promoteAdmin(r) {
  r.admins = (r.admins || []).filter(id => r.memberIds.includes(id));
  if (!r.admins.length && r.memberIds.length) r.admins = [r.memberIds[0]];
}
function dissolveGroup(roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r || r.kind !== 'group') return;
  for (const m of (r.list || [])) releaseMedia(m.media, m.id);
  delete s.rooms[roomId];
  for (const k of Object.keys(s.seen)) if (k.startsWith(roomId + '|')) delete s.seen[k];
  for (const k of Object.keys(s.typing)) if (k.endsWith('|' + roomId)) delete s.typing[k];
  touch();
  pubRoom(r, 'delroom', { room: roomId });
}
function leaveGroup(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r || r.kind !== 'group') return { error: 'Kumpulan tidak ditemui.' };
  const u = findUser(name);
  if (!u || !r.memberIds.includes(u.id)) return { error: 'Anda bukan ahli kumpulan ini.' };
  r.memberIds = r.memberIds.filter(i => i !== u.id);
  r.members = r.memberIds.map(i => nameOfUser(i));
  if (!r.memberIds.length) { dissolveGroup(roomId); return { ok: true, dissolved: true }; }
  promoteAdmin(r);
  touch();
  pubRoom(r, 'room', { room: roomId });
  return { ok: true };
}
// ─── Pentadbiran kumpulan (hanya admin) ───
function groupAdmin(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r || r.kind !== 'group') return { error: 'Kumpulan tidak ditemui.' };
  if (!isMember(r, name)) return { error: 'Anda bukan ahli kumpulan ini.' };
  if (!isGroupAdmin(r, name)) return { error: 'Hanya admin boleh melakukan ini.' };
  return { ok: true, room: r };
}
function renameGroup(name, roomId, title) {
  const g = groupAdmin(name, roomId); if (g.error) return g;
  const t = String(title || '').trim().slice(0, 40);
  if (!t) return { error: 'Nama kumpulan diperlukan.' };
  g.room.title = t; touch();
  pubRoom(g.room, 'room', { room: roomId });
  return { ok: true, title: t };
}
function kickFromGroup(name, roomId, memberId) {
  const g = groupAdmin(name, roomId); if (g.error) return g;
  const r = g.room; const u = byId(memberId);
  if (!u || !r.memberIds.includes(u.id)) return { error: 'Pengguna itu bukan ahli.' };
  if (u.id === uid(name)) return { error: 'Gunakan "keluar" untuk buang diri sendiri.' };
  r.memberIds = r.memberIds.filter(i => i !== u.id);
  r.members = r.memberIds.map(i => nameOfUser(i));
  promoteAdmin(r);
  if (r.memberIds.length <= 1) { dissolveGroup(roomId); return { ok: true, dissolved: true }; }
  touch();
  pubRoom(r, 'room', { room: roomId });
  return { ok: true };
}
function addAdmin(name, roomId, memberId, remove) {
  const g = groupAdmin(name, roomId); if (g.error) return g;
  const r = g.room; const u = byId(memberId);
  if (!u || !r.memberIds.includes(u.id)) return { error: 'Pengguna itu bukan ahli.' };
  r.admins = adminsOf(r);
  if (remove) r.admins = r.admins.filter(i => i !== u.id);
  else if (!r.admins.includes(u.id)) r.admins.push(u.id);
  if (!r.admins.length) r.admins = [uid(name)];
  touch();
  pubRoom(r, 'room', { room: roomId });
  return { ok: true, admins: r.admins };
}
function dissolveBy(name, roomId) {
  const g = groupAdmin(name, roomId); if (g.error) return g;
  const r = g.room;
  // Hanya pencipta boleh bubarkan — kecuali pencipta sudah tiada dalam kumpulan,
  // maka admin yang tinggal mengambil alih hak itu.
  if (r.createdById && r.createdById !== uid(name) && (r.memberIds || []).includes(r.createdById)) return { error: 'Hanya pencipta boleh membubarkan kumpulan ini.' };
  dissolveGroup(roomId);
  return { ok: true, dissolved: true };
}
function roomTitle(r, viewer) {
  if (!r || r.kind === 'global') return (r && r.title) || '🌍 Am';
  if (r.kind === 'group') return r.title || '👥 Kumpulan';
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
function send(name, roomId, text, replyTo, media) {
  const s = load();
  const r = s.rooms[roomId];
  if (!r) return { error: 'Bilik tidak ditemui.' };
  if (!r.list) r.list = [];
  if (!r.seq) r.seq = 0;
  const su = findUser(name);
  // DM yang salah seorang anggotanya menyekat dibekukan dua-dua arah: masih
  // boleh dibaca, tetapi tak seorang pun boleh menghantar mesej baharu.
  if (r.kind === 'dm') {
    const pid = peerId(r, su ? su.id : uid(name));
    if (pid && dmFrozen(su || name, byId(pid))) return { error: 'Mesej tidak dapat dihantar ke bilik ini.' };
  }
  const msgId = crypto.randomBytes(6).toString('hex');
  const att = media && media.length ? attachMedia(su || { k: key(name) }, roomId, media, msgId) : [];
  if (media && media.length && !att.length) return { error: 'Lampiran tidak dapat digunakan — muat naik semula.' };
  const t = cleanText(text);
  if (!t && !att.length) return { error: 'Mesej kosong.' };
  if (replyTo && !r.list.find(m => m.id === replyTo)) replyTo = null;
  const msg = { id: msgId, seq: ++r.seq, from: su ? su.name : name, fid: su ? su.id : null, t, ts: Date.now(), to: replyTo || null, rx: {}, edited: false, del: false, pinned: false };
  if (att.length) msg.media = att;
  r.list.push(msg);
  trimRoom(r);
  const wasTyping = !!s.typing[key(name) + '|' + roomId];
  delete s.typing[key(name) + '|' + roomId];
  touch();
  const out = hydrate(msg);
  pubRoom(r, 'msg', { room: r.id, seq: r.seq, msg: out });
  maybePush(r, out).catch(() => {});
  // Penunjuk menaip perlu habis serta-merta pada tab lain, bukan tunggu poll.
  if (wasTyping) pubRoom(r, 'typing', { room: r.id, typing: [] });
  return { ok: true, msg: out, room: r };
}
// Simpan hanya KEEP mesej terakhir; fail yang keluar dari senarai dibuang.
function trimRoom(r) {
  if (r.list.length <= KEEP) return;
  const out = r.list.splice(0, r.list.length - KEEP);
  for (const m of out) releaseMedia(m.media, m.id);
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
  if (!r) return;
  const seq = r.seq || 0;
  s.seen[roomId + '|' + key(name)] = seq; touch();
  // DM: maklumkan pasangan sampai bila mesej mereka sudah dibaca → resit ✓✓.
  if (r.kind === 'dm') {
    const me = findUser(name);
    const pid = me ? peerId(r, me.id) : null;
    if (pid) pub('read', { room: roomId, seq }, [pid]);
  }
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
  const out = hydrate(m);
  pubRoom(r, 'react', { room: r.id, msg: out });
  return { ok: true, msg: out };
}
function edit(name, roomId, msgId, text) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Bilik tidak ditemui.' };
  const m = (r.list || []).find(x => x.id === msgId);
  if (!m) return { error: 'Mesej tidak ditemui.' };
  if (!sameAuthor(m, name)) return { error: 'Hanya mesej sendiri boleh diubah.' };
  const t = cleanText(text);
  if (!t) return { error: 'Mesej kosong.' };
  m.t = t; m.edited = true; touch();
  const out = hydrate(m);
  pubRoom(r, 'edit', { room: r.id, msg: out });
  return { ok: true, msg: out };
}
function remove(name, roomId, msgId) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Bilik tidak ditemui.' };
  const i = (r.list || []).findIndex(x => x.id === msgId);
  if (i < 0) return { error: 'Mesej tidak ditemui.' };
  if (!sameAuthor(r.list[i], name)) return { error: 'Hanya mesej sendiri boleh dipadam.' };
  const [gone] = r.list.splice(i, 1);
  releaseMedia(gone.media, gone.id);
  touch();
  pubRoom(r, 'del', { room: r.id, id: msgId });
  return { ok: true };
}
// Pin/unpin. Dalam bilik global & kumpulan: hanya admin (atau pemilik mesej pada
// bilik global) boleh pin. DM: kedua-dua ahli boleh. Pinned disimpan pada mesej.
function pinMsg(name, roomId, msgId, pinned) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Bilik tidak ditemui.' };
  const m = (r.list || []).find(x => x.id === msgId); if (!m) return { error: 'Mesej tidak ditemui.' };
  if (r.kind === 'group' && !isGroupAdmin(r, name)) return { error: 'Hanya admin boleh pin mesej.' };
  m.pinned = !!pinned; touch();
  const out = hydrate(m);
  pubRoom(r, 'pin', { room: r.id, id: msgId, pinned: m.pinned, msg: out });
  return { ok: true, msg: out, pinned: m.pinned };
}
function setTyping(name, roomId) {
  const s = load();
  if (!s.rooms[roomId]) return;
  s.typing[key(name) + '|' + roomId] = Date.now(); touch();
  pubRoom(s.rooms[roomId], 'typing', { room: roomId, typing: typingIn(roomId) });
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
// Carian mesej merentas semua bilik yang boleh dibaca.  Min 2 aksara, maks 30 hasil.
function searchMsgs(name, query) {
  const s = load();
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (const r of Object.values(s.rooms)) {
    if (!canRead(name, r.id)) continue;
    for (const m of (r.list || [])) {
      if (m.del || !m.t) continue;
      if (!String(m.t).toLowerCase().includes(q)) continue;
      out.push({ id: m.id, room: r.id, roomKind: r.kind, roomTitle: roomTitle(r, name), from: authorName(m), fid: m.fid, t: String(m.t).slice(0, 200), ts: m.ts });
      if (out.length >= 60) break;
    }
    if (out.length >= 60) break;
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 30);
}

// ─── Web Push (VAPID) ───
// Tanpa pakej luar: kunci EC P-256 dijana sekali dan disimpan dalam JSON state.
// Push dihantar dengan badan kosong — SW memaparkan notifikasi generik.
function initVapid() {
  const s = load();
  if (s.vapid) return;
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    s.vapid = { pub: publicKey, priv: privateKey };
    touch();
  } catch { /* crypto tidak tersedia */ }
}
function vapidPubB64() {
  initVapid();
  const s = load();
  if (!s.vapid) return null;
  try {
    const jwk = crypto.createPublicKey(s.vapid.pub).export({ format: 'jwk' });
    return Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x, 'base64url'),
      Buffer.from(jwk.y, 'base64url'),
    ]).toString('base64url');
  } catch { return null; }
}
// Tukar tandatangan DER (crypto.sign) kepada mentah 64-bait ES256.
function derSigToRaw(der) {
  let pos = 2;
  if (der[1] & 0x80) pos += (der[1] & 0x7f);
  const rLen = der[pos + 1];
  let r = der.slice(pos + 2, pos + 2 + rLen);
  if (r[0] === 0x00) r = r.slice(1);
  r = Buffer.concat([Buffer.alloc(32 - r.length, 0), r], 32);
  const sTag = pos + 2 + rLen;
  const sLen = der[sTag + 1];
  let sv = der.slice(sTag + 2, sTag + 2 + sLen);
  if (sv[0] === 0x00) sv = sv.slice(1);
  sv = Buffer.concat([Buffer.alloc(32 - sv.length, 0), sv], 32);
  return Buffer.concat([r, sv]);
}
async function doSendPush(sub, vapid) {
  const url = new URL(sub.endpoint);
  const aud = url.origin;
  const iat = Math.floor(Date.now() / 1000);
  const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const hdr = b64u({ typ: 'JWT', alg: 'ES256' });
  const pl = b64u({ aud, exp: iat + 43200, sub: 'mailto:admin@tukuk.org', iat });
  const input = hdr + '.' + pl;
  const der = crypto.sign('sha256', Buffer.from(input), crypto.createPrivateKey(vapid.priv));
  const jwt = input + '.' + derSigToRaw(der).toString('base64url');
  const k = vapidPubB64();
  if (!k) return;
  await axios.put(sub.endpoint, '', {
    headers: { Authorization: 'vapid t=' + jwt + ', k=' + k, TTL: '3600', Urgency: 'normal', 'Content-Length': '0' },
    timeout: 10000,
  });
}
// Hantar push untuk ahli DM/kumpulan yang tiada sink SSE aktif.
async function maybePush(room, msg) {
  if (!room || room.kind === 'global') return;
  const s = load();
  if (!s.vapid) return;
  for (const uid of (room.memberIds || [])) {
    if (uid === msg.fid) continue;
    if (sinks.has(uid)) continue;
    for (const sub of (s.pushSubs[String(uid)] || [])) {
      try { await doSendPush(sub, s.vapid); } catch { /* perkhidmatan push mati */ }
    }
  }
}
// Direktori pengguna. `viewer` (pilihan) menapis mereka yang MENYEKAT penonton
// dan menanda status kawan/sekat supaya klien tak perlu teka.
function people(query, limit, viewer) {
  const s = load();
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const qid = Number(q);
  const me = viewer ? findUser(viewer) : null;
  const blockers = me ? new Set(Object.values(s.users).filter(v => blockedOf(v).includes(me.id)).map(v => v.id)) : new Set();
  return Object.values(s.users)
    .filter(u => !q || u.name.toLowerCase().includes(q) || (Number.isInteger(qid) && qid >= FIRST_ID && u.id === qid))
    .filter(u => !me || u.id === me.id || !blockers.has(u.id))
    .map(u => ({
      id: u.id, name: u.name, bio: u.bio || '', online: isOnline(u),
      friend: !!me && friendsOf(me).includes(u.id),
      blocked: !!me && blockedOf(me).includes(u.id),
    }))
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name))
    .slice(0, limit || 50);
}
// Paparan awam: "siapa punya ID/nama ini?" — nama, bio, tarikh sertai, kehadiran.
// Jika orang itu menyekat penonton, kami berpura dia tiada (tiada kebocoran).
function profile(query, viewer) {
  const u = findUser(query);
  if (!u) return null;
  const me = viewer ? findUser(viewer) : null;
  if (me && u.id !== me.id && blockedOf(u).includes(me.id)) return null;
  return {
    id: u.id, name: u.name, bio: u.bio || '', joined: u.createdAt || null, online: isOnline(u),
    friend: !!me && friendsOf(me).includes(u.id),
    blocked: !!me && blockedOf(me).includes(u.id),
  };
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
// ─── Kawan & sekatan ───
// Kedua-dua senarai menyimpan Tukuk ID (bukan nama) supaya pertukaran nama
// tidak merosakkannya. Sekatan membekukan DM dua-dua arah: tiada pihak boleh
// menghantar mesej, tetapi sejarah masih boleh dibaca. Mesej ralat disengajakan
// generik — pihak yang disekat tidak boleh mengesahkan keadaan itu.
const MAX_FRIENDS = 500, MAX_BLOCKS = 200;
const friendsOf = (u) => (u && Array.isArray(u.friends) ? u.friends : []);
const blockedOf = (u) => (u && Array.isArray(u.blocked) ? u.blocked : []);
const asUser = (who) => ((who && typeof who === 'object') ? who : findUser(who));
const iBlock = (a, b) => !!a && !!b && blockedOf(a).includes(b.id);
const otherBlock = (a, b) => !!a && !!b && blockedOf(b).includes(a.id);
const dmFrozen = (a, b) => { const ua = asUser(a), ub = asUser(b); return iBlock(ua, ub) || otherBlock(ua, ub); };

// Sasaran sosial: mesti wujud dan bukan akaun sendiri.
function socialTarget(u, q) {
  const t = findUser(q);
  if (!t) return { error: normalizeName(q) ? 'Pengguna itu belum mendaftar di T Chat.' : 'Tiada ID atau nama begitu.' };
  if (t.id === u.id) return { error: 'Itu akaun anda sendiri.' };
  return { ok: true, peer: t };
}

function addFriend(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  if (blockedOf(u).includes(t.peer.id)) return { error: 'Buang sekat dahulu sebelum menjadikannya kawan.' };
  if (blockedOf(t.peer).includes(u.id)) return { error: 'Pengguna itu tidak dapat ditemui.' };
  if (friendsOf(u).includes(t.peer.id)) return { ok: true, user: u, peer: t.peer, already: true };
  if (friendsOf(u).length >= MAX_FRIENDS) return { error: 'Senarai kawan sudah sampai had ' + MAX_FRIENDS + '.' };
  (u.friends = friendsOf(u)).push(t.peer.id);
  touch();
  pub('social', {}, [u.id]);
  return { ok: true, user: u, peer: t.peer };
}
function delFriend(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  u.friends = friendsOf(u).filter((i) => i !== t.peer.id); // sejarah DM tidak diusik
  touch();
  pub('social', {}, [u.id]);
  return { ok: true, user: u, peer: t.peer };
}
function blockUser(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  if (blockedOf(u).includes(t.peer.id)) return { ok: true, user: u, peer: t.peer, already: true };
  if (blockedOf(u).length >= MAX_BLOCKS) return { error: 'Senarai sekat sudah sampai had ' + MAX_BLOCKS + '.' };
  (u.blocked = blockedOf(u)).push(t.peer.id);
  u.friends = friendsOf(u).filter((i) => i !== t.peer.id);
  t.peer.friends = friendsOf(t.peer).filter((i) => i !== u.id); // persahabatan dua arah dibuang
  touch();
  pub('social', {}, [u.id]);   // hanya penyekat diberitahu — mangsa tidak tahu
  return { ok: true, user: u, peer: t.peer };
}
function unblockUser(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  u.blocked = blockedOf(u).filter((i) => i !== t.peer.id);
  touch();
  pub('social', {}, [u.id]);
  return { ok: true, user: u, peer: t.peer };
}
// Senarai untuk skrin Tetapan. Kawan bawa `dm` (id bilik sedia ada / null).
function socialLists(name) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  const wrap = (ids, withDm) => ids.map((id) => {
    const p = byId(id);
    if (!p) return null;
    const out = { id: p.id, name: p.name, bio: p.bio || '', online: isOnline(p) };
    if (withDm) { const rid = dmId(u.id, p.id); out.dm = s.rooms[rid] ? rid : null; }
    return out;
  }).filter(Boolean).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  return { ok: true, friends: wrap(friendsOf(u), true), blocked: wrap(blockedOf(u), false) };
}

// Tukar kata laluan: wajib sah yang lama, salt baru, dan sesi lain diluputkan
// (peranti lain perlu login semula; token yang sedang dipakai kekal hidup).
function setPass(name, oldPass, nextPass) {
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  if (!eqHex(u.hash, hashPass(String(oldPass == null ? '' : oldPass), u.salt))) return { error: 'Kata laluan semasa salah.', status: 401 };
  const p = String(nextPass == null ? '' : nextPass);
  if (p.length < 4) return { error: 'Kata laluan baharu sekurang-kurangnya 4 aksara.' };
  if (p.length > 200) return { error: 'Kata laluan baharu terlalu panjang.' };
  if (eqHex(u.hash, hashPass(p, u.salt))) return { error: 'Kata laluan baharu sama dengan yang lama.' };
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPass(p, u.salt);
  touch();
  return { ok: true, user: u };
}
function logoutAll(name, keep) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  let n = 0;
  for (const [tok, sess] of Object.entries(s.sessions)) {
    if (tok === keep) continue;
    if ((sess.uid && sess.uid === u.id) || key(sess.name) === u.k) { delete s.sessions[tok]; n++; }
  }
  touch();
  return { ok: true, revoked: n };
}
// Padam akaun serta-merta dan tanpa boleh dibatalkan. Kata laluan wajib sah.
// Buang pengguna, sesi, langganan push, keanggotaan bilik (DM dibuang, kumpulan
// dibubarkan jika dia pencipta atau admin dipromosikan jika tidak), lihat/typing,
// serta media yang dimilikinya. Mesej dalam bilik kekal atas nama lama (sejarah).
function deleteAccount(name, pass) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Akaun tidak ditemui.' };
  if (!eqHex(u.hash, hashPass(String(pass == null ? '' : pass), u.salt))) return { error: 'Kata laluan salah.', status: 401 };
  const id = u.id, k = u.k;
  // 1) Sesi & langganan push
  for (const [tok, sess] of Object.entries(s.sessions)) if ((sess.uid && sess.uid === id) || key(sess.name) === k) delete s.sessions[tok];
  if (s.pushSubs) delete s.pushSubs[String(id)];
  // 2) Bilik
  for (const [rid, r] of Object.entries(s.rooms)) {
    if (r.kind === 'group') {
      if (r.createdById === id) { for (const m of (r.list || [])) releaseMedia(m.media, m.id); delete s.rooms[rid]; continue; }
      if (!r.memberIds || !r.memberIds.includes(id)) continue;
      r.memberIds = r.memberIds.filter(i => i !== id);
      r.members = r.memberIds.map(i => nameOfUser(i));
      r.admins = adminsOf(r).filter(i => i !== id);
      if (!r.memberIds.length) { delete s.rooms[rid]; continue; }
      promoteAdmin(r);
    } else if (r.kind === 'dm') {
      if (!r.memberIds || !r.memberIds.includes(id)) continue;
      for (const m of (r.list || [])) releaseMedia(m.media, m.id);
      delete s.rooms[rid];
    }
  }
  // 3) Lihat & menaip milik pengguna ini
  for (const sk of Object.keys(s.seen)) if (sk.endsWith('|' + k)) delete s.seen[sk];
  for (const tk of Object.keys(s.typing)) if (tk.startsWith(k + '|')) delete s.typing[tk];
  // 4) Media milik pengguna
  for (const [mid, rec] of Object.entries(s.media || {})) if (rec.by === k) dropMedia(mid);
  // 5) Akaun
  delete s.users[k];
  touch();
  return { ok: true, id };
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
  // Muat naik yang tak pernah jadi mesej (tab ditutup) + fail tanpa rujukan → buang.
  for (const [id, rec] of Object.entries(s.media || {})) {
    if (rec.msgs && rec.msgs.length) continue;
    if (now - (rec.ts || 0) > ORPHAN_TTL) dropMedia(id);
  }
  for (const [k, q] of Object.entries(s.quota || {})) if (now - q.t > QUOTA_WIN * 4) delete s.quota[k];
  touch();
}
setInterval(sweep, 10 * 60e3).unref?.();

// ─── Yuran langsung (SSE) ───
// Satu sambungan HTTP panjang per tab supaya mesej sampai serta-merta. Poll
// (since/markSeen) kekal sumber kebenaran — stream hanya memendekkan latensi,
// jadi sambungan yang PUTUS tidak menghilangkan apa-apa.
const MAX_STREAMS = 6;          // sambungan serentak untuk seorang pengguna
const BEAT_MS = 20e3;           // denyut: halang edge/terowong daripada idling
const sinks = new Map();        // userId -> Set(sink)
let beat = null, lastOn = null;

function attachSink(uid, snk) {
  const set = sinks.get(uid) || new Set();
  if (set.size >= MAX_STREAMS) return false;
  set.add(snk); sinks.set(uid, set);
  if (!beat) { beat = setInterval(tickBeat, BEAT_MS); if (beat.unref) beat.unref(); }
  return true;
}
function detachSink(uid, snk) {
  const set = sinks.get(uid);
  if (!set) return;
  set.delete(snk);
  if (!set.size) sinks.delete(uid);
  if (!sinks.size && beat) { clearInterval(beat); beat = null; lastOn = null; }
}
// `ids` kosong = semua yang bersambung (hanya maklumat AWAM seperti kehadiran).
// Khalayak DM ialah ahlinya sahaja — mesej tidak pernah disiarkan orang lain.
function pub(ev, data, ids) {
  const targets = ids && ids.length ? [].concat(ids) : Array.from(sinks.keys());
  for (const id of targets) {
    const set = sinks.get(id);
    if (!set) continue;
    for (const snk of set) { try { snk.send(ev, data); } catch { /* sambungan sedang mati */ } }
  }
}
function pubRoom(r, ev, data) {
  pub(ev, data, r && (r.kind === 'dm' || r.kind === 'group') ? (r.memberIds || []) : null);
}
// Tutup stream peranti lain (kata laluan tukar / keluar semua sesi) selepas
// sesi-sesi itu diluputkan — klien akan logout sendiri bila dapat 'kick'.
function kickSinks(uid, keepTok) {
  const set = sinks.get(uid); if (!set) return 0;
  let n = 0;
  for (const snk of Array.from(set)) {
    if (keepTok && snk.tok === keepTok) continue;
    try { snk.send('kick', {}); snk.close(); } catch { /* noop */ }
    n++;
  }
  return n;
}
function dropSink(tok) {
  let n = 0;
  for (const [uid, set] of Array.from(sinks)) {
    for (const snk of Array.from(set)) if (snk.tok === tok) { try { snk.close(); } catch { /* noop */ } detachSink(uid, snk); n++; }
  }
  return n;
}
// Denyut + pengesanan perubahan kehadiran (ONLINE_MS 90s) untuk semua tab.
function tickBeat() {
  const s = load();
  // Write yang terlepas (stream sudah dimusnahkan tapi 'close' belum sampai ke sini)
  // akan membangkitkan ralat — buang sink itu segera supaya slot tidak terperangkap.
  for (const [uid, set] of Array.from(sinks)) {
    for (const snk of Array.from(set)) {
      try { snk.ping(); } catch {
        try { snk.close(); } catch { /* sudah tertutup */ }
        detachSink(uid, snk);
      }
    }
  }
  const on = {};
  for (const u of Object.values(s.users)) on[u.id] = isOnline(u);
  if (lastOn) for (const [id, v] of Object.entries(on)) if (lastOn[id] !== v) pub('presence', { id: Number(id), online: v });
  lastOn = on;
}
// Buang semua yuran (dipakai ujian — keadaan modul tidak boleh merembes).
function clearSinks() {
  for (const set of Array.from(sinks.values())) for (const snk of set) { try { snk.close(); } catch { /* noop */ } }
  sinks.clear();
  if (beat) { clearInterval(beat); beat = null; }
  lastOn = null;
}

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

  app.post('/api/chat/logout', (req, res) => {
    const tok = bearer(req);
    const u = userOf(tok);
    revoke(tok);
    if (u) dropSink(tok);   // tab peranti ini berhenti menerima terus
    res.json({ ok: true });
  });

  // Aliran langsung (SSE) satu sambungan panjang per tab. Token melalui header
  // Bearer (fetch-stream), jadi tiada kredensial masuk ke URL atau log pelayan.
  app.get('/api/chat/stream', (req, res) => {
    const tok = bearer(req);
    const u = authOf(req, res); if (!u) return;
    let snk = null;
    const bye = () => { if (snk) { detachSink(u.id, snk); snk = null; } };
    snk = {
      tok,
      send: (ev, data) => { res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data || {}) + '\n\n'); },
      ping: () => { res.write(': t\n\n'); },
      close: () => { bye(); try { res.end(); } catch { /* sudah tertutup */ } },
    };
    // Had yuran per akaun. Header belum ditulis lagi supaya 429 kekal JSON bersih.
    if (!attachSink(u.id, snk)) { bye(); return res.status(429).json({ error: 'Terlalu banyak tab terbuka pada akaun ini.' }); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (res.flushHeaders) res.flushHeaders();
    if (req.socket) { req.socket.setTimeout(0); req.socket.setNoDelay(true); }
    snk.send('hello', { id: u.id, name: u.name, ts: Date.now() });
    req.on('close', bye); req.on('error', bye); res.on('error', bye);
  });

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
    const un = unread(u.name); const on = onlineMap(); const st = load();
    const rooms = roomsFor(u.name).map(r => {
      const last = (r.list || [])[Math.max(0, (r.list || []).length - 1)];
      const pid = peerId(r, u.id);
      const peer = pid ? byId(pid) : null;
      return {
        id: r.id, kind: r.kind, title: roomTitle(r, u),
        members: r.members, peerId: pid, unread: un[r.id] || 0, seq: r.seq || 0,
        memberCount: r.kind === 'group' ? (r.memberIds || []).length : null,
        memberIds: r.kind === 'group' ? (r.memberIds || []) : undefined,
        admins: r.kind === 'group' ? adminsOf(r) : undefined,
        myAdmin: r.kind === 'group' ? adminsOf(r).includes(u.id) : undefined,
        createdById: r.kind === 'group' ? (r.createdById || null) : undefined,
        memberOnline: r.kind === 'group' ? (r.memberIds || []).map(i => !!on[i]) : undefined,
        peerSeen: (peer && st.seen[r.id + '|' + key(peer.name)]) || 0,
        peer: peer ? { id: peer.id, name: peer.name, bio: peer.bio || '' } : null,
        blocked: !!(pid && blockedOf(u).includes(pid)),
        last: last ? { from: authorName(last), fid: last.fid || null, t: last.del ? null : last.t, mt: last.media && last.media.length ? last.media[0].kind : null, n: (last.media || []).length, ts: last.ts } : null,
        online: r.kind === 'global' ? Object.values(on).filter(Boolean).length
          : r.kind === 'group' ? (r.memberIds || []).filter(i => on[i]).length
          : !!(peer && isOnline(peer)),
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
    if (req.query.full === '1') { const r = state.rooms[room]; return res.json({ ok: true, msgs: hydrateAll((r.list || []).slice(-KEEP)), seq: r.seq || 0, typing: typingIn(room), people: people(null, 300, u.name) }); }
    const out = since(u.name, room, req.query.after);
    res.json({ ok: true, msgs: hydrateAll(out.msgs), seq: out.seq, typing: typingIn(room) });
  });

  app.post('/api/chat/messages', lim({ windowMs: 60e3, max: 40, keyPrefix: 'chmsg:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const room = String(b.room || '');
    if (!canRead(u.name, room)) return res.status(403).json({ error: 'Bilik bukan milik anda.' });
    if (b.media != null && !Array.isArray(b.media)) return res.status(400).json({ error: 'Lampiran mesti senarai.' });
    if (Array.isArray(b.media) && b.media.length > MAX_PER_MSG) return res.status(400).json({ error: 'Maksimum ' + MAX_PER_MSG + ' fail satu mesej.' });
    const r = send(u.name, room, b.text, b.replyTo, b.media);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, msg: r.msg, seq: r.room.seq });
  });

  // Muat naik gambar/video: badan MENTAH (bukan JSON) + bilik dalam query.
  app.post('/api/chat/media', lim({ windowMs: 60e3, max: 40, keyPrefix: 'chmedia:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const room = String(req.query.room || '');
    if (!canRead(u.name, room)) return res.status(403).json({ error: 'Bilik bukan milik anda.' });
    const cl = Number(req.headers['content-length'] || 0);
    if (cl > MAX_VID) { req.resume(); return res.status(413).json({ error: 'Video terlalu besar (had 64MB).' }); }
    readRaw(req, MAX_VID + 64 * 1024).then((buf) => {
      const meta = { w: req.query.w, h: req.query.h, dur: req.query.dur, audio: req.query.audio };
      const r = addMedia(u, buf, meta);
      if (r.error) return res.status(r.status || 400).json({ error: r.error });
      event('Media dimuat naik: ' + r.media.kind + ' ' + Math.round(r.media.size / 1024) + 'KB', { id: u.id });
      res.json({ ok: true, media: Object.assign(projectMedia(r.media), { url: mediaUrl(r.media.id) }) });
    }).catch((e) => res.status(413).json({ error: e.message }));
  });

  // Hidangan media: tandatangan sahaja (tiada token sesi dalam URL) + sokong
  // julat bayaran supaya video boleh dilompat tanpa muat turun semua.
  app.get('/api/chat/media/:id', (req, res) => {
    const id = String(req.params.id);
    if (!mediaAllowed(id, req.query.k)) return res.status(403).json({ error: 'Pautan media sudah luput.' });
    const rec = mediaSrc(id);
    if (!rec) return res.status(404).json({ error: 'Fail sudah dibuang.' });
    const file = mediaFile(rec);
    fs.stat(file, (err, st) => {
      if (err) { dropMedia(id); return res.status(404).json({ error: 'Fail sudah dibuang.' }); }
      const total = st.size;
      const head = {
        'Content-Type': rec.mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=86400',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Last-Modified': new Date(rec.ts || Date.now()).toUTCString(),
      };
      let from = 0, to = total - 1, partial = false;
      const rg = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (rg && (rg[1] || rg[2])) {
        from = rg[1] ? Number(rg[1]) : Math.max(0, total - Number(rg[2]));
        if (rg[1] && rg[2]) to = Math.min(Number(rg[2]), total - 1);
        if (from >= total || from > to) {
          head['Content-Range'] = 'bytes */' + total;
          res.writeHead(416, head); return res.end();
        }
        partial = true;
      }
      if (partial) { head['Content-Range'] = 'bytes ' + from + '-' + to + '/' + total; head['Content-Length'] = String(to - from + 1); res.writeHead(206, head); }
      else { head['Content-Length'] = String(total); res.writeHead(200, head); }
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start: from, end: to }).pipe(res);
    });
  });

  app.post('/api/chat/room', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const raw = cleanBody(req.body).peer;
    const peer = findUser(raw);   // boleh Tukuk ID (nombor) atau nama
    if (!peer) return res.status(400).json({ error: normalizeName(raw) ? 'Pengguna itu belum mendaftar di T Chat.' : 'Tiada ID atau nama begitu.' });
    if (peer.id === u.id) return res.status(400).json({ error: 'Tidak boleh DM diri sendiri.' });
    if (dmFrozen(u, peer)) return res.status(403).json({ error: 'Tidak dapat memulakan sembang dengan pengguna ini.' });
    const r = ensureDm(u, peer);
    if (!r) return res.status(400).json({ error: 'Tiada ID atau nama begitu.' });
    res.json({ ok: true, room: { id: r.id, kind: r.kind, title: roomTitle(r, u), members: r.members, peerId: peer.id, seq: r.seq || 0 }, profile: profile(peer, u.name) });
  });

  app.get('/api/chat/user', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const p = profile(req.query.q, u.name);
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
    res.json({ ok: true, people: people(req.query.q, 50, u.name) });
  });

  // ─── Panggilan video/audio: isyarat P2P (WebRTC) ───
  // Pelayan HANYA meneruskan paket isyarat (SDP/ICE/kawalan) kepada sasaran melalui
  // yuran SSE yang sedia ada; media mengalir terus antara peranti (peer-to-peer),
  // jadi tiada audio/video disimpan atau dilalukan di pelayan. `delivered` memaklumkan
  // pemanggil sama ada pasangan benar-benar bersambung sekarang (untuk "luar talian").
  const CALL_EV = new Set(['ring', 'accept', 'reject', 'busy', 'offer', 'answer', 'ice', 'end', 'cancel']);
  app.post('/api/chat/call', lim({ windowMs: 60e3, max: 120, keyPrefix: 'chcall:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const ev = String(b.ev || '');
    if (!CALL_EV.has(ev)) return res.status(400).json({ error: 'Isyarat panggilan tidak dikenali.' });
    const peer = byId(b.to);
    if (!peer) return res.status(400).json({ error: 'Pengguna tidak ditemui.' });
    if (peer.id === u.id) return res.status(400).json({ error: 'Tidak boleh memanggil diri sendiri.' });
    if (dmFrozen(u, peer)) return res.status(403).json({ error: 'Tidak dapat memanggil pengguna ini.' });
    let data = b.data && typeof b.data === 'object' ? b.data : {};
    if (JSON.stringify(data).length > 16384) return res.status(413).json({ error: 'Paket isyarat terlalu besar.' });
    // 'kind' hanya relevan pada 'ring' — kekalkan kecil & normalisasi.
    if (ev === 'ring') data = Object.assign({ kind: data.kind === 'audio' ? 'audio' : 'video' }, data);
    const set = sinks.get(peer.id);
    pub('call', { from: u.id, fromName: u.name, to: peer.id, ev, data }, [peer.id]);
    if (ev === 'ring') event('Panggilan ' + (data.kind === 'audio' ? 'suara' : 'video') + ': ' + u.name + ' → ' + peer.name, { id: u.id, peer: peer.id });
    res.json({ ok: true, delivered: !!(set && set.size), online: isOnline(peer) });
  });

  // ─── Tetapan: kawan, sekatan, kata laluan, sesi ───
  app.get('/api/chat/social', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = socialLists(u.name);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  const socialEdit = (res, r, code) => { if (r.error) return res.status(code || 400).json({ error: r.error }); return true; };

  app.post('/api/chat/friend', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chpal:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = b.remove ? delFriend(u.name, b.peer) : addFriend(u.name, b.peer);
    if (!socialEdit(res, r)) return;
    if (r.already && !b.remove) return res.status(400).json({ error: 'Sudah ada dalam senarai kawan anda.' });
    res.json({ ok: true, added: !b.remove && !r.already, social: socialLists(u.name) });
  });

  app.post('/api/chat/block', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chblk:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = b.remove ? unblockUser(u.name, b.peer) : blockUser(u.name, b.peer);
    if (!socialEdit(res, r)) return;
    if (r.already && !b.remove) return res.status(400).json({ error: 'Sudah disekat.' });
    event((b.remove ? 'Nyahsekat' : 'Sekat') + ' @' + ((r.peer && r.peer.name) || b.peer) + ' oleh ' + u.name, { id: r.peer && r.peer.id });
    res.json({ ok: true, blocked: !b.remove && !r.already, social: socialLists(u.name) });
  });

  app.post('/api/chat/password', lim({ windowMs: 3600e3, max: 10, keyPrefix: 'chpass:' }), (req, res) => {
    const tok = bearer(req);
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = setPass(u.name, b.old, b.next);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    const n = logoutAll(u.name, tok);
    kickSinks(u.id, tok);
    event('Kata laluan ditukar: ' + u.name, { id: u.id, revoked: n.revoked });
    res.json({ ok: true, revoked: n.revoked, message: 'Kata laluan tukar. Peranti lain perlu login semula.' });
  });

  app.post('/api/chat/logout-all', (req, res) => {
    const tok = bearer(req);
    const u = authOf(req, res); if (!u) return;
    const r = logoutAll(u.name, tok);
    if (r.error) return res.status(400).json({ error: r.error });
    kickSinks(u.id, tok);
    res.json({ ok: true, revoked: r.revoked });
  });

  // Padam akaun: kata laluan wajib, semua data dileraikan, semua sesi + stream
  // ditutup (termasuk tab ini — klien akan logout sebaik dapat respons).
  app.post('/api/chat/delete-account', lim({ windowMs: 24 * 3600e3, max: 3, keyPrefix: 'chdelacct:' }), (req, res) => {
    const tok = bearer(req);
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = deleteAccount(u.name, b.pass);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    event('Akaun dipadam: ' + u.name, { id: u.id });
    kickSinks(u.id);
    res.json({ ok: true });
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

  app.post('/api/chat/pin', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = pinMsg(u.name, String(b.room), String(b.id), b.pinned !== false);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, pinned: r.pinned, msg: r.msg });
  });

  app.post('/api/chat/read', (req, res) => {
    const u = userOf(bearer(req)); if (!u) return res.json({ ok: true });
    markSeen(u.name, String(cleanBody(req.body).room || ''));
    res.json({ ok: true });
  });

  // Carian mesej merentas bilik — min 2 aksara, max 30 hasil, newest first.
  app.get('/api/chat/search', lim({ windowMs: 60e3, max: 30, keyPrefix: 'chrch:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, results: [] });
    res.json({ ok: true, results: searchMsgs(u.name, q) });
  });

  // ─── Bilik kumpulan ───
  app.post('/api/chat/group', lim({ windowMs: 3600e3, max: 20, keyPrefix: 'chgrp:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = createGroup(u.name, b.title, b.memberIds);
    if (r.error) return res.status(400).json({ error: r.error });
    event('Kumpulan baharu: ' + r.room.title + ' oleh ' + u.name, { id: u.id });
    res.json({ ok: true, room: { id: r.room.id, kind: r.room.kind, title: r.room.title, members: r.room.members, memberCount: r.room.memberIds.length, seq: 0 } });
  });

  app.post('/api/chat/group/invite', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chgrpinv:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = addToGroup(u.name, String(b.room || ''), b.memberId);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, already: !!r.already });
  });

  app.post('/api/chat/group/leave', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = leaveGroup(u.name, String(cleanBody(req.body).room || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, dissolved: !!r.dissolved });
  });

  app.post('/api/chat/group/rename', lim({ windowMs: 3600e3, max: 30, keyPrefix: 'chgrprn:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = renameGroup(u.name, String(b.room || ''), b.title);
    if (r.error) return res.status(400).json({ error: r.error });
    event('Kumpulan dinam semula: ' + r.title + ' oleh ' + u.name, { id: u.id });
    res.json({ ok: true, title: r.title });
  });

  app.post('/api/chat/group/kick', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chgrpkick:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = kickFromGroup(u.name, String(b.room || ''), b.memberId);
    if (r.error) return res.status(400).json({ error: r.error });
    event('Ahli dibuang dari kumpulan oleh ' + u.name, { id: u.id });
    res.json({ ok: true, dissolved: !!r.dissolved });
  });

  app.post('/api/chat/group/admin', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chgrpadmin:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = addAdmin(u.name, String(b.room || ''), b.memberId, !!b.remove);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, admins: r.admins });
  });

  app.post('/api/chat/group/dissolve', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = dissolveBy(u.name, String(cleanBody(req.body).room || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    event('Kumpulan dibubarkan oleh ' + u.name, { id: u.id });
    res.json({ ok: true, dissolved: true });
  });

  // ─── Web Push (VAPID) ───
  app.get('/api/chat/vapid-public-key', (req, res) => {
    initVapid();
    const k = vapidPubB64();
    if (!k) return res.status(500).json({ error: 'VAPID tidak tersedia.' });
    res.json({ ok: true, key: k });
  });

  app.post('/api/chat/push-subscribe', lim({ windowMs: 3600e3, max: 20, keyPrefix: 'chpush:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    if (!b.endpoint || !b.keys) return res.status(400).json({ error: 'Langganan tidak sah.' });
    const s = load();
    s.pushSubs = s.pushSubs || {};
    const arr = s.pushSubs[String(u.id)] = s.pushSubs[String(u.id)] || [];
    if (!arr.some(x => x.endpoint === b.endpoint)) { arr.push(b); touch(); }
    res.json({ ok: true });
  });

  app.post('/api/chat/push-unsubscribe', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const s = load();
    const arr = (s.pushSubs || {})[String(u.id)] || [];
    s.pushSubs[String(u.id)] = arr.filter(x => x.endpoint !== b.endpoint);
    touch();
    res.json({ ok: true });
  });
}

module.exports = {
  mount, register, login, issueSession, userOf, revoke, normalizeName, hashPass, eqHex,
  dmId, ensureDm, roomsFor, roomTitle, send, since, markSeen, unread, canRead,
  react, edit, remove, setTyping, typingIn, searchMsgs, people, onlineMap, setPath, load, flush,
  byId, findUser, nameOfUser, peerId, isMember, sameAuthor, authorName,
  profile, rename, setBio, isOnline, cleanText,
  addFriend, delFriend, blockUser, unblockUser, socialLists, socialTarget, setPass, logoutAll,
  friendsOf, blockedOf, dmFrozen, MAX_FRIENDS, MAX_BLOCKS,
  pub, pubRoom, attachSink, detachSink, kickSinks, dropSink, tickBeat, clearSinks, MAX_STREAMS,
  sniff, addMedia, attachMedia, mediaUrl, mediaAllowed, mediaSrc, mediaFile, projectMedia,
  hydrate, releaseMedia, dropMedia, readRaw, quotaCheck, trimRoom,
  createGroup, addToGroup, leaveGroup, renameGroup, kickFromGroup, addAdmin, dissolveBy, isGroupAdmin, adminsOf, pinMsg, deleteAccount, initVapid, vapidPubB64, derSigToRaw, doSendPush, maybePush,
  MAX_IMG, MAX_VID, MAX_AUDIO, MAX_PER_MSG, QUOTA_FILES, STORE_CAP, FIRST_ID, KEEP,
  get mediaDir() { return MEDIA; },
};
