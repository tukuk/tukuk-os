'use strict';
// city-zones.test.js — the time-zone engine behind the world-clock family (family four).
//
// Nothing here is checked against the module's own output. The oracle is ICU's `longOffset`
// format, which is the tzdb's own answer printed a different way, plus the dates the law
// publishes (last Sunday in October, second Sunday in March, first Sunday in April in Sydney)
// plus published offsets for places whose rules are famous: Kathmandu at +05:45, Lord Howe with
// its half-hour daylight step, Samoa on +13, Iran on +03:30 with no step at all since daylight
// saving was abolished in 2022. Where the engine and ICU disagree, the page is wrong for
// everybody who reads it, so these are the tests that carry the shelf.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const CZ = require('../src/city-zones');

// ── the independent oracle ────────────────────────────────────────────────────────────────────
// "GMT+05:45" straight out of the browser engine's own table. Cached per zone because building a
// DateTimeFormat is the expensive part of this call.
const LOF = {};
function longOffset(zone, t) {
  let f = LOF[zone];
  if (!f) f = LOF[zone] = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
  const part = f.formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName');
  if (!part) throw new Error(`no offset rendered for ${zone}`);
  if (part.value === 'GMT') return 0;
  const m = part.value.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  assert.ok(m, `${zone}: unexpected offset form ${part.value}`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

// The four seasons of 2026 at noon UTC: far enough apart to sit in every daylight period the
// northern hemisphere has, and in the southern one's, and across the equinoxes.
const SAMPLES = ['2026-01-15T12:00Z', '2026-04-15T12:00Z', '2026-07-15T12:00Z', '2026-10-15T12:00Z']
  .map((s) => Date.parse(s));

const ALL = [...CZ.ALL_ZONES];

test('the engine reads the same offset ICU does, for every zone we use, in every season', () => {
  for (const zone of ALL) {
    for (const t of SAMPLES) {
      assert.equal(CZ.offsetMinutes(zone, new Date(t)), longOffset(zone, t),
        `${zone} at ${new Date(t).toISOString()}`);
    }
  }
});

test('every zone id in the table is one this runtime actually knows', () => {
  // Intl throws RangeError for an unknown id — which is how Asia/Astana was caught: it exists in
  // a newer tzdb than the one Node and browsers ship today, so it would have been a 500 in
  // production and a green test here. The module checks the same thing at require time.
  assert.deepEqual(CZ.UNUSABLE_ZONES, [], 'the module already refuses to load with a bad id');
  for (const zone of ALL) assert.doesNotThrow(() => new Date().toLocaleString('en-US', { timeZone: zone }), zone);
});

test('every city resolves, and the two tables do not overlap', () => {
  for (const c of CZ.CITIES) {
    const zone = CZ.zoneFor(c);
    assert.match(zone, /^[A-Za-z]+\/[A-Za-z0-9_+/-]+$/, `${c.name}: "${zone}" is not an IANA id`);
  }
  // A multi-zone country must have no default, or a new city in it silently inherits a coastline.
  for (const country of CZ.MULTI_ZONE_COUNTRIES) {
    assert.ok(!CZ.COUNTRY_ZONE[country], `${country} is split and must not also have a default zone`);
    assert.ok(CZ.CITIES.some((c) => c.country === country), `${country} is in the split list but not the dataset`);
  }
  // Per-city overrides are only meaningful if the city is still there; a renamed city would stop
  // being used and fall through to the country default, which is exactly the silent drift.
  const names = new Set(CZ.CITIES.map((c) => c.name));
  for (const name of Object.keys(CZ.CITY_ZONE)) {
    assert.ok(names.has(name), `CITY_ZONE names ${name}, which the dataset no longer has`);
  }
});

test('a city nobody listed is a failure, never a guess', () => {
  assert.throws(() => CZ.zoneFor({ name: 'Fakesville', country: 'United States' }), /several zones/);
  assert.throws(() => CZ.zoneFor({ name: 'Fakesville', country: 'Nowhereland' }), /no zone for country/);
  assert.throws(() => CZ.zoneFor({ name: '', country: 'France' }), /no name/);
  assert.throws(() => CZ.zoneFor(undefined), /no name/);
});

// ── offsets the published rules are known for ─────────────────────────────────────────────────
test('the famous offsets are the published ones, to the minute', () => {
  const jan = Date.parse('2026-01-15T12:00Z');
  const jul = Date.parse('2026-07-15T12:00Z');
  const cases = [
    // quarter-hour and half-hour zones: the ones a longitude formula cannot get right
    ['Asia/Kathmandu', jan, 345], ['Asia/Kathmandu', jul, 345],
    ['Pacific/Chatham', jan, 825], ['Pacific/Chatham', jul, 765], // +13:45 / +12:45
    ['Australia/Lord_Howe', jan, 660], ['Australia/Lord_Howe', jul, 630], // a half-hour DST step
    ['Asia/Kabul', jan, 270], ['Asia/Tehran', jan, 210], ['Asia/Tehran', jul, 210], // no DST since 2022
    ['Asia/Yangon', jan, 390], ['Asia/Kolkata', jan, 330],
    // the whole hour, both hemispheres, and the zones that never move
    ['Europe/London', jan, 0], ['Europe/London', jul, 60],
    ['America/New_York', jan, -300], ['America/New_York', jul, -240],
    ['Australia/Sydney', jan, 660], ['Australia/Sydney', jul, 600],
    ['Asia/Dubai', jan, 240], ['Asia/Dubai', jul, 240],
    ['Asia/Tokyo', jul, 540], ['America/Phoenix', jul, -420], // Arizona keeps standard time
    ['Pacific/Apia', jan, 780], ['Pacific/Apia', jul, 780], // +13, and no DST since 2021
    ['Pacific/Kiritimati', jan, 840], // UTC+14, the earliest clock on Earth
    ['Africa/Cairo', jan, 120], ['Africa/Cairo', jul, 180], // DST reintroduced in 2023
    ['Asia/Almaty', jan, 300], ['Asia/Almaty', jul, 300], // Kazakhstan unified on UTC+5 in 2024
  ];
  for (const [zone, t, want] of cases) {
    assert.equal(CZ.offsetMinutes(zone, new Date(t)), want, `${zone} at ${new Date(t).toISOString()}`);
    assert.equal(longOffset(zone, t), want, `ICU disagrees with the published figure for ${zone}`);
  }
});

// ── the dates the law publishes ───────────────────────────────────────────────────────────────
test('the clock-change instants are the ones the statutes describe', () => {
  const nc = (zone, from) => {
    const d = CZ.nextChange(zone, new Date(from));
    return d ? d.toISOString() : null;
  };
  const jun = '2026-06-15T12:00Z';
  const jan = '2026-01-15T12:00Z';
  // EU: last Sunday in March and October, at 01:00 UTC — so every member state steps at the same
  // instant, which is why no pair inside the bloc has a moving difference.
  assert.equal(nc('Europe/London', jan), '2026-03-29T01:00:00.000Z', 'last Sunday of March');
  assert.equal(nc('Europe/London', jun), '2026-10-25T01:00:00.000Z', 'last Sunday of October');
  assert.equal(nc('Europe/Paris', jun), nc('Europe/London', jun), 'the bloc steps together');
  // US: second Sunday in March at 02:00 local (07:00Z from EST), first Sunday in November at
  // 02:00 local (06:00Z from EDT).
  assert.equal(nc('America/New_York', jan), '2026-03-08T07:00:00.000Z', 'second Sunday of March');
  assert.equal(nc('America/New_York', jun), '2026-11-01T06:00:00.000Z', 'first Sunday of November');
  // Southern hemisphere, mirrored: first Sunday in April and October.
  assert.equal(nc('Australia/Sydney', jan), '2026-04-04T16:00:00.000Z', '03:00 AEDT on the first Sunday of April');
  assert.equal(nc('Australia/Sydney', jun), '2026-10-03T16:00:00.000Z', '02:00 AEST on the first Sunday of October');
  // The awkward ones, which only a real tzdb gets right: Chatham at 02:45 on the last Sunday of
  // September, and Lord Howe, whose daylight step is thirty minutes rather than an hour.
  assert.equal(nc('Pacific/Chatham', jun), '2026-09-26T14:00:00.000Z', '02:45 +12:45, last Sunday of September');
  assert.equal(nc('Australia/Lord_Howe', jan), '2026-04-04T15:00:00.000Z', 'Lord Howe ends DST at 02:00 → 02:30');
  assert.equal(nc('Australia/Lord_Howe', jun), '2026-10-03T15:30:00.000Z', 'and starts it with a 30-minute step');
  // Egypt restarts on the last Friday of April at midnight local, which is 22:00 UTC the day before.
  assert.equal(nc('Africa/Cairo', jan), '2026-04-23T22:00:00.000Z', 'last Friday of April, at midnight in Cairo');
  // And the majority of the world, which does not move at all: null is the honest answer.
  for (const zone of ['Asia/Tokyo', 'Asia/Dubai', 'Asia/Kolkata', 'America/Phoenix', 'Africa/Lagos',
    'Asia/Shanghai', 'Asia/Singapore', 'America/Sao_Paulo', 'Asia/Almaty', 'Pacific/Apia']) {
    assert.equal(nc(zone, jan), null, `${zone} must report no change inside 200 days`);
  }
});

test('the yearly summary reads the whole year, not two spot dates', () => {
  // Fiji and the southern zones are the trap in a January/July sampler: their summer sits in the
  // January window, so two spot samples can call a moving zone fixed.
  const syd = CZ.offsetsOfYear('Australia/Sydney', 2026);
  assert.equal(syd.standard, 600, 'standard time is the smaller offset, not the winter one by name');
  assert.equal(syd.daylight, 660);
  assert.equal(syd.observes, true);
  const kat = CZ.offsetsOfYear('Asia/Kathmandu', 2026);
  assert.deepEqual([kat.standard, kat.daylight, kat.observes], [345, 345, false]);
  const howe = CZ.offsetsOfYear('Australia/Lord_Howe', 2026);
  assert.deepEqual([howe.standard, howe.daylight, howe.observes], [630, 660, true], 'the half-hour step');
  const tehran = CZ.offsetsOfYear('Asia/Tehran', 2026);
  assert.equal(tehran.observes, false, 'Iran abolished daylight saving in 2022');
  // A daily sample is 365 days, or 366 in a leap year.
  assert.equal(CZ.yearSignature('Europe/London', 2026).length, 365);
  assert.equal(CZ.yearSignature('Europe/London', 2027).length, 365);
  assert.equal(CZ.yearSignature('Europe/London', 2028).length, 366, '2028 is a leap year');
  const sig = CZ.yearSignature('Europe/London', 2026);
  assert.deepEqual([...new Set(sig)].sort((a, b) => a - b), [0, 60]);
  // The steps in the sample have to land on the dates the statute publishes.
  const day = (n) => new Date(Date.UTC(2026, 0, 1 + n, 12)).toISOString().slice(0, 10);
  const steps = sig.map((v, i) => (i && sig[i - 1] !== v ? day(i) : null)).filter(Boolean);
  assert.deepEqual(steps, ['2026-03-29', '2026-10-25'], 'the daily signature must step on those two dates');
});

// ── wall time ⇄ instant ───────────────────────────────────────────────────────────────────────
test('a wall clock time resolves to the instant that reads back exactly that time', () => {
  const zones = ['Europe/London', 'America/New_York', 'Asia/Kathmandu', 'Australia/Lord_Howe',
    'Pacific/Chatham', 'Asia/Tokyo', 'America/Sao_Paulo', 'Africa/Cairo', 'Pacific/Apia'];
  for (const zone of zones) {
    // Every day of 2026 at noon, and at half past — which is the hour a spring-forward day
    // swallows, so the exact round trip is only promised where the wall clock really shows it.
    // The expected date is worked from a real Date rather than from the loop counter, because
    // day 32 of January *is* 1 February and instantFor normalises that rollover the way Date does.
    for (let d = 1; d <= 365; d += 1) {
      const want = new Date(Date.UTC(2026, 0, d));
      const t = CZ.instantFor(zone, 2026, 0, d, 12, 0);
      const p = CZ.partsIn(zone, new Date(t));
      assert.deepEqual(
        [p.year, p.month, p.day, p.hour, p.minute],
        [want.getUTCFullYear(), want.getUTCMonth() + 1, want.getUTCDate(), 12, 0],
        `${zone}: noon on day ${d} resolved to ${JSON.stringify(p)}`
      );
    }
    for (let d = 1; d <= 365; d += 7) {
      const want = new Date(Date.UTC(2026, 0, d));
      const t = CZ.instantFor(zone, 2026, 0, d, 12, 30);
      const p = CZ.partsIn(zone, new Date(t));
      assert.equal(p.minute, 30, `${zone}: half past must survive day ${d}`);
      assert.equal(p.hour, 12, `${zone}: no rule in the table jumps over noon`);
      assert.deepEqual([p.month, p.day], [want.getUTCMonth() + 1, want.getUTCDate()], `${zone}: day ${d} date drift`);
    }
  }
  // The published instants, checked by hand rather than by the function: 12:00 in Tokyo is 03:00
  // UTC, 12:00 in New York in summer is 16:00 UTC, 12:00 in Kathmandu is 06:15 UTC.
  assert.equal(new Date(CZ.instantFor('Asia/Tokyo', 2026, 6, 1, 12, 0)).toISOString(), '2026-07-01T03:00:00.000Z');
  assert.equal(new Date(CZ.instantFor('America/New_York', 2026, 6, 1, 12, 0)).toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(new Date(CZ.instantFor('Asia/Kathmandu', 2026, 0, 15, 12, 0)).toISOString(), '2026-01-15T06:15:00.000Z');
  // A time the clock never showed resolves to a neighbouring real instant instead of inventing one
  // and, crucially, is *detectable* as such — which is what the pages' badge keys off.
  const gap = CZ.instantFor('America/New_York', 2026, 2, 8, 2, 30);
  const read = CZ.partsIn('America/New_York', new Date(gap));
  assert.notEqual(read.hour, 2, '02:30 does not exist on 8 March 2026 in New York, so it must not be reported back');
  assert.ok([1, 3].includes(read.hour), `the fallback must land next to the jump, got ${read.hour}:30`);
});

// ── the working window ────────────────────────────────────────────────────────────────────────
test('the shared working window is what a real clock conversion says it is', () => {
  // The sign trap: the two readings of one instant differ by offB − offA. Writing it the other way
  // round mirrors every window through midday and still looks plausible, so the truth is built from
  // instants here — an entirely different code path from the modular arithmetic under test.
  const grid = ['America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Kathmandu',
    'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'America/Los_Angeles', 'America/Phoenix',
    'Africa/Lagos', 'Asia/Dubai', 'Pacific/Honolulu', 'America/Sao_Paulo', 'Pacific/Chatham',
    'Australia/Lord_Howe', 'Asia/Tehran', 'Europe/Dublin', 'Pacific/Kiritimati', 'Asia/Shanghai',
    'Europe/Moscow', 'Africa/Cairo', 'Asia/Jerusalem', 'Pacific/Apia'];
  const t = Date.parse('2026-07-15T12:00Z');
  let pairs = 0;
  for (const a of grid) {
    for (const b of grid) {
      pairs += 1;
      const want = [];
      for (let h = 9; h < 17; h += 1) {
        const instant = CZ.instantFor(a, 2026, 6, 15, h, 0);
        const p = CZ.partsIn(b, new Date(instant));
        if (p.hour >= 9 && p.hour < 17) want.push(h);
      }
      assert.deepEqual(CZ.workingOverlap(CZ.offsetMinutes(a, new Date(t)), CZ.offsetMinutes(b, new Date(t))),
        want, `${a} → ${b}`);
    }
  }
  // Two known answers, worked out by hand: New York (−4) and London (+1) share 09:00–12:00 New
  // York time; a pair nine hours apart shares nothing.
  assert.deepEqual(CZ.workingOverlap(-240, 60), [9, 10, 11], '09:00–12:00 in New York is 14:00–17:00 in London');
  assert.deepEqual(CZ.workingOverlap(-300, 480), [], 'Los Angeles and Tokyo have no shared working hour');
  assert.equal(pairs, grid.length * grid.length);
});

test('an hour of difference is seven shared hours, and the arithmetic is the clock\'s', () => {
  assert.deepEqual(CZ.workingOverlap(0, 60), [9, 10, 11, 12, 13, 14, 15], 'one hour apart leaves 09:00–16:00 in A');
  assert.deepEqual(CZ.workingOverlap(60, 0), [10, 11, 12, 13, 14, 15, 16], 'and the mirror starts an hour later');
  // London (UTC+0 in winter) against Kolkata (+05:30): 09:00 London is 14:30 in Kolkata, 12:00
  // London is 17:30 — already home. That the half hour lands where the clock says it does is the
  // whole point of computing this from offsets rather than from an abbreviation table.
  assert.deepEqual(CZ.workingOverlap(0, 330), [9, 10, 11], '09:00–12:00 London is 14:30–17:30 Kolkata');
});

// ── the text the pages print ──────────────────────────────────────────────────────────────────
test('the number formatting a visitor reads is the number the engine computed', () => {
  assert.equal(CZ.diffLabel(300), '5 hours');
  assert.equal(CZ.diffLabel(60), '1 hour');
  assert.equal(CZ.diffLabel(330), '5 h 30 min');
  assert.equal(CZ.diffLabel(30), '30 minutes', 'half past is written as minutes, never as "0 h 30 min"');
  assert.equal(CZ.diffLabel(15), '15 minutes');
  assert.equal(CZ.diffLabel(45), '45 minutes');
  assert.equal(CZ.diffLabel(-225), '3 h 45 min', 'the label carries a magnitude; direction is said in words');
  assert.equal(CZ.gmtLabel(345), 'GMT+5:45');
  assert.equal(CZ.gmtLabel(-330), 'GMT−5:30', 'a real minus sign, not a hyphen');
  assert.equal(CZ.gmtLabel(60), 'GMT+1', 'no pointless :00');
  assert.equal(CZ.gmtLabel(0), 'GMT+0');
  assert.equal(CZ.gmtLabel(840), 'GMT+14');
  assert.equal(CZ.clockText(0), '00:00', 'midnight is padded');
  assert.equal(CZ.clockText(1020), '17:00');
  assert.equal(CZ.clockText(-30), '23:30', 'a negative minute count wraps, it does not print −00:30');
  assert.equal(CZ.clockText(1470), '00:30', 'and past midnight it wraps forward');
});
