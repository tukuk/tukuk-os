'use strict';
// Tests for the T Chat backend (src/chat.js) — pure logic, no HTTP server.
// Every test starts with a fresh JSON store in a temporary directory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const chat = require('../src/chat');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-chat-'));
  chat.setPath(path.join(dir, 'chat.json'));
  chat.clearSinks();  // sinks from a previous test must not leak into this one
  return dir;
}

test('normalizeName: accepts a valid name, rejects an invalid one', () => {
  assert.equal(chat.normalizeName('  Aisyah  '), 'Aisyah');
  assert.equal(chat.normalizeName('fahmi_99'), 'fahmi_99');
  assert.equal(chat.normalizeName('a'), null, 'too short');
  assert.equal(chat.normalizeName('x'.repeat(21)), null, 'too long');
  assert.equal(chat.normalizeName('bad<name>/'), null, 'dangerous symbols');
  assert.equal(chat.normalizeName(''), null);
});

test('register/login: an scrypt hash, a wrong password is rejected', () => {
  fresh();
  const r = chat.register('Aisyah', 'secret123');
  assert.ok(r.ok && r.user.name === 'Aisyah');
  assert.notEqual(r.user.hash, 'secret123', 'the password is not stored raw');
  assert.ok(chat.login('aisyah', 'secret123').ok, 'the name is case-insensitive');
  assert.ok(chat.login('Aisyah', 'wrong').error, 'a wrong password → an error');
});

test('register: a duplicate name + a short password are rejected', () => {
  fresh();
  assert.ok(chat.register('Firdaus', '1234').ok);
  assert.ok(chat.register('firdaus', 'abcd').error, 'a duplicate is rejected');
  assert.ok(chat.register('Baru', '123').error, 'a pass < 4 characters is rejected');
});

test('session: issue → userOf → revoke', () => {
  fresh();
  chat.register('Hafiz', 'key99');
  const token = chat.issueSession('Hafiz');
  assert.equal(chat.userOf(token).name, 'Hafiz');
  assert.equal(chat.userOf('fake-token'), null);
  chat.revoke(token);
  assert.equal(chat.userOf(token), null, 'after logout the session is dead');
});

test('the DM room: a deterministic two-way id + reuse', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.equal(chat.dmId('Ana', 'Ben'), chat.dmId('Ben', 'Ana'));
  const r1 = chat.ensureDm('Ana', 'Ben');
  const r2 = chat.ensureDm('Ben', 'Ana');
  assert.equal(r1.id, r2.id, 'the same room, never duplicated');
  assert.equal(r2.members.length, 2, 'the member count does not grow');
});

test('hide DM: filters roomsFor, comes back on a new message / when opened', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cin', 'pass3');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ben', dm.id, 'old');
  assert.ok(chat.roomsFor('Ana').some(r => r.id === dm.id), 'before hide: visible');
  assert.ok(chat.hideRoom('Ana', dm.id).ok);
  assert.ok(!chat.roomsFor('Ana').some(r => r.id === dm.id), 'Ana: hidden');
  assert.ok(chat.roomsFor('Ben').some(r => r.id === dm.id), 'Ben: unaffected');
  chat.send('Ben', dm.id, 'new');
  assert.ok(chat.roomsFor('Ana').some(r => r.id === dm.id), 'a new message un-hides it');
  chat.hideRoom('Ana', dm.id);
  chat.unhideRoom(chat.findUser('Ana'), dm.id);   // POST /api/chat/room opens the room
  assert.ok(chat.roomsFor('Ana').some(r => r.id === dm.id), 'reopened → the hide is gone');
  // Only a DM can be hidden; a non-member is rejected.
  assert.ok(chat.hideRoom('Ana', 'global_am').error, 'global is not a DM');
  assert.ok(chat.hideRoom('Cin', dm.id).error, 'a non-member is rejected');
  const g = chat.createGroup('Ana', 'Kelas', [chat.findUser('Ben').id]);
  assert.ok(chat.hideRoom('Ana', g.room.id).error, 'a group uses Leave, not hide');
});

test('canRead: a DM is limited to its members, global is open', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cin', 'pass3');
  const dm = chat.ensureDm('Ana', 'Ben');
  assert.ok(chat.canRead('Ana', dm.id));
  assert.ok(chat.canRead('Ben', dm.id));
  assert.ok(!chat.canRead('Cin', dm.id), 'an outsider cannot read a DM');
  assert.ok(chat.canRead('Cin', 'global_am'), 'the global room is for everyone');
});

test('send: the sequence (seq) rises, an empty text is rejected, a long one is cut', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const a = chat.send('Ana', 'global_am', 'hello');
  const b = chat.send('Ana', 'global_am', 'world');
  assert.equal(a.msg.seq, 1);
  assert.equal(b.msg.seq, 2);
  assert.ok(chat.send('Ana', 'global_am', '   ').error, 'an empty message is rejected');
  assert.ok(chat.send('Ana', 'no-room', 'x').error, 'a room that does not exist → an error');
  const long = chat.send('Ana', 'global_am', 'a'.repeat(900));
  assert.equal(long.msg.t.length, 500, 'cut at MAX_MSG');
});

test('send: multi-line messages are kept, other control chars are dropped', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const a = chat.send('Ana', 'global_am', 'line one\nline two').msg;
  assert.equal(a.t, 'line one\nline two', '\n is not destroyed');
  assert.equal(chat.send('Ana', 'global_am', 'x\r\ny').msg.t, 'x\ny', 'CRLF is normalised');
  assert.ok(chat.send('Ana', 'global_am', '\n\n').error, 'blank lines only = an empty message');
  assert.equal(chat.send('Ana', 'global_am', 'a\u0000b\u0007c').msg.t, 'a b c', 'nul/bell become spaces');
});

test('send: a replyTo pointing at a missing message is dropped, not corrupted', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const real = chat.send('Ana', 'global_am', 'origin').msg;
  assert.equal(chat.send('Ana', 'global_am', 'x', 'fake-id').msg.to, null);
  assert.equal(chat.send('Ana', 'global_am', 'y', real.id).msg.to, real.id);
});

test('rooms: old messages are pruned after the KEEP limit (KEEP=200)', () => {
  fresh();
  chat.register('Ana', 'pass1');
  for (let i = 0; i < 210; i++) chat.send('Ana', 'global_am', 'm' + i);
  const all = chat.since('Ana', 'global_am', 0);
  assert.equal(all.msgs.length, 200, 'only the last 200');
  assert.equal(all.msgs[0].t, 'm10', 'the oldest ones were pruned');
  assert.equal(all.seq, 210, 'seq keeps rising even though the list is trimmed');
});

test('since(after): only the new messages, used for polling', () => {
  fresh();
  chat.register('Ana', 'pass1');
  chat.send('Ana', 'global_am', 'one');
  chat.send('Ana', 'global_am', 'two');
  assert.equal(chat.since('Ana', 'global_am', 1).msgs.length, 1);
  assert.equal(chat.since('Ana', 'global_am', 2).msgs.length, 0);
  assert.equal(chat.since('Ana', 'global_am', 0).msgs.length, 2);
});

test('since: read-only — it does not clear unread (markSeen is explicit)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ben', dm.id, 'for ana');
  chat.since('Ana', dm.id, 0); // a poll without read=1
  assert.equal(chat.unread('Ana')[dm.id], 1, 'the badge lasts until the room is really opened');
  chat.markSeen('Ana', dm.id);
  assert.equal(chat.unread('Ana')[dm.id], 0);
});

test('unread + markSeen work per room', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ben', dm.id, 'p1'); chat.send('Ben', dm.id, 'p2');
  assert.equal(chat.unread('Ana')[dm.id], 2);
  chat.markSeen('Ana', dm.id);
  assert.equal(chat.unread('Ana')[dm.id], 0);
  chat.send('Ben', dm.id, 'p3');
  assert.equal(chat.unread('Ana')[dm.id], 1);
});

test('unread: your own message never becomes unread for the sender', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ana', dm.id, 'i am sending');
  assert.equal(chat.unread('Ana')[dm.id], 0, 'the sender sees 0');
  assert.equal(chat.unread('Ben')[dm.id], 1, 'the receiver sees 1');
  chat.send('Ben', dm.id, 'reply');
  assert.equal(chat.unread('Ana')[dm.id], 1, 'only Ben\'s message is unread by Ana');
  chat.send('Ben', dm.id, 'cheguj');
  chat.send('Ana', dm.id, 'i reply now');
  assert.equal(chat.unread('Ana')[dm.id], 2, 'sending your own message does not clear other people\'s unread');
});

test('react: a toggle — pressing twice removes the reaction', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const id = chat.send('Ana', 'global_am', 'kotlin').msg.id;
  assert.deepEqual(chat.react('Ben', 'global_am', id, '🔥').msg.rx, { '🔥': 1 });
  assert.deepEqual(chat.react('Ben', 'global_am', id, '🔥').msg.rx, {}, 'the toggle turns it off');
  assert.ok(chat.react('Ben', 'global_am', 'not-there', '❤️').error);
});

test('edit/delete: only the message owner', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const id = chat.send('Ana', 'global_am', 'origin').msg.id;
  assert.ok(chat.edit('Ben', 'global_am', id, 'hack').error, 'not the owner → rejected');
  assert.equal(chat.edit('Ana', 'global_am', id, 'fixed').msg.t, 'fixed');
  assert.ok(chat.edit('Ana', 'global_am', id, '  ').error, 'an empty edit is rejected');
  assert.ok(chat.remove('Ben', 'global_am', id).error, 'deleting someone else\'s → rejected');
  assert.ok(chat.remove('Ana', 'global_am', id).ok);
  assert.equal(chat.since('Ana', 'global_am', 0).msgs.length, 0);
});

test('typing: recorded, then expires', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.setTyping('Ben', dm.id);
  assert.deepEqual(chat.typingIn(dm.id), ['ben'], 'Ana sees Ben typing');
  chat.send('Ben', dm.id, 'done');
  assert.deepEqual(chat.typingIn(dm.id), [], 'sending clears typing');
  chat.setTyping('Ana', 'no-room');
  assert.deepEqual(chat.typingIn('no-room'), [], 'a room that does not exist is ignored');
});

test('people: the filter + online presence', () => {
  fresh();
  chat.register('Aisyah', 'pass1'); chat.register('Firdaus', 'pass2');
  chat.userOf(chat.issueSession('Aisyah')); // touches lastSeen
  const all = chat.people(null);
  assert.equal(all.length, 2);
  const on = all.find(p => p.name === 'Aisyah');
  assert.ok(on.online, 'an active session = online');
  assert.ok(!all.find(p => p.name === 'Firdaus').online, 'not active yet = offline');
  assert.deepEqual(chat.people('fir').map(p => p.name), ['Firdaus']);
});

test('persistence: flush to disk + reload', () => {
  const dir = fresh();
  const file = path.join(dir, 'chat.json');
  chat.register('Kekal', 'pass1');
  chat.send('Kekal', 'global_am', 'a lasting message');
  chat.flush();
  assert.ok(fs.existsSync(file), 'the file is written');
  chat.setPath(file); // reload from disk
  assert.equal(chat.people(null).length, 1);
  assert.ok(chat.login('Kekal', 'pass1').ok, 'the account was saved');
  assert.equal(chat.since('Kekal', 'global_am', 0).msgs[0].t, 'a lasting message');
});

test('eqHex: a constant-time comparison, a different length is safe', () => {
  assert.ok(chat.eqHex('abcd', 'abcd'));
  assert.ok(!chat.eqHex('abcd', 'abce'));
  assert.ok(!chat.eqHex('ab', 'abcd'), 'a different length → false, no throw');
  assert.ok(!chat.eqHex('xyz', 'abcd'), 'invalid hex → false, no throw');
});

// ─── Tukuk ID (the permanent identity) ───
test('id: every account gets a permanent number starting at 100001', () => {
  fresh();
  const a = chat.register('Ana', 'pass1').user;
  const b = chat.register('Ben', 'pass2').user;
  assert.equal(a.id, 100001);
  assert.equal(b.id, 100002, 'the numbers rise monotonically');
  assert.equal(chat.byId(100001).name, 'Ana');
  assert.equal(chat.findUser('100002').name, 'Ben', 'a textual ID is found too');
  assert.equal(chat.findUser('999999'), null);
});

test('id: a 6-digit name is rejected — that range belongs to Tukuk ID', () => {
  fresh();
  assert.ok(chat.register('123456', 'pass1').error, 'registering a 6-digit name is rejected');
  chat.register('Ana', 'pass1');
  assert.ok(chat.rename('Ana', '123456').error, 'renaming to a 6-digit name is rejected');
});

test('the DM is keyed on the ID: a rename does not break the connection', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  assert.equal(dm.id, 'dm_100001~100002', 'the room id follows the number, not the name');
  chat.send('Ben', dm.id, 'hi ana');
  const tok = chat.issueSession('Ben');
  assert.ok(chat.rename('Ben', 'BenBaru').ok);
  assert.ok(chat.roomsFor('Ana').some(r => r.id === dm.id), 'Ana still sees that room');
  assert.ok(chat.canRead('BenBaru', dm.id), 'the new name is still a member');
  assert.ok(!chat.canRead('Ben', dm.id), 'the old name is no longer an identity');
  assert.equal(chat.roomTitle(dm, 'Ana'), 'BenBaru', 'the title follows the current name');
  assert.equal(chat.unread('Ana')[dm.id], 1, 'unread survives the rename');
  assert.equal(chat.userOf(tok).name, 'BenBaru', 'the old session stays alive');
});

test('rename: a duplicate name is rejected, the same name is not an error', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.ok(chat.rename('Ana', 'ben').error, 'the name is taken (case-insensitive)');
  const same = chat.rename('Ana', 'Ana');
  assert.ok(same.ok && same.changed === false, 'renaming to your own name = no change');
  assert.ok(chat.rename('nobody', 'Cinz').error, 'an account that does not exist → an error');
});

test('profile: "who owns this ID?" → name, bio, presence', () => {
  fresh();
  chat.register('Ana', 'pass1');
  chat.setBio('Ana', 'likes   building bots');
  assert.equal(chat.profile(100001).name, 'Ana');
  assert.equal(chat.profile('ana').bio, 'likes building bots', 'the bio is collapsed to one line');
  assert.equal(chat.profile('nobody'), null);
  assert.deepEqual(chat.people('100001').map(p => p.name), ['Ana'], 'the directory can search by number');
});

test('fid: the message is written with the ID, displayed with the current name', () => {
  fresh();
  const a = chat.register('Ana', 'pass1').user;
  const m = chat.send('Ana', 'global_am', 'hi').msg;
  assert.equal(m.fid, a.id, 'the message carries the sender id');
  chat.rename('Ana', 'Anna');
  assert.equal(chat.authorName(m), 'Anna', 'the current name is looked up from the id');
  assert.equal(m.from, 'Ana', 'the name at send time stays as a record');
  assert.ok(chat.edit('Anna', 'global_am', m.id, 'fixed').ok, 'the write right follows the id');
  assert.ok(chat.remove('Anna', 'global_am', m.id).ok);
});

test('ensureDm: the partner is not registered → null (no ghost DM)', () => {
  fresh();
  chat.register('Ana', 'pass1');
  assert.equal(chat.ensureDm('Ana', 'Nobody'), null);
  assert.equal(chat.ensureDm('Ana', 'Ana'), null, 'yourself is rejected');
});

test('migration: old data (rooms by name, no id) upgrades without losing messages', () => {
  const dir = fresh();
  const file = path.join(dir, 'chat.json');
  fs.writeFileSync(file, JSON.stringify({
    users: {
      ana: { name: 'Ana', k: 'ana', salt: 's', hash: 'h', createdAt: 1, lastSeen: 0 },
      ben: { name: 'Ben', k: 'ben', salt: 's', hash: 'h', createdAt: 2, lastSeen: 0 },
    },
    sessions: {},
    rooms: {
      global_am: { id: 'global_am', kind: 'global', title: '🌍 Am', members: ['*'], createdBy: 'sistem', createdAt: 1, seq: 1,
        list: [{ id: 'm1', seq: 1, from: 'Ana', t: 'old', ts: 1, to: null, rx: {}, edited: false, del: false }] },
      'dm_ana~ben': { id: 'dm_ana~ben', kind: 'dm', title: null, members: ['Ana', 'Ben'], createdBy: 'Ana', createdAt: 1, seq: 1,
        list: [{ id: 'm2', seq: 1, from: 'Ana', t: 'dm old', ts: 1, to: null, rx: {}, edited: false, del: false }] },
    },
    msgs: {}, seen: { 'dm_ana~ben|ben': 0 }, typing: {},
  }));
  chat.setPath(file);
  const s = chat.load();
  assert.equal(s.users.ana.id, 100001, 'an old account gets an id');
  assert.ok(s.rooms['dm_100001~100002'], 'the DM room is re-keyed by number');
  assert.ok(!s.rooms['dm_ana~ben'], 'the old key is dropped');
  assert.equal(s.rooms['dm_100001~100002'].list[0].t, 'dm old', 'the message history is safe');
  assert.equal(s.seen['dm_100001~100002|ben'], 0, 'the read marker is moved');
  assert.ok(chat.canRead('Ben', 'dm_100001~100002'));
  assert.equal(chat.roomTitle(s.rooms['dm_100001~100002'], 'Ben'), 'Ana');
  assert.equal(chat.roomsFor('Ana').length, 2);
});

// ─── Media (pictures + video) ───
const pad = (head, n) => Buffer.concat([head, Buffer.alloc(n || 40, 7)]);
const JPG = pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
const PNG = pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const GIF = pad(Buffer.from('GIF89a', 'latin1'));
const WEBP = pad(Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([9, 0, 0, 0]), Buffer.from('WEBP', 'latin1')]));
const MP4 = pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1')]).slice(0, 8 + 4));
const WEBM = pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
const GAGG = pad(Buffer.from('let us read a book')); // not a media file

const pickK = (url) => String(url).split('?k=')[1];

function upload(user, buf, meta) { return chat.addMedia(user, buf, meta || {}); }

test('sniff: the kind comes from the magic bytes, not the file name', () => {
  assert.equal(chat.sniff(JPG).mime, 'image/jpeg');
  assert.equal(chat.sniff(PNG).ext, 'png');
  assert.equal(chat.sniff(GIF).mime, 'image/gif');
  assert.equal(chat.sniff(WEBP).ext, 'webp');
  assert.equal(chat.sniff(MP4).mime, 'video/mp4');
  assert.equal(chat.sniff(WEBM).ext, 'webm');
  assert.equal(chat.sniff(GAGG), null, 'a non-media file is rejected');
  assert.equal(chat.sniff(Buffer.alloc(4)), null, 'too short → null');
});

test('media: upload + send a picture message (the text may be empty)', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const r = upload(ana, JPG, { w: 1600, h: 900 });
  assert.ok(r.ok);
  assert.ok(fs.existsSync(chat.mediaFile(r.media)), 'the file is written to disk');
  assert.equal(r.media.kind, 'image');
  const sent = chat.send('Ana', 'global_am', '', null, [r.media.id]);
  assert.ok(sent.ok, 'a picture without text is allowed');
  assert.equal(sent.msg.media.length, 1);
  assert.equal(sent.msg.media[0].w, 1600);
  assert.ok(sent.msg.media[0].url.startsWith('/api/chat/media/'), 'a signed url is handed out');
  assert.ok(chat.send('Ana', 'global_am', 'text only').ok);
  assert.ok(chat.send('Ana', 'global_am', '', null, []).error, 'empty without media is still rejected');
});

test('media: a link only passes when the signature is valid and unexpired', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const rec = upload(ana, PNG).media;
  const url = chat.mediaUrl(rec.id);
  assert.ok(chat.mediaAllowed(rec.id, pickK(url)));
  assert.ok(!chat.mediaAllowed(rec.id, pickK(url) + 'x'), 'a tampered signature → rejected');
  assert.ok(!chat.mediaAllowed('deadbeefcafe', pickK(url)), 'another id cannot use someone else\'s k');
  assert.ok(!chat.mediaAllowed(rec.id, String(Date.now() + 9e9) + '.aa'), 'unexpired date but the mac is wrong');
  assert.ok(chat.mediaSrc(rec.id), 'the record is found for serving');
  assert.ok(!chat.mediaSrc('aaaaaaaaaaaa'), 'a nonsense id → null, no disk read');
});

test('media: attach rights — other people, nonsense ids, and the reference count', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  chat.register('Ben', 'pass2');
  const ben = chat.findUser('Ben');
  const rec = upload(ana, JPG).media;
  assert.deepEqual(chat.attachMedia(ben, 'global_am', [rec.id], 'x1'), [], 'not a message yet → nobody else may use it');
  assert.equal(chat.attachMedia(ana, 'global_am', [rec.id], 'x1').length, 1);
  assert.deepEqual(chat.attachMedia(ana, 'global_am', ['deadbeefcafe'], 'x2'), [], 'a nonsense id is filtered out');
  assert.equal(chat.attachMedia(ana, 'global_am', [rec.id], 'x1').length, 1, 'the same message → no doubled reference');
  assert.equal(chat.load().media[rec.id].msgs.length, 1);
  assert.equal(chat.attachMedia(ana, 'global_am', [rec.id], 'x2').length, 1, 'sending the same picture twice is allowed');
  assert.equal(chat.load().media[rec.id].msgs.length, 2);
  assert.deepEqual(chat.load().media[rec.id].rooms, ['global_am']);
});

test('media: forward a picture to another room using the same reference (no copies)', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const ben = chat.register('Ben', 'pass2').user;
  const dm = chat.ensureDm(ana, ben);
  const rec = upload(ana, JPG).media;
  const a = chat.send('Ana', 'global_am', 'look at this', null, [rec.id]);
  const b = chat.send('Ana', dm.id, '', null, [rec.id]);
  assert.ok(b.ok, 'the owner may send their own file to another room');
  assert.equal(b.msg.media[0].id, rec.id);
  assert.deepEqual(chat.load().media[rec.id].rooms.slice().sort(), ['global_am', dm.id].sort());
  const f = chat.send('Ben', dm.id, 'forwarded too', null, [rec.id]);
  assert.ok(f.ok, 'Ben already saw that picture in the Am room → he may forward it');
  chat.remove('Ana', 'global_am', a.msg.id);
  assert.ok(chat.mediaSrc(rec.id), 'still used by the DM → the file is safe');
  assert.ok(chat.remove('Ana', dm.id, f.msg.id).error, 'Ben\'s message does not belong to Ana');
  chat.remove('Ben', dm.id, f.msg.id);
  assert.ok(chat.mediaSrc(rec.id), 'Ana\'s message in the DM is still there');
  chat.remove('Ana', dm.id, b.msg.id);
  assert.ok(!chat.mediaSrc(rec.id), 'no room left → the file is deleted');
});

test('media: the 4-file-per-message cap + the album is shown in list order', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(upload(ana, JPG).media.id);
  const sent = chat.send('Ana', 'global_am', 'album', null, ids);
  assert.ok(sent.ok);
  assert.equal(sent.msg.media.length, chat.MAX_PER_MSG, 'anything past the cap is dropped');
});

test('media: an oversized file + the upload quota are blocked', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const big = pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chat.MAX_IMG + 10);
  const over = chat.addMedia(ana, big);
  assert.equal(over.status, 413);
  assert.match(over.error, /too large/i);
  const bigdoc = Buffer.concat([Buffer.from('DOCX'), Buffer.alloc(chat.MAX_DOC + 10, 1)]);
  assert.equal(chat.addMedia(ana, bigdoc, { name: 'big.docx' }).status, 413, 'a general file that is too big → 413');
  for (let i = 0; i < chat.QUOTA_FILES; i++) assert.ok(upload(ana, GIF).ok, 'file ' + (i + 1) + ' is still allowed');
  const last = upload(ana, GIF);
  assert.equal(last.status, 429, 'the per-hour file quota → 429');
  assert.match(last.error, /Too many files/);
});

test('media: general files (documents/music) are accepted + the original name is normalised', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const pdf = Buffer.from('%PDF-1.4 a private report\n');
  const r = upload(ana, pdf, { name: 'report.pdf', mime: 'application/pdf' });
  assert.ok(r.ok, 'a document is now accepted as a general attachment');
  assert.equal(r.media.kind, 'file');
  assert.equal(r.media.ext, 'pdf');
  assert.equal(r.media.name, 'report.pdf');
  const pr = chat.projectMedia(r.media);
  assert.equal(pr.name, 'report.pdf');
  assert.equal(pr.mime, 'application/pdf');
  assert.equal(pr.size, pdf.length);
  const sent = chat.send('Ana', 'global_am', 'a document for you', null, [r.media.id]);
  assert.ok(sent.ok);
  assert.equal(sent.msg.media[0].kind, 'file');
  // a nonsense name is normalised; with no name → ext 'bin'
  const zip = upload(ana, GAGG, { name: '../../etc/pass"wd.zip', mime: 'application/zip' });
  assert.ok(zip.ok);
  assert.equal(zip.media.ext, 'zip');
  assert.ok(!zip.media.name.includes('/'), 'the path is stripped from the name');
  const nope = upload(ana, GAGG, {});
  assert.ok(nope.ok);
  assert.equal(nope.media.ext, 'bin');
  assert.equal(nope.media.name, 'fail');
  // mp3 (its magic bytes are not media) goes through as a file + the original mime for inline play
  const mp3 = upload(ana, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 3)]), { name: 'song.mp3', mime: 'audio/mpeg' });
  assert.ok(mp3.ok);
  assert.equal(mp3.media.ext, 'mp3');
  assert.equal(chat.projectMedia(mp3.media).mime, 'audio/mpeg');
});

test('media: deleting a message deletes the file, and a message evicted from storage too', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const rec = upload(ana, WEBM).media;
  const sent = chat.send('Ana', 'global_am', 'a short video', null, [rec.id]);
  const file = chat.mediaFile(rec);
  assert.ok(fs.existsSync(file));
  assert.ok(chat.remove('Ana', 'global_am', sent.msg.id).ok);
  assert.ok(!fs.existsSync(file), 'the file is deleted along with the message');
  assert.ok(!chat.mediaSrc(rec.id));
  assert.equal(chat.load().mediaBytes, 0, 'the total size is updated');
  // an old message rolls out of KEEP → its file is deleted as well
  const first = upload(ana, JPG).media;
  chat.load().rooms.global_am.list = [];  // empty it so the KEEP counter starts clean
  chat.load().rooms.global_am.seq = 0;
  const keep = chat.KEEP - 1;
  for (let i = 0; i < keep; i++) chat.send('Ana', 'global_am', 'p' + i);
  const a = chat.send('Ana', 'global_am', 'the first picture', null, [first.id]);
  const b = upload(ana, JPG).media;
  for (let i = 0; i < keep; i++) chat.send('Ana', 'global_am', 'q' + i);
  chat.send('Ana', 'global_am', 'the last picture', null, [b.id]);
  assert.ok(!chat.mediaSrc(a.msg.media[0].id), 'an evicted message → its file is drained');
  assert.ok(chat.mediaSrc(b.id), 'the last message is safe');
});

test('media: hydrate does not mutate the stored message', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const rec = upload(ana, PNG, { w: 100, h: 80 }).media;
  chat.send('Ana', 'global_am', 'has a picture', null, [rec.id]);
  const stored = chat.load().rooms.global_am.list[0];
  assert.ok(!stored.media[0].url, 'the url is not stored (it can expire)');
  const shown = chat.hydrate(stored);
  assert.ok(shown.media[0].url.includes(rec.id));
  assert.ok(!stored.media[0].url, 'the original object is still clean after hydrate');
  assert.deepEqual(chat.hydrate({ id: 'x' }).media, undefined, 'a plain message is untouched');
});

// ─── Friends, blocks, passwords ───
test('friends: add, list, remove + the basic errors', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  chat.register('Ben', 'pass2');
  assert.ok(chat.addFriend('Ana', 'nobody').error, 'the target does not exist');
  assert.ok(chat.addFriend('Ana', ana.id).error, 'yourself is rejected');
  assert.ok(chat.addFriend('Ana', 'Ben').ok);
  assert.ok(chat.addFriend('Ana', 'Ben').already, 'twice = already');
  const s = chat.socialLists('Ana');
  assert.equal(s.friends.length, 1);
  assert.equal(s.friends[0].id, 100002, 'a friend is stored as a Tukuk ID');
  assert.equal(s.friends[0].dm, null, 'there is no DM room yet');
  chat.ensureDm('Ana', 'Ben');
  assert.equal(chat.socialLists('Ana').friends[0].dm, chat.dmId(ana.id, 100002), 'a room exists → dm is filled');
  assert.ok(chat.delFriend('Ana', 'Ben').ok);
  assert.equal(chat.socialLists('Ana').friends.length, 0);
});

test('friends: a name change does not corrupt the list', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.addFriend('Ana', 'Ben');
  chat.rename('Ben', 'Citra');
  const f = chat.socialLists('Ana').friends;
  assert.equal(f.length, 1);
  assert.equal(f[0].name, 'Citra', 'the displayed name follows the current ID');
  assert.ok(chat.delFriend('Ana', 'Citra').ok, 'removing by the new name works');
});

test('block: the DM is frozen both ways, reading still works, unblocking restores it', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  assert.ok(chat.send('Ana', dm.id, 'hi').ok, 'before the block you can send');
  assert.ok(chat.blockUser('Ana', 'Ben').ok);
  assert.ok(chat.send('Ana', dm.id, 'still allowed?').error, 'the blocker cannot send either');
  assert.ok(chat.send('Ben', dm.id, 'who is that?').error, 'the blocked side is frozen too');
  const seen = chat.since('Ben', dm.id, 0);
  assert.equal(seen.msgs.length, 1, 'the history can still be read');
  assert.ok(chat.unblockUser('Ana', 'Ben').ok);
  assert.ok(chat.send('Ana', dm.id, 'back again').ok, 'after unblocking you can send');
});

test('block: removes the friendship both ways + no new friend can be added', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.addFriend('Ana', 'Ben'); chat.addFriend('Ben', 'Ana');
  chat.blockUser('Ana', 'Ben');
  assert.equal(chat.socialLists('Ana').friends.length, 0, 'my friend list was cleared');
  assert.equal(chat.socialLists('Ben').friends.length, 0, 'the two-way friendship was cleared');
  assert.ok(chat.addFriend('Ana', 'Ben').error, 'you cannot befriend someone you blocked');
  assert.ok(chat.blockUser('Ana', 'Ben').already);
  chat.unblockUser('Ana', 'Ben');
  assert.ok(chat.addFriend('Ana', 'Ben').ok, 'befriending works again once it is unblocked');
});

test('block: the victim is never told — the list & profile hide the blocker', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  chat.register('Ben', 'pass2');
  chat.register('Citra', 'pass3');
  chat.blockUser('Ana', 'Ben');
  assert.ok(!chat.people(null, 50, 'Ben').some(p => p.id === ana.id), 'Ben does not see Ana');
  assert.equal(chat.profile(ana.id, 'Ben'), null, 'Ana\'s profile looks absent to Ben');
  const asCitra = chat.people(null, 50, 'Citra');
  assert.ok(asCitra.some(p => p.id === ana.id), 'other people still see Ana');
  const b = chat.people(null, 50, 'Ana').find(p => p.id === 100002);
  assert.equal(b.blocked, true, 'the blocker knows whom they blocked');
  assert.equal(b.friend, false);
});

test('setPass: the old password is required, a new salt, the old one dies', () => {
  fresh();
  chat.register('Ana', 'old123');
  assert.ok(chat.setPass('Ana', 'wrong', 'new123').error);
  assert.ok(chat.setPass('Ana', 'old123', '123').error, 'too short');
  assert.ok(chat.setPass('Ana', 'old123', 'old123').error, 'the same as the old one');
  const before = chat.load().users.ana.hash;
  assert.ok(chat.setPass('Ana', 'old123', 'new123').ok);
  const u = chat.load().users.ana;
  assert.notEqual(u.hash, before, 'the hash changed');
  assert.ok(chat.login('Ana', 'new123').ok);
  assert.ok(chat.login('Ana', 'old123').error, 'the old password no longer works');
  assert.equal(chat.setPass('Nobody', 'a', 'b').error.includes('Account'), true);
});

test('logoutAll: the other sessions die, the current token stays alive', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const oldTok = chat.issueSession('Ana');
  const nowTok = chat.issueSession('Ana');
  const otherTok = chat.issueSession('Ben');
  chat.register('Ben', 'pass2');
  const r = chat.logoutAll('Ana', nowTok);
  assert.equal(r.revoked, 1, 'only Ana\'s other sessions were dropped');
  assert.equal(chat.userOf(oldTok), null);
  assert.ok(chat.userOf(nowTok), 'the current device is not kicked by itself');
  assert.ok(chat.userOf(otherTok), 'someone else\'s session is unaffected');
});

test('migrate: an old account without friends/blocked gets empty arrays', () => {
  const dir = fresh();
  chat.register('Ana', 'pass1');
  chat.flush();
  const file = path.join(dir, 'chat.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw.users.ana.friends;
  delete raw.users.ana.blocked;
  fs.writeFileSync(file, JSON.stringify(raw));
  chat.setPath(file); // re-read → the migration runs over the old data
  const u = chat.load().users.ana;
  assert.deepEqual(u.friends, [], 'friends is filled in during migrate');
  assert.deepEqual(u.blocked, [], 'blocked is filled in during migrate');
  assert.ok(chat.addFriend('Ana', 'Ana').error, 'yourself is still rejected');
  assert.equal(chat.people(null, 50, 'Ana').length, 1);
});

// ─── Live feeds (SSE) ───
// A fake sink records the frames [event, data]. Every test must release all its
// sinks before finishing — the sink map is module-global state.
function spy(tok) {
  const log = [];
  return { log, snk: { tok: tok || 'tok', send: (ev, data) => log.push([ev, data]), ping: () => {}, close: () => log.push([':closed', {}]) } };
}
const idOf = (name) => chat.findUser(name).id;
function release(...flat) { for (let i = 0; i + 1 < flat.length; i += 2) chat.detachSink(flat[i], flat[i + 1]); }

test('feeds: a global-room message goes to everyone, a DM only to its members', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cin', 'pass3');
  const a = spy(), b = spy(), c = spy();
  assert.ok(chat.attachSink(idOf('Ana'), a.snk), 'a feed is accepted');
  chat.attachSink(idOf('Ben'), b.snk);
  chat.attachSink(idOf('Cin'), c.snk);
  const dm = chat.ensureDm('Ana', 'Ben');
  assert.equal(a.log[0][0], 'room', 'a new DM is announced to its members');
  assert.equal(b.log[0][0], 'room');
  assert.equal(c.log.length, 0, 'an outsider knows nothing about the DM');
  a.log.length = 0; b.log.length = 0;
  chat.send('Ana', dm.id, 'psst');
  assert.deepEqual(a.log.map(x => x[0]), ['msg'], 'the sender gets it too (a second tab)');
  assert.equal(a.log[0][1].msg.t, 'psst');
  assert.equal(a.log[0][1].room, dm.id);
  assert.equal(b.log.length, 1, 'the partner receives it immediately');
  assert.equal(c.log.length, 0, 'the DM content never leaks to others');
  chat.send('Ana', 'global_am', 'hello');
  assert.equal(c.log.length, 1, 'the global room goes to every connected client');
  assert.equal(b.log.length, 2);
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk, idOf('Cin'), c.snk);
});

test('feeds: edits, reactions and deletes are broadcast to the room members', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  const dm = chat.ensureDm('Ana', 'Ben');
  const id = chat.send('Ana', dm.id, 'origin').msg.id;
  a.log.length = 0; b.log.length = 0;
  chat.react('Ben', dm.id, id, '👍');
  assert.deepEqual(b.log.map(x => x[0]), ['react'], 'the reaction reaches the other tab');
  assert.equal(b.log[0][1].msg.rx['👍'], 1);
  assert.equal(chat.edit('Ana', dm.id, id, 'fixed').ok, true);
  assert.deepEqual(a.log.map(x => x[0]).slice(-1), ['edit'], 'the sender gets the newest copy');
  assert.equal(a.log[a.log.length - 1][1].msg.t, 'fixed');
  a.log.length = 0; b.log.length = 0;
  chat.remove('Ana', dm.id, id);
  assert.deepEqual(b.log, [['del', { room: dm.id, id }]], 'the delete carries the id + room');
  assert.equal(a.log.length, 1);
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

test('feeds: typing sends the current list, a message stops it', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  const dm = chat.ensureDm('Ana', 'Ben');
  a.log.length = 0; b.log.length = 0;
  chat.setTyping('Ben', dm.id);
  assert.equal(a.log[0][0], 'typing', 'Ana sees Ben typing immediately');
  assert.deepEqual(a.log[0][1].typing, ['ben'], 'the same shape as the poll');
  assert.equal(b.log[0][1].typing[0], 'ben', 'the sender tab gets the same list too');
  chat.send('Ben', dm.id, 'done');
  const lastTyping = a.log.filter(x => x[0] === 'typing').pop();
  assert.deepEqual(lastTyping[1].typing, [], 'sending clears typing');
  assert.equal(a.log.filter(x => x[0] === 'msg').length, 1, 'the message is only one frame');
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

test('feeds: social changes are only announced to the tab owner', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  chat.addFriend('Ana', 'Ben');
  assert.deepEqual(a.log.map(x => x[0]), ['social'], 'the Ana tab is reloaded');
  assert.equal(b.log.length, 0, 'Ben is not told about the new friendship');
  chat.blockUser('Ana', 'Ben');
  assert.equal(b.log.length, 0, 'the blocked victim gets NOTHING');
  chat.unblockUser('Ana', 'Ben');
  assert.equal(a.log.length, 3);
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

test('feeds: the per-account connection cap + kicking only the other devices', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const id = idOf('Ana'), spies = [];
  for (let i = 0; i < chat.MAX_STREAMS; i++) { const s = spy('k' + i); spies.push(s); assert.ok(chat.attachSink(id, s.snk), 'feed ' + i); }
  const extra = spy('extra');
  assert.equal(chat.attachSink(id, extra.snk), false, 'past MAX_STREAMS is rejected');
  assert.equal(chat.kickSinks(id, 'k2'), chat.MAX_STREAMS - 1, 'the current token is kept');
  assert.equal(spies.filter(s => s.log.some(x => x[0] === 'kick')).length, chat.MAX_STREAMS - 1);
  assert.equal(spies[2].log.length, 0, 'the current device is not kicked');
  for (const s of spies) chat.detachSink(id, s.snk);
});

test('feeds: the beat only reports presence changes', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy();
  chat.attachSink(idOf('Ana'), a.snk);
  chat.userOf(chat.issueSession('Ben'));
  chat.tickBeat();
  assert.equal(a.log.length, 0, 'the first beat only records the baseline state');
  chat.load().users.ben.lastSeen = Date.now() - 999e3;   // Ben is silent > ONLINE_MS
  chat.tickBeat();
  const ev = a.log.find(x => x[0] === 'presence');
  assert.ok(ev, 'the presence change is announced');
  assert.deepEqual(ev[1], { id: idOf('Ben'), online: false });
  a.log.length = 0;
  chat.tickBeat();
  assert.equal(a.log.filter(x => x[0] === 'presence').length, 0, 'the same state → no frame');
  release(idOf('Ana'), a.snk);
});

test('feeds: dropSink closes only the tab of that token', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a1 = spy('a1'), a2 = spy('a2'), b1 = spy('b1');
  chat.attachSink(idOf('Ana'), a1.snk); chat.attachSink(idOf('Ana'), a2.snk); chat.attachSink(idOf('Ben'), b1.snk);
  assert.equal(chat.dropSink('a1'), 1, 'exactly one tab was kicked');
  assert.ok(a1.log.some(x => x[0] === ':closed'));
  assert.equal(a2.log.length + b1.log.length, 0, 'the other tabs are untouched');
  release(idOf('Ana'), a2.snk, idOf('Ben'), b1.snk);
});

test('feeds: a sink that fails to write is dropped during the beat', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const id = idOf('Ana');
  let closed = 0;
  const brokenSink = { tok: 'broken', send: () => { throw new Error('stream destroyed'); }, ping: () => { throw new Error('stream destroyed'); }, close: () => { closed++; } };
  assert.ok(chat.attachSink(id, brokenSink), 'a broken sink is accepted at first');
  chat.tickBeat();
  assert.equal(closed, 1, 'the broken sink is closed after the beat');
  const full = [];
  for (let i = 0; i < chat.MAX_STREAMS; i++) { const s = spy('p' + i); assert.ok(chat.attachSink(id, s.snk), 'slot ' + i + ' is free again'); full.push(s); }
  assert.equal(chat.attachSink(id, spy('extra').snk), false, 'the MAX_STREAMS cap is still respected');
  for (const s of full) chat.detachSink(id, s.snk);
});

test('read receipt: a DM markSeen broadcasts read only to the partner', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ana', dm.id, 'one'); chat.send('Ana', dm.id, 'two');
  a.log.length = 0; b.log.length = 0;
  chat.markSeen('Ben', dm.id);
  const rd = a.log.find(x => x[0] === 'read');
  assert.ok(rd, 'the sender (Ana) gets read when Ben reads');
  assert.equal(rd[1].room, dm.id);
  assert.equal(rd[1].seq, 2, 'the last seq that was read');
  assert.equal(b.log.filter(x => x[0] === 'read').length, 0, 'the reader never gets their own read');
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

// ─── Video/audio call signalling (WebRTC) ───
// Mounted on a fake Express: collect the handlers, then run the middleware chain.
function mountRoutes() {
  const routes = {};
  const app = { get: (p, ...h) => { routes['G ' + p] = h; }, post: (p, ...h) => { routes['P ' + p] = h; } };
  chat.mount(app, {});
  return routes;
}
function hit(routes, key, req) {
  const hs = routes[key] || [];
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
  let i = 0;
  const next = () => { const h = hs[i++]; if (h) h(req, res, next); };
  next();
  return res;
}
const reqOf = (tok, body) => ({ headers: { authorization: 'Bearer ' + tok }, body: body || {}, query: {}, on() {}, socket: null });
const reqGet = (tok, query) => ({ headers: { authorization: 'Bearer ' + tok }, body: {}, query: query || {}, on() {}, socket: null });

test('call: signals are relayed to the partner only + misuse is rejected', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  const tok = chat.issueSession('Ana');

  let r = hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ben'), ev: 'ring', data: { kind: 'video' } }));
  assert.equal(r.code, 200);
  assert.equal(r.body.delivered, true, 'the partner is connected → delivered');
  const got = b.log.find(x => x[0] === 'call');
  assert.ok(got, 'Ben receives the call signal');
  assert.equal(got[1].ev, 'ring');
  assert.equal(got[1].from, idOf('Ana'));
  assert.equal(got[1].data.kind, 'video', 'the call kind travels with it');
  assert.equal(a.log.filter(x => x[0] === 'call').length, 0, 'the caller does not receive it back');

  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ben'), ev: 'hack' })).code, 400, 'an unknown signal');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ana'), ev: 'ring' })).code, 400, 'calling yourself');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: 999999, ev: 'ring' })).code, 400, 'a nonexistent user');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf('fake', { to: idOf('Ben'), ev: 'ring' })).code, 401, 'login required');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ben'), ev: 'ice', data: { big: 'x'.repeat(20000) } })).code, 413, 'the packet is too large');

  chat.blockUser('Ben', 'Ana');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ben'), ev: 'ring' })).code, 403, 'blocked → rejected');
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

test('call: delivered=false when the partner has no feed (offline)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const a = spy();
  chat.attachSink(idOf('Ana'), a.snk);
  const r = hit(routes, 'P /api/chat/call', reqOf(chat.issueSession('Ana'), { to: idOf('Ben'), ev: 'ring' }));
  assert.equal(r.code, 200);
  assert.equal(r.body.delivered, false, 'Ben has no connection');
  release(idOf('Ana'), a.snk);
});

// ─── Message search (history search) ───
test('search: empty results for a query shorter than 2 characters', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const r = hit(routes, 'G /api/chat/search', reqGet(tok, { q: 'a' }));
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.results, [], '1 character → no results');
});

test('search: 401 without a valid token', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const r = hit(routes, 'G /api/chat/search', reqGet('fake', { q: 'hello' }));
  assert.equal(r.code, 401);
});

test('search: finds messages in the global room by query (case-insensitive)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.send('Ana', 'global_am', 'The Tukuk-OS project is nearly done');
  chat.send('Ben', 'global_am', 'Another project is running too');
  chat.send('Ana', 'global_am', 'Programming session tonight');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ben');
  const r = hit(routes, 'G /api/chat/search', reqGet(tok, { q: 'PROJECT' }));
  assert.equal(r.code, 200);
  assert.equal(r.body.results.length, 2, 'two messages contain "project"');
  assert.ok(r.body.results.every(x => /project/i.test(x.t)));
});

test('search: never returns DM messages from rooms you are not a member of', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const dm = chat.ensureDm(chat.findUser('Ana'), chat.findUser('Ben'));
  chat.send('Ana', dm.id, 'a secret between ana and ben');
  const routes = mountRoutes();
  const r = hit(routes, 'G /api/chat/search', reqGet(chat.issueSession('Cia'), { q: 'secret' }));
  assert.equal(r.code, 200);
  assert.equal(r.body.results.length, 0, 'Cia is not a DM member — nothing visible');
});

test('search: newest first and carries roomTitle + from', () => {
  fresh();
  chat.register('Ana', 'pass1');
  chat.send('Ana', 'global_am', 'hello old');
  chat.send('Ana', 'global_am', 'hello new');
  const routes = mountRoutes();
  const r = hit(routes, 'G /api/chat/search', reqGet(chat.issueSession('Ana'), { q: 'hello' }));
  assert.equal(r.code, 200);
  const list = r.body.results;
  assert.ok(list.length >= 2);
  assert.ok(list[0].ts >= list[1].ts, 'newest first');
  assert.ok(list[0].roomTitle, 'roomTitle is present');
  assert.equal(list[0].from, 'Ana', 'the sender name is present');
});

// ─── Group rooms ───
test('createGroup: creates a room with the right members', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const r = chat.createGroup('Ana', 'Class 5A', [idOf('Ben'), idOf('Cia')]);
  assert.ok(r.ok);
  assert.equal(r.room.kind, 'group');
  assert.equal(r.room.title, 'Class 5A');
  assert.equal(r.room.memberIds.length, 3, 'Ana + Ben + Cia');
  assert.ok(r.room.memberIds.includes(idOf('Ana')));
});

test('createGroup: no name or fewer than 2 members is rejected', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.ok(chat.createGroup('Ana', '', [idOf('Ben')]).error, 'no name');
  assert.ok(chat.createGroup('Ana', 'X', []).error, 'no other members');
});

test('canRead + roomTitle: only members can read, the name comes back directly', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const grp = chat.createGroup('Ana', 'Coffee Shop', [idOf('Ben')]).room;
  assert.ok(chat.canRead('Ana', grp.id));
  assert.ok(chat.canRead('Ben', grp.id));
  assert.ok(!chat.canRead('Cia', grp.id), 'not a member');
  assert.equal(chat.roomTitle(grp, 'Ana'), 'Coffee Shop');
});

test('send in a group: the message appears for every member', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'Group', [idOf('Ben')]).room;
  const r = chat.send('Ana', grp.id, 'hi everyone');
  assert.ok(r.ok);
  const list = chat.since('Ben', grp.id, 0).msgs;
  assert.equal(list.length, 1);
  assert.equal(list[0].t, 'hi everyone');
});

test('addToGroup: adds a member, an existing member → already, an outsider → error', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3'); chat.register('Din', 'pass4');
  const grp = chat.createGroup('Ana', 'Group', [idOf('Ben')]).room;
  assert.ok(chat.addToGroup('Ana', grp.id, idOf('Cia')).ok);
  assert.equal(grp.memberIds.length, 3);
  assert.ok(chat.addToGroup('Ana', grp.id, idOf('Ben')).already, 'already a member → already');
  assert.ok(chat.addToGroup('Din', grp.id, idOf('Cia')).error, 'Din is not a member → rejected');
});

test('leaveGroup: a member can leave on their own, a non-member → error', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const grp = chat.createGroup('Ana', 'Group', [idOf('Ben'), idOf('Cia')]).room;
  assert.ok(chat.leaveGroup('Cia', grp.id).ok);
  assert.ok(!grp.memberIds.includes(idOf('Cia')), 'Cia has left');
  assert.ok(chat.leaveGroup('Cia', grp.id).error, 'no longer a member');
});

test('POST /api/chat/group: the endpoint returns the room, rejects an invalid body', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const r = hit(routes, 'P /api/chat/group', reqOf(tok, { title: 'Test', memberIds: [idOf('Ben')] }));
  assert.equal(r.code, 200);
  assert.ok(r.body.ok);
  assert.equal(r.body.room.kind, 'group');
  assert.equal(r.body.room.memberCount, 2);
  const r2 = hit(routes, 'P /api/chat/group', reqOf(tok, { title: '', memberIds: [idOf('Ben')] }));
  assert.equal(r2.code, 400, 'no name → 400');
  assert.equal(hit(routes, 'P /api/chat/group', reqOf('fake', { title: 'X', memberIds: [idOf('Ben')] })).code, 401);
});

// ─── Web Push ───
test('vapid key: GET /api/chat/vapid-public-key returns a base64url key', () => {
  fresh();
  const routes = mountRoutes();
  const r = hit(routes, 'G /api/chat/vapid-public-key', reqGet('x', {}));
  assert.equal(r.code, 200);
  assert.ok(typeof r.body.key === 'string' && r.body.key.length > 40);
});

test('push-subscribe: saves a subscription, 401 without a token', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const sub = { endpoint: 'https://example.com/push/abc', keys: { p256dh: 'x', auth: 'y' } };
  const r = hit(routes, 'P /api/chat/push-subscribe', reqOf(tok, sub));
  assert.equal(r.code, 200);
  assert.ok(r.body.ok);
  assert.equal(hit(routes, 'P /api/chat/push-subscribe', reqOf('fake', sub)).code, 401);
  assert.equal(hit(routes, 'P /api/chat/push-subscribe', reqOf(tok, {})).code, 400, 'no endpoint → 400');
});

test('push-unsubscribe: drops a subscription by endpoint', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const ep = 'https://example.com/push/xyz';
  hit(routes, 'P /api/chat/push-subscribe', reqOf(tok, { endpoint: ep, keys: { p256dh: 'a', auth: 'b' } }));
  const r = hit(routes, 'P /api/chat/push-unsubscribe', reqOf(tok, { endpoint: ep }));
  assert.equal(r.code, 200);
  const s = chat.load();
  const uid = String(idOf('Ana'));
  assert.ok(!(s.pushSubs[uid] || []).find(x => x.endpoint === ep), 'it was dropped');
});

test('derSigToRaw: an EC P-256 DER signature → 64 bytes', () => {
  const crypto = require('crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const der = crypto.sign('sha256', Buffer.from('test'), privateKey);
  const raw = chat.derSigToRaw(der);
  assert.equal(raw.length, 64, 'ES256 = 64 bytes');
  assert.ok(Buffer.isBuffer(raw));
  // Verify r || s round-trip is correct
  const verified = crypto.verify('sha256', Buffer.from('test'), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw);
  assert.ok(verified, 'the raw signature is valid — verify passes');
});

// ─── Voice messages (audio) ───
test('addMedia: ogg is detected as audio without a client flag', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const u = chat.findUser('Ana');
  const ogg = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(24)]);
  const r = chat.addMedia(u, ogg, {});
  assert.ok(r.ok);
  assert.equal(r.media.kind, 'audio');
  assert.equal(r.media.mime, 'audio/ogg');
});

test('addMedia: webm + audio=1 flag → audio; no flag → video', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const u = chat.findUser('Ana');
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(24)]);
  const a = chat.addMedia(u, webm, { audio: '1' });
  assert.equal(a.media.kind, 'audio', 'the client flag decides the kind');
  assert.equal(a.media.mime, 'audio/webm', 'the video/webm mime becomes audio/webm');
  const v = chat.addMedia(u, webm, {});
  assert.equal(v.media.kind, 'video', 'no flag → video');
});

// ─── Pinned messages ───
test('pinMsg: toggling a pin in the global room + a nonexistent message → error', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const id = chat.send('Ana', 'global_am', 'important').msg.id;
  assert.equal(chat.pinMsg('Ana', 'global_am', id, true).pinned, true);
  assert.equal(chat.pinMsg('Ana', 'global_am', id, false).pinned, false);
  assert.ok(chat.pinMsg('Ana', 'global_am', 'no-such-msg', true).error);
});

test('pinMsg: in a group only an admin can pin', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'Group', [idOf('Ben')]).room;
  const id = chat.send('Ben', grp.id, 'plain').msg.id;
  assert.ok(chat.pinMsg('Ben', grp.id, id, true).error, 'not an admin → rejected');
  assert.ok(chat.pinMsg('Ana', grp.id, id, true).ok, 'admin → passes');
});

// ─── Group administration ───
test('renameGroup: an admin can rename, a non-admin + an empty name are rejected', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'Old', [idOf('Ben')]).room;
  assert.ok(chat.renameGroup('Ben', grp.id, 'Hack').error, 'not an admin');
  assert.equal(chat.renameGroup('Ana', grp.id, 'New').title, 'New');
  assert.ok(chat.renameGroup('Ana', grp.id, '   ').error, 'an empty name');
});

test('addAdmin + kickFromGroup: promote/demote an admin, remove a member', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const grp = chat.createGroup('Ana', 'Group', [idOf('Ben'), idOf('Cia')]).room;
  assert.ok(!chat.isGroupAdmin(grp, 'Ben'));
  chat.addAdmin('Ana', grp.id, idOf('Ben'), false);
  assert.ok(chat.isGroupAdmin(grp, 'Ben'), 'Ben became an admin');
  chat.addAdmin('Ana', grp.id, idOf('Ben'), true);
  assert.ok(!chat.isGroupAdmin(grp, 'Ben'), 'Ben was demoted');
  assert.ok(chat.kickFromGroup('Ana', grp.id, idOf('Cia')).ok);
  assert.ok(!grp.memberIds.includes(idOf('Cia')), 'Cia was removed');
  assert.ok(chat.kickFromGroup('Ana', grp.id, idOf('Ana')).error, 'removing yourself → use leave instead');
});

test('leaveGroup: an admin leaving promotes another member; everyone leaving dissolves it', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'Group', [idOf('Ben')]).room;
  const r = chat.leaveGroup('Ana', grp.id);
  assert.ok(r.ok && !r.dissolved, 'Ben is still there → not dissolved');
  assert.ok(chat.isGroupAdmin(grp, 'Ben'), 'Ben is promoted to admin');
  const r2 = chat.leaveGroup('Ben', grp.id);
  assert.ok(r2.ok && r2.dissolved, 'the last member → dissolved');
  assert.ok(!chat.load().rooms[grp.id], 'the room is gone');
});

test('dissolveBy: only the creator can dissolve it while the creator is present', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'K', [idOf('Ben')]).room;
  chat.addAdmin('Ana', grp.id, idOf('Ben'), false);   // Ben is an admin but not the creator
  assert.ok(chat.dissolveBy('Ben', grp.id).error, 'not the creator → rejected');
  const r = chat.dissolveBy('Ana', grp.id);
  assert.ok(r.ok && r.dissolved);
  assert.ok(!chat.load().rooms[grp.id], 'the group was dissolved');
});

// ─── Account deletion ───
test('deleteAccount: a wrong password is rejected; the right one → the account + DM are removed', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ana', dm.id, 'hi');
  assert.ok(chat.deleteAccount('Ana', 'wrong').error, 'a wrong password');
  assert.ok(chat.deleteAccount('Ana', 'pass1').ok);
  assert.ok(!chat.findUser('Ana'), 'Ana is gone');
  assert.ok(!chat.load().rooms[dm.id], 'the DM was dropped');
});

test('deleteAccount: their own groups are dissolved, other memberships are cleaned up', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const anaId = idOf('Ana');
  const own = chat.createGroup('Ana', 'Owned By Ana', [idOf('Ben')]).room;
  const other = chat.createGroup('Ben', 'Owned By Ben', [anaId, idOf('Cia')]).room;
  assert.ok(chat.deleteAccount('Ana', 'pass1').ok);
  assert.ok(!chat.load().rooms[own.id], 'Ana\'s own group is dissolved');
  assert.ok(chat.load().rooms[other.id], 'someone else\'s group survives');
  assert.ok(!other.memberIds.includes(anaId), 'Ana was removed from the members');
});

// ─── New HTTP routes ───
test('POST /api/chat/pin: login required + pin toggle', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const id = chat.send('Ana', 'global_am', 'x').msg.id;
  assert.equal(hit(routes, 'P /api/chat/pin', reqOf('fake', { room: 'global_am', id })).code, 401);
  const r = hit(routes, 'P /api/chat/pin', reqOf(tok, { room: 'global_am', id, pinned: true }));
  assert.equal(r.code, 200);
  assert.equal(r.body.pinned, true);
});

test('POST group/rename + admin + kick through the routes', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const grp = chat.createGroup('Ana', 'Old', [idOf('Ben')]).room;
  let r = hit(routes, 'P /api/chat/group/rename', reqOf(tok, { room: grp.id, title: 'New' }));
  assert.equal(r.code, 200); assert.equal(r.body.title, 'New');
  r = hit(routes, 'P /api/chat/group/admin', reqOf(tok, { room: grp.id, memberId: idOf('Ben') }));
  assert.equal(r.code, 200); assert.ok(r.body.admins.includes(idOf('Ben')));
  r = hit(routes, 'P /api/chat/group/kick', reqOf(tok, { room: grp.id, memberId: idOf('Ben') }));
  assert.equal(r.code, 200); assert.ok(r.body.dissolved, 'only one member left → dissolved');
});

test('POST /api/chat/delete-account: a password + a session are required', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  assert.equal(hit(routes, 'P /api/chat/delete-account', reqOf(tok, { pass: 'wrong' })).code, 401, 'a wrong password → 401');
  assert.equal(hit(routes, 'P /api/chat/delete-account', reqOf('fake', { pass: 'pass1' })).code, 401, 'no session → 401');
  const r = hit(routes, 'P /api/chat/delete-account', reqOf(tok, { pass: 'pass1' }));
  assert.equal(r.code, 200); assert.ok(r.body.ok);
  assert.ok(!chat.findUser('Ana'));
});

// ─── Social layer: follows, posts, stories, notifications, avatars ───
const reqGP = (tok, query, params) => ({ headers: { authorization: 'Bearer ' + tok }, body: {}, query: query || {}, params: params || {}, on() {}, socket: null });

function mkJpg(user) {
  const r = chat.addMedia(user, JPG, {});
  assert.ok(r.ok, 'upload a jpg for the test');
  return r.media.id;
}

test('follow: both sides, a repeat toggle, yourself and a block are rejected', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.ok(chat.followUser('Ana', 'Ben').ok);
  assert.ok(chat.isFollowing(chat.findUser('Ana'), chat.findUser('Ben')));
  assert.equal(chat.findUser('Ben').followers.length, 1, 'followers are synced on both sides');
  assert.ok(chat.followUser('Ana', 'Ben').already, 'following twice → already');
  assert.ok(chat.followUser('Ana', 'Ana').error, 'yourself is rejected');
  assert.ok(chat.followUser('Ana', 'nobody').error, 'a nonexistent name is rejected');
  chat.blockUser('Ana', 'Ben');
  assert.ok(chat.followUser('Ana', 'Ben').error, 'a blocked user → rejected');
  chat.unblockUser('Ana', 'Ben');
  assert.ok(chat.unfollowUser('Ana', 'Ben').ok);
  assert.equal(chat.findUser('Ben').followers.length, 0, 'unfollowing empties both sides');
});

test('profile: carries the avatar, the follow count and the following/followsMe flags', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const ana = chat.findUser('Ana');
  assert.ok(chat.setAvatar(ana, mkJpg(ana)).ok);
  chat.followUser('Ben', 'Ana');
  const p = chat.profile('Ana', 'Ben');
  assert.ok(p.avatar.includes('/api/chat/avatar/'), 'a public avatar with no signature');
  assert.equal(p.followersCount, 1);
  assert.equal(p.following, true, 'Ben (the viewer) already follows Ana');
  assert.equal(p.followsMe, false, 'Ana does not follow Ben');
  assert.equal(chat.profile('Ana', 'Ana').following, false, 'yourself is always false');
  assert.ok(chat.removeAvatar('Ana').ok);
  assert.equal(chat.profile('Ana').avatar, null);
});

test('setAvatar: not yours / not an image are rejected', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const mid = mkJpg(chat.findUser('Ben'));
  assert.ok(chat.setAvatar(chat.findUser('Ana'), mid).error, 'a file owned by someone else → rejected');
  const vid = chat.addMedia(chat.findUser('Ana'), Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]), {});
  assert.ok(chat.setAvatar(chat.findUser('Ana'), vid.media.id).error, 'a video is not an image → rejected');
});

test('post: create/like/comment + the follower feed publishes, a blocked author is hidden', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3'); chat.register('Dan', 'pass4');
  assert.ok(chat.createPost('Ana', '   ').error, 'an empty post is rejected');
  const p = chat.createPost('Ana', 'hello world').post;
  assert.ok(p.id && p.t === 'hello world');
  assert.equal(chat.createPost('Dan', 'x'.repeat(900)).post.t.length, 500, 'it truncates at MAX_POST');
  chat.followUser('Ben', 'Ana');
  const f = chat.feedFor('Ben');
  assert.equal(f.posts.length, 1, 'a follower sees the post');
  assert.equal(chat.feedFor('Cia').posts.length, 0, 'an outsider does not');
  assert.equal(chat.feedFor('Ana').posts.length, 1, 'the author sees their own post');
  assert.ok(chat.likePost('Ben', p.id).liked, 'the first like is active');
  assert.equal(chat.likePost('Ben', p.id).liked, false, 'liking twice → toggles off');
  assert.ok(chat.commentPost('Cia', p.id, '  ').error, 'an empty comment is rejected');
  const c = chat.commentPost('Ben', p.id, 'great');
  assert.equal(c.post.comments.length, 1);
  assert.equal(c.post.comments[0].from, 'Ben');
  assert.ok(chat.delPost('Ben', p.id).error, 'not the owner → delete rejected');
  chat.blockUser('Ana', 'Ben');
  assert.equal(chat.feedFor('Ben').posts.length, 0, 'the author blocks → the post leaves the feed');
});

test('post media: only your own attachments + a hydrated url', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const ana = chat.findUser('Ana');
  const mid = mkJpg(ana);
  assert.ok(chat.createPost('Ben', 'steal', [mid]).error, 'a file owned by someone else cannot be attached');
  const p = chat.createPost('Ana', 'has a picture', [mid]).post;
  assert.equal(p.media.length, 1);
  assert.ok(p.media[0].url && p.media[0].url.includes('/api/chat/media/'), 'the HMAC url is present in the view');
  assert.ok(chat.delPost('Ana', p.id).ok);
  assert.equal(chat.load().media[mid], undefined, 'a deleted post → the file is released');
});

test('notif: like/comment/follow/mention arrive; a block and your own do not', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const p = chat.createPost('Ana', 'my project').post;
  assert.equal(chat.pushNotif('Ana', 'fake', {}), undefined, 'an unknown type is ignored');
  chat.likePost('Ben', p.id);
  chat.commentPost('Ben', p.id, 'the best');
  chat.followUser('Cia', 'Ana');
  chat.likePost('Ana', p.id); // your own like → no notif
  let n = chat.notifList('Ana');
  assert.equal(n.notifs.length, 3, 'like + comment + follow');
  assert.equal(n.unread, 3);
  assert.ok(n.notifs.every(x => x.actorName));
  chat.blockUser('Ben', 'Ana');
  chat.pushNotif('Ana', 'like', { actor: chat.findUser('Ben').id, post: p.id });
  assert.equal(chat.notifList('Ana').notifs.filter(x => x.type === 'like').length, 1, 'a blocker does not get through to the notifs');
  chat.createPost('Cia', 'hello @Ana and @999999');
  assert.ok(chat.notifList('Ana').notifs.some(x => x.type === 'mention'), 'an @name mention → notif');
  assert.ok(chat.markNotifRead('Ana').ok);
  assert.equal(chat.notifList('Ana').unread, 0);
  assert.ok(chat.clearNotifs('Ana').ok);
  assert.equal(chat.notifList('Ana').notifs.length, 0);
});

test('story: active for 24 hours, expires when it ends, only the author can delete', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.ok(chat.createStory('Ana', '  ').error, 'an empty story is rejected');
  const st = chat.createStory('Ana', 'morning').story;
  chat.followUser('Ben', 'Ana');
  assert.equal(chat.storiesOf('Ben').length, 1, 'a follower sees the story');
  assert.equal(chat.storiesOf('Ana')[0].mine, true, 'your own is flagged');
  assert.ok(chat.viewStory('Ben', st.id).ok);
  assert.equal(chat.load().stories[st.id].views.length, 1);
  assert.ok(chat.delStory('Ben', st.id).error, 'not the owner → rejected');
  chat.load().stories[st.id].ts = Date.now() - chat.STORY_TTL - 1000;
  chat.pruneStories();
  assert.equal(chat.storiesOf('Ben').length, 0, 'gone after 24 hours');
  assert.equal(chat.load().stories[st.id], undefined, 'the record was pruned away');
});

test('sweep: media of an expired story is released from the store', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const mid = mkJpg(chat.findUser('Ana'));
  const st = chat.createStory('Ana', 'picture', [mid]).story;
  assert.ok(chat.load().media[mid], 'the media is attached to the story');
  chat.load().stories[st.id].ts = Date.now() - chat.STORY_TTL - 1000;
  chat.flush(); // run the internal cleanup through sweep (setInterval is hard to wait for)
  // call prune directly (sweep uses it too)
  chat.pruneStories();
  assert.equal(chat.load().media[mid], undefined, 'the expired story file is removed');
});

test('deleteAccount: posts/stories/notifs/follows are cleaned up on both sides', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const anaId = idOf('Ana');
  chat.followUser('Ben', 'Ana');
  chat.followUser('Ana', 'Cia');
  const p = chat.createPost('Ana', 'goodbye').post;
  chat.commentPost('Ben', p.id, 'rip');
  chat.likePost('Cia', p.id);
  chat.createStory('Ana', 'story');
  assert.ok(chat.deleteAccount('Ana', 'pass1').ok);
  assert.equal(Object.keys(chat.load().posts).length, 0, 'no posts from Ana are left');
  assert.equal(Object.keys(chat.load().stories).length, 0, 'no stories from Ana are left');
  assert.equal(chat.findUser('Ben').followers.length, 0, 'Ana is removed from the followers of Ben');
  assert.equal(chat.findUser('Cia').following.length, 0, 'Ana is removed from the following of Cia');
  assert.equal(chat.notifList('Cia').notifs.length, 0, 'notifs to/from Ana are released');
});

// ─── Social HTTP routes ───
test('P /api/chat/follow + G /feed + /posts/:id through the routes', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tokA = chat.issueSession('Ana'), tokB = chat.issueSession('Ben');
  assert.equal(hit(routes, 'P /api/chat/follow', reqOf(tokB, { peer: 'Ana' })).code, 200);
  assert.equal(hit(routes, 'P /api/chat/follow', reqOf(tokB, { peer: 'Ana' })).code, 400, 'following twice → 400');
  let r = hit(routes, 'P /api/chat/posts', reqOf(tokA, { text: 'hi' }));
  assert.equal(r.code, 200);
  const pid = r.body.post.id;
  r = hit(routes, 'G /api/chat/feed', reqGet(tokB, {}));
  assert.equal(r.code, 200); assert.equal(r.body.posts.length, 1);
  r = hit(routes, 'P /api/chat/posts/like', reqOf(tokB, { id: pid }));
  assert.equal(r.code, 200); assert.equal(r.body.liked, true);
  r = hit(routes, 'P /api/chat/posts/comment', reqOf(tokB, { id: pid, text: 'ok' }));
  assert.equal(r.code, 200); assert.equal(r.body.post.comments.length, 1);
  r = hit(routes, 'G /api/chat/posts/:id', reqGP(tokB, {}, { id: pid }));
  assert.equal(r.code, 200); assert.equal(r.body.post.id, pid);
  r = hit(routes, 'G /api/chat/posts/:id', reqGP(tokB, {}, { id: 'xxxxxxxxxxxx' }));
  assert.equal(r.code, 404, 'a missing post → 404');
  r = hit(routes, 'P /api/chat/posts', reqOf(tokB, { text: 'I follow back' }));
  assert.equal(r.code, 200);
  assert.equal(hit(routes, 'G /api/chat/notifs', reqGet(tokA, {})).body.notifs.length, 3, 'follow+like+comment land in the notifs');
});

test('G /api/chat/follows + /discover: two-way lists + suggestions', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  chat.followUser('Ana', 'Ben');
  const routes = mountRoutes();
  const tok = chat.issueSession('Cia');
  let r = hit(routes, 'G /api/chat/follows', reqGet(tok, { q: 'Ben', which: 'followers' }));
  assert.equal(r.code, 200); assert.equal(r.body.list.length, 1); assert.equal(r.body.list[0].name, 'Ana');
  r = hit(routes, 'G /api/chat/follows', reqGet(tok, { q: 'Ana', which: 'following' }));
  assert.equal(r.body.list.length, 1); assert.equal(r.body.list[0].name, 'Ben');
  r = hit(routes, 'G /api/chat/discover', reqGet(tok, {}));
  assert.equal(r.code, 200);
  assert.equal(r.body.people.length, 2, 'Cia follows nobody yet → Ana + Ben are suggested (yourself is excluded)');
  chat.followUser('Cia', 'Ana');
  r = hit(routes, 'G /api/chat/discover', reqGet(tok, {}));
  assert.equal(r.body.people.length, 1, 'someone already followed is not suggested again');
  assert.equal(r.body.people[0].name, 'Ben');
});

test('P /api/chat/stories + notifs/read through the routes', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  chat.followUser('Ben', 'Ana');
  let r = hit(routes, 'P /api/chat/stories', reqOf(tok, { text: 'story of today' }));
  assert.equal(r.code, 200); assert.ok(r.body.story.id);
  r = hit(routes, 'G /api/chat/stories', reqGet(chat.issueSession('Ben'), {}));
  assert.equal(r.body.stories.length, 1);
  const p = hit(routes, 'P /api/chat/posts', reqOf(tok, { text: 'one' })).body.post;
  hit(routes, 'P /api/chat/posts/like', reqOf(chat.issueSession('Ben'), { id: p.id }));
  r = hit(routes, 'P /api/chat/notifs/read', reqOf(tok, {}));
  assert.equal(r.code, 200);
  assert.equal(hit(routes, 'G /api/chat/notifs', reqGet(tok, {})).body.unread, 0);
});

test('P /api/chat/poll + /poll/vote through the routes: the 📊 message + the results', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  assert.equal(hit(routes, 'P /api/chat/poll', reqOf('fake', { room: 'global_am', q: 'X', opts: ['a', 'b'] })).code, 401, 'login required');
  const r = hit(routes, 'P /api/chat/poll', reqOf(tok, { room: 'global_am', q: 'Pick a colour', opts: ['Red', 'Blue'] }));
  assert.equal(r.code, 200);
  assert.equal(r.body.msg.t, '📊 Pick a colour', 'the poll message carries the 📊 text');
  assert.equal(r.body.msg.pollId, r.body.poll.id, 'pollId is attached to the message');
  const tokB = chat.issueSession('Ben');
  const v = hit(routes, 'P /api/chat/poll/vote', reqOf(tokB, { id: r.body.poll.id, opt: 0 }));
  assert.equal(v.code, 200); assert.deepEqual(v.body.poll.counts, [1, 0]);
  assert.equal(hit(routes, 'P /api/chat/poll/vote', reqOf(tok, { id: 'missing', opt: 0 })).code, 400, 'voting for a fake id → 400');
  // read it back — the poll message must carry pollData through hydrate
  const g = hit(routes, 'G /api/chat/messages', reqGet(tok, { room: 'global_am', after: 0 }));
  const pm = g.body.msgs.find(m => m.pollId === r.body.poll.id);
  assert.ok(pm && pm.pollData, 'pollData is filled while reading');
  assert.deepEqual(pm.pollData.counts, [1, 0]);
});

test('P /api/chat/messages: a sticker is accepted, an empty message is still rejected', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const r = hit(routes, 'P /api/chat/messages', reqOf(tok, { room: 'global_am', text: '', sticker: '🥳' }));
  assert.equal(r.code, 200); assert.equal(r.body.msg.sticker, '🥳');
  assert.equal(hit(routes, 'P /api/chat/messages', reqOf(tok, { room: 'global_am', text: '' })).code, 400, 'truly empty → 400');
});

// ─── Hashtags & reposts (X style) ───
test('hashtag: tags are split, normalised and the feed can be filtered by tag', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const p1 = chat.createPost('Ana', 'the weather today #Sports and #sports plus #food').post;
  assert.deepEqual(p1.tags, ['sports', 'food'], 'lowercase tags + duplicates dropped');
  const many = chat.createPost('Ana', Array.from({ length: 12 }, (_, i) => '#tag' + i).join(' ')).post;
  assert.equal(many.tags.length, 8, 'a cap of 8 tags per post');
  const p2 = chat.createPost('Ana', 'a post without a token #12x still has #Valid').post;
  assert.deepEqual(p2.tags, ['valid'], 'a tag starting with a digit / too short is ignored');
  chat.followUser('Ana', 'Ana');
  const f = chat.feedFor('Ana', null, '#SPORTS');
  assert.equal(f.posts.length, 1, 'the #SPORTS tag → only post 1');
  assert.equal(f.posts[0].id, p1.id);
  assert.equal(chat.feedFor('Ana', null, 'nothing').posts.length, 0, 'a tag with no match → empty');
  assert.ok(chat.feedFor('Ana').posts.length >= 3, 'with no filter → everything comes back');
});

test('repost/quote: copies the original post + notif, repost-of-repost & attachments are rejected', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const orig = chat.createPost('Ana', 'good news #important').post;
  const rp = chat.createPost('Ben', 'worth reading', [], { rp: orig.id });
  assert.ok(rp.ok);
  assert.equal(rp.post.t, 'worth reading');
  assert.ok(rp.post.rpOf, 'a copy of the original post sticks to it');
  assert.equal(rp.post.rpOf.from, 'Ana');
  assert.equal(rp.post.rpOf.t, 'good news #important');
  assert.ok(chat.notifList('Ana').notifs.some(n => n.type === 'repost'), 'the original author gets a repost notif');
  assert.ok(chat.createPost('Ben', 'x', [], { rp: rp.post.id }).error, 'a repost of a repost → rejected');
  assert.ok(chat.createPost('Ben', '', [], { rp: 'nothing' }).error, 'a nonexistent original post → rejected');
  const jpg = chat.addMedia(chat.findUser('Ben'), JPG, {});
  assert.ok(chat.createPost('Ben', '', [jpg.media.id], { rp: orig.id }).error, 'repost + an attachment → rejected');
  // the original can still be liked/commented as usual; the repost shows up in a follower feed of Ben
  chat.followUser('Ana', 'Ben');
  assert.ok(chat.feedFor('Ana').posts.some(p => p.id === rp.post.id && p.rpOf), 'the feed carries rpOf');
});

test('repost: deleting the original post also drops the repost (no orphans)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const orig = chat.createPost('Ana', 'source').post;
  const rp = chat.createPost('Ben', 'a quote', [], { rp: orig.id }).post;
  assert.ok(chat.delPost('Ana', orig.id).ok);
  assert.equal(chat.load().posts[rp.id], undefined, 'the orphan repost is dropped too');
  assert.ok(chat.createPost('Ben', 'again', [], { rp: orig.id }).error, 'the original is gone → the repost is rejected');
});

test('P /api/chat/posts + G /api/chat/feed?tag= over the HTTP routes', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const r = hit(routes, 'P /api/chat/posts', reqOf(tok, { text: 'festive #party2026' }));
  assert.equal(r.code, 200); assert.deepEqual(r.body.post.tags, ['party2026']);
  const orig = r.body.post.id;
  const q = hit(routes, 'P /api/chat/posts', reqOf(tok, { text: 'this quote', repost: orig }));
  assert.equal(q.code, 200); assert.ok(q.body.post.rpOf, 'rpOf comes back through the route');
  const f = hit(routes, 'G /api/chat/feed', reqGet(tok, { tag: '#Party2026' }));
  assert.equal(f.code, 200); assert.equal(f.body.posts.length, 1, 'the tag filter works (case-insensitive)');
  assert.equal(f.body.posts[0].id, orig);
});

// ─── Room mentions @here/@all (Google Chat style) ───
test('@here/@all: group-room members get a notif, the author does not', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const ben = chat.findUser('Ben');
  const g = chat.createGroup('Ana', 'Project', [ben.id]);
  assert.ok(g.ok || g.room, 'the group was created');
  const rid = g.room.id;
  chat.send('Ana', rid, 'the meeting starts now @all');
  const bn = chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === rid);
  assert.equal(bn.length, 1, 'Ben gets the room-mention notif');
  assert.equal(chat.notifList('Ana').notifs.filter(x => x.room === rid).length, 0, 'the author is never notified about themselves');
  // the bare word semuanya is not a token — it must not be expanded
  const before = chat.notifList('Ben').notifs.length;
  chat.send('Ana', rid, 'that was all a misunderstanding');
  assert.equal(chat.notifList('Ben').notifs.length, before, 'the word semuanya (not a token) is ignored');
});

test('@here: a 10 minute cool-down — a second mention in the same room sends no notif', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const ben = chat.findUser('Ben');
  const g = chat.createGroup('Ana', 'Project', [ben.id]);
  chat.send('Ana', g.room.id, 'a call @here');
  chat.send('Ana', g.room.id, 'another call @here');
  const n = chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === g.room.id);
  assert.equal(n.length, 1, 'a second mention inside the cool-down → silent');
});

test('@all in the global room: only online users get the notif', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  chat.load().users.ben.lastSeen = Date.now();           // Ben is active
  chat.load().users.cia.lastSeen = Date.now() - 999e3;   // Cia has been quiet for a long time
  chat.send('Ana', 'global_am', 'an announcement @all');
  assert.ok(chat.notifList('Ben').notifs.some(x => x.type === 'mention' && x.room === 'global_am'), 'Ben (online) gets it');
  assert.equal(chat.notifList('Cia').notifs.filter(x => x.room === 'global_am').length, 0, 'Cia (offline) is not bothered');
});

// ─── @name inside room messages (not posts) ───
test('@name in a group room → a mention notif carrying the room', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const g = chat.createGroup('Ana', 'Project', [chat.findUser('Ben').id]);
  const rid = g.room.id;
  chat.send('Ana', rid, 'please review @Ben');
  const bn = chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === rid);
  assert.equal(bn.length, 1, 'Ben was mentioned → a room notif');
  assert.equal(bn[0].actor, chat.findUser('Ana').id, 'actor = Ana');
  chat.send('Ben', rid, 'ok @Ana');
  assert.ok(chat.notifList('Ana').notifs.some(x => x.type === 'mention' && x.room === rid && x.actor === chat.findUser('Ben').id), 'Ana gets a reply');
});

test('@name in the global room → a notif; a made-up name is ignored', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.send('Ana', 'global_am', 'hi @Ben and @fakeuser123');
  const mn = chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === 'global_am');
  assert.equal(mn.length, 1, 'Ben (a real user) gets the global room notif');
});

test('@name inside a DM is not duplicated (only group/global are processed)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ana', dm.id, 'a secret @Ben');
  assert.equal(chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === dm.id).length, 0, 'a DM does not use room-mention notifs');
});

// ─── ICE / TURN ───
test('iceConfig: STUN only without env; TURN + REST credentials when configured', () => {
  fresh();
  const crypto = require('crypto');
  const saved = { h: process.env.TURN_HOST, s: process.env.TURN_SECRET, p: process.env.TURN_PORT };
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  delete process.env.TURN_HOST; delete process.env.TURN_SECRET;
  let cfg = chat.iceConfig();
  assert.equal(cfg.turn, false, 'no env → no TURN');
  assert.equal(cfg.iceServers.length, 1);
  assert.ok(String(cfg.iceServers[0].urls[0]).startsWith('stun:'));
  process.env.TURN_HOST = '203.0.113.9'; process.env.TURN_SECRET = 'secret1234'; process.env.TURN_PORT = '3478';
  cfg = chat.iceConfig();
  assert.equal(cfg.turn, true, 'with env → TURN is switched on');
  assert.equal(cfg.iceServers.length, 2, 'STUN + TURN');
  const turn = cfg.iceServers[1];
  assert.ok(turn.urls.some(u => /^turn:203\.0\.113\.9:3478/.test(u)), 'the TURN URL has host+port');
  assert.match(turn.username, /^\d+:tukuk[0-9a-f]+$/, 'username "<exp>:tukuk<rand>"');
  const exp = Number(turn.username.split(':')[0]);
  assert.ok(exp > Math.floor(Date.now() / 1000), 'the expiry is in the future');
  assert.equal(turn.credential, crypto.createHmac('sha1', 'secret1234').update(turn.username).digest('base64'), 'the credential follows the coturn REST mechanism');
  restore('TURN_HOST', saved.h); restore('TURN_SECRET', saved.s); restore('TURN_PORT', saved.p);
});

test('G /api/chat/ice: 401 without a token; with a login → the iceServers list', () => {
  fresh(); chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  assert.equal(hit(routes, 'G /api/chat/ice', reqGet('fake', {})).code, 401);
  const r = hit(routes, 'G /api/chat/ice', reqGet(chat.issueSession('Ana'), {}));
  assert.equal(r.code, 200);
  assert.ok(Array.isArray(r.body.iceServers) && r.body.iceServers.length >= 1);
});

// ─── Account recovery (single-use emergency codes) ───
test('recoveryGenerate/Reset: 5 codes, single-use, a new password, sessions are dropped', () => {
  fresh();
  chat.register('Ana', 'secret1234');
  const g = chat.recoveryGenerate('Ana');
  assert.ok(g.ok); assert.equal(g.codes.length, 5); assert.equal(g.remaining, 5);
  const tok = chat.issueSession('Ana');
  const code = g.codes[0];
  assert.ok(chat.recoveryReset('Ana', code, 'mobile1234').ok);
  assert.ok(chat.recoveryReset('Ana', code, 'another1234').error, 'a single-use code → reusing it is rejected');
  assert.ok(chat.login('Ana', 'mobile1234').ok, 'the new password works');
  assert.ok(chat.login('Ana', 'secret1234').error, 'the old password is dead');
  assert.equal(chat.userOf(tok), null, 'all old sessions are removed');
  assert.equal(chat.load().users.ana.rec.length, 4, '4 codes are left');
});

test('recoveryReset: a wrong code/name + a short password are rejected', () => {
  fresh();
  chat.register('Ana', 'secret1234');
  chat.recoveryGenerate('Ana');
  assert.ok(chat.recoveryReset('Ana', 'ZZZZZZZZZZ', 'newpass1234').error, 'a wrong code');
  assert.ok(chat.recoveryReset('Nobody', 'A1B2C3D4E5', 'newpass1234').error, 'no such name');
  const g = chat.recoveryGenerate('Ana').codes[0];
  assert.ok(chat.recoveryReset('Ana', g, '123').error, 'a password shorter than 4 characters');
});

test('P /api/chat/recovery/generate needs a login; /reset without a login returns a token', () => {
  fresh();
  chat.register('Ana', 'secret1234');
  const routes = mountRoutes();
  assert.equal(hit(routes, 'P /api/chat/recovery/generate', reqOf('fake', {})).code, 401, 'generating needs a login');
  const g = hit(routes, 'P /api/chat/recovery/generate', reqOf(chat.issueSession('Ana'), {}));
  assert.equal(g.code, 200); assert.equal(g.body.codes.length, 5);
  assert.equal(hit(routes, 'G /api/chat/recovery/status', reqGet(chat.issueSession('Ana'), {})).body.remaining, 5);
  const rr = hit(routes, 'P /api/chat/recovery/reset', reqOf('', { name: 'Ana', code: g.body.codes[0], pass: 'brandnew1' }));
  assert.equal(rr.code, 200); assert.ok(rr.body.token, 'a new session token is handed out');
  assert.equal(hit(routes, 'G /api/chat/recovery/status', reqGet(rr.body.token, {})).body.remaining, 4);
});

// ─── Status (a temporary mood) ───
test('setStatus: saves text+emoji with a valid TTL; effStatus shows what is left', () => {
  fresh();
  chat.register('Ana', 'secret1234');
  const r = chat.setStatus('Ana', { text: 'Deep work', emoji: '🎧', expiresIn: '4h' });
  assert.ok(r.ok); assert.ok(r.status);
  assert.equal(r.status.t, 'Deep work'); assert.equal(r.status.e, '🎧');
  assert.ok(r.status.exp > Date.now() + 3 * 3600e3 && r.status.exp <= Date.now() + 4 * 3600e3 + 1000, 'exp ≈ 4 hours from now');
  assert.deepEqual(chat.effStatus(chat.findUser('Ana')), r.status);
});
test('setStatus: expiresIn off → never expires; it ends when both fields are empty', () => {
  fresh();
  chat.register('Ana', 'secret1234');
  const k = chat.setStatus('Ana', { text: 'Stays', emoji: '', expiresIn: 'off' });
  assert.equal(k.status.exp, null);
  const c = chat.setStatus('Ana', { text: '  ', emoji: '', expiresIn: 'off' });
  assert.equal(c.status, null, 'empty text+emoji → the status is dropped');
  assert.equal(chat.effStatus(chat.findUser('Ana')), null);
});
test('setStatus: text that is too long and an unknown TTL are rejected', () => {
  fresh();
  chat.register('Ana', 'secret1234');
  assert.ok(chat.setStatus('Ana', { text: 'x'.repeat(81), emoji: '🙂', expiresIn: 'off' }).error, 'text longer than 80 is rejected');
  assert.ok(chat.setStatus('Ana', { text: 'ok', emoji: '🙂', expiresIn: '99z' }).error, 'an unrecognised TTL');
});
test('setStatus: a past exp → effStatus is null (nothing is shown)', () => {
  fresh();
  chat.register('Ana', 'secret1234');
  chat.setStatus('Ana', { text: 'Yesterday', emoji: '😴', expiresIn: 'off' });
  // manipulate the store directly to put exp in the past
  const u = chat.findUser('Ana');
  u.status.exp = Date.now() - 1000; chat.flush();
  assert.equal(chat.effStatus(u), null);
});
test('people() & profile() include the active status', () => {
  fresh();
  chat.register('Ana', 'secret1234'); chat.register('Ben', 'secret1234');
  chat.setStatus('Ana', { text: 'Busy', emoji: '💼', expiresIn: '4h' });
  const ana = chat.findUser('Ana');
  const list = chat.people('Ana', 50, 'Ben');
  const row = list.find(p => p.id === ana.id);
  assert.ok(row && row.status && row.status.t === 'Busy', 'people carries the status');
  const prof = chat.profile('Ana', 'Ben');
  assert.equal(prof.status.t, 'Busy');
});
test('P /api/chat/status: login required; an empty body → a null status', () => {
  fresh();
  chat.register('Ana', 'secret1234');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  assert.equal(hit(routes, 'P /api/chat/status', reqOf('fake', { text: 'x' })).code, 401, 'login required');
  const r = hit(routes, 'P /api/chat/status', reqOf(tok, { text: 'Focused', emoji: '🎧', expiresIn: '1h' }));
  assert.equal(r.code, 200); assert.equal(r.body.status.t, 'Focused');
  const c = hit(routes, 'P /api/chat/status', reqOf(tok, { text: '', emoji: '', expiresIn: 'off' }));
  assert.equal(c.code, 200); assert.equal(c.body.status, null);
});

// ─── Polls ───
test('createPoll: creates a poll in the global room with a question + options', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const r = chat.createPoll('Ana', 'global_am', 'Pick a favourite colour', ['Red', 'Blue', 'Green']);
  assert.ok(r.ok, 'the poll was created');
  assert.equal(r.poll.opts.length, 3);
  assert.equal(r.poll.q, 'Pick a favourite colour');
});

test('createPoll: an empty question / a single option / too many options are rejected', () => {
  fresh();
  chat.register('Ana', 'pass1');
  assert.ok(chat.createPoll('Ana', 'global_am', '', ['A', 'B']).error, 'an empty question');
  assert.ok(chat.createPoll('Ana', 'global_am', 'X', ['A']).error, 'fewer than 2 options');
  assert.ok(chat.createPoll('Ana', 'global_am', 'X', ['A','B','C','D','E','F','G']).error, 'more than 6 options');
});

test('votePoll: one vote per member + it can be changed + the counts are right', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const p = chat.createPoll('Ana', 'global_am', 'Cats or dogs?', ['Cats', 'Dogs']).poll;
  chat.register('Cia', 'pass3');
  assert.ok(chat.votePoll('Ana', p.id, 0).ok, 'Ana picks Cats');
  assert.ok(chat.votePoll('Ben', p.id, 1).ok, 'Ben picks Dogs');
  const r = chat.votePoll('Cia', p.id, 0);
  assert.ok(r.ok);
  assert.deepEqual(r.poll.counts, [2, 1], '2 cats, 1 dog');
  // change the vote
  const r2 = chat.votePoll('Cia', p.id, 1);
  assert.deepEqual(r2.poll.counts, [1, 2], 'Cia switches to dogs');
  // a nonexistent poll
  assert.ok(chat.votePoll('Ana', 'no-such-poll', 0).error);
});

test('votePoll: someone outside the room is rejected', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const dm = chat.ensureDm(chat.findUser('Ana'), chat.findUser('Ben'));
  const p = chat.createPoll('Ana', dm.id, 'Dinner? Yes/No', ['Yes', 'No']).poll;
  assert.ok(chat.votePoll('Cia', p.id, 0).error, 'Cia is not a DM member');
});

test('hydrate: a message carrying pollData is filled while reading', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const p = chat.createPoll('Ana', 'global_am', 'A question', ['A', 'B']).poll;
  chat.votePoll('Ana', p.id, 1);
  // send a message with a pollId (exactly what the /api/chat/poll route does)
  chat.send('Ana', 'global_am', '📊 A question', null, null, { pollId: p.id });
  const out = chat.since('Ana', 'global_am', 0);
  const pm = out.msgs.find(m => m.pollId === p.id);
  assert.ok(pm, 'the message with a pollId exists');
  const h = chat.hydrate(pm);
  assert.ok(h.pollData, 'pollData is filled during hydrate');
  assert.deepEqual(h.pollData.counts, [0, 1], 'Ana voted B');
});

test('route P /api/chat/poll: create + vote properly over HTTP', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  let r = hit(routes, 'P /api/chat/poll', reqOf(tok, { room: 'global_am', q: 'An election', opts: ['A', 'B'] }));
  assert.equal(r.code, 200);
  assert.ok(r.body.poll && r.body.poll.opts.length === 2);
  const pid = r.body.poll.id;
  r = hit(routes, 'P /api/chat/poll/vote', reqOf(chat.issueSession('Ben'), { id: pid, opt: 1 }));
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.poll.counts, [0, 1]);
});

// ─── Stickers ───
test('send: a sticker is stored on the message without affecting the text', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const m = chat.send('Ana', 'global_am', '👍', null, null, { sticker: '👍' }).msg;
  assert.equal(m.sticker, '👍', 'the sticker is stored');
  assert.equal(m.t, '👍', 'the original text is kept');
});

test('send: a sticker longer than 8 characters is cut, sticker=null is fine', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const m = chat.send('Ana', 'global_am', 'x', null, null, { sticker: 'a'.repeat(20) }).msg;
  assert.equal(m.sticker.length, 8, 'truncated at 8 characters');
  const m2 = chat.send('Ana', 'global_am', 'y').msg;
  assert.ok(!m2.sticker, 'there is no sticker field');
});

// ─── Chat ⇄ cell bridge (the SMS gateway) ───
test('phone: setPhone normalises, rejects a duplicate or an invalid one, can be cleared', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cin', 'pass3');
  const r = chat.setPhone('Ana', '+60 12-345 6789');
  assert.equal(r.ok, true); assert.equal(r.phone, '+60123456789');
  assert.equal(chat.findUserByPhone('+60123456789').name, 'Ana');
  assert.ok(chat.setPhone('Ben', '+60 12 345 6789').error, 'a number already in use → rejected');
  assert.ok(chat.setPhone('Cin', 'not-a-number').error, 'letters only → invalid');
  const clr = chat.setPhone('Ana', '');
  assert.equal(clr.phone, null); assert.equal(chat.findUserByPhone('+60123456789'), null);
});

test('the SMS bridge: a DM to an OFFLINE friend with a number → smsSender is called', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.setPhone('Ben', '+60123456789');
  let sent = null;
  chat.setSmsSender((p) => { sent = p; return { ok: true }; });
  try {
    chat.send('Ana', dm.id, 'hello');
    assert.ok(sent, 'smsSender was called');
    assert.equal(sent.to, '+60123456789');
    assert.equal(sent.from, 'Ana');
    assert.match(sent.body, /^Ana: hello$/, 'the body is prefixed with the sender name');
  } finally { chat.setSmsSender(null); }
});

test('the SMS bridge: NO SMS when the friend is online or has no number', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cin', 'pass3');
  chat.login('Ben', 'pass2');   // lastSeen is now → online
  chat.setPhone('Ben', '+60123456789');
  let n = 0;
  chat.setSmsSender(() => { n++; return { ok: true }; });
  try {
    chat.send('Ana', chat.ensureDm('Ana', 'Ben').id, 'hi');
    assert.equal(n, 0, 'online → no SMS');
    chat.send('Ana', chat.ensureDm('Ana', 'Cin').id, 'x');  // Cin has no number
    assert.equal(n, 0, 'no number → no SMS');
  } finally { chat.setSmsSender(null); }
});

test('the SMS bridge: an incoming SMS reply → the original DM; a prefixed message; anti-loop', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.setPhone('Ben', '+60123456789');
  let sent = 0;
  chat.setSmsSender(() => { sent++; return { ok: true }; });
  try {
    chat.send('Ana', dm.id, 'one');
    assert.equal(sent, 1, 'one SMS went out');
    const r = chat.ingestSms('+60-12-345-6789', 'two');   // raw → matches what is stored for Ben
    assert.equal(r.ok, true, 'ingestSms succeeded');
    assert.equal(r.msg.from, 'Ben', 'the author = the owner of the number');
    const s = chat.since('Ana', dm.id, 0);
    assert.equal(s.msgs.length, 2);
    assert.equal(s.msgs[1].t, 'two');
    assert.equal(sent, 1, 'anti-loop: ingesting does not send a second SMS');
  } finally { chat.setSmsSender(null); }
});

test('the SMS bridge: ingest is ignored — an unknown number / no thread / frozen', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.equal(chat.ingestSms('+6099999999', 'x').reason, 'not-linked', 'the number has no account');
  chat.setPhone('Ben', '+60123456789');
  assert.equal(chat.ingestSms('+60123456789', 'y').reason, 'no-thread', 'no SMS went out yet → no thread');
  // Build a thread with an outgoing SMS, then Ana blocks Ben → frozen.
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.setSmsSender(() => ({ ok: true }));
  chat.send('Ana', dm.id, 'hello');
  chat.setSmsSender(null);
  chat.blockUser('Ana', chat.findUser('Ben').id);
  assert.equal(chat.ingestSms('+60123456789', 'a reply').reason, 'frozen', 'the DM is frozen → ignored');
});

test('the SMS bridge: a thread is only recorded when smsSender returns OK', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.setPhone('Ben', '+60123456789');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.setSmsSender(() => ({ error: 'no device' }));   // it failed → smsReply is not written
  chat.send('Ana', dm.id, 'a failure');
  chat.setSmsSender(null);
  assert.equal(chat.ingestSms('+60123456789', 'a reply').reason, 'no-thread', 'no thread → ignored');
});
