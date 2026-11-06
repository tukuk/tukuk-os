'use strict';
// ── TUKUK-OS /horoscope — the zodiac, honestly ──
// Twelve pages about the signs the way tukuk.org can stand behind them: the real
// constellations and their ancient stories (that part is fact and culture), the
// traditional temperament labels always attributed as tradition, and a daily line
// chosen by a fixed rule from a hand-written pool — plainly labelled entertainment,
// the same contract a newspaper fun page makes. Nothing here claims stars cause
// events; the astronomy side of each page (precession, the actual sun dates, the
// thirteenth constellation the ecliptic crosses) is the site's real contribution,
// because the zodiac's dates drifted ~a month off the constellations since Babylon.
const DAY = 86400000;

// element/modality/ruler are the standard tropical astrology attributions;
// lore is the constellation-and-myth fact layer; lines are our own fun-page copy.
const SIGNS = [
  {
    slug: 'aries', name: 'Aries', symbol: '♈', icon: '🐏', dates: 'Mar 21 – Apr 19',
    element: 'Fire', modality: 'Cardinal', ruler: 'Mars',
    traits: ['initiating', 'quick to start things', 'direct'],
    lore: 'Aries is the Ram — in Greek myth the flying ram of the Golden Fleece story, and in Babylonian star-lists “the Hired Man,” the season’s ploughing season. Its brightest stars, Hamal and Sheratan, mark the point where the Sun crosses the equinox — though the equinox point has since slipped out of Aries entirely, which is exactly what the precession section explains.',
    lines: [
      'A beginning you keep postponing is smaller than it has grown in your head. Feed the first draft to it.',
      'Today rewards the first move more than the perfect one. Nobody remembers the warm-up laps.',
      'Somebody matches your pace for once instead of lagging it. Notice who that was.',
      'The direct version of what you want to say is shorter and kinder than the careful version.',
      'Energy arrives in weather-front gusts today. Do the thing in the gust, rest in the lull.',
    ],
  },
  {
    slug: 'taurus', name: 'Taurus', symbol: '♉', icon: '🐂', dates: 'Apr 20 – May 20',
    element: 'Earth', modality: 'Fixed', ruler: 'Venus',
    traits: ['steady', 'sensory', 'slow to move, hard to stop'],
    lore: 'The Bull is one of the oldest constellations humans named — cattle on cave walls at Lascaux likely show it with the Pleiades ~17,000 years ago. Its two showpieces are the red giant Aldebaran (“the Follower,” trailing the Pleiades star cluster) and the Crab Nebula, the exploded star the Chinese recorded watching in 1054.',
    lines: [
      'A comfort you have been treating as a luxury turns out to be load-bearing. Provide it officially.',
      'Something worth having moves at the speed of ripening. Do not poke the fruit.',
      'A practical fix beats an inspiring plan today. Fix the wobbly shelf; the meaning comes later.',
      'Good food, a long chew, an unhurried hour: the rare day where slow is the point.',
      'The position you have held quietly for months is more solid than the argument says. Hold.',
    ],
  },
  {
    slug: 'gemini', name: 'Gemini', symbol: '♊', icon: '👥', dates: 'May 21 – Jun 21',
    element: 'Air', modality: 'Mutable', ruler: 'Mercury',
    traits: ['verbal', 'curious', 'two-track attention'],
    lore: 'The Twins are Castor and Pollux of Greek myth, patron stars of sailors — a twin pair, one mortal and one immortal, alternating between Olympus and the underworld. Astronomically Gemini carries two great sights: the bright twin stars themselves, and the Horsehead Nebula, hidden just below Alnitak of Orion’s neighbour.',
    lines: [
      'Two things you thought were opposites turn out to be the same project in different fonts.',
      'A conversation opens a door an application form could not. Talk to the person, not the process.',
      'Curiosity is well-armed today: the random question you ask gets an unexpectedly real answer.',
      'The half-written message, the unfinished idea, the second draft — one of them wants finishing. Pick.',
      'Whichever twin you are today — the social one or the sulking one — the other gets a turn tomorrow.',
    ],
  },
  {
    slug: 'cancer', name: 'Cancer', symbol: '♋', icon: '🦀', dates: 'Jun 22 – Jul 22',
    element: 'Water', modality: 'Cardinal', ruler: 'Moon',
    traits: ['protective', 'remembering', 'mood-tidal'],
    lore: 'The Crab is the smallest story on the ecliptic (one of Hera’s pinches sent to distract Hercules) but holds one of the sky’s great sights: Praesepe, the Beehive cluster, a naked-eye fuzz that Galileo resolved into 40 stars. As the solstice sign in the tropical calendar, Cancer names the Tropic — the Sun’s northernmost standstill.',
    lines: [
      'Someone tests a boundary you set long ago. Silence is a complete answer today.',
      'The memory that surfaces unbidden is not an accident; it is maintenance. Let it finish.',
      'Shelter somebody without announcing it. The quiet version lands deeper.',
      'A small domestic fix — the hinge, the list, the early order — pays emotional rent for weeks.',
      'Moods arrive like weather off water: watch them pass rather than naming the day after them.',
    ],
  },
  {
    slug: 'leo', name: 'Leo', symbol: '♌', icon: '🦁', dates: 'Jul 23 – Aug 22',
    element: 'Fire', modality: 'Fixed', ruler: 'Sun',
    traits: ['warm', 'presentational', 'loyal by lineage'],
    lore: 'The Lion is Nemean, the peltless hero-slaying puzzle of the first labour, set among the stars as a trophy. Its heart is Regulus — “little king,” a star the Persians counted among the sky’s four royal watchers — and its back arcs through the Sickle, a question mark of stars that sailors used as the weather-clock of high summer.',
    lines: [
      'The room improves when you do the thing you were saving for “later on stage.” Later is cheap today.',
      'Praise you give without being asked is the one kind that gets remembered. Hand some out.',
      'A project with your name on it finally gets the introduction it has been waiting for. Make it.',
      'Warmth reads as confidence today even when you feel like a committee inside. Present anyway.',
      'The spotlight is smaller and warmer than it looks from the back of the hall.',
    ],
  },
  {
    slug: 'virgo', name: 'Virgo', symbol: '♍', icon: '🌾', dates: 'Aug 23 – Sep 22',
    element: 'Earth', modality: 'Mutable', ruler: 'Mercury',
    traits: ['precise', 'service-minded', 'quietly analytical'],
    lore: 'Virgo, holding Demeter’s wheat, carries the star Spica — named for the grain ear itself — and near its feet sits M87, the galaxy whose supermassive black hole became the first ever photographed, in 2019. In the old sky, Virgo’s wheat marked the harvest; the constellation is literally a calendar.',
    lines: [
      'The list you keep re-making in your head deserves paper. Externalise it and half its weight goes.',
      'A detail only you would notice turns out to be the thing the whole plan was balanced on. Log it.',
      'Helping someone with their mess teaches you a rule you can apply to your own. Take notes mid-act.',
      'Standards are tools, not identities. Today one of yours can be downgraded with no loss of honour.',
      'The correction you almost made out loud arrives far better as a question.',
    ],
  },
  {
    slug: 'libra', name: 'Libra', symbol: '♎', icon: '⚖️', dates: 'Sep 23 – Oct 22',
    element: 'Air', modality: 'Cardinal', ruler: 'Venus',
    traits: ['diplomatic', 'balance-seeking', 'decision-weighted'],
    lore: 'The Scales are the zodiac’s only human-made object, once read as the claws of Scorpius before the Romans unbundled them. Astronomers still call its twins Zubenelgenubi and Zubeneschamali — “south claw” and “north claw” — and the autumnal equinox, the day of cosmic balance, historically rode through it.',
    lines: [
      'The fair option and the easy option finally separate. You can see both clearly today, which is new.',
      'A decision you keep re-opening wants a second signature, not another week. Find yours and close it.',
      'Someone negotiates better when you sit beside them than across. Move the chairs.',
      'Beauty is doing load-bearing work today: the well-set table, the clean sheet, the quiet room.',
      'The middle path is not compromise when both sides are wrong about the middle. Walk it anyway.',
    ],
  },
  {
    slug: 'scorpio', name: 'Scorpius', symbol: '♏', icon: '🦂', dates: 'Oct 23 – Nov 21',
    element: 'Water', modality: 'Fixed', ruler: 'Mars / Pluto',
    traits: ['intense', 'all-or-nothing', 'transformer of things'],
    lore: 'The Scorpion slew Orion in Greek myth, and the two were set on opposite sides of the sky so they never meet — Orion sets as Scorpius rises. Its heart is Antares, a red supergiant whose name means “rival of Mars,” and beneath the tail the Milky Way deepens into Sagittarius’ star clouds.',
    lines: [
      'The surface of a situation is thinning. What you suspect underneath is half right — go carefully for the other half.',
      'A feeling you have been managing politely wants naming once, fully. Name it and take the pressure off.',
      'Something you can fix and something you can only replace are being confused. Sort them; keep the one that matters.',
      'Loyalty, tested quietly by you without either of you noticing the test, comes through today.',
      'Depth is underrated as a weekend activity. Read the long piece, ask the real question.',
    ],
  },
  {
    slug: 'sagittarius', name: 'Sagittarius', symbol: '♐', icon: '🏹', dates: 'Nov 22 – Dec 21',
    element: 'Fire', modality: 'Mutable', ruler: 'Jupiter',
    traits: ['expansive', 'candid', 'always halfway to the next horizon'],
    lore: 'The Archer — a centaur in the common telling, aiming at Scorpius’ heart — pours light into the zodiac’s richest corner: the Teapot’s steam drifts toward the Milky Way’s central bulge, and the constellation hides several nebulae (the Lagoon, the Trifid) and a famous star cloud, Sagittarius A, the direction of our galaxy’s black-hole core.',
    lines: [
      'The plan that seemed too big turns out to be the one with spare room in it. Stretch it once more.',
      'An invitation, detour or strange road is doing map-work today. Take the scenic version.',
      'The joke you are holding is actually a truth in costume. Tell it, keep the costume.',
      'Two places, two ideas or two futures — the pairing makes both clearer, not harder. Compare notes.',
      'The enthusiasm people mildly tease you about is the exact fuel the stalled thing needs.',
    ],
  },
  {
    slug: 'capricorn', name: 'Capricorn', symbol: '♑', icon: '🐐', dates: 'Dec 22 – Jan 19',
    element: 'Earth', modality: 'Cardinal', ruler: 'Saturn',
    traits: ['patient', 'structural', 'climbing the long slope'],
    lore: 'The Sea-Goat — goat-body, fish-tail, the god Pan’s half-escape from Typhon — is one of the oldest recognizable zodiac figures, drawn by the Babylonians as the goat-fish of Enki. Its brightest star Deneb Algedi is a spectroscopic quadruple; the winter solstice, the Sun’s southern standstill, names the Tropic of Capricorn.',
    lines: [
      'The long game rewards you with a visible milestone, small and concrete. Count it properly.',
      'A shortcut you were offered is actually an apology for a lower standard. The slope is fine.',
      'The thing you built quietly is load-bearing for somebody else today. Let them tell you.',
      'Authority reads better when you are slightly reluctant. Use the pause.',
      'Endurance is a decision renewed hourly, and today it renews itself. Climb.',
    ],
  },
  {
    slug: 'aquarius', name: 'Aquarius', symbol: '♒', icon: '🏺', dates: 'Jan 20 – Feb 18',
    element: 'Air', modality: 'Fixed', ruler: 'Saturn / Uranus',
    traits: ['inventive', 'detached', 'friend-shaped like a network'],
    lore: 'The Water-Pourer is Ganymede, cup-bearer of the gods — one of the few figures Zeus kept in the sky personally — and his jar pours an ancient river of stars toward Fomalhaut in the neighbouring southern sky. The constellation carries the “Water Jar” open cluster M73’s neighbourhood, Saturn Nebula and a patch of zodiacal light diehards chase at dawn.',
    lines: [
      'The idea that sounds odd in the room sounds better in writing, alone, tonight. Write it down.',
      'A friend arrives from an unexpected direction and the week tilts. Answer the odd message.',
      'The system you complained about has one adjustable bolt. Find it instead of describing the whole machine.',
      'Objectivity is not coldness — today your calm view of a heated thing is the gift you bring.',
      'Belonging without blending: the group that keeps your strangeness intact is the right one.',
    ],
  },
  {
    slug: 'pisces', name: 'Pisces', symbol: '♓', icon: '🐟', dates: 'Feb 19 – Mar 20',
    element: 'Water', modality: 'Mutable', ruler: 'Jupiter / Neptune',
    traits: ['absorbent', 'imagistic', 'ending-and-beginning-minded'],
    lore: 'The Two Fish, tied by a cord, close the zodiac at the vernal equinox — the First Point of Aries, the crossroads of ecliptic and equator, now actually lies inside Pisces after 2,000 years of precession. Its faint stars carry the galaxy M74 and the “Double Fish” asterism, but the constellation’s real fame is being where the sky’s calendar begins.',
    lines: [
      'The boundary that dissolved all week can be redrawn without drama. Ink, not apologies.',
      'Something is finishing rather than failing. Let the last page close; the next book is not late.',
      'The image you had of the situation was truer than the report. Trust the sketch, check the numbers.',
      'Art before analysis today: listen to the album, walk the long way, then answer the email.',
      'Empathy is a data channel with noise in it. Keep the channel; filter the noise.',
    ],
  },
];

const ELEMENT_PEERS = {};
for (const s of SIGNS) (ELEMENT_PEERS[s.element] = ELEMENT_PEERS[s.element] || []).push(s.slug);

function findSign(slug) {
  return SIGNS.find((s) => s.slug === String(slug || '').toLowerCase()) || null;
}

function signIndex(slug) {
  return SIGNS.findIndex((s) => s.slug === String(slug || '').toLowerCase());
}

// Traditional pattern, stated as tradition: same-element peers are the easy
// pairings, and the sign 180° away across the zodiac is the classic "opposite"
// attraction. Both are astrological lore, not findings — the pages label them so.
function compatFor(slug) {
  const s = findSign(slug);
  if (!s) return null;
  const peers = ELEMENT_PEERS[s.element].filter((x) => x !== s.slug);
  const opposite = SIGNS[(signIndex(slug) + 6) % 12].slug;
  return { peers, opposite };
}

// The daily line, by a fixed rule (no randomness, no oracle): day number plus a
// per-sign offset picks from the sign's own hand-written pool. Every visitor
// sees the same line all day, and tomorrow is a different one by construction.
function pickLine(slug, yyyymmdd) {
  const i = signIndex(slug);
  if (i < 0) return null;
  const t = Date.parse(`${yyyymmdd}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const dayNo = Math.floor(t / DAY);
  const s = SIGNS[i];
  return s.lines[(dayNo + i * 2) % s.lines.length];
}

module.exports = { SIGNS, findSign, signIndex, compatFor, pickLine, ELEMENT_PEERS, DAY };
