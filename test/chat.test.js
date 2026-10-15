'use strict';
// Ujian backend T Chat (src/chat.js) — logik murni, tiada pelayan HTTP.
// Setiap ujian bermula dengan storan JSON baharu di direktori sementara.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const chat = require('../src/chat');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tukuk-chat-'));
  chat.setPath(path.join(dir, 'chat.json'));
  chat.clearSinks();  // yuran ujian lepas tidak boleh merembes ke ujian ini
  return dir;
}

test('normalizeName: terima nama sah, tolak tidak sah', () => {
  assert.equal(chat.normalizeName('  Aisyah  '), 'Aisyah');
  assert.equal(chat.normalizeName('fahmi_99'), 'fahmi_99');
  assert.equal(chat.normalizeName('a'), null, 'terlalu pendek');
  assert.equal(chat.normalizeName('x'.repeat(21)), null, 'terlalu panjang');
  assert.equal(chat.normalizeName('bad<name>/'), null, 'simbol bahaya');
  assert.equal(chat.normalizeName(''), null);
});

test('register/login: hash scrypt, kata laluan salah ditolak', () => {
  fresh();
  const r = chat.register('Aisyah', 'rahasia123');
  assert.ok(r.ok && r.user.name === 'Aisyah');
  assert.notEqual(r.user.hash, 'rahasia123', 'kata laluan tidak disimpan mentah');
  assert.ok(chat.login('aisyah', 'rahasia123').ok, 'nama tak kira huruf besar/kecil');
  assert.ok(chat.login('Aisyah', 'salah').error, 'kata laluan salah → ralat');
});

test('register: nama pendua + kata laluan pendek ditolak', () => {
  fresh();
  assert.ok(chat.register('Firdaus', '1234').ok);
  assert.ok(chat.register('firdaus', 'abcd').error, 'pendua ditolak');
  assert.ok(chat.register('Baru', '123').error, 'pass < 4 aksara ditolak');
});

test('sesi: issue → userOf → revoke', () => {
  fresh();
  chat.register('Hafiz', 'kunci99');
  const token = chat.issueSession('Hafiz');
  assert.equal(chat.userOf(token).name, 'Hafiz');
  assert.equal(chat.userOf('token-palsu'), null);
  chat.revoke(token);
  assert.equal(chat.userOf(token), null, 'selepas logout sesi mati');
});

test('bilik DM: id deterministik dua arah + kegunaan semula', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.equal(chat.dmId('Ana', 'Ben'), chat.dmId('Ben', 'Ana'));
  const r1 = chat.ensureDm('Ana', 'Ben');
  const r2 = chat.ensureDm('Ben', 'Ana');
  assert.equal(r1.id, r2.id, 'bilik sama, tidak ganda');
  assert.equal(r2.members.length, 2, 'ahli tidak bertambah');
});

test('canRead: DM terhad kepada ahli, global terbuka', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cin', 'pass3');
  const dm = chat.ensureDm('Ana', 'Ben');
  assert.ok(chat.canRead('Ana', dm.id));
  assert.ok(chat.canRead('Ben', dm.id));
  assert.ok(!chat.canRead('Cin', dm.id), 'orang luar tidak boleh baca DM');
  assert.ok(chat.canRead('Cin', 'global_am'), 'bilik global untuk semua');
});

test('send: jujukan (seq) menaik, kosong ditolak, panjang dipotong', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const a = chat.send('Ana', 'global_am', 'hello');
  const b = chat.send('Ana', 'global_am', 'dunia');
  assert.equal(a.msg.seq, 1);
  assert.equal(b.msg.seq, 2);
  assert.ok(chat.send('Ana', 'global_am', '   ').error, 'mesej kosong ditolak');
  assert.ok(chat.send('Ana', 'bilik-tiada', 'x').error, 'bilik tak wujud → ralat');
  const long = chat.send('Ana', 'global_am', 'a'.repeat(900));
  assert.equal(long.msg.t.length, 500, 'potong pada MAX_MSG');
});

test('send: mesej berbilang baris dikekalkan, aksara kawalan lain dibuang', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const a = chat.send('Ana', 'global_am', 'baris satu\nbaris dua').msg;
  assert.equal(a.t, 'baris satu\nbaris dua', '\n tidak dimusnahkan');
  assert.equal(chat.send('Ana', 'global_am', 'x\r\ny').msg.t, 'x\ny', 'CRLF diseragam');
  assert.ok(chat.send('Ana', 'global_am', '\n\n').error, 'hanya baris kosong = mesej kosong');
  assert.equal(chat.send('Ana', 'global_am', 'a\u0000b\u0007c').msg.t, 'a b c', 'nul/bel jadi spasi');
});

test('send: replyTo ke mesej tidak wujud dibuang, bukan dirosakkan', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const real = chat.send('Ana', 'global_am', 'asal').msg;
  assert.equal(chat.send('Ana', 'global_am', 'x', 'id-palsu').msg.to, null);
  assert.equal(chat.send('Ana', 'global_am', 'y', real.id).msg.to, real.id);
});

test('bilik: mesej lama dibuang selepas had SIMPAN (KEEP=200)', () => {
  fresh();
  chat.register('Ana', 'pass1');
  for (let i = 0; i < 210; i++) chat.send('Ana', 'global_am', 'm' + i);
  const all = chat.since('Ana', 'global_am', 0);
  assert.equal(all.msgs.length, 200, 'hanya 200 terakhir');
  assert.equal(all.msgs[0].t, 'm10', 'yang paling lama dibuang');
  assert.equal(all.seq, 210, 'seq terus menaik walaupun list dipotong');
});

test('since(after): hanya mesej baharu, untuk poll', () => {
  fresh();
  chat.register('Ana', 'pass1');
  chat.send('Ana', 'global_am', 'satu');
  chat.send('Ana', 'global_am', 'dua');
  assert.equal(chat.since('Ana', 'global_am', 1).msgs.length, 1);
  assert.equal(chat.since('Ana', 'global_am', 2).msgs.length, 0);
  assert.equal(chat.since('Ana', 'global_am', 0).msgs.length, 2);
});

test('since: bacaan sahaja — tidak memadam belum-dibaca (markSeen eksplisit)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ben', dm.id, 'untuk ana');
  chat.since('Ana', dm.id, 0); // poll tanpa read=1
  assert.equal(chat.unread('Ana')[dm.id], 1, 'badge kekal sampai bila benar-benar dibuka');
  chat.markSeen('Ana', dm.id);
  assert.equal(chat.unread('Ana')[dm.id], 0);
});

test('unread + markSeen berfungsi per bilik', () => {
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

test('unread: mesej sendiri tidak menjadi belum-untuk penghantar', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ana', dm.id, 'saya hantar');
  assert.equal(chat.unread('Ana')[dm.id], 0, 'penghantar nampak 0');
  assert.equal(chat.unread('Ben')[dm.id], 1, 'penerima nampak 1');
  chat.send('Ben', dm.id, 'balas');
  assert.equal(chat.unread('Ana')[dm.id], 1, 'hanya mesej Ben belum dibaca Ana');
  chat.send('Ben', dm.id, 'cheguj');
  chat.send('Ana', dm.id, 'saya balas sekarang');
  assert.equal(chat.unread('Ana')[dm.id], 2, 'menghantar mesej sendiri tidak memadam unread orang');
});

test('react: togol — tekan dua kali buang reaksi', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const id = chat.send('Ana', 'global_am', 'kotlin').msg.id;
  assert.deepEqual(chat.react('Ben', 'global_am', id, '🔥').msg.rx, { '🔥': 1 });
  assert.deepEqual(chat.react('Ben', 'global_am', id, '🔥').msg.rx, {}, 'togol keluar');
  assert.ok(chat.react('Ben', 'global_am', 'tak-wujud', '❤️').error);
});

test('edit/padam: hanya pemilik mesej', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const id = chat.send('Ana', 'global_am', 'asal').msg.id;
  assert.ok(chat.edit('Ben', 'global_am', id, 'hack').error, 'bukan pemilik → ditolak');
  assert.equal(chat.edit('Ana', 'global_am', id, 'dibetulkan').msg.t, 'dibetulkan');
  assert.ok(chat.edit('Ana', 'global_am', id, '  ').error, 'edit kosong ditolak');
  assert.ok(chat.remove('Ben', 'global_am', id).error, 'padam milik orang → ditolak');
  assert.ok(chat.remove('Ana', 'global_am', id).ok);
  assert.equal(chat.since('Ana', 'global_am', 0).msgs.length, 0);
});

test('typing: direkod kemudian luput', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.setTyping('Ben', dm.id);
  assert.deepEqual(chat.typingIn(dm.id), ['ben'], 'Ana nampak Ben menaip');
  chat.send('Ben', dm.id, 'selesai');
  assert.deepEqual(chat.typingIn(dm.id), [], 'kiriman clears typing');
  chat.setTyping('Ana', 'bilik-tiada');
  assert.deepEqual(chat.typingIn('bilik-tiada'), [], 'bilik tak wujud diabaikan');
});

test('people: penapis + kehadiran dalam talian', () => {
  fresh();
  chat.register('Aisyah', 'pass1'); chat.register('Firdaus', 'pass2');
  chat.userOf(chat.issueSession('Aisyah')); // sentuh lastSeen
  const all = chat.people(null);
  assert.equal(all.length, 2);
  const on = all.find(p => p.name === 'Aisyah');
  assert.ok(on.online, 'sesi aktif = dalam talian');
  assert.ok(!all.find(p => p.name === 'Firdaus').online, 'belum aktif = luar talian');
  assert.deepEqual(chat.people('fir').map(p => p.name), ['Firdaus']);
});

test('persistence: flush ke cakera + muat semula', () => {
  const dir = fresh();
  const file = path.join(dir, 'chat.json');
  chat.register('Kekal', 'pass1');
  chat.send('Kekal', 'global_am', 'mesej kekal');
  chat.flush();
  assert.ok(fs.existsSync(file), 'fail ditulis');
  chat.setPath(file); // muat semula daripada cakera
  assert.equal(chat.people(null).length, 1);
  assert.ok(chat.login('Kekal', 'pass1').ok, 'akaun tersimpan');
  assert.equal(chat.since('Kekal', 'global_am', 0).msgs[0].t, 'mesej kekal');
});

test('eqHex: perbandingan masa-tetap, panjang berbeza selamat', () => {
  assert.ok(chat.eqHex('abcd', 'abcd'));
  assert.ok(!chat.eqHex('abcd', 'abce'));
  assert.ok(!chat.eqHex('ab', 'abcd'), 'panjang beza → false, tidak lempar');
  assert.ok(!chat.eqHex('xyz', 'abcd'), 'hex tidak sah → false, tidak lempar');
});

// ─── Tukuk ID (identiti kekal) ───
test('id: setiap akaun dapat nombor kekal bermula 100001', () => {
  fresh();
  const a = chat.register('Ana', 'pass1').user;
  const b = chat.register('Ben', 'pass2').user;
  assert.equal(a.id, 100001);
  assert.equal(b.id, 100002, 'nombor naik secara monotik');
  assert.equal(chat.byId(100001).name, 'Ana');
  assert.equal(chat.findUser('100002').name, 'Ben', 'ID berbentuk teks pun ditemui');
  assert.equal(chat.findUser('999999'), null);
});

test('id: nama 6 angka ditolak — rantau itu milik Tukuk ID', () => {
  fresh();
  assert.ok(chat.register('123456', 'pass1').error, 'daftar nama 6 angka ditolak');
  chat.register('Ana', 'pass1');
  assert.ok(chat.rename('Ana', '123456').error, 'rename ke 6 angka ditolak');
});

test('DM dikunci pada ID: rename tidak memutuskan perhubungan', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  assert.equal(dm.id, 'dm_100001~100002', 'id bilik ikut nombor, bukan nama');
  chat.send('Ben', dm.id, 'halo ana');
  const tok = chat.issueSession('Ben');
  assert.ok(chat.rename('Ben', 'BenBaru').ok);
  assert.ok(chat.roomsFor('Ana').some(r => r.id === dm.id), 'Ana masih nampak bilik itu');
  assert.ok(chat.canRead('BenBaru', dm.id), 'nama baharu masih ahli');
  assert.ok(!chat.canRead('Ben', dm.id), 'nama lama bukan lagi identiti');
  assert.equal(chat.roomTitle(dm, 'Ana'), 'BenBaru', 'tajuk ikut nama terkini');
  assert.equal(chat.unread('Ana')[dm.id], 1, 'belum-dibaca kekal selepas rename');
  assert.equal(chat.userOf(tok).name, 'BenBaru', 'sesi lama kekal hidup');
});

test('rename: nama pendua ditolak, nama sama bukan ralat', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.ok(chat.rename('Ana', 'ben').error, 'nama sudah digunakan (tak kira huruf)');
  const same = chat.rename('Ana', 'Ana');
  assert.ok(same.ok && same.changed === false, 'tukar ke nama sendiri = tiada perubahan');
  assert.ok(chat.rename('tiada', 'Cinz').error, 'akaun tak wujud → ralat');
});

test('profile: "siapa punya ID ini?" → nama, bio, kehadiran', () => {
  fresh();
  chat.register('Ana', 'pass1');
  chat.setBio('Ana', 'suka   membina bot');
  assert.equal(chat.profile(100001).name, 'Ana');
  assert.equal(chat.profile('ana').bio, 'suka membina bot', 'bio dirapatkan satu baris');
  assert.equal(chat.profile('tiada'), null);
  assert.deepEqual(chat.people('100001').map(p => p.name), ['Ana'], 'direktori boleh cari ikut nombor');
});

test('fid: karangan mesej ikut ID, paparan ikut nama terkini', () => {
  fresh();
  const a = chat.register('Ana', 'pass1').user;
  const m = chat.send('Ana', 'global_am', 'hai').msg;
  assert.equal(m.fid, a.id, 'mesej memuat id penghantar');
  chat.rename('Ana', 'Anna');
  assert.equal(chat.authorName(m), 'Anna', 'nama terkini disuai dari id');
  assert.equal(m.from, 'Ana', 'nama ketika dihantar kekal sebagai rekod');
  assert.ok(chat.edit('Anna', 'global_am', m.id, 'dibetulkan').ok, 'hak tulis ikut id');
  assert.ok(chat.remove('Anna', 'global_am', m.id).ok);
});

test('ensureDm: pasangan belum daftar → null (tiada DM hantu)', () => {
  fresh();
  chat.register('Ana', 'pass1');
  assert.equal(chat.ensureDm('Ana', 'Tiada'), null);
  assert.equal(chat.ensureDm('Ana', 'Ana'), null, 'diri sendiri ditolak');
});

test('migrasi: data lama (bilik ikut nama, tiada id) naik taraf tanpa hilang mesej', () => {
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
        list: [{ id: 'm1', seq: 1, from: 'Ana', t: 'lama', ts: 1, to: null, rx: {}, edited: false, del: false }] },
      'dm_ana~ben': { id: 'dm_ana~ben', kind: 'dm', title: null, members: ['Ana', 'Ben'], createdBy: 'Ana', createdAt: 1, seq: 1,
        list: [{ id: 'm2', seq: 1, from: 'Ana', t: 'dm lama', ts: 1, to: null, rx: {}, edited: false, del: false }] },
    },
    msgs: {}, seen: { 'dm_ana~ben|ben': 0 }, typing: {},
  }));
  chat.setPath(file);
  const s = chat.load();
  assert.equal(s.users.ana.id, 100001, 'akaun lama dapat id');
  assert.ok(s.rooms['dm_100001~100002'], 'bilik DM dinombor semula');
  assert.ok(!s.rooms['dm_ana~ben'], 'kunci lama dibuang');
  assert.equal(s.rooms['dm_100001~100002'].list[0].t, 'dm lama', 'sejarah mesej selamat');
  assert.equal(s.seen['dm_100001~100002|ben'], 0, 'titik dibaca dipindahkan');
  assert.ok(chat.canRead('Ben', 'dm_100001~100002'));
  assert.equal(chat.roomTitle(s.rooms['dm_100001~100002'], 'Ben'), 'Ana');
  assert.equal(chat.roomsFor('Ana').length, 2);
});

// ─── Media (gambar + video) ───
const pad = (head, n) => Buffer.concat([head, Buffer.alloc(n || 40, 7)]);
const JPG = pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
const PNG = pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const GIF = pad(Buffer.from('GIF89a', 'latin1'));
const WEBP = pad(Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([9, 0, 0, 0]), Buffer.from('WEBP', 'latin1')]));
const MP4 = pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1')]).slice(0, 8 + 4));
const WEBM = pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
const GAGG = pad(Buffer.from('mari baca buku')); // bukan fail media

const pickK = (url) => String(url).split('?k=')[1];

function upload(user, buf, meta) { return chat.addMedia(user, buf, meta || {}); }

test('sniff: jenis ditentukan daripada bait ajaib, bukan nama fail', () => {
  assert.equal(chat.sniff(JPG).mime, 'image/jpeg');
  assert.equal(chat.sniff(PNG).ext, 'png');
  assert.equal(chat.sniff(GIF).mime, 'image/gif');
  assert.equal(chat.sniff(WEBP).ext, 'webp');
  assert.equal(chat.sniff(MP4).mime, 'video/mp4');
  assert.equal(chat.sniff(WEBM).ext, 'webm');
  assert.equal(chat.sniff(GAGG), null, 'fail bukan media ditolak');
  assert.equal(chat.sniff(Buffer.alloc(4)), null, 'terlalu pendek → null');
});

test('media: muat naik + hantar mesej gambar (teks boleh kosong)', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const r = upload(ana, JPG, { w: 1600, h: 900 });
  assert.ok(r.ok);
  assert.ok(fs.existsSync(chat.mediaFile(r.media)), 'fail ditulis ke disk');
  assert.equal(r.media.kind, 'image');
  const sent = chat.send('Ana', 'global_am', '', null, [r.media.id]);
  assert.ok(sent.ok, 'gambar sahaja tanpa teks dibenarkan');
  assert.equal(sent.msg.media.length, 1);
  assert.equal(sent.msg.media[0].w, 1600);
  assert.ok(sent.msg.media[0].url.startsWith('/api/chat/media/'), 'url ditandatangani dihantar');
  assert.ok(chat.send('Ana', 'global_am', 'hanya teks').ok);
  assert.ok(chat.send('Ana', 'global_am', '', null, []).error, 'kosong tanpa media tetap ditolak');
});

test('media: pautan hanya lulus kalau tandatangan sah dan belum luput', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const rec = upload(ana, PNG).media;
  const url = chat.mediaUrl(rec.id);
  assert.ok(chat.mediaAllowed(rec.id, pickK(url)));
  assert.ok(!chat.mediaAllowed(rec.id, pickK(url) + 'x'), 'tandatangan dikawal → ditolak');
  assert.ok(!chat.mediaAllowed('deadbeefcafe', pickK(url)), 'id lain tak boleh pakai k orang');
  assert.ok(!chat.mediaAllowed(rec.id, String(Date.now() + 9e9) + '.aa'), 'tarikh belum luput tapi mac salah');
  assert.ok(chat.mediaSrc(rec.id), 'rekod ditemui untuk hidangan');
  assert.ok(!chat.mediaSrc('aaaaaaaaaaaa'), 'id karut → null, tiada baca disk');
});

test('media: hak lampiran — orang lain, id karut, dan kiraan rujukan', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  chat.register('Ben', 'pass2');
  const ben = chat.findUser('Ben');
  const rec = upload(ana, JPG).media;
  assert.deepEqual(chat.attachMedia(ben, 'global_am', [rec.id], 'x1'), [], 'belum jadi mesej → orang lain tak boleh pakai');
  assert.equal(chat.attachMedia(ana, 'global_am', [rec.id], 'x1').length, 1);
  assert.deepEqual(chat.attachMedia(ana, 'global_am', ['deadbeefcafe'], 'x2'), [], 'id karut disaring');
  assert.equal(chat.attachMedia(ana, 'global_am', [rec.id], 'x1').length, 1, 'mesej sama → rujukan tak berganda');
  assert.equal(chat.load().media[rec.id].msgs.length, 1);
  assert.equal(chat.attachMedia(ana, 'global_am', [rec.id], 'x2').length, 1, 'gambar sama dihantar dua kali dibenarkan');
  assert.equal(chat.load().media[rec.id].msgs.length, 2);
  assert.deepEqual(chat.load().media[rec.id].rooms, ['global_am']);
});

test('media: teruskan gambar ke bilik lain guna rujukan yang sama (tiada salinan)', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const ben = chat.register('Ben', 'pass2').user;
  const dm = chat.ensureDm(ana, ben);
  const rec = upload(ana, JPG).media;
  const a = chat.send('Ana', 'global_am', 'tengok ni', null, [rec.id]);
  const b = chat.send('Ana', dm.id, '', null, [rec.id]);
  assert.ok(b.ok, 'pemilik boleh hantar failnya ke bilik lain');
  assert.equal(b.msg.media[0].id, rec.id);
  assert.deepEqual(chat.load().media[rec.id].rooms.slice().sort(), ['global_am', dm.id].sort());
  const f = chat.send('Ben', dm.id, 'terusan juga', null, [rec.id]);
  assert.ok(f.ok, 'Ben sudah nampak gambar itu di bilik Am → boleh teruskan');
  chat.remove('Ana', 'global_am', a.msg.id);
  assert.ok(chat.mediaSrc(rec.id), 'masih dipakai DM → fail selamat');
  assert.ok(chat.remove('Ana', dm.id, f.msg.id).error, 'mesej Ben bukan milik Ana');
  chat.remove('Ben', dm.id, f.msg.id);
  assert.ok(chat.mediaSrc(rec.id), 'mesej Ana dalam DM masih ada');
  chat.remove('Ana', dm.id, b.msg.id);
  assert.ok(!chat.mediaSrc(rec.id), 'tiada bilik tinggal → fail dibuang');
});

test('media: had 4 fail satu mesej + album dipapar ikut senarai', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(upload(ana, JPG).media.id);
  const sent = chat.send('Ana', 'global_am', 'album', null, ids);
  assert.ok(sent.ok);
  assert.equal(sent.msg.media.length, chat.MAX_PER_MSG, 'lebih had dibuang');
});

test('media: saiz berlebihan + kouta muat naik disekat', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const big = pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chat.MAX_IMG + 10);
  const over = chat.addMedia(ana, big);
  assert.equal(over.status, 413);
  assert.match(over.error, /terlalu besar/i);
  const bigdoc = Buffer.concat([Buffer.from('DOCX'), Buffer.alloc(chat.MAX_DOC + 10, 1)]);
  assert.equal(chat.addMedia(ana, bigdoc, { name: 'besar.docx' }).status, 413, 'fail umum terlalu besar → 413');
  for (let i = 0; i < chat.QUOTA_FILES; i++) assert.ok(upload(ana, GIF).ok, 'fail ke-' + (i + 1) + ' masih dibenarkan');
  const last = upload(ana, GIF);
  assert.equal(last.status, 429, 'kouta fail sejam → 429');
  assert.match(last.error, /Terlalu banyak fail/);
});

test('media: fail umum (dokumen/muzik) diterima + nama asal + dinormalkan', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const pdf = Buffer.from('%PDF-1.4 laporan sulit\n');
  const r = upload(ana, pdf, { name: 'laporan.pdf', mime: 'application/pdf' });
  assert.ok(r.ok, 'dokumen kini diterima sebagai lampiran umum');
  assert.equal(r.media.kind, 'file');
  assert.equal(r.media.ext, 'pdf');
  assert.equal(r.media.name, 'laporan.pdf');
  const pr = chat.projectMedia(r.media);
  assert.equal(pr.name, 'laporan.pdf');
  assert.equal(pr.mime, 'application/pdf');
  assert.equal(pr.size, pdf.length);
  const sent = chat.send('Ana', 'global_am', 'dokumen untuk anda', null, [r.media.id]);
  assert.ok(sent.ok);
  assert.equal(sent.msg.media[0].kind, 'file');
  // nama karut dinormalkan; tanpa nama → ext 'bin'
  const zip = upload(ana, GAGG, { name: '../../etc/pass"wd.zip', mime: 'application/zip' });
  assert.ok(zip.ok);
  assert.equal(zip.media.ext, 'zip');
  assert.ok(!zip.media.name.includes('/'), 'laluan dibuang daripada nama');
  const nope = upload(ana, GAGG, {});
  assert.ok(nope.ok);
  assert.equal(nope.media.ext, 'bin');
  assert.equal(nope.media.name, 'fail');
  // mp3 (bait ajaib bukan media) pergi sebagai fail + mime asal untuk main inline
  const mp3 = upload(ana, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 3)]), { name: 'lagu.mp3', mime: 'audio/mpeg' });
  assert.ok(mp3.ok);
  assert.equal(mp3.media.ext, 'mp3');
  assert.equal(chat.projectMedia(mp3.media).mime, 'audio/mpeg');
});

test('media: padam mesej membuang fail, dan mesej keluar dari simpanan juga dibuang', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const rec = upload(ana, WEBM).media;
  const sent = chat.send('Ana', 'global_am', 'video pendek', null, [rec.id]);
  const file = chat.mediaFile(rec);
  assert.ok(fs.existsSync(file));
  assert.ok(chat.remove('Ana', 'global_am', sent.msg.id).ok);
  assert.ok(!fs.existsSync(file), 'fail dipadam bersama mesej');
  assert.ok(!chat.mediaSrc(rec.id));
  assert.equal(chat.load().mediaBytes, 0, 'jumlah saiz disuai');
  // mesej lama terguling keluar daripada KEEP → failnya juga dibuang
  const first = upload(ana, JPG).media;
  chat.load().rooms.global_am.list = [];  // kosongkan supaya kiraan KEEP bermula bersih
  chat.load().rooms.global_am.seq = 0;
  const keep = chat.KEEP - 1;
  for (let i = 0; i < keep; i++) chat.send('Ana', 'global_am', 'p' + i);
  const a = chat.send('Ana', 'global_am', 'gambar awal', null, [first.id]);
  const b = upload(ana, JPG).media;
  for (let i = 0; i < keep; i++) chat.send('Ana', 'global_am', 'q' + i);
  chat.send('Ana', 'global_am', 'gambar akhir', null, [b.id]);
  assert.ok(!chat.mediaSrc(a.msg.media[0].id), 'mesej terguling → fail dikuras');
  assert.ok(chat.mediaSrc(b.id), 'mesej terakhir selamat');
});

test('media: hydrate tidak mengubah mesej yang disimpan', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  const rec = upload(ana, PNG, { w: 100, h: 80 }).media;
  chat.send('Ana', 'global_am', 'ada gambar', null, [rec.id]);
  const stored = chat.load().rooms.global_am.list[0];
  assert.ok(!stored.media[0].url, 'url tidak disimpan (ia boleh luput)');
  const shown = chat.hydrate(stored);
  assert.ok(shown.media[0].url.includes(rec.id));
  assert.ok(!stored.media[0].url, 'objek asal masih bersih selepas hydrate');
  assert.deepEqual(chat.hydrate({ id: 'x' }).media, undefined, 'mesej biasa tidak berubah');
});

// ─── Kawan, sekatan, kata laluan ───
test('kawan: tambah, senarai, buang + ralat asas', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  chat.register('Ben', 'pass2');
  assert.ok(chat.addFriend('Ana', 'tiada').error, 'sasaran tidak wujud');
  assert.ok(chat.addFriend('Ana', ana.id).error, 'diri sendiri ditolak');
  assert.ok(chat.addFriend('Ana', 'Ben').ok);
  assert.ok(chat.addFriend('Ana', 'Ben').already, 'dua kali = already');
  const s = chat.socialLists('Ana');
  assert.equal(s.friends.length, 1);
  assert.equal(s.friends[0].id, 100002, 'kawan disimpan sebagai Tukuk ID');
  assert.equal(s.friends[0].dm, null, 'belum ada bilik DM');
  chat.ensureDm('Ana', 'Ben');
  assert.equal(chat.socialLists('Ana').friends[0].dm, chat.dmId(ana.id, 100002), 'ada bilik → dm diisi');
  assert.ok(chat.delFriend('Ana', 'Ben').ok);
  assert.equal(chat.socialLists('Ana').friends.length, 0);
});

test('kawan: pertukaran nama tidak merosakkan senarai', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.addFriend('Ana', 'Ben');
  chat.rename('Ben', 'Citra');
  const f = chat.socialLists('Ana').friends;
  assert.equal(f.length, 1);
  assert.equal(f[0].name, 'Citra', 'paparan nama ikut ID semasa');
  assert.ok(chat.delFriend('Ana', 'Citra').ok, 'buang ikut nama baharu jalan');
});

test('sekat: DM dibekukan dua-dua arah, baca masih boleh, buka sekat pulih', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  assert.ok(chat.send('Ana', dm.id, 'hai').ok, 'sebelum sekat boleh hantar');
  assert.ok(chat.blockUser('Ana', 'Ben').ok);
  assert.ok(chat.send('Ana', dm.id, 'masih boleh?').error, 'penyekat juga tidak boleh hantar');
  assert.ok(chat.send('Ben', dm.id, 'sapa tu?').error, 'pihak disekat turut dibekukan');
  const seen = chat.since('Ben', dm.id, 0);
  assert.equal(seen.msgs.length, 1, 'sejarah masih boleh dibaca');
  assert.ok(chat.unblockUser('Ana', 'Ben').ok);
  assert.ok(chat.send('Ana', dm.id, 'ok balik').ok, 'lepas buka sekat boleh hantar');
});

test('sekat: buang persahabatan dua arah + tak boleh tambah kawan', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.addFriend('Ana', 'Ben'); chat.addFriend('Ben', 'Ana');
  chat.blockUser('Ana', 'Ben');
  assert.equal(chat.socialLists('Ana').friends.length, 0, 'kawan saya dibuang');
  assert.equal(chat.socialLists('Ben').friends.length, 0, 'kawan dua arah turut dibuang');
  assert.ok(chat.addFriend('Ana', 'Ben').error, 'tidak boleh kawan sementara tersekat');
  assert.ok(chat.blockUser('Ana', 'Ben').already);
  chat.unblockUser('Ana', 'Ben');
  assert.ok(chat.addFriend('Ana', 'Ben').ok, 'boleh kawan semula selepas dibuka');
});

test('sekat: mangsa tidak diberitahu — senarai & profil menyembunyi penyekat', () => {
  fresh();
  const ana = chat.register('Ana', 'pass1').user;
  chat.register('Ben', 'pass2');
  chat.register('Citra', 'pass3');
  chat.blockUser('Ana', 'Ben');
  assert.ok(!chat.people(null, 50, 'Ben').some(p => p.id === ana.id), 'Ben tidak nampak Ana');
  assert.equal(chat.profile(ana.id, 'Ben'), null, 'profil Ana seolah tiada untuk Ben');
  const asCitra = chat.people(null, 50, 'Citra');
  assert.ok(asCitra.some(p => p.id === ana.id), 'orang lain masih nampak Ana');
  const b = chat.people(null, 50, 'Ana').find(p => p.id === 100002);
  assert.equal(b.blocked, true, 'penyekat tahu siapa yang dia sekat');
  assert.equal(b.friend, false);
});

test('setPass: wajib kata laluan lama, salt baru, yang lama mati', () => {
  fresh();
  chat.register('Ana', 'lama123');
  assert.ok(chat.setPass('Ana', 'silap', 'baru123').error);
  assert.ok(chat.setPass('Ana', 'lama123', '123').error, 'terlalu pendek');
  assert.ok(chat.setPass('Ana', 'lama123', 'lama123').error, 'sama dengan yang lama');
  const before = chat.load().users.ana.hash;
  assert.ok(chat.setPass('Ana', 'lama123', 'baru123').ok);
  const u = chat.load().users.ana;
  assert.notEqual(u.hash, before, 'hash berubah');
  assert.ok(chat.login('Ana', 'baru123').ok);
  assert.ok(chat.login('Ana', 'lama123').error, 'kata laluan lama tidak lagi guna');
  assert.equal(chat.setPass('Tiada', 'a', 'b').error.includes('Akaun'), true);
});

test('logoutAll: sesi lain mati, token semasa kekal hidup', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const lama = chat.issueSession('Ana');
  const kini = chat.issueSession('Ana');
  const lain = chat.issueSession('Ben');
  chat.register('Ben', 'pass2');
  const r = chat.logoutAll('Ana', kini);
  assert.equal(r.revoked, 1, 'hanya sesi Ana yang lain diluput');
  assert.equal(chat.userOf(lama), null);
  assert.ok(chat.userOf(kini), 'peranti semasa tidak ditendang sendiri');
  assert.ok(chat.userOf(lain), 'sesi orang lain tidak terjejas');
});

test('migrate: akaun lama tanpa friends/blocked diisi kosong', () => {
  const dir = fresh();
  chat.register('Ana', 'pass1');
  chat.flush();
  const file = path.join(dir, 'chat.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw.users.ana.friends;
  delete raw.users.ana.blocked;
  fs.writeFileSync(file, JSON.stringify(raw));
  chat.setPath(file); // baca semula → migrate berjalan ke atas data lama
  const u = chat.load().users.ana;
  assert.deepEqual(u.friends, [], 'friends diisi ketika migrate');
  assert.deepEqual(u.blocked, [], 'blocked diisi ketika migrate');
  assert.ok(chat.addFriend('Ana', 'Ana').error, 'diri sendiri tetap ditolak');
  assert.equal(chat.people(null, 50, 'Ana').length, 1);
});

// ─── Yuran langsung (SSE) ───
// Sink palsu mencatat bingkai [event, data]. Setiap ujian wajib melepas semua
// yuran sebelum tamat — peta yuran adalah keadaan global modul.
function spy(tok) {
  const log = [];
  return { log, snk: { tok: tok || 'tok', send: (ev, data) => log.push([ev, data]), ping: () => {}, close: () => log.push([':closed', {}]) } };
}
const idOf = (name) => chat.findUser(name).id;
function release(...flat) { for (let i = 0; i + 1 < flat.length; i += 2) chat.detachSink(flat[i], flat[i + 1]); }

test('yuran: mesej bilik global untuk semua, DM hanya ahlinya', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cin', 'pass3');
  const a = spy(), b = spy(), c = spy();
  assert.ok(chat.attachSink(idOf('Ana'), a.snk), 'yuran diterima');
  chat.attachSink(idOf('Ben'), b.snk);
  chat.attachSink(idOf('Cin'), c.snk);
  const dm = chat.ensureDm('Ana', 'Ben');
  assert.equal(a.log[0][0], 'room', 'DM baharu diberitahu kepada ahli');
  assert.equal(b.log[0][0], 'room');
  assert.equal(c.log.length, 0, 'orang luar tidak tahu-menahu pasal DM');
  a.log.length = 0; b.log.length = 0;
  chat.send('Ana', dm.id, 'psst');
  assert.deepEqual(a.log.map(x => x[0]), ['msg'], 'penghantar juga dapat (tab kedua)');
  assert.equal(a.log[0][1].msg.t, 'psst');
  assert.equal(a.log[0][1].room, dm.id);
  assert.equal(b.log.length, 1, 'pasangan menerima serta-merta');
  assert.equal(c.log.length, 0, 'isi DM tidak bocor ke orang lain');
  chat.send('Ana', 'global_am', 'halo');
  assert.equal(c.log.length, 1, 'bilik global untuk semua yang bersambung');
  assert.equal(b.log.length, 2);
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk, idOf('Cin'), c.snk);
});

test('yuran: sunting, reaksi dan padam disiarkan kepada ahli bilik', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  const dm = chat.ensureDm('Ana', 'Ben');
  const id = chat.send('Ana', dm.id, 'asal').msg.id;
  a.log.length = 0; b.log.length = 0;
  chat.react('Ben', dm.id, id, '👍');
  assert.deepEqual(b.log.map(x => x[0]), ['react'], 'reaksi sampai ke tab lain');
  assert.equal(b.log[0][1].msg.rx['👍'], 1);
  assert.equal(chat.edit('Ana', dm.id, id, 'dibetulkan').ok, true);
  assert.deepEqual(a.log.map(x => x[0]).slice(-1), ['edit'], 'penghantar dapat salinan terbaru');
  assert.equal(a.log[a.log.length - 1][1].msg.t, 'dibetulkan');
  a.log.length = 0; b.log.length = 0;
  chat.remove('Ana', dm.id, id);
  assert.deepEqual(b.log, [['del', { room: dm.id, id }]], 'padam dibawa id + bilik');
  assert.equal(a.log.length, 1);
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

test('yuran: typing menghantar senarai semasa, mesej menghentikannya', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  const dm = chat.ensureDm('Ana', 'Ben');
  a.log.length = 0; b.log.length = 0;
  chat.setTyping('Ben', dm.id);
  assert.equal(a.log[0][0], 'typing', 'Ana nampak Ben menaip serta-merta');
  assert.deepEqual(a.log[0][1].typing, ['ben'], 'forma sama dengan poll');
  assert.equal(b.log[0][1].typing[0], 'ben', 'tab penghantar juga terima senarai yang sama');
  chat.send('Ben', dm.id, 'selesai');
  const senarai = a.log.filter(x => x[0] === 'typing').pop();
  assert.deepEqual(senarai[1].typing, [], 'kiriman clears typing');
  assert.equal(a.log.filter(x => x[0] === 'msg').length, 1, 'mesej hanya satu bingkai');
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

test('yuran: perubahan sosial hanya diberitahu kepada pemilik tab', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  chat.addFriend('Ana', 'Ben');
  assert.deepEqual(a.log.map(x => x[0]), ['social'], 'tab Ana dimuat semula');
  assert.equal(b.log.length, 0, 'Ben tidak diberitahu jadi kawan');
  chat.blockUser('Ana', 'Ben');
  assert.equal(b.log.length, 0, 'mangsa sekatan TIDAK menerima apa-apa');
  chat.unblockUser('Ana', 'Ben');
  assert.equal(a.log.length, 3);
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

test('yuran: had sambungan per akaun + tendang hanya peranti lain', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const id = idOf('Ana'), spies = [];
  for (let i = 0; i < chat.MAX_STREAMS; i++) { const s = spy('k' + i); spies.push(s); assert.ok(chat.attachSink(id, s.snk), 'yuran ' + i); }
  const lebih = spy('lebih');
  assert.equal(chat.attachSink(id, lebih.snk), false, 'melebihi MAX_STREAMS ditolak');
  assert.equal(chat.kickSinks(id, 'k2'), chat.MAX_STREAMS - 1, 'token semasa ditinggalkan');
  assert.equal(spies.filter(s => s.log.some(x => x[0] === 'kick')).length, chat.MAX_STREAMS - 1);
  assert.equal(spies[2].log.length, 0, 'peranti semasa tidak ditendang');
  for (const s of spies) chat.detachSink(id, s.snk);
});

test('yuran: denyut membezakan perubahan kehadiran sahaja', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy();
  chat.attachSink(idOf('Ana'), a.snk);
  chat.userOf(chat.issueSession('Ben'));
  chat.tickBeat();
  assert.equal(a.log.length, 0, 'denyut pertama hanya merekod keadaan asal');
  chat.load().users.ben.lastSeen = Date.now() - 999e3;   // Ben senyap > ONLINE_MS
  chat.tickBeat();
  const ev = a.log.find(x => x[0] === 'presence');
  assert.ok(ev, 'perubahan kehadiran diberitahu');
  assert.deepEqual(ev[1], { id: idOf('Ben'), online: false });
  a.log.length = 0;
  chat.tickBeat();
  assert.equal(a.log.filter(x => x[0] === 'presence').length, 0, 'keadaan sama → tiada bingkai');
  release(idOf('Ana'), a.snk);
});

test('yuran: dropSink menutup hanya tab bagi token itu', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a1 = spy('a1'), a2 = spy('a2'), b1 = spy('b1');
  chat.attachSink(idOf('Ana'), a1.snk); chat.attachSink(idOf('Ana'), a2.snk); chat.attachSink(idOf('Ben'), b1.snk);
  assert.equal(chat.dropSink('a1'), 1, 'satu tab sahaja ditendang');
  assert.ok(a1.log.some(x => x[0] === ':closed'));
  assert.equal(a2.log.length + b1.log.length, 0, 'tab lain tidak terusik');
  release(idOf('Ana'), a2.snk, idOf('Ben'), b1.snk);
});

test('yuran: sink yang gagal menulis dibuang ketika denyut', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const id = idOf('Ana');
  let closed = 0;
  const rosong = { tok: 'rosong', send: () => { throw new Error('stream dimusnahkan'); }, ping: () => { throw new Error('stream dimusnahkan'); }, close: () => { closed++; } };
  assert.ok(chat.attachSink(id, rosong), 'sink rosong diterima pada mulanya');
  chat.tickBeat();
  assert.equal(closed, 1, 'sink rosong ditutup selepas denyut');
  const penuh = [];
  for (let i = 0; i < chat.MAX_STREAMS; i++) { const s = spy('p' + i); assert.ok(chat.attachSink(id, s.snk), 'slot ' + i + ' bebas semula'); penuh.push(s); }
  assert.equal(chat.attachSink(id, spy('lebih').snk), false, 'had MAX_STREAMS masih dihormati');
  for (const s of penuh) chat.detachSink(id, s.snk);
});

test('resit bacaan: markSeen DM menyiarkan read kepada pasangan sahaja', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ana', dm.id, 'satu'); chat.send('Ana', dm.id, 'dua');
  a.log.length = 0; b.log.length = 0;
  chat.markSeen('Ben', dm.id);
  const rd = a.log.find(x => x[0] === 'read');
  assert.ok(rd, 'penghantar (Ana) terima read bila Ben membaca');
  assert.equal(rd[1].room, dm.id);
  assert.equal(rd[1].seq, 2, 'seq terakhir yang dibaca');
  assert.equal(b.log.filter(x => x[0] === 'read').length, 0, 'pembaca tidak menerima read sendiri');
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

// ─── Isyarat panggilan video/audio (WebRTC) ───
// Mount pada Express palsu: kumpul pemegang lalu panggil rantaian middleware.
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

test('call: isyarat diteruskan ke pasangan sahaja + tolak salah guna', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const a = spy(), b = spy();
  chat.attachSink(idOf('Ana'), a.snk); chat.attachSink(idOf('Ben'), b.snk);
  const tok = chat.issueSession('Ana');

  let r = hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ben'), ev: 'ring', data: { kind: 'video' } }));
  assert.equal(r.code, 200);
  assert.equal(r.body.delivered, true, 'pasangan bersambung → delivered');
  const got = b.log.find(x => x[0] === 'call');
  assert.ok(got, 'Ben terima isyarat panggilan');
  assert.equal(got[1].ev, 'ring');
  assert.equal(got[1].from, idOf('Ana'));
  assert.equal(got[1].data.kind, 'video', 'jenis panggilan dibawa serta');
  assert.equal(a.log.filter(x => x[0] === 'call').length, 0, 'pemanggil tidak menerima sendiri');

  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ben'), ev: 'hack' })).code, 400, 'isyarat tak dikenali');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ana'), ev: 'ring' })).code, 400, 'panggil diri sendiri');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: 999999, ev: 'ring' })).code, 400, 'pengguna tak wujud');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf('palsu', { to: idOf('Ben'), ev: 'ring' })).code, 401, 'kena login');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ben'), ev: 'ice', data: { big: 'x'.repeat(20000) } })).code, 413, 'paket terlalu besar');

  chat.blockUser('Ben', 'Ana');
  assert.equal(hit(routes, 'P /api/chat/call', reqOf(tok, { to: idOf('Ben'), ev: 'ring' })).code, 403, 'disekat → ditolak');
  release(idOf('Ana'), a.snk, idOf('Ben'), b.snk);
});

test('call: delivered=false bila pasangan tiada yuran (luar talian)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const a = spy();
  chat.attachSink(idOf('Ana'), a.snk);
  const r = hit(routes, 'P /api/chat/call', reqOf(chat.issueSession('Ana'), { to: idOf('Ben'), ev: 'ring' }));
  assert.equal(r.code, 200);
  assert.equal(r.body.delivered, false, 'Ben tiada sambungan');
  release(idOf('Ana'), a.snk);
});

// ─── Carian mesej (history search) ───
test('search: hasil kosong untuk query < 2 aksara', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const r = hit(routes, 'G /api/chat/search', reqGet(tok, { q: 'a' }));
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.results, [], '1 aksara → tiada hasil');
});

test('search: 401 tanpa token sah', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const r = hit(routes, 'G /api/chat/search', reqGet('palsu', { q: 'hello' }));
  assert.equal(r.code, 401);
});

test('search:jumpa mesej dalam bilik global ikut kueri (case-insensitive)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.send('Ana', 'global_am', 'Projek Tukuk-OS hampir siap');
  chat.send('Ben', 'global_am', 'Projek lain juga berjalan');
  chat.send('Ana', 'global_am', 'Sesi programming malam ini');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ben');
  const r = hit(routes, 'G /api/chat/search', reqGet(tok, { q: 'PROJEK' }));
  assert.equal(r.code, 200);
  assert.equal(r.body.results.length, 2, 'dua mesej mengandungi "projek"');
  assert.ok(r.body.results.every(x => /projek/i.test(x.t)));
});

test('search: tak kembalikan mesej DM yang bukan ahli', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const dm = chat.ensureDm(chat.findUser('Ana'), chat.findUser('Ben'));
  chat.send('Ana', dm.id, 'rahsia antara ana dan ben');
  const routes = mountRoutes();
  const r = hit(routes, 'G /api/chat/search', reqGet(chat.issueSession('Cia'), { q: 'rahsia' }));
  assert.equal(r.code, 200);
  assert.equal(r.body.results.length, 0, 'Cia bukan ahli DM — tak nampak');
});

test('search: newest dulu dan ada roomTitle + from', () => {
  fresh();
  chat.register('Ana', 'pass1');
  chat.send('Ana', 'global_am', 'hello lama');
  chat.send('Ana', 'global_am', 'hello baru');
  const routes = mountRoutes();
  const r = hit(routes, 'G /api/chat/search', reqGet(chat.issueSession('Ana'), { q: 'hello' }));
  assert.equal(r.code, 200);
  const list = r.body.results;
  assert.ok(list.length >= 2);
  assert.ok(list[0].ts >= list[1].ts, 'terbaru dahulu');
  assert.ok(list[0].roomTitle, 'ada roomTitle');
  assert.equal(list[0].from, 'Ana', 'ada nama penghantar');
});

// ─── Bilik kumpulan ───
test('createGroup: cipta bilik dengan ahli yang betul', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const r = chat.createGroup('Ana', 'Kelas 5A', [idOf('Ben'), idOf('Cia')]);
  assert.ok(r.ok);
  assert.equal(r.room.kind, 'group');
  assert.equal(r.room.title, 'Kelas 5A');
  assert.equal(r.room.memberIds.length, 3, 'Ana + Ben + Cia');
  assert.ok(r.room.memberIds.includes(idOf('Ana')));
});

test('createGroup: tanpa nama atau < 2 ahli ditolak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.ok(chat.createGroup('Ana', '', [idOf('Ben')]).error, 'tiada nama');
  assert.ok(chat.createGroup('Ana', 'X', []).error, 'tiada ahli lain');
});

test('canRead + roomTitle: ahli sahaja boleh baca, nama dipulangkan terus', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const grp = chat.createGroup('Ana', 'Kedai Kopi', [idOf('Ben')]).room;
  assert.ok(chat.canRead('Ana', grp.id));
  assert.ok(chat.canRead('Ben', grp.id));
  assert.ok(!chat.canRead('Cia', grp.id), 'bukan ahli');
  assert.equal(chat.roomTitle(grp, 'Ana'), 'Kedai Kopi');
});

test('send dalam kumpulan: mesej muncul untuk semua ahli', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'Kumpulan', [idOf('Ben')]).room;
  const r = chat.send('Ana', grp.id, 'hai semua');
  assert.ok(r.ok);
  const list = chat.since('Ben', grp.id, 0).msgs;
  assert.equal(list.length, 1);
  assert.equal(list[0].t, 'hai semua');
});

test('addToGroup: tambah ahli, ahli sedia ada → already, luar kumpulan → ralat', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3'); chat.register('Din', 'pass4');
  const grp = chat.createGroup('Ana', 'Kumpulan', [idOf('Ben')]).room;
  assert.ok(chat.addToGroup('Ana', grp.id, idOf('Cia')).ok);
  assert.equal(grp.memberIds.length, 3);
  assert.ok(chat.addToGroup('Ana', grp.id, idOf('Ben')).already, 'sudah ahli → already');
  assert.ok(chat.addToGroup('Din', grp.id, idOf('Cia')).error, 'Din bukan ahli → ditolak');
});

test('leaveGroup: ahli boleh keluar sendiri, bukan ahli → ralat', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const grp = chat.createGroup('Ana', 'Kumpulan', [idOf('Ben'), idOf('Cia')]).room;
  assert.ok(chat.leaveGroup('Cia', grp.id).ok);
  assert.ok(!grp.memberIds.includes(idOf('Cia')), 'Cia sudah keluar');
  assert.ok(chat.leaveGroup('Cia', grp.id).error, 'bukan ahli lagi');
});

test('POST /api/chat/group: endpoint pulangkan room, tolak badan tidak sah', () => {
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
  assert.equal(r2.code, 400, 'tiada nama → 400');
  assert.equal(hit(routes, 'P /api/chat/group', reqOf('palsu', { title: 'X', memberIds: [idOf('Ben')] })).code, 401);
});

// ─── Web Push ───
test('vapid key: GET /api/chat/vapid-public-key pulangkan kunci base64url', () => {
  fresh();
  const routes = mountRoutes();
  const r = hit(routes, 'G /api/chat/vapid-public-key', reqGet('x', {}));
  assert.equal(r.code, 200);
  assert.ok(typeof r.body.key === 'string' && r.body.key.length > 40);
});

test('push-subscribe: simpan langganan, 401 tanpa token', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const sub = { endpoint: 'https://example.com/push/abc', keys: { p256dh: 'x', auth: 'y' } };
  const r = hit(routes, 'P /api/chat/push-subscribe', reqOf(tok, sub));
  assert.equal(r.code, 200);
  assert.ok(r.body.ok);
  assert.equal(hit(routes, 'P /api/chat/push-subscribe', reqOf('palsu', sub)).code, 401);
  assert.equal(hit(routes, 'P /api/chat/push-subscribe', reqOf(tok, {})).code, 400, 'tiada endpoint → 400');
});

test('push-unsubscribe: buang langganan ikut endpoint', () => {
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
  assert.ok(!(s.pushSubs[uid] || []).find(x => x.endpoint === ep), 'sudah dibuang');
});

test('derSigToRaw: tandatangan EC P-256 → 64 bait', () => {
  const crypto = require('crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const der = crypto.sign('sha256', Buffer.from('test'), privateKey);
  const raw = chat.derSigToRaw(der);
  assert.equal(raw.length, 64, 'ES256 = 64 bait');
  assert.ok(Buffer.isBuffer(raw));
  // Verify r || s round-trip is correct
  const verified = crypto.verify('sha256', Buffer.from('test'), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw);
  assert.ok(verified, 'signature raw sah — verify lulus');
});

// ─── Mesej suara (audio) ───
test('addMedia: ogg dikesan sebagai audio tanpa flag klien', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const u = chat.findUser('Ana');
  const ogg = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(24)]);
  const r = chat.addMedia(u, ogg, {});
  assert.ok(r.ok);
  assert.equal(r.media.kind, 'audio');
  assert.equal(r.media.mime, 'audio/ogg');
});

test('addMedia: webm + flag audio=1 → audio; tanpa flag → video', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const u = chat.findUser('Ana');
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(24)]);
  const a = chat.addMedia(u, webm, { audio: '1' });
  assert.equal(a.media.kind, 'audio', 'flag klien menentukan jenis');
  assert.equal(a.media.mime, 'audio/webm', 'mime video/webm ditukar jadi audio/webm');
  const v = chat.addMedia(u, webm, {});
  assert.equal(v.media.kind, 'video', 'tanpa flag → video');
});

// ─── Pin mesej ───
test('pinMsg: togol pin di bilik global + mesej tak wujud → ralat', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const id = chat.send('Ana', 'global_am', 'penting').msg.id;
  assert.equal(chat.pinMsg('Ana', 'global_am', id, true).pinned, true);
  assert.equal(chat.pinMsg('Ana', 'global_am', id, false).pinned, false);
  assert.ok(chat.pinMsg('Ana', 'global_am', 'tak-wujud', true).error);
});

test('pinMsg: dalam kumpulan hanya admin boleh pin', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'Kumpulan', [idOf('Ben')]).room;
  const id = chat.send('Ben', grp.id, 'biasa').msg.id;
  assert.ok(chat.pinMsg('Ben', grp.id, id, true).error, 'bukan admin → ditolak');
  assert.ok(chat.pinMsg('Ana', grp.id, id, true).ok, 'admin → lulus');
});

// ─── Pentadbiran kumpulan ───
test('renameGroup: admin boleh tukar nama, bukan admin + nama kosong ditolak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'Lama', [idOf('Ben')]).room;
  assert.ok(chat.renameGroup('Ben', grp.id, 'Hack').error, 'bukan admin');
  assert.equal(chat.renameGroup('Ana', grp.id, 'Baharu').title, 'Baharu');
  assert.ok(chat.renameGroup('Ana', grp.id, '   ').error, 'nama kosong');
});

test('addAdmin + kickFromGroup: naik/turun admin, buang ahli', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const grp = chat.createGroup('Ana', 'Kumpulan', [idOf('Ben'), idOf('Cia')]).room;
  assert.ok(!chat.isGroupAdmin(grp, 'Ben'));
  chat.addAdmin('Ana', grp.id, idOf('Ben'), false);
  assert.ok(chat.isGroupAdmin(grp, 'Ben'), 'Ben jadi admin');
  chat.addAdmin('Ana', grp.id, idOf('Ben'), true);
  assert.ok(!chat.isGroupAdmin(grp, 'Ben'), 'Ben diturunkan');
  assert.ok(chat.kickFromGroup('Ana', grp.id, idOf('Cia')).ok);
  assert.ok(!grp.memberIds.includes(idOf('Cia')), 'Cia dibuang');
  assert.ok(chat.kickFromGroup('Ana', grp.id, idOf('Ana')).error, 'buang diri sendiri → guna keluar');
});

test('leaveGroup: admin keluar → promosi ahli lain; semua keluar → bubar', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'Kumpulan', [idOf('Ben')]).room;
  const r = chat.leaveGroup('Ana', grp.id);
  assert.ok(r.ok && !r.dissolved, 'Ben masih ada → bukan bubar');
  assert.ok(chat.isGroupAdmin(grp, 'Ben'), 'Ben dipromosikan admin');
  const r2 = chat.leaveGroup('Ben', grp.id);
  assert.ok(r2.ok && r2.dissolved, 'ahli terakhir → dibubarkan');
  assert.ok(!chat.load().rooms[grp.id], 'bilik sudah tiada');
});

test('dissolveBy: hanya pencipta boleh bubarkan selagi pencipta ada', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const grp = chat.createGroup('Ana', 'K', [idOf('Ben')]).room;
  chat.addAdmin('Ana', grp.id, idOf('Ben'), false);   // Ben admin tapi bukan pencipta
  assert.ok(chat.dissolveBy('Ben', grp.id).error, 'bukan pencipta → ditolak');
  const r = chat.dissolveBy('Ana', grp.id);
  assert.ok(r.ok && r.dissolved);
  assert.ok(!chat.load().rooms[grp.id], 'kumpulan dibubarkan');
});

// ─── Padam akaun ───
test('deleteAccount: kata laluan salah ditolak; betul → akaun + DM dihapus', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ana', dm.id, 'halo');
  assert.ok(chat.deleteAccount('Ana', 'salah').error, 'kata laluan salah');
  assert.ok(chat.deleteAccount('Ana', 'pass1').ok);
  assert.ok(!chat.findUser('Ana'), 'Ana tiada lagi');
  assert.ok(!chat.load().rooms[dm.id], 'DM dibuang');
});

test('deleteAccount: kumpulan miliknya dibubarkan, keanggotaan lain dibersihkan', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const anaId = idOf('Ana');
  const own = chat.createGroup('Ana', 'Milik Ana', [idOf('Ben')]).room;
  const other = chat.createGroup('Ben', 'Milik Ben', [anaId, idOf('Cia')]).room;
  assert.ok(chat.deleteAccount('Ana', 'pass1').ok);
  assert.ok(!chat.load().rooms[own.id], 'kumpulan milik Ana dibubarkan');
  assert.ok(chat.load().rooms[other.id], 'kumpulan orang lain kekal');
  assert.ok(!other.memberIds.includes(anaId), 'Ana dibuang dari ahli');
});

// ─── Laluan HTTP baharu ───
test('POST /api/chat/pin: perlu login + togol pin', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const id = chat.send('Ana', 'global_am', 'x').msg.id;
  assert.equal(hit(routes, 'P /api/chat/pin', reqOf('palsu', { room: 'global_am', id })).code, 401);
  const r = hit(routes, 'P /api/chat/pin', reqOf(tok, { room: 'global_am', id, pinned: true }));
  assert.equal(r.code, 200);
  assert.equal(r.body.pinned, true);
});

test('POST group/rename + admin + kick melalui laluan', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const grp = chat.createGroup('Ana', 'Lama', [idOf('Ben')]).room;
  let r = hit(routes, 'P /api/chat/group/rename', reqOf(tok, { room: grp.id, title: 'Baharu' }));
  assert.equal(r.code, 200); assert.equal(r.body.title, 'Baharu');
  r = hit(routes, 'P /api/chat/group/admin', reqOf(tok, { room: grp.id, memberId: idOf('Ben') }));
  assert.equal(r.code, 200); assert.ok(r.body.admins.includes(idOf('Ben')));
  r = hit(routes, 'P /api/chat/group/kick', reqOf(tok, { room: grp.id, memberId: idOf('Ben') }));
  assert.equal(r.code, 200); assert.ok(r.body.dissolved, 'tinggal seorang → bubar');
});

test('POST /api/chat/delete-account: kata laluan + sesi diperlukan', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  assert.equal(hit(routes, 'P /api/chat/delete-account', reqOf(tok, { pass: 'salah' })).code, 401, 'kata laluan salah → 401');
  assert.equal(hit(routes, 'P /api/chat/delete-account', reqOf('palsu', { pass: 'pass1' })).code, 401, 'tiada sesi → 401');
  const r = hit(routes, 'P /api/chat/delete-account', reqOf(tok, { pass: 'pass1' }));
  assert.equal(r.code, 200); assert.ok(r.body.ok);
  assert.ok(!chat.findUser('Ana'));
});

// ─── Lapisan sosial: ikuti, post, cerita, notifikasi, avatar ───
const reqGP = (tok, query, params) => ({ headers: { authorization: 'Bearer ' + tok }, body: {}, query: query || {}, params: params || {}, on() {}, socket: null });

function mkJpg(user) {
  const r = chat.addMedia(user, JPG, {});
  assert.ok(r.ok, 'muat naik jpg untuk ujian');
  return r.media.id;
}

test('follow: dua sisi, togol ulangi, diri sendiri & sekat ditolak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.ok(chat.followUser('Ana', 'Ben').ok);
  assert.ok(chat.isFollowing(chat.findUser('Ana'), chat.findUser('Ben')));
  assert.equal(chat.findUser('Ben').followers.length, 1, 'followers disegarakkan dua sisi');
  assert.ok(chat.followUser('Ana', 'Ben').already, 'ikuti dua kali → already');
  assert.ok(chat.followUser('Ana', 'Ana').error, 'diri sendiri ditolak');
  assert.ok(chat.followUser('Ana', 'tiada').error, 'tidak wujud ditolak');
  chat.blockUser('Ana', 'Ben');
  assert.ok(chat.followUser('Ana', 'Ben').error, 'yang disekat → ditolak');
  chat.unblockUser('Ana', 'Ben');
  assert.ok(chat.unfollowUser('Ana', 'Ben').ok);
  assert.equal(chat.findUser('Ben').followers.length, 0, 'buang ikuti kosongkan kedua sisi');
});

test('profile: bawa avatar, kiraan ikuti & bendera following/followsMe', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const ana = chat.findUser('Ana');
  assert.ok(chat.setAvatar(ana, mkJpg(ana)).ok);
  chat.followUser('Ben', 'Ana');
  const p = chat.profile('Ana', 'Ben');
  assert.ok(p.avatar.includes('/api/chat/avatar/'), 'avatar awam tanpa tandatangan');
  assert.equal(p.followersCount, 1);
  assert.equal(p.following, true, 'Ben (penonton) sudah ikuti Ana');
  assert.equal(p.followsMe, false, 'Ana tidak ikuti Ben');
  assert.equal(chat.profile('Ana', 'Ana').following, false, 'diri sendiri sentiasa false');
  assert.ok(chat.removeAvatar('Ana').ok);
  assert.equal(chat.profile('Ana').avatar, null);
});

test('setAvatar: bukan milik / bukan gambar ditolak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const mid = mkJpg(chat.findUser('Ben'));
  assert.ok(chat.setAvatar(chat.findUser('Ana'), mid).error, 'fail orang lain → ditolak');
  const vid = chat.addMedia(chat.findUser('Ana'), Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]), {});
  assert.ok(chat.setAvatar(chat.findUser('Ana'), vid.media.id).error, 'video bukan gambar → ditolak');
});

test('post: create/like/komen + feed pengikut terbit, penulis blokir tidak nampak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3'); chat.register('Dan', 'pass4');
  assert.ok(chat.createPost('Ana', '   ').error, 'post kosong ditolak');
  const p = chat.createPost('Ana', 'halo dunia').post;
  assert.ok(p.id && p.t === 'halo dunia');
  assert.equal(chat.createPost('Dan', 'x'.repeat(900)).post.t.length, 500, 'potong MAX_POST');
  chat.followUser('Ben', 'Ana');
  const f = chat.feedFor('Ben');
  assert.equal(f.posts.length, 1, 'pengikut nampak post');
  assert.equal(chat.feedFor('Cia').posts.length, 0, 'orang luar tak nampak');
  assert.equal(chat.feedFor('Ana').posts.length, 1, 'penulis nampak post sendiri');
  assert.ok(chat.likePost('Ben', p.id).liked, 'like pertama aktif');
  assert.equal(chat.likePost('Ben', p.id).liked, false, 'like dua kali → togol keluar');
  assert.ok(chat.commentPost('Cia', p.id, '  ').error, 'komen kosong ditolak');
  const c = chat.commentPost('Ben', p.id, 'mantap');
  assert.equal(c.post.comments.length, 1);
  assert.equal(c.post.comments[0].from, 'Ben');
  assert.ok(chat.delPost('Ben', p.id).error, 'bukan pemilik → padam ditolak');
  chat.blockUser('Ana', 'Ben');
  assert.equal(chat.feedFor('Ben').posts.length, 0, 'penulis sekat → post hilang dari feed');
});

test('post media: lampiran milik sendiri sahaja + url hidrasi', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const ana = chat.findUser('Ana');
  const mid = mkJpg(ana);
  assert.ok(chat.createPost('Ben', 'curi', [mid]).error, 'fail orang lain tak boleh dilampirkan');
  const p = chat.createPost('Ana', 'ada gambar', [mid]).post;
  assert.equal(p.media.length, 1);
  assert.ok(p.media[0].url && p.media[0].url.includes('/api/chat/media/'), 'url HMAC hadir pada paparan');
  assert.ok(chat.delPost('Ana', p.id).ok);
  assert.equal(chat.load().media[mid], undefined, 'post dipadam → fail dileraikan');
});

test('notif: like/komen/follow/mention sampai; blokir & sendiri tidak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const p = chat.createPost('Ana', 'projek saya').post;
  assert.equal(chat.pushNotif('Ana', 'palsu', {}), undefined, 'jenis tidak dikenali diabaikan');
  chat.likePost('Ben', p.id);
  chat.commentPost('Ben', p.id, 'terbaik');
  chat.followUser('Cia', 'Ana');
  chat.likePost('Ana', p.id); // like sendiri → tiada notif
  let n = chat.notifList('Ana');
  assert.equal(n.notifs.length, 3, 'like + komen + follow');
  assert.equal(n.unread, 3);
  assert.ok(n.notifs.every(x => x.actorName));
  chat.blockUser('Ben', 'Ana');
  chat.pushNotif('Ana', 'like', { actor: chat.findUser('Ben').id, post: p.id });
  assert.equal(chat.notifList('Ana').notifs.filter(x => x.type === 'like').length, 1, 'penyekat tidak menembusi notif');
  chat.createPost('Cia', 'helo @Ana dan @999999');
  assert.ok(chat.notifList('Ana').notifs.some(x => x.type === 'mention'), 'mention @nama → notif');
  assert.ok(chat.markNotifRead('Ana').ok);
  assert.equal(chat.notifList('Ana').unread, 0);
  assert.ok(chat.clearNotifs('Ana').ok);
  assert.equal(chat.notifList('Ana').notifs.length, 0);
});

test('cerita: aktif 24 jam, luput bila tamat, hanya penulis boleh padam', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  assert.ok(chat.createStory('Ana', '  ').error, 'cerita kosong ditolak');
  const st = chat.createStory('Ana', 'pagi').story;
  chat.followUser('Ben', 'Ana');
  assert.equal(chat.storiesOf('Ben').length, 1, 'pengikut nampak cerita');
  assert.equal(chat.storiesOf('Ana')[0].mine, true, 'milik sendiri ditanda');
  assert.ok(chat.viewStory('Ben', st.id).ok);
  assert.equal(chat.load().stories[st.id].views.length, 1);
  assert.ok(chat.delStory('Ben', st.id).error, 'bukan pemilik → ditolak');
  chat.load().stories[st.id].ts = Date.now() - chat.STORY_TTL - 1000;
  chat.pruneStories();
  assert.equal(chat.storiesOf('Ben').length, 0, 'luput selepas 24 jam');
  assert.equal(chat.load().stories[st.id], undefined, 'rekod dibuang prune');
});

test('sweep: media cerita yang luput dileraikan daripada stor', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const mid = mkJpg(chat.findUser('Ana'));
  const st = chat.createStory('Ana', 'gambar', [mid]).story;
  assert.ok(chat.load().media[mid], 'media melekat pada cerita');
  chat.load().stories[st.id].ts = Date.now() - chat.STORY_TTL - 1000;
  chat.flush(); // jalankan pembersihan dalaman melalui sweep (setInterval sukar ditunggu)
  // panggil prune secara terus (sweep memakainya juga)
  chat.pruneStories();
  assert.equal(chat.load().media[mid], undefined, 'fail cerita luput dibuang');
});

test('deleteAccount: post/cerita/notif/follow dibersihkan dua sisi', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const anaId = idOf('Ana');
  chat.followUser('Ben', 'Ana');
  chat.followUser('Ana', 'Cia');
  const p = chat.createPost('Ana', 'selamat tinggal').post;
  chat.commentPost('Ben', p.id, 'rip');
  chat.likePost('Cia', p.id);
  chat.createStory('Ana', 'cerita');
  assert.ok(chat.deleteAccount('Ana', 'pass1').ok);
  assert.equal(Object.keys(chat.load().posts).length, 0, 'post Ana tiada');
  assert.equal(Object.keys(chat.load().stories).length, 0, 'cerita Ana tiada');
  assert.equal(chat.findUser('Ben').followers.length, 0, 'Ana buang dari followers Ben');
  assert.equal(chat.findUser('Cia').following.length, 0, 'Ana buang dari following Cia');
  assert.equal(chat.notifList('Cia').notifs.length, 0, 'notif kepada Ana / oleh Ana dileraikan');
});

// ─── Laluan HTTP sosial ───
test('P /api/chat/follow + G /feed + /posts/:id melalui laluan', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tokA = chat.issueSession('Ana'), tokB = chat.issueSession('Ben');
  assert.equal(hit(routes, 'P /api/chat/follow', reqOf(tokB, { peer: 'Ana' })).code, 200);
  assert.equal(hit(routes, 'P /api/chat/follow', reqOf(tokB, { peer: 'Ana' })).code, 400, 'ikuti dua kali → 400');
  let r = hit(routes, 'P /api/chat/posts', reqOf(tokA, { text: 'halo' }));
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
  assert.equal(r.code, 404, 'post tiada → 404');
  r = hit(routes, 'P /api/chat/posts', reqOf(tokB, { text: 'saya ikut balik' }));
  assert.equal(r.code, 200);
  assert.equal(hit(routes, 'G /api/chat/notifs', reqGet(tokA, {})).body.notifs.length, 3, 'follow+like+komen masuk notif');
});

test('G /api/chat/follows + /discover: senarai dua hala + cadangan', () => {
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
  assert.equal(r.body.people.length, 2, 'Cia belum ikuti sesiapa → Ana + Ben dicadang (diri sendiri keluar)');
  chat.followUser('Cia', 'Ana');
  r = hit(routes, 'G /api/chat/discover', reqGet(tok, {}));
  assert.equal(r.body.people.length, 1, 'yang sudah diikuti tidak dicadang lagi');
  assert.equal(r.body.people[0].name, 'Ben');
});

test('P /api/chat/stories + notifs/read melalui laluan', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  chat.followUser('Ben', 'Ana');
  let r = hit(routes, 'P /api/chat/stories', reqOf(tok, { text: 'cerita hari ini' }));
  assert.equal(r.code, 200); assert.ok(r.body.story.id);
  r = hit(routes, 'G /api/chat/stories', reqGet(chat.issueSession('Ben'), {}));
  assert.equal(r.body.stories.length, 1);
  const p = hit(routes, 'P /api/chat/posts', reqOf(tok, { text: 'satu' })).body.post;
  hit(routes, 'P /api/chat/posts/like', reqOf(chat.issueSession('Ben'), { id: p.id }));
  r = hit(routes, 'P /api/chat/notifs/read', reqOf(tok, {}));
  assert.equal(r.code, 200);
  assert.equal(hit(routes, 'G /api/chat/notifs', reqGet(tok, {})).body.unread, 0);
});

test('P /api/chat/poll + /poll/vote melalui laluan: mesej 📊 + keputusan', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  assert.equal(hit(routes, 'P /api/chat/poll', reqOf('palsu', { room: 'global_am', q: 'X', opts: ['a', 'b'] })).code, 401, 'perlu login');
  const r = hit(routes, 'P /api/chat/poll', reqOf(tok, { room: 'global_am', q: 'Pilih warna', opts: ['Merah', 'Biru'] }));
  assert.equal(r.code, 200);
  assert.equal(r.body.msg.t, '📊 Pilih warna', 'mesej undian ada teks 📊');
  assert.equal(r.body.msg.pollId, r.body.poll.id, 'pollId melekat pada mesej');
  const tokB = chat.issueSession('Ben');
  const v = hit(routes, 'P /api/chat/poll/vote', reqOf(tokB, { id: r.body.poll.id, opt: 0 }));
  assert.equal(v.code, 200); assert.deepEqual(v.body.poll.counts, [1, 0]);
  assert.equal(hit(routes, 'P /api/chat/poll/vote', reqOf(tok, { id: 'tiada', opt: 0 })).code, 400, 'undi id palsu → 400');
  // baca semula — mesej undian perlu membawa pollData melalui hydrate
  const g = hit(routes, 'G /api/chat/messages', reqGet(tok, { room: 'global_am', after: 0 }));
  const pm = g.body.msgs.find(m => m.pollId === r.body.poll.id);
  assert.ok(pm && pm.pollData, 'pollData diisi semasa baca');
  assert.deepEqual(pm.pollData.counts, [1, 0]);
});

test('P /api/chat/messages: stiker diterima, mesej kosong masih ditolak', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const r = hit(routes, 'P /api/chat/messages', reqOf(tok, { room: 'global_am', text: '', sticker: '🥳' }));
  assert.equal(r.code, 200); assert.equal(r.body.msg.sticker, '🥳');
  assert.equal(hit(routes, 'P /api/chat/messages', reqOf(tok, { room: 'global_am', text: '' })).code, 400, 'kosong sebenar → 400');
});

// ─── Hashtag & repost (gaya X) ───
test('hashtag: tag dipecah, dinormalkan, dan feed boleh ditapis ikut tag', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const p1 = chat.createPost('Ana', 'cuaca hari ini #Sukan dan #sukan serta #makan').post;
  assert.deepEqual(p1.tags, ['sukan', 'makan'], 'tag lowercase + buang berulang');
  const many = chat.createPost('Ana', Array.from({ length: 12 }, (_, i) => '#tag' + i).join(' ')).post;
  assert.equal(many.tags.length, 8, 'had 8 tag satu post');
  const p2 = chat.createPost('Ana', 'post tanpa token #12x masih #Valid').post;
  assert.deepEqual(p2.tags, ['valid'], 'tag bermula angka / terlalu pendek diabaikan');
  chat.followUser('Ana', 'Ana');
  const f = chat.feedFor('Ana', null, '#SUKAN');
  assert.equal(f.posts.length, 1, 'tapem tag #SUKAN → hanya post 1');
  assert.equal(f.posts[0].id, p1.id);
  assert.equal(chat.feedFor('Ana', null, 'tiada').posts.length, 0, 'tag tak padan → kosong');
  assert.ok(chat.feedFor('Ana').posts.length >= 3, 'tanpa tap → semua kembali');
});

test('repost/quote: salin post asal + notif, repost-of-repost & lampiran ditolak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const orig = chat.createPost('Ana', 'berita baik #penting').post;
  const rp = chat.createPost('Ben', 'worth dibaca', [], { rp: orig.id });
  assert.ok(rp.ok);
  assert.equal(rp.post.t, 'worth dibaca');
  assert.ok(rp.post.rpOf, 'salinan post asal melekat');
  assert.equal(rp.post.rpOf.from, 'Ana');
  assert.equal(rp.post.rpOf.t, 'berita baik #penting');
  assert.ok(chat.notifList('Ana').notifs.some(n => n.type === 'repost'), 'penulis asal dapat notif repost');
  assert.ok(chat.createPost('Ben', 'x', [], { rp: rp.post.id }).error, 'repost atas repost → ditolak');
  assert.ok(chat.createPost('Ben', '', [], { rp: 'tiada' }).error, 'post asal tidak wujud → ditolak');
  const jpg = chat.addMedia(chat.findUser('Ben'), JPG, {});
  assert.ok(chat.createPost('Ben', '', [jpg.media.id], { rp: orig.id }).error, 'repost + lampiran → ditolak');
  // post asal boleh Like/komen seperti biasa; repost muncul dalam feed pengikut Ben
  chat.followUser('Ana', 'Ben');
  assert.ok(chat.feedFor('Ana').posts.some(p => p.id === rp.post.id && p.rpOf), 'feed membawa rpOf');
});

test('repost: padam post asal → repost turut dibuang (tiada yatim)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const orig = chat.createPost('Ana', 'sumber').post;
  const rp = chat.createPost('Ben', 'kutipan', [], { rp: orig.id }).post;
  assert.ok(chat.delPost('Ana', orig.id).ok);
  assert.equal(chat.load().posts[rp.id], undefined, 'repost yatim dibuang sekali');
  assert.ok(chat.createPost('Ben', 'lagi', [], { rp: orig.id }).error, 'asap sudah tiada → repost ditolak');
});

test('P /api/chat/posts + G /api/chat/feed?tag= melalui laluan HTTP', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  const r = hit(routes, 'P /api/chat/posts', reqOf(tok, { text: 'meriah #pesta2026' }));
  assert.equal(r.code, 200); assert.deepEqual(r.body.post.tags, ['pesta2026']);
  const orig = r.body.post.id;
  const q = hit(routes, 'P /api/chat/posts', reqOf(tok, { text: 'quote ni', repost: orig }));
  assert.equal(q.code, 200); assert.ok(q.body.post.rpOf, 'rpOf kembali melalui laluan');
  const f = hit(routes, 'G /api/chat/feed', reqGet(tok, { tag: '#Pesta2026' }));
  assert.equal(f.code, 200); assert.equal(f.body.posts.length, 1, 'tapen tag berfungsi (case-insensitive)');
  assert.equal(f.body.posts[0].id, orig);
});

// ─── Sebutan bilik @sini/@semua (gaya Google Chat) ───
test('@sini/@semua: ahli bilik kumpulan dapat notif, penulis tidak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const ben = chat.findUser('Ben');
  const g = chat.createGroup('Ana', 'Projek', [ben.id]);
  assert.ok(g.ok || g.room, 'kumpulan tercipta');
  const rid = g.room.id;
  chat.send('Ana', rid, 'mesyuarat bermula sekarang @semua');
  const bn = chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === rid);
  assert.equal(bn.length, 1, 'Ben dapat notif sebutan bilik');
  assert.equal(chat.notifList('Ana').notifs.filter(x => x.room === rid).length, 0, 'penulis tidak notify diri sendiri');
  // 'semuanya' bukan token — tidak layak dibangunkan
  const before = chat.notifList('Ben').notifs.length;
  chat.send('Ana', rid, 'itu semuanya salah faham');
  assert.equal(chat.notifList('Ben').notifs.length, before, '@semuanya (bukan token) diabaikan');
});

test('@sini: sejuk 10 minit — sebutan kedua bilik sama tidak menghantar notif', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const ben = chat.findUser('Ben');
  const g = chat.createGroup('Ana', 'Projek', [ben.id]);
  chat.send('Ana', g.room.id, 'panggilan @sini');
  chat.send('Ana', g.room.id, 'panggilan lagi @sini');
  const n = chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === g.room.id);
  assert.equal(n.length, 1, 'sebutan kedua dalam tempang sejuk → senyap');
});

test('@semua bilik global: hanya pengguna online yang dapat notif', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  chat.load().users.ben.lastSeen = Date.now();           // Ben aktif
  chat.load().users.cia.lastSeen = Date.now() - 999e3;   // Cia sudah lama senyap
  chat.send('Ana', 'global_am', 'pengumuman @semua');
  assert.ok(chat.notifList('Ben').notifs.some(x => x.type === 'mention' && x.room === 'global_am'), 'Ben (online) dapat');
  assert.equal(chat.notifList('Cia').notifs.filter(x => x.room === 'global_am').length, 0, 'Cia (offline) tidak diganggu');
});

// ─── @nama dalam mesej bilik (bukan post) ───
test('@nama dalam bilik kumpulan → notif mention dengan room', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const g = chat.createGroup('Ana', 'Projek', [chat.findUser('Ben').id]);
  const rid = g.room.id;
  chat.send('Ana', rid, 'tolong review @Ben');
  const bn = chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === rid);
  assert.equal(bn.length, 1, 'Ben disebut → notif bilik');
  assert.equal(bn[0].actor, chat.findUser('Ana').id, 'actor = Ana');
  chat.send('Ben', rid, 'oke @Ana');
  assert.ok(chat.notifList('Ana').notifs.some(x => x.type === 'mention' && x.room === rid && x.actor === chat.findUser('Ben').id), 'Ana dibalas');
});

test('@nama dalam bilik global → notif; nama rekaan diabaikan', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  chat.send('Ana', 'global_am', 'hai @Ben dan @bukanuser123');
  const mn = chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === 'global_am');
  assert.equal(mn.length, 1, 'Ben (guna sebenar) dapat notif bilik global');
});

test('@nama dalam DM tidak berganda (hanya group/global diproses)', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const dm = chat.ensureDm('Ana', 'Ben');
  chat.send('Ana', dm.id, 'rahsia @Ben');
  assert.equal(chat.notifList('Ben').notifs.filter(x => x.type === 'mention' && x.room === dm.id).length, 0, 'DM tak guna notif mention bilik');
});

// ─── ICE / TURN ───
test('iceConfig: STUN sahaja tanpa env; TURN + kredensial REST bila dikonfigur', () => {
  fresh();
  const crypto = require('crypto');
  const saved = { h: process.env.TURN_HOST, s: process.env.TURN_SECRET, p: process.env.TURN_PORT };
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  delete process.env.TURN_HOST; delete process.env.TURN_SECRET;
  let cfg = chat.iceConfig();
  assert.equal(cfg.turn, false, 'tanpa env → tiada TURN');
  assert.equal(cfg.iceServers.length, 1);
  assert.ok(String(cfg.iceServers[0].urls[0]).startsWith('stun:'));
  process.env.TURN_HOST = '203.0.113.9'; process.env.TURN_SECRET = 'rahasia123'; process.env.TURN_PORT = '3478';
  cfg = chat.iceConfig();
  assert.equal(cfg.turn, true, 'dengan env → TURN dihidup');
  assert.equal(cfg.iceServers.length, 2, 'STUN + TURN');
  const turn = cfg.iceServers[1];
  assert.ok(turn.urls.some(u => /^turn:203\.0\.113\.9:3478/.test(u)), 'URL TURN ada host+port');
  assert.match(turn.username, /^\d+:tukuk[0-9a-f]+$/, 'username "<exp>:tukuk<rand>"');
  const exp = Number(turn.username.split(':')[0]);
  assert.ok(exp > Math.floor(Date.now() / 1000), 'expiry di masa hadapan');
  assert.equal(turn.credential, crypto.createHmac('sha1', 'rahasia123').update(turn.username).digest('base64'), 'kredential ikut mekanisme REST coturn');
  restore('TURN_HOST', saved.h); restore('TURN_SECRET', saved.s); restore('TURN_PORT', saved.p);
});

test('G /api/chat/ice: 401 tanpa token; dengan login → senarai iceServers', () => {
  fresh(); chat.register('Ana', 'pass1');
  const routes = mountRoutes();
  assert.equal(hit(routes, 'G /api/chat/ice', reqGet('palsu', {})).code, 401);
  const r = hit(routes, 'G /api/chat/ice', reqGet(chat.issueSession('Ana'), {}));
  assert.equal(r.code, 200);
  assert.ok(Array.isArray(r.body.iceServers) && r.body.iceServers.length >= 1);
});

// ─── Pemulihan akaun (kod darurat sekali-pakai) ───
test('recoveryGenerate/Reset: 5 kod, sekali-pakai, kata laluan baru, sesi diluputkan', () => {
  fresh();
  chat.register('Ana', 'rahasia123');
  const g = chat.recoveryGenerate('Ana');
  assert.ok(g.ok); assert.equal(g.codes.length, 5); assert.equal(g.remaining, 5);
  const tok = chat.issueSession('Ana');
  const code = g.codes[0];
  assert.ok(chat.recoveryReset('Ana', code, 'kobil1234').ok);
  assert.ok(chat.recoveryReset('Ana', code, 'lainlagi').error, 'kod sekali-pakai → guna semula ditolak');
  assert.ok(chat.login('Ana', 'kobil1234').ok, 'kata laluan baharu berfungsi');
  assert.ok(chat.login('Ana', 'rahasia123').error, 'kata laluan lama mati');
  assert.equal(chat.userOf(tok), null, 'semua sesi lama disingkirkan');
  assert.equal(chat.load().users.ana.rec.length, 4, 'baki kod tinggal 4');
});

test('recoveryReset: kod/nama salah + kata laluan pendek ditolak', () => {
  fresh();
  chat.register('Ana', 'rahasia123');
  chat.recoveryGenerate('Ana');
  assert.ok(chat.recoveryReset('Ana', 'ZZZZZZZZZZ', 'baru1234').error, 'kod salah');
  assert.ok(chat.recoveryReset('Tiada', 'A1B2C3D4E5', 'baru1234').error, 'nama tiada');
  const g = chat.recoveryGenerate('Ana').codes[0];
  assert.ok(chat.recoveryReset('Ana', g, '123').error, 'kata laluan < 4 aksara');
});

test('P /api/chat/recovery/generate perlu login; /reset tanpa login pulangkan token', () => {
  fresh();
  chat.register('Ana', 'rahasia123');
  const routes = mountRoutes();
  assert.equal(hit(routes, 'P /api/chat/recovery/generate', reqOf('palsu', {})).code, 401, 'jana perlu login');
  const g = hit(routes, 'P /api/chat/recovery/generate', reqOf(chat.issueSession('Ana'), {}));
  assert.equal(g.code, 200); assert.equal(g.body.codes.length, 5);
  assert.equal(hit(routes, 'G /api/chat/recovery/status', reqGet(chat.issueSession('Ana'), {})).body.remaining, 5);
  const rr = hit(routes, 'P /api/chat/recovery/reset', reqOf('', { name: 'Ana', code: g.body.codes[0], pass: 'barubaru' }));
  assert.equal(rr.code, 200); assert.ok(rr.body.token, 'token sesi baru diberikan');
  assert.equal(hit(routes, 'G /api/chat/recovery/status', reqGet(rr.body.token, {})).body.remaining, 4);
});

// ─── Status (mood sementara) ───
test('setStatus: simpan teks+emoji dengan TTL sah; effStatus papar baki', () => {
  fresh();
  chat.register('Ana', 'rahasia123');
  const r = chat.setStatus('Ana', { text: 'Fokus kerja', emoji: '🎧', expiresIn: '4h' });
  assert.ok(r.ok); assert.ok(r.status);
  assert.equal(r.status.t, 'Fokus kerja'); assert.equal(r.status.e, '🎧');
  assert.ok(r.status.exp > Date.now() + 3 * 3600e3 && r.status.exp <= Date.now() + 4 * 3600e3 + 1000, 'exp ≈ 4 jam dari sekarang');
  assert.deepEqual(chat.effStatus(chat.findUser('Ana')), r.status);
});
test('setStatus: expiresIn off → tanpa luput; tamat bila kedua-dua kosong', () => {
  fresh();
  chat.register('Ana', 'rahasia123');
  const k = chat.setStatus('Ana', { text: 'Kekal', emoji: '', expiresIn: 'off' });
  assert.equal(k.status.exp, null);
  const c = chat.setStatus('Ana', { text: '  ', emoji: '', expiresIn: 'off' });
  assert.equal(c.status, null, 'teks+emoji kosong → status dibuang');
  assert.equal(chat.effStatus(chat.findUser('Ana')), null);
});
test('setStatus: teks terlalu panjang & TTL tidak dikenali ditolak', () => {
  fresh();
  chat.register('Ana', 'rahasia123');
  assert.ok(chat.setStatus('Ana', { text: 'x'.repeat(81), emoji: '🙂', expiresIn: 'off' }).error, 'teks > 80 ditolak');
  assert.ok(chat.setStatus('Ana', { text: 'ok', emoji: '🙂', expiresIn: '99j' }).error, 'TTL tak dikenal pasti');
});
test('setStatus: exp lampau → effStatus null (tidak papar)', () => {
  fresh();
  chat.register('Ana', 'rahasia123');
  chat.setStatus('Ana', { text: 'Semalam', emoji: '😴', expiresIn: 'off' });
  // manipulasi terus ke stor untuk set exp ke masa lampau
  const u = chat.findUser('Ana');
  u.status.exp = Date.now() - 1000; chat.flush();
  assert.equal(chat.effStatus(u), null);
});
test('people() & profile() sertakan status aktif', () => {
  fresh();
  chat.register('Ana', 'rahasia123'); chat.register('Ben', 'rahasia123');
  chat.setStatus('Ana', { text: 'Sibuk', emoji: '💼', expiresIn: '4h' });
  const ana = chat.findUser('Ana');
  const list = chat.people('Ana', 50, 'Ben');
  const row = list.find(p => p.id === ana.id);
  assert.ok(row && row.status && row.status.t === 'Sibuk', 'people → status');
  const prof = chat.profile('Ana', 'Ben');
  assert.equal(prof.status.t, 'Sibuk');
});
test('P /api/chat/status: perlu login; kosongkan body → status null', () => {
  fresh();
  chat.register('Ana', 'rahasia123');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  assert.equal(hit(routes, 'P /api/chat/status', reqOf('palsu', { text: 'x' })).code, 401, 'perlu login');
  const r = hit(routes, 'P /api/chat/status', reqOf(tok, { text: 'Fokus', emoji: '🎧', expiresIn: '1h' }));
  assert.equal(r.code, 200); assert.equal(r.body.status.t, 'Fokus');
  const c = hit(routes, 'P /api/chat/status', reqOf(tok, { text: '', emoji: '', expiresIn: 'off' }));
  assert.equal(c.code, 200); assert.equal(c.body.status, null);
});

// ─── Undian ───
test('createPoll: cipta undian dalam bilik global dengan soalan + pilihan', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const r = chat.createPoll('Ana', 'global_am', 'Pilih warna favoured', ['Merah', 'Biru', 'Hijau']);
  assert.ok(r.ok, 'undian berjaya dibuat');
  assert.equal(r.poll.opts.length, 3);
  assert.equal(r.poll.q, 'Pilih warna favoured');
});

test('createPoll: soalan kosong / pilihan tunggal / melebihi had ditolak', () => {
  fresh();
  chat.register('Ana', 'pass1');
  assert.ok(chat.createPoll('Ana', 'global_am', '', ['A', 'B']).error, 'soalan kosong');
  assert.ok(chat.createPoll('Ana', 'global_am', 'X', ['A']).error, 'kurang 2 pilihan');
  assert.ok(chat.createPoll('Ana', 'global_am', 'X', ['A','B','C','D','E','F','G']).error, 'melebihi 6 pilihan');
});

test('votePoll: satu undi setiap ahli + boleh ubah + kiraan betul', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const p = chat.createPoll('Ana', 'global_am', 'Suka kucing atau anjing?', ['Kucing', 'Anjing']).poll;
  chat.register('Cia', 'pass3');
  assert.ok(chat.votePoll('Ana', p.id, 0).ok, 'Ana pilih Kucing');
  assert.ok(chat.votePoll('Ben', p.id, 1).ok, 'Ben pilih Anjing');
  const r = chat.votePoll('Cia', p.id, 0);
  assert.ok(r.ok);
  assert.deepEqual(r.poll.counts, [2, 1], '2 kucing, 1 anjing');
  // ubah undian
  const r2 = chat.votePoll('Cia', p.id, 1);
  assert.deepEqual(r2.poll.counts, [1, 2], 'Cia tukar ke anjing');
  // undian tidak wujud
  assert.ok(chat.votePoll('Ana', 'tidak-wujud', 0).error);
});

test('votePoll: bukan ahli bilik ditolak', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2'); chat.register('Cia', 'pass3');
  const dm = chat.ensureDm(chat.findUser('Ana'), chat.findUser('Ben'));
  const p = chat.createPoll('Ana', dm.id, 'Makan? Ya/Tidak', ['Ya', 'Tidak']).poll;
  assert.ok(chat.votePoll('Cia', p.id, 0).error, 'Cia bukan ahli DM');
});

test('hydrate: mesej ber-pollData diisi semasa baca', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const p = chat.createPoll('Ana', 'global_am', 'Soalan', ['A', 'B']).poll;
  chat.votePoll('Ana', p.id, 1);
  // hantar mesej dengan pollId (sama seperti dilakukan laluan /api/chat/poll)
  chat.send('Ana', 'global_am', '📊 Soalan', null, null, { pollId: p.id });
  const out = chat.since('Ana', 'global_am', 0);
  const pm = out.msgs.find(m => m.pollId === p.id);
  assert.ok(pm, 'mesej ber-pollId wujud');
  const h = chat.hydrate(pm);
  assert.ok(h.pollData, 'pollData diisi ketika hydrate');
  assert.deepEqual(h.pollData.counts, [0, 1], 'Ana undi B');
});

test('route P /api/chat/poll: cipta + undi betul-betul melalui HTTP', () => {
  fresh();
  chat.register('Ana', 'pass1'); chat.register('Ben', 'pass2');
  const routes = mountRoutes();
  const tok = chat.issueSession('Ana');
  let r = hit(routes, 'P /api/chat/poll', reqOf(tok, { room: 'global_am', q: 'Pilihan raya', opts: ['A', 'B'] }));
  assert.equal(r.code, 200);
  assert.ok(r.body.poll && r.body.poll.opts.length === 2);
  const pid = r.body.poll.id;
  r = hit(routes, 'P /api/chat/poll/vote', reqOf(chat.issueSession('Ben'), { id: pid, opt: 1 }));
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.poll.counts, [0, 1]);
});

// ─── Stiker ───
test('send: sticker disimpan pada mesej, tidak menjejaskan text', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const m = chat.send('Ana', 'global_am', '👍', null, null, { sticker: '👍' }).msg;
  assert.equal(m.sticker, '👍', 'sticker disimpan');
  assert.equal(m.t, '👍', 'text asal dikekalkan');
});

test('send: sticker > 8 aksara dipotong, sticker=null tiada masalah', () => {
  fresh();
  chat.register('Ana', 'pass1');
  const m = chat.send('Ana', 'global_am', 'x', null, null, { sticker: 'a'.repeat(20) }).msg;
  assert.equal(m.sticker.length, 8, 'dipotong pada 8 aksara');
  const m2 = chat.send('Ana', 'global_am', 'y').msg;
  assert.ok(!m2.sticker, 'tiada sticker field');
});
