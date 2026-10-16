SLUG: kisah-satu-kata
TITLE: The Story of Satu Kata — One Word a Day Becomes One App and One Game
EXCERPT: How a daily cron job takes a single word — rain, coffee, rocket — and turns it into an app and a game you can play, without a human writing a single line of code.
TAGS: satu-kata, apps, game, automation, ci

## The idea: one word, two things

**Satu Kata** is the most unusual experiment in Tukuk-OS: every day, an automated job (cron) picks **one word** — `rain`, `coffee`, `book`, `rocket`, `fish`, `cloud`, `flower` — and from that word **two things** are generated: a **mini app** and a **mini game**. So the word `coffee ☕` becomes a caffeine counter; `rocket 🚀` becomes a catch-the-fuel-reach-orbit game. Nobody writes code for any of them — everything is born from one generator script.

## No build step

The philosophy: *"as easy as making an app, but without the build rounds"*. Every output is just **a single HTML file** — apps use Preact+htm, games use Phaser. Because they are static files, they can be shipped straight to the edge and **barely burden the server**: the cost on the VPS is very light, roughly 0 minutes for CI to run them.

## Every word gets its own personality

The beautiful part: theme, colors, and genre are **chosen deterministically** from a hash of the word. Six palettes (solar, mint, green, rose, purple, rust) and four genres (catch, tap, memory, runner) mean `durian` always gets the same look every time, while `chili` gets something different. Consistent but varied — without needing a designer at all.

## Into the app store

Every Satu Kata pair appears in `tukuk.org/store` (the "satu-kata" source) with two cards: **App «word»** and **Game «word»**. And like every app here, each one can be downloaded as a **Tukuk-signed Android APK** — so today's word can be an app in your pocket tomorrow. The hub lives at `tukuk.org/satu-kata`. One word, one day, one small world.
