SLUG: kisah-satu-kata
TITLE: The Story of Satu Kata — One Word a Day Becomes One App and One Game
EXCERPT: How a daily cron job takes a single word — rain, coffee, rocket — and turns it into an app and a game you can play, without a human writing a single line of code.
TAGS: satu-kata, apps, game, automation, ci

## The idea: one word, two things

> **Update (Oct 2026):** the daily Satu Kata generator has been retired — the `/satu-kata` hub is offline and the CI job no longer runs. This post stays as an engineering retrospective. For one-off app ideas, try the builder API or the app hub on `tukuk.org/`.

**Satu Kata** was the most unusual experiment in Tukuk-OS: every day, an automated job (cron) picks **one word** — `rain`, `coffee`, `book`, `rocket`, `fish`, `cloud`, `flower` — and from that word **two things** are generated: a **mini app** and a **mini game**. So the word `coffee ☕` became a caffeine counter; `rocket 🚀` a catch-the-fuel-reach-orbit game. Nobody wrote code for any of them — everything was born from one generator script.

## No build step

The philosophy: *"as easy as making an app, but without the build rounds"*. Every output is just **a single HTML file** — apps use Preact+htm, games use Phaser. Because they are static files, they can be shipped straight to the edge and **barely burden the server**: the cost on the VPS is very light, roughly 0 minutes for CI to run them.

## Every word gets its own personality

The beautiful part: theme, colors, and genre are **chosen deterministically** from a hash of the word. Six palettes (solar, mint, green, rose, purple, rust) and four genres (catch, tap, memory, runner) mean `durian` always gets the same look every time, while `chili` gets something different. Consistent but varied — without needing a designer at all.

## Into the app store

Every Satu Kata pair appeared on the app hub `tukuk.org/` (the "satu-kata" source) with two cards: **App «word»** and **Game «word»**. And like every app here, each one could be downloaded as a **Tukuk-signed Android APK** — so today's word could be an app in your pocket tomorrow. One word, one day, one small world.
