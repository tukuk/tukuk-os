'use strict';
// tool-categories.js — one taxonomy for the whole /alat toolbox (Nov 2026).
//
// Why this exists as its own module: the hub grew from five hand-written pages to a registry
// of ninety-five and then to the data-driven families, which is over a thousand tools. A wall
// of a thousand chips on every tool page is not navigation — it is page weight, and the hub
// stopped being glanceable at the same point. Categories are what let the hub, the cross-tool
// nav and the sitemap scale without either: every tool belongs to exactly one category, a tool
// page links to its own category and a few siblings, and /alat lists categories instead of
// every tool ever written.
//
// The map is keyed by slug, which is the same string for a registry tool (/alat/prime) and a
// first-wave hand-written page (/alat/unit), so one lookup covers both. Anything unmapped
// falls into 'everyday' rather than disappearing from a category page — and
// test/tool-categories.test.js fails if a tool lands in a category that is not declared here.

// Two honest paragraphs per category, shown on that category's own page. They are written
// without counts on purpose: a page that says "the 341 cities we carry" is a page that lies
// the day the dataset grows, and the real numbers are printed beside the heading anyway.
const CATEGORIES = [
  { id: 'distances', ic: '📏', name: 'City-to-city Distances',
    blurb: 'Great-circle distance, bearing, nautical miles and flight time between the world’s major cities — worked out from their coordinates, in your browser.',
    about: ['Every page here answers one literal question in its title — how far is this city from that one — and answers it with the arithmetic shown. The distance given is the great-circle arc, the shortest line between two points on a sphere, computed with the haversine formula on the IUGG mean Earth radius of 6,371.0088 km. Alongside it you get statute miles, nautical miles, the initial true bearing, and what the line would take at a cruising 900 km/h or a non-stop 80 km/h drive.',
      'Roads are the part people argue about, so each page says it plainly: the figure is the air line, and a real drive is usually 1.2 to 1.4 times longer because hills, borders, rivers and bypasses do not follow a great circle. Both cities’ coordinates are printed in decimal degrees and degrees-minutes-seconds on the page, and the form lets you replace them with any other pair — the maths reruns in your browser, nothing is fetched and nothing is stored.'] },
  { id: 'coordinates', ic: '🧭', name: 'Coordinates & Position',
    blurb: 'Latitude and longitude in decimal degrees, degrees-minutes-seconds and GeoHash, with meridian distances, bearings and the point on the far side of the planet.',
    about: ['A position is only useful once you can write it in the format you need. Each page takes one city and gives it back as decimal degrees, degrees-minutes-seconds, degrees and decimal minutes, and a nine-character GeoHash, together with how far the place sits from the equator, from the nearest pole and from the prime meridian — the last measured along its own parallel, which is the honest way, because a degree of longitude shrinks with the cosine of the latitude.',
      'The distances are not a flat 111 km per degree. Meridian arcs come from Simpson integration of the exact WGS84 meridian integral and the parallel radius from the ellipsoid’s prime-vertical radius of curvature, so a kilometre on these pages is a kilometre on the ground. WGS84 is the datum GPS broadcasts and every web map displays; a coordinate quoted without its datum is incomplete, and older local surveys can shift a street corner by hundreds of metres.'] },
  { id: 'antipodes', ic: '🌏', name: 'Antipodes',
    blurb: 'What sits on the other side of the Earth from a given place, the arc to it, and the nearest mapped town to that point.',
    about: ['Drop a line from a place straight through the centre of the planet and note where it comes out: that is its antipode. The rule is two lines of arithmetic — keep the size of the latitude and change its hemisphere, then add 180° of longitude and fold anything past the dateline back into range. The surface distance between the pair is always half a great circle, about 20,015 km, and the line through the Earth is its mean diameter, about 12,742 km.',
      'Because roughly 86 per cent of the surface is ocean and land is concentrated in the northern hemisphere, the other side of most places is water, which is what makes the land-on-land pairs interesting. Each page therefore names the nearest place in our coordinate table to that antipode and states the distance — a useful, honest bound rather than a claim about every village on Earth. The form accepts any position, so a hill you once stood on works as well as a capital.'] },
  { id: 'numbers', ic: '🧮', name: 'Numbers & Maths',
    blurb: 'Base and radix conversion, primes and factorisation, fractions, statistics, combinations, Roman numerals, number-to-words and exact duration maths.',
    about: ['The arithmetic people reach for a calculator to avoid: radix conversion that stays exact past the 2⁵³ limit of ordinary numbers, prime tests with their factorisation, fraction algebra that shows the working, a statistics run over a list you paste, combinations and permutations, Roman numerals both ways, a number written out in words, and duration maths in every unit at once.',
      'Each page names the method it uses rather than hiding it — BigInt long division for bases, trial division and Miller–Rabin for primes, the standard deviation formulas for the statistics — because a tool that will not show its maths is an ad farm with a text box. Everything runs on your device, so nothing you count is uploaded and the answer arrives even with the network switched off.'] },
  { id: 'money', ic: '💰', name: 'Money, Rates & Shopping',
    blurb: 'Salary and percentage maths, loans and compound interest, tips, discounts, unit prices, inflation, tax and the electricity cost of an appliance.',
    about: ['Money questions are usually three numbers and a formula: an amortising loan with the total interest spelled out, compound growth with the compounding intervals visible, a salary converted between hourly, weekly, monthly and annual, a tip split across a table, a discount stacked with a second one, two shop packages compared per unit, an old price carried through inflation, and the running cost of whatever is plugged in.',
      'The formulas are the published ones — the annuity payment equation, the compound amount formula, the Mifflin-style logic of percentage change — and the pages print the steps beside the answer so you can check them. Nothing here is a quote, a recommendation or a lead for a lender; it is arithmetic, and the reason it is worth doing locally is that a payslip, a loan offer or an electricity tariff has no business travelling to somebody else’s server.'] },
  { id: 'health', ic: '❤️', name: 'Health, Body & Fitness',
    blurb: 'BMI, calorie and TDEE maths, sleep cycles, hydration, breathing pace, heart-rate zones, caffeine decay, running pace and the blood-type Punnett square.',
    about: ['Body maths with the formula named on the page: BMI against the published WHO bands, a healthy weight range for your height, basal metabolic rate and daily energy needs from the Mifflin–St Jeor equation, hydration and electrolyte estimates, training heart-rate zones from your maximum, the exponential decay of caffeine through a half-life, pace splits for a run and a breathing pacer you can follow on screen.',
      'These are calculators, not advice. BMI cannot see body composition, an equation for calorie needs is a population average applied to one person, and a heart-rate formula carries a spread of several beats either way — each page says as much and points out which input the numbers are sensitive to. Nothing you type leaves the device, which is the only reason a page like this should be trusted at all.'] },
  { id: 'time', ic: '⏱', name: 'Date & Time',
    blurb: 'Date and age arithmetic, weekday finders, ISO week numbers, countdowns, stopwatches, pomodoro timers, moon phases and the Easter computus.',
    about: ['Calendars are full of edge cases and these pages exist to get them right: days between two dates with a working-day count, an exact age in years, months and days, the ISO week a date falls in with its year boundary handled, a weekday finder that walks to the next date matching a rule, a printable month grid, epoch timestamps in both directions with seconds and milliseconds distinguished, and a live countdown.',
      'Date arithmetic is done on real Gregorian dates rather than by dividing millisecond differences, because a day is not always 86,400 seconds where daylight saving is in force — that is the classic bug in code like this, and the pages count calendar days instead. Timers, stopwatches and the pomodoro use the browser clock you can see in the address bar, and the moon phase and Easter computus are the published algorithms, printed with their assumptions.'] },
  { id: 'dev', ic: '🧩', name: 'Developer & Data Tools',
    blurb: 'JSON, JWT, hashes, Base64, UUIDs, cron, regex, CSV, diffs, URLs, HTML entities, Markdown, subnets, EAN-13 and keyboard checks — all offline.',
    about: ['The workbench half of the toolbox: a JSON formatter that reports the exact line and column of a syntax error and preserves key order, a JWT decoder that shows the header and claims without signing anything, hashes from MD5 to SHA-512 over text or a whole file, Base64 both ways with URL-safe output, UUID v4 and v7 generation with a decoder, a cron explainer that catches the day-of-month versus day-of-week trap, a regex tester with live match highlighting, CSV to JSON, a word diff, a URL parser and a subnet calculator.',
      'Files are the point. Anything you paste, hash, split or convert is read by your browser and never uploaded, so a production config, an auth token, a customer CSV or a build artefact can be inspected here without deciding whether a third-party server can be trusted with it. Each page states which standard or algorithm it follows — RFC 4180, RFC 4648, RFC 4122, WCAG — instead of leaving you to guess.'] },
  { id: 'text', ic: '✍️', name: 'Text, Words & Writing',
    blurb: 'Word counts and case conversion, readability scores, summaries, citations, essay and Cornell-note planning, Morse, phonetic alphabet and DNA transcription.',
    about: ['Text that has to be measured, counted or turned into something else: word, character and sentence counts with a reading-time estimate, every case a programmer can ask for, readability scoring on the Flesch scales, an extractive summariser, citation output in the common styles, essay and Cornell-note skeletons you can print, Morse and the NATO phonetic alphabet, and a transcriber that speaks a paragraph back as DNA codons.',
      'Counting words sounds trivial until hyphens, CJK text and pasted tables arrive, so the pages describe what they treat as a word instead of leaving it implicit. Readability scores are reported with their formula and their known weakness — a high score does not mean a text is true or well argued, only that its sentences and syllables are short.'] },
  { id: 'learn', ic: '🎓', name: 'Study & Learning',
    blurb: 'Flashcards, quiz makers, times tables, spelling, worksheets, the periodic table and solar system, study planners, mind maps and revision logs.',
    about: ['Tools for the person doing the learning and the person setting it: flashcards with a shuffle and a self-marking review queue, a quiz maker that turns a list of questions into a scored run, times-table and clock-reading trainers, spelling practice with word lists by level, printable worksheets that generate themselves with an answer key, a periodic table and solar system explorer, and planners that turn an exam date into a revision schedule.',
      'Nothing needs an account and no progress is kept on our server, which is deliberate: a study tool that phones home is a tool you stop trusting. Cards, quizzes and worksheets live in the page you generated, so printing one, sending it to a classmate or working through it on a train with no signal all behave the same way.'] },
  { id: 'design', ic: '🎨', name: 'Colour, Images & Files',
    blurb: 'Contrast and palette maths, the design studio, image compression and conversion, print sizes, screen PPI and PDF tools that never upload the file.',
    about: ['The visual shelf: a WCAG contrast checker with AA and AAA verdicts plus the nearest accessible colour, tints and shades, a canvas design studio with layers and snapping, image compression and format conversion between PNG, JPEG, WebP, BMP and ICO, print sizes at a chosen DPI, screen pixel-density comparison and PDF tools that merge, split, rotate, extract and re-save pages.',
      'The important property is that the file never leaves your machine. A photo, a scan of a document, a passport picture or an invoice is opened by your browser through the File API and re-saved by it, so there is no upload to wait for, no size limit, no privacy decision to make and no service that can lose the file afterwards. The maths behind each answer — relative luminance, resampling, JPEG quality — is named on the page.'] },
  { id: 'everyday', ic: '🧰', name: 'Everyday Tools',
    blurb: 'The rest of the toolbox — generators, checkers and calculators that do not sit in a single subject, from QR codes to recipe scaling.',
    about: ['Everything that refused to fit a subject: a QR code generator with error-correction controls and a print-ready PNG, a random-number and dice tool drawn from the cryptographic generator with rejection sampling so no face is favoured, a password generator that explains its own entropy, paint coverage, recipe scaling, download-time estimates, a keyboard tester, an IP and browser-field inspector, and odds for a dice roll.',
      'These are the pages people need once and forget the name of, which is exactly when a search result that opens instantly and asks for nothing is worth something. Each one states the definition, formula or random source behind its answer, keeps the whole computation on your device, and stays usable with the network dead. Anything new that is not yet a subject of its own lands here as well, so the shelf doubles as the honest home for the one-off tools rather than a bin they disappear into.'] },
];

// slug → category. Anything not listed is 'everyday', so a new tool is never invisible.
const CAT_BY_SLUG = {
  // registry: numbers & maths
  base: 'numbers', binary: 'numbers', prime: 'numbers', fraction: 'numbers', stats: 'numbers',
  gcd: 'numbers', comb: 'numbers', repeating: 'numbers', roman: 'numbers', 'number-to-words': 'numbers',
  duration: 'numbers', validate: 'numbers', triangle: 'numbers', dice: 'numbers', unit: 'numbers',

  // registry: money, rates & shopping
  salary: 'money', tip: 'money', discount: 'money', unitprice: 'money', inflate: 'money',
  compound: 'money', tax: 'money', electricity: 'money', fuel: 'money', loan: 'money',
  percentage: 'money', download: 'everyday',

  // registry: health, body & fitness
  tdee: 'health', sleep: 'health', water: 'health', breath: 'health', heartrate: 'health',
  caffeine: 'health', bmi: 'health', 'blood-type': 'health', pace: 'health',

  // registry: date & time
  countdown: 'time', week: 'time', 'month-grid': 'time', weekday: 'time', 'time-diff': 'time',
  easter: 'time', moon: 'time', date: 'time', epoch: 'time', timezone: 'time',
  pomodoro: 'time', stopwatch: 'time', metronome: 'time',

  // registry: developer & data
  json: 'dev', jwt: 'dev', hash: 'dev', base64: 'dev', uuid: 'dev', cron: 'dev', regex: 'dev',
  csv: 'dev', diff: 'dev', url: 'dev', char: 'dev', entity: 'dev', markdown: 'dev', case: 'dev',
  slug: 'dev', subnet: 'dev', kbd: 'dev', pwstrength: 'dev', password: 'dev', ip: 'dev',
  ean13: 'dev', cssunits: 'dev',

  // registry: text, words & writing
  text: 'text', readability: 'text', lorem: 'text', summarizer: 'text', typing: 'text',
  'typing-test': 'text', 'reading-time': 'text', dictionary: 'text', spelling: 'learn',
  'citation-maker': 'text', 'essay-planner': 'text', 'cornell-notes': 'text', 'mind-map': 'text',
  'cloze-test': 'text', morse: 'text', phonetic: 'text', dna: 'learn',

  // registry: study & learning
  flashcards: 'learn', 'quiz-maker': 'learn', 'times-tables': 'learn', 'clock-reading': 'learn',
  'periodic-table': 'learn', 'flags-quiz': 'learn', 'word-scramble': 'learn', worksheet: 'learn',
  'solar-system': 'learn', 'study-planner': 'learn', 'word-guess': 'learn', 'memory-kit': 'learn',
  'assignment-planner': 'learn', 'weekly-plan': 'learn', 'study-log': 'learn', gpa: 'learn',
  grade: 'learn',

  // registry: colour, images & files
  color: 'design', design: 'design', image: 'design', convert: 'design', 'image-to-pdf': 'design',
  pdf: 'design', printsize: 'design', screen: 'design', aspect: 'design',

  // places & position (registry + the three generated families carry cat directly)
  compass: 'coordinates', coords: 'coordinates',

  // everyday leftovers
  qr: 'everyday', random: 'everyday', recipe: 'everyday', paint: 'everyday', cipher: 'everyday',
  'reading-pace': 'learn',
};

const DEFAULT_CAT = 'everyday';
const BY_ID = {};
CATEGORIES.forEach((c) => { BY_ID[c.id] = c; });

function catOf(slug) {
  const id = CAT_BY_SLUG[String(slug || '').replace(/^\/alat\//, '')] || DEFAULT_CAT;
  return BY_ID[id] ? id : DEFAULT_CAT;
}

function category(id) { return BY_ID[id] || BY_ID[DEFAULT_CAT]; }

module.exports = { CATEGORIES, CAT_BY_SLUG, catOf, category, DEFAULT_CAT, byId: BY_ID };
