SLUG: free-world-data-apis-no-api-key-needed
TITLE: Six Free World-Data APIs That Need No Key (and What to Build With Them)
EXCERPT: Country facts, population history, live earthquakes, satellite imagery of Earth right now — the genuinely free, keyless data sources we use to run our own pages, with the honest fine print.
TAGS: api, open data, developers, world data, tutorial

## Why "No Key" Matters

Half of small-project death is credential friction: you want one number — a country's population, today's earthquake list — and a form asks for a credit card. Most of the sources below already power real pages on tukuk.org, and the rest we have used in prototypes; every one was chosen because it answers anonymously and politely. The fine print is included because becoming a data adult means reading it.

## 1. REST Countries — the Country Reference

`restcountries.com` returns clean JSON for all ~250 countries and territories: official names in a dozen languages, capitals, populations, areas, continents, currencies, languages, timezones, and flag image URLs. No key, no signup.

```
GET https://restcountries.com/v3.1/all?fields=name,capital,population,region,flags
```

**Honest fine print:** it is a community project hosted generously; it can be slow at peak times and the terms ask for caching. Our country pages fetch it once, cache the merged result, and serve that cache — you should too.

## 2. World Bank Open Data — Numbers With History

`api.worldbank.org` exposes thousands of indicators — population, GDP, life expectancy, energy, school enrolment — as JSON or XML, year by year back to 1960 for many series, with no key for normal volumes.

```
GET https://api.worldbank.org/v2/country/MYS/indicator/SP.POP.TOTL?format=json&mrnev=5
```

**Honest fine print:** the response format is two-element arrays (metadata, then data) that trip up first-timers, and revision policies mean old-year figures can shift as statistical methods update. Cite the year you downloaded.

## 3. USGS Earthquake Feeds — the Planet, Live

The US Geological Survey publishes machine-readable earthquake feeds for the past hour, day and week, worldwide and by magnitude floor — pure GeoJSON, no key:

```
GET https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson
```

**Honest fine print:** smaller events are added and *magnitude estimates get revised* as more seismic stations report; an early "M5.9" can become "M6.2" later. For quakes this is a feed of provisional truth — say so in your app.

## 4. NASA Open APIs — APOD, EPIC and Friends

api.nasa.gov covers the Astronomy Picture of the Day, satellite photos of the whole Earth disk (EPIC), near-Earth object lists (NeoWs) and more. Registration for a key is instant and free — but many endpoints answer happily with the public `DEMO_KEY`, so you can prototype before you even sign up.

```
GET https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY
```

**Honest fine print:** DEMO_KEY is rate-shared across all demo users; when a project leaves the prototype pile, register your own key — it costs nothing.

## 5. Open-Meteo — Forecasts Without a Contract

`open-meteo.com` returns weather forecasts, historical reanalysis and air quality for any lat/lon, free for non-commercial use with no key at all. It is the rare weather API that does not need a signup wall, and it exposes hourly model data from several national forecast models.

```
GET https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&current=temperature_2m
```

**Honest fine print:** the free tier has a generous hourly call budget and clearly published commercial terms; check them before building anything that earns money.

## 6. Wikimedia Commons — Flags and Public-Domain Media

The category of country flag images on Wikimedia Commons gives stable URLs for every national flag in SVG and PNG — the very source our country tables pull from. Keyless, public-domain or freely licensed, and enormous.

**Honest fine print:** read the license on each file — public domain for most flags by their nature (government works), but map derivatives can carry attribution obligations.

## The Rule Behind All Six: Cache Like You Mean It

Every keyless service above is a gift, paid for by someone. The professional move — and the one that makes your app fast — is: fetch once on cold start, keep a server-side cache with a sensible TTL (hours for country facts, minutes for live quakes), serve the cache when the upstream is slow or down, and label stale data as stale. That pattern — live fetch, timed cache, honest fallback — is exactly how our own [country directory](https://tukuk.org/negara) and the [geography quiz built from real capitals](https://tukuk.org/study/geography) stay up when half the internet hiccups.

## What to Build This Weekend

- A "country battles" card game comparing two random nations by population, area and life expectancy (sources 1 + 2).
- An earthquake ticker with a magnitude filter and a map pin trail (source 3).
- An EPIC "Earth today" wallpaper bot: the satellite view of the day, cropped to your hemisphere (source 4).
- A "will I get rained on" page that asks Open-Meteo once per hour and says yes or no in one word (source 5).

All four fit in a weekend, all four teach the same lesson twice: the hard part of data apps is not the fetching, it is the honesty about what the numbers mean and when they were last true.
