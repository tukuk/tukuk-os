'use strict';
// ── TUKUK-OS FILMS (/movies) — Notable Films of the World ─────────────────────
// STATIC embedded data — no runtime API call, so a page can never 503 and never
// depends on an upstream. Every field is a stable, widely-documented FACT: release
// year, director, country of origin, primary language, running time (the common
// theatrical cut), genres and any major prize. The one-paragraph synopsis is our own
// plain-English description of the film's premise (no spoiler endings). We deliberately
// publish NO star-ratings or box-office totals, because those drift and are unverifiable
// offline — an honest page about what a film IS, not a score it does not have.
// English/global by design; film is among the world's most-searched subjects. Titles
// span many countries and languages so no single national cinema dominates.
// Facts (titles, dates, names) are not copyrightable; all descriptive text is original.

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// t=title, y=year, d=director, c=country, l=language, rt=running time (min),
// g=genres, aw=notable prize (optional, factual), s=original synopsis.
const FILMS_RAW = [
  { t: 'Citizen Kane', y: 1941, d: 'Orson Welles', c: 'United States', l: 'English', rt: 119, g: ['Drama', 'Mystery'], s: 'A reporter traces the last word of a dying newspaper magnate, and the search reassembles a life of wealth, ambition and loss told out of order from several points of view.' },
  { t: 'Casablanca', y: 1942, d: 'Michael Curtiz', c: 'United States', l: 'English', rt: 102, g: ['Romance', 'Drama', 'War'], aw: 'Academy Award for Best Picture', s: 'In wartime Casablanca a cynical nightclub owner must choose between the woman he still loves and helping her and her husband, a resistance leader, escape to continue the fight.' },
  { t: '12 Angry Men', y: 1957, d: 'Sidney Lumet', c: 'United States', l: 'English', rt: 96, g: ['Drama', 'Crime'], s: 'A single holdout juror tries to persuade eleven others to look again at the evidence in an apparently open-and-shut murder case, all but entirely inside one hot room.' },
  { t: 'Vertigo', y: 1958, d: 'Alfred Hitchcock', c: 'United States', l: 'English', rt: 128, g: ['Mystery', 'Thriller', 'Romance'], s: 'A detective whose fear of heights ends his career becomes obsessed with a woman who seems to change identity, in a story about memory, grief and manufactured desire.' },
  { t: 'Seven Samurai', y: 1954, d: 'Akira Kurosawa', c: 'Japan', l: 'Japanese', rt: 207, g: ['Action & Adventure', 'Drama'], s: 'A farming village hires a band of masterless samurai to defend it from raiders, and the film follows the uneasy alliance between hired warriors and the people they protect.' },
  { t: 'Rashomon', y: 1950, d: 'Akira Kurosawa', c: 'Japan', l: 'Japanese', rt: 88, g: ['Crime', 'Mystery', 'Drama'], aw: 'Golden Lion, Venice', s: 'Several witnesses each tell a self-serving version of the same crime in the woods, so the truth of what happened dissolves into the motives of whoever is narrating it.' },
  { t: 'Lawrence of Arabia', y: 1962, d: 'David Lean', c: 'United Kingdom', l: 'English', rt: 228, g: ['Action & Adventure', 'History', 'War'], aw: 'Academy Award for Best Picture', s: 'A sweeping account of a British officer who unites Arabian tribes against the Ottoman Empire in the First World War, and the mythology and loneliness the fame brings him.' },
  { t: 'Psycho', y: 1960, d: 'Alfred Hitchcock', c: 'United States', l: 'English', rt: 109, g: ['Horror', 'Thriller'], s: 'A woman who checks into a remote motel run by a nervous young man under his mother\u2019s thumb disappears, and the film pulls the ground out from under the audience early on.' },
  { t: '2001: A Space Odyssey', y: 1968, d: 'Stanley Kubrick', c: 'United Kingdom', l: 'English', rt: 149, g: ['Sci-Fi & Fantasy'], s: 'From prehistoric tools to a Jupiter-bound mission and a malfunctioning ship computer, a slow, largely wordless meditation on technology and human evolution, adapted with Arthur C. Clarke.' },
  { t: 'Star Wars', y: 1977, d: 'George Lucas', c: 'United States', l: 'English', rt: 121, g: ['Sci-Fi & Fantasy', 'Action & Adventure'], s: 'A farm boy joins a rebellion against a galactic empire and discovers his lineage in a space fairy tale of knights, smugglers and a mystical energy field, the film that rebuilt the blockbuster.' },
  { t: 'The Godfather', y: 1972, d: 'Francis Ford Coppola', c: 'United States', l: 'English', rt: 175, g: ['Crime', 'Drama'], aw: 'Academy Award for Best Picture', s: 'The aging head of a crime dynasty hands his business to a family, and the reluctant son who wanted out becomes the most dangerous of them all in a study of power and inheritance.' },
  { t: 'Modern Times', y: 1936, d: 'Charlie Chaplin', c: 'United States', l: 'English', rt: 87, g: ['Comedy', 'Drama'], s: 'A factory worker ground up by the assembly line drifts through poverty and odd jobs with a runaway, a silent-era comedy about machines, work and staying human.' },
  { t: 'Breathless', y: 1960, d: 'Jean-Luc Godard', c: 'France', l: 'French', rt: 90, g: ['Crime', 'Drama'], s: 'A small-time thief on the run and an American student in Paris talk, flirt and drift through a loose, jump-cut story that became a founding film of the French New Wave.' },
  { t: 'Amélie', y: 2001, d: 'Jean-Pierre Jeunet', c: 'France', l: 'French', rt: 122, g: ['Comedy', 'Romance'], s: 'A shy Parisian waitress decides to secretly improve the lives of the people around her, and has to learn to reach out and let someone change her own.' },
  { t: 'Life Is Beautiful', y: 1997, d: 'Roberto Benigni', c: 'Italy', l: 'Italian', rt: 116, g: ['Comedy', 'Drama', 'War'], aw: 'Academy Award for Best Picture', s: 'A waiter uses jokes and games to shield his young son from the horror of a concentration camp, turning unbearable circumstances into a father\u2019s protective imagination.' },
  { t: 'Schindler\u2019s List', y: 1993, d: 'Steven Spielberg', c: 'United States', l: 'English', rt: 195, g: ['War', 'Drama', 'History'], aw: 'Academy Award for Best Picture', s: 'A German industrialist who profited from the war comes to spend his fortune protecting the Jewish workers he once exploited, filmed in stark black and white.' },
  { t: 'Pulp Fiction', y: 1994, d: 'Quentin Tarantino', c: 'United States', l: 'English', rt: 154, g: ['Crime', 'Drama'], aw: 'Palme d\u2019Or, Cannes', s: 'Hitmen, a boxer, a gangster\u2019s wife and two robbers cross paths in interlocking, out-of-chronology stories crackling with dialogue and sudden violence.' },
  { t: 'The Shawshank Redemption', y: 1994, d: 'Frank Darabont', c: 'United States', l: 'English', rt: 142, g: ['Drama', 'Crime'], s: 'A banker wrongly imprisoned for life keeps a quiet inner freedom over decades, befriending a fellow inmate and quietly planning something the walls cannot hold.' },
  { t: 'Forrest Gump', y: 1994, d: 'Robert Zemeckis', c: 'United States', l: 'English', rt: 142, g: ['Drama', 'Romance', 'Comedy'], aw: 'Academy Award for Best Picture', s: 'A good-natured man from Alabama drifts through the biggest American events of the late twentieth century, always circling back to the friend he has loved since childhood.' },
  { t: 'The Silence of the Lambs', y: 1991, d: 'Jonathan Demme', c: 'United States', l: 'English', rt: 118, g: ['Crime', 'Thriller', 'Horror'], aw: 'Academy Award for Best Picture', s: 'An FBI trainee seeks the help of a brilliant, imprisoned former psychiatrist to catch another killer, in a cat-and-mouse thriller built on a disturbing exchange of confidences.' },
  { t: 'Gladiator', y: 2000, d: 'Ridley Scott', c: 'United States', l: 'English', rt: 155, g: ['Action & Adventure', 'Drama', 'History'], aw: 'Academy Award for Best Picture', s: 'A betrayed Roman general is enslaved and rises through the arena as a gladiator, seeking revenge against the emperor who destroyed his family.' },
  { t: 'Titanic', y: 1997, d: 'James Cameron', c: 'United States', l: 'English', rt: 195, g: ['Romance', 'Drama', 'History'], aw: 'Academy Award for Best Picture', s: 'A class-crossing love story set against the building and sinking of the great ship, framed by an elderly survivor\u2019s memory of the voyage.' },
  { t: 'Avatar', y: 2009, d: 'James Cameron', c: 'United States', l: 'English', rt: 162, g: ['Sci-Fi & Fantasy', 'Action & Adventure'], s: 'On a lush alien moon, a paralysed marine pilots an engineered body to infiltrate its people, and ends up siding with them against the mining operation he came for. At its release it became the highest-grossing film ever made.' },
  { t: 'The Lord of the Rings: The Return of the King', y: 2003, d: 'Peter Jackson', c: 'New Zealand', l: 'English', rt: 201, g: ['Fantasy', 'Action & Adventure'], aw: 'Academy Award for Best Picture', s: 'The closing chapter of the quest to destroy a powerful ring, as the forces of one side rally against overwhelming darkness while two hobbits reach the heart of the enemy.' },
  { t: 'Inception', y: 2010, d: 'Christopher Nolan', c: 'United States', l: 'English', rt: 148, g: ['Sci-Fi & Fantasy', 'Thriller', 'Action & Adventure'], s: 'A team that can enter and steal ideas from dreams is hired to plant one instead, folding several dream-levels inside each other against a ticking clock.' },
  { t: 'The Dark Knight', y: 2008, d: 'Christopher Nolan', c: 'United States', l: 'English', rt: 152, g: ['Action & Adventure', 'Crime', 'Thriller'], aw: 'Academy Award for Best Supporting Actor (posthumous)', s: 'A masked vigilante is pushed to his moral limit by an anarchist criminal who wants to prove that anyone can be corrupted, over a city tested by escalating chaos.' },
  { t: 'Interstellar', y: 2014, d: 'Christopher Nolan', c: 'United States', l: 'English', rt: 169, g: ['Sci-Fi & Fantasy', 'Drama', 'Action & Adventure'], s: 'As Earth\u2019s crops fail, a pilot leaves his children behind to travel through a wormhole in search of a new home, with time itself pulling them apart.' },
  { t: 'Whiplash', y: 2014, d: 'Damien Chazelle', c: 'United States', l: 'English', rt: 106, g: ['Drama', 'Musical'], s: 'A young drummer enrolled in a cut-throat music conservatory is driven by an abusive instructor, in a tense study of ambition and what greatness costs.' },
  { t: 'La La Land', y: 2016, d: 'Damien Chazelle', c: 'United States', l: 'English', rt: 128, g: ['Musical', 'Romance', 'Comedy'], s: 'A jazz pianist and an actress fall in love while chasing their careers in Los Angeles, in a modern musical that weighs dreams against the people in them.' },
  { t: 'Mad Max: Fury Road', y: 2015, d: 'George Miller', c: 'Australia', l: 'English', rt: 120, g: ['Action & Adventure', 'Sci-Fi & Fantasy'], s: 'In a desert wasteland a drifter and a rebel driver flee a warlord with a group of captives in one long, practical-effects chase across the sands.' },
  { t: 'WALL\u2019·E', y: 2008, d: 'Andrew Stanton', c: 'United States', l: 'English', rt: 98, g: ['Animation', 'Sci-Fi & Fantasy', 'Romance'], aw: 'Academy Award for Best Animated Feature', s: 'A lone waste-compacting robot left tidying a deserted Earth falls for a visiting probe, and follows her off-planet to wake a complacent humanity up.' },
  { t: 'Toy Story', y: 1995, d: 'John Lasseter', c: 'United States', l: 'English', rt: 81, g: ['Animation', 'Comedy', 'Action & Adventure'], s: 'The toys in a boy\u2019s room come alive when he is away, and a lonesome cowboy and a space-action figure turn from rivals to friends, in the first full-length computer-animated feature.' },
  { t: 'Princess Mononoke', y: 1997, d: 'Hayao Miyazaki', c: 'Japan', l: 'Japanese', rt: 134, g: ['Animation', 'Fantasy', 'Action & Adventure'], s: 'Cursed on behalf of his village, a young man is drawn between the gods of a forest and the iron-working people felling it, in an epic about nature and industry.' },
  { t: 'My Neighbor Totoro', y: 1988, d: 'Hayao Miyazaki', c: 'Japan', l: 'Japanese', rt: 86, g: ['Animation', 'Fantasy', 'Comedy'], s: 'Two sisters move to the countryside near their mother\u2019s hospital and meet the gentle forest spirits living in the great tree by their house.' },
  { t: 'Spirited Away', y: 2001, d: 'Hayao Miyazaki', c: 'Japan', l: 'Japanese', rt: 125, g: ['Animation', 'Fantasy'], aw: 'Academy Award for Best Animated Feature; Golden Bear, Berlin', s: 'A sullen girl who wanders into a spirit world must work in a bathhouse for gods and monsters and find a way to free herself and her parents.' },
  { t: 'Parasite', y: 2019, d: 'Bong Joon-ho', c: 'South Korea', l: 'Korean', rt: 132, g: ['Thriller', 'Drama', 'Comedy'], aw: 'Academy Award for Best Picture; Palme d\u2019Or, Cannes', s: 'A struggling family schemes their way one by one into the household of a wealthy one, until the arrangement uncovers something hidden beneath the house and beneath the class divide.' },
  { t: 'Oldboy', y: 2003, d: 'Park Chan-wook', c: 'South Korea', l: 'Korean', rt: 120, g: ['Mystery', 'Thriller', 'Drama'], aw: 'Grand Prix, Cannes', s: 'A man is imprisoned for years without knowing why, then released with days to find his captor, in a revenge story that turns on a cruel revelation.' },
  { t: 'City of God', y: 2002, d: 'Fernando Meirelles', c: 'Brazil', l: 'Portuguese', rt: 130, g: ['Crime', 'Drama'], s: 'Growing up in a rough Rio de Janeiro shantytown across two decades, an aspiring photographer watches his neighbourhood be taken over by gangs and drug money.' },
  { t: 'Pan\u2019s Labyrinth', y: 2006, d: 'Guillermo del Toro', c: 'Spain', l: 'Spanish', rt: 118, g: ['Fantasy', 'Drama', 'War'], s: 'In post-war Spain a girl moves with her pregnant mother to her cruel stepfather\u2019s military outpost, and a nearby labyrinth offers her a dark fairy-tale task.' },
  { t: 'Roma', y: 2018, d: 'Alfonso Cuar\u00f3n', c: 'Mexico', l: 'Spanish', rt: 135, g: ['Drama', 'History'], aw: 'Academy Award for Best Director', s: 'A year in the life of a domestic worker for a middle-class family in 1970s Mexico City, filmed in black-and-white close to the director\u2019s own childhood.' },
  { t: 'Cinema Paradiso', y: 1988, d: 'Giuseppe Tornatore', c: 'Italy', l: 'Italian', rt: 155, g: ['Drama', 'Comedy', 'Romance'], aw: 'Academy Award for Best Foreign Language Film', s: 'A film director remembers the boy he was in a small Sicilian town, the projectionist who let him into the picture house, and the cinema that shaped his life.' },
];

// Stable slug + lookup + grouping.
const FILMS = FILMS_RAW.map((f) => ({ ...f, slug: slugify(f.t) }));
const F_BY_SLUG = new Map(FILMS.map((f) => [f.slug, f]));

// Genres, each mapped to the films tagged with it, in a fixed display order.
const GENRE_ORDER = ['Drama', 'Comedy', 'Romance', 'Action & Adventure', 'Crime', 'Thriller', 'Mystery', 'Horror', 'Sci-Fi & Fantasy', 'Fantasy', 'Animation', 'War', 'History', 'Musical'];
const GENRES = GENRE_ORDER
  .map((name) => ({ name, slug: slugify(name), items: FILMS.filter((f) => f.g.includes(name)).sort((a, b) => a.y - b.y) }))
  .filter((gr) => gr.items.length);

// Decades let a visitor browse "the 1990s" etc. oldest-first.
const DECADES = (() => {
  const m = new Map();
  for (const f of FILMS) {
    const d = Math.floor(f.y / 10) * 10;
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(f);
  }
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([d, items]) => ({ start: d, end: d + 9, label: `the ${d}s`, items: items.sort((a, b) => a.y - b.y) }));
})();

function findFilm(slug) { return F_BY_SLUG.get(String(slug || '').toLowerCase()) || null; }
function findGenre(slug) { const gr = GENRES.find((x) => x.slug === String(slug || '').toLowerCase()); return gr || null; }
// Films sharing the most genres with f, excluding itself — for "more like this".
function relatedFilms(f, n) {
  return FILMS
    .filter((x) => x.slug !== f.slug)
    .map((x) => ({ x, score: x.g.filter((g) => f.g.includes(g)).length + (Math.abs(x.y - f.y) <= 5 ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n || 6)
    .map((o) => o.x);
}

module.exports = {
  FILMS, GENRES, DECADES, slugify,
  findFilm, findGenre, relatedFilms,
};
