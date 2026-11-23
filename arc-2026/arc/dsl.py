"""
dsl.py — the transformation language the solver searches over.

Two kinds of hypothesis:

  * GLOBAL transforms   — one operation applied to the whole grid (rotate, recolour by
                          a learned colour map, crop to content, scale, tile...).
  * OBJECT rules        — an operation defined on connected components (keep the
                          largest, fill enclosed holes, drop the smallest, gravity...).
                          These are the "object abstraction": they are what makes the
                          search survive changes of position/size that defeat a
                          pixel-level matcher.

Every generator receives the TRAIN pairs and returns candidate programs whose
parameters are *learned from those pairs* (never hard-coded per task). The search
then keeps only the programs that reproduce every train output exactly — the
consistency filter in search.py. Anything that needs a guess is not admitted.

A Program is (name, fn, complexity). Lower complexity wins ties, so a rotation is
preferred over a three-step composition that happens to agree on the train pairs.
"""
from . import grid as G


class Program:
    __slots__ = ("name", "fn", "complexity")

    def __init__(self, name, fn, complexity=1):
        self.name = name
        self.fn = fn
        self.complexity = complexity

    def __call__(self, g):
        return self.fn(g)

    def __repr__(self):
        return f"<Program {self.name} c={self.complexity}>"


def _safe(fn):
    """A candidate that raises on some grid is simply not a candidate."""
    def wrapped(g):
        try:
            return fn(g)
        except Exception:
            return None
    return wrapped


# ── learned parameters ───────────────────────────────────────────────────────

def learn_colormap(pairs):
    """A single colour→colour map consistent with every pair, or None."""
    mapping = {}
    for inp, out in pairs:
        if G.shape(inp) != G.shape(out):
            return None
        for (y, x, v) in G.cells(inp):
            target = out[y][x]
            if v in mapping and mapping[v] != target:
                return None
            mapping[v] = target
    return mapping if mapping else None


def output_shapes(pairs):
    return {G.shape(out) for _, out in pairs}


def uniform_input_shape(pairs):
    shapes = {G.shape(inp) for inp, _ in pairs}
    return shapes.pop() if len(shapes) == 1 else None


def consistent_scaling(pairs):
    """(ky, kx) when every output is exactly the input repeated, else None."""
    ratios = set()
    for inp, out in pairs:
        ih, iw = G.shape(inp)
        oh, ow = G.shape(out)
        if ih == 0 or iw == 0 or oh % ih or ow % iw:
            return None
        ratios.add((oh // ih, ow // iw))
    if len(ratios) != 1:
        return None
    ky, kx = ratios.pop()
    return (ky, kx) if (ky, kx) != (1, 1) else None


def consistent_downscaling(pairs):
    ratios = set()
    for inp, out in pairs:
        ih, iw = G.shape(inp)
        oh, ow = G.shape(out)
        if oh == 0 or ow == 0 or ih % oh or iw % ow:
            return None
        ratios.add((ih // oh, iw // ow))
    if len(ratios) != 1:
        return None
    ky, kx = ratios.pop()
    return (ky, kx) if (ky, kx) != (1, 1) else None


def consistent_tiling(pairs):
    """(rows, cols) when every output is the input tiled, else None."""
    ratios = set()
    for inp, out in pairs:
        ih, iw = G.shape(inp)
        oh, ow = G.shape(out)
        if ih == 0 or iw == 0 or oh % ih or ow % iw:
            return None
        ratios.add((oh // ih, ow // iw))
    if len(ratios) != 1:
        return None
    rows, cols = ratios.pop()
    return (rows, cols) if (rows > 1 or cols > 1) else None


# ── global candidates ───────────────────────────────────────────────────────

GEOMETRIC = [
    ("rot90", G.rot90),
    ("rot180", G.rot180),
    ("rot270", G.rot270),
    ("fliplr", G.fliplr),
    ("flipud", G.flipud),
    ("transpose", G.transpose),
]


def global_candidates(pairs):
    out = [Program("identity", lambda g: g, 1)]
    for name, fn in GEOMETRIC:
        out.append(Program(name, _safe(fn), 1))

    cmap = learn_colormap(pairs)
    if cmap and any(k != v for k, v in cmap.items()):
        out.append(Program("recolour(learned)", _safe(lambda g: G.apply_colormap(g, cmap)), 1))

    out.append(Program("crop_to_content", _safe(G.crop_to_content), 1))

    # A single constant answer (every train output identical) is a real hypothesis:
    # several ARC tasks reduce to "draw this shape regardless of the input". It is
    # ranked LAST on purpose — with one train pair it fits everything, and letting it
    # win would silently outrank a structural explanation.
    outs = {out_ for _, out_ in pairs}
    if len(outs) == 1:
        const = outs.pop()
        out.append(Program("constant_output", lambda g, c=const: c, 5))

    scale = consistent_scaling(pairs)
    if scale:
        ky, kx = scale
        out.append(Program(f"upscale({ky},{kx})", _safe(lambda g, a=ky, b=kx: G.upscale(g, a, b)), 2))

    down = consistent_downscaling(pairs)
    if down:
        ky, kx = down
        out.append(Program(f"downscale({ky},{kx})", _safe(lambda g, a=ky, b=kx: G.downscale(g, a, b)), 2))

    tiling = consistent_tiling(pairs)
    if tiling:
        rows, cols = tiling
        out.append(Program(f"tile({rows},{cols})", _safe(lambda g, a=rows, b=cols: G.tile_to(g, a, b)), 2))

    # Fixed output shape → pad/crop every input to it (the filler colour is learned).
    shapes = output_shapes(pairs)
    if len(shapes) == 1:
        oh, ow = shapes.pop()
        fill = _learn_fill_color(pairs, oh, ow)
        out.append(Program(f"fit_to({oh}x{ow},fill={fill})",
                           _safe(lambda g, hh=oh, ww=ow, c=fill: _fit(g, hh, ww, c)), 2))
    return out


def _learn_fill_color(pairs, oh, ow):
    """The colour that fills the margin when every output is padded to (oh, ow)."""
    votes = {}
    for _, out in pairs:
        for _, _, v in G.cells(out):
            votes[v] = votes.get(v, 0) + 1
    if not votes:
        return 0
    return max(votes.items(), key=lambda kv: kv[1])[0]


def _fit(g, oh, ow, fill):
    h, w = G.shape(g)
    if h > oh or w > ow:
        return None
    return G.pad(g, 0, oh - h, 0, ow - w, fill)


# ── object-level rules (dimension preserving) ───────────────────────────────

def object_candidates(pairs):
    """Rules over connected components. Only dimension-preserving ones live here."""
    out = []
    all_colors = set()
    for inp, _ in pairs:
        all_colors |= G.colors(inp)

    for c in sorted(all_colors):
        out.append(Program(f"remove_color({c})", _safe(lambda g, cc=c: _remove_color(g, cc)), 2))
        out.append(Program(f"recolor_all({c})", _safe(lambda g, cc=c: _recolor_all(g, cc)), 3))

    out.append(Program("keep_largest_object", _safe(lambda g: _keep_rank(g, -1)), 2))
    out.append(Program("keep_smallest_object", _safe(lambda g: _keep_rank(g, 0)), 2))
    out.append(Program("drop_largest_object", _safe(lambda g: _drop_rank(g, -1)), 2))
    out.append(Program("drop_smallest_object", _safe(lambda g: _drop_rank(g, 0)), 2))
    out.append(Program("fill_enclosed", _safe(lambda g: G.fill_enclosed(g)), 2))
    out.append(Program("outline_objects", _safe(_outline), 3))
    out.append(Program("recolor_by_size_rank", _safe(_recolor_by_size_rank), 3))

    for direction in ("down", "up", "left", "right"):
        out.append(Program(f"gravity({direction})", _safe(lambda g, d=direction: _gravity(g, d)), 2))
    return out


def _remove_color(g, color):
    bg = G.background(g)
    if color == bg:
        return None
    return G.apply_colormap(g, {color: bg})


def _recolor_all(g, color):
    bg = G.background(g)
    if color == bg:
        return None
    return tuple(tuple(color if v != bg else v for v in row) for row in g)


def _ranked(g):
    comps = G.components(g)
    if len(comps) < 2:
        return None, []
    comps.sort(key=lambda c: (c["size"], c["bbox"]))
    return comps, comps


def _keep_rank(g, index):
    comps, _ = _ranked(g)
    if not comps:
        return None
    keep = set(map(tuple, comps[index]["cells"]))
    bg = G.background(g)
    return tuple(tuple(g[y][x] if (y, x) in keep else bg for x in range(G.width(g))) for y in range(G.height(g)))


def _drop_rank(g, index):
    comps, _ = _ranked(g)
    if not comps:
        return None
    drop = set(map(tuple, comps[index]["cells"]))
    bg = G.background(g)
    return tuple(tuple(bg if (y, x) in drop else g[y][x] for x in range(G.width(g))) for y in range(G.height(g)))


def _outline(g):
    """Recolour only the border cells of each component (the 'hollow' abstraction)."""
    comps = G.components(g)
    if not comps:
        return None
    bg = G.background(g)
    border = set()
    for comp in comps:
        y0, x0, y1, x1 = comp["bbox"]
        for (y, x) in comp["cells"]:
            if y in (y0, y1) or x in (x0, x1):
                border.add((y, x))
    return tuple(tuple(g[y][x] if (y, x) in border else bg for x in range(G.width(g))) for y in range(G.height(g)))


def _recolor_by_size_rank(g):
    """Rank objects by size and paint rank 0..n with distinct non-bg colours."""
    comps = G.components(g)
    if len(comps) < 2:
        return None
    comps.sort(key=lambda c: (-c["size"], c["bbox"]))
    palette = [c for c in range(1, 10) if c != G.background(g)]
    out = [list(row) for row in g]
    for rank, comp in enumerate(comps):
        color = palette[rank % len(palette)]
        for (y, x) in comp["cells"]:
            out[y][x] = color
    return tuple(tuple(r) for r in out)


def _gravity(g, direction):
    """Pack every object against one edge, preserving its internal shape and order."""
    comps = G.components(g)
    if not comps:
        return None
    bg = G.background(g)
    h, w = G.shape(g)
    out = [[bg] * w for _ in range(h)]
    ordered = sorted(comps, key=lambda c: c["bbox"][0] if direction in ("up", "down") else c["bbox"][1],
                     reverse=direction in ("down", "right"))
    cursor = {"up": 0, "down": h, "left": 0, "right": w}
    for comp in ordered:
        y0, x0, y1, x1 = comp["bbox"]
        oh, ow = y1 - y0 + 1, x1 - x0 + 1
        if direction == "up":
            ty = cursor["up"]
            cursor["up"] += oh
        elif direction == "down":
            ty = cursor["down"] - oh
            cursor["down"] -= oh
        else:
            ty = y0
        if direction == "left":
            tx = cursor["left"]
            cursor["left"] += ow
        elif direction == "right":
            tx = cursor["right"] - ow
            cursor["right"] -= ow
        else:
            tx = x0
        if ty < 0 or tx < 0 or ty + oh > h or tx + ow > w:
            return None
        for (y, x) in comp["cells"]:
            out[ty + (y - y0)][tx + (x - x0)] = comp["color"]
    return tuple(tuple(r) for r in out)


def compositions(pairs):
    """
    Two-step compositions of dimension-preserving globals.

    Deliberately narrow: only cheap, invertible-ish transforms. A wider cross-product
    would raise the candidate count without raising real coverage, and every extra
    candidate is another chance to overfit the train pairs.
    """
    prims = [(name, fn) for name, fn in GEOMETRIC] + [
        ("crop_to_content", G.crop_to_content),
        ("fill_enclosed", lambda g: G.fill_enclosed(g) or g),
    ]
    out = []
    for n1, f1 in prims:
        for n2, f2 in prims:
            if n1 == n2:
                continue
            out.append(Program(f"{n2}∘{n1}", _safe(lambda g, a=f1, b=f2: b(a(g))), 3))
    return out


# ── abstraction families that pay off on real ARC data ──────────────────────
# Added after measuring: each one covers a recurring task motif that the earlier
# families missed. They stay declarative (parameters learned, consistency filter
# unchanged) — no task-specific special cases.

def _symmetry_fill(g, axis):
    """
    Repair a grid using its own symmetry: a background cell whose mirror image is
    coloured takes that colour. axis: 'lr' (mirror across the vertical axis) or
    'ud'.
    """
    bg = G.background(g)
    h, w = G.shape(g)
    out = [list(row) for row in g]
    changed = False
    for y in range(h):
        for x in range(w):
            if g[y][x] != bg:
                continue
            my, mx = (y, w - 1 - x) if axis == "lr" else (h - 1 - y, x)
            if g[my][mx] != bg:
                out[y][x] = g[my][mx]
                changed = True
    return tuple(tuple(r) for r in out) if changed else None


def _crop_to_color(g, color):
    """The bounding box of ONE colour — 'find the red shape and keep it'."""
    cells = [(y, x) for y, x, v in G.cells(g) if v == color]
    if not cells:
        return None
    ys = [p[0] for p in cells]
    xs = [p[1] for p in cells]
    return G.crop(g, (min(ys), min(xs), max(ys), max(xs)))


def _half(g, side):
    """One half of a grid that is split in two (the classic 'pick the odd panel')."""
    h, w = G.shape(g)
    if side in ("left", "right"):
        if w % 2:
            return None
        half = w // 2
        return tuple(row[:half] for row in g) if side == "left" else tuple(row[half:] for row in g)
    if h % 2:
        return None
    half = h // 2
    return g[:half] if side == "top" else g[half:]


def _count_rect(g, color, orientation, count_objects):
    """A 1×n (or n×1) bar whose length is the object count — a counting task output."""
    n = len(G.components(g)) if count_objects else sum(1 for _, _, v in G.cells(g) if v == color)
    if n <= 0 or n > 30:
        return None
    return tuple(tuple(color for _ in range(n)) for _ in range(1)) if orientation == "row" \
        else tuple((color,) for _ in range(n))


def extra_candidates(pairs):
    """Second-wave families (symmetry repair, colour crops, panels, counting bars)."""
    out = []
    for axis in ("lr", "ud"):
        out.append(Program(f"symmetry_fill({axis})", _safe(lambda g, a=axis: _symmetry_fill(g, a)), 2))

    palette = set()
    for inp, _ in pairs:
        palette |= G.colors(inp)
    for c in sorted(palette):
        out.append(Program(f"crop_to_color({c})", _safe(lambda g, cc=c: _crop_to_color(g, cc)), 2))

    for side in ("left", "right", "top", "bottom"):
        out.append(Program(f"half({side})", _safe(lambda g, s=side: _half(g, s)), 2))

    # Counting bars: the colour and orientation are read off the first pair, then the
    # program must still reproduce the rest (the consistency filter decides).
    first_in, first_out = pairs[0]
    oh, ow = G.shape(first_out)
    if oh == 1 or ow == 1:
        color = first_out[0][0]
        orientation = "row" if oh == 1 else "col"
        for count_objects in (True, False):
            kind = "objects" if count_objects else "cells"
            out.append(Program("count_bar(%s,%s)" % (orientation, kind),
                               _safe(lambda g, c=color, o=orientation, k=count_objects:
                                     _count_rect(g, c, o, k)), 3))
    return out
