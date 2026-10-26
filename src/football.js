'use strict';
// ── TUKUK-OS FOOTBALL (/football) — World Cup History & the Laws of the Game ───
// STATIC embedded data — no runtime API call, so a page can never 503 and never
// depends on an upstream. Association football (soccer) is the world's most played
// and most watched sport, and the FIFA World Cup its most-watched single event.
// Every field here is a settled, widely-documented FACT: tournament year, host
// nation(s), champion, runner-up and the final score. We publish NO live odds, NO
// player statistics that drift, and NO result for a tournament not yet played — the
// 2026 edition is described by its confirmed hosts and format only. The Laws are the
// 17 numbered Laws of the Game as kept by IFAB; each summary is our own plain-English
// wording of an objective, un-copyrightable rule. Facts are not copyrightable; all
// descriptive text is original. English/global by design.

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── FIFA WORLD CUP (men's finals), one entry per completed tournament ───────────
// y=year, host=host nation(s), win=champion, run=runner-up, score=final score line,
// how=deciding detail (extra time / penalties) where relevant, note=a short fact.
const CUPS_RAW = [
  { y: 1930, host: 'Uruguay', win: 'Uruguay', run: 'Argentina', score: '4–2', how: '', note: 'The first World Cup, played entirely in the host country; only 13 teams entered.' },
  { y: 1934, host: 'Italy', win: 'Italy', run: 'Czechoslovakia', score: '2–1', how: 'after extra time', note: 'The first World Cup held in Europe, decided by knockout from the first round.' },
  { y: 1938, host: 'France', win: 'Italy', run: 'Hungary', score: '4–2', how: '', note: 'Italy became the first team to defend the title; the last tournament before the war.' },
  { y: 1950, host: 'Brazil', win: 'Uruguay', run: 'Brazil', score: '2–1', how: '', note: 'The decisive final-round match, a shock known in Brazil as the Maracanazo.' },
  { y: 1954, host: 'Switzerland', win: 'West Germany', run: 'Hungary', score: '3–2', how: '', note: 'West Germany came from behind to beat the heavily-favoured Mighty Magyars.' },
  { y: 1958, host: 'Sweden', win: 'Brazil', run: 'Sweden', score: '5–2', how: '', note: 'A 17-year-old Pelé announced himself as Brazil won its first title.' },
  { y: 1962, host: 'Chile', win: 'Brazil', run: 'Czechoslovakia', score: '3–1', how: '', note: 'Brazil defended the crown, with Garrincha starring after Pelé was injured early.' },
  { y: 1966, host: 'England', win: 'England', run: 'West Germany', score: '4–2', how: 'after extra time', note: 'England’s only World Cup title, decided by the famous contested "Wembley Goal".' },
  { y: 1970, host: 'Mexico', win: 'Brazil', run: 'Italy', score: '4–1', how: '', note: 'Brazil’s third title won outright the Jules Rimet Trophy; watched in colour for the first time.' },
  { y: 1974, host: 'West Germany', win: 'West Germany', run: 'Netherlands', score: '2–1', how: '', note: 'The host nation beat "Total Football" Netherlands in the second-round final.' },
  { y: 1978, host: 'Argentina', win: 'Argentina', run: 'Netherlands', score: '3–1', how: 'after extra time', note: 'Argentina won its first title on home soil.' },
  { y: 1982, host: 'Spain', win: 'Italy', run: 'West Germany', score: '3–1', how: '', note: 'Paolo Rossi emerged from a ban to top the scoring and lead Italy.' },
  { y: 1986, host: 'Mexico', win: 'Argentina', run: 'West Germany', score: '3–2', how: '', note: 'Diego Maradona’s tournament — including the "Hand of God" and the "Goal of the Century".' },
  { y: 1990, host: 'Italy', win: 'West Germany', run: 'Argentina', score: '1–0', how: '', note: 'West Germany’s third title, a revenge final against Argentina, decided by a penalty.' },
  { y: 1994, host: 'United States', win: 'Brazil', run: 'Italy', score: '0–0', how: 'Brazil won 3–2 on penalties', note: 'The first World Cup final decided by a penalty shoot-out after a goalless draw.' },
  { y: 1998, host: 'France', win: 'France', run: 'Brazil', score: '3–0', how: '', note: 'Host nation France won its first title; the tournament expanded to 32 teams.' },
  { y: 2002, host: 'South Korea & Japan', win: 'Brazil', run: 'Germany', score: '2–0', how: '', note: 'The first World Cup in Asia and the first co-hosted; Brazil’s record fifth title.' },
  { y: 2006, host: 'Germany', win: 'Italy', run: 'France', score: '1–1', how: 'Italy won 5–3 on penalties', note: 'Remembered for Zinedine Zidane’s sending-off in his final match.' },
  { y: 2010, host: 'South Africa', win: 'Spain', run: 'Netherlands', score: '1–0', how: 'after extra time', note: 'The first World Cup in Africa; Spain won its first title.' },
  { y: 2014, host: 'Brazil', win: 'Germany', run: 'Argentina', score: '1–0', how: 'after extra time', note: 'Germany won in Brazil; the host nation lost 7–1 to Germany in the semi-final.' },
  { y: 2018, host: 'Russia', win: 'France', run: 'Croatia', score: '4–2', how: '', note: 'France’s second title; Croatia reached its first final.' },
  { y: 2022, host: 'Qatar', win: 'Argentina', run: 'France', score: '3–3', how: 'Argentina won 4–2 on penalties', note: 'A five-goal final in the winter, played in the Middle East for the first time.' },
];

// The next edition: hosts and confirmed format, but NO result — it is not yet played.
const NEXT_CUP = { y: 2026, host: 'United States, Canada & Mexico', note: 'The next tournament returns to North America and expands from 32 to 48 teams. Its result is not part of this static record until it is decided.' };

// All-time champions: total titles per nation, derived from the finals above.
const CHAMPIONS = (() => {
  const m = new Map();
  for (const c of CUPS_RAW) {
    const name = c.win.replace('West Germany', 'Germany'); // same national football association
    if (!m.has(name)) m.set(name, { name, titles: 0, years: [] });
    const rec = m.get(name);
    rec.titles += 1;
    rec.years.push(c.y);
  }
  return [...m.values()].sort((a, b) => b.titles - a.titles || a.name.localeCompare(b.name));
})();

// ── THE LAWS OF THE GAME (17), as kept by IFAB ──────────────────────────────────
// n = law number, t = official title, s = plain-English summary (our own wording).
const LAWS_RAW = [
  { n: 1, t: 'The Field of Play', s: 'A rectangular grass or artificial pitch, longer than it is wide, with two goals, marked boundary lines, a halfway line, a centre spot and circle, penalty areas, penalty marks and corner arcs. The Laws fix maximum and minimum dimensions so pitches are consistent.' },
  { n: 2, t: 'The Ball', s: 'A spherical ball of an approved size (size 5 for adults) and pressure. It is replaced by the referee if it becomes defective, and only the referee may authorise a change during play.' },
  { n: 3, t: 'Players', s: 'A match is played by two teams of up to eleven players each, one of whom is the goalkeeper. A minimum number is required for a match to start or continue, and substitution rules govern how unused replacements may enter.' },
  { n: 4, t: 'Players’ Equipment', s: 'The basic kit is a shirt, shorts, socks, shinguards and footwear. Nothing dangerous, including jewellery, may be worn; goalkeepers must wear colours that distinguish them from others.' },
  { n: 5, t: 'The Referee', s: 'The referee has full authority to enforce the Laws. Decisions on facts connected with play are final; the referee may change a decision only on realising it was wrong or, if play has not restarted, on another official’s advice.' },
  { n: 6, t: 'The Other Match Officials', s: 'Assistant referees (linespeople) signal offside, out-of-play and fouls the referee asks about; a fourth official manages substitutions and added time, and video assistant referees may review clear and obvious errors where used.' },
  { n: 7, t: 'The Duration of the Match', s: 'Two equal halves of forty-five minutes, with a short half-time interval. The referee adds time at the end of each half for stoppages, and a competition may use extra time and kicks from the penalty mark if a winner is required.' },
  { n: 8, t: 'The Start and Restart of Play', s: 'Play starts each half and resumes after a goal with a kick-off from the centre spot. A dropped ball restarts play when it is stopped for a reason not covered by another Law.' },
  { n: 9, t: 'The Ball In and Out of Play', s: 'The ball is out of play when it wholly crosses a goal line or touchline, or when play is stopped by the referee. It is in play at all other times, including when it rebounds off a post, crossbar, corner flag or the referee on the field.' },
  { n: 10, t: 'Determining the Outcome of a Match', s: 'A goal is scored when the whole ball passes over the goal line between the goalposts and under the crossbar, provided no offence was committed by the scoring team. The team scoring more goals wins; matches may be drawn or decided by kicks from the penalty mark.' },
  { n: 11, t: 'Offside', s: 'A player is in an offside position if nearer to the opponents’ goal line than both the ball and the second-last defender when the ball is played to them. Being in the position is not an offence; it is penalised only if the player becomes involved in active play.' },
  { n: 12, t: 'Fouls and Misconduct', s: 'Careless, reckless or excessive force against an opponent, handling the ball deliberately, and other listed offences are fouls. Cautionable (yellow card) and sending-off (red card) offences carry the corresponding sanctions, some applied to substitutes and team officials too.' },
  { n: 13, t: 'Free Kicks', s: 'Fouls are punished by a direct free kick (which can be scored straight at goal) or an indirect free kick (which must touch another player first). Opponents must keep the required distance until the ball is in play.' },
  { n: 14, t: 'The Penalty Kick', s: 'A direct free kick awarded to the attacking team for a foul inside the defenders’ penalty area, taken from the penalty mark with only the goalkeeper to beat, who must remain on the goal line until the ball is kicked.' },
  { n: 15, t: 'The Throw-in', s: 'Awarded when the ball wholly crosses a touchline, taken from the point it left the field by throwing it with both hands over the head. The thrower faces the field, keeps part of both feet on the ground, and a goal cannot be scored directly.' },
  { n: 16, t: 'The Goal Kick', s: 'Awarded when the whole ball crosses the attacking team’s goal line, last touched by an attacker, without a goal being scored. Taken from the goal area, it can now be scored directly against the opponents.' },
  { n: 17, t: 'The Corner Kick', s: 'Awarded when the whole ball crosses the goal line, last touched by a defender, without a goal being scored. Taken from the nearest corner flag, it may be scored directly into the opponents’ goal.' },
];

// ── Stable lookup + grouping ────────────────────────────────────────────────────
const CUPS = CUPS_RAW.map((c) => ({ ...c, slug: String(c.y) }));
const C_BY_YEAR = new Map(CUPS.map((c) => [c.y, c]));
const LAWS = LAWS_RAW.map((l) => ({ ...l, slug: 'law-' + l.n }));
const L_BY_NUM = new Map(LAWS.map((l) => [l.n, l]));

function findCup(year) { return C_BY_YEAR.get(Number(year)) || null; }
function findLaw(n) { return L_BY_NUM.get(Number(n)) || null; }

module.exports = {
  CUPS, CHAMPIONS, LAWS, NEXT_CUP, slugify,
  findCup, findLaw,
};
