# ==============================================================================
# arc-2026-solver.py — Kaggle notebook for the ARC Prize 2026 Paper Track.
#
# It is the CODE SUBMISSION the paper links to: it runs the Tukuk ARC solver on the
# competition test set, writes submission.json, and prints the MEASURED accuracy on
# the public evaluation split (when solutions are available) so every number in the
# write-up can be traced to a run.
#
# DO NOT EDIT THE SOLVER HERE. The module sources below are injected from
# arc-2026/arc/*.py by scripts/arc-2026-push.sh, so the notebook and the repo can
# never drift apart. Running this file without that injection stops with a clear
# error instead of silently solving with an empty solver.
# ==============================================================================
import glob
import json
import os
import sys
import time
import zipfile

# === BEGIN EMBEDDED SOLVER (generated) ===
SOLVER_SOURCES = {}
# === END EMBEDDED SOLVER ===

# ARC_WORK exists so the exact same notebook can be dry-run here before it is
# submitted; on Kaggle it is always /kaggle/working.
WORK = os.environ.get("ARC_WORK", "/kaggle/working")
LIMIT = int(os.environ.get("ARC_LIMIT", "0"))       # 0 = all tasks
BUDGET = float(os.environ.get("ARC_BUDGET", "3"))   # seconds per task
ATTEMPTS = int(os.environ.get("ARC_ATTEMPTS", "2"))


def log(msg):
    print(f"[arc] {msg}", flush=True)


def materialise_solver():
    """Write the injected modules to a package dir and import them normally."""
    if not SOLVER_SOURCES:
        raise SystemExit(
            "No solver sources embedded. Push this job with:\n"
            "  bash scripts/arc-2026-push.sh\n"
            "(that script copies arc-2026/arc/*.py into this file)"
        )
    root = os.path.join(WORK, "_tukuk_arc")
    os.makedirs(root, exist_ok=True)
    for rel, source in SOLVER_SOURCES.items():
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(source)
    sys.path.insert(0, root)
    log(f"solver modules written: {len(SOLVER_SOURCES)} file(s) → {root}")


def find_input():
    """
    The competition data is mounted read-only under /kaggle/input. Names have moved
    between editions, so search for the pattern instead of hard-coding a path.
    """
    patterns = ["arc-agi_test_challenges.json", "*test_challenges*.json", "test_challenges*.json"]
    for base in ("/kaggle/input", os.getcwd()):
        for pattern in patterns:
            hits = sorted(glob.glob(os.path.join(base, "**", pattern), recursive=True))
            if hits:
                return hits[0]
    return None


def find_sibling(test_path, needle):
    """Locate a sibling file (evaluation/solutions) anywhere under the same root."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(test_path)))
    hits = sorted(glob.glob(os.path.join(root, "**", needle), recursive=True))
    return hits[0] if hits else None


def main():
    started = time.time()
    materialise_solver()
    from arc.solver import solve_challenges
    from arc.evaluate import score_task
    from arc import grid as G

    test_path = find_input()
    if not test_path:
        log("no test_challenges file found under /kaggle/input — listing it for diagnosis:")
        for dirpath, _dirnames, filenames in os.walk("/kaggle/input"):
            for name in filenames[:20]:
                print(os.path.join(dirpath, name))
        raise SystemExit(2)
    log(f"test challenges: {test_path}")

    with open(test_path, encoding="utf-8") as fh:
        challenges = json.load(fh)
    if isinstance(challenges, list):
        challenges = {str(i): t for i, t in enumerate(challenges)}
    if LIMIT:
        keep = sorted(challenges)[:LIMIT]
        challenges = {k: challenges[k] for k in keep}
    log(f"tasks: {len(challenges)} · budget {BUDGET}s/task · attempts {ATTEMPTS}")

    submission, report = solve_challenges(challenges, attempts=ATTEMPTS, time_budget_s=BUDGET,
                                          progress=True)
    out_path = os.path.join(WORK, "submission.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(submission, fh)
    log(f"submission.json written ({os.path.getsize(out_path) / 1024:.0f} KB)")

    # ── Format self-check against the official sample_submission, when present ──
    sample_path = find_sibling(test_path, "sample_submission.json")
    if sample_path:
        with open(sample_path, encoding="utf-8") as fh:
            sample = json.load(fh)
        missing = [k for k in sample if k not in submission]
        shape_bad = []
        for task_id, per_input in submission.items():
            want = sample.get(task_id)
            if want is not None and len(per_input) != len(want):
                shape_bad.append(task_id)
        log(f"format check: {len(sample)} sample tasks · missing {len(missing)} · "
            f"wrong attempt count {len(shape_bad)}")
        if missing:
            log(f"  MISSING example ids: {missing[:5]}")
        if shape_bad:
            log(f"  WRONG attempt count: {shape_bad[:5]}")
    else:
        log("sample_submission.json not found — format check skipped")

    # ── Measured accuracy on the public evaluation split (only if solutions exist) ──
    eval_path = find_sibling(test_path, "*evaluation_challenges*.json")
    sol_path = find_sibling(test_path, "*evaluation_solutions*.json")
    if eval_path and sol_path:
        with open(eval_path, encoding="utf-8") as fh:
            eval_challenges = json.load(fh)
        with open(sol_path, encoding="utf-8") as fh:
            solutions = json.load(fh)
        if isinstance(eval_challenges, list):
            eval_challenges = {str(i): t for i, t in enumerate(eval_challenges)}
        ids = sorted(eval_challenges)
        if LIMIT:
            ids = ids[:LIMIT]
        graded = pass1 = pass2 = consistent = 0
        for task_id in ids:
            task = eval_challenges[task_id]
            result = _solve(task, ATTEMPTS, BUDGET)
            consistent += int(result["solved"])
            expected = solutions.get(task_id) if isinstance(solutions, dict) else None
            if expected is None:
                continue
            graded += 1
            first, any_of = score_task(task, expected, result)
            pass1 += int(first)
            pass2 += int(any_of)
        log(f"EVAL: {len(ids)} tasks · graded {graded} · consistent {consistent}")
        if graded:
            log(f"EVAL measured: pass@1 {pass1}/{graded} = {pass1 / graded:.2%} · "
                f"pass@2 {pass2}/{graded} = {pass2 / graded:.2%}")
        with open(os.path.join(WORK, "eval_metrics.json"), "w", encoding="utf-8") as fh:
            json.dump({"tasks": len(ids), "graded": graded, "consistent": consistent,
                       "pass@1": pass1, "pass@2": pass2,
                       "pass@1_rate": (pass1 / graded) if graded else None,
                       "pass@2_rate": (pass2 / graded) if graded else None,
                       "budget_s": BUDGET, "attempts": ATTEMPTS}, fh, indent=2)
    else:
        log("evaluation challenges/solutions not mounted — accuracy cannot be measured here "
            "(the offline holdout numbers in arc-2026/results are the measured ones).")

    solved = sum(1 for r in report.values() if r["solved"])
    log(f"consistent program on {solved}/{len(report)} competition tasks "
        f"({solved / max(1, len(report)):.1%}) — this is NOT accuracy")
    log(f"DONE in {(time.time() - started) / 60:.1f} min")


def _solve(task, attempts, budget):
    """Small indirection so the eval loop reuses the same entry point as the solver."""
    from arc.search import solve_task
    return solve_task(task, attempts=attempts, time_budget_s=budget)


if __name__ == "__main__":
    main()
