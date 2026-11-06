'use strict';
// ── TUKUK-OS /thesaurus — the curated synonym shelf ───────────────────────────
// A thesaurus is only worth publishing if someone chose the words. The local
// WordNet bank can hand back raw synonym lists for 200,000 rows, but an
// unedited dump of `big → large, huge, vast, great...` is exactly the page that
// makes people distrust online thesauri — it never tells you which synonym is
// right. So this shelf is written the way a dictionary editor does it: forty
// words people actually reach for, each sense given its own ring, a plain gloss
// that says what the ring means, and a discriminator note that says WHEN to
// pick which word. Antonyms are listed where English really has them. Words
// link to each other only inside the shelf; everything outside is a 404, the
// same curated-shelf contract /dictionary keeps.
const TOPICS = [
  { slug: 'feelings', icon: '💭', name: 'Feelings', blurb: 'Happy has eleven neighbours and they do not mean the same thing.' },
  { slug: 'sizes', icon: '📏', name: 'Sizes & Amounts', blurb: 'How much, how big, how fast — the measuring words and their exact edges.' },
  { slug: 'looks', icon: '👀', name: 'Looks & Qualities', blurb: 'What things are made of, apparently: beauty, mess, strangeness and their gradations.' },
  { slug: 'thought', icon: '🧠', name: 'Speech & Thought', blurb: 'Say, think, know, mean — the verbs of the head, sorted carefully.' },
  { slug: 'doing', icon: '🔨', name: 'Doing', blurb: 'Begin, break, change: the workshop verbs with all their tools labelled.' },
];

// senses: [{pos, gloss, syn (6-10 checked words), pick (when to choose which)}]
// ant: real word-level opposites, listed only where English honestly has them.
const ENTRIES = [
  { word: 'happy', topic: 'feelings', ant: ['sad', 'unhappy'], senses: [
    { pos: 'adjective', gloss: 'feeling pleasure or contentment', syn: ['glad', 'cheerful', 'joyful', 'delighted', 'content', 'elated', 'blissful', 'jolly'], pick: 'Content is the quiet end, elated the loud one; cheerful describes how someone behaves, not what they hide.' },
    { pos: 'adjective', gloss: 'likely, willing (as in "only too happy to")', syn: ['glad', 'willing', 'ready', 'eager', 'inclined'], pick: 'Here happy means readiness, not joy — happy to help is willing to help.' },
  ]},
  { word: 'sad', topic: 'feelings', ant: ['happy', 'cheerful'], senses: [
    { pos: 'adjective', gloss: 'unhappy, or causing unhappiness', syn: ['unhappy', 'sorrowful', 'gloomy', 'downcast', 'melancholy', 'mournful', 'dejected'], pick: 'Sorrowful and mournful answer a loss; gloomy is weather of the mind; melancholy is the one you can enjoy.' },
  ]},
  { word: 'angry', topic: 'feelings', ant: ['calm'], senses: [
    { pos: 'adjective', gloss: 'feeling strong displeasure', syn: ['mad', 'furious', 'irate', 'livid', 'incensed', 'indignant', 'outraged'], pick: 'Indignant is anger with a case — anger at a wrong; livid and furious are temperature, indignant is argument.' },
  ]},
  { word: 'afraid', topic: 'feelings', ant: ['brave', 'fearless'], senses: [
    { pos: 'adjective', gloss: 'feeling fear; unwilling to do something', syn: ['scared', 'frightened', 'fearful', 'terrified', 'apprehensive', 'uneasy', 'alarmed'], pick: 'Apprehensive fears what is coming; terrified is facing it already; uneasy is the smallest and most honest.' },
  ]},
  { word: 'tired', topic: 'feelings', ant: ['rested', 'energetic'], senses: [
    { pos: 'adjective', gloss: 'needing sleep or rest; worn out', syn: ['weary', 'exhausted', 'fatigued', 'drained', 'spent', 'burnt out', 'drowsy'], pick: 'Drowsy wants sleep; exhausted wants a week; weary can be about patience, not the body.' },
    { pos: 'adjective', gloss: 'no longer interested (tired of something)', syn: ['sick of', 'fed up with', 'weary of', 'done with', 'had enough of'], pick: 'This sense always carries "of" — you are tired of it, not tired by it.' },
  ]},
  { word: 'calm', topic: 'feelings', ant: ['angry', 'frantic'], senses: [
    { pos: 'adjective', gloss: 'not upset; without movement or noise', syn: ['composed', 'serene', 'tranquil', 'unruffled', 'collected', 'placid', 'still'], pick: 'Of a person: composed and collected after pressure. Of water and weather: serene, tranquil, still.' },
    { pos: 'verb', gloss: 'to make quiet or still', syn: ['soothe', 'settle', 'quiet', 'appease', 'allay', 'pacify'], pick: 'Appease and pacify end a quarrel; soothe and settle end a bad night.' },
  ]},
  { word: 'excited', topic: 'feelings', ant: ['bored', 'calm'], senses: [
    { pos: 'adjective', gloss: 'very enthusiastic and eager', syn: ['thrilled', 'eager', 'enthusiastic', 'electrified', 'pumped', 'animated', 'keen'], pick: 'Thrilled looks backward at something that happened; eager looks forward. Keen is the British polite grade.' },
  ]},
  { word: 'lonely', topic: 'feelings', ant: ['sociable', 'wanted'], senses: [
    { pos: 'adjective', gloss: 'sad because of absence of company; solitary', syn: ['isolated', 'forlorn', 'desolate', 'abandoned', 'friendless', 'solitary'], pick: 'Solitary is the fact; lonely is the wound. Forlorn adds helplessness to both.' },
  ]},
  { word: 'big', topic: 'sizes', ant: ['small', 'little'], senses: [
    { pos: 'adjective', gloss: 'of great size or amount', syn: ['large', 'huge', 'enormous', 'vast', 'immense', 'substantial', 'tremendous', 'massive'], pick: 'Large is the plain opposite of small; huge and enormous are emphatic; vast is about area, immense about anything that dwarfs you.' },
    { pos: 'adjective', gloss: 'important (a big decision)', syn: ['important', 'significant', 'major', 'momentous', 'weighty'], pick: 'Momentous is for history; weighty for arguments and responsibilities.' },
  ]},
  { word: 'small', topic: 'sizes', ant: ['big', 'large'], senses: [
    { pos: 'adjective', gloss: 'of little size or number', syn: ['little', 'tiny', 'compact', 'slight', 'minor', 'modest', 'miniature'], pick: 'Little is the everyday twin; slight is about build and margin; minor is smallness of importance, not size.' },
    { pos: 'adjective', gloss: 'narrow-minded (small words)', syn: ['petty', 'narrow', 'mean', 'paltry', 'trifling'], pick: 'Petty and mean accuse the motive; paltry dismisses the amount.' },
  ]},
  { word: 'many', topic: 'sizes', ant: ['few'], senses: [
    { pos: 'adjective', gloss: 'a large number of (countable things)', syn: ['numerous', 'abundant', 'plentiful', 'copious', 'countless', 'myriad', 'a host of'], pick: 'Many takes countables — many books; much takes the rest — much time. Numerous is formal-plainer than the rest.' },
  ]},
  { word: 'few', topic: 'sizes', ant: ['many'], senses: [
    { pos: 'adjective', gloss: 'not many; little in number', syn: ['scarce', 'sparse', 'limited', 'handful', 'slight', 'meagre'], pick: '"A few" is some, encouraging; "few" without the article is not enough, discouraging. The article is the whole attitude.' },
  ]},
  { word: 'full', topic: 'sizes', ant: ['empty'], senses: [
    { pos: 'adjective', gloss: 'holding all possible; complete', syn: ['packed', 'crammed', 'loaded', 'brimming', 'replete', 'sated', 'filled'], pick: 'Brimming is about to spill; replete is a bookish full; sated is the full you feel in your stomach.' },
  ]},
  { word: 'empty', topic: 'sizes', ant: ['full'], senses: [
    { pos: 'adjective', gloss: 'containing nothing; without meaning', syn: ['vacant', 'hollow', 'bare', 'void', 'unoccupied', 'blank'], pick: 'Vacant is a post or a flat; hollow is a thing hiding nothing inside; void is legal and cosmic; blank is waiting to be written on.' },
    { pos: 'verb', gloss: 'to remove the contents', syn: ['drain', 'clear', 'vacuum', 'unload', 'purge', 'evacuate'], pick: 'Drain takes liquid, unload takes cargo, evacuate takes people — and the room afterwards is empty.' },
  ]},
  { word: 'fast', topic: 'sizes', ant: ['slow'], senses: [
    { pos: 'adjective', gloss: 'moving quickly', syn: ['quick', 'rapid', 'swift', 'speedy', 'brisk', 'fleet'], pick: 'Rapid suits processes and water; swift suits a runner and a decision; brisk is a walk or a trade; quick is the hand, fast is the whole body.' },
    { pos: 'adverb', gloss: 'firmly (stuck fast)', syn: ['firmly', 'tight', 'securely', 'fastened', 'soundly'], pick: 'The old sense survives in stuck fast, fast friends, fast asleep and a fast colour — speed is the newer meaning.' },
  ]},
  { word: 'slow', topic: 'sizes', ant: ['fast', 'quick'], senses: [
    { pos: 'adjective', gloss: 'taking time; not quick', syn: ['unhurried', 'sluggish', 'gradual', 'leisurely', 'deliberate', 'poky'], pick: 'Unhurried is a choice, sluggish an illness; a gradual rise is slow but steady; deliberate is slow on purpose.' },
    { pos: 'verb', gloss: 'to reduce speed', syn: ['delay', 'retard', 'hold up', 'slow down', 'stall'], pick: 'Hold up is traffic, stall is a person finding an excuse.' },
  ]},
  { word: 'beautiful', topic: 'looks', ant: ['ugly'], senses: [
    { pos: 'adjective', gloss: 'pleasing to the senses or mind', syn: ['lovely', 'gorgeous', 'stunning', 'exquisite', 'attractive', 'handsome', 'fair'], pick: 'Handsome keeps a sense of build and proportion; exquisite is small-scale beauty you examine; stunning is beauty with an impact rating.' },
  ]},
  { word: 'ugly', topic: 'looks', ant: ['beautiful', 'handsome'], senses: [
    { pos: 'adjective', gloss: 'unpleasant to look at; morally bad', syn: ['unsightly', 'hideous', 'grotesque', 'repulsive', 'homely', 'foul', 'nasty'], pick: 'An ugly truth and an ugly incident borrow the second sense; homely is the polite word for a plain face.' },
  ]},
  { word: 'clever', topic: 'looks', ant: ['foolish', 'dull'], senses: [
    { pos: 'adjective', gloss: 'quick to understand, learn or invent', syn: ['smart', 'intelligent', 'bright', 'sharp', 'ingenious', 'gifted', 'apt'], pick: 'Smart is social speed, bright is school speed, ingenious is the tinkerer. Shrewd is clever about deals.' },
    { pos: 'adjective', gloss: 'done with skill (a clever trick)', syn: ['skilful', 'adroit', 'deft', 'crafty', 'artful'], pick: 'Crafty and artful lean toward deception; deft is the hands, adroit is the fingers of the mind.' },
  ]},
  { word: 'strange', topic: 'looks', ant: ['ordinary', 'familiar'], senses: [
    { pos: 'adjective', gloss: 'unusual or surprising; unfamiliar', syn: ['odd', 'peculiar', 'unusual', 'bizarre', 'curious', 'eerie', 'foreign'], pick: 'Odd is small and countable; peculiar is characteristic-odd; curious is odd enough to study; eerie is odd with a chill.' },
  ]},
  { word: 'clean', topic: 'looks', ant: ['messy', 'dirty'], senses: [
    { pos: 'adjective', gloss: 'free of dirt; clear of wrongdoing (a clean record)', syn: ['spotless', 'immaculate', 'hygienic', 'sterile', 'pristine', 'scrubbed'], pick: 'Sterile is medical, pristine is almost accusatory in its perfection, spotless is the promise the detergent makes.' },
    { pos: 'adjective', gloss: 'honest, lawful (clean money)', syn: ['legitimate', 'honest', 'lawful', 'clear', 'unblemished'], pick: 'The opposite is dirty money — the metaphor of the launderer, turned around.' },
  ]},
  { word: 'messy', topic: 'looks', ant: ['clean', 'tidy'], senses: [
    { pos: 'adjective', gloss: 'untidy; involving disorder or difficulty', syn: ['untidy', 'cluttered', 'disordered', 'chaotic', 'muddled', 'scruffy', 'sloppy'], pick: 'Cluttered is shelves, chaotic is events, sloppy is work or weather; scruffy is a person, not a desk.' },
  ]},
  { word: 'rare', topic: 'looks', ant: ['common', 'ordinary'], senses: [
    { pos: 'adjective', gloss: 'not often found or seen', syn: ['scarce', 'uncommon', 'unusual', 'infrequent', 'precious', 'exclusive'], pick: 'Scarce means wanted and not enough; rare means wanted or not. A rare stamp is not a scarce stamp until someone needs one.' },
    { pos: 'adjective', gloss: 'of meat: barely cooked', syn: ['undercooked', 'blue', 'bloody', 'medium-rare', 'pink'], pick: 'Blue, bloody, pink — the steak thermometer in words, safely unrelated to scarcity, which is why the word is always worth hearing twice.' },
  ]},
  { word: 'ordinary', topic: 'looks', ant: ['extraordinary', 'special', 'rare'], senses: [
    { pos: 'adjective', gloss: 'with no special or distinctive features', syn: ['common', 'average', 'usual', 'everyday', 'standard', 'unremarkable', 'run-of-the-mill'], pick: 'Plain is the honest one — plain is not a put-down; pedestrian is when the ordinary becomes boring.' },
  ]},
  { word: 'say', topic: 'thought', ant: [], senses: [
    { pos: 'verb', gloss: 'to express in words', syn: ['state', 'utter', 'voice', 'declare', 'remark', 'assert', 'mention', 'put'], pick: 'Declare is on the record; remark is in passing; assert is defended; utter is the physical act, and rarely used as anything but a participle.' },
    { pos: 'noun', gloss: 'the right to speak (have a say)', syn: ['vote', 'input', 'opinion', 'word', 'part'], pick: 'Have a say, have a word, have a voice — the three idioms shade from decision to complaint to presence.' },
  ]},
  { word: 'think', topic: 'thought', ant: [], senses: [
    { pos: 'verb', gloss: 'to hold as an opinion; believe', syn: ['believe', 'reckon', 'suppose', 'consider', 'judge', 'hold', 'figure'], pick: 'Consider weighs before deciding; suppose assumes for the sake of argument; reckon is the everyday arithmetic of opinion.' },
    { pos: 'verb', gloss: 'to use the mind; ponder', syn: ['ponder', 'reflect', 'contemplate', 'mull over', 'deliberate', 'muse'], pick: 'Ponder turns a thing over; contemplate holds it up; muse lets it drift. Mull over is the phrasal version of ponder.' },
  ]},
  { word: 'know', topic: 'thought', ant: ['ignore'], senses: [
    { pos: 'verb', gloss: 'to be aware through observation or study', syn: ['understand', 'realise', 'grasp', 'recognise', 'be aware', 'appreciate'], pick: 'Realise is knowledge arriving suddenly; appreciate is knowing something is significant, not just true.' },
  ]},
  { word: 'understand', topic: 'thought', ant: ['misread'], senses: [
    { pos: 'verb', gloss: 'to perceive the meaning of; be sympathetic', syn: ['grasp', 'comprehend', 'follow', 'fathom', 'appreciate', 'get'], pick: 'Comprehend is formal for full grasp; follow works for streams of speech and argument; fathom is for depths, mostly in the negative.' },
  ]},
  { word: 'explain', topic: 'thought', ant: ['confuse', 'obscure'], senses: [
    { pos: 'verb', gloss: 'to make clear; give reasons for', syn: ['clarify', 'describe', 'set out', 'spell out', 'elucidate', 'detail', 'interpret', 'account for'], pick: 'Elucidate lifts a hard text; interpret translates meaning between systems; spell out threatens patience, politely.' },
  ]},
  { word: 'believe', topic: 'thought', ant: ['doubt', 'disbelieve'], senses: [
    { pos: 'verb', gloss: 'to accept as true; trust', syn: ['accept', 'trust', 'hold', 'credit', 'take', 'be convinced', 'reckon'], pick: 'Trust a person, believe a claim; credit is believe enough to count it real. I believe so is soft; I believe it is hard.' },
  ]},
  { word: 'remember', topic: 'thought', ant: ['forget'], senses: [
    { pos: 'verb', gloss: 'to bring back to mind; not forget to do', syn: ['recall', 'recollect', 'retain', 'think of', 'look back on', 'mind'], pick: 'Recall is deliberate, recollect is formal and slow, reminisce (near relation) is warm. Mind is British for obeying a reminder.' },
  ]},
  { word: 'forget', topic: 'thought', ant: ['remember', 'recall'], senses: [
    { pos: 'verb', gloss: 'to fail to remember; leave behind', syn: ['overlook', 'omit', 'mislay', 'neglect', 'leave', 'blank out'], pick: 'Overlook is failing to notice; omit is leaving out on purpose or by drift; mislay is the keys, neglect is a duty.' },
  ]},
  { word: 'begin', topic: 'doing', ant: ['end', 'finish'], senses: [
    { pos: 'verb', gloss: 'to start; come into existence', syn: ['start', 'commence', 'initiate', 'open', 'embark on', 'kick off', 'set out'], pick: 'Commence is ceremony; initiate is machinery and programs; embark on is the long project with some hope in it.' },
  ]},
  { word: 'end', topic: 'doing', ant: ['begin', 'start'], senses: [
    { pos: 'verb', gloss: 'to finish; bring to a close', syn: ['finish', 'stop', 'conclude', 'terminate', 'close', 'cease', 'wrap up', 'wind up'], pick: 'Cease is formal and abrupt; terminate is legal or mechanical; wrap up is the friendly last hour of it all.' },
    { pos: 'noun', gloss: 'the final part; the purpose', syn: ['finish', 'close', 'conclusion', 'ending', 'goal', 'objective'], pick: 'The two senses meet in "the end of the road" and "means to an end" — one is a place, the other a purpose.' },
  ]},
  { word: 'make', topic: 'doing', ant: ['destroy'], senses: [
    { pos: 'verb', gloss: 'to create; form by putting parts together', syn: ['create', 'build', 'produce', 'construct', 'form', 'fashion', 'compose', 'manufacture'], pick: 'Compose is for music and writing, fashion is verb and craft, manufacture is make at industrial scale, and create keeps the mystery.' },
    { pos: 'verb', gloss: 'to force (someone to do something)', syn: ['cause', 'compel', 'oblige', 'drive', 'push', 'require'], pick: 'Compel and oblige carry rules; drive and push carry pressure; make is the plain force: she made him apologise.' },
  ]},
  { word: 'help', topic: 'doing', ant: ['hinder', 'obstruct'], senses: [
    { pos: 'verb', gloss: 'to make it easier for someone; assist', syn: ['assist', 'aid', 'support', 'back', 'lend a hand', 'ease', 'relieve'], pick: 'Aid is a fund or a disaster; assist is formal and on the field; support is weight, held over time.' },
    { pos: 'noun', gloss: 'the assistance given', syn: ['aid', 'assistance', 'support', 'hand', 'service', 'relief'], pick: 'A helping hand is the idiom; the rest are invoices.' },
  ]},
  { word: 'show', topic: 'doing', ant: ['hide', 'conceal'], senses: [
    { pos: 'verb', gloss: 'to let be seen; demonstrate; prove', syn: ['display', 'reveal', 'present', 'exhibit', 'demonstrate', 'indicate', 'prove', 'screen'], pick: 'Display hangs on a wall; reveal lifts the cover; demonstrate works the machine; indicate is the dashboard.' },
    { pos: 'noun', gloss: 'a public entertainment', syn: ['performance', 'production', 'programme', 'spectacle', 'display'], pick: 'A show puts lights on it; a performance puts bodies into it.' },
  ]},
  { word: 'hide', topic: 'doing', ant: ['show', 'reveal'], senses: [
    { pos: 'verb', gloss: 'to put where not seen; keep secret', syn: ['conceal', 'cover', 'stash', 'bury', 'shelter', 'screen', 'mask', 'cache'], pick: 'Conceal is the deliberate general; stash is your own things; screen is between it and the viewer; mask changes what the viewer expects.' },
    { pos: 'noun', gloss: 'a place for an animal to shelter', syn: ['den', 'burrow', 'lair', 'shelter', 'covert', 'thicket'], pick: 'The noun mostly survives for animals and hunters; your own shelter is a hide only if you are a taxidermist.' },
  ]},
  { word: 'change', topic: 'doing', ant: ['keep', 'preserve'], senses: [
    { pos: 'verb', gloss: 'to make or become different; exchange', syn: ['alter', 'modify', 'adjust', 'transform', 'switch', 'convert', 'vary', 'swap'], pick: 'Adjust nudges toward correct; modify changes without unmaking; transform is the whole thing changed; convert has an endpoint it aims at.' },
    { pos: 'noun', gloss: 'the act of differing from before; money exchanged', syn: ['shift', 'alteration', 'transformation', 'switch', 'variation', 'exchange'], pick: 'A shift is gradual and measurable; the money sense keeps the older meaning of making something different in your pocket.' },
  ]},
  { word: 'break', topic: 'doing', ant: ['mend', 'repair', 'fix'], senses: [
    { pos: 'verb', gloss: 'to separate into pieces; violate; interrupt', syn: ['shatter', 'smash', 'snap', 'fracture', 'crack', 'burst', 'violate', 'suspend'], pick: 'Shatter is glass; snap is one clean motion; fracture is bone and formal; violate is the rule sense, and burst goes outward.' },
    { pos: 'noun', gloss: 'a pause; a rupture; news', syn: ['rest', 'pause', 'interval', 'split', 'fracture', 'development'], pick: 'Take a break is the body; a break with the past is the mind; breaking news made break the century\'s loudest noun.' },
  ]},
];

function topicOf(slug) {
  return TOPICS.find((t) => t.slug === String(slug || '').toLowerCase()) || null;
}

function findEntry(word) {
  return ENTRIES.find((e) => e.word === String(word || '').trim().toLowerCase()) || null;
}

function isPublished(word) {
  return !!findEntry(word);
}

function wordsOfTopic(slug) {
  return ENTRIES.filter((e) => e.topic === String(slug || '').toLowerCase()).map((e) => e.word);
}

const ALL_WORDS = ENTRIES.map((e) => e.word).sort();

module.exports = { TOPICS, ENTRIES, ALL_WORDS, topicOf, findEntry, isPublished, wordsOfTopic };
