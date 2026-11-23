// T Chat — the multi-user backend for the /apps/chat app.
// Accounts (scrypt), bearer-token sessions, a global room + 1-to-1 DMs, messages with
// reply/reaction/edit/delete, image & video attachments, presence (online/typing).
// Metadata lives in one JSON file at data/chat.json; media files in data/chat-media/.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'chat.json');
const MAX_MSG = 500;        // message length
const KEEP = 200;           // the last message per room
const SESSION_TTL = 30 * 24 * 3600e3;
const ONLINE_MS = 90e3;     // considered online
const TYPING_MS = 4e3;      // the "typing…" display
const MAX_IMG = 8 * 1024 * 1024;            // the image file cap (after client-side compression)
const MAX_VID = 64 * 1024 * 1024;           // the video file cap
const MAX_AUDIO = 8 * 1024 * 1024;          // the voice-message cap (opus/webm/ogg)
const MAX_DOC = 32 * 1024 * 1024;           // the general file cap (documents/zip/music)
const MAX_PER_MSG = 4;                      // the media of one message (an album)
const QUOTA_FILES = 40;                     // files per hour per user
const QUOTA_BYTES = 512 * 1024 * 1024;      // size per hour per user
const QUOTA_WIN = 3600e3;
const STORE_CAP = 3 * 1024 * 1024 * 1024;   // the total media storage of the whole site
const ORPHAN_TTL = 3600e3;                  // an upload that was never posted → drop it

let FILE = DEFAULT_PATH;
let MEDIA = path.join(path.dirname(DEFAULT_PATH), 'chat-media');
let state = null;
let writeTimer = null;
let dirty = false;

// ─── Storage ───
const FIRST_ID = 100001;    // the first Tukuk ID (a permanent number, not a name)
function blank() {
  return { users: {}, sessions: {}, rooms: {}, msgs: {}, seen: {}, typing: {}, media: {}, quota: {}, mediaBytes: 0, mediaKey: '', nextId: FIRST_ID, pushSubs: {}, vapid: null, posts: {}, stories: {}, notif: {}, polls: {}, smsReply: {} };
}
function load() {
  if (state) return state;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    state = { ...blank(), ...JSON.parse(raw) };
  } catch {
    state = blank();
    state.rooms.global_am = { id: 'global_am', kind: 'global', title: '🌍 General', members: ['*'], createdBy: 'sistem', createdAt: Date.now() };
  }
  if (!state.rooms.global_am) state.rooms.global_am = { id: 'global_am', kind: 'global', title: '🌍 General', members: ['*'], createdBy: 'sistem', createdAt: Date.now() };
  if (!state.smsReply) state.smsReply = {};
  migrate();
  return state;
}
// Upgrade the old data: give a Tukuk ID to accounts that have none, and key DM rooms
// on the ID number (before this they used names → a renamed account broke the DM).
function migrate() {
  const s = state;
  if (!s.nextId) s.nextId = FIRST_ID;
  let changed = false;
  for (const u of Object.values(s.users)) {
    if (!u.id) { u.id = s.nextId++; changed = true; }
    // Old accounts have no friends/blocked list yet — empty them so other code
    // does not have to test for their existence every time.
    if (!Array.isArray(u.friends)) { u.friends = []; changed = true; }
    if (!Array.isArray(u.blocked)) { u.blocked = []; changed = true; }
    // The social layer: following/followers (IDs) + the avatar (a media id or null).
    if (!Array.isArray(u.following)) { u.following = []; changed = true; }
    if (!Array.isArray(u.followers)) { u.followers = []; changed = true; }
    if (u.avatar === undefined) { u.avatar = null; changed = true; }
    // A phone number (optional) for the SMS fallback while offline; null = none.
    if (u.phone === undefined) { u.phone = null; changed = true; }
    // Hide stamps were milliseconds before this file used seq. A legacy value (>1e9) read
    // against a seq would be "hidden until seq passes 1.7 trillion", i.e. hidden forever —
    // so re-stamp it at the room's current seq, which keeps today's meaning exactly: hidden
    // now, back when the next message arrives.
    if (u.hide) {
      for (const [rid, v] of Object.entries(u.hide)) {
        if (v > 1e9) { const r = s.rooms[rid]; u.hide[rid] = r ? (r.seq || 0) : 0; changed = true; }
      }
    }
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
  } catch { /* best-effort — the data stays in memory */ }
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
// A message may be multi-line: keep \n, drop the other control characters.
function cleanText(v) {
  return String(v || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, MAX_MSG);
}

// ─── Tukuk ID ───
// Every account gets a permanent number (100001+). The name is only display; DMs, drafts,
// messages and the "whose ID is this" search all hang off that number.
function byId(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return Object.values(load().users).find(u => u.id === n) || null;
}
function userByName(name) { return load().users[key(name)] || null; }
function nameOfUser(id) { const u = byId(id); return u ? u.name : null; }
// User input: a Tukuk ID (number) or a name → a user object or null.
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

// ─── Media (images + video) ───
// The raw file is stored at data/chat-media/<id>.<ext>; the metadata is in JSON. The type
// comes from the magic bytes, NOT from the client's Content-Type header.
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
// A safe file name: strip Path/Windows-matching characters + control characters.
const safeFileName = (n) => {
  const x = String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim().slice(0, 120);
  return x || 'fail';
};
function mediaFile(rec) { return path.join(MEDIA, rec.id + '.' + rec.ext); }
function num(v, max) { const n = Math.round(Number(v) || 0); return n > 0 && n <= max ? n : 0; }
// A T Chat media link may NOT carry the session token (tokens end up in server logs), so
// every URL is HMAC-signed with an expiry date. <img>/<video> can send
// it directly and support paid Range jumps for video seeking.
const MEDIA_TTL = 6 * 3600e3;
function mediaSecret() {
  const s = load();
  if (!s.mediaKey) { s.mediaKey = crypto.randomBytes(32).toString('hex'); dirty = true; }
  return s.mediaKey;
}
const mac = (id, exp) => crypto.createHmac('sha256', mediaSecret()).update(id + '.' + exp).digest('hex').slice(0, 32);
// The expiry date is generated on a period boundary (not "now + 6 hours") so the same URL
// stays stable — otherwise every poll would produce a new link and
// the browser would re-download the same image/video.
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
// The media record for display (only served with a valid signature).
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
  if (q.n >= QUOTA_FILES) return { error: 'Too many files this hour — try again shortly.' };
  if (q.b + size > QUOTA_BYTES) return { error: 'You have reached your monthly upload quota.' };
  if ((s.mediaBytes || 0) + size > STORE_CAP) return { error: 'Site media storage is full.' };
  q.n++; q.b += size; s.quota[u.k] = q;
  return { ok: true };
}
function addMedia(user, buf, meta) {
  const s = load();
  const t = sniff(buf);
  if (!t) return addGenericFile(user, buf, meta);
  const img = isImage(t.mime);
  // The client may mark a voice message (audio=1); ogg/opus is also detected through
  // magic bytes. WebM audio has the same magic bytes as video → it depends
  // on the client flag to tell the display types apart.
  const audio = !img && (String((meta && meta.audio)) === '1' || isAudio(t.mime));
  const cap = img ? MAX_IMG : audio ? MAX_AUDIO : MAX_VID;
  if (buf.length > cap) return { error: img ? 'Image too large (limit 8MB).' : audio ? 'Voice recording too large (limit 8MB).' : 'Video too large (limit 64MB).', status: 413 };
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
  } catch { return { error: 'Failed to save the file on the server.', status: 500 }; }
  s.media = s.media || {};
  s.media[id] = rec;
  s.mediaBytes = (s.mediaBytes || 0) + buf.length;
  touch();
  return { ok: true, media: rec };
}
// A general file attachment (documents, zip, .mp3 music, anything not detected
// as an image/video/audio). Always stored under its original name; the serving
// forces a download so the browser never runs the content.
function addGenericFile(user, buf, meta) {
  const s = load();
  if (buf.length > MAX_DOC) return { error: 'File too large (limit ' + Math.round(MAX_DOC / 1048576) + 'MB).', status: 413 };
  const q = quotaCheck(user, buf.length);
  if (q.error) return { error: q.error, status: 429 };
  const id = crypto.randomBytes(6).toString('hex');
  const name = safeFileName(meta && meta.name);
  let ext = name.includes('.') ? String(name.split('.').pop()).toLowerCase() : '';
  ext = ext.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  const omime = String((meta && meta.mime) || '').replace(/[^a-z0-9.+-\/]/gi, '').slice(0, 64);
  const rec = {
    id, ext, mime: 'application/octet-stream', omime, kind: 'file', size: buf.length, name,
    uid: user.id || null, by: user.k, ts: Date.now(), rooms: [], msgs: [],
  };
  try {
    fs.mkdirSync(MEDIA, { recursive: true });
    fs.writeFileSync(mediaFile(rec), buf);
  } catch { return { error: 'Failed to save the file on the server.', status: 500 }; }
  s.media = s.media || {};
  s.media[id] = rec;
  s.mediaBytes = (s.mediaBytes || 0) + buf.length;
  touch();
  return { ok: true, media: rec };
}
// The summary embedded in the message (so the view needs no extra GET).
function projectMedia(rec) {
  const out = { id: rec.id, kind: rec.kind, ext: rec.ext };
  if (rec.w && rec.h) { out.w = rec.w; out.h = rec.h; }
  if (rec.dur) out.dur = rec.dur;
  if (rec.size) out.size = rec.size;
  if (rec.name) out.name = rec.name;
  if (rec.omime) out.mime = rec.omime;
  return out;
}
// The signature is regenerated on every send — so a stored message
// never contains a URL that can expire.
function hydrate(m) {
  if (!m) return m;
  if (!m.media && !m.pollId) return m;
  const out = Object.assign({}, m);
  if (m.media && m.media.length) out.media = m.media.map(x => Object.assign({}, x, { url: mediaUrl(x.id) }));
  if (m.pollId) { const p = (load().polls || {})[m.pollId]; if (p) out.pollData = projectPoll(p); }
  return out;
}
const hydrateAll = (list) => (list || []).map(hydrate);
// Attach a file already uploaded to a message of this room. Rights = the uploader
// or anyone who can read a room that already shows that file (which allows
// "forwarding" a friend's picture without copying the file on disk).
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
  try { fs.unlinkSync(mediaFile(rec)); } catch { /* it is gone already */ }
  s.mediaBytes = Math.max(0, (s.mediaBytes || 0) - (rec.size || 0));
  delete s.media[id];
  touch();
}
// Drop the message reference; the file is deleted once no message uses it any more.
function releaseMedia(items, msgId) {
  const s = load();
  for (const it of items || []) {
    const rec = (s.media || {})[it && it.id];
    if (!rec) continue;
    rec.msgs = (rec.msgs || []).filter(x => x !== msgId);
    if (!rec.msgs.length) dropMedia(rec.id);
  }
}
// A raw body reader — image/video uploads are not JSON, so express.json is not
// used. The size cap is enforced by hand so the error stays understandable.
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('File too large.')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('aborted', () => reject(new Error('Upload cancelled.')));
    req.on('error', () => reject(new Error('Upload failed.')));
  });
}

function register(name, pass) {
  const s = load();
  const clean = normalizeName(name);
  if (!clean) return { error: 'Name must be 2–20 characters (letters/numbers/spaces only).' };
  if (String(pass || '').length < 4) return { error: 'Password must be at least 4 characters.' };
  if (s.users[key(clean)]) return { error: 'Name already taken. Try logging in.' };
  if (/^\d{6}$/.test(key(clean))) return { error: 'Name cannot be 6 digits (Tukuk ID format).' };
  const salt = crypto.randomBytes(16).toString('hex');
  s.users[key(clean)] = { name: clean, k: key(clean), id: s.nextId++, salt, hash: hashPass(pass, salt), createdAt: Date.now(), lastSeen: 0, bio: '', friends: [], blocked: [], following: [], followers: [], avatar: null };
  touch();
  return { ok: true, user: s.users[key(clean)] };
}

function login(name, pass) {
  const s = load();
  const u = s.users[key(name)];
  if (!u || !eqHex(u.hash, hashPass(pass, u.salt))) return { error: 'Wrong name or password.' };
  u.lastSeen = Date.now(); // a successful login = really present
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
  // the id first — a name can change, an id cannot
  const u = (sess.uid ? byId(sess.uid) : null) || s.users[sess.k];
  if (!u) return null;
  u.lastSeen = Date.now();
  touch();
  return u;
}
function revoke(token) { const s = load(); if (s.sessions[token]) { delete s.sessions[token]; touch(); } }

// ─── Rooms ───
// A DM room is keyed on the pair of Tukuk IDs, not names — a name changes, the DM survives.
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
// A member's display name is synced from the ID (the old name stays if the account is gone).
function syncNames(r) {
  if (!r || !r.memberIds || !r.memberIds.length) return;
  const names = r.memberIds.map(nameOfUser);
  if (names.some(n => !n)) return;
  if (names.join('\u0001') !== (r.members || []).join('\u0001')) { r.members = names; touch(); }
}
function lastMsgTs(r) {
  const l = (r.list || [])[(r.list || []).length - 1];
  return l ? (l.ts || 0) : (r.createdAt || 0);
}
function roomsFor(name) {
  const s = load();
  const u = findUser(name);
  const hide = (u && u.hide) || null;
  return Object.values(s.rooms).filter(r => {
    if (r.kind !== 'global' && !isMember(r, name)) return false;
    // A DM "hidden for me": dropped from the sidebar until a new message
    // (activity past the hide stamp) brings it back — like a private archive.
    // The stamp is the room's seq, not a clock: see hideRoom().
    if (hide && r.kind === 'dm' && hide[r.id] !== undefined && (r.seq || 0) <= hide[r.id]) return false;
    return true;
  });
}
function ensureDm(a, b) {
  const s = load();
  const ua = (a && typeof a === 'object') ? a : findUser(a);
  const ub = (b && typeof b === 'object') ? b : findUser(b);
  if (!ua || !ub || !ua.id || !ub.id || ua.id === ub.id) return null; // not registered yet → no DM
  const pair = [ua.id, ub.id].sort((x, y) => x - y);
  const id = dmId(pair[0], pair[1]);
  let r = s.rooms[id];
  if (!r) {
    r = s.rooms[id] = { id, kind: 'dm', title: null, memberIds: pair, members: pair.map(nameOfUser), createdBy: ua.name, createdAt: Date.now() };
    touch();
    pubRoom(r, 'room', { room: r.id });   // both partners see the new room right away
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
// ─── Hiding a DM ("delete for me") ───
// The room and its history are NOT deleted — only this user's side list is filtered.
// Reopening the room (POST /api/chat/room) or a new message → it comes back.
function hideRoom(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r || r.kind !== 'dm') return { error: 'Direct chat not found.' };
  const u = findUser(name);
  if (!u || !isMember(r, u)) return { error: 'You are not a member of this chat.' };
  // The stamp is the room's MESSAGE SEQUENCE, not a timestamp. It used to be
  // `Math.max(Date.now(), lastMsgTs(r) + 1)`, which cannot order two events inside the
  // same millisecond: hide a DM and a new message landing in that same ms gets a ts equal
  // to the previous one, while the stamp had been pushed +1 past it, so the room stayed
  // hidden forever-from-the-user's-view and test/chat's "a new message un-hides it" failed
  // on a fast runner and passed on a slow one. seq is monotonic per room and increments on
  // every send, so "hidden until the NEXT message" is exactly expressible: hidden while
  // seq <= stamp. Hiding in the same instant as the last message still sticks (equal seq).
  (u.hide = u.hide || {})[roomId] = r.seq || 0;
  touch();
  return { ok: true };
}
function unhideRoom(u, roomId) {
  // `!== undefined`, not truthiness: a DM hidden before its first message has the stamp 0,
  // and 0 is falsy — opening such a room would leave it hidden forever.
  if (u && u.hide && u.hide[roomId] !== undefined) { delete u.hide[roomId]; touch(); }
}
// ─── Group rooms ───
function createGroup(creatorName, title, memberIds) {
  const s = load();
  const t = String(title || '').trim().slice(0, 40);
  if (!t) return { error: 'Group name is required.' };
  const creator = findUser(creatorName);
  if (!creator) return { error: 'User not found.' };
  const members = [creator];
  for (const id of (memberIds || [])) {
    const u = byId(id);
    if (u && u.id !== creator.id && !members.some(m => m.id === u.id)) members.push(u);
  }
  if (members.length < 2) return { error: 'At least one other member is required.' };
  if (members.length > 50) return { error: 'Exceeds 50 members.' };
  const id = 'grp_' + crypto.randomBytes(6).toString('hex');
  const r = { id, kind: 'group', title: t, memberIds: members.map(u => u.id), members: members.map(u => u.name), admins: [creator.id], createdBy: creator.name, createdById: creator.id, createdAt: Date.now(), seq: 0, list: [] };
  s.rooms[id] = r; touch();
  pubRoom(r, 'room', { room: id });
  return { ok: true, room: r };
}
function addToGroup(name, roomId, memberId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r || r.kind !== 'group') return { error: 'Group not found.' };
  if (!isMember(r, name)) return { error: 'You are not a member of this group.' };
  const u = byId(memberId);
  if (!u) return { error: 'User not found.' };
  if (r.memberIds.includes(u.id)) return { ok: true, already: true };
  if (r.memberIds.length >= 50) return { error: 'Group is full (50 members).' };
  r.memberIds.push(u.id);
  r.members = r.memberIds.map(id2 => nameOfUser(id2));
  touch();
  pubRoom(r, 'room', { room: roomId });
  return { ok: true };
}
const adminsOf = (r) => (r && Array.isArray(r.admins) ? r.admins : []);
const isGroupAdmin = (r, name) => adminsOf(r).includes(uid(name));
// Remove one ID from the admin list; if none are left, promote the last member
// so the group never loses its administrator.
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
  if (!r || r.kind !== 'group') return { error: 'Group not found.' };
  const u = findUser(name);
  if (!u || !r.memberIds.includes(u.id)) return { error: 'You are not a member of this group.' };
  r.memberIds = r.memberIds.filter(i => i !== u.id);
  r.members = r.memberIds.map(i => nameOfUser(i));
  if (!r.memberIds.length) { dissolveGroup(roomId); return { ok: true, dissolved: true }; }
  promoteAdmin(r);
  touch();
  pubRoom(r, 'room', { room: roomId });
  return { ok: true };
}
// ─── Group administration (admins only) ───
function groupAdmin(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r || r.kind !== 'group') return { error: 'Group not found.' };
  if (!isMember(r, name)) return { error: 'You are not a member of this group.' };
  if (!isGroupAdmin(r, name)) return { error: 'Only admins can do this.' };
  return { ok: true, room: r };
}
function renameGroup(name, roomId, title) {
  const g = groupAdmin(name, roomId); if (g.error) return g;
  const t = String(title || '').trim().slice(0, 40);
  if (!t) return { error: 'Group name is required.' };
  g.room.title = t; touch();
  pubRoom(g.room, 'room', { room: roomId });
  return { ok: true, title: t };
}
function kickFromGroup(name, roomId, memberId) {
  const g = groupAdmin(name, roomId); if (g.error) return g;
  const r = g.room; const u = byId(memberId);
  if (!u || !r.memberIds.includes(u.id)) return { error: 'That user is not a member.' };
  if (u.id === uid(name)) return { error: 'Use "Leave" to remove yourself.' };
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
  if (!u || !r.memberIds.includes(u.id)) return { error: 'That user is not a member.' };
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
  // Only the creator may dissolve it — unless the creator is no longer in the group,
  // in which case a remaining admin takes over that right.
  if (r.createdById && r.createdById !== uid(name) && (r.memberIds || []).includes(r.createdById)) return { error: 'Only the creator can dissolve this group.' };
  dissolveGroup(roomId);
  return { ok: true, dissolved: true };
}
function roomTitle(r, viewer) {
  if (!r || r.kind === 'global') return '🌍 General';
  if (r.kind === 'group') return r.title || '👥 Group';
  const v = (viewer && typeof viewer === 'object') ? viewer : findUser(viewer);
  if (r.memberIds && v && v.id) {
    const nm = nameOfUser(r.memberIds.find(i => i !== v.id));
    if (nm) return nm;
  }
  syncNames(r);
  const vk = key(v ? v.name : uname(viewer));
  return (r.members || []).find(m => key(m) !== vk) || (r.members || [])[0] || 'DM';
}

// ─── Messages ───
function canRead(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r) return false;
  if (r.kind === 'global') return true;
  return isMember(r, name);
}
// Message ownership: the sender id is more authoritative than the name (names can change).
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
function send(name, roomId, text, replyTo, media, extra) {
  const s = load();
  const r = s.rooms[roomId];
  if (!r) return { error: 'Room not found.' };
  if (!r.list) r.list = [];
  if (!r.seq) r.seq = 0;
  const su = findUser(name);
  // A DM where one member blocks the other is frozen both ways: it can still
  // be read, but nobody may send a new message.
  if (r.kind === 'dm') {
    const pid = peerId(r, su ? su.id : uid(name));
    if (pid && dmFrozen(su || name, byId(pid))) return { error: 'Messages cannot be sent to this room.' };
  }
  const msgId = crypto.randomBytes(6).toString('hex');
  const att = media && media.length ? attachMedia(su || { k: key(name) }, roomId, media, msgId) : [];
  if (media && media.length && !att.length) return { error: 'Attachments could not be used — please upload again.' };
  const t = cleanText(text);
  if (!t && !att.length && !(extra && (extra.sticker || extra.pollId))) return { error: 'Empty message.' };
  if (replyTo && !r.list.find(m => m.id === replyTo)) replyTo = null;
  const msg = { id: msgId, seq: ++r.seq, from: su ? su.name : name, fid: su ? su.id : null, t, ts: Date.now(), to: replyTo || null, rx: {}, edited: false, del: false, pinned: false };
  if (att.length) msg.media = att;
  // Extra meta (pollId, sticker) is stored straight on the message; it does not change
  // the existing semantics because no other caller sends `extra`.
  if (typeof extra === 'object' && extra) {
    if (extra.pollId) msg.pollId = extra.pollId;
    if (extra.sticker) msg.sticker = String(extra.sticker).slice(0, 8);
  }
  r.list.push(msg);
  trimRoom(r);
  const wasTyping = !!s.typing[key(name) + '|' + roomId];
  delete s.typing[key(name) + '|' + roomId];
  touch();
  const out = hydrate(msg);
  pubRoom(r, 'msg', { room: r.id, seq: r.seq, msg: out });
  maybePush(r, out).catch(() => {});
  // Google Chat-style mention: @here/@all wakes a whole room (rate-limited, anti-spam).
  if (su && /@here\b|@all\b/i.test(t)) notifyAtAll(su, r, t);
  // A plain @name in a group/global room → a notification for the person mentioned (DMs are
  // already pushed to the partner through maybePush).
  if (su && (r.kind === 'group' || r.kind === 'global')) notifyMentions(su, t, null, r.id);
  // The typing indicator must end right away on another tab, not wait for a poll.
  if (wasTyping) pubRoom(r, 'typing', { room: r.id, typing: [] });
  // The SMS fallback: if the DM partner is offline & has a number → send it as an SMS.
  smsFallback(su, r, t, extra);
  return { ok: true, msg: out, room: r };
}
// Keep only the last KEEP messages; files that leave the list are dropped.
function trimRoom(r) {
  if (r.list.length <= KEEP) return;
  const out = r.list.splice(0, r.list.length - KEEP);
  for (const m of out) releaseMedia(m.media, m.id);
}
function since(name, roomId, after) {
  const s = load();
  const r = s.rooms[roomId]; if (!r) return { error: 'Room not found.' };
  const a = Math.max(0, Number(after) || 0);
  const msgs = (r.list || []).filter(m => m.seq > a);
  return { ok: true, msgs, seq: r.seq || 0 };
}
function markSeen(name, roomId) {
  const s = load(); const r = s.rooms[roomId];
  if (!r) return;
  const seq = r.seq || 0;
  s.seen[roomId + '|' + key(name)] = seq; touch();
  // DM: tell the partner until their message has been read → a ✓✓ receipt.
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
    // only other people's messages past the read point count as unread
    out[r.id] = (r.list || []).filter(m => m.seq > last && !sameAuthor(m, name)).length;
  }
  return out;
}
function react(name, roomId, msgId, emo) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Room not found.' };
  const m = (r.list || []).find(x => x.id === msgId); if (!m) return { error: 'Message not found.' };
  const e = String(emo).slice(0, 8);
  m.rx = m.rx || {};
  if (m.rx[e]) { delete m.rx[e]; } else { m.rx[e] = 1; }
  touch();
  const out = hydrate(m);
  pubRoom(r, 'react', { room: r.id, msg: out });
  return { ok: true, msg: out };
}
function edit(name, roomId, msgId, text) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Room not found.' };
  const m = (r.list || []).find(x => x.id === msgId);
  if (!m) return { error: 'Message not found.' };
  if (!sameAuthor(m, name)) return { error: 'Only your own messages can be edited.' };
  const t = cleanText(text);
  if (!t) return { error: 'Empty message.' };
  m.t = t; m.edited = true; touch();
  const out = hydrate(m);
  pubRoom(r, 'edit', { room: r.id, msg: out });
  return { ok: true, msg: out };
}
function remove(name, roomId, msgId) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Room not found.' };
  const i = (r.list || []).findIndex(x => x.id === msgId);
  if (i < 0) return { error: 'Message not found.' };
  if (!sameAuthor(r.list[i], name)) return { error: 'Only your own messages can be deleted.' };
  const [gone] = r.list.splice(i, 1);
  releaseMedia(gone.media, gone.id);
  touch();
  pubRoom(r, 'del', { room: r.id, id: msgId });
  return { ok: true };
}
// Pin/unpin. In the global & group rooms: only an admin (or the message owner in
// the global room) may pin. A DM: both members may. Pinned is stored on the message.
function pinMsg(name, roomId, msgId, pinned) {
  const s = load(); const r = s.rooms[roomId]; if (!r) return { error: 'Room not found.' };
  const m = (r.list || []).find(x => x.id === msgId); if (!m) return { error: 'Message not found.' };
  if (r.kind === 'group' && !isGroupAdmin(r, name)) return { error: 'Only admins can pin messages.' };
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

// ─── Polls ───
// One poll is locked to one room; one vote per member (changeable). The data
// is kept in the JSON so the result shows live in every tab through SSE.
const MAX_POLL_Q = 200, MAX_POLL_OPT = 80, MAX_POLL_OPTS = 6;
function projectPoll(p) {
  const total = Object.keys(p.votes).length;
  const counts = p.opts.map((_, i) => Object.values(p.votes).filter(v => v === i).length);
  return { id: p.id, q: p.q, opts: p.opts, counts, total, ts: p.ts, by: p.by, voters: p.votes };
}
function createPoll(name, roomId, text, opts) {
  const s = load(); const r = s.rooms[roomId];
  if (!r) return { error: 'Room not found.' };
  const q = cleanText(text).slice(0, MAX_POLL_Q);
  if (!q) return { error: 'Empty poll question.' };
  const list = (Array.isArray(opts) ? opts : [])
    .map(o => cleanText(o).slice(0, MAX_POLL_OPT))
    .filter(Boolean);
  if (list.length < 2) return { error: 'Provide at least 2 options.' };
  if (list.length > MAX_POLL_OPTS) return { error: 'Maximum ' + MAX_POLL_OPTS + ' options.' };
  const su = findUser(name); if (!su) return { error: 'User not found.' };
  const id = crypto.randomBytes(6).toString('hex');
  s.polls = s.polls || {};
  s.polls[id] = { id, room: roomId, q, opts: list, votes: {}, by: su.name, bid: su.id, ts: Date.now() };
  touch();
  return { ok: true, poll: s.polls[id] };
}
function votePoll(name, pollId, optIdx) {
  const s = load();
  const p = (s.polls || {})[String(pollId)];
  if (!p) return { error: 'Poll not found.' };
  const r = s.rooms[p.room]; if (!r) return { error: 'Room not found.' };
  if (!canRead(name, p.room)) return { error: 'You are not a member of this room.' };
  const su = findUser(name); if (!su) return { error: 'User not found.' };
  const i = Number(optIdx);
  if (!Number.isInteger(i) || i < -1 || i >= p.opts.length) return { error: 'Invalid option.' };
  const k = String(su.id);
  if (i === -1) delete p.votes[k];
  else p.votes[k] = i;
  touch();
  const proj = projectPoll(p);
  pubRoom(r, 'poll', { room: p.room, id: p.id, poll: proj });
  return { ok: true, poll: proj };
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
// A message search across every room the reader can read. Min 2 characters, max 30 results.
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
// No external package: the EC P-256 key is generated once and stored in the JSON state.
// Pushes are sent with an empty body — the SW shows a generic notification.
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
  } catch { /* crypto is unavailable */ }
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
// Convert a DER signature (crypto.sign) into the raw 64-byte ES256 form.
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
// Send a push to DM/group members who have no active SSE sink.
async function maybePush(room, msg) {
  if (!room || room.kind === 'global') return;
  const s = load();
  if (!s.vapid) return;
  for (const uid of (room.memberIds || [])) {
    if (uid === msg.fid) continue;
    if (sinks.has(uid)) continue;
    for (const sub of (s.pushSubs[String(uid)] || [])) {
      try { await doSendPush(sub, s.vapid); } catch { /* the push service is down */ }
    }
  }
}
// The user directory. `viewer` (optional) filters out those who BLOCK the viewer
// and marks the friend/blocked status so the client does not have to guess.
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
      id: u.id, name: u.name, bio: u.bio || '', online: isOnline(u), avatar: avatarUrl(u), status: effStatus(u),
      following: !!me && isFollowing(me, u),
      friend: !!me && friendsOf(me).includes(u.id),
      blocked: !!me && blockedOf(me).includes(u.id),
    }))
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name))
    .slice(0, limit || 50);
}
// A public view: "whose ID/name is this?" — name, bio, join date, presence.
// If that person blocked the viewer we pretend they do not exist (no leak).
function profile(query, viewer) {
  const u = findUser(query);
  if (!u) return null;
  const me = viewer ? findUser(viewer) : null;
  if (me && u.id !== me.id && blockedOf(u).includes(me.id)) return null;
  return {
    id: u.id, name: u.name, bio: u.bio || '', joined: u.createdAt || null, online: isOnline(u),
    avatar: avatarUrl(u), status: effStatus(u),
    followingCount: followingOf(u).length, followersCount: followersOf(u).length,
    postCount: Object.values(load().posts || {}).filter(p => p.fid === u.id).length,
    following: !!me && u.id !== me.id && isFollowing(me, u),
    followsMe: !!me && u.id !== me.id && isFollowing(u, me),
    friend: !!me && friendsOf(me).includes(u.id),
    blocked: !!me && blockedOf(me).includes(u.id),
  };
}
function setBio(name, bio) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  u.bio = String(bio == null ? '' : bio).replace(/\s+/g, ' ').trim().slice(0, 120);
  touch();
  return { ok: true, user: u };
}

// ─── Chat ⇄ Cell bridge (SMS gateway) ──────────────────────────────────
// The server has no GSM modem, so one Android device is paired as the radio
// (see src/sms.js). The fallback: a DM to a friend who is OFFLINE & linked a number
// is sent as an SMS; incoming SMS replies are routed back into that same DM.
// Number normalisation MUST match sms.normalizeNumber — it is the matching key.
function normPhone(value) {
  let s = String(value || '').trim();
  const plus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;
  return (plus ? '+' : '') + s.slice(0, 24);
}
function findUserByPhone(norm) {
  if (!norm) return null;
  return Object.values(load().users).find((u) => u.phone === norm) || null;
}
function setPhone(name, phone) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  if (phone === null || phone === undefined || String(phone).trim() === '') {
    u.phone = null; touch(); return { ok: true, phone: null };
  }
  const norm = normPhone(phone);
  if (!norm) return { error: 'That phone number does not look valid.' };
  const holder = findUserByPhone(norm);
  if (holder && holder.id !== u.id) return { error: 'That number is already linked to another account.' };
  u.phone = norm; touch();
  return { ok: true, phone: norm };
}
// The SMS sender is injected from outside (server.js) so chat.js does not need
// to know the gateway's HTTP/authentication. Return { ok } when the queue accepted it.
let smsSender = null;
function setSmsSender(fn) { smsSender = (typeof fn === 'function') ? fn : null; }
// In send(): a DM to an offline friend who has a number → one outgoing SMS.
// Skipped for messages that came from SMS anyway (extra.sms) — anti-loop.
function smsFallback(su, r, t, extra) {
  if (!smsSender || !su || !t || (extra && extra.sms) || r.kind !== 'dm') return;
  const pid = peerId(r, su.id);
  const peer = pid ? byId(pid) : null;
  if (!peer || !peer.phone || isOnline(peer)) return;
  let ret = null;
  try { ret = smsSender({ to: peer.phone, from: su.name, body: su.name + ': ' + t }); } catch { ret = null; }
  // Stitch number → sender so an incoming SMS reply knows which DM.
  if (ret && ret.ok) { load().smsReply[peer.phone] = su.id; touch(); }
}
// An incoming SMS from a linked number → route it into the DM between the owner
// of that number and the last friend who SMS-ed them. An unknown number / no
// thread is kept only in the admin inbox (the gateway's original trip).
function ingestSms(fromPhone, body) {
  const s = load();
  const norm = normPhone(fromPhone);
  if (!norm) return { ignored: true, reason: 'bad-number' };
  const owner = findUserByPhone(norm);
  if (!owner) return { ignored: true, reason: 'not-linked' };
  const tid = (s.smsReply || {})[norm];
  const target = tid ? byId(tid) : null;
  if (!target) return { ignored: true, reason: 'no-thread' };
  if (dmFrozen(owner, target)) return { ignored: true, reason: 'frozen' };
  const r = ensureDm(owner, target);
  if (!r) return { ignored: true, reason: 'no-room' };
  return send(owner.name, r.id, body, null, null, { sms: true });
}
// ─── Status (mood sementara) ────────────────────────────────────────────
// Unlike the bio (permanent, 120 characters) and a story (24 hours, media): a status
// is short text + an emoji with an optional expiry. Shown on the profile,
// the friends/follow lists, the DM header & the social feed.
const STATUS_T_MAX = 80;
const STATUS_E_MAX = 8;   // the emoji-code cap (bytes not characters so an emoji family does not split)
// TTL choices: 'off' = stays until it is replaced/cleared.
const STATUS_TTL = { off: 0, '30m': 1800e3, '1h': 3600e3, '4h': 14400e3, '8h': 28800e3, '12h': 43200e3, '24h': 86400e3, '7d': 604800e3 };
// Return null when there is none / it expired. The raw store still holds it until
// the writer replaces/clears it (so the client can show the time left without faking 0).
function effStatus(u) {
  const st = u && u.status;
  if (!st || typeof st !== 'object') return null;
  if (st.exp && Date.now() > st.exp) return null;
  if (!st.t && !st.e) return null;
  return { t: String(st.t || ''), e: String(st.e || ''), at: st.at || null, exp: st.exp || null };
}
function setStatus(name, body) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const b = body || {};
  const raw = String(b.text == null ? '' : b.text).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const emo = String(b.emoji == null ? '' : b.emoji).trim();
  const key = String(b.expiresIn == null ? 'off' : b.expiresIn).toLowerCase();
  if (b.expiresIn != null && !Object.prototype.hasOwnProperty.call(STATUS_TTL, key)) {
    return { error: 'Unknown status duration option.' };
  }
  // Clear: both the text & the emoji are empty → the status is emptied.
  if (!raw && !emo) { u.status = null; touch(); return { ok: true, status: null }; }
  if (raw.length > STATUS_T_MAX) return { error: 'Status too long (limit ' + STATUS_T_MAX + ' characters).' };
  const eb = Buffer.from(emo, 'utf8');
  if (eb.length > STATUS_E_MAX * 4) return { error: 'Emoji too large (pick just one).' };
  const ttl = STATUS_TTL[key] || 0;
  const now = Date.now();
  u.status = { t: raw, e: emo, at: now, exp: ttl ? now + ttl : null };
  touch();
  return { ok: true, status: effStatus(u) };
}
// Change the display name. The Tukuk ID stays → DM rooms, messages and unread survive.
function rename(name, next) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const clean = normalizeName(next);
  if (!clean) return { error: 'Name must be 2–20 characters (letters/numbers/spaces only).' };
  if (/^\d{6}$/.test(clean)) return { error: 'Name cannot be 6 digits (Tukuk ID format).' };
  const old = key(u.name);
  if (old === key(clean)) return { ok: true, user: u, changed: false };
  if (s.users[key(clean)]) return { error: 'That name is already taken by someone else.' };
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
// ─── Friends & blocking ───
// Both lists store Tukuk IDs (not names) so a name change cannot
// break them. Blocking freezes the DM both ways: neither side may
// send a message, but the history stays readable. The error message is deliberately
// generic — the blocked party cannot confirm that state.
const MAX_FRIENDS = 500, MAX_BLOCKS = 200;
const friendsOf = (u) => (u && Array.isArray(u.friends) ? u.friends : []);
const blockedOf = (u) => (u && Array.isArray(u.blocked) ? u.blocked : []);
const asUser = (who) => ((who && typeof who === 'object') ? who : findUser(who));
const iBlock = (a, b) => !!a && !!b && blockedOf(a).includes(b.id);
const otherBlock = (a, b) => !!a && !!b && blockedOf(b).includes(a.id);
const dmFrozen = (a, b) => { const ua = asUser(a), ub = asUser(b); return iBlock(ua, ub) || otherBlock(ua, ub); };

// A social target: it must exist and must not be your own account.
function socialTarget(u, q) {
  const t = findUser(q);
  if (!t) return { error: normalizeName(q) ? 'That user has not registered on T Chat yet.' : 'No such ID or name.' };
  if (t.id === u.id) return { error: 'That is your own account.' };
  return { ok: true, peer: t };
}

function addFriend(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  if (blockedOf(u).includes(t.peer.id)) return { error: 'Unblock them first before making them a friend.' };
  if (blockedOf(t.peer).includes(u.id)) return { error: 'That user could not be found.' };
  if (friendsOf(u).includes(t.peer.id)) return { ok: true, user: u, peer: t.peer, already: true };
  if (friendsOf(u).length >= MAX_FRIENDS) return { error: 'Friend list has reached the limit of ' + MAX_FRIENDS + '.' };
  (u.friends = friendsOf(u)).push(t.peer.id);
  touch();
  pub('social', {}, [u.id]);
  return { ok: true, user: u, peer: t.peer };
}
function delFriend(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  u.friends = friendsOf(u).filter((i) => i !== t.peer.id); // the DM history is untouched
  touch();
  pub('social', {}, [u.id]);
  return { ok: true, user: u, peer: t.peer };
}
function blockUser(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  if (blockedOf(u).includes(t.peer.id)) return { ok: true, user: u, peer: t.peer, already: true };
  if (blockedOf(u).length >= MAX_BLOCKS) return { error: 'Block list has reached the limit of ' + MAX_BLOCKS + '.' };
  (u.blocked = blockedOf(u)).push(t.peer.id);
  u.friends = friendsOf(u).filter((i) => i !== t.peer.id);
  t.peer.friends = friendsOf(t.peer).filter((i) => i !== u.id); // the two-way friendship is dropped
  touch();
  pub('social', {}, [u.id]);   // only the blocker is told — the victim does not know
  return { ok: true, user: u, peer: t.peer };
}
function unblockUser(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  u.blocked = blockedOf(u).filter((i) => i !== t.peer.id);
  touch();
  pub('social', {}, [u.id]);
  return { ok: true, user: u, peer: t.peer };
}
// The list for the Settings screen. Friends carry a `dm` (an existing room id / null).
function socialLists(name) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const wrap = (ids, withDm) => ids.map((id) => {
    const p = byId(id);
    if (!p) return null;
    const out = { id: p.id, name: p.name, bio: p.bio || '', online: isOnline(p), status: effStatus(p) };
    if (withDm) { const rid = dmId(u.id, p.id); out.dm = s.rooms[rid] ? rid : null; }
    return out;
  }).filter(Boolean).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  return { ok: true, friends: wrap(friendsOf(u), true), blocked: wrap(blockedOf(u), false) };
}

// ─── Social: follows, posts, stories, notifications, avatars ───
// Follow X/Twitter-style: following/followers are stored on both sides
// as lists of Tukuk IDs. Posting + stories use the same media store as
// messages (magic bytes, quota, HMAC) — but their own synthetic room so that
// owning a file when attaching to a post needs no DM/group room.
const MAX_POST = 500;          // the post text length
const MAX_POST_MEDIA = 4;      // the image/video files of one post
const MAX_COMMENT = 200;       // the comment text length
const MAX_COMMENTS = 100;      // the comments of one post (the oldest are dropped)
const MAX_FEED = 50;           // the maximum posts per feed page
const MAX_STORIES = 10;        // the active stories per user
const STORY_TTL = 24 * 3600e3; // a story expires after 24 hours
const MAX_NOTIF = 100;         // notifications stored per user
const MAX_FOLLOWING = 2000;    // following cap
const MAX_FOLLOWERS = 10000;   // follower cap
const NOTIF_TYPES = new Set(['like', 'comment', 'follow', 'mention', 'story', 'repost']);
const MAX_TAGS = 8;
// An X-style feature: #tags on a post (Unicode-safe, the first letter is not a digit).
const HASH_RE = /(^|[\s(\[{"])#([\p{L}][\p{L}\p{N}_]{1,29})/gu; // a tag must start with a letter, min 2 characters
const parseTags = (t) => {
  const out = [];
  let m;
  HASH_RE.lastIndex = 0;
  while ((m = HASH_RE.exec(String(t || '')))) { const tag = m[2].toLowerCase(); if (!out.includes(tag)) out.push(tag); if (out.length >= MAX_TAGS) break; }
  return out;
};

const followingOf = (u) => (u && Array.isArray(u.following) ? u.following : []);
const followersOf = (u) => (u && Array.isArray(u.followers) ? u.followers : []);
const isFollowing = (a, b) => !!a && !!b && followingOf(a).includes(b.id);
// The audience of a post/story = the writer's followers + the writer themselves,
// EXCLUDING anyone who blocks the writer or is blocked by them (no leak).
function audience(authorId) {
  const s = load();
  const a = byId(authorId);
  if (!a) return [];
  const inBlock = new Set(blockedOf(a));                    // a blocks them
  const outBlock = new Set(Object.values(s.users).filter(v => blockedOf(v).includes(a.id)).map(v => v.id)); // they block a
  const ids = followersOf(a).filter(id => !inBlock.has(id) && !outBlock.has(id));
  if (!inBlock.has(a.id) && !outBlock.has(a.id)) ids.push(a.id);
  return Array.from(new Set(ids));
}
// A post for display: the media url is re-signed + the writer's current name/avatar.
function avatarUrl(u) {
  if (!u || !u.avatar) return null;
  const rec = (load().media || {})[u.avatar];
  if (!rec || !rec.avatar || !fs.existsSync(mediaFile(rec))) return null;
  return '/api/chat/avatar/' + rec.id;
}
function hydratePost(p, viewer) {
  if (!p) return p;
  const a = byId(p.fid);
  const out = hydrate(p);
  out.from = (a && a.name) || p.from;
  out.avatar = avatarUrl(a);
  if (out.comments) out.comments = out.comments.map(hydrate);
  // A copy of the original post for the "repost/quote" style — the url is re-signed.
  if (p.rp) {
    const o = (load().posts || {})[p.rp];
    if (o) {
      const oa = byId(o.fid);
      if (!viewer || !oa || (!blockedOf(viewer).includes(o.fid) && !blockedOf(oa).includes(viewer.id))) {
        const oo = hydratePost(o, viewer);
        out.rpOf = { id: o.id, fid: o.fid, from: (oa && oa.name) || o.from, avatar: avatarUrl(oa), t: o.t, media: oo.media || [], likes: o.likes || {}, comments: o.comments || [], ts: o.ts };
      }
    }
  }
  return out;
}
// A post may only be attached by the OWNER of the upload (unlike a room message
// which room members may share) — posts are not shared between users yet.
// A reference is stored as `<marker>:<mediaId>` (marker = the id of a post/comment/story,
// or 'av' for an avatar) so the sweep can find dead social references.
function attachPostMedia(user, ids, holder, cap) {
  const s = load();
  const out = [];
  for (const raw of ids || []) {
    const id = String(raw && raw.id ? raw.id : raw);
    const rec = (s.media || {})[/^[a-f0-9]{12}$/.test(id) ? id : ''];
    if (!rec || !fs.existsSync(mediaFile(rec))) continue;
    if (rec.by !== key(user.name)) continue;
    const ref = holder + ':' + id;
    if (!rec.msgs.includes(ref)) rec.msgs.push(ref);
    out.push(projectMedia(rec));
    if (out.length >= cap) break;
  }
  return out;
}
// Drop the social reference `<marker>:<mediaId>`; the file is deleted when no reference is left.
function releaseSocialMedia(items, holder) {
  const s = load();
  for (const it of items || []) {
    const rec = (s.media || {})[it && it.id];
    if (!rec) continue;
    rec.msgs = (rec.msgs || []).filter(x => x !== holder + ':' + rec.id);
    if (!rec.msgs.length) dropMedia(rec.id);
  }
}
function createPost(name, text, media, opts) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const o = opts || {};
  const t = String(text == null ? '' : text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\r\n?/g, '\n').trim().slice(0, MAX_POST);
  const pid = crypto.randomBytes(6).toString('hex');
  let orig = null;
  const att = media && media.length ? attachPostMedia(u, media, pid, MAX_POST_MEDIA) : [];
  if (media && media.length && !att.length) return { error: 'Attachments could not be used — please upload again.' };
  if (o.rp) {
    // Repost/quote: only quote text is allowed with no attachment (the original post
    // already carries its media) and it must exist and be visible to the writer.
    if (att.length) return { error: 'A repost cannot have its own attachments.' };
    orig = (s.posts || {})[String(o.rp)];
    if (!orig) return { error: 'Original post not found.' };
    if (orig.rp) return { error: 'A repost cannot re-post another repost.' };
    const oa = byId(orig.fid);
    if (oa && (blockedOf(u).includes(oa.id) || blockedOf(oa).includes(u.id))) return { error: 'Original post not found.' };
  } else if (!t && !att.length) return { error: 'Empty post.' };
  s.posts = s.posts || {};
  const post = { id: pid, fid: u.id, from: u.name, t, ts: Date.now(), likes: {}, comments: [] };
  const tags = parseTags(t);
  if (tags.length) post.tags = tags;
  if (o.rp) post.rp = String(o.rp);
  if (att.length) post.media = att;
  s.posts[pid] = post;
  touch();
  const out = hydratePost(post, u);
  pub('post', { post: out }, audience(u.id));
  notifyMentions(u, t, pid);
  if (orig && orig.fid !== u.id) pushNotif(orig.fid, 'repost', { actor: u.id, post: orig.id, text: t.slice(0, 120) });
  return { ok: true, post: out };
}
// Delete only the writer's own post; the media + comments (including other people's)
// are released in one go.
function delPost(name, pid) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const p = (s.posts || {})[String(pid)];
  if (!p) return { error: 'Post not found.' };
  if (p.fid !== u.id) return { error: 'Only your own posts can be deleted.' };
  for (const c of p.comments || []) releaseSocialMedia(c.media, c.id);
  releaseSocialMedia(p.media, p.id);
  delete s.posts[p.id];
  // Reposts referring to this post are deleted too (they own no media to release).
  const rps = Object.values(s.posts || {}).filter(x => x.rp === p.id);
  for (const x of rps) delete s.posts[x.id];
  for (const [k, list] of Object.entries(s.notif || {})) {
    const kept = list.filter(n => n.post !== p.id);
    if (kept.length !== list.length) { if (kept.length) s.notif[k] = kept; else delete s.notif[k]; }
  }
  touch();
  pub('postdel', { id: p.id }, audience(u.id));
  for (const x of rps) pub('postdel', { id: x.id }, audience(x.fid));
  return { ok: true };
}
function getPost(pid, viewer) {
  const s = load();
  const p = (s.posts || {})[String(pid)];
  if (!p) return null;
  const v = viewer ? findUser(viewer) : null;
  const author = byId(p.fid);
  if (v && author && (blockedOf(v).includes(p.fid) || blockedOf(author).includes(v.id))) return null;
  return p;
}
function likePost(name, pid) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const p = (s.posts || {})[String(pid)];
  if (!p) return { error: 'Post not found.' };
  if (dmFrozen(u, byId(p.fid))) return { error: 'Post not found.' };
  p.likes = p.likes || {};
  const on = !p.likes[u.id];
  if (on) p.likes[u.id] = 1; else delete p.likes[u.id];
  touch();
  if (on && p.fid !== u.id) pushNotif(p.fid, 'like', { actor: u.id, post: p.id });
  const out = hydratePost(p);
  pub('post', { post: out }, audience(p.fid));
  return { ok: true, post: out, liked: on };
}
function commentPost(name, pid, text, media) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const p = (s.posts || {})[String(pid)];
  if (!p) return { error: 'Post not found.' };
  if (dmFrozen(u, byId(p.fid))) return { error: 'Post not found.' };
  const t = String(text == null ? '' : text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, MAX_COMMENT);
  const cid = crypto.randomBytes(6).toString('hex');
  const att = media && media.length ? attachPostMedia(u, media, cid, 1) : [];
  if (media && media.length && !att.length) return { error: 'Attachments could not be used — please upload again.' };
  if (!t && !att.length) return { error: 'Empty comment.' };
  const c = { id: cid, fid: u.id, from: u.name, t, ts: Date.now() };
  if (att.length) c.media = att;
  p.comments.push(c);
  if (p.comments.length > MAX_COMMENTS) { const [gone] = p.comments.splice(0, p.comments.length - MAX_COMMENTS); for (const g of gone) releaseSocialMedia(g.media, g.id); }
  touch();
  // Notify the post's writer when someone else comments.
  if (p.fid !== u.id) pushNotif(p.fid, 'comment', { actor: u.id, post: p.id, text: (t || (att.length ? '📎 media' : '')).slice(0, 120) });
  const out = hydratePost(p);
  pub('post', { post: out }, audience(p.fid));
  return { ok: true, post: out };
}
// Feed = my posts + the posts of everyone I follow, newest first. A writer who
// blocks me, or whom I block, is filtered out.
function feedFor(name, limit, tag) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  pruneStories();
  const blockSet = new Set(blockedOf(u));
  const outBlock = new Set(Object.values(s.users).filter(v => blockedOf(v).includes(u.id)).map(v => v.id));
  const ok = new Set(followingOf(u).concat([u.id]));
  const wantTag = String(tag || '').trim().toLowerCase().replace(/^#/, '');
  const list = Object.values(s.posts || {})
    .filter(p => ok.has(p.fid) && !blockSet.has(p.fid) && !outBlock.has(p.fid))
    .filter(p => !wantTag || (p.tags || []).includes(wantTag))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, Math.min(Number(limit) || MAX_FEED, MAX_FEED));
  return { ok: true, posts: list.map(p => hydratePost(p, u)), stories: storiesOf(name) };
}
function userPosts(q, viewer) {
  const s = load();
  const t = findUser(q);
  if (!t) return { error: 'User not found.' };
  const v = viewer ? findUser(viewer) : null;
  if (v && t.id !== v.id && (blockedOf(t).includes(v.id) || (v && blockedOf(v).includes(t.id)))) return { error: 'User not found.' };
  const list = Object.values(s.posts || {}).filter(p => p.fid === t.id).sort((a, b) => b.ts - a.ts).slice(0, MAX_FEED);
  return { ok: true, posts: list.map(p => hydratePost(p, v || undefined)) };
}

// ─── Stories (24 hours) ───
function storyExpired(st) { return Date.now() - (st.ts || 0) >= STORY_TTL; }
function pruneStories() {
  const s = load();
  let hit = false;
  for (const [id, st] of Object.entries(s.stories || {})) {
    if (!storyExpired(st)) continue;
    releaseSocialMedia(st.media, id);
    delete s.stories[id];
    hit = true;
  }
  if (hit) { dirty = true; }
  return hit;
}
function createStory(name, text, media) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  pruneStories();
  const mine = Object.values(s.stories || {}).filter(x => x.fid === u.id);
  if (mine.length >= MAX_STORIES) return { error: 'Your stories are full (limit ' + MAX_STORIES + ' per 24 hours).' };
  const t = String(text == null ? '' : text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, MAX_POST);
  const sid = crypto.randomBytes(6).toString('hex');
  const att = media && media.length ? attachPostMedia(u, media, sid, MAX_POST_MEDIA) : [];
  if (!t && !att.length) return { error: 'Empty story.' };
  s.stories = s.stories || {};
  const st = { id: sid, fid: u.id, from: u.name, t, ts: Date.now(), media: att, views: [] };
  s.stories[sid] = st;
  touch();
  const out = hydrate(st);
  out.from = u.name; out.avatar = avatarUrl(u);
  pub('story', { story: out }, audience(u.id));
  return { ok: true, story: out };
}
function storiesOf(viewer) {
  const s = load();
  const u = findUser(viewer);
  if (!u) return [];
  const blockSet = new Set(blockedOf(u));
  const outBlock = new Set(Object.values(s.users).filter(v => blockedOf(v).includes(u.id)).map(v => v.id));
  const ok = new Set(followingOf(u).concat([u.id]));
  return Object.values(s.stories || {})
    .filter(x => ok.has(x.fid) && !storyExpired(x) && !blockSet.has(x.fid) && !outBlock.has(x.fid))
    .sort((a, b) => b.ts - a.ts)
    .map(x => { const a = byId(x.fid); const o = hydrate(x); o.from = (a && a.name) || x.from; o.avatar = avatarUrl(a); o.mine = !!a && a.id === u.id; return o; });
}
function viewStory(name, sid) {
  const s = load();
  const u = findUser(name);
  const st = (s.stories || {})[String(sid)];
  if (!u || !st || storyExpired(st)) return { error: 'Story not found.' };
  if (dmFrozen(u, byId(st.fid))) return { error: 'Story not found.' };
  st.views = st.views || [];
  if (!st.views.includes(u.id)) { st.views.push(u.id); touch(); }
  return { ok: true };
}
function delStory(name, sid) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const st = (s.stories || {})[String(sid)];
  if (!st) return { error: 'Story not found.' };
  if (st.fid !== u.id) return { error: 'Only your own stories can be deleted.' };
  releaseSocialMedia(st.media, st.id);
  delete s.stories[st.id];
  touch();
  pub('storydel', { id: st.id }, audience(u.id));
  return { ok: true };
}

// ─── Follow / unfollow ───
function followUser(name, q) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  if (blockedOf(u).includes(t.peer.id)) return { error: 'Unblock them first before following.' };
  if (blockedOf(t.peer).includes(u.id)) return { error: 'That user could not be found.' };
  if (isFollowing(u, t.peer)) return { ok: true, peer: t.peer, already: true };
  if (followingOf(u).length >= MAX_FOLLOWING) return { error: 'You already follow ' + MAX_FOLLOWING + ' users.' };
  if (followersOf(t.peer).length >= MAX_FOLLOWERS) return { error: 'That user has reached the follower limit.' };
  (u.following = followingOf(u)).push(t.peer.id);
  (t.peer.followers = followersOf(t.peer)).push(u.id);
  touch();
  pub('social', {}, [u.id]);
  pushNotif(t.peer.id, 'follow', { actor: u.id });
  return { ok: true, peer: t.peer };
}
function unfollowUser(name, q) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const t = socialTarget(u, q);
  if (t.error) return t;
  u.following = followingOf(u).filter(i => i !== t.peer.id);
  t.peer.followers = followersOf(t.peer).filter(i => i !== u.id);
  touch();
  pub('social', {}, [u.id]);
  return { ok: true, peer: t.peer };
}
// The followers/following display list — the same filter as when others block us.
function followList(name, q, which) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const t = findUser(q);
  if (!t) return { error: 'User not found.' };
  if (u.id !== t.id && (blockedOf(t).includes(u.id) || blockedOf(u).includes(t.id))) return { error: 'User not found.' };
  const ids = which === 'followers' ? followersOf(t) : followingOf(t);
  const blockSet = new Set(blockedOf(u));
  const outBlock = new Set(Object.values(s.users).filter(v => blockedOf(v).includes(u.id)).map(v => v.id));
  const list = ids.map(id => byId(id)).filter(Boolean)
    .filter(p => !blockSet.has(p.id) && !outBlock.has(p.id))
    .map(p => ({
      id: p.id, name: p.name, bio: p.bio || '', online: isOnline(p),
      friend: friendsOf(u).includes(p.id),
      following: isFollowing(u, p),
      followsMe: isFollowing(p, u),
    }))
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  return { ok: true, id: t.id, name: t.name, list };
}
// Suggestions for the Discover screen: people you do not follow yet & no blocking either way.
function discover(name, limit) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const outBlock = new Set(Object.values(s.users).filter(v => blockedOf(v).includes(u.id)).map(v => v.id));
  const skip = new Set(followingOf(u).concat([u.id], blockedOf(u), Array.from(outBlock)));
  const res = Object.values(s.users)
    .filter(v => !skip.has(v.id) && !blockedOf(u).includes(v.id))
    .map(v => ({
      id: v.id, name: v.name, bio: v.bio || '', online: isOnline(v),
      followers: followersOf(v).length,
      mutual: friendsOf(u).filter(i => followingOf(v).includes(i)).length,
      avatar: avatarUrl(v),
      followsMe: isFollowing(v, u),
    }))
    .sort((a, b) => (b.online - a.online) || (b.followers - a.followers) || a.name.localeCompare(b.name))
    .slice(0, Math.min(Number(limit) || 30, 50));
  return { ok: true, people: res };
}

// ─── Notifikasi ───
function pushNotif(toId, type, data) {
  if (!NOTIF_TYPES.has(type)) return;
  const s = load();
  const actor = data && data.actor ? byId(data.actor) : null;
  const target = byId(toId);
  if (!target || !actor || target.id === actor.id) return;
  if (blockedOf(target).includes(actor.id) || blockedOf(actor).includes(target.id)) return;
  s.notif = s.notif || {};
  const arr = s.notif[String(toId)] = s.notif[String(toId)] || [];
  const n = { id: crypto.randomBytes(5).toString('hex'), to: toId, type, actor: actor.id, actorName: actor.name,
    actorAvatar: avatarUrl(actor), post: (data && data.post) || null, room: (data && data.room) || null, text: (data && data.text) || '', ts: Date.now(), read: false };
  arr.push(n);
  if (arr.length > MAX_NOTIF) arr.splice(0, arr.length - MAX_NOTIF);
  touch();
  pub('notif', { notif: n }, [toId]);
}
function notifList(name) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const arr = (s.notif || {})[String(u.id)] || [];
  return { ok: true, notifs: arr.slice().reverse(), unread: arr.filter(n => !n.read).length };
}
function markNotifRead(name) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const arr = (s.notif || {})[String(u.id)] || [];
  let hit = false;
  for (const n of arr) if (!n.read) { n.read = true; hit = true; }
  if (hit) touch();
  return { ok: true };
}
function clearNotifs(name) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  if (s.notif) { delete s.notif[String(u.id)]; touch(); }
  return { ok: true };
}

// ─── Avatar ───
// An avatar file is an ordinary media record with the `avatar` marker; the public URL is built
// on every view (HMAC), so the store stays safe without a special endpoint.
function setAvatar(user, mid) {
  const s = load();
  const u = typeof user === 'string' ? findUser(user) : user;
  if (!u) return { error: 'Account not found.' };
  const id = String(mid && mid.id ? mid.id : mid || '');
  if (!/^[a-f0-9]{12}$/.test(id)) return { error: 'Invalid avatar.' };
  const rec = (s.media || {})[id];
  if (!rec || !fs.existsSync(mediaFile(rec))) return { error: 'File not found — please upload again.' };
  if (rec.by !== u.k) return { error: 'This file does not belong to you.' };
  if (!isImage(rec.mime)) return { error: 'Avatar must be an image.' };
  rec.avatar = true;
  const ref = 'av:' + rec.id;
  if (rec.msgs && !rec.msgs.includes(ref)) rec.msgs.push(ref);
  const prev = u.avatar;
  if (prev && prev !== id) {
    const p = (s.media || {})[prev];
    if (p) { p.msgs = (p.msgs || []).filter(x => x !== 'av:' + prev); if (!p.msgs.length) dropMedia(prev); }
  }
  u.avatar = id;
  touch();
  pub('social', {}, [u.id]);
  return { ok: true, avatar: rec.id, url: '/api/chat/avatar/' + rec.id };
}
function removeAvatar(name) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  const prev = u.avatar;
  if (prev) {
    const p = (s.media || {})[prev];
    if (p) { p.msgs = (p.msgs || []).filter(x => x !== 'av:' + prev); if (!p.msgs.length) dropMedia(prev); }
  }
  u.avatar = null;
  touch();
  pub('social', {}, [u.id]);
  return { ok: true };
}
// A name mention (@name / @ID) in a post or a room → a notification for the person (max 8).
// `roomId` is sent so a notification click opens the room directly (not a post).
function notifyMentions(author, text, postId, roomId) {
  const s = load();
  const seen = new Set();
  const re = /@([\p{L}\p{N}._-]{2,20}|\d{6})/gu;
  let m, n = 0;
  while ((m = re.exec(String(text || ''))) && n < 8) {
    const t = findUser(m[1]);
    if (t && t.id !== author.id && !seen.has(t.id)) { seen.add(t.id); pushNotif(t.id, 'mention', { actor: author.id, post: postId || undefined, room: roomId || undefined, text: String(text).slice(0, 120) }); n++; }
  }
}
// @here / @all (Google Chat style) in a room → notify the members. The global room
// only targets people who are online so they do not drown in spam; 10 minutes
// per user per room.
const ATALL_COOLDOWN = 10 * 60e3;
function notifyAtAll(author, room, text) {
  const s = load();
  s.atall = s.atall || {};
  const ck = author.id + '|' + room.id;
  if (Date.now() - (s.atall[ck] || 0) < ATALL_COOLDOWN) return 0;
  const here = room.kind === 'global';
  const ids = here ? Object.values(s.users).filter(isOnline).map(u => u.id) : (room.memberIds || []);
  let n = 0;
  for (const id of ids) {
    if (id === author.id) continue;
    const t = byId(id);
    if (t) { pushNotif(id, 'mention', { actor: author.id, room: room.id, text: String(text).slice(0, 120) }); n++; }
  }
  if (n) { s.atall[ck] = Date.now(); touch(); }
  return n;
}

// Change the password: the old one must be valid, a new salt, and the other sessions are dropped
// (other devices must log in again; the token in use stays alive).
function setPass(name, oldPass, nextPass) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  if (!eqHex(u.hash, hashPass(String(oldPass == null ? '' : oldPass), u.salt))) return { error: 'Current password is wrong.', status: 401 };
  const p = String(nextPass == null ? '' : nextPass);
  if (p.length < 4) return { error: 'New password must be at least 4 characters.' };
  if (p.length > 200) return { error: 'New password is too long.' };
  if (eqHex(u.hash, hashPass(p, u.salt))) return { error: 'New password is the same as the old one.' };
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPass(p, u.salt);
  touch();
  return { ok: true, user: u };
}
function logoutAll(name, keep) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  let n = 0;
  for (const [tok, sess] of Object.entries(s.sessions)) {
    if (tok === keep) continue;
    if ((sess.uid && sess.uid === u.id) || key(sess.name) === u.k) { delete s.sessions[tok]; n++; }
  }
  touch();
  return { ok: true, revoked: n };
}
// Delete an account immediately and irrevocably. The password must verify.
// Drops the user, sessions, push subscriptions, room memberships (DMs removed, groups
// dissolved if they were the creator or an admin promoted if not), seen/typing state,
// and the media they own. Messages inside rooms keep the old name (history).
function deleteAccount(name, pass) {
  const s = load();
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  if (!eqHex(u.hash, hashPass(String(pass == null ? '' : pass), u.salt))) return { error: 'Wrong password.', status: 401 };
  const id = u.id, k = u.k;
  // 1) Sessions & push subscriptions
  for (const [tok, sess] of Object.entries(s.sessions)) if ((sess.uid && sess.uid === id) || key(sess.name) === k) delete s.sessions[tok];
  if (s.pushSubs) delete s.pushSubs[String(id)];
  // 2) Rooms
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
  // 3) Seen & typing state belonging to this user
  for (const sk of Object.keys(s.seen)) if (sk.endsWith('|' + k)) delete s.seen[sk];
  for (const tk of Object.keys(s.typing)) if (tk.startsWith(k + '|')) delete s.typing[tk];
  // 3b) Social layer: posts + comments (including other people's comments on them), stories,
  // two-way notifications, and follow links on both sides of every other user.
  for (const [pidp, p] of Object.entries(s.posts || {})) {
    if (p.fid === id) {
      for (const c of p.comments || []) releaseSocialMedia(c.media, c.id);
      releaseSocialMedia(p.media, p.id);
      delete s.posts[p.id];
      continue;
    }
    const before = (p.comments || []).length;
    p.comments = (p.comments || []).filter(c => c.fid !== id);
    if (p.comments.length !== before) touch();
    delete p.likes[id];
  }
  for (const [sid, st] of Object.entries(s.stories || {})) {
    if (st.fid !== id) continue;
    releaseSocialMedia(st.media, st.id);
    delete s.stories[sid];
  }
  for (const nk of Object.keys(s.notif || {})) {
    const kept = (s.notif[nk] || []).filter(n => n.to !== id && n.actor !== id && n.to !== String(id));
    if (kept.length !== (s.notif[nk] || []).length) { if (kept.length) s.notif[nk] = kept; else delete s.notif[nk]; }
    touch();
  }
  for (const v of Object.values(s.users)) {
    if (v.id === id) continue;
    const fb = followingOf(v).includes(id);
    if (fb) { v.following = followingOf(v).filter(i => i !== id); }
    if ((v.friends || []).includes(id)) v.friends = v.friends.filter(i => i !== id);
    if (fb || blockedOf(v).includes(id) || friendsOf(v).includes(id)) touch();
    v.blocked = blockedOf(v).filter(i => i !== id);
  }
  u.following = []; u.followers = [];
  // 4) Media owned by the user (avatar & social attachments included)
  for (const [mid, rec] of Object.entries(s.media || {})) if (rec.by === k) dropMedia(mid);
  // 5) Account
  delete s.users[k];
  touch();
  return { ok: true, id };
}
function onlineMap() {
  const s = load(); const out = {}; const now = Date.now();
  for (const u of Object.values(s.users)) out[key(u.name)] = now - (u.lastSeen || 0) < ONLINE_MS;
  return out;
}

// ─── Periodic sweep ───
function sweep() {
  const s = load(); const now = Date.now();
  for (const [tok, sess] of Object.entries(s.sessions)) if (!sess || sess.exp < now) delete s.sessions[tok];
  for (const [k, ts] of Object.entries(s.typing)) if (now - ts > TYPING_MS * 2) delete s.typing[k];
  pruneStories();
  // Uploads that never became a message (tab closed) + files with no reference → drop.
  for (const [id, rec] of Object.entries(s.media || {})) {
    if (rec.msgs && rec.msgs.length) continue;
    if (now - (rec.ts || 0) > ORPHAN_TTL) dropMedia(id);
  }
  // Dead social references (post/story/comment/avatar already deleted) → drop them from
  // the list; plain message references (no ':') are left alone here.
  const live = new Set();
  for (const p of Object.values(s.posts || {})) {
    for (const m of (p.media || [])) live.add(m.id);
    for (const c of (p.comments || [])) for (const m of (c.media || [])) live.add(m.id);
  }
  for (const st of Object.values(s.stories || {})) for (const m of (st.media || [])) live.add(m.id);
  for (const u of Object.values(s.users)) if (u.avatar) live.add(u.avatar);
  for (const rec of Object.values(s.media || {})) {
    if (!rec.msgs || !rec.msgs.length) continue;
    const kept = rec.msgs.filter(r => !r.includes(':') || live.has(r.split(':')[1]));
    if (kept.length !== rec.msgs.length) { rec.msgs = kept; dirty = true; }
  }
  for (const [k, q] of Object.entries(s.quota || {})) if (now - q.t > QUOTA_WIN * 4) delete s.quota[k];
  touch();
}
setInterval(sweep, 10 * 60e3).unref?.();

// ─── Live streams (SSE) ───
// One long-lived HTTP connection per tab so messages arrive at once. Polling
// (since/markSeen) stays the source of truth — the stream only shortens latency,
// so a BROKEN connection never loses anything.
const MAX_STREAMS = 6;          // concurrent connections per user
const BEAT_MS = 20e3;           // heartbeat: keeps the edge/tunnel from idling
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
// An empty `ids` = everyone connected (PUBLIC information only, such as presence).
// A DM audience is its members only — messages are never broadcast to other people.
function pub(ev, data, ids) {
  const targets = ids && ids.length ? [].concat(ids) : Array.from(sinks.keys());
  for (const id of targets) {
    const set = sinks.get(id);
    if (!set) continue;
    for (const snk of set) { try { snk.send(ev, data); } catch { /* the connection is dying */ } }
  }
}
function pubRoom(r, ev, data) {
  pub(ev, data, r && (r.kind === 'dm' || r.kind === 'group') ? (r.memberIds || []) : null);
}
// Close other devices' streams (password change / sign out of all sessions) after
// those sessions are dropped — the client logs itself out when it receives 'kick'.
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
// Heartbeat + presence-change detection (ONLINE_MS 90s) for every tab.
function tickBeat() {
  const s = load();
  // A missed write (stream already destroyed but 'close' has not reached here)
  // would throw — drop that sink right away so the slot is not left trapped.
  for (const [uid, set] of Array.from(sinks)) {
    for (const snk of Array.from(set)) {
      try { snk.ping(); } catch {
        try { snk.close(); } catch { /* already closed */ }
        detachSink(uid, snk);
      }
    }
  }
  const on = {};
  for (const u of Object.values(s.users)) on[u.id] = isOnline(u);
  if (lastOn) for (const [id, v] of Object.entries(on)) if (lastOn[id] !== v) pub('presence', { id: Number(id), online: v });
  lastOn = on;
}
// Drop every stream (used by tests — module state must not leak between them).
function clearSinks() {
  for (const set of Array.from(sinks.values())) for (const snk of set) { try { snk.close(); } catch { /* noop */ } }
  sinks.clear();
  if (beat) { clearInterval(beat); beat = null; }
  lastOn = null;
}

// ─── ICE / TURN (WebRTC configuration) ───
// The server offers public STUN only while TURN is unconfigured. For a NAT-busting relay,
// install coturn (see deploy/coturn/*) and set the TURN_HOST env (public IP/domain),
// TURN_PORT (default 3478), TURN_SECRET (the coturn "use-auth-secret" secret),
// TURN_TTL (credential lifetime, default 3600s). Credentials follow the coturn REST
// mechanism: username "<exp>:<rand>", credential = base64(HMAC-SHA1(secret,user)).
const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
function iceConfig() {
  const out = { iceServers: [{ urls: STUN_URLS }], turn: false };
  const host = process.env.TURN_HOST, secret = process.env.TURN_SECRET;
  if (!host || !secret) return out;
  const port = Number(process.env.TURN_PORT || 3478);
  const ttl = Number(process.env.TURN_TTL || 3600);
  const user = Math.floor(Date.now() / 1000 + ttl) + ':tukuk' + crypto.randomBytes(3).toString('hex');
  const credential = crypto.createHmac('sha1', secret).update(user).digest('base64');
  const base = 'turn:' + host + ':' + port;
  out.iceServers.push({ urls: [base, base + '?transport=udp', base + '?transport=tcp'], username: user, credential });
  out.turn = true;
  return out;
}

// ─── Account recovery (single-use emergency codes) ───
// A forgotten password used to mean an account lost for good. Now a user generates 5 emergency
// codes (shown once only; stored as SHA-256 hashes). Any one code resets the
// password without logging in; that code is destroyed and all old sessions are dropped.
const RECOVERY_N = 5;
const recHash = (c) => crypto.createHash('sha256').update(String(c).trim().toUpperCase()).digest('hex');
function recoveryGenerate(name) {
  const u = findUser(name);
  if (!u) return { error: 'Account not found.' };
  u.rec = u.rec || [];
  if (u.rec.length >= RECOVERY_N * 2) return { error: 'Too many active codes — use some before generating new ones.' };
  const codes = [];
  for (let i = 0; i < RECOVERY_N; i++) { const c = crypto.randomBytes(5).toString('hex').toUpperCase(); codes.push(c); u.rec.push(recHash(c)); }
  touch();
  return { ok: true, codes, remaining: u.rec.length };
}
function recoveryReset(name, code, newPass) {
  const u = findUser(name);
  if (!u) return { error: 'Invalid account or recovery code.' };
  const idx = (u.rec || []).indexOf(recHash(code));
  if (idx < 0) return { error: 'Invalid account or recovery code.' };
  const p = String(newPass == null ? '' : newPass);
  if (p.length < 4) return { error: 'New password must be at least 4 characters.' };
  if (p.length > 200) return { error: 'New password is too long.' };
  u.rec.splice(idx, 1);            // single-use: destroy this code
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPass(p, u.salt);
  logoutAll(u.name, null);         // remove every existing session
  touch();
  return { ok: true, user: u };
}

// ─── HTTP helpers ───
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : (req.query.token || '');
}
function cleanBody(x) { return x && typeof x === 'object' ? x : {}; }

// ─── Mounting on Express ───
function mount(app, deps) {
  const d = deps || {};
  if (d.path) setPath(d.path); // follow the store's existing data directory (not hardcoded)
  const rateLimit = d.rateLimit;
  const store = d.store;
  const lim = (opt) => (rateLimit ? rateLimit(opt) : (req, res, next) => next());

  const authOf = (req, res) => {
    const u = userOf(bearer(req));
    if (!u) { res.status(401).json({ error: 'Session expired. Please log in again.' }); return null; }
    return u;
  };
  const event = (m, d) => { if (store && store.event) try { store.event('chat', m, d); } catch { /* noop */ } };

  app.post('/api/chat/register', lim({ windowMs: 3600e3, max: 8, keyPrefix: 'chreg:' }), (req, res) => {
    const b = cleanBody(req.body);
    const r = register(b.name, b.pass);
    if (r.error) return res.status(400).json({ error: r.error });
    const token = issueSession(r.user.name);
    event('New chat account: ' + r.user.name, { name: r.user.name, id: r.user.id });
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
    if (u) dropSink(tok);   // this device's tab stops receiving immediately
    res.json({ ok: true });
  });

  // The live stream (SSE): one long connection per tab. The token travels in the
  // Bearer header (fetch-stream), so no credentials end up in URLs or server logs.
  app.get('/api/chat/stream', (req, res) => {
    const tok = bearer(req);
    const u = authOf(req, res); if (!u) return;
    let snk = null;
    const bye = () => { if (snk) { detachSink(u.id, snk); snk = null; } };
    snk = {
      tok,
      send: (ev, data) => { res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data || {}) + '\n\n'); },
      ping: () => { res.write(': t\n\n'); },
      close: () => { bye(); try { res.end(); } catch { /* already closed */ } },
    };
    // Rate cap per account. No header has been written yet so the 429 stays clean JSON.
    if (!attachSink(u.id, snk)) { bye(); return res.status(429).json({ error: 'Too many tabs open on this account.' }); }
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
    const st = load();
    const nu = ((st.notif || {})[String(u.id)] || []).filter(n => !n.read).length;
    res.json({ ok: true, name: u.name, id: u.id, bio: u.bio || '', joined: u.createdAt || null, online: true, avatar: avatarUrl(u), status: effStatus(u), notifUnread: nu, phone: u.phone || null, followingCount: followingOf(u).length, followersCount: followersOf(u).length });
  });

  // Callable from any app on tukuk.org — the same chat token = the same identity.
  app.get('/api/whoami', (req, res) => {
    const u = userOf(bearer(req));
    if (!u) return res.json({ ok: true, id: null, name: null });
    res.json({ ok: true, id: u.id, name: u.name, bio: u.bio || '', joined: u.createdAt || null, avatar: avatarUrl(u) });
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
    if (!canRead(u.name, room)) return res.status(403).json({ error: 'This room does not belong to you.' });
    // only mark "read" when the client really displays that room (avoids lost badges on mobile)
    if (req.query.read === '1') markSeen(u.name, room);
    // The user list is only sent on a full refresh — keeps the 2.5s poll from wasting bandwidth.
    if (req.query.full === '1') { const r = state.rooms[room]; return res.json({ ok: true, msgs: hydrateAll((r.list || []).slice(-KEEP)), seq: r.seq || 0, typing: typingIn(room), people: people(null, 300, u.name) }); }
    const out = since(u.name, room, req.query.after);
    res.json({ ok: true, msgs: hydrateAll(out.msgs), seq: out.seq, typing: typingIn(room) });
  });

  app.post('/api/chat/messages', lim({ windowMs: 60e3, max: 40, keyPrefix: 'chmsg:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const room = String(b.room || '');
    if (!canRead(u.name, room)) return res.status(403).json({ error: 'This room does not belong to you.' });
    if (b.media != null && !Array.isArray(b.media)) return res.status(400).json({ error: 'Attachments must be a list.' });
    if (Array.isArray(b.media) && b.media.length > MAX_PER_MSG) return res.status(400).json({ error: 'Maximum ' + MAX_PER_MSG + ' files per message.' });
    const r = send(u.name, room, b.text, b.replyTo, b.media, { sticker: b.sticker });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, msg: r.msg, seq: r.room.seq });
  });

  // Image/video upload: the RAW body (not JSON) + the room in the query.
  // Social flags: `post=1` = upload for your own post/story/comment (no room);
  // `avatar=1` = attach it straight away as the uploader's avatar.
  app.post('/api/chat/media', lim({ windowMs: 60e3, max: 40, keyPrefix: 'chmedia:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const social = String(req.query.post || '') === '1' || String(req.query.avatar || '') === '1';
    if (!social) {
      const room = String(req.query.room || '');
      if (!canRead(u.name, room)) return res.status(403).json({ error: 'This room does not belong to you.' });
    }
    const cl = Number(req.headers['content-length'] || 0);
    if (cl > MAX_VID) { req.resume(); return res.status(413).json({ error: 'File too large (limit 64MB).' }); }
    readRaw(req, MAX_VID + 64 * 1024).then((buf) => {
      const meta = { w: req.query.w, h: req.query.h, dur: req.query.dur, audio: req.query.audio, name: req.query.name, mime: req.query.mime };
      const r = addMedia(u, buf, meta);
      if (r.error) return res.status(r.status || 400).json({ error: r.error });
      if (String(req.query.avatar || '') === '1') {
        if (r.media.kind === 'file') { dropMedia(r.media.id); return res.status(400).json({ error: 'Profile picture must be an actual image.' }); }
        r.media.avatar = true;
        const av = setAvatar(u, r.media.id);
        if (av.error) { dropMedia(r.media.id); return res.status(400).json({ error: av.error }); }
        event('Avatar updated: ' + u.name, { id: u.id });
        return res.json({ ok: true, avatar: av.avatar, url: av.url });
      }
      event('Media uploaded: ' + r.media.kind + ' ' + Math.round(r.media.size / 1024) + 'KB', { id: u.id });
      res.json({ ok: true, media: Object.assign(projectMedia(r.media), { url: mediaUrl(r.media.id) }) });
    }).catch((e) => res.status(413).json({ error: e.message }));
  });

  // Media serving: signature only (no session token in the URL) + support
  // byte ranges so a video can be seeked without downloading the whole file.
  app.get('/api/chat/media/:id', (req, res) => {
    const id = String(req.params.id);
    if (!mediaAllowed(id, req.query.k)) return res.status(403).json({ error: 'Media link has expired.' });
    const rec = mediaSrc(id);
    if (!rec) return res.status(404).json({ error: 'File already removed.' });
    serveMedia(req, res, rec);
  });

  // PUBLIC avatars: a short unsigned path — the URL may leak into news feeds or
  // search without exposing other media files (only records flagged as avatars).
  app.get('/api/chat/avatar/:id', (req, res) => {
    const id = String(req.params.id);
    const rec = (load().media || {})[/^[a-f0-9]{12}$/.test(id) ? id : ''];
    if (!rec || !rec.avatar || !fs.existsSync(mediaFile(rec))) return res.status(404).json({ error: 'File already removed.' });
    serveMedia(req, res, rec);
  });

  function serveMedia(req, res, rec) {
    const file = mediaFile(rec);
    fs.stat(file, (err, st) => {
      if (err) { dropMedia(rec.id); return res.status(404).json({ error: 'File already removed.' }); }
      const total = st.size;
      const head = {
        'Content-Type': rec.mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=86400',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Last-Modified': new Date(rec.ts || Date.now()).toUTCString(),
      };
      if (rec.kind === 'file') {
        // Generic files: music/video/pdf play or preview in place (the original mime
        // is safe); everything else is forced to download + nosniff.
        const inline = /^(audio|video)\//.test(rec.omime || '') || rec.omime === 'application/pdf';
        head['Content-Type'] = inline ? rec.omime : 'application/octet-stream';
        head['X-Content-Type-Options'] = 'nosniff';
        if (!inline) head['Content-Disposition'] = 'attachment; filename="' + String(rec.name || rec.id).replace(/["\\\r\n]/g, '_') + '"';
      }
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
  }

  app.post('/api/chat/room', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const raw = cleanBody(req.body).peer;
    const peer = findUser(raw);   // may be a Tukuk ID (number) or a name
    if (!peer) return res.status(400).json({ error: normalizeName(raw) ? 'That user has not registered on T Chat yet.' : 'No such ID or name.' });
    if (peer.id === u.id) return res.status(400).json({ error: 'You cannot DM yourself.' });
    if (dmFrozen(u, peer)) return res.status(403).json({ error: 'Cannot start a chat with this user.' });
    const r = ensureDm(u, peer);
    if (!r) return res.status(400).json({ error: 'No such ID or name.' });
    unhideRoom(u, r.id);   // opening a DM = coming out of hiding (symmetric with hide)
    res.json({ ok: true, room: { id: r.id, kind: r.kind, title: roomTitle(r, u), members: r.members, peerId: peer.id, seq: r.seq || 0 }, profile: profile(peer, u.name) });
  });

  // Hide a DM from my sidebar only — it comes back when a new message arrives
  // or when the room is reopened through POST /api/chat/room.
  app.post('/api/chat/room/hide', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = hideRoom(u.name, String(cleanBody(req.body).room || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  app.get('/api/chat/user', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const p = profile(req.query.q, u.name);
    if (!p) return res.status(404).json({ error: 'User not found.' });
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
    event('Profile updated: ' + u.name, { id: u.id });
    res.json({ ok: true, name: u.name, id: u.id, profile: profile(u.name) });
  });

  // Link/unlink a phone number for offline DM fallback (the SMS gateway).
  // Send { phone: '' } or { phone: null } to remove it.
  app.post('/api/chat/phone', lim({ windowMs: 3600e3, max: 20, keyPrefix: 'chphone:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = setPhone(u.name, b.phone);
    if (r.error) return res.status(400).json({ error: r.error });
    event(r.phone ? 'Phone linked: ' + u.name : 'Phone unlinked: ' + u.name, { id: u.id });
    res.json({ ok: true, phone: r.phone });
  });

  // Status (a temporary mood) — short text + emoji with an optional TTL.
  // Clear it by sending { text:'', emoji:'' } (or both null).
  app.post('/api/chat/status', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chst:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = setStatus(u.name, { text: b.text, emoji: b.emoji, expiresIn: b.expiresIn });
    if (r.error) return res.status(400).json({ error: r.error });
    // Tell yourself (other tabs) + followers so lists and views stay fresh.
    const audience = followersOf(u).concat([u.id]);
    pub('social', { kind: 'status', by: u.id }, audience);
    event('Status updated: ' + u.name + (r.status ? ' — ' + (r.status.e || '') + ' ' + r.status.t : ' — cleared'), { id: u.id });
    res.json({ ok: true, status: r.status });
  });

  app.post('/api/chat/typing', (req, res) => {
    const u = userOf(bearer(req)); if (!u) return res.json({ ok: true });
    setTyping(u.name, String(cleanBody(req.body).room || ''));
    res.json({ ok: true });
  });

  // ─── Room polls ───
  app.post('/api/chat/poll', lim({ windowMs: 60e3, max: 10, keyPrefix: 'chpoll:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const room = String(b.room || '');
    if (!canRead(u.name, room)) return res.status(403).json({ error: 'This room does not belong to you.' });
    const cr = createPoll(u.name, room, b.q, b.opts);
    if (cr.error) return res.status(400).json({ error: cr.error });
    const r = send(u.name, room, '📊 ' + cr.poll.q, b.replyTo || null, null, { pollId: cr.poll.id });
    if (r.error) return res.status(400).json({ error: r.error });
    event('Poll created: ' + cr.poll.q.slice(0, 60), { id: u.id });
    res.json({ ok: true, msg: r.msg, seq: r.room.seq, poll: projectPoll(cr.poll) });
  });

  app.post('/api/chat/poll/vote', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = votePoll(u.name, String(b.id || ''), Number(b.opt));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, poll: r.poll });
  });

  app.get('/api/chat/people', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    res.json({ ok: true, people: people(req.query.q, 50, u.name) });
  });

  // ─── Video/audio calls: P2P signalling (WebRTC) ───
  // The server ONLY forwards signalling packets (SDP/ICE/control) to the target over the
  // existing SSE streams; media flows directly between devices (peer-to-peer),
  // so no audio/video is stored or relayed on the server. `delivered` tells the
  // caller whether the peer is really connected right now (for "offline").
  const CALL_EV = new Set(['ring', 'accept', 'reject', 'busy', 'offer', 'answer', 'ice', 'end', 'cancel']);
  const CALL_FANOUT = new Set(['ring', 'accept', 'end', 'cancel']);   // at once to room members
  const MAX_GROUP_CALL = 6;   // P2P mesh cap (n×(n−1)/2 connections)
  app.post('/api/chat/call', lim({ windowMs: 60e3, max: 120, keyPrefix: 'chcall:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const ev = String(b.ev || '');
    if (!CALL_EV.has(ev)) return res.status(400).json({ error: 'Unknown call signal.' });
    let data = b.data && typeof b.data === 'object' ? b.data : {};
    if (JSON.stringify(data).length > 16384) return res.status(413).json({ error: 'Signal packet too large.' });
    // 'kind' only matters on 'ring' — keep it small and normalized.
    if (ev === 'ring') data = Object.assign({ kind: data.kind === 'audio' ? 'audio' : 'video' }, data);

    // ─── Group calls (mesh): these frames carry `room` + `callId`. ───
    // 'ring'/'accept'/'end'/'cancel' broadcast to every member (except the sender,
    // and peers who blocked each other); 'offer'/'answer'/'ice'/'reject'/'busy'
    // stay point-to-point via `to` — media never passes through the server.
    if (b.room) {
      const gr = load().rooms[String(b.room)];
      if (!gr || gr.kind !== 'group') return res.status(400).json({ error: 'Group not found.' });
      if (!isMember(gr, u)) return res.status(403).json({ error: 'You are not a member of this group.' });
      if (ev === 'ring' && (gr.memberIds || []).length > MAX_GROUP_CALL) return res.status(400).json({ error: 'Group calls support up to ' + MAX_GROUP_CALL + ' members.' });
      const callId = String(data.callId || '').slice(0, 24) || (ev === 'ring' ? 'c' + crypto.randomBytes(4).toString('hex') : '');
      data = Object.assign({}, data, { callId });
      if (CALL_FANOUT.has(ev)) {
        const ids = (gr.memberIds || []).filter(i => i !== u.id && !dmFrozen(u, byId(i)));
        pub('call', { from: u.id, fromName: u.name, room: gr.id, ev, data }, ids);
        if (ev === 'ring') event((data.kind === 'audio' ? 'Group voice call: ' : 'Group video call: ') + u.name + ' → ' + (gr.title || 'Group'), { id: u.id });
        return res.json({ ok: true, callId, delivered: ids.some(i => { const set = sinks.get(i); return set && set.size; }) });
      }
      const gp = byId(b.to);
      if (!gp || gp.id === u.id || !(gr.memberIds || []).includes(gp.id)) return res.status(400).json({ error: 'User not found.' });
      if (dmFrozen(u, gp)) return res.status(403).json({ error: 'Could not call that user.' });
      const gset = sinks.get(gp.id);
      pub('call', { from: u.id, fromName: u.name, to: gp.id, room: gr.id, ev, data }, [gp.id]);
      return res.json({ ok: true, callId, delivered: !!(gset && gset.size) });
    }

    const peer = byId(b.to);
    if (!peer) return res.status(400).json({ error: 'User not found.' });
    if (peer.id === u.id) return res.status(400).json({ error: 'You cannot call yourself.' });
    if (dmFrozen(u, peer)) return res.status(403).json({ error: 'Could not call that user.' });
    const set = sinks.get(peer.id);
    pub('call', { from: u.id, fromName: u.name, to: peer.id, ev, data }, [peer.id]);
    if (ev === 'ring') event((data.kind === 'audio' ? 'Voice call: ' : 'Video call: ') + u.name + ' → ' + peer.name, { id: u.id, peer: peer.id });
    res.json({ ok: true, delivered: !!(set && set.size), online: isOnline(peer) });
  });

  // ICE configuration for WebRTC — STUN always; TURN only when configured.
  app.get('/api/chat/ice', (req, res) => {
    if (!userOf(bearer(req))) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    res.json(Object.assign({ ok: true }, iceConfig()));
  });

  // Account recovery: generate emergency codes (login required) + check how many are active.
  app.post('/api/chat/recovery/generate', lim({ windowMs: 3600e3, max: 10, keyPrefix: 'chrecgen:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = recoveryGenerate(u.name);
    if (r.error) return res.status(400).json({ error: r.error });
    event('Recovery codes generated: ' + u.name, { id: u.id });
    res.json(r);
  });
  app.get('/api/chat/recovery/status', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    res.json({ ok: true, remaining: ((findUser(u.name) || {}).rec || []).length });
  });
  // Reset the password with an emergency code — NO login needed (strict rate cap
  // because it is an unauthenticated path).
  app.post('/api/chat/recovery/reset', lim({ windowMs: 3600e3, max: 6, keyPrefix: 'chrec:' }), (req, res) => {
    const b = cleanBody(req.body);
    const r = recoveryReset(b.name, b.code, b.pass);
    if (r.error) return res.status(400).json({ error: r.error });
    event('Password reset via recovery code: ' + r.user.name, { id: r.user.id });
    res.json({ ok: true, token: issueSession(r.user.name), name: r.user.name, id: r.user.id, remaining: (r.user.rec || []).length });
  });

  // ─── Settings: friends, blocking, password, sessions ───
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
    if (r.already && !b.remove) return res.status(400).json({ error: 'You already have that user in your friend list.' });
    res.json({ ok: true, added: !b.remove && !r.already, social: socialLists(u.name) });
  });

  app.post('/api/chat/block', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chblk:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = b.remove ? unblockUser(u.name, b.peer) : blockUser(u.name, b.peer);
    if (!socialEdit(res, r)) return;
    if (r.already && !b.remove) return res.status(400).json({ error: 'Already blocked.' });
    event((b.remove ? 'Unblock' : 'Block') + ' @' + ((r.peer && r.peer.name) || b.peer) + ' by ' + u.name, { id: r.peer && r.peer.id });
    // Blocking also severs the two-way follow relationship.
    const x = findUser(u.name), y = r.peer;
    if (x && y && !b.remove) {
      x.following = followingOf(x).filter(i => i !== y.id);
      y.followers = followersOf(y).filter(i => i !== x.id);
      touch();
    }
    res.json({ ok: true, blocked: !b.remove && !r.already, social: socialLists(u.name) });
  });

  // ─── Social routes: follows, posts, stories, notifications ───
  app.post('/api/chat/follow', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chfol:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = b.remove ? unfollowUser(u.name, b.peer) : followUser(u.name, b.peer);
    if (!socialEdit(res, r)) return;
    if (r.already && !b.remove) return res.status(400).json({ error: 'You already follow that user.' });
    event((b.remove ? 'Unfollowed @' : 'Followed @') + ((r.peer && r.peer.name) || b.peer) + ' by ' + u.name, { id: u.id });
    res.json({ ok: true, following: !b.remove && !r.already, profile: profile(r.peer, u.name) });
  });

  app.get('/api/chat/follows', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = followList(u.name, req.query.q || u.name, String(req.query.which || 'following'));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  app.get('/api/chat/discover', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = discover(u.name, req.query.limit);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  app.get('/api/chat/feed', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = feedFor(u.name, req.query.limit, req.query.tag);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  app.post('/api/chat/posts', lim({ windowMs: 3600e3, max: 30, keyPrefix: 'chpost:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    if (b.media != null && !Array.isArray(b.media)) return res.status(400).json({ error: 'Attachments must be a list.' });
    if (Array.isArray(b.media) && b.media.length > MAX_POST_MEDIA) return res.status(400).json({ error: 'Maximum ' + MAX_POST_MEDIA + ' files per post.' });
    const cr = createPost(u.name, b.text, b.media, { rp: b.repost ? String(b.repost) : null });
    if (cr.error) return res.status(400).json({ error: cr.error });
    event('New post by ' + u.name, { id: u.id });
    res.json({ ok: true, post: cr.post });
  });

  app.get('/api/chat/posts', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = userPosts(req.query.q || u.name, u.name);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  app.post('/api/chat/posts/delete', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = delPost(u.name, String(cleanBody(req.body).id || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/chat/posts/like', lim({ windowMs: 3600e3, max: 120, keyPrefix: 'chlike:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = likePost(u.name, String(cleanBody(req.body).id || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, post: r.post, liked: r.liked });
  });

  app.post('/api/chat/posts/comment', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chcmt:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = commentPost(u.name, String(b.id || ''), b.text, Array.isArray(b.media) ? b.media : undefined);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, post: r.post });
  });

  app.get('/api/chat/posts/:id', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const p = getPost(String(req.params.id), u.name);
    if (!p) return res.status(404).json({ error: 'Post not found.' });
    res.json({ ok: true, post: hydratePost(p, u) });
  });

  app.post('/api/chat/stories', lim({ windowMs: 3600e3, max: 20, keyPrefix: 'chstoy:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = createStory(u.name, b.text, Array.isArray(b.media) ? b.media : undefined);
    if (r.error) return res.status(400).json({ error: r.error });
    event('New story by ' + u.name, { id: u.id });
    res.json({ ok: true, story: r.story });
  });

  app.get('/api/chat/stories', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    res.json({ ok: true, stories: storiesOf(u.name) });
  });

  app.post('/api/chat/stories/view', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = viewStory(u.name, String(cleanBody(req.body).id || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/chat/stories/delete', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = delStory(u.name, String(cleanBody(req.body).id || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  app.get('/api/chat/notifs', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = notifList(u.name);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  app.post('/api/chat/notifs/read', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = markNotifRead(u.name);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/chat/notifs/clear', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = clearNotifs(u.name);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/chat/avatar/remove', (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const r = removeAvatar(u.name);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/chat/password', lim({ windowMs: 3600e3, max: 10, keyPrefix: 'chpass:' }), (req, res) => {
    const tok = bearer(req);
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = setPass(u.name, b.old, b.next);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    const n = logoutAll(u.name, tok);
    kickSinks(u.id, tok);
    event('Password changed: ' + u.name, { id: u.id, revoked: n.revoked });
    res.json({ ok: true, revoked: n.revoked, message: 'Password changed. Other devices need to log in again.' });
  });

  app.post('/api/chat/logout-all', (req, res) => {
    const tok = bearer(req);
    const u = authOf(req, res); if (!u) return;
    const r = logoutAll(u.name, tok);
    if (r.error) return res.status(400).json({ error: r.error });
    kickSinks(u.id, tok);
    res.json({ ok: true, revoked: r.revoked });
  });

  // Delete the account: password required, all data torn down, every session + stream
  // closed (including this tab — the client logs out as soon as it gets the response).
  app.post('/api/chat/delete-account', lim({ windowMs: 24 * 3600e3, max: 3, keyPrefix: 'chdelacct:' }), (req, res) => {
    const tok = bearer(req);
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = deleteAccount(u.name, b.pass);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    event('Account deleted: ' + u.name, { id: u.id });
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

  // Message search across rooms — min 2 characters, max 30 results, newest first.
  app.get('/api/chat/search', lim({ windowMs: 60e3, max: 30, keyPrefix: 'chrch:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, results: [] });
    res.json({ ok: true, results: searchMsgs(u.name, q) });
  });

  // ─── Group rooms ───
  app.post('/api/chat/group', lim({ windowMs: 3600e3, max: 20, keyPrefix: 'chgrp:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = createGroup(u.name, b.title, b.memberIds);
    if (r.error) return res.status(400).json({ error: r.error });
    event('New group: ' + r.room.title + ' by ' + u.name, { id: u.id });
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
    event('Group renamed: ' + r.title + ' by ' + u.name, { id: u.id });
    res.json({ ok: true, title: r.title });
  });

  app.post('/api/chat/group/kick', lim({ windowMs: 3600e3, max: 60, keyPrefix: 'chgrpkick:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    const r = kickFromGroup(u.name, String(b.room || ''), b.memberId);
    if (r.error) return res.status(400).json({ error: r.error });
    event('Member removed from group by ' + u.name, { id: u.id });
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
    event('Group dissolved by ' + u.name, { id: u.id });
    res.json({ ok: true, dissolved: true });
  });

  // ─── Web Push (VAPID) ───
  app.get('/api/chat/vapid-public-key', (req, res) => {
    initVapid();
    const k = vapidPubB64();
    if (!k) return res.status(500).json({ error: 'VAPID is not available.' });
    res.json({ ok: true, key: k });
  });

  app.post('/api/chat/push-subscribe', lim({ windowMs: 3600e3, max: 20, keyPrefix: 'chpush:' }), (req, res) => {
    const u = authOf(req, res); if (!u) return;
    const b = cleanBody(req.body);
    if (!b.endpoint || !b.keys) return res.status(400).json({ error: 'Invalid subscription.' });
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
  hideRoom, unhideRoom, lastMsgTs,
  react, edit, remove, setTyping, typingIn, searchMsgs, people, onlineMap, setPath, load, flush,
  byId, findUser, nameOfUser, peerId, isMember, sameAuthor, authorName,
  profile, rename, setBio, isOnline, cleanText,
  setPhone, findUserByPhone, normPhone, setSmsSender, ingestSms,
  setStatus, effStatus, STATUS_TTL, STATUS_T_MAX, STATUS_E_MAX,
  addFriend, delFriend, blockUser, unblockUser, socialLists, socialTarget, setPass, logoutAll,
  friendsOf, blockedOf, dmFrozen, MAX_FRIENDS, MAX_BLOCKS,
  pub, pubRoom, attachSink, detachSink, kickSinks, dropSink, tickBeat, clearSinks, MAX_STREAMS,
  sniff, addMedia, attachMedia, mediaUrl, mediaAllowed, mediaSrc, mediaFile, projectMedia,
  hydrate, releaseMedia, dropMedia, readRaw, quotaCheck, trimRoom,
  createGroup, addToGroup, leaveGroup, renameGroup, kickFromGroup, addAdmin, dissolveBy, isGroupAdmin, adminsOf, pinMsg, deleteAccount, initVapid, vapidPubB64, derSigToRaw, doSendPush, maybePush,
  followUser, unfollowUser, isFollowing, followingOf, followersOf, audience, createPost, delPost, getPost, likePost, commentPost, feedFor, userPosts,
  createStory, storiesOf, viewStory, delStory, pruneStories, STORY_TTL,
  pushNotif, notifList, markNotifRead, clearNotifs, setAvatar, removeAvatar, avatarUrl, hydratePost, notifyMentions, notifyAtAll, followList, discover, releaseSocialMedia,
  iceConfig, recoveryGenerate, recoveryReset, RECOVERY_N, STUN_URLS, recHash,
  MAX_POST, MAX_POST_MEDIA, MAX_COMMENT, MAX_COMMENTS, MAX_FEED, MAX_STORIES, MAX_NOTIF, MAX_FOLLOWING, MAX_FOLLOWERS,
  MAX_IMG, MAX_VID, MAX_AUDIO, MAX_DOC, MAX_PER_MSG, QUOTA_FILES, STORE_CAP, FIRST_ID, KEEP,
  createPoll, votePoll, projectPoll, MAX_POLL_Q, MAX_POLL_OPT, MAX_POLL_OPTS,
  get mediaDir() { return MEDIA; },
};
