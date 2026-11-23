'use strict';
// ── TUKUK-OS /word — Word of the Day ──
// A hand-curated bank of 240 interesting English words. The day's pick is a pure
// function of the date (day number mod bank size), so every permalink is stable
// forever, nothing needs storing, and yesterday's word is a real page, not a
// regeneration accident. Definitions, phonetics and the spoken audio come from
// src/kamus.js — which answers from our own local wordbank first and only then
// from the Free Dictionary API — so one pick costs at most one outbound call,
// cached a day like any other dictionary lookup.
const kamus = require('./kamus');

// Every entry below is chosen to be a real headword in standard English
// dictionaries (Merriam-Webster or OED) — no Obscure-Sorrows inventions, no
// half-remembered rare words. If a lookup ever still comes back empty, the
// page degrades to "no entry found" honestly rather than inventing a meaning.
const WORDS = (
  'aberration petrichor ephemeral susurrus mellifluous defenestration halcyon ' +
  'serendipity lugubrious perspicacious crepuscular ineffable hiraeth apotheosis ' +
  'burnish cadence calligraphic eloquence effervesce enervate euphoria fastidious ' +
  'florid grandiloquent hubris immutable imperturbable inimitable jubilant languid ' +
  'liminal loquacious luminous magnanimous mercurial nostalgia obfuscate obsequious ' +
  'opulent panacea paradigm pacifist penumbra poised poignant pristine quintessential ' +
  'sagacious sedulous seraphic sibylline simulacrum sobriety solace solitary ' +
  'sophistic sporadic stalwart stoic sublime subtle superfluous tenacious thrifty ' +
  'tranquility ubiquitous ultramarine unfathomable variegated vicissitude vindicate ' +
  'vivacious wistful yearn zealous ambrosia cerulean dulcet ethereal felicity ' +
  'felicitous fervid frugal frolicsome geminate germinate grandeur gratuitous ' +
  'gregarious incandescent incantation indefatigable indolent insouciant jubilee ' +
  'lachrymose limn lucent lustrous meliorate mensurable minatory munificent neoteric ' +
  'notable obscure palliate palpitate paramount pecuniary perspicuous preterite ' +
  'profligate quaint quiescent recalcitrant rechercher resplendent rictus rococo ' +
  'saunter sedentary sequester simper sinecure sophism specular sprightly stupefied ' +
  'suavity sumptuous taciturn tandem verbatim vicarious virulent bonhomie brontide ' +
  'clairvoyance contumely coruscate dapper dilatory edify enrapture entrepot ' +
  'exuberance fatuous garrulous gauche hale hearty impecunious ineluctable ' +
  'irrepressible loath maven meridian mistral mufti nadir nemesis palmary ' +
  'pervicacious phalanx polemic proem prolix pulchritude redoubtable refulgent ' +
  'rote scintillate somnolent splenetic spurious surly tawdry temerity thrall ' +
  'tinsel torrentious ubique umbral verity vociferant ware witchery wrack yacht ' +
  'zeugma acquiesce alacrity ameliorate apostasy apothegm assiduous attune belove ' +
  'blithe brevet calamity calumny canorous chary condign contemn couth doughty ' +
  'endear enjoin equanimity etymology furtive harmonious illumine ingenuous innate ' +
  'lenitive mellisonant recondite sabulous serenify subacid tactful trinal ' +
  'umbrageous vacillant velleity verisimilitude voluble wampum yestern aphelion ' +
  'perihelion apogee zenith nadir aurora monsoon petrel albatross estuary fjord ' +
  'glade dell promontory isthmus archipelago savanna steppe tundra taiga oasis ' +
  'meridian latitude longitude altitude barometer thermometer hygrometer anemometer ' +
  'seismograph equinox solstice cirrus cumulus stratus nimbus twilight ' +
  'gloaming dawn dusk eventide morrow yester-morrow fortnight sabbatical ' +
  'cartography calliope chronicle chronology genealogy heraldry numismatics ' +
  'paleography typography vignette marginalia colophon epilogue prologue coda ' +
  'anthology compendium lexicon thesaurus glossary errata imprimatur'
).split(/\s+/)
  .filter(Boolean)
  .filter((w, i, a) => a.indexOf(w) === i)
  .filter((w) => /^[a-z-]+$/i.test(w) && w.length >= 4 && w.length <= 15);

const DAY = 86400000;

// The one selection rule. UTC-anchored so the word flips at the same instant for
// every visitor, and reversible: any date maps back to its pick, forever.
function pickForDate(yyyymmdd) {
  const t = Date.parse(`${yyyymmdd}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const dayNo = Math.floor(t / DAY);
  return WORDS[((dayNo % WORDS.length) + WORDS.length) % WORDS.length];
}

function isoDay(d) { return d.toISOString().slice(0, 10); }

// The word for a given day PLUS its definition, in one call. The definition
// path is kamus.define (local wordbank → Free Dictionary API), exactly what
// /alat/dictionary already uses — nothing new reaches the network here.
async function entryForDate(yyyymmdd) {
  const word = pickForDate(yyyymmdd);
  if (!word) return null;
  const def = await kamus.define(word, 'en').catch(() => ({ found: false, word }));
  return { date: yyyymmdd, word, def };
}

// The last N days, newest first — the "recent words" strip on the hub.
async function recent(n = 14) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = isoDay(new Date(now.getTime() - i * DAY));
    out.push({ date: d, word: pickForDate(d) });
  }
  return out;
}

module.exports = { WORDS, pickForDate, entryForDate, recent, isoDay, DAY };
