#!/usr/bin/env python3
"""
Voxel model build (prototype, .experiment/voxel/NOTES.md): every content
model, decor and life model from assets/voxel/recipes (or an auto
placeholder) into client/public/models-voxel/ with its own manifest and
thumbnails; the client loads it with ?voxel=1.

  python3 assets/voxel/build.py            build (parallel, deterministic)
  python3 assets/voxel/build.py --check    verify the committed output is current
  python3 assets/voxel/build.py --only fisher,house_settlers --sheet out.png
"""

import argparse
import json
import multiprocessing
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from nsvoxel import export, model, render  # noqa: E402
from nsvoxel import auto  # noqa: E402
from nsassets import config, content as content_mod  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(REPO, "client", "public", "models-voxel")
#: The decor and life IDs the client asks for: those of today's manifest.
CURRENT_MANIFEST = os.path.join(REPO, "client", "public", "models", "manifest.json")
GENERATOR = "new-shores voxel build (prototype)"
THUMB = 128


def targets(content):
    """[(id, kind)] of every model to build."""
    with open(CURRENT_MANIFEST, encoding="utf-8") as f:
        cur = json.load(f)
    out = [(cid, content_mod.kind_of(content, cid)) for cid in content_mod.required_ids(content)]
    out += [(cid, "decor") for cid in sorted(cur["decor"])]
    out += [(cid, "life") for cid in sorted(cur["life"])]
    return out


def recipe_for(cid, kind, recipes):
    if cid in recipes:
        return recipes[cid], False
    fn = auto.pick(kind)
    if fn is None:
        return None, True
    return {"build": fn, "file": None}, True


_RECIPES = None
_CONTENT = None


def _init():
    global _RECIPES, _CONTENT
    _RECIPES = model.recipe_modules()
    _CONTENT = content_mod.load()


def _job(args):
    cid, kind, thumbs = args
    t0 = time.time()
    recipe, placeholder = recipe_for(cid, kind, _RECIPES)
    if recipe is None:
        return cid, kind, [], None, [f"no recipe for {kind}"], None, 0.0, placeholder
    files, entry, problems = model.build_id(cid, kind, recipe, _CONTENT)
    thumb = None
    if thumbs and kind in ("building", "field", "ship") and files:
        thumb = thumbnail(files[0])
    out_files = [(f[0], f[1], f[2]) for f in files]
    return cid, kind, out_files, entry, problems, thumb, time.time() - t0, placeholder


def tri_list(v, ctx):
    """Triangles with corner colours of a grid (renderer input)."""
    tris, colors, ao_keys, _ = export.build_tris(v.cells, ctx.W, ctx.D, 1.0 / ctx.vpt, offset=v.offset)
    return [((t[0], t[1], t[2]), [colors[("v", 0, k)] for k in ks], t[6]) for t, ks in zip(tris, ao_keys)]


def thumbnail(f, size=THUMB):
    _, _, _, v, ctx = f
    rows = render.render(tri_list(v, ctx), size * 2)
    return render.png(render.downsample(rows, size * 2), size, size)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail when the output differs from the committed files")
    ap.add_argument("--only", default="", help="comma-separated IDs (no manifest; with --sheet)")
    ap.add_argument("--sheet", default="", help="write a contact sheet PNG of the built IDs")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = ap.parse_args(argv)

    _init()
    all_targets = targets(_CONTENT)
    only = [s for s in args.only.split(",") if s]
    chosen = [t for t in all_targets if not only or t[0] in only]
    thumbs = not only
    jobs = [(cid, kind, thumbs) for cid, kind in chosen]
    if args.jobs <= 1:
        # In-process (tests: a spawned pool would re-import the test runner).
        results = [_job(j) for j in jobs]
    else:
        with multiprocessing.Pool(args.jobs, initializer=_init) as pool:
            results = pool.map(_job, jobs, chunksize=1)

    problems = []
    entries = {}
    outputs = {}
    stats = []
    for cid, kind, files, entry, probs, thumb, secs, placeholder in results:
        problems += [f"{cid}: {p}" for p in probs]
        if entry is not None:
            entries[cid] = entry
        for name, data, n in files:
            outputs[name] = data
        if thumb is not None:
            outputs[f"thumbs/{cid}.png"] = thumb
        stats.append((cid, kind, placeholder, [(n, name) for name, _, n in files], secs))

    if args.sheet:
        write_sheet(args.sheet, [c for c, _ in chosen])
    for line in sorted(stats):
        cid, kind, placeholder, files, secs = line
        tag = "auto" if placeholder else "recipe"
        print(f"{cid:28s} {kind:8s} {tag:6s} " + " ".join(f"{n}" for n, _ in files) + f"  {secs:.1f}s")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    if only:
        return 0

    decor = {k: v for k, v in entries.items() if v["kind"] == "decor"}
    life = {k: v for k, v in entries.items() if v["kind"] == "life"}
    models = {k: v for k, v in entries.items() if v["kind"] not in ("decor", "life")}
    missing = sorted(cid for cid, kind, placeholder, _, _ in stats if placeholder and kind not in ("decor", "life"))
    doc = {
        "decor": dict(sorted(decor.items())),
        "life": dict(sorted(life.items())),
        "version": config.MANIFEST_VERSION,
        "generator": GENERATOR,
        "blender": None,
        "palette_sha256": export.PALETTE_SHA or export.roles() and export.PALETTE_SHA,
        "kit_scale": {},
        "file_scale": {},
        "missing_recipes": [],
        "placeholders": missing,
        "voxels_per_tile": 8,
        "models": dict(sorted(models.items())),
    }
    outputs["manifest.json"] = (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")
    return write_or_check(args.out, outputs, args.check)


def write_or_check(out_dir, outputs, check):
    existing = set()
    for root, _, names in os.walk(out_dir):
        for n in names:
            existing.add(os.path.relpath(os.path.join(root, n), out_dir))
    stale = sorted(existing - set(outputs))
    changed = []
    for name, data in sorted(outputs.items()):
        path = os.path.join(out_dir, name)
        try:
            with open(path, "rb") as f:
                same = f.read() == data
        except FileNotFoundError:
            same = False
        if same:
            continue
        changed.append(name)
        if not check:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
    if check:
        if changed or stale:
            print(f"models-voxel out of date: {len(changed)} changed, {len(stale)} stale (run python3 assets/voxel/build.py)", file=sys.stderr)
            for n in (changed + stale)[:20]:
                print("  " + n, file=sys.stderr)
            return 1
        print(f"models-voxel current ({len(outputs)} files)")
        return 0
    for n in stale:
        os.remove(os.path.join(out_dir, n))
    print(f"models-voxel: {len(changed)} written, {len(stale)} removed, {len(outputs)} files")
    return 0


def write_sheet(path, ids, cell=256, cols=4):
    """A contact sheet of the given IDs (every variant/level and the lite level next to the full one)."""
    imgs = []
    for cid in ids:
        kind = content_mod.kind_of(_CONTENT, cid) if cid in content_mod.required_ids(_CONTENT) else ("decor" if cid.startswith("decor_") else "life")
        recipe, _ = recipe_for(cid, kind, _RECIPES)
        for fname, key, ctx in model.outputs(cid, kind, recipe, _CONTENT):
            ctx.needs = model.required_anchors(_CONTENT, cid) if kind in ("building", "field") else []
            ctx.smoke = "smoke" in ctx.needs
            fn = recipe["cargo"] if key and key[0] == "attachment" else recipe["build"]
            v = fn(ctx)
            rows = render.render(tri_list(v, ctx), cell * 2)
            imgs.append(render.downsample(rows, cell * 2))
    rows, w, h = render.sheet(imgs, cols, cell)
    with open(path, "wb") as f:
        f.write(render.png(rows, w, h))


if __name__ == "__main__":
    sys.exit(main())
