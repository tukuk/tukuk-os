SLUG: time-zones-explained
TITLE: Time Zones Explained — Why the Map of Clocks Is Messier Than the Map of the Earth
EXCERPT: Fifteen degrees per hour sounds tidy until you look at an actual time-zone map: half-hour offsets, zones that change seasonally, and a date line that zigzags to avoid splitting fishing fleets. Here is why.
TAGS: time zones, geography, travel, education, date line

## The Astronomy Part Is the Easy Part

The Earth spins 360° in about 24 hours — 15° per hour, so a "sensible" planet would have 24 slices each 15° of longitude wide, all one hour apart. That scheme exists only on paper. Every real time zone is that astronomy plus politics, railways, ferry timetables and one famous electricity grid.

Standard time was a railway invention. Before it, each town kept its own solar noon — London and Bristol were minutes apart, which is fine for breakfast and fatal for timetables. North America's rail lines adopted zone time in 1883; the world gradually followed, anchoring zones to the Greenwich meridian. (France kept "Paris time" for decades after; some places resisted until the 1920s.)

## Why the Boundaries Wiggle

Zones should follow meridians, but people do not live in meridians — they live in valleys, islands and commuter belts. So boundaries bend to keep a country, a region or a single troublesome alpine pass on one clock. Three quirks prove the point:

- **Half and quarter-hour zones.** India runs UTC+5:30, Nepal UTC+5:45, and the Chatham Islands UTC+12:45 — nobody agreed to the tidy hour.
- **China's single zone.** The country spans five geographic zones but runs one Beijing clock, so western China sees sunrise near 10 a.m. — an experiment in national unity you can verify by watching a cat stretch.
- **The date line's kinks.** The 180° meridian would slice through the Pacific neatly if there were nothing there. There are islands, so the line detours around Kiribati (which moved its date line east in 1995 so the whole country shared a weekday) and eastern Russia's Chukotka. Samoa skipped a whole day in 2011 to swap weekend with its trading partners in Australia and New Zealand — the rare case of a country jumping forward 24 hours on purpose.

## Summer Time Complicates Everything Again

Daylight-saving schemes shift clocks seasonally for reasons that predate the modern grid, and they make a zone a *schedule*, not a place. Arizona mostly opts out; Europe abolished the seasonal switch by EU vote in principle but the actual 2021 deadline slipped, so clocks still change; parts of Australia flip and parts do not. The practical consequence is that "what time is it there" genuinely requires a database — the IANA tz database, the unglamorous file that quietly makes every calendar app, flight system and server cron job possible, and that gets updated constantly as governments change their minds.

## Try It Yourself

Pick three pairs of cities that sit on the same latitude but different time zones and check what "9 a.m. local" means for the sun overhead on our [World Weather](/weather) pages; then plan a [route](/maps) — the crossing of a border with a one-hour jump is where every long-haul driver learns the tz database by feeling, not by reading. The honest lesson: clocks are a social agreement drawn on an astronomical fact, and like all maps of agreements, the borders tell you more about people than about the planet.
