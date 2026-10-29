"""
evaluate.py — measure the solver on real ARC data and write a results file.

  # public evaluation set of the ARC-AGI-2 repo (one JSON per task)
  python -m arc.evaluate --dir data/evaluation --out arc-2026/results/eval.json

  # Kaggle challenge+solutions pair (dict form)
  python -m arc.evaluate --challenges arc-agi_evaluation_challenges.json \
                         --solutions  arc-agi_evaluation_solutions.json

  # a 20-task smoke run with a tighter budget
  python -m arc.evaluate --dir data/evaluation --limit 20 --time-budget 3

WHAT IS MEASURED
  * pass@1  — the first prediction is exactly the expected grid (every test input).
  * pass@2  — any of the two predictions is exactly right (the ARC scoring rule).
  * "solved" — a consistent program was found on the train pairs. This is NOT
    accuracy and is reported separately; confusing the two is the most common way
    ARC write-ups overstate their results.

Numbers are written exactly as measured, with the command line and timing, so the
paper can cite the file instead of a hand-maintained table. Identical grids are
required cell-for-cell — there is no partial credit in this evaluator.
"""
import argparse
import glob
import json
import os
import sys
import time
from datetime import datetime, timezone

from . import grid as G
from .search import solve_task


def _load(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_tasks(args):
    """→ {task_id: task}. Supports dir-of-files, Kaggle dict, and per-file lists."""
    if args.dir:
        tasks = {}
        for fp in sorted(glob.glob(os.path.join(args.dir, "*.json"))):
            tasks[os.path.splitext(os.path.basename(fp))[0]] = _load(fp)
        return tasks
    challenges = _load(args.challenges)
    # Some files are {task_id: {...}}; others are a bare list of tasks.
    if isinstance(challenges, list):
        return {str(i): t for i, t in enumerate(challenges)}
    return challenges


def score_task(task, solutions, result):
    """
    Compare the predictions with the expected outputs (cell-for-cell).

    `solutions` may be a list (one per test input) or the ARC-AGI-2 dict form
    {"task_id": [grid, ...]}. Anything unreadable counts as wrong, never as skipped.
    """
    if isinstance(solutions, dict):
        expected = solutions.get("outputs", solutions)
        if isinstance(expected, dict):
            expected = list(expected.values())
    else:
        expected = solutions
    if not isinstance(expected, list):
        return False, False
    expected = [G.from_list(g) for g in expected]
    attempts = result["attempts"]
    if len(attempts) != len(expected):
        return False, False
    first, any_of = 0, 0
    for preds, want in zip(attempts, expected):
        preds = [G.from_list(p) for p in preds]
        any_of += int(want in preds)
        first += int(bool(preds) and preds[0] == want)
    return first == len(expected), any_of == len(expected)


def holdout_split(tasks, min_train_pairs=1):
    """
    Leave-one-out protocol on the PUBLIC tasks (the ARC eval answers are withheld,
    so honest offline numbers can only come from a holdout we make ourselves).

    For every task with >= min_train_pairs + 1 pairs, the LAST pair becomes the query:
        train  = pairs[:-1]
        test   = [{input: last_input}]
        answer = last_output
    This measures the same skill (induce a rule from few pairs and apply it) on
    real ARC material, and it is fully reproducible. It is a PROXY, not the
    leaderboard: the paper must label it as such.

    min_train_pairs=2 is the honest default for reporting: with a single remaining
    pair almost any hypothesis fits (a constant output included), so the number
    stops meaning what it claims to mean.
    """
    held_tasks, gold = {}, {}
    for task_id, task in tasks.items():
        pairs = (task or {}).get("train") or []
        if len(pairs) < min_train_pairs + 1:
            continue
        held_tasks[task_id] = {
            "train": pairs[:-1],
            "test": [{"input": pairs[-1]["input"]}],
        }
        gold[task_id] = [pairs[-1]["output"]]
    return held_tasks, gold


def main(argv=None):
    ap = argparse.ArgumentParser(description="Measure the Tukuk ARC solver on a real dataset")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--dir", help="directory of single-task JSON files")
    src.add_argument("--challenges", help="challenges JSON ({task_id: {train,test}})")
    ap.add_argument("--solutions", help="solutions JSON (required with --challenges)")
    ap.add_argument("--limit", type=int, default=0, help="evaluate only the first N tasks")
    ap.add_argument("--holdout", action="store_true",
                    help="leave-one-out on the last TRAIN pair (the only offline way to grade "
                         "public ARC data — label the result as a proxy)")
    ap.add_argument("--min-pairs", type=int, default=2,
                    help="holdout: keep only tasks with at least this many train pairs left "
                         "(default 2; 1 makes the number meaningless)")
    ap.add_argument("--time-budget", type=float, default=6.0, help="seconds per task")
    ap.add_argument("--attempts", type=int, default=2)
    ap.add_argument("--no-compositions", action="store_true")
    ap.add_argument("--out", help="write the measured results JSON here")
    ap.add_argument("--tasks-out", help="write per-task outcomes (task_id → pass@1/pass@2)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    tasks = load_tasks(args)
    if not tasks:
        print("✗ no tasks found", file=sys.stderr)
        return 2

    holdout_gold = {}
    protocol = "provided-solutions"
    if args.holdout:
        tasks, holdout_gold = holdout_split(tasks, min_train_pairs=max(1, args.min_pairs))
        protocol = "holdout (last train pair withheld, min %d train pairs kept)" % max(1, args.min_pairs)
        if not tasks:
            print("✗ holdout needs tasks with at least %d train pairs" % (max(1, args.min_pairs) + 1),
                  file=sys.stderr)
            return 2

    task_ids = sorted(tasks)
    if args.limit:
        task_ids = task_ids[:args.limit]

    solutions_map = {}
    if args.holdout:
        solutions_map = holdout_gold
    elif args.challenges:
        if not args.solutions:
            print("✗ --challenges needs --solutions", file=sys.stderr)
            return 2
        raw = _load(args.solutions)
        solutions_map = raw if isinstance(raw, dict) else {str(i): s for i, s in enumerate(raw)}

    started = time.monotonic()
    graded = 0
    pass1 = pass2 = consistent = 0
    per_task = {}
    for index, task_id in enumerate(task_ids, 1):
        task = tasks[task_id]
        result = solve_task(task, attempts=args.attempts, time_budget_s=args.time_budget,
                            with_compositions=not args.no_compositions)
        consistent += int(result["solved"])
        entry = {"consistent": result["solved"], "programs": result["programs"],
                 "elapsed": round(result["elapsed"], 3)}
        expected = solutions_map.get(task_id)
        if expected is not None:
            first, any_of = score_task(task, expected, result)
            graded += 1
            pass1 += int(first)
            pass2 += int(any_of)
            entry.update({"pass@1": first, "pass@2": any_of})
        per_task[task_id] = entry
        if not args.quiet:
            mark = "PASS2" if entry.get("pass@2") else ("pass1" if entry.get("pass@1") else "fail")
            prog = result["programs"][0] if result["programs"] else "no-program"
            print(f"[{index}/{len(task_ids)}] {mark:6} {task_id} {result['elapsed']:5.2f}s {prog}",
                  flush=True)

    elapsed = time.monotonic() - started
    summary = {
        "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": args.dir or args.challenges,
        "protocol": protocol,
        "tasks": len(task_ids),
        "graded": graded,
        "consistent_program": consistent,
        "pass@1": pass1,
        "pass@2": pass2,
        "pass@1_rate": round(pass1 / graded, 4) if graded else None,
        "pass@2_rate": round(pass2 / graded, 4) if graded else None,
        "consistent_rate": round(consistent / len(task_ids), 4) if task_ids else None,
        "elapsed_s": round(elapsed, 1),
        "per_task_s": round(elapsed / len(task_ids), 2) if task_ids else None,
        "config": {
            "attempts": args.attempts,
            "time_budget_s": args.time_budget,
            "compositions": not args.no_compositions,
            "min_pairs": max(1, args.min_pairs) if args.holdout else None,
        },
        "command": "python -m arc.evaluate " + " ".join(sys.argv[1:]),
        "note": ("pass@N counts a task only when EVERY test input is exactly right. "
                 "'consistent_program' is not accuracy: it only says the train pairs were "
                 "reproduced." if graded else
                 "No solutions supplied — accuracy was NOT measured; only consistency counts."),
    }

    print()
    print(json.dumps(summary, indent=2))
    if args.tasks_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.tasks_out)), exist_ok=True)
        with open(args.tasks_out, "w", encoding="utf-8") as fh:
            json.dump(per_task, fh, indent=2)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        payload = dict(summary, per_task=per_task)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
        print(f"results → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
