'use strict';
// ── KOMPLEKS ILMU (study.js) — data kurasi untuk hab /study ──────────────────
// Prinsip: sumber percuma & self-contained (tiada API berbayar), kandungan
// Bahasa Inggeris global (dasar SEO situs), dan semua fakta telah semak.
// Pick harian adalah deterministik (daun tarikh) — stabil untuk pembaca & cache.

// PRNG mulberry32 — seeded, supaya kuiz & susunan tidak berubah dalam sehari.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayIndex(d) {
  const x = d || new Date();
  return Math.floor(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) / 86400000);
}

function pickDaily(list, seed) {
  if (!list || !list.length) return null;
  return list[(seed || dayIndex()) % list.length];
}

// Shuffle deterministik (Fisher-Yates dengan PRNG berseed).
function shuffleSeeded(arr, seed) {
  const rnd = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

// —── FAKTA — ringkas, boleh disemak, bertopik. —──────────────────────────────
const FACTS = [
  { t: 'Space', s: 'A day on Venus is longer than its year: it spins once every 243 Earth days while orbiting the Sun in 225.' },
  { t: 'Space', s: 'Neutron stars are so dense that a sugar-cube-sized piece of one would weigh about a billion tonnes on Earth.' },
  { t: 'Space', s: 'Saturn\'s average density is lower than water\'s — in a big enough ocean, the planet would float.' },
  { t: 'Space', s: 'Sunlight takes about 8 minutes 20 seconds to reach Earth, but only about 4 seconds to reach Jupiter.' },
  { t: 'Space', s: 'There are more trees on Earth (about 3 trillion) than stars in the Milky Way (100–400 billion).' },
  { t: 'Space', s: 'The footprints astronauts left on the Moon in 1969 will likely remain for millions of years — there is no wind or water to erase them.' },
  { t: 'Earth', s: 'The deepest point in the ocean, Challenger Deep, is about 10,935 m — Mount Everest could sit there with over 2 km of water above it.' },
  { t: 'Earth', s: 'About 95% of the world\'s earthquakes happen along the edges of the Pacific plate, the ring of fire.' },
  { t: 'Earth', s: 'A single lightning bolt can heat the air around it to roughly 30,000 °C — about five times hotter than the Sun\'s surface.' },
  { t: 'Earth', s: 'Rivers carry about 11 billion tonnes of sediment into the sea every year, slowly rebuilding coastlines.' },
  { t: 'Earth', s: 'Antarctica holds about 60% of the world\'s fresh water, locked in ice up to 4 km thick.' },
  { t: 'Life', s: 'An octopus has three hearts, eight arms and blue copper-based blood.' },
  { t: 'Life', s: 'Honey does not spoil: sealed jars found in 3,000-year-old Egyptian tombs were still edible.' },
  { t: 'Life', s: 'A blue whale\'s tongue can weigh as much as an elephant, and its heart can be heard from 3 km away in water.' },
  { t: 'Life', s: 'Trees can communicate and share nutrients through underground fungal networks scientists call the wood-wide web.' },
  { t: 'Life', s: 'Sharks existed before trees: the oldest shark fossils are about 450 million years old, trees appear in the record around 350 million.' },
  { t: 'Life', s: 'Bananas are slightly radioactive because of naturally occurring potassium-40 — nowhere near enough to harm you.' },
  { t: 'Body', s: 'Your body makes about 25 billion new red blood cells every day, each living roughly 120 days.' },
  { t: 'Body', s: 'The human nose can distinguish over a trillion different smells, according to a 2014 Science study.' },
  { t: 'Body', s: 'Stomach acid is strong enough to dissolve metal; the stomach lining renews itself constantly to survive it.' },
  { t: 'Body', s: 'You are about 1 cm taller in the morning — spinal discs compress through the day as you stand.' },
  { t: 'Body', s: 'The brain uses about 20% of the body\'s energy despite being only 2% of its weight.' },
  { t: 'History', s: 'The Ottoman Empire lasted over 600 years (1299–1922) — longer than the Roman Empire in the west lasted.' },
  { t: 'History', s: 'Oxford University is older than the Aztec Empire: teaching began at Oxford by 1096, Tenochtitlan was founded in 1325.' },
  { t: 'History', s: 'The last public execution by guillotine in France was in 1977 — the death penalty itself ended there in 1981.' },
  { t: 'History', s: 'Cleopatra lived closer in time to the first Moon landing than to the building of the Great Pyramid of Giza.' },
  { t: 'History', s: 'Iceland\'s parliament, the Althing, founded in 930 AD, is one of the oldest surviving parliaments on Earth.' },
  { t: 'Geography', s: 'Russia spans 11 time zones — more than any other country; it takes a full day to cross by train from Kaliningrad to Vladivostok.' },
  { t: 'Geography', s: 'Canada has more lakes than the rest of the world combined — over 2 million of them.' },
  { t: 'Geography', s: 'The distance from London to New York is greater than from New York to the North Pole.' },
  { t: 'Geography', s: 'Africa is roughly three times the size of Greenland, yet flat maps make them look similar — that is the Mercator projection trick.' },
  { t: 'Geography', s: 'Chile is about 4,300 km long but averages under 180 km wide — the longest north-south country on Earth.' },
  { t: 'Math', s: 'Zero as a number was formalised in India by the 7th century; Brahmagupta gave rules for computing with it in 628 AD.' },
  { t: 'Math', s: 'There are more ways to shuffle a deck of 52 cards (52! ≈ 8×10^67) than seconds the Earth has existed.' },
  { t: 'Math', s: 'The Pythagorean theorem was known to Babylonian scribes over a thousand years before Pythagoras was born.' },
  { t: 'Math', s: 'A pizza slice is mathematically a sector, and doubling a pizza\'s radius quadruples its area — size maths matters on the menu.' },
  { t: 'Math', s: 'The 1976 Four Colour Theorem was the major proof finished by computer — every map needs at most four colours.' },
  { t: 'Human world', s: 'About 7,000 living languages are spoken today; roughly 40% are endangered, most of them small Indigenous tongues.' },
  { t: 'Human world', s: 'The Great Wall of China is not one wall but many walls built over 2,000 years, totalling over 20,000 km of sections.' },
  { t: 'Human world', s: 'Mount Everest grows about 4 mm taller every year because the Indian plate still pushes into Asia.' },
  { t: 'Human world', s: 'Paper was invented in China during the Han dynasty, roughly 2,000 years before it reached Western Europe.' },
  { t: 'Human world', s: 'The internal-combustion engine did not beat the horse overnight: cars only passed horses as the main US transport around 1915.' },
];

// —── TEKA-TEKI (riddles) — teka-teki klasik domain awam. —────────────────────
const RIDDLES = [
  { q: 'The more of this there is, the less you see. What is it?', a: 'Darkness.' },
  { q: 'What has to be broken before you can use it?', a: 'An egg.' },
  { q: 'I\'m light as a feather, yet the strongest person can\'t hold me for more than five minutes. What am I?', a: 'Your breath.' },
  { q: 'What has many keys but can\'t open a single lock?', a: 'A piano.' },
  { q: 'What can travel around the world while staying in a corner?', a: 'A stamp.' },
  { q: 'What has a head and a tail but no body?', a: 'A coin.' },
  { q: 'The person who makes it, sells it. The person who buys it never uses it. The person who uses it doesn\'t know. What is it?', a: 'A coffin.' },
  { q: 'What goes up but never comes down?', a: 'Your age.' },
  { q: 'What has words but never speaks?', a: 'A book.' },
  { q: 'What runs but never walks, has a mouth but never talks?', a: 'A river.' },
  { q: 'What can fill a room but takes up no space?', a: 'Light.' },
  { q: 'If you drop me I\'m sure to crack, but give me a smile and I\'ll always smile back. What am I?', a: 'A mirror.' },
  { q: 'What has hands but can\'t clap?', a: 'A clock.' },
  { q: 'What has eyes but cannot see?', a: 'A potato.' },
  { q: 'What comes once in a minute, twice in a moment, but never in a thousand years?', a: 'The letter M.' },
  { q: 'What gets wetter the more it dries?', a: 'A towel.' },
  { q: 'What can\'t be used until you break it?', a: 'An egg — or a glow stick.' },
  { q: 'What has a neck but no head?', a: 'A bottle.' },
  { q: 'What belongs to you but is used more by others?', a: 'Your name.' },
  { q: 'The more you take, the more you leave behind. What are they?', a: 'Footsteps.' },
  { q: 'What can go through a glass window without making a hole in it?', a: 'Light.' },
  { q: 'What has one foot but can\'t stand up?', a: 'A stool (the furniture kind).'},
  { q: 'What question can you answer "yes" to but never "no" to — seriously?', a: '"Do you smell something burning?" — answer "no" and run.' },
  { q: 'What can you hold without ever touching with your hands?', a: 'A conversation.' },
  { q: 'What has legs but cannot walk?', a: 'A table.' },
  { q: 'What can you break even though it never falls, and it never rises?', a: 'A record? No — a promise.' },
  { q: 'What is full of holes but still holds water?', a: 'A sponge.' },
  { q: 'What goes up and down but doesn\'t move?', a: 'A staircase.' },
  { q: 'What has a thumb and four fingers but is not alive?', a: 'A glove.' },
  { q: 'If you have it you want to share it; if you share it you don\'t have it. What is it?', a: 'A secret.' },
  { q: 'What is so fragile that saying its name breaks it?', a: 'Silence.' },
  { q: 'What can\'t be seen even though it is right in front of you every day?', a: 'Your face — without a mirror.' },
  { q: 'What grows only downwards?', a: 'A tree\'s roots (and your age\'s mirror twin: time gone by).'},
  { q: 'Who makes it has no need for it; who buys it doesn\'t use it; who uses it doesn\'t know it?', a: 'A coffin — the classic of classics.' },
  { q: 'What can you put in a barrel to make it lighter?', a: 'Holes.' },
  { q: 'What arrives but never stays; what is always new but always expected?', a: 'Tomorrow.' },
];

// —── EKSPERIMEN — selamat, bahan rumah, tiada api terbuka/bahan kimia bahaya. —
const EXPERIMENTS = [
  { name: 'Density tower', time: '20 min', level: 'easy',
    materials: 'Honey, dish soap, water, vegetable oil, rubbing alcohol (adult to handle), a tall clear glass, food colouring (optional).',
    steps: ['Pour each liquid slowly down the side of the glass, one at a time, in this order: honey, soap, water, oil, alcohol.', 'Watch the layers settle without mixing.', 'Drop in a grape and a coin — they stop at different heights.'],
    why: 'Liquids stack by density: the heaviest per volume sinks to the bottom. Objects float on the first liquid lighter than them — the same rule that makes ships float and hot-air balloons rise.' },
  { name: 'Walking water rainbow', time: '1 hour + waiting', level: 'easy',
    materials: 'Three cups, paper towels, water, three food-colouring colours.',
    steps: ['Line up cups: colour the first and third, leave the middle empty.', 'Fold two paper towels into strips; bridge cup 1→2 and cup 3→2.', 'Wait 30–60 minutes and watch colour creep uphill into the empty cup.'],
    why: 'Capillary action: water climbs tiny fibres against gravity, dragging dye with it. Real trees lift sap to their tallest leaves the same way.' },
  { name: 'Pepper and soap (surface tension)', time: '5 min', level: 'easy',
    materials: 'A plate of water, black pepper, dish soap, a toothpick.',
    steps: ['Sprinkle pepper over the still water.', 'Touch the centre with a dry toothpick — nothing.', 'Dip the toothpick in soap and touch again — the pepper shoots to the edge.'],
    why: 'Water\'s surface behaves like a stretched skin (surface tension). Soap weakens it locally, so the stronger water elsewhere pulls the surface — and the pepper — away. Germs behave similarly near soap for the same reason.' },
  { name: 'Invisible ink with lemon juice', time: '15 min + adult heat step', level: 'easy',
    materials: 'Lemon juice, cotton bud, white paper, lamp or sunny window (adult to supervise any warming).',
    steps: ['Write a message on paper with lemon juice using a cotton bud.', 'Let it dry completely — the page looks blank.', 'Warm the paper near a lamp or in strong sun; the writing turns brown.'],
    why: 'Lemon juice is a weak acid that oxidises and browns before the paper does when heated. Organic invisible inks all work on this early-browning principle.' },
  { name: 'Static balloon electroscope', time: '10 min', level: 'easy',
    materials: 'A balloon, wool cloth or hair, a thin stream of water from a tap, small paper bits.',
    steps: ['Rub the balloon on wool for 10 seconds.', 'Bring it near (not touching) small paper pieces — they jump up.', 'Hold it beside a thin tap-water stream and watch the water bend toward it.'],
    why: 'Rubbing transfers electrons, charging the balloon. Its electric field polarises the paper and the water, and the opposite charge side is pulled closer — electrostatics, the same physics behind lightning.' },
  { name: 'Cabbage pH indicator', time: '30 min, adult boils', level: 'medium',
    materials: 'Red/purple cabbage (adult boils it), clear cups, lemon juice, vinegar, baking soda, soap water, milk of magnesia (optional).',
    steps: ['Adult boils cabbage pieces 10 min; cool and strain the purple water.', 'Pour indicator into cups; label each test liquid.', 'Add a spoon of each: lemon and vinegar turn pink-red; baking soda turns blue-green; neutral water stays purple.'],
    why: 'Cabbage contains anthocyanin pigments that change molecular shape with acidity, reflecting different colours. Laboratories use the same trick with litmus paper and universal indicator.' },
  { name: 'Bottle "cartesian diver"', time: '15 min', level: 'easy',
    materials: 'A plastic bottle with cap, water, a sauce packet or a pen cap with Blu-Tack (one that just barely floats).',
    steps: ['Fill the bottle completely to the brim.', 'Add your barely-floating diver; screw the cap on tight.', 'Squeeze the bottle — the diver sinks; release — it rises.'],
    why: 'Squeezing raises pressure and compresses the air pocket inside the diver, letting more water in so it becomes denser. Divers and submarines control buoyancy exactly this way, with ballast tanks.' },
  { name: 'Homemade compass', time: '20 min', level: 'medium',
    materials: 'Sewing needle, strong magnet (or wool/silk and hair), a small cork or foam slice, bowl of water.',
    steps: ['Stroke the needle in ONE direction along the magnet 30–50 times.', 'Gently push the needle through the cork so it floats flat.', 'Place the cork on still water and wait; it turns and holds a north-south line.'],
    why: 'Stroke-aligning domains inside the steel turns it into a weak magnet; Earth\'s magnetic field then torques it around until it lines up. The needle points to magnetic north — not exactly true north, and that difference (declination) matters to navigators.' },
  { name: 'Yarn DNA extraction', time: '30 min', level: 'medium',
    materials: 'Fresh strawberry (or banana), zip bag, salt, water, dish soap, cold rubbing alcohol (chilled in a freezer), strainer, glass.',
    steps: ['Mash the fruit in the bag with your hands (2 min).', 'Mix 1 tsp salt + 1 tsp soap + 3 tbsp water; pour in and mash 1 more min.', 'Strain the juice into the glass. Tilt the glass and pour cold alcohol slowly down the side.', 'Wait a minute: white stringy clumps appear at the boundary — DNA.'],
    why: 'Soap and salt break cell and nucleus membranes and pull DNA out of its proteins; DNA does not dissolve in alcohol, so it crashes out as visible strands. You are looking at thousands of tangled molecules you inherited.' },
  { name: 'Shadow sundial', time: '40 min outdoor', level: 'easy',
    materials: 'Cardboard, a straw or pencil, a sunny spot, a marker, a clock to check against.',
    steps: ['Stick the straw in the centre of the card; put the card flat in sun.', 'Mark the shadow tip and write the time every hour through the day.', 'Do it again the next day at the same times — the marks match.'],
    why: 'The Sun\'s apparent motion is Earth\'s rotation, about 15° an hour. Shadows trace that rotation faithfully, which is why sundials ruled timekeeping for thousands of years.' },
  { name: 'Elephant-free "elephant toothpaste" (kid-safe version)', time: '20 min', level: 'medium',
    materials: 'Empty bottle, warm water, yeast (a teaspoon), 3% hydrogen peroxide (the mild brown-bottle kind), dish soap, tray, safety glasses.',
    steps: ['Mix half a cup of 3% peroxide with a squirt of soap in the bottle; add a few drops of colour if you like.', 'Add the yeast (pre-mixed with a spoon of warm water) and set the bottle on the tray.', 'Watch the foam rope grow for a minute — then the yeast mixture can be poured down the sink with lots of water.'],
    why: 'Yeast produces catalase, an enzyme that strips oxygen off peroxide at high speed. Released oxygen gets trapped in the soap as foam and warm to the touch (the reaction gives off heat). Never use hair-dressing peroxide for this.' },
  { name: 'The egg in two glasses', time: '15 min + 1 hour', level: 'easy',
    materials: 'Two glasses, water, 6 tbsp salt, two raw eggs (adult handles eggs), spoon.',
    steps: ['Fill both glasses with water; stir salt into one until it dissolves.', 'Gently lower an egg into each: one sinks, one floats.', 'Carefully pour the salty glass into the plain glass — the egg now hangs in the middle.'],
    why: 'Salt water is denser than an egg, plain water less dense — so buoyancy flips. Layered liquids create a density staircase, the same effect that lets you float effortlessly in the Dead Sea.' },
];

// —── SAINS — penerangan konsep (2–4 ayat setiap perenggan). —─────────────────
const SCIENCE = [
  { title: 'Gravity — the shape of fall', paras: [
    'Gravity is the mutual attraction of anything with mass. Earth pulls you, you pull Earth — with an equal force, but Earth\'s enormous mass makes its side of the effect invisible.',
    'Newton described it as a force between masses; Einstein showed it is actually the curvature of spacetime itself — planets orbit the Sun because they follow the curved path the Sun\'s mass makes in space.',
    'Weight = mass × gravitational acceleration (9.8 m/s² on Earth). That is why your mass is unchanged on the Moon, but your weight drops to one sixth there.'] },
  { title: 'Energy — one currency, many wallets', paras: [
    'Energy changes form constantly but the total never changes — the first law of thermodynamics. Food is stored chemical energy; your body spends it as motion and heat.',
    'A moving car\'s kinetic energy grows with the square of speed: double the speed, quadruple the crash energy. That single square law explains most of road-safety design.',
    'In every real conversion some energy ends up as low-grade heat nobody can reuse — entropy, the reason perpetual-motion machines are impossible.'] },
  { title: 'Matter — solids, liquids, gases and beyond', paras: [
    'What you call a state of matter is a balance between particle energy and the forces holding particles together. Heat enough and bonds lose: solid melts, liquid boils.',
    'Temperature does not always rise while a substance changes state — boiling water stays at 100 °C while the added energy quietly breaks intermolecular bonds (latent heat).',
    'Beyond the school four: plasma (ionised gas — the Sun, lightning, neon signs), Bose–Einstein condensates near absolute zero where atoms behave as one quantum object.'] },
  { title: 'Electricity — the moving-electron economy', paras: [
    'Electric current is a drift of electrons through a conductor — slow individually (millimetres per second), but the field that pushes them travels near light speed, so your lamp wakes instantly.',
    'Voltage is the push, current is the flow, resistance the pinch; Ohm\'s law V = IR ties the three together for every circuit on Earth.',
    'Alternating current changes direction 50–60 times a second, which lets transformers step voltage up for loss-free long-distance travel and down before it enters your home.'] },
  { title: 'Magnetism — electricity\'s mirror twin', paras: [
    'Magnetism is moving charge seen from another angle: currents create fields, and fields push on currents. That handshake is every motor and generator ever built.',
    'Earth itself acts like a bar magnet, generated by churning liquid iron in its outer core. The field reverses every few hundred thousand years — the last flip was about 780,000 years ago.',
    'That magnetic shield deflects the solar wind; without it the atmosphere would be slowly stripped away, as happened on Mars.'] },
  { title: 'Light — wave, particle, messenger', paras: [
    'Light travels at 299,792,458 m/s in vacuum — the cosmic speed limit. Colour is simply wavelength: long red waves around 700 nm, short violet near 400 nm.',
    'Light also arrives in particles, photons — each carrying energy proportional to its frequency. Wave-particle duality is the quantum world\'s calling card.',
    'Reflection (mirrors), refraction (lenses, bent straws in water), diffraction (rainbow CD grooves) and scattering (why the sky is blue) are the four everyday tricks of light.'] },
  { title: 'Sound — pressure in disguise', paras: [
    'Sound is a pressure wave riding through air at about 343 m/s. Pitch is frequency (20 Hz–20 kHz is human hearing), loudness is the wave\'s energy.',
    'Sound cannot cross a vacuum — the astronauts on the Moon used radios because hammer-blow sounds had no medium to travel in the regolith.',
    'Doppler shift: an ambulance\'s siren drops in pitch as it passes you because the wave crests are stretched; the same shift reveals which stars and galaxies recede from us.'] },
  { title: 'Heat — the physics of "hot enough"', paras: [
    'Heat always flows from warmer to colder; nothing spontaneously runs the other way. That one rule drives engines, refrigerators and weather.',
    'Three transfer routes: conduction (touch — a spoon in tea), convection (moving fluid — boiling water, sea breezes), radiation (waves — Sun heat crossing empty space).',
    'Absolute zero, −273.15 °C, is the floor: particle motion reaches its minimum and no colder state exists.'] },
  { title: 'The water cycle — Earth\'s recycling engine', paras: [
    'The Sun lifts roughly 500,000 km³ of water into the air each year, mostly from oceans; it condenses into clouds and falls as precipitation across land and sea.',
    'A water molecule spends most of its life in the ocean (about 3,200 years on average), only weeks in the atmosphere — rivers empty their load in days.',
    'The same cycle carved the Grand Canyon, filled the Great Lakes and decides your weather; every glass of water you drink has likely passed through a dinosaur.'] },
  { title: 'Plate tectonics — the moving surface', paras: [
    'Earth\'s crust is a cracked shell of plates floating on hot, slow-flowing mantle. They move at fingernail speed — 2–10 cm a year.',
    'Where plates separate, new ocean floor rises (Mid-Atlantic Ridge); where they collide, mountains and trenches form (Himalaya, Peru–Chile trench); where they grind, earthquakes happen (San Andreas).',
    'The continents were welded into Pangea about 300 million years ago and are still drifting apart; Africa splits slowly along the East African Rift.'] },
  { title: 'Atoms — the mostly-empty building blocks', paras: [
    'An atom is a nucleus of protons and neutrons surrounded by an electron cloud. If the nucleus were a marble in a stadium, the electrons would be somewhere in the stands — the rest is empty field.',
    'The proton count (atomic number) defines the element: 6 makes carbon, 8 oxygen, 79 gold. Changing it is alchemy — and nuclear physics, which does exactly that in stars and reactors.',
    'Chemistry is almost entirely electron behaviour: atoms bond by sharing or trading outer electrons, and every material property you touch is the result.'] },
  { title: 'Chemical reactions — rearranging the furniture', paras: [
    'A reaction breaks bonds in the starting substances and forms new ones; atoms are never created or destroyed, just reassembled — hence balancing equations.',
    'Reactions speed up with heat, concentration, surface area and catalysts. Your body runs thousands of reactions per second at 37 °C using enzyme catalysts — chemistry labs envy that control.',
    'Combustion (rapid oxidation), rust (slow one), neutralisation (acid + base → salt + water) and photosynthesis (energy-storing build-up) are four classics.'] },
  { title: 'DNA and heredity — four-letter instructions', paras: [
    'DNA is a twisted-ladder molecule whose letter order spells instructions for building proteins; the human genome holds about 3 billion letters per cell.',
    'Discovered as a structure in 1953 by Watson and Crick with crucial unsung work by Rosalind Franklin; the code was fully read by the Human Genome Project in 2003.',
    'Children get half their DNA from each parent; tiny letter typos (mutations) are the raw material of evolution — most are neutral, some harmful, occasionally one is useful.'] },
  { title: 'Evolution — natural selection in action', paras: [
    'Variation exists in every population; organisms produce more offspring than can survive; traits that help survival and reproduction get inherited more often. Heredity + selection + time = adaptation.',
    'It is not "survival of the strongest" but of the best-fitted-to-this-environment; when the environment changes, yesterday\'s winners can lose — that is why extinction rates spike after climate shifts.',
    'Observed directly: antibiotic resistance in bacteria, peppered moth colour shifts, and the finch-beak changes tracked for decades in the Galápagos.'] },
  { title: 'The immune system — the body\'s intelligence war', paras: [
    'First defences are general: skin, stomach acid, inflammation. Special forces are white cells that learn specific invaders, kill them and keep a wanted poster (memory cells) for next time.',
    'Vaccines train that memory with a harmless preview — weakened, killed, or just a piece or an instruction-sheet (mRNA) of the germ — so the real attack meets a defence already prepared.',
    'Smallpox, eradicated in 1980, is humanity\'s clearest proof the system works when vaccinated widely enough.'] },
  { title: 'Radioactivity — unstable nuclei shed weight', paras: [
    'Heavy atoms with too many protons or neutrons decay, firing off alpha particles (helium nuclei), beta particles (electrons/positrons) or gamma rays (high-energy light).',
    'Half-life is fixed per isotope: carbon-14 takes 5,730 years, so once-living material\'s remaining fraction dates it up to ~50,000 years; uranium-lead clocks date the Earth itself to 4.54 billion years.',
    'Background radiation is everywhere (rocks, cosmic rays, bananas\' potassium-40); life evolved under it and repair systems handle ordinary doses.'] },
  { title: 'Climate — the energy budget of a planet', paras: [
    'Earth balances incoming sunlight against outgoing infrared. Greenhouse gases (water vapour, CO₂, methane) slow the escape of heat — a natural blanket without which Earth averages −18 °C instead of +15 °C.',
    'Adding greenhouse gas thickens the blanket: since 1850s measurement began, CO₂ has climbed from 280 to over 420 ppm, the highest in at least 800,000 years (ice cores prove it).',
    'Climate is the budget; weather is one day\'s spending. The trend shows up as warmer averages plus more energy in heat, drought, storms and sea-level rise (currently about 3.7 mm a year).'] },
];

// —── SEJARAH — mercu tanda kronologi (tahun, tajuk, inti). —──────────────────
const HISTORY = [
  { y: 'c. 3400 BC', t: 'Writing begins in Sumer', d: 'Accounting tokens evolved into cuneiform wedges pressed in clay — the first technology that let ideas outlive their speakers.' },
  { y: 'c. 3100 BC', t: 'Egypt unites under one crown', d: 'Narmer joins Upper and Lower Egypt, launching 3,000 years of pharaonic civilisation along the Nile.' },
  { y: 'c. 2560 BC', t: 'The Great Pyramid completed', d: 'Khufu\'s pyramid at Giza — 2.3 million blocks, original height 146 m — the tallest human structure for 3,800 years.' },
  { y: 'c. 1754 BC', t: 'Code of law carved in stone', d: 'Hammurabi\'s Babylon stele lists 282 laws — early proof that rules can be public, fixed and applied by the state, not whispered by judges.' },
  { y: '508 BC', t: 'Athens tries rule-by-citizens', d: 'Cleisthenes\' reforms create democracy (demos + kratos): free male citizens vote, serve in juries and draw lots for office.' },
  { y: '500 BC', t: 'The Buddha and Confucius teach', d: 'Around this decade both Siddhartha Gautama and Kong Qiu begin teaching paths — ethics without gods in China, liberation from suffering in India.' },
  { y: '221 BC', t: 'China becomes one empire', d: 'Qin Shi Huang ends the Warring States, standardises script, weights and road widths — the template all later Chinese dynasties copied.' },
  { y: '44 BC', t: 'The Roman Republic dies mid-sentence', d: 'Caesar\'s assassination backfires; within 17 years Octavian becomes Augustus, first Roman emperor, ruling a Mediterranean-wide state.' },
  { y: 'AD 79', t: 'Vesuvius buries Pompeii', d: 'The eruption preserves a Roman town in ash — streets, bakeries, graffiti — an accidental time capsule of ordinary empire life.' },
  { y: '476', t: 'The last western Roman emperor steps down', d: 'Odoacer deposes Romulus Augustulus; historians use the date (though contemporaries barely noticed) for the start of the European Middle Ages.' },
  { y: '622', t: 'The Hijra — year zero of the Islamic calendar', d: 'Muhammad\'s migration from Mecca to Medina founds the first Muslim community; within a century Islam spans from Spain to India.' },
  { y: 'c. 830', t: 'Baghdad\'s House of Wisdom', d: 'Scholars translate Greek, Persian and Indian science, then push past it: al-Khwarizmi\'s algebra, Ibn al-Haytham\'s optics, medicine texts Europe will study for 500 years.' },
  { y: '1088', t: 'Europe\'s first university', d: 'Bologna formalises the guild of scholars; within two centuries Paris, Oxford and Salamanca follow — degrees, curricula and academic freedom grow from here.' },
  { y: '1206', t: 'Mongol Empire proclaimed', d: 'T Temüjin takes the title Genghis Khan; within 150 years the largest contiguous land empire links China to Europe with the Pax Mongolica trade routes.' },
  { y: '1347', t: 'The Black Death enters Europe', d: 'Plague reaches Messina from Caffa; within four years it kills a third to half of Europe\'s people, ending serfdom economics and reshaping the world.' },
  { y: '1440', t: 'Gutenberg\'s printing press', d: 'Moveable type + screw press + oil ink: book costs collapse, literacy spreads, and within 60 years Europe holds more printed pages than the previous thousand years combined.' },
  { y: '1492', t: 'Two worlds collide', d: 'Columbus reaches the Americas; the Columbian Exchange that follows moves crops, animals, people and diseases between hemispheres — the start of the modern global age.' },
  { y: '1522', t: 'The first circumnavigation ends', d: 'The Victoria limps into San Sebastián with 18 survivors of Magellan\'s 270 — Earth\'s roundness proven by sailing all the way around it.' },
  { y: '1609', t: 'Galileo turns a telescope skyward', d: 'Mountains on the Moon, Jupiter\'s moons, Venus\'s phases — the heavens are not perfect and unchanging, and science will never hand truth back to authority.' },
  { y: '1687', t: 'Newton publishes the Principia', d: 'Three laws of motion plus universal gravitation: falling apples and orbiting moons obey one mathematics. Prediction becomes physics\' superpower.' },
  { y: '1712', t: 'The steam engine starts the long countdown', d: 'Newcomen\'s atmospheric engine pumps mines; 60 years later Watt improves it, and fossil fuel begins replacing muscle, wind and water worldwide.' },
  { y: '1776', t: 'Revolution of ideas with a declaration', d: 'American independence declares rights "self-evident"; within 13 years France follows. The age of subjects gives way (slowly, incompletely) to the age of citizens.' },
  { y: '1815', t: 'Waterloo and a century of uneasy peace', d: 'Napoleon\'s defeat redraws Europe; the Congress system and British naval primacy hold great-power war largely in check until 1914.' },
  { y: '1831', t: 'The Beagle sails — and Faraday finds induction', d: 'Darwin departs Devon that December; that same year Faraday demonstrates electromagnetic induction — the principle behind every generator now on Earth.' },
  { y: '1869', t: 'Rails and canals close the distance', d: 'The Suez Canal opens, linking Mediterranean to Red Sea; the U.S. First Transcontinental Railroad is completed at Promontory Summit — world trade doubles within decades.' },
  { y: '1876', t: 'The telephone and the sound of instant distance', d: 'Bell\'s patent (rival Elisha Gray filed the same day) turns wires into voices; information had travelled by rail speed for 40 years — now it travels at light-adjacent speed.' },
  { y: '1903', t: 'Twelve seconds above Kitty Hawk', d: 'Orville Wright flies 37 m with a 12-hp engine. Within 66 years, humans cross an ocean in hours; within 66 more, a shuttle returns from orbit.' },
  { y: '1914–1918', t: 'The First World War ends emperors', d: 'Industrial firepower kills 17 million; four empires collapse (Ottoman, Austro-Hungarian, Russian, German), borders are redrawn, and the map\'s problems outlive the peace.' },
  { y: '1928', t: 'Penicillin — mould meets a messy lab bench', d: 'Fleming notices a contaminated plate where bacteria died. Mass-produced a decade later, antibiotics turn once-fatal infections into treatable annoyances and add ~20 years to life expectancy.' },
  { y: '1945', t: 'War ends; two new powers begin', d: 'Atomic bombs end the Pacific war and open the nuclear age; the United Nations is founded in October. Superpower rivalry splits the world for 45 years.' },
  { y: '1948', t: 'The transistor — the quiet revolution', d: 'Bardeen, Brattain and Shockley build a switching slab of germanium at Bell Labs. Every screen, phone and computer since is a child of that millimetre.' },
  { y: '1953', t: 'The structure of DNA solved', d: 'Watson and Crick publish the double helix (with Franklin\'s X-ray data central); within 50 years the human genome is read, and medicine gains a molecular alphabet.' },
  { y: '1957', t: 'Sputnik — space becomes a place', d: 'A 58 cm polished sphere beeps overhead; the satellite age (and the space race) begins. The same rocket technology makes ICBMs and global weather monitoring real.' },
  { y: '1969', t: 'One small step', d: 'Apollo 11 lands two humans on the Moon and brings them home — still, 50+ years later, the farthest any people have travelled from Earth.' },
  { y: '1974–1989', t: 'From microprocessors to the World Wide Web', d: 'Intel\'s parts shrink computing onto a chip; Berners-Lee at CERN proposes hypertext over the internet in 1989, and posts the first website in 1991. Information starts its migration online.' },
  { y: '1989–1991', t: 'The Berlin Wall falls, the USSR dissolves', d: 'Peaceful revolutions in Eastern Europe end the Cold War; the world\'s last land empire shrinks to fifteen states in one December evening.' },
  { y: '2003', t: 'The Human Genome Project completed', d: '3 billion letters of one species sequenced — the first draft of the instruction manual of being human, opened as free public data.' },
  { y: '2007', t: 'The pocket internet arrives', d: 'The iPhone merges phone, browser and camera; within a decade over half of humanity is online, most of them through screens the size of a deck of cards.' },
  { y: '2012–2020s', t: 'Deep learning, CRISPR, and mRNA vaccines', d: 'Neural networks pass human-level tests, gene editing (CRISPR) wins the 2020 Nobel, and mRNA vaccines race from sequence to jab in under a year — biotech becomes information tech.' },
];

// —── GEOGRAFI — rekod dunia (stabil, semak). —────────────────────────────────
const GEO_RECORDS = [
  ['Highest point', 'Mount Everest — 8,849 m above sea level (2020 joint China/Nepal survey).'],
  ['Lowest land point', 'Shore of the Dead Sea — about −430 m, and falling ~1 m a year.'],
  ['Deepest ocean', 'Challenger Deep, Mariana Trench — about 10,935 m.'],
  ['Longest river (usually ranked first)', 'Nile — about 6,650 km (Amazon disputed as longest; definitely largest by water).'],
  ['Largest river by flow', 'Amazon — about 209,000 m³/s, more than the next seven rivers combined.'],
  ['Largest hot desert', 'Sahara — about 9.2 million km², nearly the size of the USA.'],
  ['Largest country', 'Russia — 17.1 million km², 11% of the world\'s land area.'],
  ['Smallest country', 'Vatican City — 0.44 km², about 800 citizens.'],
  ['Most populous country', 'India overtook China in 2023 — about 1.44 billion (UN estimate).'],
  ['Least populous UN member', 'Tuvalu — about 11,000 people.'],
  ['Largest lake (by area)', 'Caspian Sea — 371,000 km², saline and landlocked; the "sea" that is really a lake.'],
  ['Deepest lake', 'Lake Baikal — 1,642 m, holding ~20% of the world\'s unfrozen fresh water.'],
  ['Wettest place', 'Mawsynram, India — about 11,871 mm of rain in an average year.'],
  ['Driest place', 'Atacama Desert, Chile — some weather stations have never recorded rain.'],
  ['Longest mountain range', 'The Andes — about 7,000 km along South America\'s spine.'],
  ['Habitat at the top of the world', 'The Arctic Ocean ice shelf hosts bacteria, algae under ice and no permanent human residents; Antarctica has research stations only, ~1,000–5,000 people seasonally.'],
];

module.exports = {
  FACTS, RIDDLES, EXPERIMENTS, SCIENCE, HISTORY, GEO_RECORDS,
  dayIndex, pickDaily, shuffleSeeded, mulberry32,
};
