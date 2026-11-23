# ARC Prize 2026 — Paper Track (Tukuk)

The code, the measurements and the write-up for the ARC Prize 2026 **Paper Track**
(https://www.kaggle.com/competitions/arc-prize-2026-paper-track).

Deadline: **2026-11-09, 23:59 UTC**. Total pool **$450,000**
($75,000 main prize + $375,000 outstanding-paper pool).

The track does not score a submission grid — it scores a *paper*. What it does require
is that the paper points at a code submission that actually ran on ARC-AGI-2 or
ARC-AGI-3, and that every number in the write-up can be traced to a run. Both of those
are enforced here by generating the notebook from the repo instead of maintaining it by
hand.

---

## Layout

```
arc-2026/
  arc/
    grid.py      grid primitives: background, bbox, crop, rotate, components, objects
    dsl.py       the candidate space: geometric, scaling, tiling, colour, object rules
    learn.py     the second inductive bias: a per-task local-context learner
    search.py    consistency filter + agreement-weighted arbitration (the core)
    solver.py    CLI: one task, a challenge file, or a directory
    evaluate.py  holdout protocol + measured pass@1 / pass@2
  tests/         19 unit tests, no data needed
  results/       every measured run as JSON (command line + protocol + timestamps)
  fetch-data.sh  clones the public ARC data (nothing third-party is committed)
  paper/         the write-up
```

## Quickstart

```bash
bash arc-2026/fetch-data.sh              # ARC-AGI-2 (needs git, no account)
bash arc-2026/fetch-data.sh arc1         # ARC-AGI-1, for cross-checking

cd arc-2026
python3 -m unittest discover -s tests -v
python3 -m arc.solver --task data/ARC-AGI-2/data/evaluation/00576224.json
python3 -m arc.evaluate --dir data/ARC-AGI-2/data/evaluation --holdout --out results/eval.json
```

No dependencies — standard library only, which is deliberate: the notebook has to run
on Kaggle with nothing but what is preinstalled.

## Measured results

These are the only numbers quoted anywhere in the paper. Each one is a JSON file in
`results/` written by `arc/evaluate.py`, carrying the exact command, the protocol label
and a timestamp. Re-run the command in the file to reproduce it.

| split | tasks | consistent | pass@1 | pass@2 |
|---|---|---|---|---|
| ARC-AGI-1 training (holdout) | 344 | 68 (19.77%) | 23 (**6.69%**) | 25 (**7.27%**) |
| ARC-AGI-1 evaluation (holdout) | 355 | 38 (10.70%) | 2 (**0.56%**) | 2 (**0.56%**) |
| ARC-AGI-2 evaluation (holdout) | 86 | 3 (3.49%) | 0 (**0.00%**) | 0 (**0.00%**) |

`consistent` is **not** accuracy. It only says "some program reproduced every training
pair". A task counted as consistent can still have its test grid wrong, and on
ARC-AGI-2 every one of the three consistent tasks did. That gap is the finding.

Protocol: the last training pair is withheld, the solver sees the rest, and the withheld
pair is graded. Tasks with fewer than 2 remaining pairs are skipped. 3 s/task budget,
2 attempts — the same attempt budget the real competition gives.

## How the solver works

Two inductive biases, both admitted only if they reproduce **every** training pair
exactly, then arbitrated by agreement and simplicity:

1. **Program search over a typed DSL** (`dsl.py`, `search.py`). One rule explains one
   task. Wins on rotate / recolour / crop / tile. Candidate waves, cheap to expensive:
   global transforms and learned colour maps → object-level rules over connected
   components → a second wave (symmetry repair, colour crops, panel selection, counting)
   → two-step geometry compositions, only if the first three waves found nothing.
2. **A per-task context learner** (`learn.py`). Predicts each output cell from the local
   context of the input cell: neighbourhood + object signature, five signature levels
   tried fine to coarse, colour by majority vote. Wins on texture, denoising and fill
   tasks that no single transform expresses; structurally cannot express "rotate the grid".

Arbitration (`search.py`): surviving programs vote on the output grid. Votes dominate,
then simplicity, then discovery order. The first attempt is the winner; the second
attempt is the most *different* runner-up, so the two attempts are not duplicates.

## Kaggle notebook (the linked code submission)

`kaggle-jobs/arc-2026-solver.py` is the notebook. Its solver modules are **generated**
from `arc-2026/arc/*.py` at push time, so it can never drift from the repo:

```bash
bash scripts/arc-2026-push.sh --dry-run     # build + byte-compile, submit nothing
KAGGLE_ID=<username> bash scripts/arc-2026-push.sh
KAGGLE_ID=<username> ARC_COMPETITION=arc-prize-2026 bash scripts/arc-2026-push.sh --public
```

`--dry-run` writes `kaggle-jobs/arc-2026-solver.generated.py` (gitignored) and proves it
compiles and carries all seven modules. Running the generated file without the embedding
stops with an error instead of solving with an empty solver — that failure mode is the
reason the generator exists rather than a hand-maintained notebook.

Verified locally end-to-end against a `/tmp` fixture shaped like `/kaggle/input`
(12 competition-style tasks + 25 tasks with known answers):

```
[arc] solver modules written: 7 file(s) → /tmp/arcwork/_tukuk_arc
[arc] format check: 12 sample tasks · missing 0 · wrong attempt count 0
[arc] EVAL: 25 tasks · graded 25 · consistent 6
[arc] EVAL measured: pass@1 0/25 = 0.00% · pass@2 1/25 = 4.00%
```

The solver is pure CPU, so no GPU quota and no Kaggle GPU account gate is involved.

## Paper Track checklist

From the competition rules; tick before the deadline.

- [ ] Write-up ≤ **1500 words** (`paper/writeup.md`)
- [ ] Linked **public** Kaggle notebook, joined to ARC-AGI-2 or ARC-AGI-3
- [ ] Cover image + media gallery
- [ ] Rubric addressed explicitly: Accuracy, Universality, Progress, Theory,
      Completeness, Novelty (each scored 0-5)
- [ ] Every number traceable to a file in `results/` — no hand-typed figures
- [ ] Code released so a reviewer can re-run it

## Honesty rules for this project

- A number goes into the paper only after `arc/evaluate.py` wrote it to `results/`.
- `consistent` is never called accuracy.
- The ARC-AGI-2 result is 0% and stays 0% in the write-up. The paper is about *why*
  consistency-filtered search stops working on ARC-AGI-2, which is a real finding from
  a real run, not a claim of capability we do not have.
- Third-party task data is fetched, never committed.
