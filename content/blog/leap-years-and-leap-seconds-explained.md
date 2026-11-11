SLUG: leap-years-and-leap-seconds-explained
TITLE: Leap Years and Leap Seconds: Why the Calendar Keeps Fighting Astronomy
EXCERPT: A year is not 365 days, a day is not 86,400 steady seconds, and humans have spent millennia papering over the mismatch. Here is the arithmetic of leap years, the strangeness of leap seconds, and why both exist.
TAGS: time, calendar, astronomy, science, leap seconds

## The Problem: Nothing Divides Evenly

Calendars break because the sky refuses to cooperate with round numbers. Earth orbits the Sun in about **365.2422 days** — a "tropical year" — not 365. That leftover quarter-day is the whole story of leap years. If you ignore it, the calendar drifts by roughly 24 days every century, and the seasons march backwards through the dates: a mid-winter festival eventually lands in spring. The Romans noticed, and the fix has been refined ever since.

## How a Leap Year Actually Works

The obvious rule — add a day every four years — slightly overshoots, because 365.25 is a touch more than the true 365.2422. The **Gregorian calendar**, introduced in 1582 and now the civil standard almost everywhere, corrects the overshoot with a two-part rule:

- A year divisible by **4** is a leap year (366 days), **except**
- a year divisible by **100** is *not* a leap year, **unless**
- it is also divisible by **400**, in which case it is.

That is why **2000** was a leap year but **1900** was not, and why **2100** will *not* be. The pattern averages out to about 365.2425 days per year, close enough to the true value to stay aligned for several thousand years before accumulating a single day of error. Leap day is appended at the end of February — a holdover from the Roman calendar, when February was the last month and the awkward extra day was dumped on it.

## The Other Mismatch: Days Aren't Constant Either

A year drifting is one thing; a *day* drifting is stranger. We define the second with atomic clocks, which are extraordinarily steady. But Earth's actual rotation — the thing that decides when the Sun crosses your meridian — is **not** steady. It is slowly slowing under tidal friction from the Moon (lengthening the day by a couple of milliseconds per century on average), and it also wobbles unpredictably due to atmospheric and oceanic effects, even the movement of molten material deep inside the planet.

So atomic time (TAI) and astronomical time (UT1, tied to real rotation) pull apart. Civil time, **UTC**, is the compromise: it ticks in atomic seconds but is nudged back to stay within 0.9 seconds of the actual rotation — and the nudge is the **leap second**. Since 1972, every leap second added has been *positive*, inserted at the end of June or December, producing a surreal final minute that runs `…:58, :59, :60, :00`. A day with a leap second genuinely has 86,401 seconds.

## Why Leap Seconds Are Being Retired

Here is the part most explainers miss: the leap second is now considered a mistake to be undone. Because Earth's rotation is *slowing*, we keep having to add positive leap seconds — but the accumulated fiddling has become a nightmare for computer systems. Stock exchanges, GPS, cloud infrastructure and networks all hate a minute with 61 seconds, and a famous 2012 outage rippled across popular websites when a leap second hit. On top of that, **GPS time never inserts leap seconds at all**, so every GPS-to-UTC conversion needs a running offset table. At the international metrology body's 2022 general conference, member states agreed to **stop using leap seconds by or before 2035** and let the gap between clock time and the Sun grow instead — a deliberate choice to favour machine consistency over astronomical tidiness.

## What To Do With Any Date

The upshot: leap years are a solved, predictable arithmetic problem; leap seconds are an irregular, human-managed patch that is going away. For everyday work you almost never need to think about either — but when you do, don't hand-count them. Our free [date calculator](https://tukuk.org/alat/date) tells you the number of days between any two dates and whether a given year is a leap year, the [time-zone converter](https://tukuk.org/alat/timezone) lines up a moment across the world's zones, and the [world clock](https://tukuk.org/maps/clock) shows what time it is, right now, anywhere on Earth.
