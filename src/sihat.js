'use strict';
// ── TUKUK-OS /health — everyday-body explainers ──
// Deliberately modest: six topics about ordinary human physiology (sleep, water, steps, pulse,
// breathing, temperature), each written to one rule — state only numbers that established health
// authorities publish, name the authority on every figure, and send the reader to a doctor the
// moment a fact stops being general. This is education about the body, not advice about anyone's
// body; the disclaimer appears on every page and the "see a doctor" block is never optional.
// No diagnosis, no supplements, no treatments, no before-and-after promises. Everything here is
// static text served from disk: no API, no failure mode, no stale data.

const TOPICS = [
  {
    slug: 'sleep',
    icon: '😴',
    title: 'Sleep',
    blurb: 'How many hours adults actually need, why the schedule matters as much as the amount, and what the sleep research consensus says.',
    lead: 'Sleep is the one-third of your life you cannot schedule away — the body treats it as load-bearing infrastructure: memory consolidation, hormone regulation and immune function all run their maintenance shifts there.',
    facts: [
      ['Adults (18–64)', '7–9 hours per night', 'U.S. CDC & American Academy of Sleep Medicine consensus'],
      ['Adults 65+', '7–8 hours', 'AASM/SRS recommendation'],
      ['Teenagers (14–17)', '8–10 hours', 'CDC sleep-duration guidance'],
      ['Caffeine half-life', 'roughly 5–6 hours', 'standard pharmacology references (NIH)'],
      ['Commonly suggested bedroom temperature', 'around 18 °C / 65 °F', 'NIH sleep-hygiene guidance'],
    ],
    body: [
      {
        h: 'The amount is the famous number — the consistency is the quiet one',
        ps: [
          'Adult sleep guidelines converge on seven to nine hours, and under six is where the population studies start finding elevated risks for heart disease, weight gain and impaired immunity. But newer research on "sleep regularity" suggests the clock matters almost as much as the count: people who go to bed and wake at roughly the same times every day — including weekends — do better on metabolic and mood measures than equal-duration night owls with erratic schedules. A fixed wake time is the cheapest health intervention that exists.',
          'One warning about the bedroom maths: lying awake worrying about not sleeping is its own industry problem. Sleep researchers (following the NIH/NHS guidance) consistently advise getting up if twenty-odd minutes pass awake rather than watching the clock, because the bed should stay associated with sleep and not with frustration.',
        ],
      },
      {
        h: 'What actually moves the needle',
        ps: [
          'Caffeine has a half-life of five to six hours, which is why the two-afternoon-coffee rule shows up in almost every expert checklist: a 4 p.m. coffee is still half-present at 9 or 10 p.m. Alcohol makes you drowsy but fragments the back half of the night — sleep architecture suffers even when the total hours look fine. Light is the other lever: bright light late in the evening pushes melatonin onset later, and morning daylight pulls the whole clock earlier. The commonly recommended cool, dark, screen-quiet bedroom is folklore and physiology agreeing for once.',
        ],
      },
      {
        h: 'When sleep stops being a lifestyle question',
        ps: [
          'Loud habitual snoring with witnessed pauses in breathing, irresistible evening restlessness in the legs, or falling asleep while driving are not "bad habits" but symptoms with names — obstructive sleep apnoea and restless-legs syndrome among them — and all three warrant a doctor, not a blog. Insomnia that persists more than a few weeks is treatable with a specific therapy (CBT-I) that outperforms sleep aids long-term; asking a clinician for it is the evidence-based move.',
        ],
      },
    ],
    urgent: [
      'Falling asleep at the wheel or during work with machinery',
      'Loud snoring with breathing pauses witnessed by another person',
      'Insomnia lasting beyond a few weeks despite good habits',
    ],
    sources: [
      { t: 'U.S. CDC — About sleep', u: 'https://www.cdc.gov/heart-disease/about/about-healthy-living/sleep.html' },
      { t: 'NIH — Sleep deprivation', u: 'https://www.nhlbi.nih.gov/health/sleep-deprivation' },
      { t: 'NHS — Good night’s sleep', u: 'https://www.nhs.uk/live-well/sleep-and-tiredness/how-to-get-to-sleep/' },
    ],
  },
  {
    slug: 'hydration',
    icon: '💧',
    title: 'Water & Hydration',
    blurb: 'How much water the body actually needs, where the eight-glass rule came from, and why more is not always better.',
    lead: 'Water is roughly 60% of your body weight and the solvent every metabolic reaction runs in; the question of "how much to drink" has one honest answer for most people — enough that thirst and pale urine agree — and a lot of marketing in between.',
    facts: [
      ['Total daily water needs, men', '~3.7 litres (all beverages + food)', 'U.S. National Academies of Sciences'],
      ['Total daily water needs, women', '~2.7 litres (all beverages + food)', 'U.S. National Academies of Sciences'],
      ['Share coming from food', 'roughly 20%', 'National Academies report'],
      ['"8 glasses a day"', 'no solid primary study behind it', 'debunked in physiology reviews (e.g. Fenton & Goh, BMJ 2009)'],
      ['Practical status check', 'pale-yellow urine through the day', 'NHS/standard clinical guidance'],
    ],
    body: [
      {
        h: 'Where the number comes from — and why it includes your tea',
        ps: [
          'The National Academies figures above are total water: everything you drink, coffee and milk included, plus the roughly one-fifth that arrives with solid food. A healthy person’s thirst mechanism tracks this well — drinking when thirsty and checking that urine stays pale yellow covers ordinary life without counting. The famous eight glasses traces to a 1945 U.S. recommendation that was widely misquoted: the original text explicitly said the amount came largely from prepared food.',
        ],
      },
      {
        h: 'More is not better',
        ps: [
          'Overdrinking is a real, if rare, emergency: endurance athletes gulping plain water through hours of effort can dilute blood sodium to dangerous levels — hyponatraemia — which is why marathon guidance centres on drinking to thirst and using electrolyte drinks for long efforts, not maximum intake. For the sedentary, water-logging buys nothing either: skin "hydration" from extra litres is a myth dermatology does not support; kidneys simply pass the surplus.',
          'Hot weather, exercise, fever and altitude all raise the requirement, and the elderly feel thirst less reliably — the one group where a scheduled glass or two with each meal is sensible advice, and where the NHS and geriatric guidance both agree.',
        ],
      },
    ],
    urgent: [
      'Confusion, vomiting or seizure after a bout of very heavy plain-water drinking (possible low sodium — emergency)',
      'Inability to keep fluids down for a day, especially in small children and the elderly',
      'Dark urine with dizziness or fast heartbeat in hot weather',
    ],
    sources: [
      { t: 'U.S. National Academies water-intake guidance (summary)', u: 'https://www.ncbi.nlm.nih.gov/books/NBK585607/' },
      { t: 'BMJ 2009 — "Notes and comments" on the 8x8 myth', u: 'https://www.bmj.com/content/339/bmj.b3690' },
      { t: 'NHS — Drink and be healthy', u: 'https://www.nhs.uk/live-well/eat-well/food-guidelines-and-meal-plans/water-drinks/' },
    ],
  },
  {
    slug: 'steps',
    icon: '🚶',
    title: 'Daily Steps',
    blurb: 'What step counts actually do for health, the real origin of 10,000, and where the benefits stop rising.',
    lead: 'Walking is the most underrated polyclinic in the world: cheap, free, and studied at population scale. The step-count literature of the 2020s rewrote most of the folklore — in a direction that is good news for anyone without a fitness habit.',
    facts: [
      ['Where "10,000 steps" came from', 'a 1965 Japanese pedometer marketing name (Y-man-kei)', 'widely documented history; not a research finding'],
      ['All-cause risk reduction, adults', 'levels off around 7,000–8,000 steps/day', 'Paluch et al., The Lancet Public Health, 2021 meta-analysis'],
      ['Older adults (60+)', 'benefit plateau nearer 6,000–8,000', 'same pooled analyses'],
      ['A useful cadence', 'brisk enough that talking is possible but singing is not', 'standard public-health intensity guidance'],
    ],
    body: [
      {
        h: 'The number was a slogan; the science is kinder',
        ps: [
          'Ten thousand steps came from a pedometer company riding the 1964 Tokyo Olympics, not a cohort study. The 2020s meta-analyses — pooling hundreds of thousands of people tracked with accelerometers — found that the steepest drop in early-death risk happens between the sedentary few hundred steps and roughly seven to eight thousand a day, after which the curve flattens. Every step from the sofa counts most; nobody gets a bonus for the eleventh thousand beyond diminishing returns.',
          'One nuance the pooled studies agree on: total volume dominates, but bouts of brisk walking (the "talk test" intensity) carry extra cardiovascular signal in several cohorts. Two or three purposeful walks a week beat the same distance in slow meanders — while the meanders still matter.',
        ],
      },
      {
        h: 'What walking is doing down there',
        ps: [
          'The mechanisms are well described in the mainstream literature: regular ambulation improves insulin sensitivity, lowers blood pressure, supports bone density (it is weight-bearing), and moves the gut. The mental-health signal is real too — pooled exercise trials show walking producing meaningful improvements in depressive symptoms, which is why several national health services now "socially prescribe" walking groups. None of that makes walking a substitute for treatment; it makes it the floor most other improvements stand on.',
        ],
      },
    ],
    urgent: [
      'Chest pain or breathlessness that starts with exertion and stops with rest — see a doctor before starting any program',
      'A swollen, painful calf, especially with breathlessness (possible clot — urgent)',
      'Repeated falls or new gait problems, whatever the age',
    ],
    sources: [
      { t: 'The Lancet Public Health — Paluch et al. 2021 meta-analysis', u: 'https://www.thelancet.com/journals/lanpub/article/PIIS2468-2667(20)30261-3/fulltext' },
      { t: 'BMJ Open Sport & Exercise Medicine — history of the 10k myth', u: 'https://bmjopensem.bmj.com/content/6/1/ebm-2019-000672' },
      { t: 'NHS — Benefits of exercise for mental health', u: 'https://www.nhs.uk/mental-health/self-help/tips-and-strategies/use-exercise-to-look-after-your-mental-health/' },
    ],
  },
  {
    slug: 'heart-rate',
    icon: '❤️',
    title: 'Heart Rate',
    blurb: 'Normal resting ranges, what athletes’ low pulses mean, why 220-minus-age is a rough sketch, and which rhythms need a doctor.',
    lead: 'The pulse is the cheapest vital sign there is, and the one people most often worry about for no reason and, occasionally, for very good ones. Here is what the cardiology mainstream actually says about the numbers.',
    facts: [
      ['Normal adult resting range', '60–100 beats per minute', 'American Heart Association'],
      ['Well-trained endurance athletes', 'often 40–60 bpm, usually a sign of fitness', 'AHA / standard sports cardiology'],
      ['"220 − age" max-HR formula', 'a rough sketch, ±10–12 bpm per individual', 'original 1971 observation; limitations shown in later studies (e.g., Robergs 2012)'],
      ['Better field test for effort', 'the talk test: can speak a sentence, cannot sing', 'public-exercise guidance worldwide'],
    ],
    body: [
      {
        h: 'Lower is usually better at rest — up to a point',
        ps: [
          'Resting rate trends down with cardiovascular fitness (the heart moves more per beat, so it beats less), and population studies associate lower resting pulse — all else equal — with better long-term outcomes. That is why a marathoner at 48 bpm is a headline about fitness, not illness. The "all else equal" matters: a low rate only counts as benign when it comes with no symptoms. Dizziness, fainting or unusual fatigue alongside a slow pulse is a different conversation — with a clinician.',
          'Smartwatch numbers deserve one caveat the makers rarely print: optical wrist readings are good at rest and erratic in motion, and a single scary reading means far less than a trend. Anxiety about the ring is itself a well-documented inducer of the very palpitations it monitors.',
        ],
      },
      {
        h: 'The age formula is a drawing, not a blueprint',
        ps: [
          'The famous 220-minus-age estimate of maximum heart rate was never derived from data — it is a slide-rule approximation with a genuine spread of ±10 or 12 beats. Later formulas (such as 207 − 0.7 × age from a University of Florida study) track populations slightly better, but individual maxima vary enough that coaches lean on feel: the talk test separates easy from moderate; being unable to say more than a few words marks hard. For anyone with known heart disease planning vigorous exercise, a physician’s clearance beats any formula.',
        ],
      },
    ],
    urgent: [
      'Chest pressure/pain with a racing or irregular pulse',
      'Fainting or near-fainting, especially during exercise',
      'A resting pulse persistently above ~100 or below ~50 with symptoms (light-headedness, fatigue)',
    ],
    sources: [
      { t: 'American Heart Association — Measuring heart rate', u: 'https://www.heart.org/en/healthy-living/fitness/fitness-basics/heart-rate-types-and-what-your-resting-rate-means' },
      { t: 'Robergs & Landwergh 2012 — history of the 220−age formula', u: 'https://www.tandfonline.com/doi/abs/10.1080/00146620.2011.638325' },
    ],
  },
  {
    slug: 'breathing',
    icon: '🌬️',
    title: 'Breathing',
    blurb: 'The normal rate, the physiology behind slow-breathing techniques, and the one type of sigh with actual research behind it.',
    lead: 'Breathing runs itself — until stress, illness or a panic attack makes it suddenly manual. The physiology of why slow breathing calms the nervous system is better understood than most wellness copy admits, and it is genuinely interesting.',
    facts: [
      ['Normal adult respiratory rate', '12–20 breaths per minute at rest', 'MedlinePlus (NIH/NLM); standard clinical vitals'],
      ['Paced-breathing studies often use', 'around 6 breaths per minute', 'frequency common in the blood-pressure and HRV literature'],
      ['Effect on blood pressure', 'modest average reductions with regular practice', 'multiple meta-analyses of slow-paced breathing'],
      ['The physiological sigh', 'double inhale then long exhale; studied at Stanford, 2023', 'Balban et al., Cell Reports Medicine'],
    ],
    body: [
      {
        h: 'Why "calm down and breathe" is physiology, not platitude',
        ps: [
          'The autonomic nervous system lets breathing bidirectionally modulate arousal: a long exhale is when parasympathetic (vagal) tone to the heart rises and heart rate dips — the respiratory-cardiac coupling that every slow-breathing protocol rides on. Studies that run people at roughly six breaths a minute for ten to fifteen minutes find small but repeatable reductions in blood pressure and self-reported stress; it is the cheapest validated relaxation tool there is, which is why clinicians from anaesthetists to sports teams use it. Box breathing (4-4-4-4) and 4-7-8 are simply choreographies for the same mechanism.',
          'A 2023 Stanford randomised trial (Balban et al., Cell Reports Medicine) found that daily five-minute cycles of "breathing exercises" — built around the physiological sigh, a double inhale through the nose followed by a long exhale — improved mood and lowered resting respiratory rate more than matched mindfulness meditation. The sigh mechanism is well described in respiratory physiology: the second quick inhale re-opens collapsed alveoli, and the long exhale empties them fully, off-loading CO₂ efficiently.',
        ],
      },
      {
        h: 'Hyperventilation and panic — the loop worth knowing',
        ps: [
          'During a panic attack breathing outruns the body’s actual gas needs, CO₂ falls, and the resulting tingling, chest tightness and giddiness feed the panic further. The interruption that works is mechanical: slow the rate, lengthen the exhale, expect the odd sensation to fade within a minute as CO₂ recovers. That explanation is worth knowing before it is needed — reading about the loop in calm hours is a small piece of fire-drill for the storm hours.',
        ],
      },
    ],
    urgent: [
      'Shortness of breath at rest, or new breathlessness on stairs',
      'Blue-tinged lips, wheeze that will not settle, or breathing pulling the ribs visible',
      'Any difficulty breathing in a child with fever — children decompensate faster than adults',
    ],
    sources: [
      { t: 'MedlinePlus (NIH/NLM) — Respiration rate', u: 'https://medlineplus.gov/ency/article/000074.htm' },
      { t: 'Balban et al. 2023, Cell Reports Medicine — brief structured breathing exercises', u: 'https://www.cell.com/cell-reports-medicine/fulltext/S2666-3791(23)00057-X' },
    ],
  },
  {
    slug: 'temperature',
    icon: '🌡️',
    title: 'Body Temperature',
    blurb: 'The real normal range, why 98.6 °F is a museum piece, and what fever is doing for you instead of to you.',
    lead: 'Fever is the number parents fear and doctors watch, because it is not the illness — it is the immune system turning the thermostat up on purpose. The history of the "normal" temperature is a better story than most medicine pages admit.',
    facts: [
      ['Classical "normal"', '37.0 °C / 98.6 °F', 'Carl Wunderlich, 1868 — measured in pre-thermometer-era patients'],
      ['Modern measured average', 'around 36.4–36.6 °C (97.6–97.9 °F)', 'Stanford study of 20th-century body-temperature data; JAMA 2023 analyses'],
      ['Fever threshold (oral)', '38.0 °C / 100.4 °F', 'standard clinical definition'],
      ['Normal daily swing', 'lowest ~4 a.m., highest late afternoon, by ~0.5 °C', 'circadian physiology, standard references'],
    ],
    body: [
      {
        h: '98.6 is a rounding artefact from 1868',
        ps: [
          'German physician Carl Wunderlich built the 37 °C standard from readings of tens of thousands of armpit temperatures in Civil-War-era conditions; researchers re-examining modern datasets (a Stanford analysis of three historical cohorts, and work published in JAMA) consistently find today’s average about half a degree Fahrenheit lower than his number. Add the circadian swing — dawn lows, dusk highs, plus half a degree after exercise, meals or a warm room — and "normal" is a range, not a digit. Thermometer type matters too: rectal runs highest, oral middle, tympanic/axillary lower; comparisons should stay within one method.',
        ],
      },
      {
        h: 'What fever is for',
        ps: [
          'Pyrogens reset the hypothalamic thermostat during infection; lab studies show elevated temperature hampers microbial replication and accelerates immune-cell trafficking, which is why many clinicians treat a comfortable adult fever as a friend to hydrate around rather than a number to erase. The honest exceptions are age-based: for infants under three months any fever (≥38 °C) is an urgent medical assessment, not a wait-and-see, and in adults a fever at or above ~39.4 °C / 103 °F, or any fever lasting several days, deserves a clinician’s opinion regardless of how brave the person feels.',
        ],
      },
    ],
    urgent: [
      'Any temperature ≥38 °C in an infant under 3 months — same-day medical assessment',
      'Adult fever ≥39.4 °C / 103 °F, or fever lasting more than about three days',
      'Fever with stiff neck, confusion, a spreading rash, or sensitivity to light (emergency)',
    ],
    sources: [
      { t: 'JAMA Internal Medicine 2023 — “A History of the Normal Human Body Temperature”', u: 'https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2800862' },
      { t: 'NHS — Temperature, high temperature and fever in adults', u: 'https://www.nhs.uk/symptoms/fever-in-adults/' },
      { t: 'MedlinePlus — Fever', u: 'https://medlineplus.gov/ency/article/003090.htm' },
    ],
  },
];

function findTopic(slug) {
  return TOPICS.find((t) => t.slug === String(slug || '').toLowerCase()) || null;
}

module.exports = { TOPICS, findTopic };
