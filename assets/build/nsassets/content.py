"""Content definitions the recipes refer to (footprints, kinds, levels) — read, never duplicated."""

import json
import os

from . import config


def load(content_dir=None):
    """Returns {"buildings": {id: def}, "ships": {id: def}} of content_dir (default: config.content_dir())."""
    content_dir = content_dir or config.content_dir()
    with open(os.path.join(content_dir, "buildings.json"), encoding="utf-8") as f:
        buildings = {b["id"]: b for b in json.load(f)}
    with open(os.path.join(content_dir, "ships.json"), encoding="utf-8") as f:
        ships = {s["id"]: s for s in json.load(f)}
    return {"buildings": buildings, "ships": ships}


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
    """Whether a building runs a production recipe (its model needs chimney and smoke anchors for the life layer's smoke)."""
    return "recipe" in content["buildings"].get(cid, {}) and "field" not in content["buildings"].get(cid, {})


def life_anchors(content, cid):
    """
    The life-layer anchors a building's or field's model must declare besides
    chimney/smoke (D-054): a cart point for producers and storage, the boat's
    mooring for water-edge producers, one pier slot per berth of the Trading
    Post's top level, the slipway of a shipyard (where the hull under
    construction stands), and a gate and three sheep for pastures.
    """
    b = content["buildings"].get(cid, {})
    out = []
    if is_producer(content, cid) or warehouse_levels(content, cid):
        out.append("cart")
    if is_producer(content, cid) and b.get("water_tiles", 0) > 0:
        out.append("boat")
    berths = max((lv.get("berths", 0) for lv in (b.get("trading_post") or {}).get("levels", [])), default=0)
    out += [f"berth_{i}" for i in range(1, berths + 1)]
    if "shipyard" in b:
        out.append("slip")
    if b.get("field", {}).get("type") == "pasture":
        out += ["gate", "sheep_1", "sheep_2", "sheep_3"]
    return out


def ground_range(content, cid):
    """The ground band of a building's lowest point: deeper for water-edge buildings (piles into the sea)."""
    if content["buildings"].get(cid, {}).get("water_tiles", 0) > 0:
        return config.GROUND_RANGE_WATER_EDGE
    return config.GROUND_RANGE


def warehouse_levels(content, cid):
    """Number of levels of a Trading Post or Warehouse (0 for other buildings)."""
    b = content["buildings"].get(cid, {})
    return len((b.get("trading_post") or b.get("warehouse") or {}).get("levels", []))


def required_ids(content):
    """Every content ID that needs a model: tier 1–2 buildings except roads (fields included) and the pending ones, and the listed ships."""
    ids = [
        b["id"]
        for b in content["buildings"].values()
        if b.get("tier") in config.MODEL_TIERS and "road" not in b and b["id"] not in config.MODEL_PENDING
    ]
    ids += [s for s in config.MODEL_SHIPS if s in content["ships"]]
    return sorted(ids)
