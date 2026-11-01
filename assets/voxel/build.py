#!/usr/bin/env python3
"""
Voxel asset build (D-057; ART_DIRECTION §7): every content model, decor and
life model from assets/voxel/recipes (or an automatic placeholder) into
client/public/models/ with manifest.json and the build-card thumbnails.
Python 3 standard library only; deterministic bytes.

  python3 assets/voxel/build.py            build (parallel)
  python3 assets/voxel/build.py --check    rebuild into a temp dir and compare with the committed output
  python3 assets/voxel/build.py --list     the model IDs (recipe or placeholder)
  python3 assets/voxel/build.py --only fisher,house_settlers --sheet out.png   contact sheet only
"""

import argparse
import math
import json
import multiprocessing
import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from nsvoxel import auto, config, content as content_mod, export, model, render  # noqa: E402

OUT_DIR = config.MODELS_DIR


def targets(content, recipes, held=False):
    """
    [(id, kind)] of every model to build: the content IDs, then the decor
    and life recipes. Planned IDs on hold (planned/*.json `hold`, not yet in
    the content) are only listed with held=True: they are built for sheets
    and tests but not published.
    """
    out = [(cid, content_mod.kind_of(content, cid)) for cid in content_mod.required_ids(content, held=held)]
    out += [(cid, "decor") for cid in sorted(recipes) if cid.startswith(config.DECOR_PREFIX)]
    out += [(cid, "life") for cid in sorted(recipes) if cid.startswith(config.LIFE_PREFIX)]
    return out


def recipe_for(cid, kind, recipes):
    """(recipe, placeholder?) of an ID: its recipe file, else the automatic placeholder of its kind (None: no placeholder)."""
    if cid in recipes:
        return recipes[cid], False
    fn = auto.pick(kind)
    if fn is None:
        return None, True
    return {"build": fn, "file": None}, True


def kind_for(content, cid):
    """The kind of an ID: content kind, or decor/life by prefix."""
    if cid.startswith(config.DECOR_PREFIX):
        return "decor"
    if cid.startswith(config.LIFE_PREFIX):
        return "life"
    return content_mod.kind_of(content, cid)


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
    return [((t[0], t[1], t[2]), [colors[("v", 0, k)][:3] for k in ks], t[6]) for t, ks in zip(tris, ao_keys)]


def thumbnail(f, size=config.THUMB_PX):
    _, _, _, v, ctx = f
    rows = render.render(tri_list(v, ctx), size * 2)
    return render.png(render.downsample(rows, size * 2), size, size)


def parse(argv=None):
    ap = argparse.ArgumentParser(description="Voxel asset build (client/public/models).")
    ap.add_argument("--check", action="store_true", help="rebuild into a temp dir and fail when it differs from --out")
    ap.add_argument("--list", action="store_true", help="print the model IDs (recipe or placeholder) and exit")
    ap.add_argument("--only", default="", help="comma-separated IDs: build them without writing any output (with --sheet)")
    ap.add_argument("--sheet", default="", help="write a contact sheet PNG of the --only IDs")
    ap.add_argument("--turn", type=int, default=0, help="the sheet's camera turned by quarter turns about the model (2: from the back, 180°)")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    return ap.parse_args(argv)


def build_outputs(jobs_n, chosen, thumbs=True):
    """(outputs {relative path: bytes}, stats, problems) of the chosen (id, kind) targets."""
    jobs = [(cid, kind, thumbs) for cid, kind in chosen]
    if jobs_n <= 1:
        # In-process (tests: a spawned pool would re-import the test runner).
        results = [_job(j) for j in jobs]
    else:
        with multiprocessing.Pool(jobs_n, initializer=_init) as pool:
            results = pool.map(_job, jobs, chunksize=1)
    problems = []
    entries = {}
    outputs = {}
    stats = []
    for cid, kind, files, entry, probs, thumb, secs, placeholder in results:
        problems += [f"{cid}: {p}" for p in probs]
        if entry is not None:
            entries[cid] = entry
        for name, data, _ in files:
            outputs[name] = data
        if thumb is not None:
            outputs[f"thumbs/{cid}.png"] = thumb
        stats.append((cid, kind, placeholder, [n for _, _, n in files], secs))
    placeholders = sorted(cid for cid, kind, placeholder, _, _ in stats if placeholder and kind not in ("decor", "life"))
    outputs["manifest.json"] = manifest(entries, placeholders)
    return outputs, stats, problems


def manifest(entries, placeholders):
    """manifest.json bytes: the models, decor and life entries and the placeholder IDs."""
    decor = {k: v for k, v in entries.items() if v["kind"] == "decor"}
    life = {k: v for k, v in entries.items() if v["kind"] == "life"}
    models = {k: v for k, v in entries.items() if v["kind"] not in ("decor", "life")}
    export.roles()
    doc = {
        "version": config.MANIFEST_VERSION,
        "generator": config.GENERATOR,
        "palette_sha256": export.PALETTE_SHA,
        "voxels_per_tile": config.VOXELS_PER_TILE,
        "placeholders": placeholders,
        "models": dict(sorted(models.items())),
        "decor": dict(sorted(decor.items())),
        "life": dict(sorted(life.items())),
    }
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main(argv=None):
    args = parse(argv)
    _init()
    all_targets = targets(_CONTENT, _RECIPES)
    listed = targets(_CONTENT, _RECIPES, held=True)
    if args.list:
        for cid, kind in listed:
            tag = "recipe" if cid in _RECIPES else "auto"
            print(f"{cid:28s} {kind:8s} {tag}{' (held)' if cid in content_mod.held_ids(_CONTENT) else ''}")
        return 0
    only = [s for s in args.only.split(",") if s]
    if only:
        known = {cid for cid, _ in listed}
        unknown = [cid for cid in only if cid not in known]
        if unknown:
            print(f"unknown model ID(s): {', '.join(unknown)} (see --list)", file=sys.stderr)
            return 2
        problems = []
        for cid in only:
            kind = kind_for(_CONTENT, cid)
            recipe, _ = recipe_for(cid, kind, _RECIPES)
            problems += [f"{cid}: {p}" for p in model.build_id(cid, kind, recipe, _CONTENT)[2]]
        if args.sheet:
            write_sheet(args.sheet, only, turn=args.turn)
            print(f"sheet: {args.sheet}")
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
        return 0

    outputs, stats, problems = build_outputs(args.jobs, all_targets)
    for cid, kind, placeholder, tris, secs in sorted(stats) if not args.check else []:
        tag = "auto" if placeholder else "recipe"
        print(f"{cid:28s} {kind:8s} {tag:6s} " + " ".join(str(n) for n in tris) + f"  {secs:.1f}s")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    if args.check:
        tmp = tempfile.mkdtemp(prefix="ns-models-")
        try:
            write(tmp, outputs)
            return compare(tmp, args.out)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    write(args.out, outputs)
    return 0


def tree(root):
    """{relative path: bytes} of every file below root (none when root is missing)."""
    out = {}
    for base, _, names in os.walk(root):
        for n in names:
            path = os.path.join(base, n)
            with open(path, "rb") as f:
                out[os.path.relpath(path, root).replace(os.sep, "/")] = f.read()
    return out


def write(out_dir, outputs):
    """Writes the outputs into out_dir and removes every other file there (the build owns the folder)."""
    existing = tree(out_dir)
    changed = [n for n, data in sorted(outputs.items()) if existing.get(n) != data]
    stale = sorted(set(existing) - set(outputs))
    for name in changed:
        path = os.path.join(out_dir, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(outputs[name])
    for name in stale:
        os.remove(os.path.join(out_dir, name))
    print(f"{out_dir}: {len(changed)} written, {len(stale)} removed, {len(outputs)} files")


def compare(built, committed):
    """0 when the two folders hold the same files with the same bytes, else 1 (lists the differences)."""
    a, b = tree(built), tree(committed)
    changed = sorted(n for n in set(a) & set(b) if a[n] != b[n])
    missing = sorted(set(a) - set(b))
    stale = sorted(set(b) - set(a))
    if changed or missing or stale:
        print(
            f"models out of date: {len(changed)} changed, {len(missing)} missing, {len(stale)} stale (run `make assets`)",
            file=sys.stderr,
        )
        for n in (changed + missing + stale)[:20]:
            print("  " + n, file=sys.stderr)
        return 1
    print(f"models current ({len(a)} files)")
    return 0


def write_sheet(path, ids, cell=256, cols=4, turn=0):
    """A contact sheet of the given IDs (every variant/level, attachments included), the camera turned by `turn` quarter turns (the game's ROTATION)."""
    azimuth = render.AZIMUTH + turn * math.pi / 2
    imgs = []
    for cid in ids:
        kind = kind_for(_CONTENT, cid)
        recipe, _ = recipe_for(cid, kind, _RECIPES)
        for _, key, ctx in model.outputs(cid, kind, recipe, _CONTENT):
            ctx.needs = model.required_anchors(_CONTENT, cid) if kind in ("building", "field") else []
            ctx.smoke = "smoke" in ctx.needs
            v = model.build_grid(recipe, kind, key, ctx)
            rows = render.render(tri_list(v, ctx), cell * 2, azimuth=azimuth)
            imgs.append(render.downsample(rows, cell * 2))
    rows, w, h = render.sheet(imgs, cols, cell)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(render.png(rows, w, h))


if __name__ == "__main__":
    sys.exit(main())
