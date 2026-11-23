'use strict';
// city-zones.js — the IANA time zone of every city in src/kota-data.json, plus the small
// amount of maths needed to turn two of them into an honest answer.
//
// Why a hand-authored table instead of a longitude formula: a time zone is a law, not a
// meridian. China runs one offset across five geographic hours, Nepal is +05:45, Samoa jumped
// a whole dateline day in 2011, Arizona does not change while its neighbours do, and Indonesia
// has three zones on one island chain. Anything derived from coordinates would be wrong often
// enough to make these pages lie, so every city is named here and the few genuinely split
// countries carry per-city entries.
//
// The rules this module enforces by construction:
//   • a country listed in MULTI_ZONE_COUNTRIES has no default — every one of its cities must be
//     in CITY_ZONE, so a new US or Australian city fails loudly instead of quietly inheriting
//     the wrong offset;
//   • nothing is fetched: every offset comes from Intl.DateTimeFormat, which reads the time-zone
//     database already inside Node and inside the visitor's browser. That is also why the pages
//     say which rules they followed — a stale tzdb in someone's browser gives a stale answer,
//     and governments do change rules at short notice.

const CITIES = require('./kota-data.json');

// Countries whose cities do not all share one zone. There is deliberately no entry for these in
// COUNTRY_ZONE: zoneFor() throws rather than guessing when one of their cities is missing below.
const MULTI_ZONE_COUNTRIES = new Set([
  'United States', 'Canada', 'Australia', 'Mexico', 'Indonesia', 'Brazil', 'Kazakhstan', 'Malaysia',
]);

// One entry per city in a split country. Zone ids are the canonical tzdb names.
const CITY_ZONE = {
  // United States — the contiguous four, plus the two states that break the pattern and Hawaii
  'New York City': 'America/New_York',
  'Washington, D.C.': 'America/New_York',
  Boston: 'America/New_York',
  Miami: 'America/New_York',
  Philadelphia: 'America/New_York',
  Atlanta: 'America/New_York',
  Detroit: 'America/New_York',
  Nashville: 'America/Chicago',
  Chicago: 'America/Chicago',
  'New Orleans': 'America/Chicago',
  Houston: 'America/Chicago',
  Denver: 'America/Denver',
  'Salt Lake City': 'America/Denver',
  'Los Angeles': 'America/Los_Angeles',
  'San Francisco': 'America/Los_Angeles',
  Seattle: 'America/Los_Angeles',
  Portland: 'America/Los_Angeles',
  'San Diego': 'America/Los_Angeles',
  'Las Vegas': 'America/Los_Angeles',
  Phoenix: 'America/Phoenix', // Arizona stays on standard time all year
  Honolulu: 'Pacific/Honolulu',
  // Canada
  Toronto: 'America/Toronto',
  Ottawa: 'America/Toronto',
  'Quebec City': 'America/Toronto',
  Montreal: 'America/Montreal',
  Calgary: 'America/Edmonton',
  Edmonton: 'America/Edmonton',
  Vancouver: 'America/Vancouver',
  // Australia — NSW/VIC/ACT/TAS differ from QLD (no DST), SA/NT (half hour) and WA (a different
  // summer rule), so each city is named rather than grouped by state
  Sydney: 'Australia/Sydney',
  Canberra: 'Australia/Sydney',
  Newcastle: 'Australia/Sydney',
  Melbourne: 'Australia/Melbourne',
  Geelong: 'Australia/Melbourne',
  Hobart: 'Australia/Hobart',
  Brisbane: 'Australia/Brisbane',
  'Gold Coast': 'Australia/Brisbane',
  Cairns: 'Australia/Brisbane',
  Perth: 'Australia/Perth',
  Adelaide: 'Australia/Adelaide',
  Darwin: 'Australia/Darwin',
  // Mexico — the 2022 reform abolished DST across most of the country, but not everywhere
  'Mexico City': 'America/Mexico_City',
  Guadalajara: 'America/Mexico_City',
  Oaxaca: 'America/Mexico_City',
  Monterrey: 'America/Monterrey',
  'Cancún': 'America/Cancun', // Quintana Roo is on Eastern, not Central
  Merida: 'America/Merida',
  'Puerto Vallarta': 'America/Bahia_Banderas',
  Tijuana: 'America/Tijuana', // Baja California keeps the US Pacific rule
  // Indonesia — WIB / WITA / WIT
  Jakarta: 'Asia/Jakarta',
  Surabaya: 'Asia/Jakarta',
  Bandung: 'Asia/Jakarta',
  Yogyakarta: 'Asia/Jakarta',
  Medan: 'Asia/Jakarta', // Sumatra is western time despite the longitude
  Denpasar: 'Asia/Makassar', // Bali is central
  // Brazil
  'São Paulo': 'America/Sao_Paulo',
  'Rio de Janeiro': 'America/Sao_Paulo',
  'Brasília': 'America/Bahia', // the capital belt is one zone east of São Paulo
  // Kazakhstan — the 2024 unification put the whole country on UTC+5. There is no Asia/Astana in
  // the tzdb Node and browsers ship today (it would be Asia/Almaty's rules), so both cities use
  // the id that exists and the two are then the same behaviour class, which is the truth.
  Almaty: 'Asia/Almaty',
  Astana: 'Asia/Almaty',
  // Malaysia — peninsular and Borneo share +08:00 under two zone ids
  'Kuala Lumpur': 'Asia/Kuala_Lumpur',
  'George Town': 'Asia/Kuala_Lumpur',
  Melaka: 'Asia/Kuala_Lumpur',
  Kuching: 'Asia/Kuching',
  'Kota Kinabalu': 'Asia/Kuching',
};

// Every other country in the dataset, by its own capital's zone. Keys are the exact country
// strings used by src/kota-data.json.
const COUNTRY_ZONE = {
  Afghanistan: 'Asia/Kabul',
  Albania: 'Europe/Tirane',
  Algeria: 'Africa/Algiers',
  Andorra: 'Europe/Andorra',
  Angola: 'Africa/Luanda',
  Argentina: 'America/Argentina/Buenos_Aires',
  Armenia: 'Asia/Yerevan',
  Austria: 'Europe/Vienna',
  Azerbaijan: 'Asia/Baku',
  Bangladesh: 'Asia/Dhaka',
  Barbados: 'America/Barbados',
  Belarus: 'Europe/Minsk',
  Belgium: 'Europe/Brussels',
  Benin: 'Africa/Porto-Novo',
  Bolivia: 'America/La_Paz',
  'Bosnia and Herzegovina': 'Europe/Sarajevo',
  Botswana: 'Africa/Gaborone',
  Bulgaria: 'Europe/Sofia',
  'Burkina Faso': 'Africa/Ouagadougou',
  Burundi: 'Africa/Bujumbura',
  Cambodia: 'Asia/Phnom_Penh',
  Cameroon: 'Africa/Douala',
  Chile: 'America/Santiago',
  China: 'Asia/Shanghai',
  Colombia: 'America/Bogota',
  'Costa Rica': 'America/Costa_Rica',
  Croatia: 'Europe/Zagreb',
  Cuba: 'America/Havana',
  Czechia: 'Europe/Prague',
  Denmark: 'Europe/Copenhagen',
  Djibouti: 'Africa/Djibouti',
  'Dominican Republic': 'America/Santo_Domingo',
  Ecuador: 'America/Guayaquil',
  Egypt: 'Africa/Cairo',
  Eritrea: 'Africa/Asmara',
  Estonia: 'Europe/Tallinn',
  Ethiopia: 'Africa/Addis_Ababa',
  Fiji: 'Pacific/Fiji',
  Finland: 'Europe/Helsinki',
  France: 'Europe/Paris',
  Gabon: 'Africa/Libreville',
  Georgia: 'Asia/Tbilisi',
  Germany: 'Europe/Berlin',
  Ghana: 'Africa/Accra',
  Greece: 'Europe/Athens',
  Guinea: 'Africa/Conakry',
  Guyana: 'America/Guyana',
  Hungary: 'Europe/Budapest',
  Iceland: 'Atlantic/Reykjavik',
  India: 'Asia/Kolkata',
  Iran: 'Asia/Tehran',
  Iraq: 'Asia/Baghdad',
  Ireland: 'Europe/Dublin',
  Israel: 'Asia/Jerusalem',
  Italy: 'Europe/Rome',
  'Ivory Coast': 'Africa/Abidjan',
  Jamaica: 'America/Jamaica',
  Japan: 'Asia/Tokyo',
  Jordan: 'Asia/Amman',
  Kenya: 'Africa/Nairobi',
  Kuwait: 'Asia/Kuwait',
  Kyrgyzstan: 'Asia/Bishkek',
  Laos: 'Asia/Vientiane',
  Latvia: 'Europe/Riga',
  Lebanon: 'Asia/Beirut',
  Libya: 'Africa/Tripoli',
  Lithuania: 'Europe/Vilnius',
  Luxembourg: 'Europe/Luxembourg',
  Madagascar: 'Indian/Antananarivo',
  Malawi: 'Africa/Blantyre',
  Mali: 'Africa/Bamako',
  Maldives: 'Indian/Maldives',
  Malta: 'Europe/Malta',
  Mauritius: 'Indian/Mauritius',
  Moldova: 'Europe/Chisinau',
  Mongolia: 'Asia/Ulaanbaatar',
  Montenegro: 'Europe/Podgorica',
  Morocco: 'Africa/Casablanca',
  Mozambique: 'Africa/Maputo',
  Myanmar: 'Asia/Yangon',
  Namibia: 'Africa/Windhoek',
  Nepal: 'Asia/Kathmandu',
  Netherlands: 'Europe/Amsterdam',
  'New Caledonia': 'Pacific/Noumea',
  'New Zealand': 'Pacific/Auckland',
  Niger: 'Africa/Niamey',
  Nigeria: 'Africa/Lagos',
  'North Macedonia': 'Europe/Skopje',
  Norway: 'Europe/Oslo',
  Oman: 'Asia/Muscat',
  Pakistan: 'Asia/Karachi',
  Panama: 'America/Panama',
  'Papua New Guinea': 'Pacific/Port_Moresby',
  Paraguay: 'America/Asuncion',
  Peru: 'America/Lima',
  Philippines: 'Asia/Manila',
  Poland: 'Europe/Warsaw',
  Portugal: 'Europe/Lisbon',
  'Puerto Rico': 'America/Puerto_Rico',
  Qatar: 'Asia/Qatar',
  Romania: 'Europe/Bucharest',
  Russia: 'Europe/Moscow',
  Rwanda: 'Africa/Kigali',
  Samoa: 'Pacific/Apia',
  'Saudi Arabia': 'Asia/Riyadh',
  Senegal: 'Africa/Dakar',
  Serbia: 'Europe/Belgrade',
  'Sierra Leone': 'Africa/Freetown',
  Singapore: 'Asia/Singapore',
  Slovakia: 'Europe/Bratislava',
  Slovenia: 'Europe/Ljubljana',
  'Solomon Islands': 'Pacific/Guadalcanal',
  Somalia: 'Africa/Mogadishu',
  'South Africa': 'Africa/Johannesburg',
  'South Korea': 'Asia/Seoul',
  Spain: 'Europe/Madrid',
  'Sri Lanka': 'Asia/Colombo',
  Sudan: 'Africa/Khartoum',
  Suriname: 'America/Paramaribo',
  Sweden: 'Europe/Stockholm',
  Switzerland: 'Europe/Zurich',
  Syria: 'Asia/Damascus',
  Tajikistan: 'Asia/Dushanbe',
  Tanzania: 'Africa/Dar_es_Salaam',
  Thailand: 'Asia/Bangkok',
  Togo: 'Africa/Lome',
  Tonga: 'Pacific/Tongatapu',
  'Trinidad and Tobago': 'America/Port_of_Spain',
  Tunisia: 'Africa/Tunis',
  Turkey: 'Europe/Istanbul',
  Turkmenistan: 'Asia/Ashgabat',
  Uganda: 'Africa/Kampala',
  Ukraine: 'Europe/Kyiv',
  'United Arab Emirates': 'Asia/Dubai',
  'United Kingdom': 'Europe/London',
  Uruguay: 'America/Montevideo',
  Uzbekistan: 'Asia/Tashkent',
  Vanuatu: 'Pacific/Efate',
  Venezuela: 'America/Caracas',
  Vietnam: 'Asia/Ho_Chi_Minh',
  Zambia: 'Africa/Lusaka',
  Zimbabwe: 'Africa/Harare',
};

function zoneFor(city) {
  const name = city && city.name;
  if (!name) throw new Error('zoneFor: city has no name');
  if (CITY_ZONE[name]) return CITY_ZONE[name];
  if (MULTI_ZONE_COUNTRIES.has(city.country)) {
    throw new Error('zoneFor: ' + name + ' is in ' + city.country + ', which has several zones, '
      + 'and no CITY_ZONE entry — add it instead of inheriting a default');
  }
  const z = COUNTRY_ZONE[city.country];
  if (!z) throw new Error('zoneFor: no zone for country ' + city.country + ' (city ' + name + ')');
  return z;
}

// ── the offset maths, from Intl alone ───────────────────────────────────────────────────────
const FMT = {};
function partsIn(zone, t) {
  let f = FMT[zone];
  if (!f) f = FMT[zone] = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o = {};
  for (const p of f.formatToParts(t)) if (p.type !== 'literal') o[p.type] = p.value;
  // %24 because some locales report midnight as hour 24 rather than 0; the rest of this module
  // treats hour as a 0-23 civil hour.
  o.hour = (+o.hour) % 24;
  o.minute = +o.minute; o.second = +o.second; o.year = +o.year; o.month = +o.month; o.day = +o.day;
  return o;
}

// UTC milliseconds whose wall clock in `zone` is the same as `t`'s instant in that zone.
function wallAsUtc(zone, t) {
  const p = partsIn(zone, t);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// Offset of a zone at an instant, in minutes east of UTC. (wall clock read as UTC) − (real UTC).
// Half-hour and three-quarter-hour zones therefore come out exactly: Kathmandu 345, Lord Howe 630.
function offsetMinutes(zone, t) {
  const ms = wallAsUtc(zone, t) - t.getTime();
  if (!Number.isFinite(ms)) throw new Error('offsetMinutes: bad zone ' + zone);
  return Math.round(ms / 60000);
}

// The two offsets a year produces, read off the daily signature rather than from two spot
// samples: sampling January and July alone calls Fiji "fixed" because its summer ends in the
// January window. standard is the smallest offset the year contains, daylight the largest, and a
// zone "observes" only when the two differ — which by construction catches the four-change zones
// too, because a third distinct offset would still show up as more than one value in the set.
function summaryOf(signature) {
  const seen = new Set(signature);
  const values = [...seen].sort((a, b) => a - b);
  return {
    standard: values[0],
    daylight: values[values.length - 1],
    observes: values.length > 1,
    distinct: values,
  };
}

function offsetsOfYear(zone, year) {
  return summaryOf(yearSignature(zone, year));
}

// The next instant `zone` changes its offset after `from`, found by bisection on a function that
// is constant except at one step within the horizon. Returns null when nothing changes in the
// window, which is the honest answer for the ~70 per cent of the world's zones that never move.
//
// The window closes at one second and the answer is then floored to the minute. Every modern
// tzdb transition lands on a whole minute, so a `hi` at most a second past the step always
// floors back to the step itself; bisecting only to a minute would sometimes return the minute
// after it and print a change date an hour off, which is exactly the kind of almost-right figure
// these pages cannot afford. The browser script mirrors both the bound and the floor.
function nextChange(zone, from, horizonDays) {
  const limit = horizonDays || 200;
  const end = from.getTime() + limit * 86400000;
  const base = offsetMinutes(zone, from);
  if (offsetMinutes(zone, new Date(end)) === base) return null;
  let lo = from.getTime(), hi = end;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMinutes(zone, new Date(mid)) === base) lo = mid; else hi = mid;
  }
  return new Date(Math.floor(hi / 60000) * 60000);
}

// A daily sample of the year: the offset at midday UTC on each of the 366 days. Two zones agree
// on this array if and only if their whole offset history over the year agrees, which is what
// makes it the identity of a behaviour class. Midday UTC is deliberate — every civil transition
// in the table happens somewhere between 00:00 and 23:00 UTC, so a single daily sample cannot sit
// on the wrong side of a change and a leap-day year costs one extra format per zone.
function yearSignature(zone, year) {
  const out = [];
  const start = Date.UTC(year, 0, 1, 12);
  const days = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  for (let d = 0; d < days; d += 1) out.push(offsetMinutes(zone, new Date(start + d * 86400000)));
  return out;
}

// The instant whose wall clock in `zone` reads exactly y-mo-d hh:mm. Solved by guessing from the
// offset at the naive UTC instant and correcting twice, because the offset at the answer can be
// the one on the other side of a transition.
//
// Two inputs have no answer, and this returns a real neighbouring instant for both rather than
// pretending: a spring-forward hour, whose wall clock never reads 02:30 (the correction loop then
// oscillates between the last reading before the jump and the first after it), and a repeated
// fall-back hour, which has two correct answers and returns whichever the iteration reached. The
// clock pages therefore print the *resolved* reading, not the requested one, and say in a badge
// when the two differ — see SCRIPT_CLOCK and clockEntry, which do the same two checks.
// The browser script mirrors this loop line for line, so both sides resolve identically.
function instantFor(zone, y, mo, d, hh, mi) {
  const want = Date.UTC(y, mo, d, hh, mi);
  let t = want - offsetMinutes(zone, new Date(want)) * 60000;
  for (let k = 0; k < 3; k += 1) {
    const p = partsIn(zone, new Date(t));
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (got === want) return t;
    t -= got - want;
  }
  return t;
}

// Hours in [09,17) local in A whose same instant also falls in [09,17) local in B, expressed in
// A's clock. Pure modular arithmetic on the offset difference — the dateline is handled by the
// modulo, and the answer is a set of whole hours because a working window is whole hours wide.
//
// The sign is the whole trap of this function. An instant's two readings differ by
// offB − offA, not the other way round: at 09:00 in New York (−04:00) it is 14:00 in London
// (+01:00), which is 540 + 60 − (−240), and writing offA − offB instead mirrors every window
// through midday — a 09:00–12:00 answer becomes 14:00–17:00, still plausible-looking, still
// wrong, and the kind of wrong that reads as authority. The instant-based check in
// test/city-zones.test.js is what keeps it the right way round.
function workingOverlap(offA, offB) {
  const hours = [];
  for (let h = 9; h < 17; h += 1) {
    const inB = ((h * 60 + offB - offA) % 1440 + 1440) % 1440;
    if (inB >= 9 * 60 && inB < 17 * 60) hours.push(h);
  }
  return hours;
}

function clockText(minutesOfDay) {
  const m = ((minutesOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mi = m % 60;
  return (h < 10 ? '0' + h : '' + h) + ':' + (mi < 10 ? '0' + mi : '' + mi);
}

// GMT+5:30 style label from a minute offset — the form people read on a clock face, and the one
// that never needs a zone abbreviation table (CET/PST/IST would be ambiguous across languages).
function gmtLabel(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60), m = a % 60;
  return 'GMT' + (m ? sign + h + ':' + (m < 10 ? '0' + m : m) : sign + h);
}

// Hours between two offsets as text: 300 → "5 hours", 330 → "5 h 30 min", 30 → "30 minutes".
// A page that said "7.5 hours" would be the kind of rounding that makes Kathmandu look wrong,
// and one that said "0 h 30 min" would be the kind of formatting that makes a person think the
// number was produced by a library rather than written by somebody.
function diffLabel(minutes) {
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60), m = Math.round(a % 60);
  if (!m) return h + (h === 1 ? ' hour' : ' hours');
  if (!h) return m + (m === 1 ? ' minute' : ' minutes');
  return h + ' h ' + m + ' min';
}

// Every id in the two tables must be one this runtime's time-zone database actually knows. Checked
// once at require time rather than per page render: an id that only newer tzdb has (Asia/Astana was
// the one that surfaced here) would otherwise become a 503 on the box and a green test locally,
// which is the same class of failure as the crawl-budget mismatch of 2026-11-05.
const ALL_ZONES = new Set(Object.keys(CITY_ZONE).map((k) => CITY_ZONE[k])
  .concat(Object.keys(COUNTRY_ZONE).map((k) => COUNTRY_ZONE[k])));
const UNUSABLE_ZONES = [];
ALL_ZONES.forEach((z) => {
  try { offsetMinutes(z, new Date(Date.UTC(2026, 0, 15, 12))); } catch (e) { UNUSABLE_ZONES.push(z); }
});
if (UNUSABLE_ZONES.length) {
  throw new Error('city-zones: the runtime does not know these zone ids: ' + UNUSABLE_ZONES.join(', '));
}

module.exports = {
  CITIES, CITY_ZONE, COUNTRY_ZONE, MULTI_ZONE_COUNTRIES,
  zoneFor, partsIn, offsetMinutes, offsetsOfYear, summaryOf, nextChange, yearSignature,
  instantFor,
  workingOverlap, clockText, gmtLabel, diffLabel, ALL_ZONES, UNUSABLE_ZONES,
};
