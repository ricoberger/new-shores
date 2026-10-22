"""Recipe loading and validation (schema + content, kit manifest and palette rules)."""

import json
import os

from . import config, content as content_mod, schema as schema_mod

PRIM_PARAMS = {
    "box": ({"size"}, {"open"}),
    "cylinder": ({"radius", "height"}, {"radius_top", "segments", "caps"}),
    "wedge": ({"size"}, {"hip"}),
    "sail": ({"width", "height"}, {"width_top", "bulge", "segments"}),
    "lathe": ({"profile"}, {"segments"}),
    "rock": ({"size"}, {"detail"}),
}
ALL_PRIM_PARAMS = set().union(*(req | opt for req, opt in PRIM_PARAMS.values()))
KIT_ONLY = {"roles", "simplify", "crop"}


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


def check_recipe(recipe, name, schema, content, kit_files, roles):
    """Returns a list of problems of one recipe (schema first, then semantics)."""
    errors = [f"{name}: {e}" for e in schema_mod.validate(recipe, schema)]
    if errors:
        return errors
    cid = recipe["id"]
    kind = content_mod.kind_of(content, cid)
    if kind is None:
        errors.append(f"{name}: id {cid!r} is not a building or ship in content/old_coast")
        return errors
    if os.path.splitext(os.path.basename(name))[0] != cid:
        errors.append(f"{name}: file name must be {cid}.json")
    if kind == "road":
        errors.append(f"{name}: roads have no model (they stay strips)")
    elif recipe["kind"] != kind:
        errors.append(f"{name}: kind {recipe['kind']!r} does not match the content ({kind})")
    is_house = content_mod.is_house(content, cid)
    if is_house and len(recipe.get("variants", [])) != 3:
        errors.append(f"{name}: houses need exactly 3 variants")
    levels = content_mod.warehouse_levels(content, cid)
    if "levels" in recipe:
        want = {str(i) for i in range(1, levels + 1)}
        if set(recipe["levels"]) != want:
            errors.append(f"{name}: levels must be {sorted(want)} (the content's warehouse levels)")
    if "variants" in recipe and "levels" in recipe:
        errors.append(f"{name}: variants and levels cannot be combined")
    if kind == "ship":
        if "ship" not in recipe:
            errors.append(f"{name}: ships need a ship block")
    else:
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
            for r in [p.get("role")] + list(p.get("roles", {}).values()):
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
            recipes[recipe["id"]] = recipe
    if errors:
        raise RecipeError(f"{len(errors)} recipe problem(s):\n  " + "\n  ".join(errors))
    return recipes
