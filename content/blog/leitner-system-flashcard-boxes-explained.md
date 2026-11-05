SLUG: leitner-system-flashcard-boxes-explained
TITLE: The Leitner System — Flashcard Boxes and Scheduled Review, Explained
EXCERPT: Sebastian Leitner's 1972 method turns a shoebox and rubber bands into a spaced-repetition machine: five boxes, fixed review intervals, and one rule — a card you get right graduates, a card you get wrong goes back to box one.
TAGS: study techniques, flashcards, spaced repetition, memory, reference

## Definition

The **Leitner system** is a flashcard scheduling method in which cards move between a small number of boxes (traditionally five), each box carrying a fixed review interval. Newly learned cards sit in box 1 and are reviewed daily; a card answered correctly is promoted to the next box and its interval lengthens — box 2 every two days, box 3 weekly, box 4 biweekly, box 5 monthly, in the most common scheme. A card answered incorrectly is demoted back to box 1 regardless of where it sits. The physical version needs only index cards, a divided box and rubber bands; the algorithm fits on an index card because it is arithmetic, not software.

## Origin

The system is credited to the German science journalist and author **Sebastian Leitner**, who described it in his 1972 book *So lernt man lernen* ("How to Learn to Learn"), building on the spaced-review idea that traces back to Hermann Ebbinghaus's forgetting-curve experiments of the 1880s. Leitner's contribution was the simplification: rather than asking learners to compute personal intervals, the box *is* the interval — a physical queue that decides, by which compartment a card rests in, when it is next due. The scheme spread through language-learning and medical-revision communities and is the direct ancestor of every digital flashcard scheduler that moves cards between "young" and "mature" piles.

## How the scheduling works — and what it gets right

Two properties make the method work. First, **review load follows difficulty**: hard cards are seen daily because they keep returning to box 1, while a card in box 5 has already survived four spaced recalls and costs one look a month. The deck self-sorts; the learner does not choose what to review, the boxes do. Second, **every review is a retrieval attempt** — the card is answered before it is flipped — which is what separates the system from re-reading notes (see the companion essay on [active recall](https://tukuk.org/blog/active-recall-why-testing-yourself-beats-re-reading)).

The demotion rule looks harsh and is the point: a lapse on a box-4 card means the memory was not as stable as the schedule assumed, so the card returns to the short interval exactly as its performance claims. The known weakness is coarseness — five boxes give five intervals, so a card is either failing or about to be trusted; personal spaced-repetition algorithms add fine-grained grading between those poles.

## Relationship to modern spaced-repetition software

Digital successors — from SuperMemo's SM-2 (1987) to Anki and its descendants — generalise Leitner in one specific way: instead of fixed box intervals, each card carries a computed interval and an ease factor updated by the difficulty grade you assign. The skeleton is unchanged: review due cards, lengthen the interval on success, shorten it on failure. A browser study tool implements the Leitner logic directly without any boxes: a [flashcards generator](https://tukuk.org/alat/flashcards) separates "knew it" from "later" on every revealed card, so the later pile *is* box 1 — run the deck again tomorrow and the schedule re-forms itself; planning the review dates around an exam is the job of the [spaced study planner](https://tukuk.org/alat/study-planner). For a printable version of the same idea, the [Cornell notes generator](https://tukuk.org/alat/cornell-notes) cue column serves as the recall half of the page.

## Practical notes

The method assumes cards are atomic — one fact per card, question and answer on opposite faces — because a card mixing one known and one unknown half can neither be honestly promoted nor honestly demoted. It also assumes the deck is written by its user: the boxes schedule review of *your* formulations, and a borrowed deck imports someone else's encoding, which is why the essays recommend building cards from your own notes, one line per card.
