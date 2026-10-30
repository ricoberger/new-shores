"""
The D-062/D-063 models (Anno-sized footprints, playhouse): every recipe fits
its footprint and budgets, declares the anchors LIFE_LAYER §7 and the content
need, stays deterministic and keeps its water rows and levels (stdlib unittest).
"""

import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content, model  # noqa: E402

CONTENT = content.load()

#: id → (footprint w × d tiles, water rows the model stands over, anchors beyond status, model files).
D062 = {
    "trading_post": ((6, 6), 1, ("door", "cart", "berth_1", "berth_2", "berth_3", "berth_4"), 4),
    "chapel": ((3, 5), 0, ("door",), 1),
    "city_guard": ((4, 4), 0, ("door",), 1),
    "fire_station": ((4, 5), 0, ("door",), 1),
    "surgery": ((4, 6), 0, ("door",), 1),
    "trading_pier": ((6, 9), 5, ("berth_1", "berth_2", "cart"), 1),
    "depot": ((11, 4), 1, ("cart", "door"), 1),
}
#: Voxels of the model's water rows: the deck of the pier (all six), the front row of the depot (D-062: 5–6 and 0–1 in the content).
MODEL_WATER = {"trading_post": 8, "trading_pier": 48, "depot": 8}
#: Model files that carry a sway group (cloth) and the group.
SWAY = {"trading_post.l4.glb": ["flag"], "surgery.glb": ["cloth"]}


class D062Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipes = model.recipe_modules()
        cls.cache = {}

    def built(self, cid):
        if cid not in self.cache:
            kind = build.kind_for(CONTENT, cid)
            recipe, placeholder = build.recipe_for(cid, kind, self.recipes)
            self.assertFalse(placeholder, cid)
            self.cache[cid] = model.build_id(cid, kind, recipe, CONTENT)
        return self.cache[cid]

    def test_footprints_are_the_anno_sized_ones(self):
        for cid, ((w, d), water, _, levels) in D062.items():
            with self.subTest(cid=cid):
                self.assertEqual(content.footprint(CONTENT, cid), (w, d))
                self.assertEqual(CONTENT["buildings"][cid].get("water_tiles", 0) if "water_rows" not in CONTENT["buildings"][cid] else water, water)
                self.assertEqual(content.levels(CONTENT, cid), levels if levels > 1 else 0)

    def test_budgets_footprint_anchors_and_levels(self):
        for cid, ((w, d), water, anchors, levels) in D062.items():
            with self.subTest(cid=cid):
                files, entry, problems = self.built(cid)
                self.assertEqual(problems, [])
                self.assertEqual(entry["footprint"], {"w": w, "h": d})
                for a in ("door", "status") + anchors:
                    self.assertIn(a, entry["anchors"], cid)
                self.assertNotIn("smoke", entry["anchors"])
                if levels > 1:
                    self.assertEqual(sorted(entry["levels"]), [str(i) for i in range(1, levels + 1)])
                else:
                    self.assertNotIn("levels", entry)
                for info in [entry.get("file")] + list(entry.get("levels", {}).values()):
                    if not info:
                        continue
                    self.assertLessEqual(info["triangles"], config.BUDGET_PER_TILE["building"] * w * d, info["path"])
                    self.assertLessEqual(info["lite"]["triangles"], config.LITE_BUDGET_PER_TILE["building"] * w * d, info["path"])
                    self.assertEqual(entry.get("sway", []) if info["path"] in SWAY else [], SWAY.get(info["path"], []))

    def test_sway_is_only_where_cloth_hangs(self):
        for cid in D062:
            _, entry, _ = self.built(cid)
            paths = [entry["file"]["path"]] if "file" in entry else [i["path"] for i in entry["levels"].values()]
            expected = sorted({g for p in paths for g in SWAY.get(p, [])})
            self.assertEqual(entry.get("sway", []), expected, cid)

    def test_the_city_guard_is_warm_sandstone_not_grey(self):
        files, _, _ = self.built("city_guard")
        v = [f[3] for f in files if f[0] == "city_guard.glb"][0]
        roles = [m[0] for m in v.cells.values()]
        self.assertLess(roles.count("stone") / len(roles), 0.03)
        self.assertGreater(roles.count("cliff-upper") / len(roles), 0.2)

    def test_the_surgery_is_a_patricians_stone_and_brick_house(self):
        self.assertEqual(CONTENT["buildings"]["surgery"]["tier"], "patricians")
        files, _, _ = self.built("surgery")
        v = [f[3] for f in files if f[0] == "surgery.glb"][0]
        roles = [m[0] for m in v.cells.values()]
        self.assertGreater(roles.count("stone"), 1000)  # the ashlar ground floor
        self.assertGreater(roles.count("terracotta"), 500)  # the brick upper storey

    def test_pier_berths_are_on_the_flanks_at_mid_deck(self):
        _, entry, _ = self.built("trading_pier")
        a = entry["anchors"]
        w = 6 * config.VOXELS_PER_TILE
        scale = config.VOXELS_PER_TILE
        self.assertAlmostEqual(a["berth_1"][0], (-1.2 - w / 2) / scale, places=2)
        self.assertAlmostEqual(a["berth_2"][0], (w + 1.2 - w / 2) / scale, places=2)
        self.assertAlmostEqual(a["berth_1"][2], a["berth_2"][2])
        # y at the middle of the deck's water rows (voxel 24 of 72); glTF +z points to the sea.
        self.assertAlmostEqual(a["berth_1"][2], (9 * scale / 2 - MODEL_WATER["trading_pier"] / 2) / scale, places=2)

    def test_the_depot_has_no_levels_and_no_cloth(self):
        files, entry, _ = self.built("depot")
        self.assertNotIn("levels", entry)
        self.assertEqual([f[0] for f in files], ["depot.glb", "depot.lite.glb"])
        self.assertEqual(entry.get("sway", []), [])

    def test_nothing_solid_stands_over_the_water_rows_and_only_piles_reach_below_ground(self):
        # The water rows hold decks, ramps, quay edges, posts and piles; walls and roofs stand on the land rows behind them.
        for cid, rows in MODEL_WATER.items():
            files, _, _ = self.built(cid)
            for f in files:
                if f[3] is None:
                    continue
                for (x, y, z), m in f[3].cells.items():
                    if z < 0:
                        self.assertLess(y, rows + 2, (cid, f[0], x, y, z))
                    if y < rows and z > 4:
                        self.assertIn(m[0], ("timber", "iron", "brass", "canvas"), (cid, f[0], x, y, z, m))

    def test_deterministic(self):
        for cid in D062:
            kind = build.kind_for(CONTENT, cid)
            recipe, _ = build.recipe_for(cid, kind, self.recipes)
            a = model.build_id(cid, kind, recipe, CONTENT)[0]
            b = model.build_id(cid, kind, recipe, CONTENT)[0]
            self.assertEqual([f[1] for f in a], [f[1] for f in b], cid)

    def test_trading_post_berths_keep_their_spacing_on_every_level(self):
        _, entry, _ = self.built("trading_post")
        xs = [entry["anchors"][f"berth_{i}"][0] for i in range(1, 5)]
        self.assertEqual(xs, [-0.75, 0.75, -2.25, 2.25])
        for i in range(1, 5):
            self.assertGreater(entry["anchors"][f"berth_{i}"][2], 2.5)  # at the water edge (glTF +z is the sea side)


if __name__ == "__main__":
    unittest.main()
