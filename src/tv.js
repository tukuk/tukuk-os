'use strict';
// ── TUKUK-OS TV SERIES (/movies/tv) — Notable Television Series of the World ───
// STATIC embedded data — no runtime API call, so a page can never 503 and never
// depends on an upstream. Every field is a stable, widely-documented FACT: original
// run of years, creator, country, language, original network, series/season and
// episode counts and genres. The one-paragraph blurb is our own plain-English
// description of the show's premise. We publish NO star-ratings, NO viewership
// figures except for the few records every source agrees on, and nothing about a
// series still in production beyond its announced run. Facts are not copyrightable;
// all descriptive text is original. English/global by design; the list spans Japan,
// India, Colombia, Denmark, Germany, Spain, France, South Korea and Turkey as well
// as the UK and the United States, because the most-watched television in history
// was not all made in Hollywood.

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// t=title, y=years string, d=creator(s), c=country, l=language, n=original network,
// se=seasons (string, honest about ongoing runs), ep=episodes or null, g=genres,
// s=original premise text, f=an agreed record or fact (optional).
const SHOWS_RAW = [
  { t: 'I Love Lucy', y: '1951–1957', d: 'Jess Oppenheimer', c: 'United States', l: 'English', n: 'CBS', se: '6 seasons', ep: 180, g: ['Comedy'], s: 'A club singer married to bandleader Ricky gets into one scheme after another — a job, a show, a trip — and every plan turns to chaos on the couch and at the Vitameatavegamin counter.', f: 'Filmed before a live audience with three cameras, the setup every sitcom copied afterwards.' },
  { t: 'Doctor Who', y: '1963–1989, 2005–', d: 'BBC team led by Sydney Newman', c: 'United Kingdom', l: 'English', n: 'BBC', se: 'two production eras', ep: null, g: ['Sci-Fi & Fantasy', 'Drama', 'Action & Adventure'], s: 'A Time Lord who calls themselves the Doctor travels in the TARDIS — a ship bigger inside than out — with human companions through history, other planets and the far future, fighting Daleks, Cybermen and quieter menaces.', f: 'The longest-running science-fiction television series in the world.' },
  { t: 'Monty Python’s Flying Circus', y: '1969–1974', d: 'the Python troupe', c: 'United Kingdom', l: 'English', n: 'BBC', se: '4 series', ep: 45, g: ['Comedy'], s: 'Sketches that refuse to end, cut to absurdity, and walk into each other — the ministry of 42, the dead parrot, a knight who beats people with a herring — read by animators and a man saying "and now for something completely different".', f: null },
  { t: 'Fawlty Towers', y: '1975–1979', d: 'John Cleese & Connie Booth', c: 'United Kingdom', l: 'English', n: 'BBC', se: '2 series', ep: 12, g: ['Comedy'], s: 'Basil Fawlty, rude and desperate to keep up appearances, runs a seaside hotel with his wife Sybil and a waiting staff that includes Manuel, who speaks no English and is shouted at in all of them.', f: 'Twelve episodes in total; regularly voted the best British comedy series.' },
  { t: 'M*A*S*H', y: '1972–1983', d: 'Larry Gelbart (from the film)', c: 'United States', l: 'English', n: 'CBS', se: '11 seasons', ep: 251, g: ['Comedy', 'Drama', 'War'], s: 'Army surgeons in a mobile hospital during the Korean War keep their sanity with pranks, football and camp humour while the operating tent never stops arriving with wounded.', f: 'Its finale is one of the most-watched scripted broadcasts in American television history.' },
  { t: 'Seinfeld', y: '1989–1998', d: 'Jerry Seinfeld & Larry David', c: 'United States', l: 'English', n: 'NBC', se: '9 seasons', ep: 180, g: ['Comedy'], s: 'A comedian and his friends in New York argue about nothing much — double-dipping, shirt tags, parking spots — and never learn anything from any of it, because the show famously refused to let its characters be nice.', f: 'Billed as "a show about nothing".' },
  { t: 'Friends', y: '1994–2004', d: 'David Crane & Marta Kauffman', c: 'United States', l: 'English', n: 'NBC', se: '10 seasons', ep: 236, g: ['Comedy', 'Romance'], s: 'Six people in their twenties and thirties spend almost every hour of their lives at the same coffee house and across the hall from each other in Manhattan, pairing up, breaking up and failing at jobs.', f: null },
  { t: 'The Simpsons', y: '1989–', d: 'Matt Groening', c: 'United States', l: 'English', n: 'Fox', se: '35+ seasons (ongoing)', ep: 800, g: ['Animation', 'Comedy'], s: 'Homer, Marge, Bart, Lisa and Maggie Simpson get through small-town life in Springfield with donuts, a nuclear power plant and a permanent sense that nothing will really change.', f: 'The longest-running primetime scripted series in American television.' },
  { t: 'The Wire', y: '2002–2008', d: 'David Simon', c: 'United States', l: 'English', n: 'HBO', se: '5 seasons', ep: 60, g: ['Crime', 'Drama'], s: 'A drug investigation in Baltimore turns into a portrait of the whole city — dealers and detectives, docks, politicians, schools and newspapers — with no one spared and no easy heroes.', f: null },
  { t: 'Breaking Bad', y: '2008–2013', d: 'Vince Gilligan', c: 'United States', l: 'English', n: 'AMC', se: '5 seasons', ep: 62, g: ['Crime', 'Drama', 'Thriller'], s: 'A New Mexico chemistry teacher given a terminal diagnosis starts cooking meth to leave money behind, and keeps going long after the reason stops being his family.', f: null },
  { t: 'Game of Thrones', y: '2011–2019', d: 'David Benioff & D. B. Weiss (from George R. R. Martin)', c: 'United States', l: 'English', n: 'HBO', se: '8 seasons', ep: 73, g: ['Fantasy', 'Drama', 'Action & Adventure'], s: 'Noble families fight for the Iron Throne of the Seven Kingdoms while an older threat builds in the far north beyond a great wall of ice, and no favourite is safe.', f: null },
  { t: 'Band of Brothers', y: '2001', d: 'from the book by Stephen E. Ambrose', c: 'United States & United Kingdom', l: 'English', n: 'HBO', se: 'miniseries', ep: 10, g: ['War', 'Drama', 'History'], s: 'Easy Company of the 506th Parachute Infantry Regiment is trained for D-Day and follows the same men from Normandy to the end of the war, from one survivor account at a time.', f: 'Executive produced by Steven Spielberg and Tom Hanks.' },
  { t: 'Chernobyl', y: '2019', d: 'Craig Mazin', c: 'United States & United Kingdom', l: 'English', n: 'HBO / Sky', se: 'miniseries', ep: 5, g: ['History', 'Drama', 'Thriller'], s: 'The 1986 reactor explosion and the people — physicists, miners, firefighters and liquidators — sent to contain it, and a system that punished whoever told it the truth.', f: null },
  { t: 'Sherlock', y: '2010–2017', d: 'Mark Gatiss & Steven Moffat', c: 'United Kingdom', l: 'English', n: 'BBC', se: '4 series', ep: 13, g: ['Crime', 'Mystery', 'Drama'], s: 'A consulting detective in modern London and his doctor flatmate solve cases by text message, black cabs and humiliation, with one antagonist they never quite finish.', f: null },
  { t: 'The Office (UK)', y: '2001–2003', d: 'Ricky Gervais & Stephen Merchant', c: 'United Kingdom', l: 'English', n: 'BBC', se: '2 series + 2 specials', ep: 14, g: ['Comedy'], s: 'A paper-company branch managed by a man who should not be managing anything, filmed as a documentary crew that gradually wishes it had stayed home.', f: 'Adapted into the long-running US version.' },
  { t: 'Oshin', y: '1983–1984', d: 'Ayako Hashida', c: 'Japan', l: 'Japanese', n: 'NHK', se: 'one morning serial (renzoku television shōsetsu)', ep: 297, g: ['Drama', 'History'], s: 'The life of a Japanese woman from a poor farming village through war, loss and rebuilding a business, told across the short daily episodes NHK built its mornings around.', f: 'Broadcast in over 60 countries; among the most-watched dramas ever made.' },
  { t: 'Ramayan', y: '1987–1988', d: 'Ramanand Sagar', c: 'India', l: 'Hindi', n: 'Doordarshan', se: 'one serial', ep: 78, g: ['Drama', 'History', 'Fantasy'], s: 'The epic of Rama — exile, the abduction of Sita and the war to bring her back — staged week by week for a nation that stopped every Sunday evening to watch it on the state channel.', f: 'Regularly described among the most-watched television programmes in history.' },
  { t: 'Yo soy Betty, la fea', y: '1999–2001', d: 'Fernando Gaitán', c: 'Colombia', l: 'Spanish', n: 'RCN', se: 'one telenovela', ep: 189, g: ['Comedy', 'Romance', 'Drama'], s: 'An unglamorous, brilliant economist is hired to run the accounts of a fashion house that mocks her appearance, and the man who mocks her falls for the mind he could not see.', f: 'Holds the Guinness record as the most successful Spanish-language telenovela; adapted around the world, including as Ugly Betty.' },
  { t: 'Dark', y: '2017–2020', d: 'Baran bo Odar & Jantje Friese', c: 'Germany', l: 'German', n: 'Netflix', se: '3 seasons', ep: 26, g: ['Sci-Fi & Fantasy', 'Mystery', 'Thriller'], s: 'When children start vanishing in a small German town, four families discover the disappearances loop through time, and the people causing it may be the same people trapped by it.', f: 'Netflix’s first original German series.' },
  { t: 'Money Heist', y: '2017–2021', d: 'Álex Pina', c: 'Spain', l: 'Spanish', n: 'Antena 3, then Netflix', se: '5 parts', ep: 41, g: ['Crime', 'Drama', 'Thriller'], s: 'A strategist who calls himself the Professor recruits eight people with nothing to lose to occupy the Royal Mint of Spain and print the money rather than steal it, while everyone uses city names as aliases.', f: 'One of the most-watched non-English series ever distributed.' },
  { t: 'Lupin', y: '2021–', d: 'George Kay', c: 'France', l: 'French', n: 'Netflix', se: '3 parts (ongoing)', ep: null, g: ['Crime', 'Drama', 'Thriller'], s: 'A thief from the projects in Paris takes on the name of the famous gentleman burglar Arsène Lupin to get revenge for his father, and plans each heist one public humiliation ahead of the police.', f: null },
  { t: 'Borgen', y: '2010–2022', d: 'Adam Price', c: 'Denmark', l: 'Danish', n: 'DR', se: '3 seasons', ep: 30, g: ['Drama', 'History'], s: 'A minor party leader unexpectedly becomes Denmark’s first female prime minister and learns, session by session, what keeping the coalition together costs a person who started with convictions.', f: null },
  { t: 'Squid Game', y: '2021–2025', d: 'Hwang Dong-hyuk', c: 'South Korea', l: 'Korean', n: 'Netflix', se: '3 seasons', ep: null, g: ['Thriller', 'Drama', 'Crime'], s: 'Debt-ruined competitors accept an invitation to play children’s games for money, under a masked production where losing means dying, and one player keeps trying to burn the whole operation down.', f: 'Netflix’s most-watched series at its release.' },
  { t: 'Diriliş: Ertuğrul', y: '2014–2019', d: 'Mehmet Bozdağ', c: 'Turkey', l: 'Turkish', n: 'TRT 1', se: '5 seasons', ep: 149, g: ['History', 'Drama', 'Action & Adventure'], s: 'A 13th-century Oghuz tribal leader holds his people together between the Seljuk court, the Byzantines, the Mongols and the Knights Templar, and lays the groundwork for a dynasty.', f: 'Sold to dozens of countries; among the most exported Turkish series.' },
  { t: 'Elite', y: '2018–2024', d: 'Carlos Montero & Darío Madrona', c: 'Spain', l: 'Spanish', n: 'Netflix', se: '7 seasons', ep: 56, g: ['Drama', 'Thriller', 'Crime'], s: 'Three working-class students on scholarship into a private elite school in Las Encinas end up inside a murder investigation where almost everyone had a motive and a secret.', f: null },
];

// Stable slug + lookup + grouping.
const SHOWS = SHOWS_RAW.map((s) => ({ ...s, slug: slugify(s.t) }));
const S_BY_SLUG = new Map(SHOWS.map((s) => [s.slug, s]));

// Genres reuse the film vocabulary so /movies can cross-link into both lists.
const TV_GENRE_ORDER = ['Comedy', 'Drama', 'Crime', 'Thriller', 'Mystery', 'Sci-Fi & Fantasy', 'Fantasy', 'Romance', 'War', 'History', 'Animation', 'Action & Adventure'];
const TV_GENRES = TV_GENRE_ORDER
  .map((name) => ({ name, slug: slugify(name), items: SHOWS.filter((s) => s.g.includes(name)).sort((a, b) => a.y.localeCompare(b.y)) }))
  .filter((gr) => gr.items.length);

// Countries of origin, for the "made all over the world" angle.
const TV_COUNTRIES = (() => {
  const m = new Map();
  for (const s of SHOWS) {
    const k = s.c;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([name, items]) => ({ name, items }));
})();

function findShow(slug) { return S_BY_SLUG.get(String(slug || '').toLowerCase()) || null; }
function findTvGenre(slug) { const g = TV_GENRES.find((x) => x.slug === String(slug || '').toLowerCase()); return g || null; }

module.exports = {
  SHOWS, TV_GENRES, TV_COUNTRIES, slugify,
  findShow, findTvGenre,
};
