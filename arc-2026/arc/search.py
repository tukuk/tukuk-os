"""
search.py — the consistency-filtered program search (the core of the method).

The idea in one sentence: a transformation is only worth predicting with if it
reproduces EVERY training pair exactly; among those, prefer the simplest.

Why consistency instead of scoring? ARC trains are tiny (2-4 pairs) and exact
(no noise), so "fits all of them" is a hard constraint, not a soft objective.
A hypothesis that fits 3/3 is qualitatively different from one that fits 2/3 —
averaging them (as a loss would) throws that distinction away.

Search order, cheap to expensive:
    1. single global transforms + learned colour maps + shape rules
    2. object-level rules (component abstraction)
    3. second-wave families: symmetry repair, colour crops, panel selection, counting
    4. two-step compositions of geometry (only if 1-3 found nothing)

The two-attempt output required by ARC comes from ORDERING the surviving programs
by agreement and then by simplicity, and taking the two most distinct predictions.
"""
import time

from . import dsl
from . import grid as G
from . import learn


def _pairs(task):
    return [(G.from_list(p["input"]), G.from_list(p["output"])) for p in task["train"]]


def _test_inputs(task):
    return [G.from_list(t["input"]) for t in task["test"]]


def _fits(program, pairs):
    for inp, out in pairs:
        try:
            got = program(inp)
        except Exception:
            return False
        if got is None or G.from_list(got) != out:
            return False
    return True


def consistent_programs(pairs, with_compositions=True, deadline=None):
    """
    Every program that reproduces all train pairs, simplest first.

    `deadline` (time.monotonic()) bounds the search for a single task: the
    evaluator runs 120 tasks, so a pathological task must not eat the whole budget.
    """
    found = []

    def run(batch):
        for prog in batch:
            if deadline is not None and time.monotonic() > deadline:
                return False
            if _fits(prog, pairs):
                found.append(prog)
        return True

    run(dsl.global_candidates(pairs))
    run(dsl.object_candidates(pairs))
    run(dsl.extra_candidates(pairs))
    # Second inductive bias: a per-task context learner. It only proposes itself when
    # it already reproduces every train pair, so it enters on the same terms as a
    # DSL program — and loses to anything simpler that also fits.
    learned = learn.context_program(pairs)
    if learned is not None:
        run([dsl.Program("context_learner", learned, 2)])
    if not found and with_compositions:
        run(dsl.compositions(pairs))
    found.sort(key=lambda p: (p.complexity, p.name))
    return found


def _shape_hint(pairs):
    """The single output shape when every train output shares one, else None."""
    shapes = {G.shape(out) for _, out in pairs}
    return shapes.pop() if len(shapes) == 1 else None


def _fallbacks(pairs, test_inputs, attempts):
    """
    No consistent program: still emit honest structural guesses.

    These are NOT claimed as solutions — they are the minimum the format demands
    (ARC needs two grids per test input). Ranking here only prefers shapes the
    train outputs actually had.
    """
    hint = _shape_hint(pairs)
    guesses = []
    for inp in test_inputs:
        candidates = []
        if hint:
            candidates.append(_fit_shape(inp, hint))
        candidates.append(G.crop_to_content(inp))
        candidates.append(inp)
        guesses.append(candidates[:attempts])
    return guesses


def _fit_shape(g, shape):
    """Pad with the background colour, or crop, to reach exactly `shape`."""
    oh, ow = shape
    bg = G.background(g)
    h, w = G.shape(g)
    if h >= oh and w >= ow:
        return G.crop(g, (0, 0, oh - 1, ow - 1))
    return G.pad(g, 0, max(0, oh - h), 0, max(0, ow - w), bg) if h <= oh and w <= ow else g


def solve_task(task, attempts=2, time_budget_s=6.0, with_compositions=True):
    """
    Solve one ARC task.

    Returns a dict:
        attempts : list[list[grid]]   per test input, `attempts` grids each
        programs : list[str]          the surviving programs, in ranked order
        solved   : bool               a consistent program was found
        elapsed  : float              seconds spent (real, for the paper's tables)
    """
    started = time.monotonic()
    pairs = _pairs(task)
    test_inputs = _test_inputs(task)
    deadline = started + time_budget_s

    programs = consistent_programs(pairs, with_compositions=with_compositions, deadline=deadline)

    if not programs:
        return {
            "attempts": _fallbacks(pairs, test_inputs, attempts),
            "programs": [],
            "solved": False,
            "elapsed": time.monotonic() - started,
        }

    hint = _shape_hint(pairs)
    predictions = []
    for inp in test_inputs:
        # Agreement-weighted selection: every surviving program votes for its output.
        # A prediction supported by several independent hypotheses is trusted before a
        # singleton, and ties fall back to simplicity. The second attempt is then the
        # runner-up — genuinely different from the first, which is the point of ARC's
        # two-attempt rule.
        votes = {}
        cheapest = {}
        first_seen = {}
        for prog in programs:
            try:
                out = prog(inp)
            except Exception:
                continue
            if out is None:
                continue
            out = G.from_list(out)
            votes[out] = votes.get(out, 0) + 1
            cheapest[out] = min(cheapest.get(out, 99), prog.complexity)
            first_seen.setdefault(out, len(first_seen))
        ranked = sorted(votes, key=lambda g: (
            0 if (hint is None or G.shape(g) == hint) else 1,
            -votes[g],
            cheapest[g],
            first_seen[g],
        ))
        picks = ranked[:attempts]
        while len(picks) < attempts:  # ARC requires exactly `attempts` grids
            picks.append(picks[-1] if picks else G.crop_to_content(inp))
        predictions.append(picks)

    return {
        "attempts": predictions,
        "programs": [p.name for p in programs],
        "solved": True,
        "elapsed": time.monotonic() - started,
    }
