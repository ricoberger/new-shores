#!/usr/bin/env python3
"""
V3/V4 review sheets: every output (variant / level) of the given IDs as a pair
of cells — the full model and its lite (2 voxels/tile, the far LOD) at the
same scale — with a caption (ID, key, triangles full/budget, lite/budget).
Experiment tooling only (does not touch the committed models).

  python3 .experiment/voxel-v4/sheet.py out.png id[,id…] [--cell 256] [--cols 4]
"""

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "assets", "voxel"))

import build  # noqa: E402
from nsvoxel import config, export, grid, model, render  # noqa: E402

GLYPHS = {
    "0": ("111", "101", "101", "101", "111"),
    "1": ("010", "110", "010", "010", "111"),
    "2": ("111", "001", "111", "100", "111"),
    "3": ("111", "001", "011", "001", "111"),
    "4": ("101", "101", "111", "001", "001"),
    "5": ("111", "100", "111", "001", "111"),
    "6": ("111", "100", "111", "101", "111"),
    "7": ("111", "001", "010", "010", "010"),
    "8": ("111", "101", "111", "101", "111"),
    "9": ("111", "101", "111", "001", "111"),
    "/": ("001", "001", "010", "100", "100"),
    "_": ("000", "000", "000", "000", "111"),
    ".": ("000", "000", "000", "000", "010"),
    "(": ("010", "100", "100", "100", "010"),
    ")": ("010", "001", "001", "001", "010"),
    " ": ("000", "000", "000", "000", "000"),
    "!": ("010", "010", "010", "000", "010"),
}


def glyph(ch):
    from nsvoxel.parts import FONT

    return GLYPHS.get(ch) or FONT.get(ch.upper()) or GLYPHS[" "]


def caption(rows, text, px=2, color=(43, 33, 23)):
    """Draws text into RGBA rows (top-left, scale px)."""
    w = len(rows[0]) // 4
    rows = [bytearray(r) for r in rows]
    x = 4
    for ch in text:
        g = glyph(ch)
        for r, bits in enumerate(g):
            for c, b in enumerate(bits):
                if b == "1":
                    for dy in range(px):
                        for dx in range(px):
                            X, Y = x + c * px + dx, 4 + r * px + dy
                            if X < w and Y < len(rows):
                                rows[Y][X * 4 : X * 4 + 4] = bytes(color) + b"\xff"
        x += 4 * px
    return [bytes(r) for r in rows]


def pair(cid, kind, recipe, key, ctx, content, cell):
    ctx.needs = model.required_anchors(content, cid) if kind in ("building", "field") else []
    ctx.smoke = "smoke" in ctx.needs
    v = recipe["build"](ctx)
    scale = 1.0 / ctx.vpt
    tris, colors, ao_keys, _ = export.build_tris(v.cells, ctx.W, ctx.D, scale, offset=v.offset)
    full = [((t[0], t[1], t[2]), [colors[("v", 0, k)] for k in ks], t[6]) for t, ks in zip(tris, ao_keys)]
    budget = model.budget_of(cid, kind, content, key)
    out = []
    # Fixed framing from the full model so both cells share the scale.
    cam, right, up = render.view_axes()
    pts = [(render._dot(p, right), render._dot(p, up)) for t, _, _ in full for p in t]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    size = cell * 2
    ext = max(max(xs) - min(xs), max(ys) - min(ys), 1e-3) * 1.12
    sc = size / ext
    centre = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2)
    img = render.downsample(render.render(full, size, scale=sc, centre=centre), size)
    tag = "" if key is None else f" {key[0][0]}{key[1]}"
    problems = model.check_grid(v, ctx, ctx.needs)
    img = caption(img, f"{cid}{tag} {len(full)}/{budget}" + (" !" if problems or len(full) > budget else ""))
    out.append(img)
    if kind == "building":
        f = config.LITE_DOWNSAMPLE
        lc = grid.downsample(v.cells, f, keep=max(2, f ** 3 // 8))
        lt, lcol, lk, _ = export.build_tris(lc, ctx.W / f, ctx.D / f, scale * f)
        lite = [((t[0], t[1], t[2]), [lcol[("v", 0, k)] for k in ks], t[6]) for t, ks in zip(lt, lk)]
        lb = model.lite_budget_of(cid, content)
        limg = render.downsample(render.render(lite, size, scale=sc, centre=centre), size)
        out.append(caption(limg, f"lite {len(lite)}/{lb}" + (" !" if len(lite) > lb else "")))
    else:
        out.append([bytes(cell * 4) for _ in range(cell)])
    return out, problems


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("ids")
    ap.add_argument("--cell", type=int, default=256)
    ap.add_argument("--cols", type=int, default=4, help="pairs per row")
    ap.add_argument("--only", default="", help="comma-separated output indices per ID (e.g. 0,2)")
    a = ap.parse_args(argv)
    build._init()
    content, recipes = build._CONTENT, build._RECIPES
    imgs, problems = [], []
    for cid in [s for s in a.ids.split(",") if s]:
        kind = build.kind_for(content, cid)
        recipe, _ = build.recipe_for(cid, kind, recipes)
        for i, (_, key, ctx) in enumerate(model.outputs(cid, kind, recipe, content)):
            if a.only and str(i) not in a.only.split(","):
                continue
            p, probs = pair(cid, kind, recipe, key, ctx, content, a.cell)
            imgs += p
            problems += [f"{cid} {key}: {x}" for x in probs]
    rows, w, h = render.sheet(imgs, a.cols * 2, a.cell)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "wb") as f:
        f.write(render.png(rows, w, h))
    print(a.out)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
