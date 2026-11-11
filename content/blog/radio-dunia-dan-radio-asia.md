SLUG: radio-dunia-dan-radio-asia
TITLE: Radio in the Browser — Now with a 🌏 Asia Fast Lane
EXCERPT: Tukuk-OS has live radio & music streaming with no account and no ads. New: one tap to Asian stations — Malaysia, Indonesia, and the whole continent.
TAGS: radio, asia, media, streaming, malaysia

## Radio that keeps playing across every page

Tukuk-OS has long had **Radio** and **Music** modes on the search page — listen to radio stations from around the world right in the browser. The twist: when you are listening to radio and jump to another page (search, apps, blog), the broadcast **keeps playing** through the global player bar. It is also **anti-dropout**: a live stream that gets interrupted will try to reconnect automatically instead of just stopping. All of this with no sign-up, no API keys, and no sneaked-in ads.

The station source is **Radio Browser** — a community database with tens of thousands of stations, filtered so only **HTTPS** streams are shown (HTTP streams get blocked by browsers on secure sites anyway).

## The problem: "there is no Asian radio"

One of our first pieces of feedback: when you open Radio, the top list is dominated by Western stations — BBC, French Jazz, American Classical. Asian stations *do* exist, but they are buried in the long "All countries" dropdown. Finding a Malaysian station meant scrolling through hundreds of country names. That is not the catalog's fault, just navigation that is unfriendly to our region.

## The fix: quick regions

We added a **Region** bar to the radio navigation. Now there are buttons:

- **🌏 Asia** — a blend of top stations from across the continent (MY, ID, TH, PH, SG, VN, IN, JP, KR, and many more).
- **Southeast Asia**, **East Asia**, **South Asia** — ordered by sub-region.
- **🕌 Middle East** — as a bonus.

Behind the scenes, each region is a list of ISO country codes sent as a comma-separated `countrycode` parameter to Radio Browser, sorted by click count (most popular first). Pick **🌏 Asia** and the screen instantly fills with regional stations — no more dropdown scrolling.

## Asian stations guaranteed

If Radio Browser is occasionally unreachable, our fallback list now also includes Malaysian & Indonesian stations, so there is always some Asian radio to play even when the external source has problems. Try `tukuk.org/cari?mode=radio` and press **🌏 Asia** — hear it yourself. Our region's radio now has its place.
