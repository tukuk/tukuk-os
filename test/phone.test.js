'use strict';
// Ujian Phone Finder — parser penomboran diekstrak VERBATIM dari blok inline dalam
// public/apps/netsec.html (sumber sebenar yang dihantar ke pelayar), lalu dijalankan
// dalam sandbox `new Function`. Tiada pelayar/rangkaian dimuatkan — parsePhone hanya
// guna String/RegExp/Date/Intl (semua ada dalam Node), jadi vektor nyata diuji terus.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'apps', 'netsec.html'), 'utf8');
const start = html.indexOf("const CC = [['1','United States / Canada','US']");
const end = html.indexOf('function renderPhone');
assert.ok(start > 0 && end > start, 'blok phone finder tidak ditemui dalam netsec.html');
const parsePhone = new Function(`${html.slice(start, end)}\nreturn parsePhone;`)();

test('Malaysia mobil: negara+bendera, jenis, format, pautan, waktu tempatan', () => {
  const p = parsePhone('+60145995758');
  assert.equal(p.country, 'Malaysia');
  assert.equal(p.iso, 'MY');
  assert.equal(p.flag, '🇲🇾');
  assert.equal(p.cc, '+60');
  assert.equal(p.national, '145995758');
  assert.equal(p.type.label, 'mobile');
  assert.equal(p.valid, true);
  assert.equal(p.natFmt, '14 599 5758');
  assert.equal(p.area, null);
  assert.equal(p.links.wa, 'https://wa.me/60145995758');
  assert.equal(p.links.tg, 'https://t.me/+60145995758');
  assert.equal(p.links.sk, 'skype:+60145995758?call');
  assert.equal(p.links.tel, 'tel:+60145995758');
  assert.match(p.local, /^\d{2}:\d{2}$/);
  assert.match(p.tz, /^UTC[+-]\d{1,2}(:30)?$/);
  assert.equal(p.capital, 'Kuala Lumpur');
});

test('Malaysia fixed: kawasan ikut kod wilayah MCMC', () => {
  assert.equal(parsePhone('+60321456789').area, 'Kuala Lumpur / Selangor / Putrajaya / Pahang');
  assert.equal(parsePhone('+60321456789').type.label, 'fixed line');
  assert.equal(parsePhone('+6088123456').area, 'Sabah / Sarawak');
  assert.equal(parsePhone('+6088123456').type.label, 'fixed line');
});

test('NANP: toll-free, premium-rate dan amalan kawasan', () => {
  assert.equal(parsePhone('+18001234567').type.label, 'toll-free (free caller)');
  assert.equal(parsePhone('+19001234567').type.label, 'premium-rate (can be expensive!)');
  assert.equal(parsePhone('+12124567890').type.key, 'na');
  assert.equal(parsePhone('+12124567890').natFmt, '212 456 7890');
});

test('UK & SG: jenis mobil + format nasional; AU toll-free', () => {
  assert.equal(parsePhone('+447911123456').type.label, 'mobile');
  assert.equal(parsePhone('+447911123456').natFmt, '79111 23456');
  assert.equal(parsePhone('+6561234567').valid, true);
  assert.equal(parsePhone('+6561234567').natFmt, '6123 4567');
  assert.equal(parsePhone('+611800123456').type.label, 'toll-free (free caller)');
});

test('input pelbagai format dinormalisasi; rosak ditolak', () => {
  assert.equal(parsePhone('0060145995758').e164, '+60145995758');
  assert.equal(parsePhone('+60 14-599 5758').e164, '+60145995758');
  assert.equal(parsePhone('+60 (14) 5995758').e164, '+60145995758');
  assert.ok(parsePhone('0145995758').warn);
  assert.ok(parsePhone('+60abc123').err);
  assert.equal(parsePhone('   '), null);
});

test('kod negara terpanjang menang (352 bukan 35/3)', () => {
  assert.equal(parsePhone('+35226123456').country, 'Luxembourg');
});

test('negara tanpa pelan terperinci → nota jujur, asas kekal jalan', () => {
  const ge = parsePhone('+995551234567');
  assert.match(ge.note, /not bundled/);
  assert.equal(ge.e164, '+995551234567');
});

test('panjang luar julat negara → valid false + nota amaran', () => {
  const p = parsePhone('+6014599575812');
  assert.equal(p.valid, false);
  assert.match(p.note, /official/);
});
