'use strict';
// ── TUKUK-OS /rhymes — a real rhyming dictionary, honestly hand-kept ─────────
// Two facts decide how this is built. First, our word bank (Princeton WordNet
// rows) stores no pronunciation, and the free dictionary API answers only
// sporadically — so a "rhyme any word" page over 200,000 words would be a
// guess dressed as a lookup. Second, rhyme lives in the SOUND, not the spelling:
// knight rhymes with night, window rhymes with show, and brew does not rhyme
// with few. So this is a curated shelf like /dictionary: twenty families keyed
// to a real final sound, every member checked by ear, and the tips pages teach
// exactly the traps above. A word outside the shelf is a normal 404.
const FAMILIES = [
  { slug: 'night', sound: '/aɪt/', ends: '-ight', words: ['bright', 'cite', 'fight', 'flight', 'kite', 'light', 'might', 'right', 'sight', 'tight', 'white', 'write', 'bite', 'knight', 'slight'], tip: 'Knight is the lesson: the silent k hides that knight and night are the same word by sound — which is exactly why careful rhymers pair knight with light instead, and why you should never fix a rhyme by looking at letters.' },
  { slug: 'day', sound: '/eɪ/', ends: '-ay', words: ['bay', 'clay', 'display', 'gray', 'holiday', 'may', 'play', 'pray', 'say', 'spray', 'stray', 'tray', 'way', 'weigh'], tip: 'Weigh and bay rhyme with day even though none of them spells the sound the same way — ay, ey and eigh all hide the same vowel.' },
  { slug: 'cake', sound: '/eɪk/', ends: '-ake', words: ['awake', 'bake', 'brake', 'flake', 'lake', 'make', 'mistake', 'partake', 'rake', 'sake', 'shake', 'snake', 'steak', 'take', 'wake'], tip: 'Steak looks like the odd one out and still rhymes with bake; the ea in speak or weak would break the family clean in half. Read with the ear, not the eye.' },
  { slug: 'tree', sound: '/iː/', ends: '-ee / -ea / -y', words: ['agree', 'bee', 'degree', 'flee', 'free', 'glee', 'key', 'knee', 'sea', 'see', 'spree', 'tea', 'three', 'agree', 'guarantee'], tip: 'Key, knee and tree all land on the same long E even if they wear three different spellings: ee, ea and ey.' },
  { slug: 'sound', sound: '/aʊnd/', ends: '-ound', words: ['around', 'astound', 'bound', 'confound', 'found', 'ground', 'hound', 'mound', 'pound', 'profound', 'rebound', 'wound'], tip: 'Wound (the injury) and wound (past of wind) are spelled alike and rhymed apart — only the injury belongs to this family.' },
  { slug: 'time', sound: '/aɪm/', ends: '-ime', words: ['chime', 'climb', 'crime', 'dime', 'grime', 'mime', 'overtime', 'prime', 'rhyme', 'slime', 'sublime'], tip: 'Climb rhymes with time with a silent b, and rhyme itself is the trickiest spelling in English — its ending sound is -ime, not -ime-what?' },
  { slug: 'show', sound: '/oʊ/', ends: '-ow / -o', words: ['below', 'bestow', 'blow', 'crow', 'flow', 'glow', 'know', 'row', 'show', 'slow', 'snow', 'swallow', 'throw', 'tow', 'window', 'woe'], tip: 'Window and swallow end in the same sound as show, though nobody writes an -ow that way twice. Careful: cow and how do NOT belong to this family — that ow says /aʊ/.' },
  { slug: 'old', sound: '/oʊld/', ends: '-old', words: ['bold', 'cold', 'fold', 'gold', 'hold', 'mould', 'scold', 'sold', 'strolled', 'told', 'unfold'], tip: 'Cold and bold are close neighbours of old, mould and scold join the line — and calm, spelled with the same letters, changed its vowel centuries ago and stays outside.' },
  { slug: 'bell', sound: '/ɛl/', ends: '-ell', words: ['dwell', 'excel', 'expel', 'fell', 'shell', 'smell', 'spell', 'swell', 'tell', 'well', 'sell'], tip: 'Smell and tell rhyme with bell without doubling the l — English spends its spare letters for free.' },
  { slug: 'heart', sound: '/ɑːrt/', ends: '-art', words: ['apart', 'cart', 'chart', 'counterpart', 'dart', 'part', 'smart', 'start'], tip: 'Start and heart rhyme for most readers; for some British voices the r changes sides. Rhyme judges by ear, and ears differ — that is a feature, not an error.' },
  { slug: 'rain', sound: '/eɪn/', ends: '-ain', words: ['brain', 'chain', 'domain', 'explain', 'gain', 'grain', 'lane', 'main', 'plain', 'refrain', 'reign', 'train', 'vein'], tip: 'Reign and rain are one sound in two spellings (the silent g is the whole trick), while vein keeps the rhyme and changes only the first letter — a true rhyme needs that change.' },
  { slug: 'more', sound: '/ɔːr/', ends: '-ore', words: ['adore', 'before', 'boar', 'bore', 'core', 'door', 'floor', 'four', 'ignore', 'lore', 'pore', 'score', 'shore', 'store', 'wore'], tip: 'Door and floor rhyme with more in most voices, whatever the spelling claims. Four, pour and pore are a single sound in three outfits — homophones, the limit case where rhyme stops being rhyme.' },
  { slug: 'sing', sound: '/ɪŋ/', ends: '-ing', words: ['bring', 'cling', 'fling', 'king', 'ling', 'ring', 'sing', 'spring', 'string', 'swing', 'thing', 'wing'], tip: 'The -ing family is the engine of English verse, and the ending decides, not the syllable count: anything genuinely does rhyme with thing.' },
  { slug: 'sleep', sound: '/iːp/', ends: '-eep', words: ['asleep', 'beep', 'cheap', 'creep', 'deep', 'keep', 'leak', 'reap', 'seep', 'sheep', 'steep', 'sweep', 'weep'], tip: 'Sheep and ship look like cousins and sound like strangers — this family holds the long vowel only.' },
  { slug: 'hand', sound: '/ænd/', ends: '-and', words: ['band', 'brand', 'command', 'demand', 'expand', 'grand', 'land', 'planned', 'sand', 'stand', 'withstand'], tip: 'Planned keeps the short a; island loses it — that s silenced both the letter and the rhyme. Command and demand still count: rhyme lives in the last stressed syllable, however late it arrives.' },
  { slug: 'duck', sound: '/ʌk/', ends: '-uck', words: ['buck', 'cluck', 'luck', 'muck', 'pluck', 'ruck', 'stuck', 'truck', 'tuck', 'yuck'], tip: 'A tiny family with a big cast: what the duck lacks in numbers it makes up in barnyard sound effects.' },
  { slug: 'stop', sound: '/ɒp/', ends: '-op', words: ['crop', 'drop', 'flop', 'hop', 'mop', 'nonstop', 'plop', 'pop', 'prop', 'slop', 'top'], tip: 'The vowel is the short o of shop and crop — stop, crop and prop travel together, while stoop brought its own oo and walks elsewhere.' },
  { slug: 'bug', sound: '/ʌɡ/', ends: '-ug', words: ['drug', 'hug', 'jug', 'lug', 'mug', 'plug', 'rug', 'slug', 'shrug', 'tug'], tip: 'Shrug sneaks a silent g past the eye, and bug and rogue refuse each other: that oo changed everything.' },
  { slug: 'eyes', sound: '/aɪz/', ends: '-ies / -ize', words: ['applies', 'comprise', 'dies', 'flies', 'lies', 'replies', 'rises', 'skies', 'size', 'surprise', 'ties', 'tries', 'wise'], tip: 'The third-person -es after a long I makes one of English\u2019s richest rhyme beds: practically every tries/flies/lies triplet you have ever heard.' },
  { slug: 'dust', sound: '/ʌst/', ends: '-ust', words: ['adjust', 'crust', 'gust', 'just', 'must', 'rust', 'thrust', 'trust'], tip: 'Dust, rust and must are the grumpiest trio in English and they fit together perfectly; adjust turns up four syllables late and still lands on -ust.' },
].map((f) => ({ ...f, words: f.words.filter(Boolean) }));

const BY_SLUG = new Map(FAMILIES.map((f) => [f.slug, f]));
const SET = new Set();
for (const f of FAMILIES) for (const w of f.words) SET.add(w);
const ALL_WORDS = [...SET].sort();

function findFamily(slug) {
  return BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}

function isPublished(word) {
  return SET.has(String(word || '').trim().toLowerCase());
}

function familiesOf(word) {
  const w = String(word || '').toLowerCase();
  return FAMILIES.filter((f) => f.words.includes(w));
}

module.exports = { FAMILIES, ALL_WORDS, findFamily, isPublished, familiesOf };
