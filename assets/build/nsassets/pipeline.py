"""
Recipe → model pipeline (pure Python; kit pieces come in through a loader
callable so that bpy stays in blender_ops): parts → palette roles and
shades → one merged mesh per output file → validation → GLB bytes →
manifest entry.
"""

import hashlib
import json
import math
import os

from . import atlas, config, content as content_mod, geometry, glb, palette, validate
from . import recipes as recipes_mod
from .recipes import part_groups, part_label


class BuildError(Exception):
    pass


#: Normal of sail (cloth) triangles in recipe space.
UP = (0.0, 0.0, 1.0)


def _r(v, d=4):
    return round(v, d) + 0.0


def _vec(p, d=4):
    return [_r(c, d) for c in p]


def kit_scale(kit, file):
    return config.FILE_SCALE.get(f"{kit}:{file}", config.KIT_SCALE[kit])


def _role_value(v, shade):
    """A `roles` map value (role name or {role, shade}) → (role, shade)."""
    if isinstance(v, dict):
        return v["role"], v.get("shade", 1.0) * shade
    return v, shade


def no_clamp(role, shade, roles):
    """The shade capped (down to 3 decimals) so that no channel of palette[role] × shade exceeds 1."""
    if roles is None or role not in roles:
        return shade
    peak = max(roles[role])
    if peak * shade <= 1.0:
        return shade
    return math.floor(1000.0 / peak) / 1000.0


def kit_role(kit, material, part, roles=None):
    """
    (role, shade) of a kit material in a part: part role, then the part's
    roles map, then the kit default. Gradient-atlas materials
    ("Atlas/<swatch>@<band>") match the roles map by band first, then by
    swatch, and multiply the band shade in (capped so nothing clamps).
    """
    shade = part.get("shade", 1.0)
    cells = config.KIT_ATLAS_CELLS.get(kit)
    if cells is not None:
        base, band = atlas.split(material)
        bshade = cells["bands"][band] if band is not None else 1.0
        mapped = part.get("roles", {})
        if "role" in part:
            role, s = part["role"], shade
        elif material in mapped:
            role, s = _role_value(mapped[material], shade)
        elif base in mapped:
            role, s = _role_value(mapped[base], shade)
        else:
            sw = atlas.swatch(cells, base)
            if sw is None:
                return None, shade
            role, s = sw[0], sw[1] * shade
        return role, no_clamp(role, _r(s * bshade), roles)
    if "role" in part:
        return part["role"], shade
    if material in part.get("roles", {}):
        return _role_value(part["roles"][material], shade)
    return None, shade


def exaggerate(tris, ex):
    """
    Scales the triangles whose centroid lies in the box ex["min"]..ex["max"]
    (kit units, before any transform) by ex["scale"] about ex["pivot"] or
    the selection's bottom centre — a bigger roof or a taller chimney that
    stays seated on the piece.
    """
    sel = [all(ex["min"][i] <= (t[0][i] + t[1][i] + t[2][i]) / 3 <= ex["max"][i] for i in range(3)) for t in tris]
    pts = [p for t, s in zip(tris, sel) if s for p in t[:3]]
    if not pts:
        return tris
    if "pivot" in ex:
        pv = ex["pivot"]
    else:
        pv = [(min(p[0] for p in pts) + max(p[0] for p in pts)) / 2, (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2, min(p[2] for p in pts)]
    sc = ex["scale"] if isinstance(ex["scale"], list) else [ex["scale"]] * 3
    m = geometry.mat_mul(geometry.translation(pv), geometry.mat_mul(geometry.scaling(sc), geometry.translation([-c for c in pv])))
    out = []
    for t, s in zip(tris, sel):
        out.append((geometry.apply(m, t[0]), geometry.apply(m, t[1]), geometry.apply(m, t[2])) + tuple(t[3:]) if s else t)
    return out


def dropped(material, drop):
    """Whether a kit material is in a part's drop list (atlas materials: by band or by swatch)."""
    return material in drop or atlas.split(material)[0] in drop


def primitive(part, seed):
    kind = part["prim"]
    if kind == "box":
        return geometry.box(part["size"], tuple(part.get("open", ())))
    if kind == "cylinder":
        return geometry.cylinder(part["radius"], part["height"], part.get("radius_top"), part.get("segments", 8), part.get("caps", False))
    if kind == "wedge":
        return geometry.wedge(part["size"], part.get("hip", 0.0))
    if kind == "sail":
        return geometry.sail(part["width"], part["height"], part.get("width_top"), part.get("bulge", 0.0), part.get("segments", 3))
    if kind == "lathe":
        return geometry.lathe(part["profile"], part.get("segments", 8))
    if kind == "rock":
        return geometry.rock(part["size"], part.get("detail", 0), geometry.Rng(seed))
    raise BuildError(f"unknown primitive {kind}")


def part_mesh(recipe_id, group, index, part, kit_loader, roles=None):
    """
    The triangles of one part (all repeat copies) in recipe space with
    (role, shade, label), the declared (role, shade) pairs and the kit file
    it uses (or None). Raises BuildError for a kit material without a role.
    """
    label = part_label(part, index, group)
    rep = part.get("repeat", {"count": 1, "step": [0, 0, 0]})
    pos = part.get("position", [0.0, 0.0, 0.0])
    rot = part.get("rotation", [0.0, 0.0, 0.0])
    scale = part.get("scale", 1.0)
    if isinstance(scale, (int, float)):
        scale = [scale] * 3
    flip = bool(part.get("flip_normals", False))
    out = []
    declared = set()
    kit_file = None
    if "kit" in part:
        kit_file = (part["kit"], part["file"])
        f = kit_scale(part["kit"], part["file"])
        if "nodes" in part:
            raw = kit_loader(part["kit"], part["file"], part.get("simplify"), part["nodes"])
        else:
            raw = kit_loader(part["kit"], part["file"], part.get("simplify"))
        crop = part.get("crop")
        drop = set(part.get("drop", ()))
        local = []
        for a, b, c, material in raw:
            if crop and not all(crop["min"][i] <= (a[i] + b[i] + c[i]) / 3 <= crop["max"][i] for i in range(3)):
                continue
            if drop and dropped(material, drop):
                continue
            role, shade = kit_role(part["kit"], material, part, roles)
            if role is None:
                raise BuildError(f"{label}: kit material {material!r} has no role (add it to the part's roles)")
            shade = _r(shade)
            declared.add((role, shade))
            local.append((a, b, c, role, shade, label))
        for ex in part.get("exaggerate", ()):
            local = exaggerate(local, ex)
        base_scale = [s * f for s in scale]
    else:
        shade = _r(part.get("shade", 1.0))
        declared.add((part["role"], shade))
        base_scale = scale
    for k in range(rep["count"]):
        p = [pos[i] + k * rep["step"][i] for i in range(3)]
        m = geometry.mat_mul(geometry.translation(p), geometry.rot_z(k * rep.get("rotate", 0.0)))
        m = geometry.mat_mul(m, geometry.euler_xyz(rot))
        m = geometry.mat_mul(m, geometry.scaling(base_scale))
        if "kit" in part:
            tris = local
        else:
            seed = geometry.seed_of(recipe_id, group, index, k)
            prim = primitive(part, seed)
            if "bevel" in part:
                bevel = getattr(kit_loader, "bevel", None)
                if bevel is None:
                    raise BuildError(f"{label}: bevel needs the Blender build")
                prim = bevel(prim, part["bevel"])
            tris = [(a, b, c, part["role"], shade, label) for a, b, c in prim]
            if part["prim"] == "sail":
                # Cloth is lit from both sides: both faces of a sail get the up normal.
                tris = [t + (UP,) for t in tris]
        out += geometry.transformed(tris, m, flip)
    return geometry.Mesh(out), declared, kit_file


def outputs(recipe):
    """(file name, key, part groups) of every exported file of a recipe; key is None, ('variant', n), ('level', l) or ('attachment', name)."""
    cid = recipe["id"]
    base = [("parts", recipe["parts"])]
    if "variants" in recipe:
        return [(f"{cid}.v{n}.glb", ("variant", n), base + [(f"variants[{n}]", v)]) for n, v in enumerate(recipe["variants"])]
    if "levels" in recipe:
        return [(f"{cid}.l{lvl}.glb", ("level", int(lvl)), base + [(f"levels.{lvl}", v)]) for lvl, v in sorted(recipe["levels"].items())]
    out = [(f"{cid}.glb", None, base)]
    for name, parts in sorted(recipe.get("attachments", {}).items()):
        out.append((f"{cid}.{name}.glb", ("attachment", name), [(f"attachments.{name}", parts)]))
    return out


def area_budget(flat, per_tile, area, factor=1):
    """
    A footprint's triangle budget (D-054): per_tile × area (× factor for a
    budget exception), never below flat × factor, capped at
    BUDGET_BUILDING_CAP (fields and houses stay far below it).
    """
    return min(max(flat, per_tile * area) * factor, max(flat * factor, config.BUDGET_BUILDING_CAP))


def budget_of(recipe, content, key):
    cid = recipe["id"]
    kind = recipe["kind"]
    if key and key[0] == "attachment":
        return config.BUDGET_ATTACHMENT
    if kind == "ship":
        return config.BUDGET_SHIP
    if kind == "decor":
        return config.BUDGET_DECOR
    if kind == "life":
        return config.BUDGET_LIFE_STAGE if cid.startswith(config.LIFE_STAGE_PREFIX) else config.BUDGET_LIFE
    w, h = content_mod.footprint(content, cid)
    if kind == "field":
        return area_budget(config.BUDGET_FIELD, config.BUDGET_FIELD_PER_TILE, w * h)
    if content_mod.is_house(content, cid):
        return area_budget(config.BUDGET_HOUSE, config.BUDGET_HOUSE_PER_TILE, w * h)
    factor = config.BUDGET_EXCEPTION_FACTOR if "budget_exception" in recipe else 1
    return area_budget(config.BUDGET_BUILDING, config.BUDGET_BUILDING_PER_TILE, w * h, factor)


def lite_budget(recipe, content, limit):
    """Triangle budget of a lite file (a share of its full file's budget)."""
    return int(limit * config.LITE_FACTOR)


def gltf_bounds(mesh):
    """Bounds in glTF space (y up): x, z, −y of recipe space."""
    mn, mx = mesh.bounds()
    return [mn[0], mn[2], -mx[1]], [mx[0], mx[2], -mn[1]]


def lite_name(fname):
    return fname[: -len(".glb")] + ".lite.glb"


def _assemble(cid, groups, kit_loader, kit_used, lod, roles=None):
    """The merged mesh of part groups at a detail level ("lite" leaves out the lod-"full" parts)."""
    mesh = geometry.Mesh()
    declared = set()
    for group, parts in groups:
        for i, part in enumerate(parts):
            if lod == "lite" and part.get("lod") == "full":
                continue
            m, d, kf = part_mesh(cid, group, i, part, kit_loader, roles)
            mesh.extend(m)
            declared |= d
            if kf:
                kit_used.setdefault(kf[0], set()).add(kf[1])
    return mesh, declared


_SHADOWS = {}


def shadows():
    """Shadow tone per role (palette group "shadows"), loaded once."""
    if not _SHADOWS:
        _SHADOWS.update(palette.load_shadows())
    return _SHADOWS


def ao_color(base, shadow, shade, level):
    """A colour at an occlusion level: base blended toward shadow × shade by level / AO_LEVELS × AO_STRENGTH."""
    t = level / config.AO_LEVELS * config.AO_STRENGTH
    return tuple(b + (s * shade - b) * t for b, s in zip(base, shadow))


def luminance(c):
    """Relative luminance (Rec. 709 weights) of a linear-ish RGB triple."""
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def shadow_chroma(role, palette_rgb, c):
    """
    A colour of a role with the role's shadow chroma bias (SHADOW_CHROMA):
    its chroma raised about its luminance by bias × darkness, darkness being
    how much darker it is than the palette colour (0 when as light or
    lighter); clamped to [0, 1].
    """
    bias = config.SHADOW_CHROMA.get(role, 0.0)
    ref = luminance(palette_rgb)
    if bias <= 0 or ref <= 0:
        return c
    lum = luminance(c)
    darkness = max(0.0, min(1.0, 1.0 - lum / ref))
    gain = 1.0 + bias * darkness
    return tuple(min(1.0, max(0.0, lum + (v - lum) * gain)) for v in c)


def file_colors(roles, declared, ao):
    """(role, shade) → colour, or with baked occlusion (role, shade, level) → colour, of a file's declared pairs."""
    base = {k: tuple(c * k[1] for c in roles[k[0]]) for k in declared}
    if ao is None:
        return {k: shadow_chroma(k[0], roles[k[0]], c) for k, c in base.items()}
    tone = shadows()
    return {
        (r, s, lvl): shadow_chroma(r, roles[r], ao_color(base[(r, s)], tone[r], s, lvl))
        for (r, s) in declared
        for lvl in range(config.AO_LEVELS + 1)
    }


def lite_ratios(n, house=False):
    """Decimation ratios to try for a mesh of n triangles: houses from LITE_HOUSE_TRIS up in LITE_HOUSE_STEP steps (below the first of LITE_RATIOS), then LITE_RATIOS (at least LITE_MIN_TRIS)."""
    out = []
    if house:
        target = config.LITE_HOUSE_TRIS
        while target < n * config.LITE_RATIOS[0]:
            out.append(target / n)
            target *= config.LITE_HOUSE_STEP
    return out + [max(r, config.LITE_MIN_TRIS / n) for r in config.LITE_RATIOS]


def decimate(mesh, kit_loader, footprint=None, house=False, ground=config.GROUND_RANGE):
    """
    The lite mesh: decimated (when the loader can, i.e. Blender) to the first
    of lite_ratios whose result still fits and covers the footprint (w, h)
    and touches the ground; else unchanged.
    """
    fn = getattr(kit_loader, "decimate", None)
    n = len(mesh)
    floor = config.LITE_HOUSE_TRIS if house else config.LITE_MIN_TRIS
    if fn is None or n <= floor:
        return mesh
    for r in lite_ratios(n, house):
        if r >= 1.0:
            return mesh
        out = fn(mesh, r)
        if footprint is None or not (validate.footprint_fit(out, *footprint) or validate.ground_contact(out, ground)):
            return out
    return mesh


def bake(mesh, recipe, kit_loader):
    """Bakes ambient occlusion into a mesh when the loader can (Blender); returns the mesh."""
    if recipe.get("shading") == "smooth":
        mesh.tris = geometry.smooth_normals(mesh.tris)
    if config.NORMAL_TILT:
        mesh.tris = geometry.tilt_normals(mesh.tris, config.NORMAL_TILT)
    occlusion = getattr(kit_loader, "occlusion", None)
    if occlusion is not None:
        mesh.ao = occlusion(mesh.tris, recipe["kind"] != "ship")
        if recipe.get("ao") == "crevices":
            cut = config.AO_CREVICE_CUT
            mesh.ao = [tuple(max(0, lvl - cut) for lvl in t) for t in mesh.ao]
    return mesh


def _sways(recipe, part):
    """
    Which triangles of a part sway in the client (LIFE_LAYER §2, sails and
    flags): every triangle of a cloth ("sail" primitive) or a flag (a part
    named flag…, not its pole, or a KayKit flag_* piece); in ships the
    canvas-role triangles of the kit hull (the sails). Returns "all",
    "canvas" or None.
    """
    name = part.get("name", "")
    if part.get("prim") == "sail" or (name.startswith("flag") and "pole" not in name):
        return "all"
    if os.path.basename(part.get("file", "")).startswith("flag_"):
        return "all"
    if recipe["kind"] == "ship" and "kit" in part:
        return "canvas"
    return None


def sway_weights(recipe, mesh):
    """
    Per-triangle corner weights (None: rigid) of the cloth mask: within each
    swaying part, 0.3 at the top and bottom rising to 1 at mid-height
    (sin profile), so a sail bulges in its belly and a flag waves without
    leaving its pole; None for a file without cloth.
    """
    rules = {}
    for group, parts in part_groups(recipe):
        for i, part in enumerate(parts):
            rule = _sways(recipe, part)
            if rule:
                rules[part_label(part, i, group)] = rule
    if not rules:
        return None
    picked = [rules.get(t[5]) == "all" or (rules.get(t[5]) == "canvas" and t[3] == "canvas") for t in mesh.tris]
    if not any(picked):
        return None
    span = {}
    for t, on in zip(mesh.tris, picked):
        if on:
            lo, hi = span.get(t[5], (math.inf, -math.inf))
            zs = [p[2] for p in t[:3]]
            span[t[5]] = (min(lo, *zs), max(hi, *zs))
    out = []
    for t, on in zip(mesh.tris, picked):
        if not on:
            out.append(None)
            continue
        lo, hi = span[t[5]]
        h = hi - lo
        out.append(tuple(0.3 + 0.7 * math.sin(math.pi * ((p[2] - lo) / h if h > 1e-9 else 0.5)) for p in t[:3]))
    return out


def _check_file(recipe, content, roles, fname, key, mesh, declared, limit):
    """Validates one model file (full or lite: the same rules, the lite budget); returns (bytes, problems)."""
    cid = recipe["id"]
    problems = validate.budget(mesh, limit, fname)
    if recipe["kind"] == "decor":
        problems += [f"{fname}: {p}" for p in validate.ground_contact(mesh)]
    # Life-layer elements float (boats, gulls) or stand: no footprint or ground rule.
    elif recipe["kind"] in ("building", "field"):
        w, h = content_mod.footprint(content, cid)
        problems += [f"{fname}: footprint fit: {p}" for p in validate.footprint_fit(mesh, w, h)]
        problems += [f"{fname}: {p}" for p in validate.ground_contact(mesh, content_mod.ground_range(content, cid))]
    elif key is None and recipe["kind"] == "ship":
        problems += [f"{fname}: {p}" for p in validate.ship_length(mesh, recipe["ship"]["length_tiles"])]
    problems += validate.palette_check(mesh, roles, declared, fname)
    colors = file_colors(roles, declared, mesh.ao)
    data = glb.write(cid, mesh.tris, colors, mesh.ao, sway_weights(recipe, mesh))
    problems += validate.export_profile(data, fname)
    problems += readback_colors(data, colors, fname)
    return data, problems


def build_recipe(recipe, content, roles, kit_loader):
    """
    Builds every file of a recipe. Returns (files, entry, errors): files is
    a list of (name, bytes, mesh, budget) for the writer and the sheets,
    entry the manifest entry, errors a list of problems (empty when valid).
    """
    recipe = recipes_mod.expand(recipe)
    cid = recipe["id"]
    name = f"recipes/{cid}.json"
    errors = []
    files = []
    kit_used = {}
    meta = {}
    for fname, key, groups in outputs(recipe):
        # Every building model gets a generated lite file (fields and ships do not).
        has_lite = config.LITE_MODELS and recipe["kind"] == "building" and (key is None or key[0] in ("variant", "level"))
        try:
            mesh, declared = _assemble(cid, groups, kit_loader, kit_used, "full", roles)
            lite = None
            if has_lite:
                lite = _assemble(cid, groups, kit_loader, kit_used, "lite", roles)
                house = content_mod.is_house(content, cid)
                lite = (decimate(lite[0], kit_loader, content_mod.footprint(content, cid), house, content_mod.ground_range(content, cid)), lite[1])
            bake(mesh, recipe, kit_loader)
            if lite is not None:
                bake(lite[0], recipe, kit_loader)
        except BuildError as e:
            errors.append(f"{name} {fname}: {e}")
            continue
        limit = budget_of(recipe, content, key)
        data, problems = _check_file(recipe, content, roles, fname, key, mesh, declared, limit)
        files.append((fname, data, mesh, limit))
        lite_info = None
        if lite is not None:
            lname = lite_name(fname)
            llimit = lite_budget(recipe, content, limit)
            ldata, lproblems = _check_file(recipe, content, roles, lname, key, lite[0], lite[1], llimit)
            problems += lproblems
            files.append((lname, ldata, lite[0], llimit))
            lite_info = (lname, ldata, lite[0], llimit)
        errors += [f"{name} {p}" for p in problems]
        meta[fname] = (key, mesh, lite_info)
    if errors:
        return files, None, errors
    return files, manifest_entry(recipe, content, files, meta, kit_used), []


def readback_colors(data, colors, fname):
    """Every COLOR_0 value of the written GLB is a declared palette colour (within 1/255)."""
    doc, binary = glb.read(data)
    prim = doc["meshes"][0]["primitives"][0]
    allowed = list(colors.values())
    bad = set()
    for v in glb.accessor_values(doc, binary, prim["attributes"]["COLOR_0"]):
        if not any(all(abs(v[i] - a[i]) <= config.COLOR_TOLERANCE + 1e-9 for i in range(3)) for a in allowed):
            bad.add("#" + "".join(f"{round(c * 255):02X}" for c in v[:3]))
    return [f"{fname}: exported colour {c} is not a declared palette colour" for c in sorted(bad)]


def file_info(fname, data, mesh):
    mn, mx = gltf_bounds(mesh)
    return {
        "path": fname,
        "triangles": len(mesh),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "bounds": {"min": _vec(mn), "max": _vec(mx)},
    }


def manifest_entry(recipe, content, files, meta, kit_used):
    cid = recipe["id"]
    entry = {"kind": recipe["kind"]}
    by_name = {f[0]: f for f in files}
    if recipe["kind"] == "decor":
        fname, (_, mesh, _) = next(iter(meta.items()))
        entry["file"] = file_info(fname, by_name[fname][1], mesh)
        entry["file"]["budget"] = by_name[fname][3]
        entry["bounds"] = entry["file"]["bounds"]
        entry["kit_sources"] = [{"kit": k, "files": sorted(v)} for k, v in sorted(kit_used.items())]
        return entry
    main = []
    for fname, (key, mesh, lite) in meta.items():
        info = file_info(fname, by_name[fname][1], mesh)
        info["budget"] = by_name[fname][3]
        if lite is not None:
            info["lite"] = file_info(lite[0], lite[1], lite[2])
            info["lite"]["budget"] = lite[3]
        if key is None:
            entry["file"] = info
            main.append(mesh)
        elif key[0] == "variant":
            entry.setdefault("variants", []).append(info)
            main.append(mesh)
        elif key[0] == "level":
            entry.setdefault("levels", {})[str(key[1])] = info
            main.append(mesh)
        else:
            entry.setdefault("attachments", {})[key[1]] = info
    union = geometry.Mesh()
    for m in main:
        union.extend(m)
    mn, mx = gltf_bounds(union)
    entry["bounds"] = {"min": _vec(mn), "max": _vec(mx)}
    if recipe["kind"] == "life":
        entry["anchors"] = {k: _vec(glb.to_gltf(v)) for k, v in sorted(recipe.get("anchors", {}).items())}
        entry["kit_sources"] = [{"kit": k, "files": sorted(v)} for k, v in sorted(kit_used.items())]
        return entry
    if recipe["kind"] != "ship":
        w, h = content_mod.footprint(content, cid)
        entry["footprint"] = {"w": w, "h": h}
    anchors = {}
    declared = recipe.get("anchors", {})
    door = declared.get("door")
    if door is None and recipe["kind"] != "ship":
        door = [0.0, entry["footprint"]["h"] / 2, 0.0]
    if door is not None:
        anchors["door"] = _vec(glb.to_gltf(door))
    status = declared.get("status") or [0.0, 0.0, union.bounds()[1][2] + config.STATUS_ABOVE]
    anchors["status"] = _vec(glb.to_gltf(status))
    for k in sorted(declared):
        if k not in ("door", "status"):
            anchors[k] = _vec(glb.to_gltf(declared[k]))
    entry["anchors"] = anchors
    entry["kit_sources"] = [{"kit": k, "files": sorted(v)} for k, v in sorted(kit_used.items())]
    if "budget_exception" in recipe:
        entry["budget_exception"] = {"reason": recipe["budget_exception"]["reason"]}
    if "ship" in recipe:
        entry["ship"] = dict(recipe["ship"])
    return entry


def manifest(entries, palette_sha, blender_version, missing):
    decor = {k: v for k, v in entries.items() if v["kind"] == "decor"}
    life = {k: v for k, v in entries.items() if v["kind"] == "life"}
    entries = {k: v for k, v in entries.items() if v["kind"] not in ("decor", "life")}
    doc = {
        "decor": dict(sorted(decor.items())),
        "life": dict(sorted(life.items())),
        "version": config.MANIFEST_VERSION,
        "generator": config.GENERATOR,
        "blender": blender_version,
        "palette_sha256": palette_sha,
        "kit_scale": dict(sorted(config.KIT_SCALE.items())),
        "file_scale": dict(sorted(config.FILE_SCALE.items())),
        "missing_recipes": sorted(missing),
        "models": dict(sorted(entries.items())),
    }
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def thumb_file(files):
    """
    The file a content ID's build-card thumbnail shows: its first full
    model in name order (variant v0, warehouse level l1), never the lite
    LOD or a ship's cargo attachment; None without one.
    """
    names = sorted(f[0] for f in files if not f[0].endswith(".lite.glb") and not f[0].endswith(".cargo.glb"))
    return names[0] if names else None


def thumb_frame(points, right, up, margin=0.06):
    """
    Orthographic framing of points seen along a view with screen axes right
    and up (unit vectors): the centre (in the right/up plane) and the
    square ortho scale that fits them with a relative margin per side.
    """
    xs = [sum(p[i] * right[i] for i in range(3)) for p in points]
    ys = [sum(p[i] * up[i] for i in range(3)) for p in points]
    if not xs:
        return (0.0, 0.0), 1.0
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    centre = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2)
    return centre, max(w, h, 1e-3) * (1 + 2 * margin)
