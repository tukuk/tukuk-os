SLUG: core-web-vitals-making-a-site-feel-fast
TITLE: Core Web Vitals: Making a Site Feel Fast, Not Just Load Fast
EXCERPT: LCP, INP and CLS measure three different feelings — how soon the main thing appears, how quickly it reacts, and whether it keeps its shape. Optimising "load time" alone misses all three.
TAGS: performance, web-vitals, frontend, seo

## Three Numbers, Three Different Complaints

Core Web Vitals are user-perceived, not server-side:

- **LCP — Largest Contentful Paint**: when the biggest thing above the fold (hero image, main heading) is rendered. The question: *"did the content arrive?"* Target ≤ 2.5 s.
- **INP — Interaction to Next Paint**: how long until the page *paints a response* after a tap/click/keypress. The successor to FID. Question: *"does it feel responsive?"* Target ≤ 200 ms.
- **CLS — Cumulative Layout Shift**: how much content jumps around as it loads. Question: *"did a button move under my finger?"* Target ≤ 0.1.

A page can have a great server TTFB and still feel awful: slow to show the hero, janky on tap, and lurching as ads push the text down.

## Speeding Up LCP

- **Prioritise the hero.** Don't lazy-load the image you're measuring. Fetchpriority="high", and inline or preload it.
- **Cut render-blocking work.** Split CSS, defer non-critical JS, avoid giant synchronous scripts before first paint.
- **Serve from the edge.** A CDN on static assets shrinks the round trip — a free-tier win before any clever trick.
- **Compress and right-size images.** Modern formats, correct dimensions, responsive `srcset`.

## Cutting INP (the honest one)

INP is where long JavaScript tasks hurt. The browser can't paint while your handler runs.

- **Break up big tasks.** Yield to the main thread (`setTimeout`, `scheduler.yield`, or a Web Worker for CPU-heavy work).
- **Do less on tap.** Keep click handlers synchronous and tiny; defer the heavy follow-up.
- **Mind third parties.** Chat widgets and tag managers love long tasks — they show up in *your* INP.

## Taming CLS

Layout shift is almost always missing dimensions:

- **Set `width`/`height` (or `aspect-ratio`)** on images, videos, embeds, and ad slots so space is reserved before load.
- **Reserve space for dynamic inserts** (banners, consent bars) — push them in without displacing content below, or anchor them.
- **Add, don't swap, text** — avoid web-font "FOUT" jumps by preloading fonts and tuning `font-display`.

## Measure the Right Thing

Lab tools (Lighthouse) are a *proxy*. The truth is field data (CrUX) — real users on real devices and networks. Optimise for the 75th percentile, not the average: if a quarter of visits are slow, a quarter of your users genuinely feel it. Test on a mid-range phone over 4G, because that is most of the real web.

Fast is not one number. Ship a hero that appears quickly, reacts instantly to touch, and never jumps — and you've built the feeling people actually call "fast".
