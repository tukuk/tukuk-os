'use strict';
// ── WORLD BOOKS — what to read on a subject, and what it is actually about ──────
//
// tukuk.org had no answer to "what should I read about X" outside the three-book
// 'further reading' strip on an academy page. This cluster is that answer: for each
// subject, the works the world keeps republishing, with authors, first year and how
// many editions exist — and an entry per subject that says what the subject *is*,
// because a list without a reason to read it is a list nobody uses.
//
// Where the data comes from: Open Library (openlibrary.org) — the Internet Archive's
// catalogue, keyless, with the metadata dedicated to the public domain (CC0). The list is
// the catalogue's own relevance matches for the subject, narrowed to the works that
// actually carry the subject on their record, then ordered by edition count — a plain,
// checkable proxy for "this book mattered": a work with forty editions was read, taught
// and reprinted for decades.
//
// Two traps in that API, both measured on 24 Oct 2026 and both avoided on purpose:
//   • `sort=editions` does not sort the matches, it sorts the whole index, so asking for
//     the most-editioned works on climatology returns Dickens; sort locally instead;
//   • a subject's *page* (/subjects/climatology.json) mixes in works that do not carry the
//     subject at all, and an unknown subject answers 200 with zero works rather than 404 —
//     so every returned work is checked against the subject string on its own record.
//
// What we deliberately do NOT do:
//   • no cover files are copied or hosted — the Internet Archive's scans carry their own
//     rights and are not CC0, so we never take one onto this box. What a page shows is a
//     link to IA's own thumbnail service for the archive.org item the record already names
//     (coverUrl below): we store no image and serve no bytes, and a work with no scanned
//     copy simply shows no cover — same as before;
//   • no article text mirrored — every title links to the catalogue so the reader can
//     borrow or read the real thing where the rights allow it;
//   • no crawl from the web process. Twenty-four curated subjects fetch live (one request
//     each, cached a day, mirrored to disk). Everything beyond them is built by
//     scripts/books-build.js as an explicit, bounded, resumable run and written to disk;
//     a request never reaches the catalogue for one of those, so a crawler storm on a
//     thousand shelves costs this box file reads, not somebody else's API.
//
// SCALE, and why the files are shaped this way (measured while planning, 24 Oct 2026):
// a sample of 40 topics found 24 with at least 100 works and 17 with 1,000+, so roughly
// one in two candidate subjects is a real shelf. At ~1,000 shelves the JSON for every
// work on every shelf is ~20 MB — which must never be parsed into RAM at boot on a box
// that has 6.8 GB shared with Meilisearch, a tunnel and nginx. So the data lives in three
// pieces: a small shelf *index* (one entry per shelf, ~110 KB, read once), one file per
// shelf (~6 KB, read per request), and works in 40 shards chosen by a hash of the Open
// Library id — no lookup table needed to find a work's shard, and an LRU keeps the four
// hottest shards parsed.
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { attachGuard } = require('./outbound');

const http = axios.create({
  timeout: 16000, // a subject search measured up to ~13 s; below that we would fail real lists
  httpsAgent: new https.Agent({ family: 4 }), // the box has no usable IPv6 route
  headers: { 'User-Agent': 'TukukOS-Books/1.0 (+https://tukuk.org/contact)' },
});
attachGuard(http, { name: 'books', budgetMs: 16000 });

const MIRROR_FILE = process.env.BOOKS_MIRROR_PATH || path.join(path.dirname(config.store.path), 'books-last.json');
const TTL = 24 * 60 * 60 * 1000;   // a subject's canon does not change overnight
const LIMIT = 30;                   // enough to be a reading list, short enough to load
const PER_SEARCH = 100;             // how many matches to pull before narrowing
const MAX_PER_AUTHOR = 2;           // five Andrew Lang titles is not a reading list
const PRIME_GAP_MS = 1200;          // spacing between subjects at boot

// The subjects are editorial, not generated: each one is a door somebody might actually
// walk through, and the blurb is the reason to open it. `term` is the Open Library
// subject string, which is not always the slug ("world history", not "world-history").
// `literary` marks the subjects where a novel belongs on the list — everywhere else a
// work tagged fiction is a book *set* in the subject, not a book *about* it, which is how
// two German historical romances were heading the ancient-history list.
const SUBJECTS = [
  { slug: 'world-history', title: 'World History', term: 'world history', blurb: 'How civilisations met, traded, fought and copied each other — the long view that makes the news legible.' },
  { slug: 'ancient-history', title: 'Ancient History', term: 'ancient history', blurb: 'Mesopotamia, Egypt, Greece, Rome, Persia, Han China: the first cities, the first laws, the first histories written down.' },
  { slug: 'philosophy', title: 'Philosophy', term: 'philosophy', blurb: 'The questions that do not go away — what is real, what is right, what can we know — argued in public for 2,500 years.' },
  { slug: 'physics', title: 'Physics', term: 'physics', blurb: 'From falling apples to quantum fields: the rules everything else has to obey, and the experiments that found them.' },
  { slug: 'astronomy', title: 'Astronomy', term: 'astronomy', blurb: 'What is out there and how we know — the sky, the instruments, and the patience it takes to measure a star.' },
  { slug: 'mathematics', title: 'Mathematics', term: 'mathematics', blurb: 'Proof, pattern and the unreasonable usefulness of abstraction, from Euclid to the mathematics of the everyday.' },
  { slug: 'chemistry', title: 'Chemistry', term: 'chemistry', blurb: 'How atoms combine, react and rearrange — the science that turns one substance into another on purpose.' },
  { slug: 'biology', title: 'Biology', term: 'biology', blurb: 'Cells, inheritance, ecosystems and the machinery of being alive, from a bacterium to a rainforest.' },
  { slug: 'evolution', title: 'Evolution', term: 'evolution (biology)', blurb: 'Descent with modification: the idea that reorganised biology, and the evidence gathered since Darwin first hesitated to publish it.' },
  { slug: 'neuroscience', title: 'Neuroscience', term: 'neuroscience', blurb: 'How a kilogram of wet tissue produces memory, language, emotion and a self that thinks it is in charge.' },
  { slug: 'psychology', title: 'Psychology', term: 'psychology', blurb: 'What experiments actually show about attention, memory, bias and behaviour — including the ones that failed to replicate.' },
  { slug: 'economics', title: 'Economics', term: 'economics', blurb: 'Incentives, markets, money and the models that predict people badly — and sometimes exactly right.' },
  { slug: 'political-science', title: 'Politics & Power', term: 'political science', blurb: 'States, constitutions, elections and legitimacy: how societies decide who gets to decide.' },
  { slug: 'law', title: 'Law', term: 'law', blurb: 'Rules with consequences: how courts reason, why constitutions endure, and what rights actually cost to enforce.' },
  { slug: 'medicine', title: 'Medicine', term: 'medicine', blurb: 'The body as a machine that fails in patterned ways, and the long, often bloody road to evidence-based treatment.' },
  { slug: 'engineering', title: 'Engineering', term: 'engineering', blurb: 'Bridges, engines, materials and margins of safety — the discipline of making things that do not fall down.' },
  { slug: 'computer-science', title: 'Computer Science', term: 'computer science', blurb: 'Computation itself: algorithms, complexity, information, and why some problems are cheap and others are not.' },
  { slug: 'climate', title: 'Climate & Environment', term: 'climatology', blurb: 'How the atmosphere, oceans and ice work as one system, and what the measurements have shown over seventy years.' },
  // The subject everybody types and the heading the catalogue filed it under are two different
  // strings: Open Library holds this literature under "Climatic changes". Measured on the VPS,
  // 25 Oct 2026: "climate change" was the most-searched query with no page of ours in the top
  // five (15 times), because the climate shelf above is titled "Climate & Environment" and has no
  // "change" in it. The term is the catalogue's key, the title is the reader's word.
  { slug: 'climate-change', title: 'Climate Change', term: 'climatic changes', blurb: 'What seventy years of measurement, ice cores and ocean heat records show, and the argument about how fast it is happening.' },
  // The same split once more, and this one had a cost. Measured on production, 25 Oct 2026:
  // "solar panels" and "solar panel efficiency" were answered by BBC news and by our own
  // /books/industrial-efficiency — a reading list about factories — because not one page we
  // publish contained the word "panel". The shelves we already had (solar cells, photovoltaic
  // cells, solar energy industries) name the cells and the trade, never the object on the roof.
  // The catalogue files this literature under "solar energy" (3,826 works), and those works are
  // panel books: "Stand-alone solar electric systems", "Photovoltaic design & installation for
  // dummies", "Solar Installations", "Rooftop revolution". Term is the catalogue's key, title is
  // the reader's word. Both words the queries used are in the blurb on purpose: it is reader-facing
  // prose about a panel's efficiency and an installation's cost, and it is also the only place this
  // shelf can say those two things in its own voice — the titles it shows are the catalogue's.
  { slug: 'solar-power', title: 'Solar Power & Solar Panels', term: 'solar energy', blurb: 'Sunlight turned into current: the cells inside a solar panel, the efficiency a panel reaches in real light and why heat takes part of it back, the batteries and inverters that deliver the power, and what an installation costs and produces.' },
  { slug: 'geology', title: 'Geology & Earth', term: 'geology', blurb: 'Plate tectonics, deep time and the rocks that record four and a half billion years of it.' },
  { slug: 'anthropology', title: 'Anthropology', term: 'anthropology', blurb: 'What people do and why they say they do it — kinship, ritual, exchange, and the argument about culture.' },
  { slug: 'linguistics', title: 'Language & Linguistics', term: 'linguistics', blurb: 'Sound, grammar, meaning and change: how language works as a system, and how it reshapes itself in every generation.' },
  { slug: 'art-history', title: 'Art History', term: 'art history', blurb: 'How images were made, paid for and read — from cave walls to the gallery wall, and who got to be called an artist.' },
  { slug: 'architecture', title: 'Architecture', term: 'architecture', blurb: 'Buildings as decisions: structure, light, city, climate and the politics of putting a roof over people.' },
  { slug: 'poetry', title: 'Poetry', term: 'poetry', literary: true, blurb: 'The shortest form with the longest memory — how a line can carry more than a paragraph, and why metre matters.' },
  // "movie" was the second-biggest gap in the same measurement (11 searches, no page of ours).
  // Nobody catalogs books under the word movie: the heading is "Motion pictures". Same split as
  // the shelf above — the catalogue's term, the reader's word — and a reading list, not the video
  // tool this site used to have and deliberately dropped.
  { slug: 'film', title: 'Movies & Film', term: 'motion pictures', blurb: 'Film as a subject: how pictures learned to move, how studios and directors split the work, and what a camera does to a face.' },

  // ── Expanded catalogue (added Nov 2026). Every term below was verified against the Open
  // Library search API the same way searchSubject does it: the exact lowercase subject string
  // was required on the returned records, and only subjects carrying 30 or more such works were
  // kept. No shelf here is invented — each one is a heading the catalogue already proves out.
  // Natural science
  { slug: 'genetics', title: 'Genetics', term: 'genetics', blurb: 'Heredity from the double helix to the gene edit: how traits pass down, how variation arises, and how a few letters of code build a whole organism.' },
  { slug: 'ecology', title: 'Ecology', term: 'ecology', blurb: 'How species and ecosystems depend on one another — energy flow, food webs, competition, and the balance a single removal can undo.' },
  { slug: 'oceanography', title: 'Oceanography', term: 'oceanography', blurb: 'The sea as a system: currents, chemistry, deep trenches, and the living water that covers most of the planet and drives its weather.' },
  { slug: 'weather', title: 'Weather & Meteorology', term: 'meteorology', blurb: 'Why the sky does what it does — fronts, pressure and storms, and the science that turns a chaotic atmosphere into a forecast.' },
  { slug: 'volcanoes', title: 'Volcanoes', term: 'volcanoes', blurb: 'Eruptions, magma, and the volcanoes that built and occasionally ruined landscapes — geology that you can watch actually happen.' },
  { slug: 'paleontology', title: 'Paleontology & Dinosaurs', term: 'paleontology', blurb: 'Fossils as evidence: the history of life read from bone, track and leaf, from the first creatures to the extinction of the dinosaurs.' },
  { slug: 'botany', title: 'Botany', term: 'botany', blurb: 'Plants as the base of everything — photosynthesis, classification, and the green machinery that feeds the rest of the living world.' },
  { slug: 'insects', title: 'Insects & Entomology', term: 'insects', blurb: 'The most numerous animals on land: identification, behaviour and metamorphosis, and the enormous role insects play in pollination and decay.' },
  { slug: 'birds', title: 'Birds & Ornithology', term: 'birds', blurb: 'Feathers, flight and song — how birds are classified and identified, and why they are the living dinosaurs closest to home.' },
  { slug: 'animal-behavior', title: 'Animal Behaviour', term: 'animal behavior', blurb: 'What animals do and why: instinct, learning and communication, and the study that grew from ethology into a science of mind without language.' },
  // The body & medicine
  { slug: 'anatomy', title: 'Human Anatomy', term: 'anatomy', blurb: 'The body mapped part by part — bone, muscle, vessel and nerve, the structural facts that every other medical question is built on.' },
  { slug: 'human-body', title: 'The Human Body', term: 'human body', blurb: 'Systems working as one: how the body moves, digests, breathes and regulates itself, written for readers who want the whole machine, not one organ.' },
  { slug: 'nutrition', title: 'Nutrition', term: 'nutrition', blurb: 'What food actually does inside the body — vitamins, calories and metabolism, and the difference between a diet that works and one that only sells.' },
  { slug: 'surgery', title: 'Surgery', term: 'surgery', blurb: 'The hands-on end of medicine: how operations are planned and performed, from the first antiseptic theatres to keyhole and robotic surgery.' },
  { slug: 'pharmacology', title: 'Pharmacology & Drugs', term: 'pharmacology', blurb: 'How a medicine works on the body and the body on the medicine — dose, mechanism and side effect, and the long business of finding the right one.' },
  { slug: 'psychiatry', title: 'Psychiatry', term: 'psychiatry', blurb: 'The mind as a clinical object: diagnosis, therapy and the drugs, and the argument about where medicine ends and the person begins.' },
  { slug: 'mental-health', title: 'Mental Health', term: 'mental health', blurb: 'Anxiety, depression and the rest, told as health rather than flaw — treatment, resilience, and the statistics behind how common it all is.' },
  { slug: 'nursing', title: 'Nursing', term: 'nursing', blurb: 'The largest workforce in healthcare: patient care, the clinical routine, and the practice that holds a hospital together between physician visits.' },
  { slug: 'dentistry', title: 'Dentistry', term: 'dentistry', blurb: 'Teeth, gums and the mouth as part of the body — the mechanics, the disease, and the surprisingly short history of making any of it painless.' },
  { slug: 'epidemiology', title: 'Epidemiology', term: 'epidemiology', blurb: 'Disease measured across populations rather than patients: how rates are set, how outbreaks are traced, and how a cause is proved without a cure.' },
  { slug: 'public-health', title: 'Public Health', term: 'public health', blurb: 'Clean water, vaccination and statistics — the discipline that saves more lives at scale than any operation and is rarely thanked for it.' },
  // Mathematics, physics & computing
  { slug: 'statistics', title: 'Statistics', term: 'statistics', blurb: 'Making sense of noisy data — probability and inference, and the difference between a real effect and one that only looks real.' },
  { slug: 'optics', title: 'Optics', term: 'optics', blurb: 'Light bent, split and focused: lenses, colour and interference, and the instruments that turn waves into microscopes and telescopes.' },
  { slug: 'quantum-physics', title: 'Quantum Physics', term: 'quantum theory', blurb: 'The rules at the smallest scale — superposition, uncertainty, and the experiments that forced physics to give up on certainty.' },
  { slug: 'nuclear-energy', title: 'Nuclear Energy & Weapons', term: 'nuclear energy', blurb: 'The atom split and fused: reactors, radiation and the bomb, and the argument over whether the same physics is our future or our danger.' },
  { slug: 'artificial-intelligence', title: 'Artificial Intelligence', term: 'artificial intelligence', blurb: 'Machines that learn, see and converse — the statistics behind the intelligence, the long history of the dream, and what it is actually good at.' },
  { slug: 'cryptography', title: 'Cryptography', term: 'cryptography', blurb: 'Secrets built on mathematics: how codes are made and broken, from ancient ciphers to public keys, and the arithmetic that keeps the internet honest.' },
  // Society, politics & law
  { slug: 'sociology', title: 'Sociology', term: 'sociology', blurb: 'Groups as something more than their members — class, institutions, and the studies that show how far the situation, not the person, explains behaviour.' },
  { slug: 'social-problems', title: 'Social Problems', term: 'social problems', blurb: 'Poverty, inequality and disorder defined, measured and argued over — the study of what societies get wrong about themselves and try to fix.' },
  { slug: 'criminology', title: 'Criminology', term: 'criminology', blurb: 'Why people break the law and what to do about it: theory, punishment and prevention, and the limits of the criminal mind as an idea.' },
  { slug: 'criminal-justice', title: 'Crime & Criminal Justice', term: 'crime', blurb: 'The system on both sides of the offence — policing, courts and prisons, and the hard question of what justice is actually meant to do.' },
  { slug: 'human-rights', title: 'Human Rights', term: 'human rights', blurb: 'Rights said to belong to everyone: their philosophical roots, the legal instruments, and the gap between declaring them and enforcing them.' },
  { slug: 'feminism', title: 'Feminism', term: 'feminism', blurb: 'The long argument about the place of women — the waves, the writing, and the analysis of power that reached far beyond the vote.' },
  { slug: 'imperialism', title: 'Imperialism & Empire', term: 'imperialism', blurb: 'How a handful of states came to rule most of the world, what it cost the ruled, and why the map after 1945 still looks the way it does.' },
  { slug: 'slavery', title: 'Slavery & Abolition', term: 'slavery', blurb: 'The oldest unfree labour and the fight to end it: the trade, the plantation, the abolitionists, and the long afterlife of it all.' },
  { slug: 'terrorism', title: 'Terrorism', term: 'terrorism', blurb: 'Violence aimed at an audience rather than a target — its history, its logic, and why it is so hard to defeat by force alone.' },
  { slug: 'education', title: 'Education', term: 'education', blurb: 'How people learn and how systems teach — schools, methods, and the endless argument about what education is meant to produce.' },
  { slug: 'child-development', title: 'Child Development', term: 'child development', blurb: 'From reflex to reason: how a child grows physically, cognitively and socially, and the research that set the milestones everyone quotes.' },
  { slug: 'parenting', title: 'Parenting', term: 'parenting', blurb: 'The daily work of raising children — attachment, discipline and the advice industry, weighed against what the evidence actually supports.' },
  { slug: 'marriage-family', title: 'Marriage & Family', term: 'marriage', blurb: 'The family as a social fact: why people pair and pair off, divorce and remarriage, and how the forms of the household keep changing.' },
  // History
  { slug: 'middle-ages', title: 'The Middle Ages', term: 'middle ages', blurb: 'A thousand years between Rome and the Renaissance — feudalism, faith and plague, and the institutions that quietly became modern Europe.' },
  { slug: 'ancient-greece', title: 'Ancient Greece', term: 'ancient greece', blurb: 'The city-states that invented democracy, philosophy and history-writing, and the wars that ended them.' },
  { slug: 'ancient-rome', title: 'Ancient Rome', term: 'ancient rome', blurb: 'From a town on the Tiber to an empire over the Mediterranean: law, engineering and legions, and the long decline the whole West still studies.' },
  { slug: 'roman-empire', title: 'The Roman Empire', term: 'roman empire', blurb: 'The empire at its height and in its fall — administration, the army and the roads, and what a world without Rome looked like afterward.' },
  { slug: 'byzantine-empire', title: 'The Byzantine Empire', term: 'byzantine empire', blurb: 'The eastern Rome that lasted a thousand years after the west fell — Constantinople, icon and emperor, and the bridge to the Renaissance.' },
  { slug: 'vikings', title: 'The Vikings', term: 'vikings', blurb: 'Norse seafarers, raiders and traders: the sagas, the ships and the settlements from Dublin to Normandy, and how Europe came to fear them.' },
  { slug: 'crusades', title: 'The Crusades', term: 'crusades', blurb: 'Holy war in the medieval Mediterranean — the expeditions out of Europe, the states they built in the Levant, and the memory left on both sides.' },
  { slug: 'french-revolution', title: 'The French Revolution', term: 'french revolution', blurb: 'The old order torn down in a decade of hope and terror — the ideas, the guillotine, and the rise of Napoleon out of the wreckage.' },
  { slug: 'industrial-revolution', title: 'The Industrial Revolution', term: 'industrial revolution', blurb: 'Steam, coal and the factory: how production moved from hand to machine, and how the speed of change remade work, cities and class.' },
  { slug: 'cold-war', title: 'The Cold War', term: 'cold war', blurb: 'The long standoff between the superpowers short of a shooting war — nuclear threat, proxy wars and the space race, and how it all ended.' },
  // Religion, philosophy & myth
  { slug: 'buddhism', title: 'Buddhism', term: 'buddhism', blurb: 'The teaching of the Buddha as it actually spread: the Four Noble Truths, the schools from Theravada to Zen, and the practice at the centre.' },
  { slug: 'christianity', title: 'Christianity', term: 'christianity', blurb: 'Two thousand years of the faith that shaped the West — scripture, doctrine and church history, and the arguments that split it again and again.' },
  { slug: 'islam', title: 'Islam', term: 'islam', blurb: 'The Quran, the Five Pillars and the civilisation that grew from them: law, science and sect, and the story from Mecca to the modern world.' },
  { slug: 'hinduism', title: 'Hinduism', term: 'hinduism', blurb: 'The vast and plural religion of the subcontinent — its scriptures, gods, philosophies and practices, which no single creed word quite fits.' },
  { slug: 'judaism', title: 'Judaism', term: 'judaism', blurb: 'Law, covenant and text: the religion of the Hebrew Bible, the Talmudic tradition, and the long history of a people and their books.' },
  { slug: 'ethics', title: 'Ethics', term: 'ethics', blurb: 'Moral philosophy without the sermon — right and wrong as questions that can be argued: duty, consequence, virtue, and what we owe each other.' },
  { slug: 'mythology', title: 'Mythology', term: 'mythology', blurb: 'The stories a culture tells about its gods and origins, compared across the world — what they meant, and why they still shape how we think.' },
  { slug: 'greek-mythology', title: 'Greek Mythology', term: 'greek mythology', blurb: 'Olympians, heroes and monsters as the Greeks told them: the myths, their sources in Homer and Hesiod, and what they explained about the world.' },
  // Arts & culture
  { slug: 'music', title: 'Music', term: 'music', blurb: 'Composition, genre and history — how the music that fills our days got its forms, and how to listen to it with real understanding.' },
  { slug: 'jazz', title: 'Jazz', term: 'jazz', blurb: 'The American art form: New Orleans, swing, bebop and improvisation, told through the players and records that invented it as they went.' },
  { slug: 'photography', title: 'Photography', term: 'photography', blurb: 'The century and a half since the first fixed image: process and masters, and the argument over whether a photograph shows the truth or makes one.' },
  { slug: 'painting', title: 'Painting', term: 'painting', blurb: 'Pigment on surface, from fresco to canvas: technique, the great movements, and the artists who kept redefining what a picture could be.' },
  { slug: 'sculpture', title: 'Sculpture', term: 'sculpture', blurb: 'Form in three dimensions — marble, bronze and modern material, from the classical figure to the work you walk around instead of look at.' },
  { slug: 'design', title: 'Design', term: 'design', blurb: 'The making of the surfaces of the built world: the object, the poster and the interface, and the designers who decided how ordinary things look.' },
  { slug: 'decorative-arts', title: 'The Decorative Arts', term: 'decorative arts', blurb: 'Furniture, ceramic, metal and textile treated as art — the craft objects that fill a home and carry the taste of their age.' },
  { slug: 'drama', title: 'Plays & Drama', term: 'drama', literary: true, blurb: 'Writing meant to be performed, not only read — tragedy, comedy and the stage, from the Athenian festival to the modern theatre.' },
  { slug: 'dance', title: 'Dance', term: 'dance', blurb: 'Movement as art and culture — technique and form, and the history of bodies in rhythm, from court ballet to modern and street forms.' },
  { slug: 'graphic-novels', title: 'Graphic Novels & Comics', term: 'graphic novels', literary: true, blurb: 'The drawn story that grew up: sequential art, from newspaper strips to the bound long-form works that made the form a literature.' },
  { slug: 'short-stories', title: 'Short Stories', term: 'short stories', literary: true, blurb: 'The tightest narrative form — a single effect in a few thousand words, and the writers who made that length an art of its own.' },
  { slug: 'essays', title: 'Essays', term: 'essays', blurb: 'The prose of thinking out loud — the descendants of Montaigne, argument and reflection in a length you can read in one sitting.' },
  { slug: 'biography', title: 'Biography', term: 'biography', blurb: 'A life rebuilt from letters, records and ruin — the form that turns one person into evidence about a whole time.' },
  { slug: 'travel-writing', title: 'Travel Writing', term: 'travel', blurb: 'Places seen through a person: the journey narrative that makes the faraway concrete and, honestly, also reveals the writer doing the seeing.' },
  { slug: 'food-cooking', title: 'Food & Cooking', term: 'cookery', blurb: 'Technique, recipe and the reason a dish works — plus the food writing that turned cooking from a chore into a subject worth reading.' },
  { slug: 'gardening', title: 'Gardening', term: 'gardening', blurb: 'Soil, seed and season: how gardens are actually made and kept, from the practical handbook to the plain pleasure of watching something grow.' },
  { slug: 'horses', title: 'Horses', term: 'horses', blurb: 'The animal that carried civilisation: breeding and horsemanship, and the long partnership from the steppe to the racetrack.' },
  { slug: 'dogs', title: 'Dogs', term: 'dogs', blurb: 'Breed, training and the mind of the dog — the domesticated wolf that became companion and worker, and, on the best evidence, a reader of faces.' },
  { slug: 'cats', title: 'Cats', term: 'cats', blurb: 'The semi-domesticated hunter that moved in: breed, behaviour and care, and the strange fact that a cat chose the household more than we chose it.' },
  // Business & money
  { slug: 'business', title: 'Business', term: 'business', blurb: 'How firms are started, run and grown — strategy and operation, and the basic question of how a business actually makes money.' },
  { slug: 'management', title: 'Management', term: 'management', blurb: 'Getting organised people to do the work: leadership, process, and the theories that try, with mixed success, to make it a discipline.' },
  { slug: 'marketing', title: 'Marketing', term: 'marketing', blurb: 'How demand is made as much as met — brand, positioning and the techniques that move a market, and the ethics argument that always follows.' },
  { slug: 'finance', title: 'Finance', term: 'finance', blurb: 'Money over time: the markets, the instruments and the risk, and how capital gets priced and moved and, on occasion, lost.' },
  { slug: 'investing', title: 'Investing', term: 'investments', blurb: 'Putting money to work in stocks, bonds and property — the theory, the practice, and the line between investing and gambling in disguise.' },
  { slug: 'personal-finance', title: 'Personal Finance', term: 'personal finance', blurb: 'Budgeting, saving, tax and the pension — the arithmetic of the money of one household, which is the finance that actually touches most people.' },
  { slug: 'accounting', title: 'Accounting', term: 'accounting', blurb: 'The language of business: how a firm records its money, and the statements that let a stranger tell whether it is sound or only dressed up.' },
  { slug: 'entrepreneurship', title: 'Entrepreneurship', term: 'entrepreneurship', blurb: 'The founder problem: turning an idea into a company that survives, from the first customers and funding to the near-constant risk of failing.' },
  { slug: 'leadership', title: 'Leadership', term: 'leadership', blurb: 'The quality everyone wants and no one has pinned down: what leaders actually do, what the evidence says about it, and where the myth begins.' },
  // Sport & the outdoor life
  { slug: 'sports', title: 'Sports', term: 'sports', blurb: 'Organised competition that turned into an industry — its history, its economics, and the plain question of why we watch strangers play.' },
  { slug: 'football', title: 'Association Football', term: 'soccer', blurb: 'The world game: tactics, clubs and the great competitions, and how a simple kick-about became the biggest sport on earth.' },
  { slug: 'basketball', title: 'Basketball', term: 'basketball', blurb: 'The five-player game and its leagues — skill, style, and the culture that carried basketball from a gym in Massachusetts to the world.' },
  { slug: 'tennis', title: 'Tennis', term: 'tennis', blurb: 'Baseline, serve and the great rivalries: the technique and tactics of the individual racket sport, and the tours that made its champions.' },
  { slug: 'olympic-games', title: 'The Olympic Games', term: 'olympic games', blurb: 'The festival of sport on which nations spend fortunes and settle arguments — its modern revival, its records, and its politics.' },
  { slug: 'physical-fitness', title: 'Physical Fitness & Exercise', term: 'physical fitness', blurb: 'Training the body on purpose: strength, endurance, and the physiology of why exercise works, minus the magazine guesswork around it.' },
  { slug: 'mountaineering', title: 'Mountaineering', term: 'mountaineering', blurb: 'Climbing as a discipline of its own: technique, the great ascents, and the psychology of choosing to go up the hard side of a mountain.' },
  { slug: 'surfing', title: 'Surfing', term: 'surfing', blurb: 'The sport of riding water: how it works, where it came from, and the whole culture built around waiting for the right wave.' },
  { slug: 'swimming', title: 'Swimming', term: 'swimming', blurb: 'Strokes, training and the races — the whole-body sport, from learning only to stay up to elite distance and sprint work.' },
  { slug: 'bicycles', title: 'Bicycles & Cycling', term: 'bicycles', blurb: 'The machine and the ride together: the design and history of the bicycle, and the way a two-wheeled frame changed commuting and cities.' },
  // Engineering & transport
  { slug: 'aviation', title: 'Aviation', term: 'aviation', blurb: 'Heavier-than-air flight: the pioneers and the aircraft and the whole system, and how a century went from a hundred-foot hop to crossing oceans.' },
  { slug: 'aircraft', title: 'Aircraft & Airliners', term: 'airplanes', blurb: 'The flying machines themselves — their design, the great airliners and warbirds, and how they work through the air and sometimes fail.' },
  { slug: 'railways', title: 'Railways', term: 'railroads', blurb: 'The spine of the steam age: engines, lines and the companies that shrank distance, and why the railway shaped modern time and travel.' },
  { slug: 'automobiles', title: 'Automobiles & Cars', term: 'automobiles', blurb: 'The car as machine, industry and culture — its engineering and its models, and the way private engines on four wheels rebuilt every city.' },
  { slug: 'space-flight', title: 'Space Flight & Rockets', term: 'space flight', blurb: 'Getting off the planet and staying there: the rocketry, the missions and the people, and the argument about what space is actually for.' },
  { slug: 'telescopes', title: 'Telescopes', term: 'telescopes', blurb: 'The instrument that made modern astronomy: optics and the great telescopes, and how a tube of mirrors reaches back to the early universe.' },
  // Cosmology & the big questions
  { slug: 'cosmology', title: 'Cosmology', term: 'cosmology', blurb: 'The universe as a whole — its origin, expansion and fate, and the physics that lets us say anything rigorous about what came before time.' },
  { slug: 'extraterrestrial-life', title: 'Intelligent Life in the Universe', term: 'extraterrestrial life', blurb: 'The scientific case for and against company in the cosmos: how life might arise elsewhere, and the search that actually goes looking.' },
  { slug: 'death', title: 'Death & Dying', term: 'death', blurb: 'The one certainty, approached honestly: grief and the end of life, the way cultures bury, and the writing that helps people think about it.' },
  { slug: 'happiness', title: 'Happiness', term: 'happiness', blurb: 'What makes a life feel good, asked as a real question — the findings on money, work, relationship and habit, tested against the self-help shelf.' },
  { slug: 'dreams', title: 'Dreams', term: 'dreams', blurb: 'The nightly cinema of the brain: what dreams seem to be made of, what research says they are for, and the long history of trying to read them.' },
  { slug: 'creativity', title: 'Creativity', term: 'creativity', blurb: 'Where new ideas come from and how to get more of them: the process and the practice, and the useful doubt about the myth of the unmotivated muse.' },

  // ── Expanded catalogue, second pass (added Nov 2026). Same rule as the pass above: every
  // term below was verified against the Open Library search API with the exact lowercase
  // subject string required on the returned records, and only subjects carrying 30 or more
  // such works were kept. A handful of plausible headings (electricity, camping, holocaust,
  // knights and chivalry) failed that check and are deliberately absent — the catalogue,
  // not taste, decides what a shelf can hold.
  // Science and medicine
  { slug: 'microbiology', title: 'Microbiology', term: 'microbiology', blurb: 'The invisible machinery of life: germs, cultures, and the small organisms that turned medicine inside out.' },
  { slug: 'immunology', title: 'Immunology', term: 'immunology', blurb: 'How a body tells self from not-self: antibodies, vaccines, allergies, and the transplants immunology made possible.' },
  { slug: 'biochemistry', title: 'Biochemistry', term: 'biochemistry', blurb: 'Living things read as chemistry: proteins, enzymes, and the pathways that turn food into thought.' },
  { slug: 'marine-biology', title: 'Marine Biology', term: 'marine biology', blurb: 'Life in the sea from plankton to whales: the biology of saltwater, its field work, and its deep dark margins.' },
  { slug: 'zoology', title: 'Zoology', term: 'zoology', blurb: 'The animal kingdom surveyed: classification, anatomy, behavior, and the discipline that first organized the menagerie.' },
  { slug: 'cardiology', title: 'Cardiology', term: 'cardiology', blurb: 'The heart as pump and patient: rhythms, arteries, surgery, and the epidemiology of the most common way to die.' },
  { slug: 'oncology', title: 'Oncology', term: 'oncology', blurb: 'Cancer as disease and as experience: how cells go wrong, how treatments strike at them, and what the war on cancer cost and learned.' },
  { slug: 'neurology', title: 'Neurology', term: 'neurology', blurb: 'The nervous system when it works and when it misfires: strokes, seizures, aphasias, and the mapping of brain to behavior.' },
  { slug: 'pediatrics', title: 'Pediatrics', term: 'pediatrics', blurb: 'Medicine for bodies still growing: newborn care, childhood illness, and the specialty that split itself off from general practice.' },
  { slug: 'infectious-diseases', title: 'Infectious Diseases', term: 'infectious diseases', blurb: 'Pathogens and their routes through populations: outbreaks, transmission, and the slow grasp of how contagion actually travels.' },
  { slug: 'vaccines', title: 'Vaccines', term: 'vaccines', blurb: 'Inoculation from Jenner to mRNA: how the shots are made, why they spread, and the arguments that have followed them for two centuries.' },
  { slug: 'diabetes', title: 'Diabetes', term: 'diabetes', blurb: 'Sugar and insulin: two diseases under one name, their daily management, and the research that made a fatal diagnosis survivable.' },
  { slug: 'asthma', title: 'Asthma', term: 'asthma', blurb: 'The breath that comes hard: airways, triggers, inhalers, and the science of the most common chronic illness of childhood.' },
  { slug: 'arthritis', title: 'Arthritis', term: 'arthritis', blurb: 'The joints that will not stop hurting: types, treatments, surgery, and the long daily arithmetic of living with a common, disabling condition.' },
  { slug: 'malaria', title: 'Malaria', term: 'malaria', blurb: 'The mosquito-borne disease that shaped empires: parasites, quinine, nets, and the stubborn failure of eradication.' },
  { slug: 'tuberculosis', title: 'Tuberculosis', term: 'tuberculosis', blurb: 'Consumption’s long shadow: the sanatorium era, the antibiotics that seemed to win, and the resurgence nobody expected.' },
  { slug: 'radiation', title: 'Radiation', term: 'radiation', blurb: 'Energy that travels and penetrates: discovery, measurement, medical use, and the danger that made the word frightening.' },
  { slug: 'nuclear-physics', title: 'Nuclear Physics', term: 'nuclear physics', blurb: 'The nucleus opened: fission, fusion, reactors, and weapons — the physics that came out of the forties and never left.' },
  { slug: 'thermodynamics', title: 'Thermodynamics', term: 'thermodynamics', blurb: 'Heat, work, and entropy: the laws that govern every engine and refrigerator, and eventually every star.' },
  { slug: 'relativity', title: 'Relativity', term: 'relativity (physics)', blurb: 'Einstein’s rewrite of space and time: special and general, the evidence from eclipses to GPS, and what it did to simultaneity.' },
  { slug: 'seismology', title: 'Seismology', term: 'seismology', blurb: 'Reading the earth’s tremors: instruments, wave paths, plate tectonics, and what a seismogram can be made to say.' },
  { slug: 'earthquakes', title: 'Earthquakes', term: 'earthquakes', blurb: 'When the ground moves: mechanisms, famous disasters, engineering against the shake, and prediction’s honest failures.' },
  { slug: 'tsunamis', title: 'Tsunamis', term: 'tsunamis', blurb: 'The waves that start as tremors: generation, run-up, historic strikes, and what coastlines can and cannot do about them.' },
  { slug: 'mineralogy', title: 'Mineralogy', term: 'mineralogy', blurb: 'The species of the inorganic world: crystals, properties, identification, and the cabinet that became a science.' },
  { slug: 'fossils', title: 'Fossils', term: 'fossils', blurb: 'Lives kept in stone: how fossils form, how they are dated, and the archive paleontology reads like a text.' },
  // The living world
  { slug: 'endangered-species', title: 'Endangered Species', term: 'endangered species', blurb: 'The red lists and the rare: what puts a species at the edge, and the programs trying to pull it back from there.' },
  { slug: 'extinct-animals', title: 'Extinct Animals', term: 'extinct animals', blurb: 'Loss as a fact of life on earth: the great dying events, the dodo and the quagga, and the question of de-extinction.' },
  { slug: 'primates', title: 'Primates', term: 'primates', blurb: 'Apes, monkeys, and us: field study from Gombe onward, the biology of the families, and the place we cannot decline to occupy.' },
  { slug: 'reptiles', title: 'Reptiles', term: 'reptiles', blurb: 'Scaled and cold-blooded: snakes, lizards, turtles, and crocodiles — their classification, their care, and their reputation.' },
  { slug: 'amphibians', title: 'Amphibians', term: 'amphibians', blurb: 'Frogs, salamanders, and newts: the animals of two lives, their strange biology, and their unexplained worldwide collapse.' },
  { slug: 'fishes', title: 'Fishes', term: 'fishes', blurb: 'The oldest vertebrates: ichthyology, the fisheries science, and the aquarium wonder of the half of them that have common names.' },
  { slug: 'sharks', title: 'Sharks', term: 'sharks', blurb: 'Four hundred million years of refined predators: species, behavior, attacks, biology, and a reputation the data keeps correcting.' },
  { slug: 'whales', title: 'Whales', term: 'whales', blurb: 'The whales and their kin: natural history, the toll of whaling, songs recorded and decoded, and minds in the water.' },
  { slug: 'spiders', title: 'Spiders', term: 'spiders', blurb: 'Webs, venom, and eight eyes: the arachnid world, the science of it, and the fear that keeps it in the news.' },
  { slug: 'butterflies', title: 'Butterflies', term: 'butterflies', blurb: 'Metamorphosis and the Lepidoptera: identification, migration, the collector’s cabinet, and the garden that feeds them.' },
  { slug: 'bats', title: 'Bats', term: 'bats', blurb: 'The mammals that fly: echolocation, roosts, their ecology of insects and pollen, and the mythology that never gave them rest.' },
  { slug: 'wolves', title: 'Wolves', term: 'wolves', blurb: 'The pack animal: biology, behavior, life alongside people, and the reintroduction arguments that run through entire towns.' },
  { slug: 'bears', title: 'Bears', term: 'bears', blurb: 'From sun bear to polar bear: the species, their natural history, and a human literature of encounters all its own.' },
  { slug: 'eagles', title: 'Eagles', term: 'eagles', blurb: 'The hooked-billed hunters: raptor biology and flight, and the conservation stories that made the bald eagle a national patient.' },
  { slug: 'wild-flowers', title: 'Wild Flowers', term: 'wild flowers', blurb: 'The botany of the meadow and the roadside: identification, the picking ethic, and the flower that no gardener put there.' },
  { slug: 'mushrooms', title: 'Mushrooms', term: 'mushrooms', blurb: 'Fungi in full: identification, edibility and poison, and the hidden mycelium doing the real work under the leaf litter.' },
  { slug: 'medicinal-plants', title: 'Medicinal Plants', term: 'medicinal plants', blurb: 'The pharmacy before the pharmacy: herbal remedies, their active compounds, and the science that vindicated or retired each one.' },
  { slug: 'edible-plants', title: 'Edible Plants', term: 'edible plants', blurb: 'The wild pantry: what the field and forest offer to eat, how to know it, and the boundary between salad and poison.' },
  { slug: 'biodiversity', title: 'Biodiversity', term: 'biodiversity', blurb: 'Variety as a quantity: how it is measured and explained, and the case — ecological, medical, moral — for keeping it.' },
  { slug: 'pollution', title: 'Pollution', term: 'pollution', blurb: 'What we put where it should not be: air, water, and soil, its chemistry and its costs, and the laws written after the fact.' },
  { slug: 'recycling', title: 'Recycling', term: 'recycling', blurb: 'Waste as material: collection, processing, markets, and the honest arithmetic of what actually gets used again.' },
  { slug: 'renewable-energy', title: 'Renewable Energy', term: 'renewable energy resources', blurb: 'Power the sun and wind keep supplying: the technologies, their limits, and the economics of replacing stored carbon.' },
  { slug: 'wind-turbines', title: 'Wind Turbines', term: 'wind turbines', blurb: 'The modern windmill: aerodynamics, siting, the grid questions, and the landscape arguments that arrive with each blade.' },
  // Mathematics
  { slug: 'algebra', title: 'Algebra', term: 'algebra', blurb: 'From word puzzles to abstract structure: the unknown made a variable, and everything that followed in the notation.' },
  { slug: 'geometry', title: 'Geometry', term: 'geometry', blurb: 'Shape, proof, and space: Euclid’s book, and everything that grew out of doubting one of its axioms.' },
  { slug: 'trigonometry', title: 'Trigonometry', term: 'trigonometry', blurb: 'Triangles into waves: the ratios that served navigation and surveying, and became the grammar of anything that oscillates.' },
  { slug: 'calculus', title: 'Calculus', term: 'calculus', blurb: 'Change made computable: derivatives and integrals, the priority quarrel, and the tool that physics could not be built without.' },
  { slug: 'number-theory', title: 'Number Theory', term: 'number theory', blurb: 'The integers keep their own secrets: primes, congruences, and problems easy to state that are famous for resisting.' },
  { slug: 'probability', title: 'Probability', term: 'probability', blurb: 'Chance made respectable to calculate: from gamblers’ disputes to the foundation statistics now stands on.' },
  { slug: 'game-theory', title: 'Game Theory', term: 'game theory', blurb: 'Strategy as mathematics: players, payoffs, equilibria, and the reasoning behind not moving first.' },
  { slug: 'topology', title: 'Topology', term: 'topology', blurb: 'Geometry with the rulers put away: what stays true when you are allowed to stretch but never tear.' },
  { slug: 'fractals', title: 'Fractals', term: 'fractals', blurb: 'Self-similar worlds: Mandelbrot’s coastlines, infinite detail from finite rules, and the shapes hidden in the ordinary.' },
  { slug: 'chaos-theory', title: 'Chaos Theory', term: 'chaos theory', blurb: 'Deterministic and still unpredictable: sensitive dependence, weather, and the butterfly’s famous wing.' },
  { slug: 'puzzles', title: 'Puzzles', term: 'puzzles', blurb: 'Recreational logic in every shape: the conundrum, the maze, the puzzle-book tradition, and the setter’s craft.' },
  // Computing
  { slug: 'computer-programming', title: 'Computer Programming', term: 'computer programming', blurb: 'Languages, methods, and practice: how software is written and tested, and the arguments about both that never quite end.' },
  { slug: 'algorithms', title: 'Algorithms', term: 'algorithms', blurb: 'Recipes that compute: correctness, efficiency, and the quiet analysis behind every route and feed you use daily.' },
  { slug: 'internet', title: 'The Internet', term: 'internet', blurb: 'The network of networks: protocols, history, and the infrastructure that nobody owns and everybody depends on.' },
  { slug: 'world-wide-web', title: 'The World Wide Web', term: 'world wide web', blurb: 'Hypertext from Berners-Lee onward: pages, links, standards, and how the web was built on top of the wires.' },
  { slug: 'robotics', title: 'Robotics', term: 'robotics', blurb: 'Machines that sense and act: kinematics, AI’s physical cousin, and the factories and futures they keep promising.' },
  { slug: 'automation', title: 'Automation', term: 'automation', blurb: 'Work done without hands watching: machinery, feedback, and the labor question automation keeps putting on the table.' },
  { slug: 'biotechnology', title: 'Biotechnology', term: 'biotechnology', blurb: 'Organisms as tools: from brewing to gene editing, and the regulation and unease that trail each advance.' },
  { slug: 'nanotechnology', title: 'Nanotechnology', term: 'nanotechnology', blurb: 'Engineering at atomic scale: materials, medicine, and the difference between the measurements kept and the promises.' },
  { slug: 'virtual-reality', title: 'Virtual Reality', term: 'virtual reality', blurb: 'Simulated presence: headsets, worlds, and the old dream of the complete interface, renewed with each try.' },
  { slug: 'video-games', title: 'Video Games', term: 'video games', blurb: 'The medium’s short long history: arcade to console, design and culture, and the players who made it a literature.' },
  { slug: 'data-mining', title: 'Data Mining', term: 'data mining', blurb: 'Finding pattern in volume: statistics’ busy cousin, from market baskets to astronomy, and the privacy it ignores.' },
  // History
  { slug: 'ancient-egypt', title: 'Ancient Egypt', term: 'ancient egypt', blurb: 'The civilization of the Nile across thirty centuries: pharaohs, tombs, and the decipherment that let it speak again.' },
  { slug: 'mesopotamia', title: 'Mesopotamia', term: 'mesopotamia', blurb: 'Between the rivers: Sumer, Babylon, Assyria, the first written pages, and law cut into stone.' },
  { slug: 'pyramids', title: 'Pyramids', term: 'pyramids', blurb: 'The tombs and their builders: how they were raised, why they were raised, and the endless speculation they still fund.' },
  { slug: 'renaissance', title: 'The Renaissance', term: 'renaissance', blurb: 'Rebirth in Florence and beyond: art, patronage, humanism — and the historians’ argument over whether the middle ages ever ended.' },
  { slug: 'reformation', title: 'The Reformation', term: 'reformation', blurb: 'Luther, Calvin, and the fracture of western Christendom: printed theses, wars of religion, and a Bible in the vernacular.' },
  { slug: 'enlightenment', title: 'The Enlightenment', term: 'enlightenment', blurb: 'The age of reason and its salons: encyclopedias, tolerance, and the ideas every later revolution quoted back.' },
  { slug: 'witchcraft', title: 'Witchcraft', term: 'witchcraft', blurb: 'The trials, the beliefs, and the modern revival: cunning-folk, the demonologists, and Wicca’s own account.' },
  { slug: 'alchemy', title: 'Alchemy', term: 'alchemy', blurb: 'Transmutation before chemistry: the great work, the laboratories, and the psychologists who later claimed alchemy back.' },
  { slug: 'inquisition', title: 'The Inquisition', term: 'inquisition', blurb: 'Tribunals of belief: procedure, victims, politics, and the still-contested tally the records allow.' },
  { slug: 'world-war-1914-1918', title: 'The First World War', term: 'world war, 1914-1918', blurb: 'The first industrial war: trenches, the alliance trap, total mobilization, and the peace that did not hold.' },
  { slug: 'world-war-1939-1945', title: 'The Second World War', term: 'world war, 1939-1945', blurb: 'The global war in full: campaigns, home fronts, atrocity, and the postwar world it left behind.' },
  { slug: 'castles', title: 'Castles', term: 'castles', blurb: 'Stone and strategy: fortification, life inside the walls, and the ruins that outlived their purpose by centuries.' },
  { slug: 'feudalism', title: 'Feudalism', term: 'feudalism', blurb: 'Land, loyalty, and labor: the medieval social order — and the historians who doubt the word describes it at all.' },
  { slug: 'mongolia', title: 'Mongolia', term: 'mongolia', blurb: 'The steppe and its empire: nomadic life, Genghis Khan and his successors, and the trade routes the horsemen stitched together.' },
  { slug: 'aztecs', title: 'The Aztecs', term: 'aztecs', blurb: 'The people of the eagle and the cactus city: Tenochtitlan, tribute, sacrifice, and the Spanish verdict on all three.' },
  { slug: 'mayas', title: 'The Maya', term: 'mayas', blurb: 'The lowland civilization: jungle cities, the Long Count, hieroglyphs read again — and a people who never disappeared.' },
  { slug: 'incas', title: 'The Incas', term: 'incas', blurb: 'Empire of the four quarters: roads without the wheel, records in knotted string, and the accounting of the conquest.' },
  { slug: 'explorers', title: 'Explorers', term: 'explorers', blurb: 'The age that mapped the coasts: voyages, patrons, journals — and the price paid by the peoples who were “discovered.”' },
  { slug: 'pirates', title: 'Pirates', term: 'pirates', blurb: 'Real crews and their articles, from the Caribbean to the Indian Ocean — and the fictional afterlife that made them fashionable.' },
  { slug: 'shipwrecks', title: 'Shipwrecks', term: 'shipwrecks', blurb: 'The literature of loss at sea: disasters, rescues, salvage, and the archaeology of what the water gave back.' },
  { slug: 'titanic', title: 'Titanic', term: 'titanic (steamship)', blurb: 'The ship, the iceberg, the inquiries: Edwardian class on deck, engineering below, and the regulations written after.' },
  { slug: 'frontier-and-pioneer-life', title: 'Pioneers & the Frontier', term: 'frontier and pioneer life', blurb: 'The American west as daily work: wagon trails, homesteads, and the mythology layered thickly over both.' },
  { slug: 'indians-of-north-america', title: 'Native North America', term: 'indians of north america', blurb: 'The hundreds of nations: histories, contact, removal, and the living cultures speaking for themselves.' },
  { slug: 'labor-unions', title: 'Labor Unions', term: 'labor unions', blurb: 'Organized work: the trade unions, the strikes, the bargaining, and the movements that won the weekend.' },
  { slug: 'fascism', title: 'Fascism', term: 'fascism', blurb: 'The interwar creed: the state as aesthetic, mass politics, and the definitions historians still do not share.' },
  { slug: 'globalization', title: 'Globalization', term: 'globalization', blurb: 'The world as one market: trade routes, capital, migration — and the literatures on both sides of the ledger.' },
  { slug: 'refugees', title: 'Refugees', term: 'refugees', blurb: 'Forced movement: asylum, the camps, and the first-person accounts of people carrying what they could.' },
  { slug: 'civil-rights-movements', title: 'Civil Rights Movements', term: 'civil rights movements', blurb: 'The American struggle and its echoes elsewhere: mass action, legal campaigns, and the unfinished agenda.' },
  { slug: 'abolitionists', title: 'Abolitionists', term: 'abolitionists', blurb: 'The movement that ended slavery in the Americas: the pamphlets, the networks, and the arguments that hardened into action.' },
  { slug: 'underground-railroad', title: 'The Underground Railroad', term: 'underground railroad', blurb: 'The routes to freedom: conductors, stations, the Fugitive Slave Law, and the risk that made every mile a battle.' },
  { slug: 'secret-societies', title: 'Secret Societies', term: 'secret societies', blurb: 'Oaths, lodges, and conspiracies: the documented history of the groups that required discretion, and the myths around them.' },
  { slug: 'freemasonry', title: 'Freemasonry', term: 'freemasonry', blurb: 'The operative and speculative craft: lodges, ritual, and the order’s long entanglement with enlightenment politics.' },
  // Prehistory & archaeology
  { slug: 'dinosaurs', title: 'Dinosaurs', term: 'dinosaurs', blurb: 'The recovered reptiles: discovery, the warm-blood and feather debates, and the popular science that never stopped growing.' },
  { slug: 'stone-age', title: 'The Stone Age', term: 'stone age', blurb: 'Two million years of making: flint, bone, cave painting, and the human being before farming.' },
  { slug: 'bronze-age', title: 'The Bronze Age', term: 'bronze age', blurb: 'The alloy that made kings: metallurgy, long-distance trade, and the first literate societies of Europe and the Near East.' },
  { slug: 'iron-age', title: 'The Iron Age', term: 'iron age', blurb: 'Cheap metal, harder weapons: hillforts, Hallstatt to La Tène, and the Celtic worlds Rome wrote about reluctantly.' },
  { slug: 'human-evolution', title: 'Human Evolution', term: 'human evolution', blurb: 'From australopithecine to us: fossils, tools, genes, and a family tree redrawn almost every year.' },
  { slug: 'antiquities', title: 'Antiquities', term: 'antiquities', blurb: 'Objects from the ancient world: collections and markets, and the argument about who gets to own the past.' },
  { slug: 'excavations', title: 'Excavations', term: 'excavations (archaeology)', blurb: 'The dig itself: stratigraphy, recording, and what a single well-dug trench can be made to say.' },
  { slug: 'archaeology', title: 'Archaeology', term: 'archaeology', blurb: 'The discipline of material culture: survey, dating, interpretation — and the spectacular misreadings along the way.' },
  // Geography & the planet
  { slug: 'maps', title: 'Maps', term: 'maps', blurb: 'The graphic history of space: portolan charts to satellites, and the old argument that every map distorts on purpose.' },
  { slug: 'cartography', title: 'Cartography', term: 'cartography', blurb: 'Map-making as craft and science: projections, symbols, production — and the judgment calls hidden in every sheet.' },
  { slug: 'deserts', title: 'Deserts', term: 'deserts', blurb: 'The dry third of the land: Sahara to Gobi, life adapted to thirst, and the cultures built around oases.' },
  { slug: 'sahara', title: 'The Sahara', term: 'sahara', blurb: 'The great desert: crossings, its peoples, climate cycles, and the archaeology of the times when it was green.' },
  { slug: 'arctic-regions', title: 'The Arctic', term: 'arctic regions', blurb: 'The frozen north: the ice and its animals, the expeditions, the Inuit home, and the warming on every front page.' },
  { slug: 'antarctica', title: 'Antarctica', term: 'antarctica', blurb: 'The southern continent: the heroic age, the science stations, and the treaty that made research outrank ownership.' },
  { slug: 'islands', title: 'Islands', term: 'islands', blurb: 'Separated land: how islands form, what evolves on them, and the literature of being surrounded by water.' },
  { slug: 'glaciers', title: 'Glaciers', term: 'glaciers', blurb: 'Rivers of ice: movement, the erosion they carve, the retreat that measures the climate, and the records kept in them.' },
  { slug: 'caves', title: 'Caves', term: 'caves', blurb: 'The passages under: limestone and time, the explorers’ ledgers, and the specialized life that prefers the dark.' },
  { slug: 'natural-history', title: 'Natural History', term: 'natural history', blurb: 'Observing living things before “biology” was a word: the cabinets, the illustrated surveys, and the amateurs who kept at it.' },
  { slug: 'national-parks', title: 'National Parks', term: 'national parks and reserves', blurb: 'Land set apart: the idea’s birth in 1872, its global copies, and the arguments over tourism, wildlife, and the word wilderness.' },
  { slug: 'ocean-bottom', title: 'The Ocean Floor', term: 'ocean bottom', blurb: 'The least-known landscape: sounding and side-scan, the mid-ocean ridges, and the plains that cover most of the planet.' },
  { slug: 'moon', title: 'The Moon', term: 'moon', blurb: 'Our nearest neighbor: its phases and its pull, the Apollo landings, and what an airless world taught the probes.' },
  { slug: 'comets', title: 'Comets', term: 'comets', blurb: 'Icy visitors on long ellipses: returns, nuclei reached by probes, and the superstitions comets used to explain.' },
  { slug: 'meteorites', title: 'Meteorites', term: 'meteorites', blurb: 'Rocks that fell: the finds and their analysis, and what they say about the solar system’s first moments.' },
  { slug: 'atmosphere', title: 'The Atmosphere', term: 'atmosphere', blurb: 'The envelope of air: layers and circulation, what we have changed in it, and the science that watches both.' },
  { slug: 'clouds', title: 'Clouds', term: 'clouds', blurb: 'The readable sky: classification, how drops form, and the photography and folklore that grew up under them.' },
  { slug: 'floods', title: 'Floods', term: 'floods', blurb: 'Water out of its banks: the great recorded floods, floodplain life, and the engineering that promises more every century.' },
  { slug: 'tides', title: 'Tides', term: 'tides', blurb: 'The moon’s pull made measurable: the theory since Newton, the range of the coasts, and the energy in the ebb.' },
  { slug: 'waves', title: 'Waves', term: 'waves', blurb: 'Motion moving through stuff: water swell and breakers, and the physics that treats sound and light as the same trick.' },
  // Music & performance
  { slug: 'rock-music', title: 'Rock Music', term: 'rock music', blurb: 'From the roots to the arena: the records, the culture, and the serious writing that grew up beside the amps.' },
  { slug: 'popular-music', title: 'Popular Music', term: 'popular music', blurb: 'The songs of their moment: the industry, the stars, and the argument about what pop was ever for.' },
  { slug: 'classical-music', title: 'Classical Music', term: 'classical music', blurb: 'The tradition with the capital C: composers, works, forms, and the listening habits grown around them.' },
  { slug: 'operas', title: 'Opera', term: 'operas', blurb: 'Drama sung from Monteverdi on: the scores, the voices, the staging, and the business of keeping it all alive.' },
  { slug: 'hip-hop', title: 'Hip-Hop', term: 'hip-hop', blurb: 'From block party to industry: DJs, MCs, the sample and the verse, and the global rhymes that followed.' },
  { slug: 'blues', title: 'The Blues', term: 'blues (music)', blurb: 'The twelve bars under so much else: Delta to electric Chicago, and the musicians who wrote the form.' },
  { slug: 'country-music', title: 'Country Music', term: 'country music', blurb: 'Rural America’s ballads and their business: performers, the genres called country, and the identity claims around them.' },
  { slug: 'reggae', title: 'Reggae', term: 'reggae music', blurb: 'Jamaica’s rhythm and its message: the studios, Rastafari, Marley, and the worldwide roots sound after.' },
  { slug: 'electronic-music', title: 'Electronic Music', term: 'electronic music', blurb: 'Machines as instruments: synthesis, the dance floor, and the generation that made the studio the artist.' },
  { slug: 'world-music', title: 'World Music', term: 'world music', blurb: 'The label and the musics under it: traditions heard from outside, and the argument about the shelf itself.' },
  { slug: 'guitar', title: 'The Guitar', term: 'guitar', blurb: 'Six strings’ history: players and builders, technique and repertoire, and the instrument’s near-universal travel.' },
  { slug: 'piano', title: 'The Piano', term: 'piano', blurb: 'The keyboard’s two centuries: makers, players, pedagogy, and the instrument sitting at the center of so much written music.' },
  { slug: 'singing', title: 'Singing', term: 'singing', blurb: 'The oldest instrument: technique and training, and the choral, folk, and pop traditions that use it all day.' },
  { slug: 'composers', title: 'Composers', term: 'composers', blurb: 'The people who wrote the music: lives, works, methods, and the letters and sketchbooks left behind.' },
  { slug: 'ballet', title: 'Ballet', term: 'ballet', blurb: 'Codified movement: court to stage, the schools, the repertory, and the bodies the art has always demanded.' },
  { slug: 'theater', title: 'Theater', term: 'theater', blurb: 'The live agreement between stage and audience: plays, direction, production, and the theory around the contract.' },
  { slug: 'radio', title: 'Radio', term: 'radio', blurb: 'Broadcasting’s first medium: the transmitters, the programming, and the voices that defined whole evenings.' },
  { slug: 'sound-recordings', title: 'Sound Recordings', term: 'sound recordings', blurb: 'Captured and replayed: from wax cylinders to digital files, and the industry built around the take.' },
  { slug: 'circus', title: 'The Circus', term: 'circus', blurb: 'The ring and the big top: acrobats, equestrians, bands, and the social history of the traveling show.' },
  { slug: 'clowns', title: 'Clowns', term: 'clowns', blurb: 'The painted comic: Grimaldi’s legacy, the craft of the gag, and the uncanny reputation that came with the paint.' },
  { slug: 'magic', title: 'Magic', term: 'magic', literary: true, blurb: 'Sleight of hand and older beliefs: the conjurers’ secrets, the folk magic the word once meant, and the spells fiction kept.' },
  { slug: 'ventriloquism', title: 'Ventriloquism', term: 'ventriloquism', blurb: 'The voice that seems to come from elsewhere: the act, the dummies, and the long fascination with speaking without moving.' },
  // Art & design
  { slug: 'water-color-painting', title: 'Watercolor Painting', term: 'water-color painting', blurb: 'Pigment, paper, and the control of water: materials, technique, and the landscape tradition the medium is best at.' },
  { slug: 'portraits', title: 'Portraits', term: 'portraits', blurb: 'Faces commissioned and kept: the sitters, the painters, and what a likeness was ever for.' },
  { slug: 'book-illustration', title: 'Book Illustration', term: 'illustration of books', blurb: 'The drawn page: illustrators and their publishers, and the visual layer many readers grew up inside.' },
  { slug: 'graffiti', title: 'Graffiti', term: 'graffiti', blurb: 'Writing in public: from subway cars to galleries, and the argument over which word — art or vandalism — fits.' },
  { slug: 'street-art', title: 'Street Art', term: 'street art', blurb: 'Work made outdoors: murals, stencils, paste-ups, and the cities that eventually negotiated with it.' },
  { slug: 'interior-decoration', title: 'Interior Decoration', term: 'interior decoration', blurb: 'Living inside: color, furnishing, period styles, and the craft of arranging a room to be lived in.' },
  { slug: 'furniture', title: 'Furniture', term: 'furniture', blurb: 'Styles and making: period pieces, joinery, and the design history of chairs, tables, and cases.' },
  { slug: 'gardens', title: 'Gardens', term: 'gardens', blurb: 'Designed green space: plans and planting, and the writing of the great garden traditions.' },
  { slug: 'landscape-architecture', title: 'Landscape Architecture', term: 'landscape architecture', blurb: 'Land as designed work: parks, campuses, boulevards, and the profession that shaped the outdoors.' },
  // Craft & collecting
  { slug: 'weaving', title: 'Weaving', term: 'weaving', blurb: 'Cloth interlaced: looms and structures, from the household industry to the studio weaver’s frame.' },
  { slug: 'spinning', title: 'Spinning', term: 'spinning', blurb: 'Fiber into yarn: the drop spindle and the wheel, and the slow craft revival that took them up again.' },
  { slug: 'knitting', title: 'Knitting', term: 'knitting', blurb: 'Two needles and endless pattern: instructions and history, and the culture that picked the stitches back up.' },
  { slug: 'sewing', title: 'Sewing', term: 'sewing', blurb: 'Making and mending by needle: technique, dressmaking, and the machine that changed both.' },
  { slug: 'quilting', title: 'Quilting', term: 'quilting', blurb: 'The layered coverlet: patterns, the quilting bee, and the museum-grade regard for American quilts.' },
  { slug: 'embroidery', title: 'Embroidery', term: 'embroidery', blurb: 'Ornament stitched: samplers, crewelwork, canvas work, and the technique books that recorded them.' },
  { slug: 'ceramics', title: 'Ceramics', term: 'ceramics', blurb: 'Clay and fire: hand-building and the wheel, glazes and kilns, from folk ware to studio art.' },
  { slug: 'glassware', title: 'Glass', term: 'glassware', blurb: 'Molten and shaped: the glasshouse and its trades, and the collecting of what came out of them.' },
  { slug: 'jewelry', title: 'Jewelry', term: 'jewelry', blurb: 'Metal and stone worn: bench techniques, period pieces, and the makers signed into the work.' },
  { slug: 'blacksmithing', title: 'Blacksmithing', term: 'blacksmithing', blurb: 'Fire and anvil: the trade and its techniques, and the tools almost every other trade depended on.' },
  { slug: 'leather', title: 'Leatherwork', term: 'leather', blurb: 'Hide into goods: tanning and making, from saddlery and bags to the binding of books.' },
  { slug: 'woodwork', title: 'Woodwork', term: 'woodwork', blurb: 'Timber worked: joinery, benches, hand tools, and the finished object that keeps the shop’s reasoning.' },
  { slug: 'origami', title: 'Origami', term: 'origami', blurb: 'Paper folded: the models, the mathematics that fell in love with them, and diagrams that teach without words.' },
  { slug: 'dolls', title: 'Dolls', term: 'dolls', blurb: 'Miniature people: making and collecting, and the social history hidden in the faces.' },
  { slug: 'teddy-bears', title: 'Teddy Bears', term: 'teddy bears', blurb: 'The bear that came from a president’s hunt: makers and mohair, and the collectors who never grew out of it.' },
  { slug: 'soap-making', title: 'Soap Making', term: 'soap', blurb: 'Lye and oil measured exactly: cold and hot process, scent and cure — craft chemistry you can hold.' },
  { slug: 'basket-making', title: 'Basket Making', term: 'basket making', blurb: 'Coiled, plaited, woven: the container older than pottery, and the living traditions that still make it.' },
  { slug: 'collecting', title: 'Collectors & Collecting', term: 'collectors and collecting', blurb: 'The urge and its literature: why people gather, catalogue, and bequeath — and what collections do to history.' },
  { slug: 'book-collecting', title: 'Book Collecting', term: 'book collecting', blurb: 'Editions, bindings, condition: the quiet sport of building a shelf, and the catalogs it built back.' },
  { slug: 'coins', title: 'Coins', term: 'coins', blurb: 'History held in the hand: the standard catalogs, the grading, and the error hunters’ corner of it.' },
  // Literature & genre
  { slug: 'adventure-stories', title: 'Adventure', term: 'adventure stories', literary: true, blurb: 'Travel, danger, and a protagonist who keeps moving: the genre that invented most of what film now reuses.' },
  { slug: 'sea-stories', title: 'Sea Stories', term: 'sea stories', literary: true, blurb: 'Fiction under sail and steam: mutiny, storms, and the sea’s way of testing a crew in a plot.' },
  { slug: 'western-stories', title: 'Westerns', term: 'western stories', literary: true, blurb: 'The frontier as myth and as industry: cowboys, outlaws, and the genre’s long reckoning with both.' },
  { slug: 'science-fiction', title: 'Science Fiction', term: 'science fiction', literary: true, blurb: 'Imagination with a method: futures, machines, and societies run as thought experiments at novel length.' },
  { slug: 'fantasy-fiction', title: 'Fantasy', term: 'fantasy fiction', literary: true, blurb: 'Secondary worlds built to be believed: magic with rules, maps, and the two Oxbridge men whose shadow hasn’t lifted.' },
  { slug: 'detective-stories', title: 'Detective & Mystery', term: 'detective and mystery stories', literary: true, blurb: 'The crime and its solution: the puzzle, the hard-boiled reply to the puzzle, and the detectives who keep returning.' },
  { slug: 'ghost-stories', title: 'Ghost Stories', term: 'ghost stories', literary: true, blurb: 'The haunted sentence: ghosts, dread, and the form’s mastery of the almost-seen.' },
  { slug: 'horror-tales', title: 'Horror', term: 'horror tales', literary: true, blurb: 'Fiction engineered to frighten: monsters and worse, and the traditions that keep writing them.' },
  { slug: 'historical-fiction', title: 'Historical Fiction', term: 'historical fiction', literary: true, blurb: 'The past as stage: real decades, invented lives, and the quarrels about getting either wrong.' },
  { slug: 'war-stories', title: 'War Fiction', term: 'war stories', literary: true, blurb: 'Fiction written from the front: what the trenches and the jungles did to the way stories are told.' },
  { slug: 'romance', title: 'Romance', term: 'romance', literary: true, blurb: 'Publishing’s biggest genre: courtship, its obstacles, and the promise on the spine that keeps the presses busy.' },
  { slug: 'humor', title: 'Humor', term: 'humor', literary: true, blurb: 'Writing meant to be funny: essays and comic novels, and the serious anatomy of a joke.' },
  { slug: 'satire', title: 'Satire', term: 'satire', literary: true, blurb: 'Wit with a blade: targets, forms, and the line from Juvenal through Swift to the present complaints.' },
  { slug: 'fables', title: 'Fables', term: 'fables', literary: true, blurb: 'Beasts with morals: Aesop’s line and every retelling that thought it knew better.' },
  { slug: 'folklore', title: 'Folklore', term: 'folklore', literary: true, blurb: 'The stories a place tells about itself: tales, beliefs, and the collectors who first wrote them down.' },
  { slug: 'fairy-tales', title: 'Fairy Tales', term: 'fairy tales', literary: true, blurb: 'From the hearth to the book: the household tales and the long civilizing of them.' },
  { slug: 'legends', title: 'Legends', term: 'legends', literary: true, blurb: 'Remembered story with a local address: heroes, saints, and the places that swear it happened there.' },
  { slug: 'ballads', title: 'Ballads', term: 'ballads', literary: true, blurb: 'Sung narrative: the broadside, the border ballad, and the refrain that carried the tune for centuries.' },
  { slug: 'anecdotes', title: 'Anecdotes', term: 'anecdotes', blurb: 'The short tale told for the point: anecdote as history’s spice, and the collections that kept it.' },
  { slug: 'quotations', title: 'Quotations', term: 'quotations', blurb: 'Words worth repeating: the dictionaries of sayings, their misattributions, and the research behind them.' },
  { slug: 'correspondence', title: 'Letters', term: 'correspondence', blurb: 'Letters as literature: the published exchanges, and everything the archive happened to keep.' },
  { slug: 'diaries', title: 'Diaries', term: 'diaries', blurb: 'The page written for no one: journals from the everyday to the historic, and what publishing one does to it.' },
  { slug: 'juvenile-literature', title: 'Juvenile Literature', term: 'juvenile literature', literary: true, blurb: 'Books made for the young: the instruction, the escape, and the canon that grew up beside them.' },
  { slug: 'young-adult-literature', title: 'Young Adult', term: 'young adult literature', literary: true, blurb: 'The in-between shelf: coming of age as its own category, and the quarrel about who it is really for.' },
  { slug: 'children-with-disabilities', title: 'Children with Disabilities', term: 'children with disabilities', blurb: 'Books for and about disabled children: the stories that include them and the guides that help parents.' },
  // Religion, spirit & the mind
  { slug: 'religion-and-science', title: 'Religion & Science', term: 'religion and science', blurb: 'Conflict, dialogue, or separate rooms: the two ways of knowing asking each other’s hardest questions.' },
  { slug: 'spirituality', title: 'Spirituality', term: 'spirituality', blurb: 'The inward search named outside the churches: practice, experience, and the traditions it borrows from.' },
  { slug: 'atheism', title: 'Atheism', term: 'atheism', blurb: 'The case against gods: Hume to the new atheists, and the freethought movements that made disbelief a public position.' },
  { slug: 'astrology', title: 'Astrology', term: 'astrology', blurb: 'The zodiac’s long literature: the systems, their history, and the astronomers’ settled verdict on them.' },
  { slug: 'tarot', title: 'Tarot', term: 'tarot', blurb: 'The cards that read: the deck’s history, its imagery, and the divination practice built on a parlor game.' },
  { slug: 'divination', title: 'Divination', term: 'divination', blurb: 'Knowing the unknowable: the methods cultures have used to ask the future, and what they say about the askers.' },
  { slug: 'demonology', title: 'Demonology', term: 'demonology', blurb: 'The learned literature of demons: hierarchies, possessions, and the trials that filled the casebooks.' },
  { slug: 'angels', title: 'Angels', term: 'angels', blurb: 'The messengers: theology, art, and the modern popular angelology of near misses.' },
  { slug: 'bible', title: 'The Bible', term: 'bible', blurb: 'The book that is a library: canon, translation, and its hold on the literatures around it.' },
  { slug: 'jesus-christ', title: 'Jesus Christ', term: 'jesus christ', blurb: 'The historical and the confessed figure: the scholarship, the gospels, and two thousand years of commentary on both.' },
  { slug: 'saints', title: 'Saints', term: 'saints', blurb: 'Lives made official: the calendar, the relics, and the biographies where faith and history share a desk.' },
  { slug: 'martyrs', title: 'Martyrs', term: 'martyrs', blurb: 'Witness unto death: the accounts, the martyrologies, and the movements that grew from the executions.' },
  { slug: 'monasticism', title: 'Monasticism', term: 'monasticism and religious orders', blurb: 'The ruled life: monks, friars, and what the copyists and gardeners of the orders handed down.' },
  { slug: 'missionaries', title: 'Missionaries', term: 'missionaries', blurb: 'Carrying the message: the societies, their converts and the cultures they dismantled, and the archives judging them now.' },
  { slug: 'catholic-church', title: 'The Catholic Church', term: 'catholic church', blurb: 'The institution and its twenty centuries: structure, teaching, and a history no single shelf covers.' },
  { slug: 'jesuits', title: 'The Jesuits', term: 'jesuits', blurb: 'The Society of Jesus: schools, missions, controversies, and the counter-Reformation’s most argued-over enterprise.' },
  { slug: 'franciscans', title: 'The Franciscans', term: 'franciscans', blurb: 'Poverty and its order: Francis, the friars, and the art and learning that followed them.' },
  { slug: 'shamanism', title: 'Shamanism', term: 'shamanism', blurb: 'The spirit specialist: the Siberian word, the practices it got applied to, and the claims made in and out of context.' },
  { slug: 'voodooism', title: 'Voodoo', term: 'voodooism', blurb: 'The Haitian faith: its African roots, the slander it carried in films, and its rituals described on their own terms.' },
  { slug: 'heaven', title: 'Heaven', term: 'heaven', blurb: 'The blessed place: its geography, its theology, and the visions people have tried to describe it with.' },
  { slug: 'hell', title: 'Hell', term: 'hell', blurb: 'The lower world: the idea’s development, its literature, and the dread it administered for centuries.' },
  { slug: 'resurrection', title: 'Resurrection', term: 'resurrection', blurb: 'The body raised: the central claim of the faith, its defenses, and its denials across two millennia.' },
  { slug: 'miracles', title: 'Miracles', term: 'miracles', blurb: 'Suspensions of the natural order: the reported cases, the investigations, and the arguments about testimony.' },
  { slug: 'near-death-experiences', title: 'Near-Death Experiences', term: 'near-death experiences', blurb: 'The clinical close call: the common reported core of the deathbed experience, and its medical and spiritual readings.' },
  { slug: 'reincarnation', title: 'Reincarnation', term: 'reincarnation', blurb: 'Lives returned to: the doctrine across traditions, and the research attempts at documenting it.' },
  { slug: 'sleep', title: 'Sleep', term: 'sleep', blurb: 'The necessary dark: stages and disorders, dreams and deprivation, and the science of a third of a life.' },
  { slug: 'hypnosis', title: 'Hypnosis', term: 'hypnosis', blurb: 'Suggestion at work: the inductions, the clinical uses, and the stage-show suspicion that never fully left.' },
  { slug: 'yoga', title: 'Yoga', term: 'yoga', blurb: 'From the sutras to the studio: the practice, its philosophy, and the health claims tested both ways.' },
  { slug: 'meditation', title: 'Meditation', term: 'meditation', blurb: 'Attention trained: the methods across traditions, and the clinical adoption of sitting quietly on purpose.' },
  { slug: 'feng-shui', title: 'Feng Shui', term: 'feng shui', blurb: 'Placement and flow: the Chinese art of siting and arranging, its traditional texts, and its western adaptations.' },
  { slug: 'tai-chi', title: 'Tai Chi', term: 'tai chi', blurb: 'The slow form: movement as meditation and medicine, and the martial root its students keep.' },
  // Food & drink
  { slug: 'baking', title: 'Baking', term: 'baking', blurb: 'Oven discipline: breads, cakes, and the chemistry of heat applied to dough.' },
  { slug: 'bread', title: 'Bread', term: 'bread', blurb: 'The staff of life as craft and subject: levains, flours, and the literature of the hearth and the factory.' },
  { slug: 'desserts', title: 'Desserts', term: 'desserts', blurb: 'The sweet finish: pastry, confection, and the plating of the last course.' },
  { slug: 'cookies', title: 'Cookies', term: 'cookies', blurb: 'Small, flat, baked: from drop to press, and the tin that travels well.' },
  { slug: 'chocolate', title: 'Chocolate', term: 'chocolate', blurb: 'From cacao to bar: the cultivation, the manufacturing, and the confectioner’s use of it.' },
  { slug: 'cheese', title: 'Cheese', term: 'cheese', blurb: 'Curd and culture: the world’s cheese families, how they are made, and how they are aged.' },
  { slug: 'winemaking', title: 'Wine', term: 'wine and wine making', blurb: 'Grape to glass: viticulture, vinification, and the vocabulary of the tasting note.' },
  { slug: 'beer', title: 'Beer', term: 'beer', blurb: 'Malt, hops, and fermentation: the brewing traditions and their industrial and craft chapters.' },
  { slug: 'cocktails', title: 'Cocktails', term: 'cocktails', blurb: 'Mixed drinks: the recipes, the bars that made them, and the literature of the proper glass.' },
  { slug: 'coffee', title: 'Coffee', term: 'coffee', blurb: 'The roasted bean: cultivation and roasting, and the café as a historical institution.' },
  { slug: 'tea', title: 'Tea', term: 'tea', blurb: 'Camellia sinensis and its rituals: leaf grades, the trade, and the furniture of the afternoon.' },
  { slug: 'spices', title: 'Spices', term: 'spices', blurb: 'Aromatic history: the plants, the trades that priced them, and the flavor they carried across maps.' },
  { slug: 'herbs', title: 'Herbs', term: 'herbs', blurb: 'Kitchen and medicine chest at once: the growing and the using of the leafy and the resinous.' },
  { slug: 'honey', title: 'Honey', term: 'honey', blurb: 'The hive’s sweetener: nectar to jar, its varieties, and the sugar older than cane.' },
  { slug: 'pizza', title: 'Pizza', term: 'pizza', blurb: 'Flat, topped, baked: Naples to the world, and the quarrels about what counts as a style.' },
  { slug: 'sandwiches', title: 'Sandwiches', term: 'sandwiches', blurb: 'Bread around the filling: the portable meal and most of the lunch since it was named.' },
  { slug: 'salads', title: 'Salads', term: 'salads', blurb: 'Leaves and dressings and composed plates: the cold course at its full range.' },
  { slug: 'soups', title: 'Soups', term: 'soups', blurb: 'The pot on the fire: stocks, purées, and the first course of almost every table.' },
  { slug: 'barbecuing', title: 'Barbecuing', term: 'barbecuing', blurb: 'Fire applied slowly: the methods, the sauces, and the regional faiths around the pit.' },
  { slug: 'canning-and-preserving', title: 'Canning & Preserving', term: 'canning and preserving', blurb: 'Shutting up the harvest: jars, cellars, and the technology that fed armies and winters.' },
  { slug: 'fermentation', title: 'Fermentation', term: 'fermentation', blurb: 'Managed change by microbes: crocks and krauts, sourdoughs and brews, and the science of the culture.' },
  { slug: 'organic-farming', title: 'Organic Farming', term: 'organic farming', blurb: 'Agriculture without the synthetic inputs: the methods, the certification, and the yields it argues about.' },
  { slug: 'food-additives', title: 'Food Additives', term: 'food additives', blurb: 'Engineered shelf life and color: the E-numbers, their regulation, and the suspicion around them.' },
  { slug: 'genetically-modified-foods', title: 'Genetically Modified Food', term: 'genetically modified foods', blurb: 'Modified crops on the plate: the science, the labels, and the politics that grew past the science.' },
  { slug: 'reducing-diets', title: 'Reducing Diets', term: 'reducing diets', blurb: 'The eating plan as an industry: methods, metrics, and the cycle most of its customers know by heart.' },
  { slug: 'vegetarianism', title: 'Vegetarianism', term: 'vegetarianism', blurb: 'The refused flesh: its ethics and arguments through the centuries, and the cooking that makes the case.' },
  { slug: 'picnics', title: 'Picnics', term: 'picnics', blurb: 'The meal packed and carried out: from the Victorian hamper to the park blanket, and what goes between.' },
  // Sport
  { slug: 'boxing', title: 'Boxing', term: 'boxing', blurb: 'The sweet science: technique and champions, and the cost-of-the-ring argument that never settles.' },
  { slug: 'wrestling', title: 'Wrestling', term: 'wrestling', blurb: 'Grip and leverage: the amateur styles, the professional show, and one of the oldest contests there is.' },
  { slug: 'mixed-martial-arts', title: 'Mixed Martial Arts', term: 'mixed martial arts', blurb: 'The cage’s disciplines: cross-training, the rules that followed, and the sport’s fast road to the mainstream.' },
  { slug: 'martial-arts', title: 'Martial Arts', term: 'martial arts', blurb: 'Fighting as training: the east Asian traditions, their philosophies, and their export to the world.' },
  { slug: 'karate', title: 'Karate', term: 'karate', blurb: 'The empty hand: Okinawa’s arts, the Japanese systems, and how the way taught itself worldwide.' },
  { slug: 'judo', title: 'Judo', term: 'judo', blurb: 'The gentle way: throws and holds, Kano’s pedagogy, and the road that made it an Olympic sport.' },
  { slug: 'kendo', title: 'Kendo', term: 'kendo', blurb: 'The way of the sword: bamboo and armour, and the modern discipline of an old combat art.' },
  { slug: 'fencing', title: 'Fencing', term: 'fencing', blurb: 'Steel etiquette: the three weapons, the right of way, and the science of the single touch.' },
  { slug: 'archery', title: 'Archery', term: 'archery', blurb: 'Shoot and score: bows through the ages, the technique, and the long literature of the archer.' },
  { slug: 'gymnastics', title: 'Gymnastics', term: 'gymnastics', blurb: 'Floor and apparatus: the skills, the training culture, and the scoring debates that follow the medals.' },
  { slug: 'weight-lifting', title: 'Weightlifting', term: 'weight lifting', blurb: 'Barbell method: technique and programming, and the sport and its subcultures of iron.' },
  { slug: 'running', title: 'Running', term: 'running', blurb: 'Locomotion as sport: training and the body, and the full range of race distances people insist on.' },
  { slug: 'walking', title: 'Walking', term: 'walking', blurb: 'The oldest exercise: health claims, travel on foot, and the strange mechanics of the race walk.' },
  { slug: 'hiking', title: 'Hiking', term: 'hiking', blurb: 'The long walk out: trails and kit, and the mountains and miles approached on foot.' },
  { slug: 'backpacking', title: 'Backpacking', term: 'backpacking', blurb: 'Carrying the camp on the back: routes, loads, and the self-sufficient mile.' },
  { slug: 'survival', title: 'Survival', term: 'survival', blurb: 'Staying alive by skill: water, fire, shelter, and the manuals’ honest fear of the first night.' },
  { slug: 'snowboarding', title: 'Snowboarding', term: 'snowboarding', blurb: 'The board on snow: halfpipe and freeride, and the culture that arrived with the binding.' },
  { slug: 'skating', title: 'Skating', term: 'skating', blurb: 'Blade and wheel: the rinks, the learning of balance, and the general joy of going without walking.' },
  { slug: 'figure-skating', title: 'Figure Skating', term: 'figure skating', blurb: 'Edges drawn as art: the schools, the jumps, and the judging everybody watches differently.' },
  { slug: 'ice-hockey', title: 'Ice Hockey', term: 'ice hockey', blurb: 'The puck’s game: teams and tactics, and the physical culture of the rink.' },
  { slug: 'rugby-football', title: 'Rugby', term: 'rugby football', blurb: 'The football that split: tries and conversions, the scrum, and the amateur-to-professional argument.' },
  { slug: 'volleyball', title: 'Volleyball', term: 'volleyball', blurb: 'The three-touch game: beach and hall, and the physics of the perfect spike.' },
  { slug: 'golf', title: 'Golf', term: 'golf', blurb: 'The ball and the hole: courses and swings, and the etiquette that made the game what it is.' },
  { slug: 'cricket', title: 'Cricket', term: 'cricket', blurb: 'Willow against leather: the bat-and-ball game, its laws, and how empire carried it around the world.' },
  { slug: 'baseball', title: 'Baseball', term: 'baseball', blurb: 'The diamond and the stat sheet: America’s pastime and the nine-inning culture around it.' },
  { slug: 'table-tennis', title: 'Table Tennis', term: 'table tennis', blurb: 'Ping-pong at speed: rubber and spin, and the rally that became a national diplomacy.' },
  { slug: 'squash', title: 'Squash', term: 'squash (game)', blurb: 'The four-wall game: its boiler-room origin, the strokes, and the fitness the court demands.' },
  { slug: 'bowling', title: 'Bowling', term: 'bowling', blurb: 'The ball and the standing pins: approaches and scores, and the league as a social machine.' },
  { slug: 'snooker', title: 'Snooker', term: 'snooker', blurb: 'Reds and colours: the baize’s craft game and the watching publics it built.' },
  { slug: 'croquet', title: 'Croquet', term: 'croquet', blurb: 'The lawn game of hoops: the Victorian craze, and the strategy hidden under the etiquette.' },
  { slug: 'curling', title: 'Curling', term: 'curling', blurb: 'The roaring game: stone and broom on ice, and the chess match that slides.' },
  { slug: 'skateboarding', title: 'Skateboarding', term: 'skateboarding', blurb: 'The board and the street: the trick’s grammar, and the subculture that kept it wild.' },
  { slug: 'roller-skating', title: 'Roller Skating', term: 'roller skating', blurb: 'Wheels at the rink: the boom decades, the disco era, and the revival on four wheels again.' },
  { slug: 'motorcycles', title: 'Motorcycles', term: 'motorcycles', blurb: 'The two-wheel machine: riding, the trade, and the culture that grew up in leathers.' },
  { slug: 'automobile-driving', title: 'Driving', term: 'automobile driving', blurb: 'The car under control: the license and the road, and the skill that has its own literature.' },
  // Games
  { slug: 'chess', title: 'Chess', term: 'chess', blurb: 'The sixty-four squares: openings and endings, world champions, and the board’s serious following.' },
  { slug: 'chess-problems', title: 'Chess Problems', term: 'chess problems', blurb: 'Composed positions: the two-mover to the helpmate, and the solver’s particular pleasure.' },
  { slug: 'go-game', title: 'Go', term: 'go (game)', blurb: 'The older board: empty corners, territory, and stones placed by hand — the game that took machines longest.' },
  { slug: 'dominoes', title: 'Dominoes', term: 'dominoes', blurb: 'The bones on the table: layouts and the family of games played from them.' },
  { slug: 'card-games', title: 'Card Games', term: 'card games', blurb: 'The pack’s repertoire: the games themselves and the rulebooks that keep explaining them.' },
  { slug: 'poker', title: 'Poker', term: 'poker', blurb: 'The betting game: the variants, the professionals, and the whole literature of the bluff.' },
  { slug: 'blackjack', title: 'Blackjack', term: 'blackjack (game)', blurb: 'The twenty-one game: the dealer’s table, the basic strategy, and the count that made headlines.' },
  { slug: 'bingo', title: 'Bingo', term: 'bingo', blurb: 'The called number and the dabber: the hall, the party, and the simple machine of the game.' },
  { slug: 'dice', title: 'Dice', term: 'dice', blurb: 'The thrown cube: the games built on it, the odds around it, and a loaded history.' },
  { slug: 'word-games', title: 'Word Games', term: 'word games', blurb: 'Letters and scores: the crossword’s clues through to the lettered board, and the vocabulary they reward.' },
  // On the water & in the air
  { slug: 'yachts-and-yachting', title: 'Yachts & Yachting', term: 'yachts and yachting', blurb: 'Cruising under sail and power: the boats, the water, and the life afloat around them.' },
  { slug: 'sailing', title: 'Sailing', term: 'sailing', blurb: 'Wind as engine: trim and navigation, and the handling of a boat with no motor to blame.' },
  { slug: 'sailing-ships', title: 'Sailing Ships', term: 'sailing ships', blurb: 'The century of canvas: rigging and the merchant service, and the age before steam made the crossing short.' },
  { slug: 'ships-and-shipping', title: 'Ships & Shipping', term: 'ships and shipping', blurb: 'The world’s cargo carried: fleets and routes and ports, and the economics of the container.' },
  { slug: 'boats-and-boating', title: 'Boats & Boating', term: 'boats and boating', blurb: 'Small craft handled: the types of boat, their uses, and the water they are taken out on.' },
  { slug: 'canoes-and-canoeing', title: 'Canoes & Canoeing', term: 'canoes and canoeing', blurb: 'The paddled boat: the canoe’s indigenous origins, the tour, and the white water.' },
  { slug: 'airships', title: 'Airships', term: 'airships', blurb: 'Lighter than air: the Zeppelin age, the passenger dream, and the lessons the wrecks wrote down.' },
  { slug: 'parachuting', title: 'Parachuting', term: 'parachuting', blurb: 'Descent by canopy: the jump, the sport, and the military use that made it ordinary.' },
  { slug: 'hang-gliding', title: 'Hang Gliding', term: 'hang gliding', blurb: 'The wing worn by the pilot: launches and ridges, and the arithmetic of the thermal.' },
  { slug: 'scuba-diving', title: 'Scuba Diving', term: 'scuba diving', blurb: 'Breathing underwater: the set, the dive, and the reef that rewards the slow descent.' },
  { slug: 'skin-diving', title: 'Skin Diving', term: 'skin diving', blurb: 'Down on one breath: freediving’s technique, its records, and the shallow blue it studies.' },
  { slug: 'underwater-photography', title: 'Underwater Photography', term: 'underwater photography', blurb: 'Light through water with a camera between: housings and rigs, species and patience.' },
  { slug: 'speleology', title: 'Caving', term: 'speleology', blurb: 'Caves as a science and a sport: formation, exploration, and the survey that maps the dark.' },
  { slug: 'rock-climbing', title: 'Rock Climbing', term: 'rock climbing', blurb: 'Hands and feet on stone: the grades, the protection, and the route read as a vertical puzzle.' },
  { slug: 'skydiving', title: 'Skydiving', term: 'skydiving', blurb: 'The fall by choice: freefall and canopy, and the thousand-foot problem of landing well.' },
  { slug: 'windsurfing', title: 'Windsurfing', term: 'windsurfing', blurb: 'A sail on a board: the planing sport, and the technique of riding the rig instead of the rope.' },
  // Angling, field sports & animal work
  { slug: 'fishing', title: 'Fishing', term: 'fishing', blurb: 'Angle and lure: the fish and their waters, and the vast literature of the wait.' },
  { slug: 'fly-fishing', title: 'Fly Fishing', term: 'fly fishing', blurb: 'The cast artificial insect: the hatch, the rod, and the river’s connoisseurs.' },
  { slug: 'hunting', title: 'Hunting', term: 'hunting', blurb: 'The pursuit by design: game and methods and dogs, and the ethics that keep arguing about it.' },
  { slug: 'firearms', title: 'Firearms', term: 'firearms', blurb: 'Handgun and long arm: the mechanisms, the safe handling, and the politics that orbit them.' },
  { slug: 'rifles', title: 'Rifles', term: 'rifles', blurb: 'The shoulder arm: bore and ballistics, and the marksman’s long practice at distance.' },
  { slug: 'bird-watching', title: 'Bird Watching', term: 'bird watching', blurb: 'Identification in the field: the binocular, the life list, and the patience that pays off in sightings.' },
  { slug: 'taxidermy', title: 'Taxidermy', term: 'taxidermy', blurb: 'The preserved skin: the craft and its techniques, and its shifting purpose from museum to mantle.' },
  { slug: 'falconry', title: 'Falconry', term: 'falconry', blurb: 'Hawking with the hawk: the training of the raptor and the oldest hunt still practiced on foot.' },
  { slug: 'horse-racing', title: 'Horse Racing', term: 'horse racing', blurb: 'The turf and the track: breeding and racing, the book, and the literature of the photo finish.' },
  { slug: 'horseback-riding', title: 'Horseback Riding', term: 'horseback riding', blurb: 'The seat in the saddle: the schools and the trail, and the horse’s share of the partnership.' },
  { slug: 'veterinary-medicine', title: 'Veterinary Medicine', term: 'veterinary medicine', blurb: 'Medicine for animals: the clinic and the herd, the species and the science between them.' },
  { slug: 'zoo-animals', title: 'Zoo Animals', term: 'zoo animals', blurb: 'The collection and its case: housing and welfare, and the purpose the modern zoo argues for itself.' },
  { slug: 'working-dogs', title: 'Working Dogs', term: 'working dogs', blurb: 'The dog with a job: herding and drafting, and the breeds made for the work.' },
  { slug: 'police-dogs', title: 'Police Dogs', term: 'police dogs', blurb: 'The K-9 unit: selection and training, detection and patrol, and the work done on the leash.' },
  { slug: 'guide-dogs', title: 'Guide Dogs', term: 'guide dogs', blurb: 'The seeing pair: from puppy walker to harness, and the pavement negotiated together.' },
  { slug: 'poultry', title: 'Poultry', term: 'poultry', blurb: 'The barnyard birds: breeds and eggs and flesh, and the farming that industrialized first.' },
  { slug: 'cattle', title: 'Cattle', term: 'cattle', blurb: 'The herd animal: breeds and management, and the beef and milk economies riding on them.' },
  { slug: 'sheep', title: 'Sheep', term: 'sheep', blurb: 'The flock: breeds, wool and mutton, and the shepherding year in full.' },
  { slug: 'goats', title: 'Goats', term: 'goats', blurb: 'The hard browser: dairy and fiber breeds, their keeping, and the reputation for appetite fully earned.' },
  { slug: 'pigs', title: 'Pigs', term: 'pigs', blurb: 'Swine: husbandry and breeds, and the pig’s old place at the center of the small farm.' },
  { slug: 'bee-culture', title: 'Beekeeping', term: 'bee culture', blurb: 'The apiary as husbandry: managing the colony, its seasons, and the honey it produces.' },
  { slug: 'aquariums', title: 'Aquariums', term: 'aquariums', blurb: 'Water in glass: setup and stocking, and the husbandry of a display that must not crash.' },
  { slug: 'aquaculture', title: 'Aquaculture', term: 'aquaculture', blurb: 'Farming the water: fish and shellfish under stock, and the industry growing out of it.' },
  // Farm & garden
  { slug: 'orchards', title: 'Orchards', term: 'orchards', blurb: 'Fruit under management: the trees, their pruning and harvest, and the cider and market behind them.' },
  { slug: 'corn', title: 'Corn', term: 'corn', blurb: 'The great American grain: maize from its New World origin to the wet-milling plant.' },
  { slug: 'wheat', title: 'Wheat', term: 'wheat', blurb: 'The bread grain: its cultivation and harvests, and the history of the fields that grew it.' },
  { slug: 'rice', title: 'Rice', term: 'rice', blurb: 'The paddy plant: flooded-field culture, and the grain that feeds more people than any other.' },
  { slug: 'wool', title: 'Wool', term: 'wool', blurb: 'The fleece: clip and fiber, and the spinning and knitting trades it keeps feeding.' },
  { slug: 'bonsai', title: 'Bonsai', term: 'bonsai', blurb: 'The tree kept small: styling and species, and the patience the art asks for in years.' },
  { slug: 'hydroponics', title: 'Hydroponics', term: 'hydroponics', blurb: 'Growing without soil: nutrient solutions, and the yield of the shelf and the warehouse farm.' },
  { slug: 'seeds', title: 'Seeds', term: 'seeds', blurb: 'The planted beginning: saving and sowing, and the stored life inside the coat.' },
  { slug: 'roses', title: 'Roses', term: 'roses', blurb: 'The queen of the garden: classes and breeding, and the culture that keeps the beds worth it.' },
  { slug: 'orchids', title: 'Orchids', term: 'orchids', blurb: 'The complicated flower: the species and their culture, and the patience of the grower who keeps them.' },
  { slug: 'sunflowers', title: 'Sunflowers', term: 'sunflowers', blurb: 'The tall gold heads: the field crop and the border annual, and the seed that does double duty.' },
  { slug: 'lawns', title: 'Lawns', term: 'lawns', blurb: 'The mown grass: establishment and care, and the cultural grip the lawn has kept anyway.' },
  { slug: 'weeds', title: 'Weeds', term: 'weeds', blurb: 'The plant where it is not wanted: identification and management, and the botany of the unwanted.' },
  { slug: 'organic-gardening', title: 'Organic Gardening', term: 'organic gardening', blurb: 'Growing without the synthetics: the methods and materials, and the small compromises of the season.' },
];

const BY_SLUG = new Map(SUBJECTS.map((s) => [s.slug, s]));
const cache = new Map(); // slug → { at, works }
const stats = { through: 0, mirrored: 0, failed: 0, lastError: '' };

/** A work from the Open Library search payload, reduced to what a reader needs. */
function normalise(doc) {
  const key = String((doc && doc.key) || '');
  const title = String((doc && doc.title) || '').trim();
  if (!key || !title) return null;
  const editions = Number(doc.edition_count);
  const names = (doc.author_name && doc.author_name[0]) ? doc.author_name : [];
  const subjects = Array.isArray(doc.subject) ? doc.subject : [];
  const ia = Array.isArray(doc.ia) ? doc.ia : [];
  return {
    title: title.slice(0, 180),
    author: String(names[0] || 'Unknown author').trim().slice(0, 120),
    authorKey: String(names[0] || '').toLowerCase(),
    year: Number.isFinite(Number(doc.first_publish_year)) ? Number(doc.first_publish_year) : null,
    editions: Number.isFinite(editions) && editions > 0 ? editions : null,
    slug: key.replace(/^\/works\//, ''),
    // Kept for the book page, which is built from the same payload rather than from a
    // second request per work: what else the record is tagged with, and whether an
    // archive.org copy exists that a reader can actually open.
    subjects: subjects.slice(0, 12).map((s) => String(s).slice(0, 80)),
    ia: ia.slice(0, 2).map((s) => String(s).slice(0, 120)),
  };
}

/**
 * Does this record actually carry the subject? The catalogue's search matches on more
 * than the subject list, and its subject pages return works that are not in the subject
 * at all — so the subject string is required on the record before it reaches a list.
 */
function carriesSubject(doc, term) {
  const want = String(term).toLowerCase();
  const subjects = (doc && doc.subject) || [];
  return Array.isArray(subjects) && subjects.some((s) => String(s).toLowerCase() === want);
}

// Fiction is a subject tag on thousands of records, so it has to be checked explicitly:
// "A Tale of Two Cities" is under history, and a history list of novels is not a history
// reading list.
const IS_FICTION = /\b(fiction|novel|romance|story)\b/i;

function isFiction(doc) {
  const subjects = (doc && doc.subject) || [];
  return Array.isArray(subjects) && subjects.some((s) => IS_FICTION.test(String(s)));
}

// Statute compilations, conference proceedings and parliamentary papers are catalogued as
// if they were books, because libraries hold them like books. "Laws, etc" (the label the
// record really carries) topped the law list with 3,456 editions, which is true of the
// United Kingdom's statute book and useless to a reader. A reading list is about works.
const IS_SERIAL = /^(laws|acts|resolves|session laws|public laws|proceedings|debates|transactions|memorials|journals?)\b/i;

function isSerial(doc) {
  return IS_SERIAL.test(String((doc && doc.title) || '').trim());
}

/**
 * The catalogue's matches for a subject, turned into the list a reader sees: keep only
 * records that really carry the subject, drop the novels unless the subject is a literary
 * one, order by editions, then let no author take more than two of the thirty slots.
 * Pure, so those four rules can be tested without the network.
 */
function rankWorks(docs, meta) {
  const term = (meta && meta.term) || meta; // accept the bare string, for tests and callers
  const literary = Boolean(meta && meta.literary);
  const seen = new Set();
  const perAuthor = new Map();
  const out = [];
  const pool = (Array.isArray(docs) ? docs : [])
    .filter((d) => carriesSubject(d, term))
    .filter((d) => literary || !isFiction(d))
    .filter((d) => !isSerial(d))
    .map(normalise)
    .filter((w) => w && !seen.has(w.slug) && seen.add(w.slug))
    .sort((a, b) => (b.editions || 0) - (a.editions || 0) || (a.year || 9999) - (b.year || 9999));
  // First pass honouring the per-author cap, then a second to top the list up if the cap
  // left it short — a cap should shorten a list, not empty it.
  const limit = LIMIT;
  for (const w of pool) {
    if (out.length >= limit) break;
    const k = w.authorKey || w.author;
    if ((perAuthor.get(k) || 0) >= MAX_PER_AUTHOR) continue;
    perAuthor.set(k, (perAuthor.get(k) || 0) + 1);
    out.push(w);
  }
  if (out.length < limit) {
    const taken = new Set(out.map((w) => w.slug));
    for (const w of pool) {
      if (out.length >= limit) break;
      if (!taken.has(w.slug)) { taken.add(w.slug); out.push(w); }
    }
    out.sort((a, b) => (b.editions || 0) - (a.editions || 0));
  }
  return out;
}

function readMirror() {
  try {
    const raw = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeMirror(slug, entry, all) {
  try {
    all[slug] = entry;
    fs.mkdirSync(path.dirname(MIRROR_FILE), { recursive: true });
    const tmp = `${MIRROR_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, MIRROR_FILE); // rename is atomic: a reader never sees half a file
    stats.mirrored++;
  } catch {
    // a failed mirror is a slow restart later, never a broken page now
  }
}

/**
 * The catalogue search behind a shelf: one request, the works it matched, and how many the
 * subject holds in total. Exported because scripts/books-build.js builds a thousand shelves
 * through exactly this call — the deadline, the cooldown and the dedupe in src/outbound.js
 * apply to the build exactly as they do to a page, which is the point of having one choke
 * point. A quote in a subject string would break the query, so it is stripped rather than
 * escaped: no Open Library subject contains one.
 */
async function searchSubject(term) {
  const res = await http.get('https://openlibrary.org/search.json', {
    params: {
      // No `sort` on purpose: the server-side sort ignores the subject and ranks the
      // whole index, which is how Dickens ended up on a climate list. Relevance in,
      // editions ordered locally.
      q: `subject:"${String(term).replace(/"/g, '')}"`,
      limit: PER_SEARCH,
      fields: 'title,author_name,first_publish_year,edition_count,key,subject,ia',
    },
  });
  const data = (res && res.data) || {};
  return {
    docs: Array.isArray(data.docs) ? data.docs : [],
    found: Number.isFinite(Number(data.numFound)) ? Number(data.numFound) : 0,
  };
}

/**
 * The reading list for one subject.
 * Order: fresh memory → the network → the disk mirror (any age) → an empty list.
 * @returns {Promise<{works:Array, at:number|null, stale:boolean}>}
 */
async function subject(slug) {
  const meta = BY_SLUG.get(slug);
  if (!meta) return { works: [], at: null, stale: false };
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return { works: hit.works, at: hit.at, stale: false };

  const mirror = readMirror();
  try {
    const { docs } = await searchSubject(meta.term);
    const works = rankWorks(docs, meta);
    if (!works.length) throw new Error('no works carry this subject');
    const entry = { at: Date.now(), works };
    cache.set(slug, entry);
    stats.through++;
    writeMirror(slug, { at: new Date(entry.at).toISOString(), works }, mirror);
    return { works, at: entry.at, stale: false };
  } catch (err) {
    stats.failed++;
    stats.lastError = String((err && err.message) || err).slice(0, 160);
    const last = mirror[slug];
    if (last && Array.isArray(last.works) && last.works.length) {
      const at = Date.parse(last.at) || null;
      cache.set(slug, { at: at || Date.now(), works: last.works });
      return { works: last.works, at, stale: true };
    }
    return { works: [], at: null, stale: false };
  }
}

/**
 * Fill the cache for every subject, one at a time, after boot. Without this the first
 * visitor to each of the twenty-seven pages pays an up-to-16-second catalogue search, and
 * the first ten minutes after a deploy are exactly when a slow page goes unnoticed.
 * Sequential and spaced because this is a 4 GB box coming back up, and polite because
 * the searches belong to the Internet Archive, not to us. Never rejects.
 * `fetchOne` is injectable so the walk itself can be tested without the catalogue.
 */
async function prime({ gapMs = PRIME_GAP_MS, log = console.log, fetchOne = subject } = {}) {
  const done = new Set();
  const pass = async (list) => {
    for (const s of list) {
      try {
        const r = await fetchOne(s.slug);
        if (r && r.works && r.works.length && !r.stale) { done.add(s.slug); }
      } catch { /* one dead subject must not stop the other twenty-three */ }
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  };
  await pass(SUBJECTS);
  // A catalogue search that times out is a bad second, not a bad day: the empties get one
  // more turn after a pause, which is what made the difference in testing — 23 of 24 on the
  // first pass, 24 on the second.
  const left = SUBJECTS.filter((s) => !done.has(s.slug));
  if (left.length) {
    await new Promise((resolve) => setTimeout(resolve, gapMs * 5));
    await pass(left);
  }
  log(`[books] primed ${done.size}/${SUBJECTS.length} subjects`);
  return done.size;
}

// ── The built shelves: everything past the curated twenty-seven, read off disk ────────
// Written by scripts/books-build.js, never by a page request. Three files and a directory,
// because the whole point is that a visitor opening /books/amateur-radio must not pay a
// catalogue search: the shelf is a 6 KB file already on this box.
const DATA_DIR = path.dirname(MIRROR_FILE);
const SHELF_DIR = path.join(DATA_DIR, 'books-shelves');
const SHELF_INDEX_FILE = path.join(DATA_DIR, 'books-shelves.json');
const WORK_DIR = path.join(DATA_DIR, 'books-works');
const WORK_INDEX_FILE = path.join(DATA_DIR, 'books-works-index.jsonl');
const WORK_SHARDS = 40;          // ~30,000 works ÷ 40 ≈ 750 records a shard, ~250 KB
// Below this it is a stub, not a reading list. The first full build (VPS, 24 Oct 2026) published
// 2,660 shelves at a floor of eight: the shortest held eight works and the median held the full
// thirty, but 139 of them sat under twenty — pages that cost a crawl to serve a handful of titles.
// Twenty is where the distribution stops looking like a footnote.
const SHELF_MIN_WORKS = 20;

// Subject strings are the catalogue's own lowercase labels ("beekeeping", "quantum
// computing"). Capitalising them is formatting, not authorship — but the words are the
// source's, which is why nothing here invents a title out of prose.
const SMALL_WORDS = new Set(['of', 'and', 'in', 'the', 'for', 'a', 'an', 'on', 'to', 'de', 'la', 'with', 'at', 'by']);

/** Display name for a catalogue subject, by title case with the small words left down. */
function titleCase(term) {
  const words = String(term || '').split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const low = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(low)) return low;
    return low.charAt(0).toUpperCase() + low.slice(1);
  }).join(' ')
    .replace(/\s,\s/g, ', ').replace(/\(\s?/g, '(').replace(/\s?\)/g, ')')
    .slice(0, 70);
}

/** A url-safe shelf slug from a subject string, accents folded, never truncated mid-word. */
function shelfSlug(term) {
  const folded = String(term || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    .replace(/-+$/, '');
  return folded || 'subject';
}

// Four families of subject string produce a page nobody would read, all of them seen in
// the catalogue while this was being written:
//   • a subdivision ("beekeeping--history") is half a subject and returned 24 works;
//   • a form tag ("juvenile fiction", "nonfiction", "textbooks") describes the SHAPE of a book
//     rather than what it is about, and is broad enough to be a subject in the catalogue — the
//     first two of those came back as the top candidates on the very first build run, which is
//     how we know they had to be rejected: a list of everything the library calls nonfiction is
//     not a reading list, it is the whole shelf sorted by reprint count;
//   • the paperwork of a discipline (statistics, congresses, directories, sources) is
//     catalogued under the topic and tops an editions-sorted list every single time;
//   • a bare umbrella word — "history", "science", "world" — is so wide that ordering it by
//     editions returns Dickens, which is the exact failure the curated rules were built to
//     stop. It is anchored to the WHOLE label on purpose: "history of science" and "world
//     war" are shelves, "history" is a shrug. The second proof run (45 shelves) added the last
//     few words of that list by measurement: "Methods" (91,291 works, a subdivision), "Origin"
//     (14,889, half of them Victorian), "Behavior", "Medical" and "Translations Into English"
//     (a label for the book's language, not its topic) all came back as top candidates;
//   • the catalogue's subject strings are not all English, and not all of them are labels a
//     reader would recognise. The first 30-shelf proof run (24 Oct 2026) published "Chemie",
//     "Physik", "Histoire", "Lehrbuch", "Natuurkunde", "Economie Politique", "Problemes Et
//     Exercices", "Manuels D'enseignement Superieur", "Early Works To 1800", "Popular Works",
//     "Chemistry, Organic", "Study And Teaching (Secondary)" and "Open_syllabus_Project" —
//     eleven of thirty pages that nobody would have read. Two of the three families below
//     exist because of that list, measured rather than imagined.
// The `bare` additions are a different failure: "will", "sick" and "face" are English, but the
// catalogue folds several headings into one string, so their lists are incoherent — measured on
// the VPS, "Will" (12,441 works) is Schopenhauer's "Die Welt als Wille und Vorstellung" next to
// "Will of General George Washington" next to "La Ley Del Exito", and "Sick" (8,836) is the
// "Rituale Romanum" next to "Long day's journey into night". One label standing for two
// unrelated topics is not a reading list, it is a homophone. "Play" is the same family and is
// anchored for the opposite reason: the plural is a form tag wherever it sits, while "play"
// standing alone is the catalogue's drama heading — but "play therapy" is a real topic, so it
// must not be caught by a substring rule.
const REJECT = {
  // A subject label is a topic, so it is written with words and spaces. Commas are the
  // inverted subdivision order ("chemistry, organic" — the same topic as "organic
  // chemistry", already a candidate in its own right); parentheses, slashes, underscores,
  // apostrophes and full stops are catalogue machinery ("study and teaching (secondary)",
  // "science/mathematics", "open_syllabus_project"). Accents go with them: this is an
  // English-language site and "problèmes et exercices" is not an English label.
  label: /[^a-z0-9 -]/,
  subdivision: /--/,
  form: /\b(fiction|novels?|romance|juvenile|drama|poetry|poems|stories|tales|legends|myths|essays|speeches|addresses|plays|nonfiction|non-fiction)\b/i,
  // Where a form or paperwork word sits anywhere in the label, the label describes the book
  // rather than the topic: "science textbooks", "laboratory manuals", "popular works" and
  // "early works to 1800" all topped the harvested pool with counts over 60. "problems" and
  // "exercises" are only rejected as the pair the catalogue writes, so that "problem solving"
  // stays a subject.
  shape: /\b(textbooks?|handbooks?|manuals?|popular works|early works|pictorial works|illustrated|miscellanea|bestsellers?|criticism and interpretation|physiological phenomena|aspects?)\b|problems?[^a-z]{0,3}exercises?|translat\w*\s+into/i,
  // The coverage gate catches most foreign spellings by their titles, but not those whose
  // books are written in the same language as the label: the 150-shelf proof run (24 Oct 2026)
  // published "Anatomie Humaine", "Cellules", "Enfants", "Denken", "Exito En Los Negocios",
  // "Genetica", "Strategisch Management" and "Ontwikkelingspsychologie" with coverages over the
  // threshold, because a French subject does find French titles. This is an English-language
  // site, so the tokens that were actually seen are refused by name. Every word here was
  // observed in the harvested pool and each is a spelling of a topic the catalogue already
  // offers in English — nothing here is a guess about a language.
  // …and the 1,000-shelf run (24 Oct 2026, on the VPS) added the rest of them by reading every
  // label of eight characters or fewer: peur, mort, amor, kind, femmes, mujeres, erfolg, ethik,
  // raison, quelle and wiskunde all cleared the coverage gate, because the catalogue holds the
  // topic's books in that language too. Two routes were measured and rejected before this list
  // was written: the `language` field is a list of every translation a work has ("The Wisdom of
  // Insecurity" = spa,tur,eng,fre,slv,chi,ger), so it cannot say what language a TITLE is; and
  // there is no English lexicon on this box (/usr/share/dict/words is absent, none in
  // node_modules). A named list of strings the harvest really published is the honest shape.
  //
  // The tail is a shape rather than a list, and this part is a rule instead of more words: no
  // English word ends in "…ologie" or "…iek", while the Dutch and German spellings of a
  // discipline do — "cosmologie", "dermatologie", "diagnostiek" were all live shelves beside the
  // English ones they duplicate, and their stem differs at the last letter, so the twin rule
  // cannot see them either ("cosmologi" is not a prefix of "cosmology").
  foreign: /\b(anatomie|humaine|cellules|enfants|denken|exito|negocios|genetica|genetik|strategisch|strategisches|entwicklungspsychologie|ontwikkelingspsychologie|psychologie|chemie|chimie|physik|physique|natuurkunde|histoire|philosophie|lehrbuch|economie|politique|mathematiques|manuels|problemes|exercices|d-enseignement|sociale|sociologie|medicina|historia|literatura|ciencias|peur|mort|amor|kind|femmes|mujeres|erfolg|ethik|raison|quelle|wiskunde|alimentos|amerikanisches|englisch|bonheur|christentum|ciencia|corps humain|cuidado|desarrollo|diccionarios|dieu|droit|embarazo|economia|esprit|esthetica|etik|europa|felicidad|filosofia|glaube|magia|malades|miedo|muerte|mujer|mythen|naturwissenschaften|occultisme|padres|politica|relaciones|sociedade|theorie|travail|comportement|humain|projets|jeunesse|visuelle|naturelles|signes|symboles|connaissance|contemporaine|socialisme|populaire|technologiques|betrekkingen|wereldgeschiedenis|productiemanagement|informatiesystemen|internationale|moderne|psychisches|informationstechnik|naturopathie|leben|liebe|mystik|origines|ouvrages|personnelles|nourrissons|espirit|actualisation|amour|anatomia|communisme|comunismo|ergonomie|informatica|mythologie|souffrance|soziale|probleme|technik|intellectuelle|intelligentie|zeit|aprendizagem|konzentrationslager|wirklichkeit|sozialpolitik|filozofia|feminismus|poradniki|planejamento|rhetorique|auteurs|alcooliques|catholiques|medecine|medecines|empleados|industria|urbano|petits|groupes|familles|livres|normes|arbeiten)\b|^(?:\w+ologie|\w+iek)$|^(?:\w+osofia|\w+ologias|\w+esthetik|\w+ysik|\w+emie)$|\b(?:ciencias|relaciones|alimentos)\b|\b(?:\w+isme|\w+isatie|\w+ische[nsr]?|\w+ierung|\w+issage)\b/i,
  paperwork: /^(laws|acts|bills|treaties|agreements|reports|proceedings|congresses|conferences|symposia|colloquia|periodicals|serials|dictionaries|enc[oa]cl[oa]p[ae]dias|directories|yearbooks|almanacs|statistics|sources|bibliograph\w*|indexes|abstracts|microforms?|microfilms?|patents?|standards?|specifications|catalogs|catalogues|pictures\b)/i,
  bare: /^(history|society|geography|science|technology|nature|world|civilization|civilisation|commerce|trade|industry|education|research|methodology|miscellany|miscellaneous|biography|autobiography|diaries|correspondence|letters|interviews|obituaries|study and teaching|study and travel|description and travel|origin|origins|methods|behavior|behaviour|medical|physiological|phenomena|will|sick|face|play)$/i,
};

/**
 * Should this subject string become a page? Returns a reason string when it should not,
 * or null when it may be tried. Pure, so the rules can be argued about in a test rather
 * than discovered in a live 404. Note that a rejection here costs nothing: the term was
 * read off a record we already fetched.
 */
function rejected(term) {
  const t = String(term || '').trim().toLowerCase();
  if (t.length < 4 || t.length > 52) return 'too short or too long to be a subject';
  if (!/[a-z]{3}/.test(t)) return 'no real word in it';
  if (/^[\d\s.,-]+$/.test(t)) return 'a number, not a subject';
  for (const [name, re] of Object.entries(REJECT)) if (re.test(t)) return `a ${name} label, not a topic`;
  if (/\bin\s+(fiction|literature)\b|\bof\s+the\b/.test(t)) return 'a qualified fragment';
  return null;
}

/**
 * The last gate, and the only one that needs the shelf's own books: how often does the
 * label actually appear in the titles on the list?
 *
 * A real subject is a word its books use. Measured on 24 Oct 2026 over thirty titles a
 * term: beekeeping 0.57, gardening 0.57, organic chemistry 0.93, astronomy 0.50,
 * mountaineering 0.27, numismatics 0.33, cosmology 0.20, economics 0.20 — while every
 * foreign label came in at or under 0.13 (chimie 0.03, physik 0.03, histoire 0.00,
 * lehrbuch 0.00, natuurkunde 0.00, economie politique 0.03) and so did the catalogue
 * jargon the shape rule misses (long now manual for civilization 0.03, new york times
 * bestseller 0.13). The gate is the maximum over the label's words, because "organic
 * chemistry" needs only "organic" to be a title-word; a stem match both ways so
 * "photography" is credited by "Photographic" and "numismatics" by "Numismatic".
 *
 * Returns null when the label has no word long enough to test ("art", "dna"): an
 * untestable label is not a false label, so the build keeps it.
 */
const LABEL_MIN_TITLE_COVERAGE = 0.15;
const stemWord = (w) => String(w).replace(/[^a-z]/g, '').replace(/s$/, '');
function labelCoverage(term, titles) {
  const words = [...new Set(String(term || '').toLowerCase().split(/[^a-z0-9]+/)
    .map(stemWord).filter((w) => w.length >= 4))];
  const list = Array.isArray(titles) ? titles.filter(Boolean) : [];
  if (!words.length || !list.length) return null;
  const stems = list.map((t) => String(t).toLowerCase().split(/[^a-z0-9]+/).map(stemWord));
  let best = 0;
  let word = words[0];
  for (const w of words) {
    const hits = stems.filter((line) => line.some((x) => x.startsWith(w) || w.startsWith(x))).length;
    if (hits / list.length > best) { best = hits / list.length; word = w; }
  }
  return { coverage: best, word };
}

const readJson = (file) => {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
};
const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file); // rename is atomic: a reader never sees half a file
};

// The shelf index is read and kept — 1,000 entries of {slug, term, title, works, found, at} is
// 130 KB, and every hub, A–Z page and sitemap row comes from it. It is re-read when the file's
// mtime moves rather than parsed exactly once: a build that finishes while the server is running
// must become visible without restarting the site, and measured on the VPS (24 Oct 2026) the
// opposite choice left /books/a-z and /sitemap-books.xml reporting sixty shelves after the run had
// written a thousand, while the work sitemaps — which already cache by mtime — were correct.
let shelfIndex = null;
let shelfIndexAt = 0;
function autoShelves() {
  let mtime = 0;
  try { mtime = fs.statSync(SHELF_INDEX_FILE).mtimeMs; } catch { /* no index yet */ }
  if (shelfIndex && shelfIndexAt === mtime) return shelfIndex;
  const raw = readJson(SHELF_INDEX_FILE);
  shelfIndex = Array.isArray(raw) ? raw.filter((s) => s && s.slug && s.term && s.works > 0) : [];
  shelfIndexAt = mtime;
  return shelfIndex;
}
/** Forget the parsed index — the build script and the tests both need this. */
function reloadShelves() { shelfIndex = null; shelfIndexAt = 0; workCountCache = null; }

/** Curated first, then built: the twenty-seven hand-written shelves always lead. */
function shelfMeta(slug) {
  const key = String(slug || '').toLowerCase();
  return BY_SLUG.get(key) || autoShelves().find((s) => s.slug === key) || null;
}

function allShelves() {
  return [...SUBJECTS.map((s) => ({ ...s, curated: true })), ...autoShelves().map((s) => ({ ...s, curated: false }))];
}

// Last twenty-four shelf files parsed. Twenty-four is the number a crawler can plausibly
// have open at once across the whole cluster; past that a page costs one file read, which
// is what this box is good at. The mtime rides along with the parse for the same reason the
// index's does: the build rewrites a shelf file, and a reader must not be served the old list
// because this process happened to look at it first.
const shelfLru = new Map();
function shelfFile(slug) { return path.join(SHELF_DIR, `${slug}.json`); }

/** The works on a built shelf, from disk. Never the network, never a surprise. */
function shelfWorks(slug) {
  const file = shelfFile(slug);
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return []; }
  const hit = shelfLru.get(slug);
  if (hit && hit.mtime === mtime) return hit.works;
  const raw = readJson(file);
  const works = raw && Array.isArray(raw.works) ? raw.works : [];
  shelfLru.set(slug, { mtime, works });
  if (shelfLru.size > 24) shelfLru.delete(shelfLru.keys().next().value);
  return works;
}

/**
 * Which shard file holds a work. An Open Library key is "/works/OL2941508W", so the digits
 * give a stable bucket with no lookup table to keep in step with the data. The digits are
 * extracted rather than the prefix trimmed, because a key reaches this code both as a bare
 * id and as the "/works/…" path off the record.
 */
function shardOf(id) {
  const m = /OL(\d+)W/i.exec(String(id || ''));
  return m ? Number(m[1]) % WORK_SHARDS : 0;
}

const shardLru = new Map();
function shard(n) {
  const file = path.join(WORK_DIR, `shard-${n}.json`);
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return {}; }
  const hit = shardLru.get(n);
  if (hit && hit.mtime === mtime) return hit.map;
  const raw = readJson(file) || {};
  shardLru.set(n, { mtime, map: raw });
  if (shardLru.size > 4) shardLru.delete(shardLru.keys().next().value);
  return raw;
}

/** One catalogue record by Open Library work id, or null. */
function work(id) {
  const m = /OL(\d+)W/i.exec(String(id || ''));
  if (!m) return null;
  return shard(shardOf(`OL${m[1]}W`))[`OL${m[1]}W`] || null;
}

// The work index is one JSON line per work. It exists for exactly one reason: a sitemap may
// only promise urls the site can serve, so the list of what was built has to be readable
// without parsing 20 MB of shards. Cached by mtime, because the build rewrites it.
let workCountCache = null;
function workIds() {
  let mtime = 0;
  try { mtime = fs.statSync(WORK_INDEX_FILE).mtimeMs; } catch { return []; }
  if (workCountCache && workCountCache.mtime === mtime) return workCountCache.ids;
  try {
    const ids = fs.readFileSync(WORK_INDEX_FILE, 'utf8').split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((r) => r && r.id).map((r) => ({ id: r.id, at: r.at || null }));
    workCountCache = { mtime, ids };
    return ids;
  } catch {
    return [];
  }
}

/**
 * What the site can actually serve right now — the only honest source for a sitemap.
 * A curated shelf counts when its mirror holds works; a built shelf counts when its file
 * does, which means a partially finished build simply publishes fewer urls, not 404s.
 */
function inventory() {
  const mirror = readMirror();
  const shelves = [];
  for (const s of SUBJECTS) {
    const m = mirror[s.slug];
    if (m && Array.isArray(m.works) && m.works.length) {
      shelves.push({ slug: s.slug, title: s.title, at: m.at || null, curated: true, works: m.works.length });
    }
  }
  for (const s of autoShelves()) {
    // The shelf file is not parsed here. At a thousand shelves that is a thousand JSON reads on
    // every crawler hit to /sitemap-books.xml — measured live at 1.5 s — and the only question
    // this route asks of the file is whether it is there at all, which is what a half-finished
    // build changes. The number of works comes from the index row the builder wrote beside it.
    let shelved = false;
    try { shelved = fs.statSync(shelfFile(s.slug)).size > 2; } catch { shelved = false; }
    if (shelved && s.works > 0) {
      shelves.push({ slug: s.slug, title: s.title, at: s.at || null, curated: false, works: s.works });
    }
  }
  return { shelves, works: workIds() };
}

/**
 * How many work-sitemap chunks a build of `total` works needs — and zero works is zero chunks.
 * A sitemap index may not advertise a file that answers 404. This is not theoretical: the VPS
 * was probed before its first build (24 Oct 2026) and /sitemap-book-works.xml listed chunk 0
 * while chunk 0 replied "No such book sitemap chunk", because the route had a Math.max(1, …) in
 * it. An empty index is valid XML and simply says the cluster has no pages to offer yet.
 */
function workSitemapChunks(total, chunk) {
  const n = Number(total) || 0;
  const size = Number(chunk) || 1;
  return n <= 0 ? 0 : Math.ceil(n / size);
}

// ── Writers, used by the build script only ─────────────────────────────────────────
/** Save one shelf: the index entry plus its own file, so a page reads one small file. */
function saveShelf(shelf) {
  const { slug, term, title, works, found, at } = shelf;
  writeAtomic(shelfFile(slug), JSON.stringify({ slug, term, title, found, at, works }));
}

/** Persist the whole shelf index at once — a reader never sees a half-written list. */
function saveShelfIndex(list) {
  writeAtomic(SHELF_INDEX_FILE, JSON.stringify(list));
  shelfIndex = null;
}

/** Write every work into its shard and rewrite the index. */
function saveWorks(records) { writeWorks(records, true); }

/**
 * The same, but every shard is written from scratch, so a record nobody gave you any more is
 * gone rather than merely absent. Used when a shelf is pruned: its works must leave the store
 * with it, because the work index is what a sitemap is allowed to promise.
 */
function replaceWorks(records) { writeWorks(records, false); }

function writeWorks(records, merge) {
  const byShard = new Map();
  for (const r of records) {
    const n = shardOf(r.id);
    if (!byShard.has(n)) byShard.set(n, {});
    byShard.get(n)[r.id] = r;
  }
  const all = [];
  for (let n = 0; n < WORK_SHARDS; n += 1) all.push(n);
  for (const n of (merge ? [...byShard.keys()] : all)) {
    const file = path.join(WORK_DIR, `shard-${n}.json`);
    const map = byShard.get(n) || {};
    writeAtomic(file, JSON.stringify(merge ? { ...readJson(file), ...map } : map));
  }
  shardLru.clear();
  writeAtomic(WORK_INDEX_FILE, records.map((r) => JSON.stringify({ id: r.id, at: r.at })).join('\n') + '\n');
  workCountCache = null;
}

/**
 * How the cluster is doing — for /health and for us.
 */
function status() {
  const built = autoShelves();
  return {
    subjects: SUBJECTS.length,
    built: built.length,
    builtWorks: built.reduce((a, s) => a + (s.works || 0), 0),
    records: workIds().length,
    cached: cache.size,
    ...stats,
    lastError: stats.lastError || null,
  };
}

/**
 * A cover for a work, without ever touching a byte on this box. The `ia` field Open Library
 * carries lists the archive.org items attached to the work; those are the Internet Archive's
 * own scan identifiers, and IA publishes a thumbnail for each at its services/img endpoint.
 * Two kinds of value appear there: a real item identifier (the machine slug IA names the scan
 * by, sometimes with a prefix like "bwb_") and a pseudo-identifier like "isbn_978..." that
 * stands for a record with no scan attached. Only the first resolves, so it is the only one
 * linked; anything else that turns out not to serve an image is cleared by the page's onerror.
 * Returns null when every value is an isbn pseudo-id — the caller then shows no cover.
 */
function coverUrl(ia) {
  const real = (Array.isArray(ia) ? ia : []).find((x) => typeof x === 'string'
    && /^[a-z0-9][a-z0-9_.@-]{3,119}$/i.test(x) && !/^isbn[_-]/i.test(x));
  return real ? `https://archive.org/services/img/${encodeURIComponent(real)}` : null;
}

module.exports = {
  SUBJECTS, BY_SLUG, LIMIT, PER_SEARCH, MAX_PER_AUTHOR, TTL, MIRROR_FILE,
  SHELF_DIR, SHELF_INDEX_FILE, WORK_DIR, WORK_INDEX_FILE, WORK_SHARDS, SHELF_MIN_WORKS,
  LABEL_MIN_TITLE_COVERAGE,
  subject, prime, status, normalise, rankWorks, carriesSubject, isFiction, isSerial, readMirror,
  searchSubject, titleCase, shelfSlug, rejected, labelCoverage, shelfMeta, allShelves, autoShelves, shelfWorks,
  work, workIds, shardOf, inventory, saveShelf, saveShelfIndex, saveWorks, replaceWorks, reloadShelves,
  workSitemapChunks, coverUrl,
};
