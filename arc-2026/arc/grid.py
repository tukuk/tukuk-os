"""
grid.py — ARC grid primitives (pure Python, no numpy).

A grid is an immutable tuple of tuples of ints (colors 0..9). Immutability makes
caching and equality trivial, which matters: the solver compares thousands of
candidate grids against the training outputs and must never alias-mutate one.

Nothing here knows about tasks or search — it is the geometry/colour layer only.
"""
from collections import Counter

Grid = tuple  # tuple[tuple[int, ...], ...]


def from_list(obj) -> Grid:
    return tuple(tuple(int(v) for v in row) for row in obj)


def to_list(grid: Grid):
    return [list(row) for row in grid]


def height(g: Grid) -> int:
    return len(g)


def width(g: Grid) -> int:
    return len(g[0]) if g else 0


def shape(g: Grid):
    return (height(g), width(g))


def cells(g: Grid):
    for y, row in enumerate(g):
        for x, v in enumerate(row):
            yield y, x, v


def colors(g: Grid):
    return {v for _, _, v in cells(g)}


def background(g: Grid) -> int:
    """The background colour: the most frequent one (ties broken toward 0, then smallest)."""
    counts = Counter(v for _, _, v in cells(g))
    if not counts:
        return 0
    best = max(counts.items(), key=lambda kv: (kv[1], -kv[0]))
    return best[0]


def non_background_bbox(g: Grid, bg=None):
    """Bounding box (y0, x0, y1, x1) of every non-background cell, or None."""
    bg = background(g) if bg is None else bg
    ys = [y for y, _, v in cells(g) if v != bg]
    xs = [x for _, x, v in cells(g) if v != bg]
    if not ys:
        return None
    return (min(ys), min(xs), max(ys), max(xs))


def crop(g: Grid, box) -> Grid:
    y0, x0, y1, x1 = box
    return tuple(row[x0:x1 + 1] for row in g[y0:y1 + 1])


def crop_to_content(g: Grid, bg=None) -> Grid:
    box = non_background_bbox(g, bg)
    return g if box is None else crop(g, box)


def pad(g: Grid, top=0, bottom=0, left=0, right=0, color=0) -> Grid:
    w = width(g) + left + right
    rows = [tuple([color] * w) for _ in range(top)]
    rows += [tuple([color] * left) + row + tuple([color] * right) for row in g]
    rows += [tuple([color] * w) for _ in range(bottom)]
    return tuple(rows)


def rot90(g: Grid) -> Grid:
    h, w = shape(g)
    return tuple(tuple(g[h - 1 - y][x] for y in range(h)) for x in range(w))


def rot180(g: Grid) -> Grid:
    return tuple(tuple(reversed(row)) for row in reversed(g))


def rot270(g: Grid) -> Grid:
    return rot90(rot180(g))


def fliplr(g: Grid) -> Grid:
    return tuple(tuple(reversed(row)) for row in g)


def flipud(g: Grid) -> Grid:
    return tuple(reversed(g))


def transpose(g: Grid) -> Grid:
    return tuple(zip(*g)) if g else ()


def apply_colormap(g: Grid, mapping) -> Grid:
    return tuple(tuple(mapping.get(v, v) for v in row) for row in g)


def upscale(g: Grid, ky: int, kx: int) -> Grid:
    out = []
    for row in g:
        grown = tuple(v for v in row for _ in range(kx))
        for _ in range(ky):
            out.append(grown)
    return tuple(out)


def downscale(g: Grid, ky: int, kx: int):
    """Exact block-downscale; None when the grid is not an integer repeat."""
    h, w = shape(g)
    if ky <= 0 or kx <= 0 or h % ky or w % kx:
        return None
    out = []
    for y in range(0, h, ky):
        row = []
        for x in range(0, w, kx):
            block = {g[y + dy][x + dx] for dy in range(ky) for dx in range(kx)}
            if len(block) != 1:
                return None
            row.append(block.pop())
        out.append(tuple(row))
    return tuple(out)


def tile_to(g: Grid, rows: int, cols: int) -> Grid:
    return tuple(tuple([v for v in g[y % height(g)] for _ in range(cols)]) for y in range(height(g) * rows)) if g else ()


def hstack(a: Grid, b: Grid) -> Grid:
    return tuple(ra + rb for ra, rb in zip(a, b))


def vstack(a: Grid, b: Grid) -> Grid:
    return tuple(a) + tuple(b)


def components(g: Grid, bg=None, connectivity: int = 4):
    """
    Connected components of same-coloured cells over the non-background colours.

    Returns a list of dicts: {color, cells:[(y,x)], bbox:(y0,x0,y1,x1), size}.
    Used by the object-level rules (keep largest, fill holes, drop smallest...).
    """
    bg = background(g) if bg is None else bg
    h, w = shape(g)
    seen = [[False] * w for _ in range(h)]
    if connectivity == 8:
        steps = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    else:
        steps = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    out = []
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0][x0] or g[y0][x0] == bg:
                continue
            color = g[y0][x0]
            stack = [(y0, x0)]
            seen[y0][x0] = True
            comp = []
            while stack:
                y, x = stack.pop()
                comp.append((y, x))
                for dy, dx in steps:
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and not seen[ny][nx] and g[ny][nx] == color:
                        seen[ny][nx] = True
                        stack.append((ny, nx))
            ys = [p[0] for p in comp]
            xs = [p[1] for p in comp]
            out.append({
                "color": color,
                "cells": comp,
                "bbox": (min(ys), min(xs), max(ys), max(xs)),
                "size": len(comp),
            })
    return out


def object_grid(g: Grid, comp) -> Grid:
    """The component cropped to its own bounding box (its 'shape')."""
    return crop(g, comp["bbox"])


def replace_cells(g: Grid, points, color: int) -> Grid:
    cells_set = set(points)
    return tuple(tuple(color if (y, x) in cells_set else v for x, v in enumerate(row)) for y, row in enumerate(g))


def fill_enclosed(g: Grid, bg=None, color=None):
    """
    Fill background regions that cannot reach the border (a flood fill from the
    frame). Returns None when nothing changed — the caller then skips the candidate.
    """
    bg = background(g) if bg is None else bg
    color = color if color is not None else (max(colors(g)) if len(colors(g)) > 1 else 1)
    h, w = shape(g)
    outside = [[False] * w for _ in range(h)]
    stack = []
    for y in range(h):
        for x in (0, w - 1):
            if g[y][x] == bg:
                stack.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if g[y][x] == bg:
                stack.append((y, x))
    while stack:
        y, x = stack.pop()
        if outside[y][x]:
            continue
        outside[y][x] = True
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not outside[ny][nx] and g[ny][nx] == bg:
                stack.append((ny, nx))
    changed = False
    out = [list(row) for row in g]
    for y in range(h):
        for x in range(w):
            if g[y][x] == bg and not outside[y][x]:
                out[y][x] = color
                changed = True
    return tuple(tuple(r) for r in out) if changed else None
