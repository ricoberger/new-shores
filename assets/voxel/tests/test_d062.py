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
}
#: Model files that carry a sway group (cloth) and the group.
SWAY = {"trading_post.l4.glb": ["flag"]}


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
