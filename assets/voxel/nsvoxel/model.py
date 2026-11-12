"""
Recipes → model files: loads assets/voxel/recipes/<id>.py (or the
auto-generated placeholder), builds every variant/level, meshes the full
grid (8 voxels per tile, or the recipe's VOXELS_PER_TILE) and the lite
grid (downsampled to 2 voxels per tile),
checks anchors, footprint and the triangle budgets (config.py), and
returns the files and the manifest entry (client/src/render/models.ts).
"""

import importlib.util
import os

from . import config, content as content_mod, export, grid
from .grid import VPT

RECIPES_DIR = config.RECIPES_DIR

#: Default voxel tolerance outside the footprint (overhanging eaves, a crane jib): 0.25 tile
#: (voxels at the default 8 per tile; scaled with a recipe's VOXELS_PER_TILE).
FOOTPRINT_SLACK = 2


class Ctx:
    """What a recipe gets: the content ID, footprint (tiles and voxels), water rows, variant and level."""

    def __init__(self, cid, kind, w=0, h=0, defn=None, variant=0, level=1, scale=VPT):
        self.cid = cid
        self.kind = kind
        self.w, self.h = w, h
        self.vpt = scale
        self.W, self.D = w * scale, h * scale
        self.defn = defn or {}
        self.variant = variant
        self.level = level
        rows = self.defn.get("water_rows")
        self.water = int(rows["max"] if isinstance(rows, dict) else self.defn.get("water_tiles", 0))
        if not self.water and self.defn.get("placement") == "shore":
            self.water = config.SHORE_DECK_ROWS.get(cid, 0)
        #: First land row (voxels): rows below it stand over the sea.
        self.land = self.water * scale
        #: A shore building (D-077 §5): a deck under every tile, so the model may reach below z = 0 like a water structure.
        self.shore = self.defn.get("placement") == "shore"
        self.tier = self.defn.get("tier", "settlers")
        self.smoke = False
        self.needs = []

    def vox(self, w=None, d=None):
        return grid.Vox(self.W if w is None else w, self.D if d is None else d, self.cid)


def _load_module(path):
    spec = importlib.util.spec_from_file_location(f"voxrecipe_{os.path.basename(path)[:-3]}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def recipe_modules(recipes_dir=RECIPES_DIR):
    """{content id: recipe} of every recipe file: a module with build(ctx), or a RECIPES dict of a family file (_*.py)."""
    out = {}
    for fname in sorted(os.listdir(recipes_dir)):
        if not fname.endswith(".py"):
            continue
        mod = _load_module(os.path.join(recipes_dir, fname))
        if hasattr(mod, "RECIPES"):
            for cid, r in mod.RECIPES.items():
                out[cid] = dict(r, file=fname)
        elif hasattr(mod, "build"):
            if fname.startswith("_"):
                continue  # kept for a later region (e.g. _south_theatre.py, D-063): not an ID's recipe
            cid = fname[:-3]
            out[cid] = {
                "build": mod.build,
                "variants": getattr(mod, "VARIANTS", 0),
                "levels": getattr(mod, "LEVELS", 0),
                # VOXELS_PER_TILE (V7): the model's density; config.ALLOWED_VOXELS_PER_TILE for buildings and fields.
                "scale": getattr(mod, "VOXELS_PER_TILE", VPT),
                "cargo": getattr(mod, "cargo", None),
                "ship": getattr(mod, "SHIP", None),
                "lite": getattr(mod, "lite", None),
                # GROUND_Z (D-068): the layer the recipe's first standing voxels are authored at; 0 from now on,
                # 1 for the recipes written on the old one-voxel ground plate (settle_on_terrain lowers them).
                "ground_z": getattr(mod, "GROUND_Z", 0),
                "file": fname,
            }
    return out


def required_anchors(content, cid):
    """Required life anchors (water_rows, else legacy water_tiles), plus chimney/smoke for burners."""
    out = list(content_mod.life_anchors(content, cid))
    if content_mod.needs_smoke(content, cid):
        out += ["chimney", "smoke"]
    return out


def outputs(cid, kind, recipe, content):
    """(file name, key, Ctx) of every file of an ID; key None, ('variant', n), ('level', l) or ('attachment', name)."""
    scale = recipe.get("scale", VPT)
    if kind in ("decor", "life"):
        n = recipe.get("variants", 0)
        if n:
            return [(f"{cid}.v{i}.glb", ("variant", i), Ctx(cid, kind, variant=i, scale=scale)) for i in range(n)]
        return [(f"{cid}.glb", None, Ctx(cid, kind, scale=scale))]
    if kind == "ship":
        defn = content["ships"].get(cid, {})
        out = [(f"{cid}.glb", None, Ctx(cid, kind, defn=defn, scale=scale))]
        if recipe.get("cargo"):
            out.append((f"{cid}.cargo.glb", ("attachment", "cargo"), Ctx(cid, kind, defn=defn, scale=scale)))
        return out
    w, h = content_mod.footprint(content, cid)
    defn = content["buildings"][cid]
    n = recipe.get("variants", 0)
    levels = content_mod.levels(content, cid)
    if recipe.get("levels"):
        # A recipe that models fewer levels than the content (LEVELS, D-065: market and
        # warehouse level 4): the client draws the highest model below a higher level.
        levels = min(levels, recipe["levels"])
    if n:
        return [(f"{cid}.v{i}.glb", ("variant", i), Ctx(cid, kind, w, h, defn, variant=i, scale=scale)) for i in range(n)]
    if levels:
        return [(f"{cid}.l{lv}.glb", ("level", lv), Ctx(cid, kind, w, h, defn, level=lv, scale=scale)) for lv in range(1, levels + 1)]
    return [(f"{cid}.glb", None, Ctx(cid, kind, w, h, defn, scale=scale))]


def check_grid(v, ctx, needed):
    """Problems of a built grid: footprint fit (± FOOTPRINT_SLACK voxels), ground contact, required anchors."""
    problems = []
    if not v.cells:
        return ["empty grid"]
    (x0, y0, z0), (x1, y1, z1) = v.bounds()
    if ctx.kind in ("building", "field"):
        if ctx.vpt not in config.ALLOWED_VOXELS_PER_TILE:
            problems.append(f"{ctx.vpt} voxels per tile (allowed: {', '.join(map(str, config.ALLOWED_VOXELS_PER_TILE))})")
        s = config.SLACK_OVERRIDE.get(ctx.cid, FOOTPRINT_SLACK) * ctx.vpt // VPT
        if x0 < -s or y0 < -s or x1 > ctx.W + s or y1 > ctx.D + s:
            problems.append(f"outside the footprint {ctx.W}×{ctx.D} voxels: x {x0}..{x1}, y {y0}..{y1}")
        floor = -2 * ctx.vpt if (ctx.water or ctx.shore) else 0
        if z0 < floor:
            problems.append(f"below the ground: z {z0}")
    if ctx.kind in ("building", "field") and ctx.cid not in config.WATER_MODELS and ctx.cid not in config.SHORE_MODELS and ctx.cid not in config.PLATE_EXEMPT:
        share = plate_share(v, ctx)
        if share > config.PLATE_SHARE:
            problems.append(f"ground plate: {share:.0%} of the footprint is a flat layer at z = 0 (at most {config.PLATE_SHARE:.0%}; ground cover is the yard map, D-068)")
    if ctx.kind == "building":
        for comp in floating_cells(v.cells):
            lo, hi = min(comp), max(comp)
            problems.append(f"floating voxels: {len(comp)} cells not connected to the ground, from {lo} to {hi}")
    missing = [a for a in needed if a not in v.anchors]
    if missing:
        problems.append(f"missing anchors {', '.join(missing)}")
    return problems


def settle_on_terrain(v, ctx, ground_z):
    """
    D-068: a building or field stands on the terrain; its ground cover is the
    ground map (`v.ground`, from parts.yard / parts.path), not voxels. A recipe
    authored on the old one-voxel plate (GROUND_Z = 1) is settled here: the plate
    layer (z ≤ 0) is dropped — its paved / dirt / sand cells become ground kinds
    unless the map already declares the cell — and everything above is lowered
    by one voxel, anchors included. The water structures of D-068 §5
    (config.WATER_MODELS) keep their deck voxels over their water rows: only the
    land rows' columns that stood on the plate (or on nothing) settle. Returns v.
    """
    if ground_z == 0:
        return v
    water = ctx.cid in config.WATER_MODELS and ctx.kind == "building"
    land = ctx.land if water else 0

    def plate(x, y, m):
        # A cell of the old ground plate: z = 0 on land (fields and land buildings: the whole layer).
        return not water or (y >= land and m[0] in config.GROUND_ROLES)

    sinks = set()
    cells = {}
    for (x, y, z), m in v.cells.items():
        if z == 0 and plate(x, y, m):
            if ctx.kind == "building" and m[0] in config.GROUND_ROLES:
                v.ground.setdefault((x, y), config.GROUND_ROLES[m[0]])
            continue
        if z < 0 and not water:
            continue
        cells[(x, y, z)] = m
    if water:
        # Land columns whose z = 0 cell is gone (or was never there) settle; decks and quays stay.
        sinks = {(x, y) for (x, y, z) in cells if y >= land and z >= 1 and (x, y, 0) not in cells}
    settles = lambda x, y, z: z >= 1 and (not water or (x, y) in sinks)  # noqa: E731
    # Cells left in place first, then the settled ones over them (a post settling into a deck's edge wins).
    out = {k: m for k, m in cells.items() if not settles(*k)}
    for (x, y, z), m in cells.items():
        if settles(x, y, z):
            out[(x, y, z - 1)] = m
    v.cells = out
    v.anchors = {n: (p[0], p[1], p[2] - 1 if p[2] >= 1 and (not water or p[1] >= land) else p[2]) for n, p in v.anchors.items()}
    return v


def ground_map(v, ctx):
    """
    The manifest's `ground` (D-068): the footprint's tiles as rows (footprint y, at
    rotation 0) of ground kinds (config.GROUND_KINDS) — per tile the declared kind
    covering the most of its columns when it covers at least config.GROUND_TILE_SHARE,
    else "none". None when every tile is "none".
    """
    rows = []
    n = ctx.vpt * ctx.vpt
    for ty in range(ctx.h):
        row = []
        for tx in range(ctx.w):
            count = {}
            for y in range(ty * ctx.vpt, (ty + 1) * ctx.vpt):
                for x in range(tx * ctx.vpt, (tx + 1) * ctx.vpt):
                    k = v.ground.get((x, y))
                    if k:
                        count[k] = count.get(k, 0) + 1
            best = max(sorted(count), key=lambda k: count[k]) if count else None
            row.append(best if best and count[best] >= config.GROUND_TILE_SHARE * n else "none")
        rows.append(row)
    return rows if any(k != "none" for r in rows for k in r) else None


def plate_share(v, ctx):
    """Share of the footprint's columns that are a flat plate: a cell at z = 0 with nothing on it (D-068 §6)."""
    flat = sum(1 for (x, y, z) in v.cells if z == 0 and (x, y, 1) not in v.cells and 0 <= x < ctx.W and 0 <= y < ctx.D)
    return flat / max(1, ctx.W * ctx.D)


def floating_cells(cells, ground=0):
    """The voxels of every component (voxels touching by a face, an edge or a corner) that does not reach the ground (z ≤ `ground`), sorted."""
    seen = set()
    out = []
    for start in sorted(cells):
        if start in seen:
            continue
        comp, stack, grounded = [], [start], False
        seen.add(start)
        while stack:
            c = stack.pop()
            comp.append(c)
            if c[2] <= ground:
                grounded = True
            x, y, z = c
            for n in ((x + i, y + j, z + k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)):
                if n in cells and n not in seen:
                    seen.add(n)
                    stack.append(n)
        if not grounded:
            out.append(sorted(comp))
    return out


def build_grid(recipe, kind, key, ctx):
    """The grid of one output: the recipe's, or its cargo attachment's; buildings and fields settled on the terrain (D-068)."""
    fn = recipe["cargo"] if key and key[0] == "attachment" else recipe["build"]
    v = fn(ctx)
    if kind in ("building", "field") and not (key and key[0] == "attachment"):
        settle_on_terrain(v, ctx, recipe.get("ground_z", 0))
    return v


def sway_groups(cells):
    """The sway groups of a grid's cells (sorted; the manifest's `sway`)."""
    return sorted({m[2] for m in cells.values() if len(m) > 2})


def build_id(cid, kind, recipe, content):
    """(files, manifest entry, problems) of one content ID; files are (name, bytes, triangles, tri list for sheets)."""
    files = []
    problems = []
    entry = {"kind": kind}
    needed = required_anchors(content, cid) if kind in ("building", "field") else []
    union_lo, union_hi = None, None
    anchors_v = None
    main_ctx = None
    infos = {}
    sway = set()
    wake_width = None
    for fname, key, ctx in outputs(cid, kind, recipe, content):
        ctx.needs = needed
        ctx.smoke = "smoke" in needed
        v = build_grid(recipe, kind, key, ctx)
        sway |= set(sway_groups(v.cells))
        problems += [f"{fname}: {p}" for p in check_grid(v, ctx, needed if (key is None or key[0] != "attachment") else [])]
        if not v.cells:
            continue
        scale = 1.0 / ctx.vpt
        data, n, bounds = export.write_model(cid, v.cells, ctx.W, ctx.D, scale, offset=v.offset)
        budget = budget_of(cid, kind, content, key)
        if n > budget:
            problems.append(f"{fname}: {n} triangles over the budget {budget}")
        info = export.file_info(fname, data, n, bounds, budget)
        if kind == "building" and (key is None or key[0] in ("variant", "level")):
            ground = ground_map(v, ctx)
            if ground:
                # The yard per footprint tile (D-068), painted into the island's ground texture.
                info["ground"] = ground
        files.append((fname, data, n, v, ctx))
        if kind == "building" and (key is None or key[0] in ("variant", "level")):
            f = lite_factor(ctx.vpt)
            lite_cells = grid.downsample(v.cells, f, keep=max(2, f ** 3 // 8))
            lname = fname[: -len(".glb")] + ".lite.glb"
            ldata, ln, lbounds = export.write_model(cid, lite_cells, ctx.W / f, ctx.D / f, scale * f)
            lbudget = lite_budget_of(cid, content)
            if ln > lbudget:
                problems.append(f"{lname}: {ln} triangles over the lite budget {lbudget}")
            info["lite"] = export.file_info(lname, ldata, ln, lbounds, lbudget)
            files.append((lname, ldata, ln, None, ctx))
        if kind == "ship" and key is None and "wake" in v.anchors:
            # The wake's width at the stern (V7): declared by the recipe (SHIP wake_width) or measured.
            wake_width = (recipe.get("ship") or {}).get("wake_width") or stern_beam(v, ctx)
        if kind == "ship" and key is None and recipe.get("lite"):
            # The ship's own lite model (V7), built at scale / SHIP_LITE_DOWNSAMPLE voxels per tile; no cargo at lite.
            lv = recipe["lite"](ctx)
            f = config.SHIP_LITE_DOWNSAMPLE
            lname = fname[: -len(".glb")] + ".lite.glb"
            ldata, ln, lbounds = export.write_model(cid, lv.cells, ctx.W / f, ctx.D / f, scale * f, offset=lv.offset)
            lbudget = config.LITE_BUDGET_SHIPS[cid]
            if ln > lbudget:
                problems.append(f"{lname}: {ln} triangles over the lite budget {lbudget}")
            info["lite"] = export.file_info(lname, ldata, ln, lbounds, lbudget)
            files.append((lname, ldata, ln, None, ctx))
        infos[fname] = (key, info)
        if key is None or key[0] in ("variant", "level"):
            if anchors_v is None:
                anchors_v, main_ctx = v, ctx
            lo, hi = bounds
            union_lo = lo if union_lo is None else [min(a, b) for a, b in zip(union_lo, lo)]
            union_hi = hi if union_hi is None else [max(a, b) for a, b in zip(union_hi, hi)]
    for fname, (key, info) in infos.items():
        if key is None:
            entry["file"] = info
        elif key[0] == "variant":
            entry.setdefault("variants", []).append(info)
        elif key[0] == "level":
            entry.setdefault("levels", {})[str(key[1])] = info
        else:
            entry.setdefault("attachments", {})[key[1]] = info
    if union_lo is None:
        return files, None, problems or ["no files"]
    entry["bounds"] = {"min": [export._r(c) for c in union_lo], "max": [export._r(c) for c in union_hi]}
    if sway:
        # The sway groups the model's vertex alpha marks (cloth, sail, flag, canopy: render/sway.ts).
        entry["sway"] = sorted(sway)
    ctx = main_ctx
    scale = 1.0 / ctx.vpt
    anchors = {k: export.anchor_gltf(p, ctx.W, ctx.D, scale, anchors_v.offset) for k, p in sorted(anchors_v.anchors.items())}
    if kind in ("decor",):
        return files, entry, problems
    if kind == "life":
        entry["anchors"] = anchors
        return files, entry, problems
    # The model's own density (the client's jitter grid); the manifest's top-level value is the default.
    entry["voxels_per_tile"] = ctx.vpt
    if kind != "ship":
        entry["footprint"] = {"w": ctx.w, "h": ctx.h}
        anchors.setdefault("door", export.anchor_gltf((ctx.W / 2, ctx.D, 0), ctx.W, ctx.D, scale))
    anchors.setdefault("status", [0.0, export._r(union_hi[1] + config.STATUS_ABOVE), 0.0])
    entry["anchors"] = dict(sorted(anchors.items()))
    if kind == "ship":
        entry["ship"] = dict(recipe["ship"])
        if wake_width:
            entry["ship"]["wake_width"] = wake_width
    return files, entry, problems


def stern_beam(v, ctx):
    """
    Width of a ship's hull across the stern at the waterline (tiles): the
    cells of the `wake` anchor's column from the waterline up to a quarter
    tile — where the wake's arms leave the hull (manifest ship.wake_width).
    """
    ax = int(v.anchors["wake"][0])
    ys = [y for (x, y, z) in v.cells if x == ax and 0 <= z < max(1, ctx.vpt // 4)]
    if not ys:
        return 0.0
    return export._r((max(ys) + 1 - min(ys)) / ctx.vpt)


def lite_factor(vpt):
    """Downsampling of a full grid at `vpt` voxels per tile to the lite level (config.LITE_VOXELS_PER_TILE)."""
    return max(1, vpt // config.LITE_VOXELS_PER_TILE)


def model_class(content, cid):
    """The budget class of a building or field: 'field', 'house' or 'building'."""
    if content_mod.kind_of(content, cid) == "field":
        return "field"
    return "house" if content_mod.is_house(content, cid) else "building"


def budget_of(cid, kind, content, key=None):
    """Triangle budget of a full model file (config.py): per footprint tile for buildings and fields, flat for the rest."""
    if key and key[0] == "attachment":
        return config.BUDGET_SHIP_CARGO
    if kind == "ship":
        return config.BUDGET_SHIPS[cid]
    if kind == "decor":
        return config.BUDGET_DECOR
    if kind == "life":
        if cid.startswith(config.LIFE_STAGE_PREFIX):
            # Sized stages (life_stage_<n>, life_stage_scaffolding_<n>): the budget grows with the side beyond 4 tiles.
            n = cid.rsplit("_", 1)[-1]
            return int(config.BUDGET_LIFE_STAGE * max(1.0, int(n) / 4)) if n.isdigit() else config.BUDGET_LIFE_STAGE
        return config.BUDGET_LIFE
    if cid in config.BUDGET_OVERRIDE:
        return config.BUDGET_OVERRIDE[cid]
    w, h = content_mod.footprint(content, cid)
    if cid in config.FOOTPRINT_CLASS_IDS and (w, h) in config.BUDGET_BY_FOOTPRINT:
        return config.BUDGET_BY_FOOTPRINT[(w, h)][0]
    return config.BUDGET_PER_TILE[model_class(content, cid)] * w * h


def lite_budget_of(cid, content):
    """Triangle budget of a building's lite file (per footprint tile)."""
    w, h = content_mod.footprint(content, cid)
    if cid in config.FOOTPRINT_CLASS_IDS and (w, h) in config.BUDGET_BY_FOOTPRINT:
        return config.BUDGET_BY_FOOTPRINT[(w, h)][1]
    return config.LITE_BUDGET_PER_TILE[model_class(content, cid)] * w * h
