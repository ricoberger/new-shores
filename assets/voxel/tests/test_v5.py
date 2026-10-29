"""
The tier-4 (Patricians) models and the ships of the D-057 V5 session
against their content: required anchors per content flags, full and lite
budgets, deterministic builds, footprint fit, three house variants, ship
hull lengths, mast counts, one cargo prop per slot and the wake anchor;
plus the detail_v5 helpers stay on the voxel grid (stdlib unittest).
"""

import importlib.util
import json
import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

from nsvoxel import config, content, model  # noqa: E402
from nsvoxel import detail_v5 as Q  # noqa: E402
from nsvoxel.grid import Vox  # noqa: E402

CONTENT = content.load()
RECIPES = model.recipe_modules()

#: Buildings and fields of the V5 session (all tier-4 recipes).
V5_IDS = (
    "house_patricians",
    "cattle_farm",
    "vineyard",
    "vine_row",
    "oyster_beds",
    "quartz_quarry",
    "copper_mine",
    "gold_mine",
    "slaughterhouse",
    "oyster_house",
    "cooperage",
    "winepress",
    "malt_house",
    "fashion_house",
    "thread_spinner",
    "lace_maker",
    "candle_foundry",
    "glass_smelter",
    "copper_smelter",
    "gold_smelter",
    "optician",
    "goldsmith",
    "luthier",
    "university",
    "cathedral",
)


def _ships_module():
    path = os.path.join(VOXEL_DIR, "recipes", "_ships.py")
    spec = importlib.util.spec_from_file_location("v5_ships", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def grids(cid):
    """(key, ctx, grid) of every output of a V5 building or field, built with its content's needs."""
    kind = content.kind_of(CONTENT, cid)
    recipe = RECIPES[cid]
    out = []
    for _, key, ctx in model.outputs(cid, kind, recipe, CONTENT):
        ctx.needs = model.required_anchors(CONTENT, cid)
        ctx.smoke = "smoke" in ctx.needs
        out.append((key, ctx, model.build_grid(recipe, kind, key, ctx)))
    return out


class V5ModelsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(config.MODELS_DIR, "manifest.json"), encoding="utf-8") as f:
            cls.manifest = json.load(f)["models"]

    def test_every_v5_id_has_a_recipe_and_is_patrician(self):
        for cid in V5_IDS:
            self.assertIn(cid, RECIPES, cid)
            self.assertEqual(CONTENT["buildings"][cid].get("tier", "patricians"), "patricians", cid)

    def test_anchors_follow_the_content_flags(self):
        for cid in V5_IDS:
            needed = model.required_anchors(CONTENT, cid)
            for key, ctx, v in grids(cid):
                for a in needed:
                    self.assertIn(a, v.anchors, f"{cid} {key}: {a}")
                self.assertEqual("smoke" in v.anchors, content.needs_smoke(CONTENT, cid), f"{cid} {key}")
            anchors = self.manifest[cid]["anchors"]
            self.assertIn("status", anchors, cid)
            if content.kind_of(CONTENT, cid) == "building":
                self.assertIn("door", anchors, cid)
        self.assertIn("boat", model.required_anchors(CONTENT, "oyster_beds"))
        self.assertIn("cart", model.required_anchors(CONTENT, "oyster_beds"))

    def test_budgets_full_and_lite(self):
        for cid in V5_IDS:
            entry = self.manifest[cid]
            for info in [entry.get("file")] + entry.get("variants", []):
                if not info:
                    continue
                self.assertLessEqual(info["triangles"], info["budget"], f"{cid} {info['path']}")
                if "lite" in info:
                    self.assertLessEqual(info["lite"]["triangles"], info["lite"]["budget"], f"{cid} {info['lite']['path']}")

    def test_builds_are_deterministic_and_fit_the_footprint(self):
        for cid in V5_IDS:
            first = grids(cid)
            second = grids(cid)
            for (key, ctx, a), (_, _, b) in zip(first, second):
                self.assertEqual(a.cells, b.cells, f"{cid} {key}")
                self.assertEqual(a.anchors, b.anchors, f"{cid} {key}")
                self.assertEqual(model.check_grid(a, ctx, ctx.needs), [], f"{cid} {key}")

    def test_three_patrician_house_variants(self):
        self.assertEqual(RECIPES["house_patricians"]["variants"], 3)
        self.assertEqual(len(self.manifest["house_patricians"]["variants"]), 3)
        cells = [v.cells for _, _, v in grids("house_patricians")]
        self.assertNotEqual(cells[0], cells[1])
        self.assertNotEqual(cells[1], cells[2])

    def test_oyster_racks_stand_over_the_water_rows(self):
        (_, ctx, v), = grids("oyster_beds")
        self.assertEqual(ctx.water, 4)
        wet = [k for k in v.cells if k[1] < ctx.land and k[2] < 0]
        self.assertTrue(wet, "piles reach into the water rows")
        self.assertLess(v.anchors["boat"][1], ctx.land)


class V5ShipsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(config.MODELS_DIR, "manifest.json"), encoding="utf-8") as f:
            cls.manifest = json.load(f)["models"]
        cls.ships = _ships_module()

    def build(self, cid, key=None):
        recipe = RECIPES[cid]
        out = model.outputs(cid, "ship", recipe, CONTENT)
        ctx = [c for _, k, c in out if k == key][0]
        return model.build_grid(recipe, "ship", key, ctx)

    def test_hull_length_at_the_waterline_matches_the_content(self):
        for cid in config.MODEL_SHIPS:
            v = self.build(cid)
            xs = [x for (x, _, z) in v.cells if z == 1]
            length = max(xs) - min(xs) + 1
            self.assertEqual(length, round(CONTENT["ships"][cid]["length_tiles"] * self.ships.SCALE), cid)
            self.assertEqual(length, self.ships.HULL_LENGTH[cid], cid)

    def test_masts_and_anchors(self):
        for cid, masts in (("sloop", 1), ("brig", 2), ("galleon", 3)):
            self.assertEqual(self.manifest[cid]["ship"]["masts"], masts, cid)
            self.assertEqual(sorted(self.manifest[cid]["anchors"]), ["status", "wake"], cid)
            v = self.build(cid)
            self.assertEqual(v.anchors["wake"][2], 0, cid)

    def test_sails_and_flags_sway(self):
        for cid in config.MODEL_SHIPS:
            groups = {m[2] for m in self.build(cid).cells.values() if len(m) > 2}
            self.assertEqual(groups, {"sail", "flag"}, cid)

    def test_one_cargo_prop_per_slot_on_free_deck(self):
        for cid in config.MODEL_SHIPS:
            slots = CONTENT["ships"][cid]["slots"]
            self.assertEqual(len(self.ships.CARGO_SPOTS[cid]), slots, cid)
            hull = self.build(cid)
            cargo = self.build(cid, ("attachment", "cargo"))
            self.assertFalse(set(cargo.cells) & set(hull.cells), f"{cid}: cargo overlaps the hull")
            self.assertGreaterEqual(min(z for (_, _, z) in cargo.cells), 4, cid)
            self.assertLessEqual(self.manifest[cid]["file"]["triangles"], config.BUDGET_SHIPS[cid], cid)
            self.assertLessEqual(self.manifest[cid]["attachments"]["cargo"]["triangles"], config.BUDGET_SHIP_CARGO, cid)


class DetailV5Test(unittest.TestCase):
    def test_helpers_stay_on_the_grid(self):
        v = Vox(64, 64)
        Q.palazzo(v, 4, 4, 30, 20, (8, 6))
        Q.tower(v, 34, 4, 44, 14, 1, 20)
        Q.dome(v, 50, 40, 1, 6.5)
        Q.trellis_row(v, 2, 30, 40, along="x")
        Q.furnace(v, 4, 44, size=12, tiers=3, streak=Q.VERDIGRIS)
        Q.headframe(v, 40, 30, 1, 10)
        for k in v.cells:
            self.assertTrue(all(isinstance(c, int) for c in k), k)
        self.assertIn("smoke", v.anchors)


if __name__ == "__main__":
    unittest.main()
