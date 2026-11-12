"""
The D-077 models (ornaments, military, Kontor, repair crane, warships): planned
and held (built, checked, sheeted, not published until the content defines
them), so the committed-manifest tests never see them; this builds each one
with a recipe and applies the same checks (budgets, footprint, floating
voxels, ground plate, anchors).
"""

import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content as content_mod, model  # noqa: E402

CONTENT = content_mod.load()
RECIPES = model.recipe_modules()
PLANNED = [cid for cid in content_mod.held_ids(CONTENT) if cid in RECIPES]
SHORE = ("harbour_statue", "harbour_tower", "kontor", "repair_crane")


class D077Test(unittest.TestCase):
    def test_every_held_model_builds_without_problems(self):
        for cid in PLANNED:
            kind = build.kind_for(CONTENT, cid)
            files, entry, problems = model.build_id(cid, kind, RECIPES[cid], CONTENT)
            self.assertEqual(problems, [], cid)
            self.assertTrue(files, cid)

    def test_the_warships_have_the_d077_lengths_and_budgets(self):
        for cid, length in (("balinger", 2.0), ("war_cog", 2.6), ("war_carrack", 3.2)):
            self.assertEqual(CONTENT["ships"][cid]["length_tiles"], length, cid)
            self.assertEqual(RECIPES[cid]["ship"]["length_tiles"], length, cid)
            files, entry, problems = model.build_id(cid, "ship", RECIPES[cid], CONTENT)
            self.assertEqual(problems, [], cid)
            self.assertEqual(entry["ship"]["length_tiles"], length, cid)
            self.assertIn("sail", entry["sway"], cid)
            self.assertLessEqual(entry["file"]["lite"]["triangles"], config.LITE_BUDGET_SHIPS[cid], cid)
            self.assertNotIn("cargo", entry.get("attachments", {}), cid)

    def test_shore_buildings_are_planned_as_shore_and_listed(self):
        for cid in SHORE:
            self.assertEqual(CONTENT["buildings"][cid].get("placement"), "shore", cid)
        self.assertEqual(sorted(config.SHORE_MODELS), sorted(SHORE))

    def test_the_footprints_are_the_d077_ones(self):
        want = {"tree_ornament": (1, 1), "flower_bed": (1, 1), "well": (1, 1), "pillory": (1, 1), "maypole": (2, 2), "pond": (3, 3),
                "fountain": (2, 2), "statue": (2, 2), "cemetery": (4, 4), "harbour_statue": (2, 2), "gold_statue": (3, 3),
                "tower": (2, 2), "gatehouse": (3, 3), "harbour_tower": (2, 2), "castle": (8, 8), "kontor": (4, 11), "repair_crane": (3, 3)}
        for cid, fp in want.items():
            self.assertEqual(tuple(CONTENT["buildings"][cid]["footprint"]), fp, cid)

    def test_a_held_model_is_not_published(self):
        held = set(content_mod.held_ids(CONTENT))
        required = {cid for cid, _ in build.targets(CONTENT, RECIPES)}
        self.assertTrue(held.isdisjoint(required))


if __name__ == "__main__":
    unittest.main()
