'use strict';
// ── TUKUK-OS OLYMPICS (/olympics) — Every Modern Olympic Games & the Records ───
// STATIC embedded data — no runtime API call, so a page can never 503 and never
// depends on an upstream. The modern Olympic Games, revived from 1896, are the
// most-watched multi-sport event on Earth and the only one nearly every nation
// competes in. Every field here is a settled, widely-documented FACT: year, host
// city and country, and for the cancelled editions the reason. We publish NO live
// medal tables (those drift for the fifteen days a Games runs), NO result for the
// 2026/2028 editions, and only the few all-time superlatives every source agrees
// on. Facts are not copyrightable; all descriptive text is original. English/
// global by design — the Games have been staged on four continents and this
// record names every host, including the editions war erased.

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── SUMMER OLYMPIC GAMES, one entry per scheduled edition (cancelled flagged) ──
// y=year, city, c=country, note=a short settled fact, x=cancelled (no Games held).
const SUMMER_RAW = [
  { y: 1896, city: 'Athens', c: 'Greece', note: 'The first Games of the modern era, revived by Pierre de Frédy, Baron de Coubertin, in the shadow of the stadium where antiquity held them.' },
  { y: 1900, city: 'Paris', c: 'France', note: 'The second Games, stretched over months as part of the World Fair — and the first women competed at the Olympics.' },
  { y: 1904, city: 'St. Louis', c: 'United States', note: 'Timed with Louisiana Purchase centennial fairs; overwhelmingly American fields because travel was still hard.' },
  { y: 1908, city: 'London', c: 'United Kingdom', note: 'Taken at short notice after Mount Vesuvius erupted and Rome cancelled; the marathon run inside the new White City stadium.' },
  { y: 1912, city: 'Stockholm', c: 'Sweden', note: 'The Games of the electric scoreboard and the five-ring symbol\'s first official deployment; Jim Thorpe won two golds.' },
  { y: 1916, city: 'Berlin', c: 'Germany', x: 'cancelled', note: 'Cancelled for the First World War. Berlin later hosted again in 1936.' },
  { y: 1920, city: 'Antwerp', c: 'Belgium', note: 'Awarded to a war-ravaged Belgium; the Olympic flag and the athlete\'s oath both debuted here.' },
  { y: 1924, city: 'Paris', c: 'France', note: 'The "Chariots of Fire" Games; also the year a separate Winter programme was held for the first time.' },
  { y: 1928, city: 'Amsterdam', c: 'Netherlands', note: 'The Olympic flame made its first appearance, in a marble tower at the Amsterdam stadium.' },
  { y: 1932, city: 'Los Angeles', c: 'United States', note: 'Depression-era Games with the smallest fields for decades; the first with the athletes\' village idea rejected as too costly.' },
  { y: 1936, city: 'Berlin', c: 'Germany', note: 'Held under the Nazi swastika banners and broadcast on closed-circuit TV; Jesse Owens won four golds in front of the regime.' },
  { y: 1940, city: 'Tokyo → Helsinki → London', c: '—', x: 'cancelled', note: 'Cancelled for the Second World War after the host moved twice, from Tokyo to Helsinki and then toward London.' },
  { y: 1944, city: 'London', c: 'United Kingdom', x: 'cancelled', note: 'Cancelled for the Second World War; the war ended before the next Olympic bell.' },
  { y: 1948, city: 'London', c: 'United Kingdom', note: 'The first Games since 1936, run on rations in bombed-but-standing London; Fanny Blankers-Koen won four golds.' },
  { y: 1952, city: 'Helsinki', c: 'Finland', note: 'The Soviet Union\'s first Games, turning the track into Cold-War scoreboard.' },
  { y: 1956, city: 'Melbourne', c: 'Australia', note: 'The first Games in the Southern Hemisphere; equestrian events were held months earlier in Stockholm under quarantine law.' },
  { y: 1960, city: 'Rome', c: 'Italy', note: 'The first nationally televised Olympic Games; Wilma Rudolph and Muhammad Ali (as Cassius Clay) emerged here.' },
  { y: 1964, city: 'Tokyo', c: 'Japan', note: 'Asia\'s first Olympics, timed for the rebuilt city — the Shinkansen bullet train opened days before it.' },
  { y: 1968, city: 'Mexico City', c: 'Mexico', note: 'Held at 2,240 metres\' altitude; the Black Power salute on the podium made it unforgettable.' },
  { y: 1972, city: 'Munich', c: 'West Germany', note: 'Marked by the hostage murder of eleven Israeli athletes; also the Games of Mark Spitz\'s seven golds.' },
  { y: 1976, city: 'Montreal', c: 'Canada', note: 'African-led boycott over New Zealand\'s rugby ties to apartheid South Africa; Nadia Comăneci scored the first perfect 10.' },
  { y: 1980, city: 'Moscow', c: 'Soviet Union', note: 'Boycotted by 65 nations over the invasion of Afghanistan — the largest in Olympic history.' },
  { y: 1984, city: 'Los Angeles', c: 'United States', note: 'The Soviet-led return boycott of 1980; these Games turned a profit and invented the modern sponsor-funded model.' },
  { y: 1988, city: 'Seoul', c: 'South Korea', note: 'Ben Johnson\'s 100 m record was annulled for steroids; Florence Griffith-Joyner\'s marks stood.' },
  { y: 1992, city: 'Barcelona', c: 'Spain', note: 'The Dream Team in basketball and a unification moment after East and West Germany competed as one nation again.' },
  { y: 1996, city: 'Atlanta', c: 'United States', note: 'The centennial Games, marking 100 years since Athens 1896; a bomb in Centennial Park cast a shadow.' },
  { y: 2000, city: 'Sydney', c: 'Australia', note: 'Notorious for judging controversies in gymnastics and boxing — and for North and South Korean athletes marching under one flag.' },
  { y: 2004, city: 'Athens', c: 'Greece', note: 'The return home after 108 years; Michael Phelps began his record haul with six golds here.' },
  { y: 2008, city: 'Beijing', c: 'China', note: 'Phelps won eight golds, the most ever by one athlete at a single Games; Usain Bolt began the 100/200/4×100 treble.' },
  { y: 2012, city: 'London', c: 'United Kingdom', note: 'The first city to hold the Summer Games three times; opened with the Queen "parachuting" in with James Bond.' },
  { y: 2016, city: 'Rio de Janeiro', c: 'Brazil', note: 'The first South American Games, hit by the Zika virus debate and a refugee team\'s first march.' },
  { y: 2020, city: 'Tokyo', c: 'Japan', note: 'Held in 2021 behind closed doors — the first Games postponed, not cancelled, in peacetime.' },
  { y: 2024, city: 'Paris', c: 'France', note: 'Events ran through the city\'s landmarks, from beach volleyball at the Eiffel Tower to fencing at the Grand Palais.' },
];

// The next editions: confirmed hosts, but NO results — not yet played.
const NEXT_SUMMER = { y: 2028, city: 'Los Angeles', c: 'United States', note: 'The 2028 Games make Los Angeles a three-time host. Its results are not part of this static record until they are decided.' };

// ── WINTER OLYMPIC GAMES, one entry per scheduled edition ─────────────────────
const WINTER_RAW = [
  { y: 1924, city: 'Chamonix', c: 'France', note: 'Started as "International Winter Sports Week" and recognised as the first Winter Olympics years later.' },
  { y: 1928, city: 'St. Moritz', c: 'Switzerland', note: 'Extreme heat and a late thaw shortened the programme; the bobsleigh four-man went ahead anyway.' },
  { y: 1932, city: 'Lake Placid', c: 'United States', note: 'Depression-era Games a continent away from the European winter-sport powers, with tiny fields.' },
  { y: 1936, city: 'Garmisch-Partenkirchen', c: 'Germany', note: 'The last Winter Games before the war; Canada controversially withdrew its ice-hockey team over eligibility.' },
  { y: 1940, city: 'Sapporo → Garmisch → St. Moritz', c: '—', x: 'cancelled', note: 'Cancelled for the Second World War after the host changed three times in two years.' },
  { y: 1944, city: 'Cortina d\'Ampezzo', c: 'Italy', x: 'cancelled', note: 'Cancelled for the Second World War; Cortina eventually hosted in 1956.' },
  { y: 1948, city: 'St. Moritz', c: 'Switzerland', note: 'The first Winter Games since 1936, run by a neutral Switzerland while Europe rebuilt.' },
  { y: 1952, city: 'Oslo', c: 'Norway', note: 'Winter sport came home to Norway; the torch was lit for the first time in the Sami hearth at Morgedal.' },
  { y: 1956, city: 'Cortina d\'Ampezzo', c: 'Italy', note: 'The first Winter Games televised across borders; the Soviet Union\'s first Winter appearance.' },
  { y: 1960, city: 'Squaw Valley', c: 'United States', note: 'Walt Disney ran the opening ceremony; the 10,000 m speed skate saw the first US gold on the ice.' },
  { y: 1964, city: 'Innsbruck', c: 'Austria', note: 'Saved from a snow shortage by an international call for donated snow; TV satellites beamed it worldwide.' },
  { y: 1968, city: 'Grenoble', c: 'France', note: 'Jean-Claude Killy won three golds; the Games ran entirely within one French valley region.' },
  { y: 1972, city: 'Sapporo', c: 'Japan', note: 'Asia\'s first Winter Games; the ski-jump crowns went to Switzerland and Japan shared the headlines.' },
  { y: 1976, city: 'Innsbruck', c: 'Austria', note: 'Denver won the bidding then declined over public cost; Innsbruck reused its 1964 venues at speed.' },
  { y: 1980, city: 'Lake Placid', c: 'United States', note: 'The "Miracle on Ice" — American college hockey players beat the Soviet Union in the semi-final.' },
  { y: 1984, city: 'Sarajevo', c: 'Yugoslavia', note: 'The gentle Sarajevo Games — a decade later the same mountains were under siege.' },
  { y: 1988, city: 'Calgary', c: 'Canada', note: 'Eddie "the Eagle" Edwards arrived in ski jumping; the bobsleigh boom began on the first natural-ice-free track.' },
  { y: 1992, city: 'Albertville', c: 'France', note: 'The last Winter Games held in the same year as a Summer Games — 1994 broke the pair apart.' },
  { y: 1994, city: 'Lillehammer', c: 'Norway', note: 'The first Winter Games on the new four-year offset cycle, a century after 1894\'s founding congress.' },
  { y: 1998, city: 'Nagano', c: 'Japan', note: 'Ice hockey\'s NHL players debuted; the women\'s team events arrived across several sports.' },
  { y: 2002, city: 'Salt Lake City', c: 'United States', note: 'A bidding scandal had already cost the hosting committee members; the short-track judging controversies followed.' },
  { y: 2006, city: 'Turin', c: 'Italy', note: 'The speed skating oval produced a shower of world records on the low-altitude track.' },
  { y: 2010, city: 'Vancouver', c: 'Canada', note: 'A Georgian luge competitor died in a training run on the eve of the opening ceremony, casting a shadow over the Games.' },
  { y: 2014, city: 'Sochi', c: 'Russia', note: 'The most expensive Games to date, shadowed by a state doping programme later proven by retested samples.' },
  { y: 2018, city: 'PyeongChang', c: 'South Korea', note: 'North and South Korea marched together and fielded a unified women\'s ice-hockey team.' },
  { y: 2022, city: 'Beijing', c: 'China', note: 'The first city to host both Summer and Winter Games; snow made artificially for a warm-weather Winter Olympics.' },
];

const NEXT_WINTER = { y: 2026, city: 'Milano & Cortina', c: 'Italy', note: 'The 2026 Games in Milan and Cortina are not part of this static record until they are decided and verifiable.' };

// ── The settled superlatives every source agrees on ───────────────────────────
const FACTS = [
  { t: 'The most-decorated Olympian', s: 'Swimmer Michael Phelps (United States) holds 28 Olympic medals, 23 of them gold — more than any athlete from any country in the history of the modern Games.' },
  { t: 'Who tops the Summer table', s: 'The United States leads the all-time Summer Olympic medal table in both total medals and golds, a position it has held since the very first count.' },
  { t: 'Who tops the Winter table', s: 'Norway leads the all-time Winter Olympic medal table — from a country of barely five million people.' },
  { t: 'The thrice-summer cities', s: 'London was the first city to host the Summer Games three times (1908, 1948, 2012); Los Angeles joins the three-time club in 2028, after 1932 and 1984.' },
  { t: 'Games the wars erased', s: 'Five editions were cancelled by the world wars — Summer 1916, 1940 and 1944, Winter 1940 and 1944 — and the numbering simply carried on without them.' },
];

// ── Stable lookup + helpers ────────────────────────────────────────────────────
const SUMMER = SUMMER_RAW.map((g) => ({ ...g, slug: String(g.y) }));
const WINTER = WINTER_RAW.map((g) => ({ ...g, slug: String(g.y) }));
const S_BY_YEAR = new Map(SUMMER.map((g) => [g.y, g]));
const W_BY_YEAR = new Map(WINTER.map((g) => [g.y, g]));

function findGames(season, year) {
  const m = season === 'winter' ? W_BY_YEAR : S_BY_YEAR;
  return m.get(Number(year)) || null;
}

module.exports = {
  SUMMER, WINTER, FACTS, NEXT_SUMMER, NEXT_WINTER, slugify,
  findGames,
};
