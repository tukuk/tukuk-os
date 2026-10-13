'use strict';
// Ujian backend Tukuk Chat (src/chat.js) — logik murni, tiada pelayan HTTP.
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
