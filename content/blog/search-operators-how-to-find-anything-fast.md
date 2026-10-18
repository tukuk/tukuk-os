SLUG: search-operators-how-to-find-anything-fast
TITLE: Search Operators: How to Find Anything in Ten Seconds Instead of Ten Pages
EXCERPT: site:, quotes, minus, filetype: and a handful of others turn the search box from a slot machine into a filter. The complete working set for modern Google and Bing.
TAGS: search, productivity, internet skills, research, how-to

## The Box Is Not the Problem

Most searches fail at the second step — opening result four because result one was an SEO-farmed listicle. Operators fix the first step: they constrain the *shape* of what you want before the engine guesses. Six of them cover ninety percent of real-world needs. All work in Google and (with minor differences) Bing and DuckDuckGo.

## The Core Six

**1. `site:` — one domain only.**
`site:nasa.gov aurora` returns only nasa.gov pages. This is the highest-value operator that almost nobody's grandmother knows. It also works on subdomains (`site:.gov` restricts to government domains on Google) and it is your first defence against content farms: when you know the trustworthy source, search *only* inside it.

**2. `"exact phrase"` — the quotation mark.**
`"the Hubble constant tension"` forces that word order to appear literally. Use it for names of papers, quotes, error messages, and niche terminology the engine would otherwise paraphrase into mush. If your search results feel like they are about a *vibe* of your words, add quotes.

**3. `-word` — the minus exclusion.**
`jaguar -car -animal` gets you the operating system. One minus sign, no space before the word. Excluding the obvious wrong meaning of an ambiguous term is the cheapest relevance boost available.

**4. `filetype:` — documents only.**
`statistics of world urbanization filetype:pdf` — textbooks, central-bank reports and academic preprints are PDFs, and PDFs skip most of the ad-heavy web. (Bing spells it `filetype:pdf` too; both engines accept it.)

**5. `intitle:` — the word must live in the page title.**
`intitle:"status codes" http` finds explainers *about* the topic rather than pages that merely mention it once. The title is the strongest promise a page makes; filtering on it filters on intent.

**6. Time filters — set it and forget the zombie results.**
Both Google and Bing expose date tools ("Any time" → "Past year/month"), and the underlying query syntax (`&tbs=qdr:m` on Google) is worth knowing only if you build search links. Habit version: for anything technology-related older than three years, ask "is this still true?" — and click the past-year filter first when the answer matters.

## Three Specialist Moves

- **Find the rival:** `related:wikipedia.org` (Bing) lists sites Bing considers similar — useful for discovery when you do not know the field's names yet.
- **Kill the template:** when a boilerplate phrase floods results, drop it: `"error code 0x800f081f" -"visual studio"` strips the pages that just recycle the error string with commentary.
- **Search within a language:** tools' language filters (Google Search Tools → Language) stop results in five languages from mixing when you are researching local law, local prices, or local forums.

## The Meta-Skill: Search Is Iteration

Operators shine because they make the second query fast. The professional pattern: **broad** (`aurora forecast`), inspect the words the good results use, then **narrow** with quotes and `site:` (`"3-day forecast" site:swpc.noaa.gov aurora`), then **subtract** the noise. Three ten-second searches that talk to each other beat one thirty-second wish.

And when the topic is not a known document but a known *place* in your own library — the same logic powers search inside Tukuk: operators and filters over vibes. Try the philosophy applied to our own index at [tukuk.org/cari](https://tukuk.org/cari), or skip straight to answers built from checked sources at [tukuk.org/wiki](https://tukuk.org/wiki).

## One-Line Cheat Sheet (Screenshot This)

```
site:domain.com topic          → only that site
"exact words"                  → literal phrase
topic -exclude                 → drop the wrong meaning
topic filetype:pdf             → documents only
intitle:"phrase"               → topic in the title
past-year filter               → kill stale answers
```

Ten seconds, ten results, zero listicles. That is the whole trick: the engine can only obey constraints you actually give it.
