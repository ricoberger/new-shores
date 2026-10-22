"""
New Shores asset build (ART_DIRECTION §7): recipes → kit-bashed low-poly
GLBs + client/public/models/manifest.json + contact sheets.

Run through the wrapper (it finds Blender 5.2.x):
    npm run assets                 (client/; = make assets)
    npm run assets -- --check      (= make assets-check: build into a temp dir and compare)
Directly:
    blender -b --factory-startup --python-exit-code 1 --python assets/build/build.py -- [options]
Without Blender (stdlib Python ≥ 3.11):
    python3 assets/build/build.py validate   (recipes against schema, content, kit manifest, palette)
    python3 assets/build/build.py pin        (writes the sha256 of every kit file the recipes use into MANIFEST.json)

Options: --out DIR (GLBs + manifest), --sheets DIR, --recipes DIR, --only id,id, --no-sheets, --check.
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nsassets import config, content as content_mod, kits, palette, pipeline, recipes as recipes_mod  # noqa: E402


def log(msg):
    print(msg, flush=True)


def parse(argv):
    argv = argv[argv.index("--") + 1 :] if "--" in argv else argv[1:]
    p = argparse.ArgumentParser(prog="assets/build/build.py")
    p.add_argument("command", nargs="?", default="build", choices=["build", "validate", "pin"])
    p.add_argument("--out", default=config.MODELS_DIR)
    p.add_argument("--sheets", default=config.SHEETS_DIR)
    p.add_argument("--recipes", default=config.RECIPES_DIR)
    p.add_argument("--only", default="")
    p.add_argument("--no-sheets", action="store_true")
    p.add_argument("--check", action="store_true", help="build into a temporary directory and compare with --out")
    return p.parse_args(argv)


def load_inputs(args):
    roles, palette_sha = palette.load()
    content = content_mod.load()
    manifest = kits.load_manifest()
    only = set(filter(None, args.only.split(","))) or None
    recipes = recipes_mod.load_all(args.recipes, content, kits.kit_files(manifest), roles, only=only)
    return roles, palette_sha, content, manifest, recipes, only


def cmd_validate(args):
    _, _, content, _, recipes, _ = load_inputs(args)
    missing = sorted(set(content_mod.required_ids(content)) - set(recipes))
    for m in missing:
        log(f"warning: no recipe for {m}")
    log(f"validate: {len(recipes)} recipe(s) valid")
    return 0


def cmd_pin(args):
    """Pins every kit file the recipes use (glTF + its external buffers) and the licence files."""
    manifest = kits.load_manifest()
    root = config.kits_root()
    used = {}
    for fname in sorted(os.listdir(args.recipes)):
        if not fname.endswith(".json") or fname == "schema.json":
            continue
        with open(os.path.join(args.recipes, fname), encoding="utf-8") as f:
            recipe = json.load(f)
        for _, parts in recipes_mod.part_groups(recipe):
            for p in parts:
                if "kit" in p:
                    used.setdefault(p["kit"], set()).add(p["file"])
    for kit in manifest["kits"]:
        files = set(used.get(kit["id"], set()))
        base = os.path.join(root, kit["dir"])
        for rel in list(files):
            with open(os.path.join(base, rel), encoding="utf-8") as f:
                doc = json.load(f)
            for b in doc.get("buffers", []):
                uri = b.get("uri", "")
                if uri and not uri.startswith("data:"):
                    files.add(os.path.normpath(os.path.join(os.path.dirname(rel), uri)))
        if kit.get("licence_file"):
            files.add(kit["licence_file"])
        kit["files"] = {rel: kits.sha256_file(os.path.join(base, rel)) for rel in sorted(files)}
        log(f"pin: {kit['id']}: {len(files)} file(s)")
    with open(config.KITS_MANIFEST_PATH, "w", encoding="utf-8") as f:
        f.write(json.dumps(manifest, indent=2) + "\n")
    return 0


def cmd_build(args):
    from nsassets import blender_ops

    log(f"assets: Blender {blender_ops.blender_version()} ({sys.version.split()[0]})")
    manifest = kits.load_manifest()
    try:
        kits.verify(manifest)
    except kits.KitError as e:
        log(f"assets: {e}")
        return 1
    roles, palette_sha, content, manifest, recipes, only = load_inputs(args)
    blender_ops.reset()
    loader = blender_ops.KitLoader(lambda kit, rel: kits.file_path(manifest, kit, rel))
    entries, written, errors, sheet_items = {}, {}, [], []
    for cid in sorted(recipes):
        files, entry, problems = pipeline.build_recipe(recipes[cid], content, roles, loader)
        if problems:
            errors += problems
            continue
        entries[cid] = entry
        for fname, data, mesh, _ in files:
            written[fname] = data
        sheet_items.append((cid, files, roles))
        log(f"  {cid}: " + ", ".join(f"{f[0]} {len(f[2])} tris" for f in files))
    missing = sorted(set(content_mod.required_ids(content)) - set(recipes))
    if only is None:
        for m in missing:
            log(f"warning: no recipe for {m}")
    if errors:
        log(f"assets: {len(errors)} problem(s):\n  " + "\n  ".join(errors))
        return 1
    manifest_bytes = pipeline.manifest(entries, palette_sha, blender_ops.blender_version(), missing)
    if args.check:
        tmp = tempfile.mkdtemp(prefix="ns-assets-check-")
        try:
            write_outputs(tmp, written, manifest_bytes)
            return compare(tmp, args.out)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    write_outputs(args.out, written, manifest_bytes)
    total = sum(len(d) for d in written.values()) + len(manifest_bytes)
    log(f"assets: wrote {len(written)} GLB(s) + manifest.json to {args.out} ({total} bytes)")
    if not args.no_sheets:
        write_sheets(args.sheets, sheet_items, blender_ops)
    return 0


def write_outputs(out, written, manifest_bytes):
    os.makedirs(out, exist_ok=True)
    for f in sorted(os.listdir(out)):
        if f.endswith(".glb") and f not in written:
            os.remove(os.path.join(out, f))
    for fname, data in sorted(written.items()):
        with open(os.path.join(out, fname), "wb") as f:
            f.write(data)
    with open(os.path.join(out, "manifest.json"), "wb") as f:
        f.write(manifest_bytes)


def _digests(d):
    if not os.path.isdir(d):
        return {}
    out = {}
    for f in sorted(os.listdir(d)):
        if f.endswith(".glb") or f == "manifest.json":
            with open(os.path.join(d, f), "rb") as fh:
                out[f] = hashlib.sha256(fh.read()).hexdigest()
    return out


def compare(built, committed):
    a, b = _digests(built), _digests(committed)
    diff = sorted(f for f in set(a) | set(b) if a.get(f) != b.get(f))
    if diff:
        log(f"assets-check: {len(diff)} file(s) differ from {committed} (run `make assets` and commit):")
        for f in diff:
            state = "missing" if f not in b else "extra" if f not in a else "changed"
            log(f"  {state}: {f}")
        return 1
    log(f"assets-check: {len(a)} file(s) identical")
    return 0


SKY = palette.hex_rgb("#9DB7D9")
SUN = palette.hex_rgb("#FFF1D6")
BACKGROUND = palette.hex_rgb("#E4D3AE")


def _colors(roles, mesh):
    return {(t[3], t[4]): tuple(min(1.0, c * t[4]) for c in roles[t[3]]) for t in mesh.tris}


def _cell(meshes):
    size = 1.0
    for m in meshes:
        mn, mx = m.bounds()
        size = max(size, ((mx[0] - mn[0]) ** 2 + (mx[1] - mn[1]) ** 2) ** 0.5, (mx[2] - mn[2]) * 1.4)
    return size * 1.25


def write_sheets(out, items, blender_ops):
    os.makedirs(out, exist_ok=True)
    all_cells = []
    for cid, files, roles in items:
        main = [f for f in files if not f[0].endswith(".cargo.glb")]
        cargo = [f for f in files if f[0].endswith(".cargo.glb")]
        columns = [(f[0], f[2]) for f in main]
        for c in cargo:
            # The attachment on its model (drawn at the same matrix in the client).
            from nsassets.geometry import Mesh

            both = Mesh(main[0][2].tris + c[2].tris)
            columns.append((f"{main[0][0]} + {c[0]}", both))
        cell = _cell([m for _, m in columns])
        cells = []
        for col, (label, mesh) in enumerate(columns):
            for k in range(4):
                cells.append((f"{label} ({len(mesh)}) k={k}" if k == 0 else f"k={k}", mesh.tris, _colors(roles, mesh), k, col, k))
        blender_ops.render_sheet(os.path.join(out, f"{cid}.png"), cells, len(columns), 4, cell, 320, SKY, SUN, BACKGROUND)
        for fname, _, mesh, _ in files:
            all_cells.append((f"{fname} {len(mesh)}", mesh, roles))
    cols = 7
    rows = (len(all_cells) + cols - 1) // cols
    cell = _cell([m for _, m, _ in all_cells]) * 0.8
    cells = [(label, m.tris, _colors(r, m), 0, i % cols, i // cols) for i, (label, m, r) in enumerate(all_cells)]
    blender_ops.render_sheet(os.path.join(out, "all.png"), cells, cols, rows, cell, 300, SKY, SUN, BACKGROUND)
    log(f"assets: contact sheets in {out}")


def main(argv):
    args = parse(argv)
    try:
        if args.command == "validate":
            return cmd_validate(args)
        if args.command == "pin":
            return cmd_pin(args)
        return cmd_build(args)
    except (recipes_mod.RecipeError, kits.KitError) as e:
        log(f"assets: {e}")
        return 1


if __name__ == "__main__":
    code = main(sys.argv)
    if "bpy" in sys.modules:
        # Inside Blender: --python-exit-code only reports exceptions; exit explicitly.
        sys.stdout.flush()
        os._exit(code)
    sys.exit(code)
