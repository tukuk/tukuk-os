'use strict';
// ── TUKUK-OS /idioms — a kept shelf of English idiom ──────────────────────
// An idiom is a small piece of frozen history: you cannot deduce "spill the
// beans" from its words, and half the pleasure is knowing why the phrase is
// shaped the way it is. Aggregator idiom sites mostly copy each other's lists
// with invented etymologies, so this shelf is kept by hand instead: thirty
// common idioms, each with a plain meaning, real example sentences, and an
// origin stated as honestly as the evidence allows — hedged where the evidence
// is thin, dated where it is not. Anything outside the shelf is a normal 404,
// the same curated contract /dictionary and /thesaurus keep.
const THEMES = [
  { slug: 'weather-sea', icon: '⛵', name: 'Weather & the Sea', blurb: 'Sailors gave English half its idioms; the weather gave it the rest.' },
  { slug: 'body', icon: '🫱', name: 'The Body', blurb: 'Ears, eyes, chins and chests — how the body runs the figurative English body.' },
  { slug: 'food', icon: '🍞', name: 'Food & Drink', blurb: 'Cake, tea, bread and beans: the kitchen is a grammar of judgement.' },
  { slug: 'animals', icon: '🐾', name: 'Animals', blurb: 'Cats out of bags, horses held: barnyard and menagerie at work.' },
  { slug: 'work-money', icon: '💼', name: 'Work & Money', blurb: 'Ledger ink, oil lamps and drawing boards — the office before offices.' },
];

const IDIOMS = [
  { slug: 'raining-cats-and-dogs', theme: 'weather-sea', phrase: 'raining cats and dogs', meaning: 'Raining very heavily.', example: 'We cancelled the picnic — it was raining cats and dogs.', origin: 'Printed from at least 1638 (Balthasar Grimmelshausen in English) and used by Swift; why cats and dogs, nobody has proved — the popular "animals fell from thatched roofs" story is a modern invention without evidence.' },
  { slug: 'on-cloud-nine', theme: 'weather-sea', phrase: 'on cloud nine', meaning: 'Extremely happy, on top of the world.', example: 'She has been on cloud nine since the offer letter arrived.', origin: 'From the numbered cloud classification of 19th-century meteorology — cumulus nimbus was raised to number ten and cut, leaving nine as the tall one; the phrase itself caught on in mid-20th-century America.' },
  { slug: 'in-the-same-boat', theme: 'weather-sea', phrase: 'in the same boat', meaning: 'Sharing the same difficulty or situation.', example: 'Nobody escaped the lockdown unscathed — we are all in the same boat.', origin: 'A sailing image recorded in English since the 1500s: one storm, one hull, no passengers with private weather.' },
  { slug: 'weather-the-storm', theme: 'weather-sea', phrase: 'weather the storm', meaning: 'Get through a difficult period without lasting damage.', example: 'The shop weathered the storm by cutting nothing but its own hours.', origin: 'Nautical: to come through a storm under control rather than before it. Transferred to money and politics by the early 1800s.' },
  { slug: 'a-breeze', theme: 'weather-sea', phrase: 'a breeze', meaning: 'Something very easy.', example: 'The exam was a breeze after the practice papers.', origin: 'The light-wind image of effortless movement; by the early 20th century a breeze had beaten a piece of cake to the same chair.' },
  { slug: 'wind-out-of-sails', theme: 'weather-sea', phrase: 'take the wind out of someone\u2019s sails', meaning: 'To weaken someone\u2019s position just as they were making a point — often by answering their argument before they make it.', example: 'Quoting the report before he could quote it at her took the wind out of his sails.', origin: 'Square-rigged sailing: a windward ship could blank its neighbour\u2019s sails by stealing the wind. The tactic is old; the metaphor is at least 18th-century.' },
  { slug: 'play-it-by-ear', theme: 'body', phrase: 'play it by ear', meaning: 'To decide as you go instead of following a plan.', example: 'We have no itinerary — we\u2019ll play it by ear.', origin: 'From music: playing by ear is doing it without written notes. The life plan idiom is American by the 1930s.' },
  { slug: 'turn-a-blind-eye', theme: 'body', phrase: 'turn a blind eye', meaning: 'To pretend not to notice something you disapprove of.', example: 'The regulator turned a blind eye for a decade.', origin: 'The story is Admiral Nelson at Copenhagen (1801), raising his telescope to his lost eye and not seeing the signal to withdraw. Whether he said it is uncertain; the phrase arrived with the story, and the phrase is certainly used.' },
  { slug: 'keep-your-chin-up', theme: 'body', phrase: 'keep your chin up', meaning: 'Stay cheerful in a hard time.', example: 'Chin up — the results come out Friday and you did fine.', origin: 'A 1930s American encouragement phrase: the posture of confidence (chin level) stood for the feeling itself.' },
  { slug: 'heart-on-your-sleeve', theme: 'body', phrase: 'wear your heart on your sleeve', meaning: 'To show your feelings openly instead of hiding them.', example: 'He wears his heart on his sleeve, which is why his letters are worth keeping.', origin: 'Common from the 1500s — Sidney and Shakespeare both use it. The tournament tale (knights tying a lady\u2019s favour to a sleeve) is good colour, but the idiom likely comes from humours-on-display, not heraldry.' },
  { slug: 'off-your-chest', theme: 'body', phrase: 'get something off your chest', meaning: 'To say the thing you have been carrying, and feel the weight go.', example: 'Once she apologised, the whole week\u2019s guilt came off her chest.', origin: 'The physical feeling of unspoken pressure in the body; the phrase is 19th-century.' },
  { slug: 'pull-your-leg', theme: 'body', phrase: 'pull someone\u2019s leg', meaning: 'To tease someone by making them believe something untrue.', example: 'I did not win the lottery — I\u2019m pulling your leg.', origin: 'London slang of the 1800s, probably from the literal trip: the fallen person is the joke\u2019s first audience.' },
  { slug: 'not-my-cup-of-tea', theme: 'food', phrase: 'not my cup of tea', meaning: 'Not to my taste; not something I want.', example: 'Skiing is lovely, but it\u2019s not my cup of tea.', origin: 'British tea as the measure of preference; the negative form is the one that survived into the 20th century.' },
  { slug: 'spill-the-beans', theme: 'food', phrase: 'spill the beans', meaning: 'To reveal a secret, usually by accident.', example: 'He spilled the beans about the party before the invitations went out.', origin: 'Ancient voting with beans (white for yes, dark for no) in a bag is the popular story; safer evidence shows the phrase itself in early-20th-century American English, up to the 19th as "let the beans out of the bag."' },
  { slug: 'piece-of-cake', theme: 'food', phrase: 'a piece of cake', meaning: 'Something very easy to do.', example: 'Fixing the wiring was a piece of cake for the apprentice.', origin: '1930s American, from cake-eating contests — the prize went to whoever finished longest, and cake is not fast work. It replaced the older piece of bread.' },
  { slug: 'sliced-bread', theme: 'food', phrase: 'the best thing since sliced bread', meaning: 'A great new invention; the best of its kind.', example: 'The dishwasher is the best thing since sliced bread, and I will not debate it.', origin: 'Bread-slicing machines reached America in 1928; the superlative construction spread through 1930s-40s radio and print.' },
  { slug: 'hard-pill-to-swallow', theme: 'food', phrase: 'a hard pill to swallow', meaning: 'An unpleasant fact you must accept.', example: 'Losing by a single mark was a hard pill to swallow.', origin: 'A 19th-century medical metaphor: before sweet coatings, medicine was exactly as grim as it tasted.' },
  { slug: 'bread-and-butter', theme: 'food', phrase: 'bread and butter', meaning: 'Your main source of income; the thing that pays.', example: 'Wedding photography is her side project; teaching is the bread and butter.', origin: 'The staple-food sense of "what keeps you fed" from the 18th century, first written for income in the 19th.' },
  { slug: 'cat-out-of-the-bag', theme: 'animals', phrase: 'let the cat out of the bag', meaning: 'To reveal a secret, usually by mistake.', example: 'Grandma let the cat out of the bag about the surprise.', origin: 'At least 18th-century print. The pig-in-a-poke market-fraud tale may explain it or may be a later gloss — the cat in the bag is older on paper than the story told about it.' },
  { slug: 'hold-your-horses', theme: 'animals', phrase: 'hold your horses', meaning: 'Wait; slow down before deciding.', example: 'Hold your horses — let us read the contract first.', origin: 'American, from holding restless horses before setting off; in print from the 1840s, often ironically as "hold your little horses."' },
  { slug: 'elephant-in-the-room', theme: 'animals', phrase: 'the elephant in the room', meaning: 'The huge obvious problem that everyone is choosing not to mention.', example: 'The unpaid loan was the elephant in the room all through dinner.', origin: 'As a metaphor about conspicuous silence it matured around the 1950s (a 1915 poem has the giant thing nobody will ride); the image of an elephant actually in a room is much older music-hall business.' },
  { slug: 'two-birds-one-stone', theme: 'animals', phrase: 'kill two birds with one stone', meaning: 'To do two things with a single action.', example: 'Cycling to the library killed two birds with one stone: exercise and no parking.', origin: 'In English print since the 1600s as a proverb; the hunting image is literal, the moral arithmetic is not new.' },
  { slug: 'fish-out-of-water', theme: 'animals', phrase: 'a fish out of water', meaning: 'Uncomfortable and out of place in a new situation.', example: 'At the design conference he felt like a fish out of water.', origin: 'The proverb is Tudor — the out-of-element misery of a fish was an established joke before print; man-out-of-his-element phrasing follows it.' },
  { slug: 'dark-horse', theme: 'animals', phrase: 'a dark horse', meaning: 'An unexpected winner, or someone with hidden abilities.', example: 'Nobody picked her for the shortlist — she came in as the dark horse.', origin: 'Racing first, politics soon after: Benjamin Disraeli is credited with the political sense (1831) on a surprise candidate nobody had read the form of.' },
  { slug: 'bottom-line', theme: 'work-money', phrase: 'the bottom line', meaning: 'The decisive number, point or conclusion.', example: 'The bottom line: the repair costs more than the car.', origin: 'Accounting: the bottom row of the income statement is net profit. The figurative sense (whatever it actually comes to) grew from it in late-20th-century business English.' },
  { slug: 'in-the-red', theme: 'work-money', phrase: 'be in the red', meaning: 'To owe more than you have; to be losing money.', example: 'The café was in the red all winter.', origin: 'Ledger ink: losses entered in red, profit in black. 19th-century bookkeeping, still on every spreadsheet.' },
  { slug: 'drawing-board', theme: 'work-money', phrase: 'back to the drawing board', meaning: 'To start again from nothing after a failure.', example: 'The prototype sank, so it was back to the drawing board.', origin: 'From a Peter Arno cartoon in The New Yorker (1941): an engineer surveying a crashed machine\u2019s remains and saying the line. The board has since gone digital; the phrase stayed.' },
  { slug: 'midnight-oil', theme: 'work-money', phrase: 'burn the midnight oil', meaning: 'To work or study late into the night.', example: 'She was burning the midnight oil before finals.', origin: 'From lamp oil: before gas and electric light, late work literally cost oil. In print by the 1600s.' },
  { slug: 'through-the-nose', theme: 'work-money', phrase: 'pay through the nose', meaning: 'To pay far too much for something.', example: 'Airport parking: you pay through the nose to leave it in a field.', origin: 'Late-17th-century slang. The Danish "nose tax" and the Irish tribute-by-nose stories make fine tales and have no documentary support; the phrase simply arrived, probably as plain rude hyperbole.' },
  { slug: 'extra-mile', theme: 'work-money', phrase: 'go the extra mile', meaning: 'To make more effort than anyone asked.', example: 'The staff at that hotel go the extra mile every single time.', origin: 'From the Sermon on the Mount (Matthew 5:41): whosoever shall compel thee to go a mile, go with him twain. The modern business sense dropped the compulsion and kept the distance.' },
];

function findTheme(slug) {
  return THEMES.find((t) => t.slug === String(slug || '').toLowerCase()) || null;
}

function findIdiom(slug) {
  return IDIOMS.find((i) => i.slug === String(slug || '').toLowerCase()) || null;
}

function idiomsOfTheme(slug) {
  return IDIOMS.filter((i) => i.theme === String(slug || '').toLowerCase());
}

const ALL_SLUGS = IDIOMS.map((i) => i.slug);

module.exports = { THEMES, IDIOMS, ALL_SLUGS, findTheme, findIdiom, idiomsOfTheme };
