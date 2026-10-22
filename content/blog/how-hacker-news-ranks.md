SLUG: how-hacker-news-ranks
TITLE: How Hacker News Ranks Its Front Page — The One-Line Formula That Keeps It Fresh
EXCERPT: A high-scoring story from yesterday is already sinking today. The Hacker News front page runs on one deceptively simple decay formula plus a human voting culture — here is the maths and the sociology, explained.
TAGS: hacker news, algorithms, ranking, technology, community

## The Formula Everyone Quotes

Hacker News's front page was (by the founder's own published description) ranked roughly as:

```
score = (points − 2) / (age_in_hours + 2)^1.8
```

Two ideas do all the work. **Points minus two:** a submission by yourself with zero votes sits at score zero — you cannot front-page your own link; it takes at least three community upvotes to even surface. **Age plus two, to the power of 1.8:** a gravity term. A fresh story's score decays slowly at first (the "+2" stops the divide-by-zero humiliation of brand-new posts) and then accelerates — an hour-old item with 50 points crushes a day-old item with 100. The practical effect is an attention market with a steep discount rate: the community's vote counts most in the first hours, exactly when readers are around.

## Why That Design Mattered

Most ranking systems you meet are engagement-maximising: the longer you stay, the better the algorithm thinks it did. HN's formula openly optimises for *newness × approval*, which makes the front page a live digest of what peers found worth clicking today, not a re-serve of yesterday's outrage. The gravity exponent is tuned so a strong story stays roughly a day — long enough to be read, short enough that the page turns over. No ML, no personalisation, one line of arithmetic: it remains the best argument in existence that ranking is mostly a values statement wearing maths.

## The Human Layer the Formula Assumes

The maths presumes honest voters, and the culture polices that presumption: "don't game the algorithm" is literally in the site's guidelines. Downvotes cost the voter karma; replies over a certain complaint threshold collapse; account age and vote fuzzing dampen brigades. It is imperfect — group dynamics can bury an unwelcome fact and float a comforting one — but the failure mode is visible: you can watch a good post die at −7 and say *why* it died. Compare that with feeds whose ranking nobody can audit, not even their own engineers.

## What You Can Learn From It

If you build anything with a feed — a comment section, a vote board, a community showcase — steal three lessons: (1) subtract the self-vote, (2) multiply recency against approval instead of either alone, (3) publish the formula, because a rule people can see is a rule people can trust. And when you read a front page, any front page, ask the question HN makes answerable: *is this here because it's new and valued, or because it kept you scrolling?*

## Try It Yourself

Our [Technology hub](/teknologi) mirrors the same live data — the actual front page, Show HN launches, and Ask HN threads — through Hacker News's public search API, refreshed every ten minutes with no account. Watch how quickly the list churns: that decay curve in motion.
