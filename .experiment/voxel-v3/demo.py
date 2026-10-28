#!/usr/bin/env python3
"""Scratch renders: demo.py out.png recipe.py W H [n variants] [--cell 384] — full + lite of build(ctx) with a fake footprint."""
import argparse, os, sys, importlib.util
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "assets", "voxel"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nsvoxel import model, render, export, grid, config  # noqa
import sheet  # noqa

ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("recipe"); ap.add_argument("w", type=int); ap.add_argument("h", type=int)
ap.add_argument("n", type=int, nargs="?", default=1); ap.add_argument("--cell", type=int, default=384)
ap.add_argument("--smoke", action="store_true"); ap.add_argument("--water", type=int, default=0); ap.add_argument("--tier", default="settlers")
ap.add_argument("--house", action="store_true")
a = ap.parse_args()
spec = importlib.util.spec_from_file_location("demo_recipe", a.recipe); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
content = {"buildings": {"demo": {"id": "demo", "footprint": [a.w, a.h], "tier": a.tier, "water_tiles": a.water, **({"house": {}} if a.house else {"recipe": {}}), "smoke": a.smoke}}, "ships": {}}
recipe = {"build": mod.build}
imgs = []
for i in range(a.n):
    ctx = model.Ctx("demo", "building", a.w, a.h, content["buildings"]["demo"], variant=i, level=i + 1)
    p, probs = sheet.pair("demo", "building", recipe, ("variant", i), ctx, content, a.cell)
    imgs += p
    if probs: print(probs)
rows, w, h = render.sheet(imgs, 2 * min(a.n, 3), a.cell)
open(a.out, "wb").write(render.png(rows, w, h)); print(a.out)
