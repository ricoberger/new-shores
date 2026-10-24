"""Recipe loading and validation (schema + content, kit manifest and palette rules)."""

import json
import os

from . import atlas, config, content as content_mod, schema as schema_mod

PRIM_PARAMS = {
    "box": ({"size"}, {"open"}),
    "cylinder": ({"radius", "height"}, {"radius_top", "segments", "caps"}),
    "wedge": ({"size"}, {"hip"}),
    "sail": ({"width", "height"}, {"width_top", "bulge", "segments"}),
    "lathe": ({"profile"}, {"segments"}),
    "rock": ({"size"}, {"detail"}),
}
#: Options every primitive accepts (bevel: Blender bevel of the sharp edges, width in tiles).
for _req, _opt in PRIM_PARAMS.values():
    _opt.add("bevel")
ALL_PRIM_PARAMS = set().union(*(req | opt for req, opt in PRIM_PARAMS.values()))
KIT_ONLY = {"roles", "simplify", "crop", "drop", "exaggerate"}


class RecipeError(Exception):
    """One or more recipes are invalid (the message lists every problem)."""


def part_label(part, index, group="parts"):
    if "name" in part:
        return f"{group}[{index}] {part['name']!r}"
    what = part.get("file") or part.get("prim") or "?"
    return f"{group}[{index}] ({what})"


def part_groups(recipe):
    """(group label, part list) of every part list in a recipe."""
    out = [("parts", recipe.get("parts", []))]
    for i, v in enumerate(recipe.get("variants", [])):
        out.append((f"variants[{i}]", v))
    for lvl, v in sorted(recipe.get("levels", {}).items()):
        out.append((f"levels.{lvl}", v))
    for name, v in sorted(recipe.get("attachments", {}).items()):
        out.append((f"attachments.{name}", v))
    return out


def expand_part(part):
    """A `kit_building` part as the kit piece it names (front turned to +y, the part's rotation added); other parts unchanged."""
    if "kit_building" not in part or part["kit_building"] not in config.KIT_BUILDINGS:
        return part
    kit, file, front = config.KIT_BUILDINGS[part["kit_building"]]
    out = {k: v for k, v in part.items() if k != "kit_building"}
    out.setdefault("name", part["kit_building"])
    out["kit"] = kit
    out["file"] = file
    rot = list(part.get("rotation", [0.0, 0.0, 0.0]))
    rot[2] = rot[2] + front
    out["rotation"] = rot
    return out


def expand(recipe):
    """A copy of a recipe with every kit_building part expanded (expand_part)."""
    out = json.loads(json.dumps(recipe))
    if "parts" in out:
        out["parts"] = [expand_part(p) for p in out["parts"]]
    if "variants" in out:
        out["variants"] = [[expand_part(p) for p in v] for v in out["variants"]]
    for key in ("levels", "attachments"):
        if key in out:
            out[key] = {k: [expand_part(p) for p in v] for k, v in out[key].items()}
    return out


def _check_kit_buildings(recipe, name):
    errors = []
    for group, parts in part_groups(recipe):
        for i, p in enumerate(parts):
            if "kit_building" not in p:
                continue
            label = f"{name} {part_label(p, i, group)}"
            if p["kit_building"] not in config.KIT_BUILDINGS:
                errors.append(f"{label}: unknown kit_building {p['kit_building']!r} (one of {', '.join(sorted(config.KIT_BUILDINGS))})")
            for k in ("kit", "file", "prim"):
                if k in p:
                    errors.append(f"{label}: kit_building replaces kit/file/prim; remove {k!r}")
    return errors


def check_recipe(recipe, name, schema, content, kit_files, roles):
    """Returns a list of problems of one recipe (schema first, then semantics; kit_building parts are checked as the kit piece they name)."""
    errors = [f"{name}: {e}" for e in schema_mod.validate(recipe, schema)]
    if errors:
        return errors
    errors = _check_kit_buildings(recipe, name)
    if errors:
        return errors
    recipe = expand(recipe)
    cid = recipe["id"]
    kind = "decor" if recipe["kind"] == "decor" else content_mod.kind_of(content, cid)
    if kind == "decor":
        if not cid.startswith(config.DECOR_PREFIX):
            errors.append(f"{name}: decoration IDs start with {config.DECOR_PREFIX!r} (they are not content IDs)")
        if content_mod.kind_of(content, cid) is not None:
            errors.append(f"{name}: id {cid!r} is a content ID; decoration needs its own")
        for k in ("variants", "levels", "ship", "attachments", "budget_exception", "anchors"):
            if k in recipe:
                errors.append(f"{name}: {k} is not for decoration")
    if kind is None:
        errors.append(f"{name}: id {cid!r} is not a building or ship in content/old_coast")
        return errors
    if os.path.splitext(os.path.basename(name))[0] != cid:
        errors.append(f"{name}: file name must be {cid}.json")
    if kind == "road":
        errors.append(f"{name}: roads have no model (they stay strips)")
    elif kind != "decor" and recipe["kind"] != kind:
        errors.append(f"{name}: kind {recipe['kind']!r} does not match the content ({kind})")
    is_house = content_mod.is_house(content, cid)
    if is_house and len(recipe.get("variants", [])) != 3:
        errors.append(f"{name}: houses need exactly 3 variants")
    levels = content_mod.warehouse_levels(content, cid)
    if "levels" in recipe:
        want = {str(i) for i in range(1, levels + 1)}
        if set(recipe["levels"]) != want:
            errors.append(f"{name}: levels must be {sorted(want)} (the content's Trading Post or Warehouse levels)")
    if "variants" in recipe and "levels" in recipe:
        errors.append(f"{name}: variants and levels cannot be combined")
    if kind == "ship":
        if "ship" not in recipe:
            errors.append(f"{name}: ships need a ship block")
    elif kind != "decor":
        for k in ("ship", "attachments"):
            if k in recipe:
                errors.append(f"{name}: {k} is only for ships")
    if "budget_exception" in recipe and cid not in config.EXCEPTION_ALLOWED:
        errors.append(f"{name}: budget_exception is only allowed for {', '.join(config.EXCEPTION_ALLOWED)}")
    for group, parts in part_groups(recipe):
        for i, p in enumerate(parts):
            label = f"{name} {part_label(p, i, group)}"
            if ("kit" in p) == ("prim" in p):
                errors.append(f"{label}: needs either kit + file or prim")
                continue
            if "kit" in p:
                if "file" not in p:
                    errors.append(f"{label}: kit pieces need a file")
                elif (p["kit"], p["file"]) not in kit_files:
                    errors.append(f"{label}: kit file {p['kit']}:{p['file']} is not listed in assets/kits/MANIFEST.json")
                bad = ALL_PRIM_PARAMS & set(p)
                if bad:
                    errors.append(f"{label}: primitive parameters on a kit piece: {', '.join(sorted(bad))}")
                cells = config.KIT_ATLAS_CELLS.get(p["kit"])
                if cells is not None:
                    known = atlas.names(cells)
                    bands = len(cells["bands"])
                    for k in sorted(set(p.get("roles", {})) | set(p.get("drop", []))):
                        base, band = atlas.split(k)
                        if not base.startswith("Atlas/") or base[len("Atlas/"):] not in known or (band is not None and not 0 <= band < bands):
                            errors.append(f"{label}: {k!r} is not a swatch of kit {p['kit']} (Atlas/<{'|'.join(known)}>[@0-{bands - 1}])")
            else:
                req, opt = PRIM_PARAMS[p["prim"]]
                for r in sorted(req - set(p)):
                    errors.append(f"{label}: {p['prim']} needs {r!r}")
                bad = (ALL_PRIM_PARAMS - req - opt) & set(p) | (KIT_ONLY & set(p)) | ({"file"} & set(p))
                if bad:
                    errors.append(f"{label}: parameters not used by {p['prim']}: {', '.join(sorted(bad))}")
                if "role" not in p:
                    errors.append(f"{label}: primitives need a role")
                if p["prim"] in ("cylinder", "lathe") and p.get("segments", 8) < 3:
                    errors.append(f"{label}: {p['prim']} needs at least 3 segments")
            mapped = [v["role"] if isinstance(v, dict) else v for v in p.get("roles", {}).values()]
            for r in [p.get("role")] + mapped:
                if r is not None and r not in roles:
                    errors.append(f"{label}: unknown role {r!r} (not a colour of {', '.join(config.ROLE_GROUPS)} in assets/palette.json)")
    return errors


def load_all(recipes_dir, content, kit_files, roles, schema=None, only=None):
    """Loads and validates every recipe; raises RecipeError listing all problems."""
    schema = schema or schema_mod.load()
    recipes = {}
    errors = []
    for fname in sorted(os.listdir(recipes_dir)):
        if not fname.endswith(".json") or fname == "schema.json":
            continue
        name = f"recipes/{fname}"
        try:
            with open(os.path.join(recipes_dir, fname), encoding="utf-8") as f:
                recipe = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            errors.append(f"{name}: cannot read: {e}")
            continue
        if only is not None and recipe.get("id") not in only:
            continue
        problems = check_recipe(recipe, name, schema, content, kit_files, roles)
        if problems:
            errors += problems
        else:
            recipes[recipe["id"]] = expand(recipe)
    if errors:
        raise RecipeError(f"{len(errors)} recipe problem(s):\n  " + "\n  ".join(errors))
    return recipes
