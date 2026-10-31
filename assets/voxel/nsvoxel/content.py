"""Content definitions the recipes refer to (footprints, kinds, levels) — read, never duplicated."""

import json
import os

from . import config, schema as schema_mod


class ContentError(Exception):
    """A planned-footprints file is invalid (the message lists every problem)."""


def load(content_dir=None, planned_dir=config.PLANNED_DIR):
    """
    Returns {"buildings": {id: def}, "ships": {id: def}} of content_dir
    (default: config.content_dir()) with the planned footprints of
    planned_dir beneath it (None: content only; see load_planned).
    """
    content_dir = content_dir or config.content_dir()
    with open(os.path.join(content_dir, "buildings.json"), encoding="utf-8") as f:
        buildings = {b["id"]: b for b in json.load(f)}
    with open(os.path.join(content_dir, "ships.json"), encoding="utf-8") as f:
        ships = {s["id"]: s for s in json.load(f)}
    out = {"buildings": buildings, "ships": ships}
    if planned_dir is not None:
        merge_planned(out, load_planned(planned_dir))
    return out


def load_planned(planned_dir=config.PLANNED_DIR, schema_path=config.PLANNED_SCHEMA_PATH):
    """
    The planned entries of every *.json in planned_dir except schema.json
    (file order, then entry order), validated against the planned schema;
    an ID planned twice is an error. Returns [] without the directory.
    """
    if not os.path.isdir(planned_dir):
        return []
    with open(schema_path, encoding="utf-8") as f:
        schema = json.load(f)
    schema_mod.check_keywords(schema)
    entries, errors, seen = [], [], {}
    for fname in sorted(os.listdir(planned_dir)):
        if not fname.endswith(".json") or fname == "schema.json":
            continue
        name = f"planned/{fname}"
        try:
            with open(os.path.join(planned_dir, fname), encoding="utf-8") as f:
                doc = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            errors.append(f"{name}: cannot read: {e}")
            continue
        problems = schema_mod.validate(doc, schema)
        if problems:
            errors += [f"{name}: {p}" for p in problems]
            continue
        for i, e in enumerate(doc):
            where = f"{name}[{i}] {e['id']!r}"
            if e["id"] in seen:
                errors.append(f"{where}: already planned in {seen[e['id']]}")
                continue
            seen[e["id"]] = name
            if (e["kind"] == "ship") != (e["footprint"] is None):
                errors.append(f"{where}: ships (and only ships) have footprint null")
            if (e["kind"] == "ship") != ("slots" in e):
                errors.append(f"{where}: ships (and only ships) have slots")
            if "smoke" in e and e["kind"] not in ("producer", "farm"):
                errors.append(f"{where}: smoke is only for producers and farms")
            if e["kind"] in ("field", "ship") and e["water_tiles"]:
                errors.append(f"{where}: {e['kind']}s have no water rows")
            entries.append(e)
    if errors:
        raise ContentError(f"{len(errors)} planned-footprint problem(s):\n  " + "\n  ".join(errors))
    return entries


def planned_def(e):
    """("buildings" | "ships", a content-shaped definition) of a planned entry, marked planned."""
    tier = config.TIER_NAMES[e["tier"] - 1]
    if e["kind"] == "ship":
        return "ships", {"id": e["id"], "tier": tier, "slots": e["slots"], "planned": True}
    d = {"id": e["id"], "tier": tier, "footprint": list(e["footprint"]), "planned": True, "smoke": e.get("smoke", False)}
    if e["water_tiles"]:
        d["water_tiles"] = e["water_tiles"]
    if e["slot"]:
        d["requires_deposit"] = e["slot"]
    if e["kind"] == "house":
        d["house"] = {}
    elif e["kind"] in ("producer", "farm"):
        d["recipe"] = {}
    elif e["kind"] == "service":
        d["service"] = {}
    else:
        d["field"] = {"type": e["id"]}
    if "levels" in e:
        d["planned_levels"] = e["levels"]
    if e.get("hold"):
        d["held"] = True
    return ("buildings", d)


def merge_planned(content, entries):
    """
    Adds planned entries beneath content (in place): an ID the content does
    not define gets the planned definition; an ID it defines keeps the
    content's, except that a planned `levels` count is added while the
    content declares no levels for it, and that an `override` entry
    replaces the footprint and water rows of the content's definition
    for as long as the content's footprint differs from the planned one
    (D-062 re-fits: the content lands in a parallel change; once its
    footprint equals the planned one the content wins entirely).
    """
    for e in entries:
        group, d = planned_def(e)
        own = content["buildings"].get(e["id"]) or content["ships"].get(e["id"])
        if own is None:
            content[group][e["id"]] = d
        elif e.get("override") and group == "buildings" and list(own["footprint"]) != list(e["footprint"]):
            fit = dict(own, footprint=list(e["footprint"]), tier=config.TIER_NAMES[e["tier"] - 1], refitted=True)
            fit.pop("water_tiles", None)
            fit.pop("water_rows", None)
            if e["water_tiles"]:
                fit["water_tiles"] = e["water_tiles"]
            if "levels" in e:
                fit["planned_levels"] = e["levels"]
            else:
                fit.pop("planned_levels", None)
            content["buildings"][e["id"]] = fit
        elif "levels" in e and group == "buildings" and levels(content, e["id"]) == 0:
            content["buildings"][e["id"]] = dict(own, planned_levels=e["levels"])
    return content


def is_planned(content, cid):
    """Whether an ID comes from the planned footprints (the content does not define it yet)."""
    return bool((content["buildings"].get(cid) or content["ships"].get(cid) or {}).get("planned"))


def held_ids(content):
    """Planned IDs marked `hold`: built, checked and sheeted, but not published until the content defines them."""
    return sorted(cid for cid, d in content["buildings"].items() if d.get("held"))


def planned_ids(content):
    return sorted(cid for group in ("buildings", "ships") for cid, d in content[group].items() if d.get("planned"))


def kind_of(content, cid):
    """'building', 'field', 'ship', 'road' or None (unknown ID)."""
    if cid in content["ships"]:
        return "ship"
    b = content["buildings"].get(cid)
    if b is None:
        return None
    if "road" in b:
        return "road"
    if "field" in b:
        return "field"
    return "building"


def footprint(content, cid):
    """(w, h) at rotation 0 (tiles) of a building or field."""
    w, h = content["buildings"][cid]["footprint"]
    return int(w), int(h)


def is_house(content, cid):
    return "house" in content["buildings"].get(cid, {})


def is_producer(content, cid):
    """Whether a building runs a production recipe (cart point; see needs_smoke for the chimney)."""
    return "recipe" in content["buildings"].get(cid, {}) and "field" not in content["buildings"].get(cid, {})


def needs_smoke(content, cid):
    """
    Whether a building's model needs chimney and smoke anchors for the life
    layer's smoke: a producer whose definition says `smoke: true` (it burns
    or cooks; content buildings.json, else the planned entry).
    """
    if not is_producer(content, cid):
        return False
    return bool(content["buildings"][cid].get("smoke", False))


def life_anchors(content, cid):
    """
    The life-layer anchors a building's or field's model must declare besides
    chimney/smoke (D-054): a cart point for producers and storage, the boat's
    mooring for water-edge producers, one pier slot per berth of the Trading
    Post's top level, the slipway of a shipyard (where the hull under
    construction stands), and for pasture modules a gate and the animal
    positions of config.PASTURE_ANIMALS (by field ID, else field type:
    three sheep, three cattle, four pigs).
    """
    b = content["buildings"].get(cid, {})
    out = []
    if is_producer(content, cid) or warehouse_levels(content, cid):
        out.append("cart")
    rows = b.get("water_rows")
    water = rows["max"] if isinstance(rows, dict) else b.get("water_tiles", 0)
    if is_producer(content, cid) and water > 0:
        out.append("boat")
    berths = max((lv.get("berths", 0) for lv in (b.get("trading_post") or {}).get("levels", [])), default=0)
    out += [f"berth_{i}" for i in range(1, berths + 1)]
    if "shipyard" in b:
        out.append("slip")
    if "field" in b:
        animals = config.PASTURE_ANIMALS.get(cid) or config.PASTURE_ANIMALS.get(b["field"].get("type"))
        if animals:
            out += ["gate"] + [f"{animals[0]}_{i}" for i in range(1, animals[1] + 1)]
    return out


def warehouse_levels(content, cid):
    """Number of levels of a Trading Post or Warehouse (0 for other buildings)."""
    b = content["buildings"].get(cid, {})
    return len((b.get("trading_post") or b.get("warehouse") or {}).get("levels", []))


def levels(content, cid):
    """
    Number of model levels of a building (0: one model): a Trading Post's or
    Warehouse's levels, a `levels` list of the building or of its service
    block (market, D-056 §3; the content format is S1's), else a
    planned levels count.
    """
    b = content["buildings"].get(cid, {})
    n = warehouse_levels(content, cid)
    for block in (b, b.get("service") or {}):
        if not n and isinstance(block.get("levels"), list):
            n = len(block["levels"])
    return n or b.get("planned_levels", 0)


def required_ids(content, held=False):
    """
    Every ID that needs a model: tier 1–4 buildings except roads (fields
    included), the listed ships and every planned building and ship;
    `held` planned IDs (not yet in the content) only with held=True.
    """
    ids = [
        b["id"]
        for b in content["buildings"].values()
        if (b.get("tier") in config.MODEL_TIERS or b.get("planned")) and "road" not in b and (held or not b.get("held"))
    ]
    ids += [s["id"] for s in content["ships"].values() if s["id"] in config.MODEL_SHIPS or s.get("planned")]
    return sorted(ids)
