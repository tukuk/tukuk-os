SLUG: counting-people-without-reading-over-shoulders
TITLE: Counting People Without Reading Over Their Shoulders — The Ethics of Aggregate Stats
EXCERPT: A community page can prove it is alive without exposing a single message. What "aggregate" really guarantees, where it quietly fails, and why most "anonymised" data deserves suspicion anyway.
TAGS: privacy, analytics, community, data ethics, security

## The Two Ways to Show a Living Room

Say you run a site with a private community inside it — chats, posts, stories behind a login. You want the public pages to prove the room is lively. There are exactly two ways: publish transcripts and profiles (which turns the community into content and destroys the reason anyone speaks freely there), or publish **counts**: 20 members, 14 messages today, 3 stories live right now. Numbers describe the room without opening the door. This is why every serious privacy design ends up at the same stop: aggregate or nothing.

But "aggregate" is a claim, not a guarantee, and the interesting question is what it takes for the claim to be true.

## When a Number Stops Being Anonymous

Counting is safe when the buckets are big and the cut is boring. It stops being safe at the seams:

- **Small cells.** "Posts today in a three-member group chat" effectively names everyone. Any breakdown where a category can hold one person is a confession dressed as a statistic.
- **Time as an identifier.** "One message sent at 03:41" joined with any other leak — a screenshot, a typing indicator — points at a person. Timestamps are quasi-identifiers; keep only durations and rates.
- **Differencing.** Publishing "members: 20" today and "members: 21" tomorrow leaks one registration; the second a counter is readable, its *delta* is an event feed. Round or bucket slow-changing series.
- **Granularity theatre.** "Top countries" is aggregate; "top postal codes for reporters" is a police map. The word "aggregate" says nothing about the cut — the cut is the entire ethics of it.

The honest version of the rule: a statistic is aggregate only as long as nobody can point at a row in the underlying table and shrug "that's obviously me."

## What Most Analytics Actually Are

Every "anonymised" dataset published by a platform — location histories, usage logs, engagement tables — is a set of promises about cuts. The re-identification literature is brutal and consistent: four mobile metadata points locate an individual; ZIP + birth-date + sex are nearly unique in the US census; "anonymous" taxi logs named the mayor. The lesson is not that aggregation is pointless — it is that **the aggregation boundary is the privacy boundary**, and you must defend it like a border, not decorate it like a slogan. The minimum useful cut is the moral choice: count events, never identities; bucket time, never stamp it; publish deltas only when the bucket is large enough to hide in.

## Try It Yourself

Our [community page](/social) shows exactly five numbers — members, today's messages, today's posts, live stories, total follows — read from the chat store in-process, rounded and refreshed by the minute, with no per-room, per-country or per-person breakdown by design. Poke at it as an adversary: pick any number and try to picture *who*. You cannot, and that inability is the entire feature. Then look at the "analytics" dashboards you have agreed to in your life and ask the only question that matters: **what cut did they choose, and whose name hides in it?**
