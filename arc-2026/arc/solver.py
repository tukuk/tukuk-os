"""
solver.py — command-line front end.

  # one task, human-readable
  python -m arc.solver --task data/evaluation/00576224.json

  # a whole Kaggle challenge file → submission.json
  python -m arc.solver --challenges arc-agi_test_challenges.json --out submission.json

  # the public evaluation set of the ARC-AGI-2 repo (one JSON per task)
  python -m arc.solver --dir data/evaluation --out predictions.json

Kaggle submission format (ARC Prize 2025/2026):
    {"<task_id>": [[<attempt 1 grid>], [<attempt 2 grid>]], ...}
i.e. one list per test input, each holding up to `attempts` grids.
"""
import argparse
import glob
import json
import os
import sys

from . import grid as G
from .search import solve_task


def _load_task(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _tasks_from_dir(path):
    out = {}
    for fp in sorted(glob.glob(os.path.join(path, "*.json"))):
        out[os.path.splitext(os.path.basename(fp))[0]] = _load_task(fp)
    return out


def solve_challenges(challenges, attempts=2, time_budget_s=6.0, with_compositions=True,
                     progress=False):
    """challenges: {task_id: {train:[...], test:[...]}} → (submission, report)."""
    submission, report = {}, {}
    total = len(challenges)
    for index, (task_id, task) in enumerate(sorted(challenges.items()), 1):
        result = solve_task(task, attempts=attempts, time_budget_s=time_budget_s,
                            with_compositions=with_compositions)
        submission[task_id] = [
            [G.to_list(g) for g in per_input] for per_input in result["attempts"]
        ]
        report[task_id] = {
            "solved": result["solved"],
            "programs": result["programs"],
            "elapsed": round(result["elapsed"], 3),
        }
        if progress:
            flag = "OK " if result["solved"] else "-- "
            name = result["programs"][0] if result["programs"] else "no consistent program"
            print(f"[{index}/{total}] {flag}{task_id} {result['elapsed']:.2f}s  {name}", flush=True)
    return submission, report


def main(argv=None):
    ap = argparse.ArgumentParser(description="Tukuk ARC solver — consistency-filtered program search")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--task", help="a single ARC task JSON")
    src.add_argument("--challenges", help="a Kaggle challenges JSON ({task_id: {train,test}})")
    src.add_argument("--dir", help="a directory of single-task JSON files")
    ap.add_argument("--out", help="write the submission JSON here")
    ap.add_argument("--attempts", type=int, default=2, help="grids per test input (ARC uses 2)")
    ap.add_argument("--time-budget", type=float, default=6.0, help="seconds per task")
    ap.add_argument("--no-compositions", action="store_true", help="skip two-step geometry (faster)")
    ap.add_argument("--report", help="write the per-task report JSON here")
    args = ap.parse_args(argv)

    if args.task:
        task = _load_task(args.task)
        result = solve_task(task, attempts=args.attempts, time_budget_s=args.time_budget,
                            with_compositions=not args.no_compositions)
        for i, per_input in enumerate(result["attempts"]):
            for a, g in enumerate(per_input):
                print(f"test[{i}] attempt[{a}] {G.shape(g)}")
                for row in g:
                    print("  " + "".join(str(v) for v in row))
        print("programs:", result["programs"] or "(none — structural fallback)")
        print(f"elapsed: {result['elapsed']:.2f}s")
        return 0

    challenges = _load_task(args.challenges) if args.challenges else _tasks_from_dir(args.dir)
    submission, report = solve_challenges(
        challenges, attempts=args.attempts, time_budget_s=args.time_budget,
        with_compositions=not args.no_compositions, progress=True,
    )
    solved = sum(1 for r in report.values() if r["solved"])
    print(f"\n{len(challenges)} task(s) · consistent program found: {solved} "
          f"({solved / max(1, len(challenges)) * 100:.1f}%) — this is NOT accuracy, "
          "run arc.evaluate for accuracy.")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(submission, fh)
        print(f"submission → {args.out}")
    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
        print(f"report → {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
