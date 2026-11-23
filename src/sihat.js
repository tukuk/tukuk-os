'use strict';
// ── TUKUK-OS /health — everyday-body explainers ──
// Deliberately modest: a dozen topics about ordinary human physiology (sleep, water, steps, pulse,
// breathing, temperature, eyes, teeth, headaches, allergies, sitting, colds), each written to one rule — state only numbers that established health
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
  {
    slug: 'eyes',
    icon: '👁️',
    title: 'Eyes & Screens',
    blurb: 'Why screens make eyes tired, what the 20-20-20 rule is for, the myopia surge, and which eye symptoms are emergencies.',
    lead: 'Screens have not created an epidemic of damaged eyes — they have created an epidemic of tired ones. The difference matters, because the fix for fatigue is cheap and the warning signs of real eye disease are unmistakable.',
    facts: [
      ['Digital eye strain', 'survey estimates run as high as ~90% of heavy screen users, symptoms are temporary', 'optometric surveys; American Academy of Ophthalmology commentary'],
      ['The 20-20-20 rule', 'every 20 minutes, look 20 feet (6 m) away for 20 seconds', 'American Academy of Ophthalmology recommendation'],
      ['Myopia (nearsightedness) rise', 'projected to affect ~half the world by 2050', 'Holden et al., Optometry and Vision Science, 2016 global projection'],
      ['Childhood outdoor time', '2+ hours of daylight outdoors a week is associated with fewer children becoming nearsighted', 'cohort studies (e.g. Guangzhou outdoor trial); evidence still accumulating'],
      ['Blue-light glasses', 'no good evidence they prevent eye disease or strain', 'AAO position statement — the discomfort is reduced blinking, not blue light'],
    ],
    body: [
      {
        h: 'What screen fatigue actually is',
        ps: [
          'Staring at a close target for hours does two things: the focusing muscle holds one length and gets cramped, and blink rate falls by roughly half or more, so the tear film dries. The result — sore, gritty, blurry-but-transient eyes — is digital eye strain, and it is uncomfortable rather than damaging. The AAO is blunt that blue light from screens is not the culprit and blue-blocking glasses are unnecessary; the 20-20-20 rule works precisely because it interrupts both mechanisms at once: distance relaxes the focus, and the pause lets blinks happen.',
        ],
      },
      {
        h: 'The myopia question is different — and real',
        ps: [
          'Nearsightedness is genuinely rising, fastest in East Asian cities, and the leading environmental candidate is not screens per se but time outdoors: bright daylight appears to trigger retinal dopamine release that keeps the growing eyeball from lengthening (excess length is myopia). Studies randomising children to extra outdoor hours found fewer new cases, while reading near-work shows a weaker association than folklore assumes. The practical advice stacks up to the same place: hard breaks from close work for everyone, and real outdoor daylight for growing eyes.',
        ],
      },
    ],
    urgent: [
      'Sudden loss of vision, a curtain across the view, or a shower of new floaters with flashes (retinal tear/detachment — same-day emergency)',
      'Severe eye pain, a fixed dilated pupil with halos and nausea (acute glaucoma — emergency)',
      'Any chemical splash — irrigate immediately with water on the way to care, never wait',
    ],
    sources: [
      { t: 'American Academy of Ophthalmology — Computer eyes / myopia', u: 'https://www.aao.org/eye-health' },
      { t: 'Holden et al. 2016 — Global myopia projections, Optometry and Vision Science', u: 'https://pubmed.ncbi.nlm.nih.gov/27479290/' },
      { t: 'CDC — Healthy vision', u: 'https://www.cdc.gov/healthy-vision/' },
    ],
  },
  {
    slug: 'teeth',
    icon: '🦷',
    title: 'Teeth & Gums',
    blurb: 'Why brushing twice beats brushing hard, where fluoride earns its place, the sugar-frequency effect, and the dental signs that mean today, not next month.',
    lead: 'Tooth decay is the most common disease humans get, and almost all of its prevention fits on a toothpaste tube: fluoride, twice a day, and a dentist before anything hurts.',
    facts: [
      ['Brushing', 'twice a day with fluoride toothpaste', 'NHS & American Dental Association'],
      ['Spit, do not rinse', 'the NHS’s deliberate oddity: rinsing washes the fluoride away', 'NHS oral-health guidance'],
      ['Untreated decay worldwide', 'affects roughly half of all people (carries and gum disease combined)', 'WHO global oral-health estimates / Global Burden of Disease'],
      ['Sugar timing', 'how often sugar appears matters more than the total amount', 'standard dental-carious biology (NHS/ADA)'],
      ['Interdental cleaning', 'once a day between the teeth — brush misses ~40% of tooth surfaces', 'ADA; NHS'],
    ],
    body: [
      {
        h: 'The mechanics of a quiet miracle',
        ps: [
          'Cavity formation is a race between acid (made by plaque bacteria feeding on free sugars) and repair (saliva, helped by fluoride, re-hardening the softened enamel). Fluoride wins the race unfairly well — it incorporates into the reforming crystal and makes it more acid-resistant than the original — which is why health agencies from the NHS to the WHO count community water fluoridation and fluoride toothpaste among the most effective public-health measures ever deployed. The spitting-not-rinsing advice follows the same logic: leave the toothpaste’s fluoride on the surface instead of washing it down the sink.',
          'Frequency beats quantity with sugar because every exposure starts another acid attack that saliva needs 20-30 minutes to neutralise; sipping a soft drink all afternoon keeps the enamel under continuous siege in a way one sit-down dessert does not. The same is true of snacking, which is one real argument for the three-meals-and-water-between shape of traditional advice.',
        ],
      },
      {
        h: 'What a dentist catches that you cannot feel',
        ps: [
          'Enamel has no nerves, so decay is painless until it is deep — by the time a tooth hurts, the cavity has usually reached the pulp, and the treatment ladder jumps from filling to root canal to extraction. Gum disease creeps the same way: bleeding gums are the classic early sign and respond to cleaning, while the advanced form quietly destroys the bone that holds teeth in the jaw, and population studies link it to higher risks elsewhere. A routine check-up exists to find both while they are still boring.',
        ],
      },
    ],
    urgent: [
      'Facial or jaw swelling with fever — a dental infection spreading, dangerous and needs same-day care',
      'A knocked-out permanent tooth: find it, hold it by the crown, keep it in milk, to a dentist within the hour',
      'Bleeding after an extraction that will not stop with an hour of firm gauze pressure',
    ],
    sources: [
      { t: 'NHS — Brushing your teeth', u: 'https://www.nhs.uk/live-well/healthy-teeth-and-gums/how-to-keep-your-teeth-clean/' },
      { t: 'WHO — Oral health fact sheet', u: 'https://www.who.int/news-room/fact-sheets/detail/oral-health' },
      { t: 'NIDCR (NIH) — Consumer health: tooth decay', u: 'https://www.nidcr.nih.gov/health-info/tooth-decay' },
    ],
  },
  {
    slug: 'headache',
    icon: '🤕',
    title: 'Headaches',
    blurb: 'Tension, migraine and cluster told apart, the painkiller trap that creates its own headaches, and the sudden-onset headache that is an emergency.',
    lead: 'Almost everyone gets headaches, and almost all of them are benign — but headache is the one symptom where the story of how it starts tells a clinician everything, so it pays to know which patterns are ordinary and which are not.',
    facts: [
      ['Tension-type headache', 'the most common kind: pressing, both sides, not worsened by routine activity', 'International Headache Society / NIH NINDS classification'],
      ['Migraine', 'throbbing, often one-sided, with light and sound sensitivity; ~1 in 4 US households affected', 'Lipton et al., Neurology 2001 (US prevalence); NINDS'],
      ['Medication-overuse headache', 'regular painkiller use several days a week can itself cause daily headache', 'IHS classification; NHS guidance'],
      ['Thunderclap onset', 'a headache peaking within seconds is treated as an emergency until scanned', 'standard clinical guidance (e.g. NHS/AHA)'],
    ],
    body: [
      {
        h: 'Three ordinary patterns worth recognising',
        ps: [
          'Tension headache is the band of pressure after a long day — muscle and stress mechanisms, responsive to water, food, rest and an occasional painkiller. Migraine is a nervous-system event, not merely a strong headache: hours to days of throbbing, nausea, and lights turned uncomfortably bright, sometimes preceded by aura — flickers, zigzags or temporary blind spots that are cortical spreading depression, a wave of electrical change crossing the visual cortex. Cluster headache is the rare, savage one: strictly one-sided, around one eye, in bouts of weekly daily attacks with tearing and a blocked nostril, and it demands a doctor’s eyes because the treatments are specific.',
          'Caffeine plays a double role that surprises people: it helps some attacks (it is in several combination headache medicines) and its daily use maintains the medication-overuse cycle — headache coming back as the previous dose wears off, answered by another dose. Breaking that loop under medical guidance is one of the most reliably satisfying moves in headache medicine.',
        ],
      },
      {
        h: 'The part that is genuinely about safety',
        ps: [
          'Headache is almost always the body being noisy rather than dangerous, which is exactly why the emergency patterns stand out: maximal intensity in seconds (thunderclap — bleeding around the brain must be excluded), headache with fever and a stiff neck (infection), headache with new weakness, numbness, speech change or vision loss, headache after a head injury, and a brand-new persistent headache starting after about 50 or during pregnancy. Any of these is not a “wait and see” — same-day assessment is the correct move, and people with known headache patterns are advised to learn their usual so that unusual is unmistakable.',
        ],
      },
    ],
    urgent: [
      'A thunderclap headache — worst-ever, peaking within seconds (emergency)',
      'Headache with fever, stiff neck and confusion or light intolerance (emergency)',
      'Headache with weakness, numbness, slurred speech or vision loss; any head-injury headache that worsens',
    ],
    sources: [
      { t: 'NIH NINDS — Headache information page', u: 'https://www.ninds.nih.gov/health-information/disorders/headache' },
      { t: 'NHS — Headaches', u: 'https://www.nhs.uk/symptoms/headaches/' },
      { t: 'Lipton et al. 2001 — Migraine prevalence, Neurology (via PubMed)', u: 'https://pubmed.ncbi.nlm.nih.gov/11756683/' },
    ],
  },
  {
    slug: 'allergies',
    icon: '🤧',
    title: 'Allergies',
    blurb: 'What the immune system is doing when it sneezes at pollen, why antihistamines make some people sleepy, and the one allergic reaction that outranks the pharmacy.',
    lead: 'An allergy is an immune system solving the wrong problem — mounting a defence against pollen, peanut protein or dust mites as though they were parasites. Understanding the mechanism explains both the everyday misery and the rare emergency.',
    facts: [
      ['Allergic disease is common', 'roughly one in four people worldwide affected at some time', 'AAFA/CDC; often quoted near 30% (WAO)'],
      ['Histamine', 'the chemical behind the swelling, itching and mucus; antihistamines block its receptor', 'NIAID — standard mechanism'],
      ['Hay fever follows the calendar', 'tree, grass and weed pollen seasons drive the symptom calendar in temperate countries', 'NHS; national pollen forecast services'],
      ['Anaphylaxis', 'whole-body allergic reaction; adrenaline (epinephrine) first, ambulance second', 'NIAID/standard anaphylaxis guidance'],
    ],
    body: [
      {
        h: 'The misfire, and the medicine that interrupts it',
        ps: [
          'In a sensitised person, re-encountering an allergen cross-links IgE antibodies sitting on mast cells, which dump histamine and relatives: blood vessels dilate and leak (the stuffy nose, the swollen lid), itch nerves fire, smooth muscle can tighten. First-generation antihistamines calm all of this and also cross into the brain, which is why they cause drowsiness; the newer ones (cetirizine, loratadine, fexofenadine) largely spare the brain and are why “antihistamine” stopped meaning “sleeping pill”. Nasal steroid sprays work on a slower clock — they quiet the inflammation itself and are the most effective single hay-fever treatment when started early in season, a point repeated by every allergy body.',
          'The hygiene hypothesis is the interesting open question of why allergies rose as infections fell: the leading versions say a microbiome trained by dirt, animals and older siblings calibrates the immune system’s thresholds. It is genuinely unresolved — but the practical studies of farm exposure and early food introduction keep finding that timing and environment matter more than parents expect.',
        ],
      },
      {
        h: 'When allergy stops being a sneeze',
        ps: [
          'Anaphylaxis is the same misfire aimed at the whole body: throat or tongue swelling, hoarse voice, wheeze, a drop in blood pressure, sometimes after one sting or one bite minutes earlier. It is rare and it is rapidly treatable — adrenaline from an auto-injector works within minutes and every allergy guideline is emphatic that antihistamines are not first-line for it, because they act too slowly on the airway and the blood pressure. Anyone who has ever had a whole-body reaction should have that conversation with a clinician about carrying an injector, not a repeat dose of tablets.',
        ],
      },
    ],
    urgent: [
      'Swelling of lips/tongue/throat, hoarse voice, or any breathing or swallowing trouble after exposure — adrenaline and emergency help immediately',
      'Spread of hives with dizziness or faintness after a sting or food (anaphylaxis pattern)',
      'Asthma-like wheeze after allergen exposure that does not settle quickly with usual reliever treatment',
    ],
    sources: [
      { t: 'NIAID (NIH) — Allergies', u: 'https://www.niaid.nih.gov/research/allergies' },
      { t: 'NHS — Allergies', u: 'https://www.nhs.uk/conditions/allergies/' },
      { t: 'CDC — Fast facts: allergies', u: 'https://www.cdc.gov/nchs/fastats/allergies.htm' },
    ],
  },
  {
    slug: 'sitting',
    icon: '🪑',
    title: 'Sitting & Standing',
    blurb: 'What “sitting is the new smoking” actually meant, the honest evidence about posture and back pain, and the intervention that does work.',
    lead: 'The research on sitting got a famous slogan it never wrote, and the posture advice sold in its place got more confidence than the evidence supports. The honest version is less dramatic and more actionable.',
    facts: [
      ['The origin of the slogan', 'a 2012 Lancet column quoting observational studies on sitting time and mortality — not a causal proof', 'van der Ploeg et al., Lancet 2012 (the actual quote predates it and is debated)'],
      ['Long sitting time, observational data', 'high daily sitting associates with modestly higher all-cause mortality in pooled cohorts', 'van Eerdewijk et al. / meta-analyses of sitting-time cohort studies; causation not established'],
      ['“Perfect posture”', 'no single sitting posture is proven to prevent pain; comfort and movement matter more', 'reviews of posture and low-back pain (e.g. Smith et al., J Orthop Sports Phys Ther 2018)'],
      ['What does help', 'breaking up sitting with short activity; overall physical activity (see Daily Steps)', 'physical-activity guideline bodies incl. WHO & NHS'],
    ],
    body: [
      {
        h: 'The slogan, and what the studies actually showed',
        ps: [
          'The epidemiology is real but observational: people who report many sitting hours show modestly higher mortality in pooled analyses, and sitting is also a proxy for overall inactivity, poor sleep and snack access — all of which travel together. The strongest honest statement is that long unbroken sitting is worth interrupting, not that a chair causes disease the way a pathogen does. The posture industry then promises that the right alignment prevents pain; the reviews of posture and low-back pain are strikingly lukewarm — habitual slouching correlates weakly at best with aching backs, and the office worker with perfect upright posture is not protected by it.',
        ],
      },
      {
        h: 'The intervention that survives the debunking',
        ps: [
          'Discomfort from a desk day is usually tissue load held static — the same muscles, discs and joints under unchanged low load for hours — and the reliable relief is change: stand, walk, shift, do a different thing, even briefly. Sit-stand reviews find modest comfort and productivity gains at best, but pain specialists and physiotherapists agree on the movement principle because backs are built for varying work, not for any particular position held for eight hours. Layer on the general activity every guideline body recommends — see Daily Steps for what the walking literature actually finds — and the sitting question shrinks into a simple rule: more positions, more movement, less drama.',
        ],
      },
    ],
    urgent: [
      'Back or leg pain with new numbness around the saddle area, or trouble controlling bladder/bowels (cauda equina — emergency, same-day surgery assessment)',
      'Leg weakness or foot drop developing alongside back pain',
      'Pain after significant trauma, or unexplained back pain with fever and weight loss',
    ],
    sources: [
      { t: 'Lancet 2012 — “Sitting: the new smoking?” correspondence', u: 'https://pubmed.ncbi.nlm.nih.gov/22342219/' },
      { t: 'WHO — Guidelines on physical activity and sedentary behaviour', u: 'https://www.who.int/publications/i/item/9789240015128' },
      { t: 'NHS — Back pain (self-care)', u: 'https://www.nhs.uk/conditions/back-pain/' },
    ],
  },
  {
    slug: 'cold',
    icon: '🤒',
    title: 'The Common Cold',
    blurb: 'Why there are hundreds of colds instead of one, what genuinely shortens one (a little), and the days-of-illness pattern that means it was never a cold.',
    lead: 'The common cold is the most successful virus family in human history: over 200 strains, immunity to each one partial, transmission on hands and air. Everything about managing it follows from that — including why nothing cures it.',
    facts: [
      ['How many colds', 'adults average 2–4 a year, children 6–8; more strains than any single immunity covers', 'NHS / CDC common-cold guidance'],
      ['Duration', 'typically 7–10 days; the cough can linger 2–3 weeks after the rest fades', 'NHS — common cold'],
      ['Antibiotics', 'colds are viral — antibiotics do nothing for them and carry real downsides', 'CDC “antibiotics only treat bacteria” campaign'],
      ['Zinc lozenges', 'started within 24 hours may shave about a day off the duration; pooled trials are mixed and nausea is common', 'Cochrane review 2013 (Singh & Lannon); later updates disputed'],
      ['Vitamin C', 'regular supplementation does not prevent colds in the general population', 'Cochrane review (Hemilä & Chalker)'],
    ],
    body: [
      {
        h: 'Why there is no cure and no vaccine',
        ps: [
          'Rhinoviruses alone number over 150 types, and the coronaviruses, RSV, adenoviruses and parainfluenzae that also cause “colds” each evade the same trick: immunity to one strain barely covers the next, and the virus replays itself in the nose where antibody levels run thin anyway. That is why a cold vaccine is a math problem with too many variables, and why the honest pharmacy advice is symptom relief: fluids, rest, simple painkillers for the aching days, saline and steam for the blocked nose. Honey calfs the night cough in children over one (an NHS-quoted trial result worth knowing), and the zinc-and-vitamin-C folklore above is precisely that — a day or maybe less, at best, when trials agree at all.',
        ],
      },
      {
        h: 'The calendar that tells you what this actually is',
        ps: [
          'The usual cold asks for about a week and improves on schedule. Symptoms that run past two weeks, or crash and then flare again with new fever and facial pain, are following the classic shape of a bacterial sinus or chest infection layered onto the viral start — that pattern deserves a clinician, and it is the same logic behind “better, then worse” guidance the NHS prints for every respiratory page. Breathing difficulty, chest pain, high sustained fever, ear pain in a child, or a cold that tips into wheeze belong to other conversations with faster appointments, and in infants, the elderly and the immunosuppressed the threshold for calling a doctor is deliberately low.',
        ],
      },
    ],
    urgent: [
      'Difficulty breathing, wheeze that does not settle, or chest pain',
      'Fever lasting beyond three days, or any fever in an infant under 3 months (see Body Temperature)',
      'Symptoms that improve then return with new fever and facial or ear pain — secondary infection pattern',
    ],
    sources: [
      { t: 'CDC — Common cold', u: 'https://www.cdc.gov/respiratory-infections/about/common-cold/index.html' },
      { t: 'NHS — Cold, flu and other common infections', u: 'https://www.nhs.uk/conditions/colds-and-flu/' },
      { t: 'Cochrane 2013 — Zinc for the common cold (via PubMed)', u: 'https://pubmed.ncbi.nlm.nih.gov/23633700/' },
    ],
  },
];

function findTopic(slug) {
  return TOPICS.find((t) => t.slug === String(slug || '').toLowerCase()) || null;
}

module.exports = { TOPICS, findTopic };
