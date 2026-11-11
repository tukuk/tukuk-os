SLUG: spaced-repetition-algorithms-sm2-and-anki-explained
TITLE: Spaced-Repetition Algorithms — How SM-2 and Its Successors Compute the Next Interval
EXCERPT: Behind every flashcard app's "seen in 4 days" is a small formula from 1987: an ease factor, a growing interval, and a penalty when you falter. Here is what the maths actually does, in plain terms.
TAGS: study techniques, spaced repetition, algorithms, flashcards, reference

## The problem an algorithm is asked to solve

Spaced repetition schedules reviews of a memory at the moment it is about to fail — early enough that recalling succeeds, late enough that the interval itself strengthens the trace. The psychological quantities (how fast this card is fading for this learner) are not observable, so every practical algorithm estimates them from the only data it has: **how you graded the card last time, and how many times before that**. The output is one number — the next interval — plus the date the card becomes due.

## SM-2: the 1987 formula almost everyone inherited

Piotr Woźniak designed **SM-2** in 1987 for SuperMemo as a deliberately tiny recurrence. For each card it keeps two state values: *n*, the number of consecutive correct reviews, and *EF*, the "easiness factor" — a per-card multiplier initialised at 2.5. After a review graded *q* (0–5, with below 3 counting as a failure):

- On failure: *n* resets to 0 (the card returns to one-day review) but *EF* is kept, slightly punished: `EF ← EF + (0.1 − (5−q)·(0.08 + (5−q)·0.02))`, floored at 1.3.
- On success: the new interval is *n* = 1 → 1 day, *n* = 2 → 6 days, and beyond that `I(n) = I(n−1) · EF`.
- *EF* is updated after each successful review by the same quality term — cards graded easy drift upward (seen sooner-and-sooner apart), cards that feel hard compress toward the 1.3 floor.

Two properties matter. Intervals grow **geometrically** — each successful review multiplies the wait by the card's easiness — which mirrors how the forgetting curve flattens with each repetition. And the *only* input is self-graded quality; there is no model of the learner beyond the card's own history. Modern descendants differ mostly at the edges: Anki's original algorithm adapted SM-2 (sm-2 was the literal starting point of its 2006 scheduler) and its current FSRS model replaces the hand-written recurrence with a fitted memory-state model, while SuperMemo itself grew far richer variants — but every one of them still answers the same two questions SM-2 answered: *when next, and how much did that lapse cost*.

## What the algorithms get wrong, quietly

Self-graded quality is the load-bearing assumption and the leakiest point: a card recognised as familiar is graded "easy" though it was never truly recalled, which inflates *EF* and pushes the next review past the point where retrieval would have strengthened anything — the same fluency illusion documented in the essay on [active recall](https://tukuk.org/blog/active-recall-why-testing-yourself-beats-re-reading). Interval growth also compounds scheduling error: a card that slips past a due date because of a bad week can snowball into an avalanche of due reviews, the failure mode every app's "leech" and "deadline" features exist to patch. And the geometric assumption fits simple facts well and structured knowledge poorly — understanding *why* does not schedule like memorising *that*.

## Using the logic without the software

The arithmetic is small enough to run on paper for anything with a fixed end date: the intervals are a doubling ladder — same day, next day, +2, +4, +8, +16, capped by the exam — which is precisely what a [spaced study planner](https://tukuk.org/alat/study-planner) computes from two inputs (exam date, session length) instead of per-card grades. The card-level Leitner logic — knew-it cards drift out, later cards stay daily — is implemented directly by a [flashcards generator](https://tukuk.org/alat/flashcards), and the full background on why spacing beats cramming is covered in [the forgetting curve article](https://tukuk.org/blog/spaced-repetition-forgetting-curve-how-to-beat-it). An algorithm cannot decide that you will answer honestly before the timer beeps; everything else it does, it can do for you.
