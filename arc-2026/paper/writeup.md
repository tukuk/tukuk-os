# Consistency Is Not Composition: what a two-bias solver learns from ARC-AGI-1 and fails to learn from ARC-AGI-2

**ARC Prize 2026 — Paper Track**

> **Submission fields to fill in before the deadline (2026-11-09, 23:59 UTC).**
> Nothing below is a placeholder in the prose; only these two identifiers are:
>
> - Kaggle code submission: `<<NOTEBOOK_URL>>` — public notebook, joined to ARC-AGI-2
> - Code release: this repository, `arc-2026/`
>
> Do not submit with `<<NOTEBOOK_URL>>` still in it.

---

## Abstract

We measure a small, fully transparent ARC solver on a withheld-pair protocol across
three splits: ARC-AGI-1 training (344 tasks), ARC-AGI-1 evaluation (355 tasks) and
ARC-AGI-2 evaluation (86 tasks). The solver combines two inductive biases — consistency-
filtered program search over a typed DSL, and a per-task local-context learner — and
admits a hypothesis only if it reproduces every training pair exactly. It reaches
**pass@2 7.27%** on ARC-AGI-1 training, **0.56%** on ARC-AGI-1 evaluation and **0.00%**
on ARC-AGI-2 evaluation. The interesting number is not the accuracy but the gap to
*consistency*: on ARC-AGI-2 the solver found a program consistent with all training
pairs on 3.49% of tasks, and was wrong on every one. We argue the gap is diagnostic
rather than accidental, name the mechanism behind it (consistency underdetermines
composition), and show which of our two biases survives the transition.

## 1. Question

ARC's guarantee is exactness: training pairs contain no noise, so "reproduces all of
them" is a hard constraint, not a loss to minimise. That makes consistency attractive —
hypothesis selection becomes filter-then-rank, with nothing to tune. The question is
narrow and empirical: **how far does an exact consistency filter get you as tasks get
harder, and what happens where it stops working?**

## 2. Method

The candidate space is finite and hand-written; the only fitted quantity is the context
learner's vote counts, fit per task. The implementation is standard-library Python,
roughly 900 lines, and every number below came from it (`arc/evaluate.py`).

**Bias A — program search over a typed DSL.** Candidates are enumerated in four waves,
cheap to expensive: (1) global transforms, learned colour maps and shape rules;
(2) object-level rules over connected components (keep largest, remove a colour, fill
enclosed regions, gravity, recolour by size rank); (3) a second wave — symmetry repair,
crop to a colour, panel selection, counting; (4) two-step compositions of geometric
operations, generated **only if waves 1-3 found nothing**. Each candidate carries a
static complexity score; within a wave, simpler wins.

**Bias B — a per-task context learner.** For dimension-preserving tasks, predict each
output cell from a hashable description of the *local* context of the corresponding
input cell: the cell colour, a signature of its object (colour, bucketed size, height,
width, border contact), and its 8-neighbourhood. Five signature levels are tried fine to
coarse, and the first level with evidence supplies a majority-vote colour. This bias can
express texture, denoising and fill rules; it structurally cannot express "rotate the
whole grid".

**Arbitration.** Both biases propose only hypotheses that reproduce *every* training
pair, so they compete on equal terms. Surviving programs vote on the output grid; ranking
is by shape plausibility, then vote count, then static complexity, then discovery order.
The first attempt is the winner. The second is the highest-ranked *different* grid when
one exists — on ARC-AGI-1 training that extra attempt converted 2 additional tasks
(23 → 25); when only one distinct prediction exists the two attempts coincide.

**Fallbacks.** With no consistent program the solver still emits structurally honest
guesses (shape-matched, content-cropped, or the input) because the format demands two
grids per input; they are counted as failures, never as solutions.

## 3. Protocol

For each task the **last** training pair is withheld, the solver is shown the rest, and
the withheld pair is graded as if it were a test input. Tasks with fewer than two
remaining pairs are skipped, since a one-pair filter is vacuous — an early run without
this rule produced 12 "consistent" tasks and 0 correct on 40 ARC-AGI-2 tasks, almost all
a degenerate constant-output program a single pair cannot refute. That correction is
itself part of the finding.

Budget is 3 s per task and 2 attempts, matching the competition's attempt budget. Total
wall-clock was 9.0 s, 14.6 s and 4.7 s for the three splits — the search is cheap, and
compute is not the bottleneck.

**Consistency is not accuracy.** `consistent` means "some program reproduced every
training pair". It says nothing about the withheld pair. We report both and never
conflate them.

## 4. Results

| split | tasks | consistent | pass@1 | pass@2 |
|---|---|---|---|---|
| ARC-AGI-1 training (holdout) | 344 | 68 (19.77%) | 23 (6.69%) | **25 (7.27%)** |
| ARC-AGI-1 evaluation (holdout) | 355 | 38 (10.70%) | 2 (0.56%) | **2 (0.56%)** |
| ARC-AGI-2 evaluation (holdout) | 86 | 3 (3.49%) | 0 (0.00%) | **0 (0.00%)** |

Two transitions are visible. From ARC-AGI-1 training to ARC-AGI-1 evaluation, consistency
roughly halves (19.77% → 10.70%) and accuracy falls an order of magnitude (7.27% →
0.56%): the confidence signal degrades before the distribution changes at all, purely
because evaluation tasks are less template-like. From ARC-AGI-1 to ARC-AGI-2,
consistency does not collapse — 3.49% of tasks still admit a perfect-fit program — but
accuracy does: **three consistent programs, zero correct grids**.

That is the paper's central observation. A consistency filter does not fail on ARC-AGI-2
by finding nothing. It fails by finding something that fits.

## 5. Why: consistency underdetermines composition

Our candidate space is closed under *single* rules and under a two-step composition of
*geometry only*, and only when the earlier waves return nothing. ARC-AGI-2 tasks
typically require composing a symbolic rule with a spatial one — paint by a rule, then
place the result by another rule — and require that composition to be found
*simultaneously* with the rule, not after it. Under our search order, a simpler
single-rule program that happens to fit all training pairs pre-empts the composed
program entirely: the composition wave never runs, because the search has already
committed. Consistency is a filter, not a gradient, so it cannot tell us that a fitting
program is the wrong fitting program.

Three consequences, all visible in the results:

1. **Vocabulary closure.** Waves 1-3 are a typed, finite space. Three ARC-AGI-2 things
   the space cannot name: rules conditioned on object *identity* across pairs, rules
   whose target depends on counting a property the space does not compute, and any rule
   needing three or more composed steps.
2. **Pre-emption.** A degenerate fit blocks a better fit. Ordering by complexity is the
   only defence, and complexity is a static guess about which programs are likely, not
   evidence about which is right.
3. **Arguments versus outputs.** Our arbitration counts programs, not derivations. Two
   surviving programs that agree are treated as corroboration; in our implementation
   they are frequently variants of the same idea, so vote count overstates independent
   support. On ARC-AGI-1 training, the 2 extra tasks won by the second attempt show the
   ranking is not useless — but on ARC-AGI-2 the survivors were so few that voting had
   nothing to arbitrate.

The context learner behaves as predicted: it is the dominant bias on texture-like tasks
and it is the reason `consistent` does not collapse entirely, but it is irrelevant on
ARC-AGI-2 because those tasks are rarely dimension-preserving in the way it requires.

## 6. Progress, honestly stated

We claim progress in **measurement**, not capability: a three-split protocol separating
"found a fitting program" from "predicted the held-out pair"; the observation that the
two diverge monotonically with difficulty, quantified at 19.77/6.69, 10.70/0.56 and
3.49/0.00; a documented one-pair-filter failure that silently inflates consistency; and
a diagnosis — pre-emption by simpler degenerate fits — that says where the next
increment must come from. The next step implied by Section 5 is not a bigger DSL but
*deferring* commitment: score programs by agreement on the test input as well as fit on
training pairs, and let composed programs compete with single rules instead of queuing
behind them.

## 7. Universality

Nothing in the method is ARC-family specific: the DSL is hand-written, but the
arbitration, the protocol and the context learner are family-agnostic, and the solver ran
unmodified on all three splits. The negative result is correspondingly general — any
exact-consistency filter over a finite vocabulary will underdetermine composition the
same way.

## 8. Completeness and reproducibility

Every figure above is a JSON file in `arc-2026/results/` carrying its exact command
line, protocol and timestamp; re-running the command reproduces it. Task data is fetched
from the public ARC repositories, never redistributed. The linked Kaggle notebook is
generated from these same modules — byte-compiled and module-count-checked before every
push — so it cannot drift from the code behind these numbers. Everything is
standard-library Python and runs on CPU.

## 9. Novelty

Modest and specific: the contribution is the *measurement* that consistency and accuracy
decouple under distribution shift (3.49% consistent, 0.00% correct on ARC-AGI-2), the
mechanism responsible (static complexity ordering lets a degenerate fit pre-empt a
composed one), and the prescription — defer commitment rather than widen the vocabulary.
We claim no new algorithm class, and we report the ARC-AGI-2 number as zero.

## 10. Limitations

The candidate space is small and enumerative; no learned representations were tried. The
protocol withholds the last training pair, a harder proxy than a true test pair where
pair order matters (we found no such tasks, but this protocol could not detect them).
The sizes (344 / 355 / 86) are what passed the ≥2-pair rule, not the published counts.
The 0.56% and 0.00% figures rest on 2 and 0 tasks: they are rates for comparability, but
the claim we rely on is "at this dataset's resolution, no successful generalisation was
observed".
