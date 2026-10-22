SLUG: open-data-movement-guide
TITLE: The Open Data Movement — What "Free Data" Actually Promises, and Who Keeps It
EXCERPT: Government budgets, satellite imagery, census tables, museum collections: an entire generation of public data sits openly on the web. What makes data genuinely "open", who maintains it when nobody is paid, and how to tell a real source from a graveyard.
TAGS: open data, public data, licenses, world data, society

## Free Is Not the Same as Open

A PDF of a national census buried on a ministry website is *free* — you can look at it. It is not *open*: you cannot copy it, machine-read it, or build on it. The definition of open data crystallised in the 2000s–2010s — from the Berlin Declaration on Open Access to Knowledge to the Open Knowledge Foundation's tidy "Open Definition" — into two pillars: **legally open** — an explicit license allowing reuse, ideally CC0/CC-BY, with no registration — and **technically open** — bulk access, stable URLs, structured formats (CSV, JSON, GeoJSON), documented columns. Miss either half and you have a publicity photo of data, not data.

The second pillar is the one that decides whether anything gets built. NASA's API returns JSON in a documented shape; that is why hundreds of sky apps exist. A ministry that "publishes" statistics as interactive dashboard widgets technically shows numbers and legally forbids the download — the same numbers, zero ecosystem.

## Who Actually Keeps It Alive

The romantic answer — governments — is half right. National statistics offices are open data's anchor tenants: census bureaus, meteorological services (NOAA's feeds are the reason every weather app works), geological surveys (USGS earthquake feeds, no key, ever), EU's Eurostat. Then a second tier does the work governments structurally cannot: community mappers (OpenStreetMap, 10 million contributors, the base layer of half the "commercial" maps you use), citizen scientists (GBIF's biodiversity records, EONET's near-Earth events), library-and-museum digitisers (Met Open Access, Project Gutenberg, Europeana), and NGOs that scrape, tidy and republish what was technically free but practically unusable.

Open data persists through *institutions with mandates*, not enthusiasm: USGS has a legal duty to publish; a hobby mirror of USGS dies when the hobbyist moves. When evaluating a source, the useful question is boring: who is contractually or legally obliged to keep this URL alive for the next decade?

## The Graveyard Problem — and How to Spot a Living Source

Most dead open data is not deleted; it just stops updating. Three tells: **(1)** the dataset's "last updated" field lags its own stated cadence; **(2)** the bulk endpoint works while the pretty website is broken (or the reverse — a sign nobody is watching); **(3)** the issue tracker or mailing list has unanswered reports older than a year. Favourite trap: an API key you must request — a free key is still a gate, and gated sources rot quietly because the maintainers can count registered users and feel successful while actual use collapses. The honest maintenance metric of open data is reuse: who shipped what, this quarter, on top of it.

Your fallback should be archival thinking: the Wayback Machine, official mirrors, and a personal copy of any table your project depends on. Data licensed for reuse can be *cached*; that right is the entire point of the license.

## Try It Yourself

We run the whole world section of this site on keyless public data — the [free-data API roundup](/blog/free-world-data-apis-no-api-key-needed) lists the workhorses (REST Countries, World Bank, USGS, Wikipedia) with their honest fine print. Pick one number you care about — your country's population, the strongest quake this month — and trace it to its primary open source rather than an aggregator; then check that source's update stamp. You will have performed the exact audit that decides whether a dataset is infrastructure or a museum exhibit — and you will understand why our pages cache aggressively, label archives honestly, and cite the maintainer by name.
