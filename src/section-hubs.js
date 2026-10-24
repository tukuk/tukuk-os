'use strict';
// ── Section hub documents ───────────────────────────────────────────────────────
// The corpus held blog posts and the geo clusters, nothing else. So a search for
// "weather", "holidays" or "how many countries" never reached our own front doors — it
// reached the BBC and the Olympics page instead, even though the answer is on a page we
// serve ourselves. These are those front doors, described for the index.
//
// Two rules:
//   • Every number is read from the list the page renders (a country added to the data
//     changes the sentence with it) — nothing here is typed in by hand and left to drift.
//   • English only, and every sentence is something the visitor could have typed, the same
//     shape as faqLines() in cluster-index.js.

const ng = require('./negara');
const cu = require('./cuti');
const gp = require('./gempa');
const udara = require('./udara');
const bk = require('./books');
const rcp = require('./recipes');

/**
 * The front doors by path. One list, used twice: every document below is built from one of
 * these, and a test keeps them in step — the urls in the objects and this list must not drift.
 */
const HUB_PATHS = [
  '/countries', '/weather', '/earthquakes', '/holidays', '/statistics',
  '/disasters', '/flags', '/maps', '/air-quality', '/academy', '/books', '/recipes'
];

/**
 * True when the query is nothing but the name of a front door — "weather", "air quality".
 * A visitor typing that is navigating, not searching: they want that page, and /search uses
 * this to leave page one in Meilisearch's order instead of handing it to the embedding
 * reranker, which scores a news article about the weather as close to "weather" as the page
 * that serves the weather (and then decides by chance).
 * @param {string} text
 */
function isHubName(text) {
  const norm = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return HUB_PATHS.some((path) => path.slice(1).replace(/-/g, ' ') === norm);
}

/**
 * Build the section-hub documents.
 * @param {object} logger used only to report a data source that was unreachable.
 * @returns {Promise<Array<{url,title,description,lines,keywords}>>}
 */
async function sectionHubs(logger = console) {
  let countries = [];
  try {
    countries = await ng.loadCountries();
  } catch (error) {
    // The hubs are still worth indexing without a count; say so rather than invent one.
    if (logger && logger.warn) logger.warn(`[section-hubs] country list unavailable: ${error.message}`);
  }
  const n = countries.length;
  const regions = ng.REGIONS.map((r) => r.en).join(', ');
  const decades = `${cu.YEAR_MIN} and ${cu.YEAR_MAX}`;

  return [
    {
      url: '/countries',
      title: 'Countries of the World — capital, population, GDP and flag',
      description: 'A profile of every country on earth: capital, population, GDP, flag and land borders.',
      lines: [
        n ? `How many countries are there in the world? This site profiles ${n} countries and territories.` : '',
        'Every country page lists its capital, population, GDP, flag and land borders.',
        `Countries are grouped by region: ${regions}.`,
      ],
      keywords: ['countries', 'country', 'capital', 'population', 'gdp', 'flag', 'borders', 'region'],
    },
    {
      url: '/weather',
      title: 'World Weather — current conditions, forecast and map',
      description: 'World weather: current conditions and forecasts for cities everywhere, a live map, extremes, clouds, wind and the meaning of warning codes.',
      lines: [
        'What is the weather like today? These pages give the current conditions and a forecast for cities all over the world, plus a weather map, extremes, cloud cover and wind.',
        'Warning codes are explained in plain English, so a red alert from a foreign weather service reads as something more useful than a colour.',
      ],
      keywords: ['weather', 'forecast', 'temperature', 'rain', 'wind', 'clouds', 'weather map', 'warnings'],
    },
    {
      url: '/earthquakes',
      title: 'World Earthquakes — live USGS feed',
      description: 'Live earthquakes from the USGS feed: magnitude, depth, place and time, by region, plus an explanation of how earthquakes work.',
      lines: [
        'Which earthquakes happened today? This page shows the live earthquake feed for the last 24 hours, newest first.',
        `Regions covered: ${gp.REGIONS.map((r) => r.name).join('; ')}.`,
        'Every event lists magnitude, depth, the nearest place and the time, with a link to the USGS record it came from.',
      ],
      keywords: ['earthquake', 'earthquakes', 'quake', 'seismic', 'magnitude', 'usgs', 'richter', 'epicentre'],
    },
    {
      url: '/holidays',
      title: 'Public Holidays of the World',
      description: `Public holidays by country and region for ${decades}, with long weekends and the rules behind each date.`,
      lines: [
        `Which public holidays are coming up in ${cu.YEAR_MIN}? This section lists the public holidays in the world for ${decades}, by country and region.`,
        'Long weekends are counted out from the real calendar dates, not copied from a list.',
        'The explained page covers why the dates move — lunar calendars, equinoxes and government decrees.',
      ],
      keywords: ['holidays', 'public holiday', 'calendar', 'long weekend', 'festival', 'bank holiday'],
    },
    {
      url: '/statistics',
      title: 'World Statistics — country rankings',
      description: 'World statistics and country rankings: population, area, density and the socioeconomic numbers behind each profile.',
      lines: [
        'Which country has the largest population? The statistics pages rank countries against each other on population, area, density and output.',
        'The figures come from public datasets and are labelled on the page, so a number can always be traced back to its source.',
      ],
      keywords: ['statistics', 'rankings', 'population', 'density', 'area', 'gdp', 'data'],
    },
    {
      url: '/disasters',
      title: 'Disasters Tracker — active natural events around the world',
      description: 'Active natural disasters around the world: wildfires, storms, floods and volcanic activity, tracked from public feeds.',
      lines: [
        'Which natural disasters are happening right now? The disaster tracker lists active events from public feeds.',
        'Wildfires, storms, floods and volcanic activity are grouped so a single event can be followed as it develops.',
      ],
      keywords: ['disaster', 'disasters', 'wildfire', 'storm', 'flood', 'volcano', 'emergency', 'natural hazard'],
    },
    {
      url: '/flags',
      title: 'Flags of the World — every flag, its story and a quiz',
      description: 'Every national flag with its colours, proportions and history, a flag quiz to test yourself, and a studio to design your own.',
      lines: [
        n ? `How many flags are there in the world? One for each of the ${n} countries and territories on this site.` : '',
        'Each flag page gives its colours, proportions and the story behind the design.',
        'The quiz asks you to name a flag; the studio lets you build one from the real construction rules.',
      ],
      keywords: ['flags', 'flag', 'national flag', 'quiz', 'vexillology', 'colours'],
    },
    {
      url: '/maps',
      title: 'Maps — distance, sun, clock and sky',
      description: 'Maps and measurements: the distance between two places, where the sun is right now, world clocks and a sky map.',
      lines: [
        'How far is it from one place to another? The distance tool measures between any two points on the map.',
        'The sun and clock pages show where daylight is falling at this moment and what time it is anywhere.',
        'The sky map plots what is above a given latitude and longitude tonight.',
      ],
      keywords: ['maps', 'map', 'distance', 'sun', 'time zone', 'clock', 'sky map'],
    },
    {
      url: '/air-quality',
      title: 'Air Quality and Oxygen — what you are breathing',
      description: `Air quality by city with the index and its categories, plus what oxygen, breath and carbon dioxide actually mean for a body.`,
      lines: [
        udara.CITIES.length ? `How clean is the air today? The air-quality index covers ${udara.CITIES.length} cities.` : '',
        'The index is shown with its categories, so a number reads as "good", "moderate" or "unhealthy" rather than a bare figure.',
        'The oxygen, breath and carbon pages explain what the body actually does with the air it takes in.',
      ],
      keywords: ['air quality', 'aqi', 'pollution', 'oxygen', 'carbon dioxide', 'breathing', 'smog'],
    },
    {
      url: '/academy',
      title: 'Academy — science, explained simply',
      description: 'Short lessons that explain how the world works: the sky, weather, the earth, air, the body, life, numbers, the internet and how to think about a claim.',
      lines: [
        'How does the sky work? The academy answers one question at a time, in plain English, without a textbook in between.',
        'Each lesson is short enough to read in a few minutes and links to the tool that lets you check the idea for yourself.',
      ],
      keywords: ['academy', 'learn', 'lesson', 'science', 'explained', 'education', 'how does'],
    },
    {
      url: '/books',
      title: `Books by Subject — what to read on ${bk.SUBJECTS.length} subjects`,
      description: `Reading lists for ${bk.SUBJECTS.length} subjects — history, philosophy, physics, economics, medicine and more — ordered by how many editions each work is in print.`,
      lines: [
        `What should I read about history, philosophy or physics? These ${bk.SUBJECTS.length} reading lists answer with the books libraries keep reprinting, not with an affiliate pick.`,
        'Each entry gives the author, the year it was first published and how many editions exist, and links to the Open Library record where the book can be borrowed or read.',
        'Novels set in a subject are left out of a non-literary list, and no author takes more than two of the thirty slots.',
      ],
      keywords: ['books', 'reading list', 'what to read', 'philosophy', 'history', 'science books', 'open library'],
    },
    {
      url: '/recipes',
      title: `World Recipes — ${rcp.SECTIONS.length} shelves of cookable dishes`,
      description: `Real recipes with quantities and a method, in ${rcp.SECTIONS.length} shelves from Indonesian and Indian to bread, soups and cake, read from the Wikibooks Cookbook under CC BY-SA.`,
      lines: [
        `How do you cook rendang, nasi lemak or a carbonara? These ${rcp.SECTIONS.length} shelves carry recipes written by cooks, with the ingredient list, the quantities and the method.`,
        'Every dish links back to the page it was taken from and prints its licence, because the source is a free cookbook rather than an affiliate list.',
        'Each recipe page scales the quantities to any number of servings, rounding to the marks a cup and a spoon actually carry.',
      ],
      keywords: ['recipe', 'recipes', 'cook', 'cooking', 'how to make', 'ingredients', 'method', 'wikibooks cookbook'],
    },
  ];
}

module.exports = { sectionHubs, isHubName, HUB_PATHS };
