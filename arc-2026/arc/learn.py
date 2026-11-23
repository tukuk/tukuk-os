"""
learn.py — the second inductive bias: a per-task CONTEXT LEARNER.

Why a second solver at all? DSL search and context learning fail on opposite kinds
of task:

  * DSL search explains a task with one rule. It wins when the task IS one rule
    (rotate, recolour, crop) and loses on texture/denoising tasks where every cell
    follows a local pattern that no single transform expresses.

  * The context learner predicts each output cell from the LOCAL CONTEXT of the
    input cell. It wins on texture/denoising/fill tasks and on dimension-preserving
    tasks with irregular structure; it cannot express "rotate the whole grid".

Both are admitted only if they reproduce EVERY train pair exactly, so the ensemble
cannot lie about the training data. The arbitration is the same simplicity ordering
used for DSL programs, with the learner placed just after the one-step transforms.

No dependencies: the "model" is a dict from a hashed context signature to a colour
vote. Signatures are tried from fine to coarse, so a cell with no exact match still
gets a sensible answer from a looser description of its neighbourhood.
"""
from collections import Counter

from . import grid as G


def _neighbours(g, y, x, radius=1):
    h, w = G.shape(g)
    out = []
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dy == 0 and dx == 0:
                continue
            ny, nx = y + dy, x + dx
            out.append(g[ny][nx] if (0 <= ny < h and 0 <= nx < w) else -1)
    return tuple(out)


def _object_of(g, comps_by_cell, y, x):
    comp = comps_by_cell.get((y, x))
    if comp is None:
        return None
    h, w = G.shape(g)
    y0, x0, y1, x1 = comp["bbox"]
    return {
        "color": comp["color"],
        "size_bucket": min(9, comp["size"]),
        "height": y1 - y0 + 1,
        "width": x1 - x0 + 1,
        "touches_border": int(y0 == 0 or x0 == 0 or y1 == h - 1 or x1 == w - 1),
        "offset_top": min(3, y0),
        "offset_left": min(3, x0),
    }


def _signatures(g, y, x, comps_by_cell, bg):
    """Coarse→fine context descriptions of one cell (all hashable)."""
    n4 = _neighbours(g, y, x, 1)
    obj = _object_of(g, comps_by_cell, y, x)
    obj_sig = (obj["color"], obj["size_bucket"], obj["height"], obj["width"],
               obj["touches_border"]) if obj else (bg, 0, 1, 1, 0)
    h, w = G.shape(g)
    return [
        (g[y][x], obj_sig, n4, obj["offset_top"] if obj else 0, obj["offset_left"] if obj else 0),
        (g[y][x], obj_sig, n4, obj["offset_top"] if obj else 0, obj["offset_left"] if obj else 0,
         y * 8 // max(1, h), x * 8 // max(1, w)),
        (g[y][x], obj_sig, n4),
        (g[y][x], obj_sig),
        (g[y][x],),
    ]


def _index(pairs):
    """One dictionary per signature level: signature → Counter(colour)."""
    levels = None
    for inp, out in pairs:
        bg = G.background(inp)
        comps = G.components(inp, bg=bg)
        by_cell = {}
        for comp in comps:
            for cell in comp["cells"]:
                by_cell[cell] = comp
        if levels is None:
            levels = [dict() for _ in range(5)]
        for y, x, _ in G.cells(inp):
            target = out[y][x]
            for level, sig in enumerate(_signatures(inp, y, x, by_cell, bg)):
                levels[level].setdefault(sig, Counter())[target] += 1
    return levels


def _predict(levels, g):
    bg = G.background(g)
    comps = G.components(g, bg=bg)
    by_cell = {}
    for comp in comps:
        for cell in comp["cells"]:
            by_cell[cell] = comp
    out = []
    for y, x, _ in G.cells(g):
        sigs = _signatures(g, y, x, by_cell, bg)
        value = None
        for level, sig in enumerate(sigs):
            counter = levels[level].get(sig)
            if counter:
                value = counter.most_common(1)[0][0]
                break
        out.append(value if value is not None else g[y][x])
    width = G.width(g)
    return tuple(tuple(out[i:i + width]) for i in range(0, len(out), width))


def context_program(pairs):
    """
    A callable that reproduces every train pair, or None.

    Only dimension-preserving tasks are eligible: the learner edits cells in place,
    so it has nothing to say about a task whose output has a different size.
    """
    if any(G.shape(inp) != G.shape(out) for inp, out in pairs):
        return None
    levels = _index(pairs)

    def predict(g):
        return _predict(levels, g)

    # Verify on the train pairs before offering the hypothesis at all: a learner that
    # misses one cell is not a candidate, it is a guess.
    for inp, out in pairs:
        try:
            if predict(inp) != out:
                return None
        except Exception:
            return None
    return predict


def is_dimension_preserving(pairs):
    return bool(pairs) and all(G.shape(inp) == G.shape(out) for inp, out in pairs)
