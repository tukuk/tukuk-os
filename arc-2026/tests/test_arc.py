"""Behavioural tests for the ARC solver (stdlib unittest — no dependencies).

Each test builds a small task whose intended rule is known, so a failure means the
solver stopped solving a class of task it used to solve. Tests are deliberately
hand-made: they are about the SEARCH, not about a benchmark score.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from arc import grid as G  # noqa: E402
from arc.search import solve_task  # noqa: E402
from arc.evaluate import score_task  # noqa: E402


def task(pairs, tests):
    return {
        "train": [{"input": i, "output": o} for i, o in pairs],
        "test": [{"input": t} for t in tests],
    }


def flat(*rows):
    return [list(r) for r in rows]


def as_set(g):
    return frozenset(tuple(r) for r in g)


class GridPrimitives(unittest.TestCase):
    def test_rot90_four_times_is_identity(self):
        g = G.from_list([[1, 2, 3], [4, 5, 6]])
        self.assertEqual(G.rot90(G.rot90(G.rot90(G.rot90(g)))), g)

    def test_background_is_the_most_frequent_colour(self):
        self.assertEqual(G.background(G.from_list([[0, 0, 3], [0, 3, 3]])), 0)
        self.assertEqual(G.background(G.from_list([[5, 5, 0], [5, 5, 0]])), 5)
        # A tie is broken toward 0 (the ARC convention), never at random.
        self.assertEqual(G.background(G.from_list([[5, 5, 0], [5, 0, 0]])), 0)

    def test_upscale_downscale_roundtrip(self):
        g = G.from_list([[1, 2], [3, 0]])
        self.assertEqual(G.downscale(G.upscale(g, 3, 2), 3, 2), g)

    def test_downscale_rejects_non_uniform_blocks(self):
        self.assertIsNone(G.downscale(G.from_list([[1, 2], [3, 4]]), 2, 2))

    def test_components_separates_objects(self):
        g = G.from_list([[1, 0, 0], [1, 0, 2], [0, 0, 2]])
        comps = G.components(g)
        self.assertEqual(len(comps), 2)
        self.assertEqual(sorted(c["color"] for c in comps), [1, 2])

    def test_crop_to_content_drops_the_background_frame(self):
        g = G.from_list([[0, 0, 0], [0, 4, 0], [0, 0, 0]])
        self.assertEqual(G.crop_to_content(g), ((4,),))

    def test_fill_enclosed_fills_the_hole_only(self):
        g = G.from_list([[3, 3, 3], [3, 0, 3], [3, 3, 3]])
        filled = G.fill_enclosed(g, bg=0, color=1)
        self.assertEqual(filled[1][1], 1)
        # A border-touching background cell is NOT enclosed → nothing to fill.
        self.assertIsNone(G.fill_enclosed(G.from_list([[0, 0, 0], [0, 0, 0]])))


class SearchBehaviour(unittest.TestCase):
    def test_identity_is_solved(self):
        t = task([([[1, 2], [3, 4]], [[1, 2], [3, 4]]),
                  (([[5]], [[5]]))],
                 [[[7, 8], [9, 1]]])
        out = solve_task(t)
        self.assertTrue(out["solved"])
        self.assertIn("identity", out["programs"])
        self.assertEqual(out["attempts"][0][0], ((7, 8), (9, 1)))

    def test_rotation_is_found(self):
        t = task([([[1, 2], [3, 4]], [[3, 1], [4, 2]]),      # rot90
                  (([[5, 6, 7], [8, 9, 0]], [[8, 5], [9, 6], [0, 7]]))],
                 [[[1, 1], [2, 2]]])
        out = solve_task(t)
        self.assertTrue(out["solved"])
        self.assertIn("rot90", out["programs"])
        self.assertEqual(out["attempts"][0][0], ((2, 1), (2, 1)))

    def test_learned_colour_map(self):
        t = task([([[1, 0], [0, 1]], [[2, 0], [0, 2]]),
                  (([[1, 1]], [[2, 2]]))],
                 [[[1, 0], [1, 0]]])
        out = solve_task(t)
        self.assertTrue(out["solved"])
        self.assertIn("recolour(learned)", out["programs"])
        self.assertEqual(out["attempts"][0][0], ((2, 0), (2, 0)))

    def test_crop_to_content(self):
        t = task([([[0, 0, 0], [0, 7, 0], [0, 0, 0]], [[7]]),
                  (([[0, 0], [0, 7]], [[7]]))],
                 [[[0, 0, 0], [0, 0, 7], [0, 0, 0]]])
        out = solve_task(t)
        self.assertTrue(out["solved"])
        self.assertIn("crop_to_content", out["programs"])
        self.assertEqual(out["attempts"][0][0], ((7,),))

    def test_constant_output(self):
        t = task([([[1, 1], [1, 1]], [[9, 9]]), (([[2, 3]], [[9, 9]]))],
                 [[[4, 5, 6]]])
        out = solve_task(t)
        self.assertTrue(out["solved"])
        self.assertIn("constant_output", out["programs"])
        self.assertEqual(out["attempts"][0][0], ((9, 9),))

    def test_upscale_is_found(self):
        t = task([([[1, 2], [3, 4]], [[1, 1, 2, 2], [1, 1, 2, 2], [3, 3, 4, 4], [3, 3, 4, 4]]),
                  (([[5]], [[5, 5], [5, 5]]))],
                 [[[1, 0], [0, 1]]])
        out = solve_task(t)
        self.assertTrue(out["solved"])
        self.assertTrue(any(p.startswith("upscale") for p in out["programs"]))
        self.assertEqual(out["attempts"][0][0], ((1, 1, 0, 0), (1, 1, 0, 0), (0, 0, 1, 1), (0, 0, 1, 1)))

    def test_no_consistent_program_falls_back_honestly(self):
        # Different shapes and unrelated content: nothing should fit.
        t = task([([[1, 2], [3, 4]], [[7]]), (([[8, 8, 8]], [[1, 2, 3, 4, 5]]))],
                 [[[9]]])
        out = solve_task(t)
        self.assertFalse(out["solved"])
        self.assertEqual(out["programs"], [])
        self.assertEqual(len(out["attempts"][0]), 2, "ARC needs exactly 2 attempts per test input")

    def test_determinism(self):
        t = task([([[1, 2], [3, 4]], [[3, 1], [4, 2]]), (([[5, 6], [7, 8]], [[7, 5], [8, 6]]))],
                 [[[1, 1], [2, 2]]])
        a, b = solve_task(t), solve_task(t)
        self.assertEqual(a["programs"], b["programs"])
        self.assertEqual(as_set(a["attempts"][0][0]), as_set(b["attempts"][0][0]))

    def test_explicit_veto_of_object_rules_never_breaks_shape(self):
        """Every prediction is a rectangular grid of ints 0..9 — the submission contract."""
        t = task([([[1, 0], [0, 1]], [[0, 1], [1, 0]]), (([[2, 0], [0, 2]], [[0, 2], [2, 0]]))],
                 [[[3, 0], [0, 3]]])
        out = solve_task(t)
        for pred in out["attempts"][0]:
            pred = G.from_list(pred)
            self.assertTrue(pred and pred[0])
            width = len(pred[0])
            for row in pred:
                self.assertEqual(len(row), width)
                for v in row:
                    self.assertTrue(0 <= v <= 9)


class Scoring(unittest.TestCase):
    def test_pass_at_2_accepts_the_second_attempt(self):
        result = {"attempts": [[((5, 5),), ((9, 9),)]]}
        first, any_of = score_task({}, [[[5, 5]]], result)
        self.assertTrue(first)
        self.assertTrue(any_of)

        result = {"attempts": [[((9, 9),), ((5, 5),)]]}
        first, any_of = score_task({}, [[[5, 5]]], result)
        self.assertFalse(first)
        self.assertTrue(any_of)

    def test_wrong_size_is_never_a_pass(self):
        result = {"attempts": [[((5,),)]]}
        first, any_of = score_task({}, [[[5, 5]]], result)
        self.assertFalse(first or any_of)

    def test_multi_input_task_requires_every_input(self):
        result = {"attempts": [[((1,),), ((1,),)], [((2,),), ((2,),)]]}
        self.assertEqual(score_task({}, [[[1]], [[2]]], result), (True, True))
        self.assertEqual(score_task({}, [[[1]], [[3]]], result), (False, False))


if __name__ == "__main__":
    unittest.main(verbosity=2)
