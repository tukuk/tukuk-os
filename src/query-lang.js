'use strict';
// ── Malay → English query lexicon ───────────────────────────────────────────────
// The site publishes English: the addresses, the page copy and the search corpus. A visitor
// may still type a Malay query, and Meili cannot match across languages — "berapa banyak
// pulau di jepun" finds nothing while "how many islands in japan" finds the hub. This module
// rewrites the closed vocabulary those queries are built from: question words, the place
// nouns this site used to have as URLs, and the countries next door. Nothing else.
//
// Three choices keep it safe:
//   • LOCAL, not an API call. Sending every query to Google/MyMemory would contradict the
//     privacy this site promises and would put a network timeout inside the search path.
//   • NEVER WORSE. src/server.js only switches to the English query when the query is mostly
//     Malay AND the English words find more documents. A query that worked is never replaced
//     by one that works less.
//   • NO GUESSING. A word that is also ordinary English ("air", "api") is left alone, and a
//     word this lexicon does not know passes through untouched instead of being dropped.

// Multi-word phrases, matched before single words (longest first).
const PHRASES = [
  ['berapa banyak', 'how many'],
  ['negara mana', 'which country'],
  ['apa itu', 'what is'],
  ['di mana', 'where'],
  ['dimanakah', 'where'],
  ['bagaimana caranya', 'how'],
  ['hari ini', 'today'],
  ['gunung berapi', 'volcano'],
  ['air terjun', 'waterfall'],
  ['mata air panas', 'hot spring'],
  ['terumbu karang', 'coral reef'],
  ['banjaran gunung', 'mountain range'],
  ['tanah tinggi', 'highland'],
  ['padang pasir', 'desert'],
  ['tapak arkeologi', 'archaeological site'],
  ['rumah api', 'lighthouse'],
  ['balai cerap', 'observatory'],
  ['lapangan terbang', 'airport'],
  ['amerika syarikat', 'united states'],
  ['seluruh dunia', 'the whole world'],
];

// Single words. Grouped by what a visitor is looking for, not alphabetically.
const WORDS = {
  // question + function words
  berapa: 'how many', berapakah: 'how many', banyak: 'many', berapabilakah: 'how many',
  bagaimana: 'how', bagaimanakah: 'how', mengapa: 'why', kenapa: 'why', siapa: 'who',
  bila: 'when', bilakah: 'when', senarai: 'list', daftar: 'list', semua: 'all',
  jumlah: 'total', terdapat: 'there are', ialah: 'is', adalah: 'is', ada: 'are there',
  paling: 'most', terbesar: 'largest', terkecil: 'smallest', tertinggi: 'highest',
  terpanjang: 'longest', terpendek: 'shortest',
  di: 'in', ke: 'to', dari: 'from', dan: 'and', atau: 'or', untuk: 'for', dengan: 'with',
  pada: 'in', dalam: 'in', yang: '', itu: 'that', hari: 'day', ini: 'this',
  carian: 'search', cari: 'find', sekarang: 'now',
  satu: 'one', dua: 'two', tiga: 'three',
  // the place nouns this site used to serve under Malay addresses
  pulau: 'island', gunung: 'mountain', danau: 'lake', tasik: 'lake', sungai: 'river',
  gua: 'cave', glasier: 'glacier', teluk: 'bay', lembah: 'valley',
  semenanjung: 'peninsula', selat: 'strait', kepulauan: 'archipelago', gaung: 'gorge',
  ngarai: 'canyon', bukit: 'hill', tanjung: 'cape', lagun: 'lagoon', laut: 'sea',
  empangan: 'dam', paya: 'wetland', hutan: 'forest', kaldera: 'caldera', puncak: 'peak',
  oasis: 'oasis', benua: 'continent', peta: 'map',
  // landmarks and institutions
  bangunan: 'building', jambatan: 'bridge', terusan: 'canal', menara: 'tower',
  pelabuhan: 'port', terowong: 'tunnel', gereja: 'church', muzium: 'museum',
  universiti: 'university', stadium: 'stadium', istana: 'palace', masjid: 'mosque',
  katedral: 'cathedral', hospital: 'hospital', hotel: 'hotel', taman: 'park',
  perpustakaan: 'library', makam: 'cemetery', biara: 'monastery', patung: 'statue',
  kubu: 'fortification', akuarium: 'aquarium', zoo: 'zoo',
  // the words people wrap around those nouns
  negara: 'country', negeri: 'state', bandar: 'city', kampung: 'village',
  daerah: 'district', wilayah: 'region', penduduk: 'population', keluasan: 'area',
  dunia: 'world', sejarah: 'history', bahasa: 'language', makanan: 'food',
  cuaca: 'weather', gempa: 'earthquake', bencana: 'disaster', cuti: 'holiday',
  wang: 'money', seni: 'art', muzik: 'music', filem: 'movie',
  // countries whose Malay name differs enough to miss
  jepun: 'japan', singapura: 'singapore', filipina: 'philippines', sepanyol: 'spain',
  perancis: 'france', jerman: 'germany', belanda: 'netherlands', itali: 'italy',
  mesir: 'egypt', eropah: 'europe', afrika: 'africa', amerika: 'america',
  thailand: 'thailand', vietnam: 'vietnam', indonesia: 'indonesia', malaysia: 'malaysia',
  china: 'china', india: 'india', korea: 'korea', australia: 'australia', asia: 'asia',
};

// Words that are ALSO ordinary English or start a proper name stay out on purpose: "air"
// (air quality), "api" (an API), "kota" (Kota Kinabalu), "batu" (Batu Caves). Rewriting them
// would corrupt a query that was already fine. "dan" is mapped anyway — "gunung dan danau" is
// a real query shape, and a zero-hit query is the only place this module ever runs.
const LEXICON = new Map([...Object.entries(WORDS), ...PHRASES]);
const MAX_PHRASE = Math.max(...PHRASES.map(([m]) => m.split(' ').length));

/**
 * Rewrite the Malay words in a query into their English equivalents.
 * Untouched words — names, numbers, anything unknown — pass straight through.
 * @param {string} input the query as typed
 * @returns {{query:string, changed:boolean, terms:string[], coverage:number}} the English
 *   query, whether it differs from the input, which words were translated, and what share of
 *   the query those words are (0..1) — the caller uses the share to decide whether the query
 *   can fairly be called Malay.
 */
function toEnglishQuery(input) {
  const raw = String(input || '').trim();
  if (!raw) return { query: '', changed: false, terms: [], coverage: 0 };

  const tokens = raw.split(/\s+/);
  const out = [];
  const terms = [];
  let covered = 0;

  for (let i = 0; i < tokens.length;) {
    let matched = 0;
    for (let n = Math.min(MAX_PHRASE, tokens.length - i); n >= 1; n -= 1) {
      // A trailing '?' or '.' belongs to the punctuation, not to the word.
      const phrase = tokens.slice(i, i + n).join(' ').toLowerCase().replace(/[?.!,]+$/, '');
      if (LEXICON.has(phrase)) {
        terms.push(phrase);
        const english = LEXICON.get(phrase);
        if (english) out.push(english); // an empty mapping drops a function word
        matched = n;
        covered += n; // a phrase covers as many words as it spans
        break;
      }
    }
    if (!matched) { out.push(tokens[i]); matched = 1; }
    i += matched;
  }

  const query = out.join(' ').replace(/\s+/g, ' ').trim();
  // A query made only of function words ("yang") rewrites to nothing — there is no second
  // search to run, so the caller is told nothing changed.
  return {
    query,
    changed: Boolean(query) && terms.length > 0 && query !== raw,
    terms,
    coverage: covered / tokens.length
  };
}

module.exports = { toEnglishQuery, LEXICON };
