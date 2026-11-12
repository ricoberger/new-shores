"""
The D-077 models (ornaments, military, Kontor, repair crane, warships):
planned in planned/d077.json and, since content 0.22.0, published (the
content defines them; the tier tests leave them to this file). This builds
each one with its recipe and applies the same checks (budgets, footprint,
floating voxels, ground plate, anchors); the paint families (hedge, garden
wall, city wall) have recipes too, the square is a ground kind without a
model.
"""

import json
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
#: The planned D-077 models (planned/d077.json).
with open(os.path.join(config.PLANNED_DIR, "d077.json"), encoding="utf-8") as _f:
    PLANNED = [e["id"] for e in json.load(_f)]
PAINT = ("hedge", "garden_wall", "city_wall")
SHORE = ("harbour_statue", "harbour_tower", "kontor", "repair_crane")


class D077Test(unittest.TestCase):
    def test_every_d077_model_builds_without_problems(self):
        self.assertTrue({"kontor", "castle", "balinger"} <= set(PLANNED))
        for cid in PLANNED + list(PAINT):
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
                "tower": (2, 2), "gatehouse": (3, 3), "harbour_tower": (2, 2), "castle": (12, 12), "kontor": (4, 11), "repair_crane": (3, 3)}
        for cid, fp in want.items():
            self.assertEqual(tuple(CONTENT["buildings"][cid]["footprint"]), fp, cid)

    def test_the_d077_models_are_published_and_the_square_has_none(self):
        self.assertEqual(content_mod.held_ids(CONTENT), [])
        required = {cid for cid, _ in build.targets(CONTENT, RECIPES)}
        d077 = {cid for cid in CONTENT["buildings"] if content_mod.is_d077(CONTENT, cid)} | set(config.WARSHIPS)
        self.assertEqual(sorted(d077 - required), ["square"])
        self.assertEqual(content_mod.kind_of(CONTENT, "square"), "road")

    def test_the_paint_families_have_their_join_pieces(self):
        # ART_DIRECTION §7 wall set: `<id>.<piece>` models, each with arms to exactly its JOIN_ARMS edges.
        from nsvoxel import parts_d077 as O
        for cid, pieces in config.PAINT_JOINS.items():
            for piece in ("straight",) + pieces:
                jid = cid if piece == "straight" else f"{cid}.{piece}"
                self.assertEqual(content_mod.join_of(CONTENT, jid), None if piece == "straight" else cid, jid)
                kind = build.kind_for(CONTENT, jid)
                self.assertEqual(kind, "building", jid)
                files, entry, problems = model.build_id(jid, kind, RECIPES[jid], CONTENT)
                self.assertEqual(problems, [], jid)
                v = files[0][3]
                n = v.w
                edges = set()
                for x, y, _ in v.cells:
                    edges |= {e for e, hit in (("x-", x == 0), ("x+", x == n - 1), ("y-", y == 0), ("y+", y == n - 1)) if hit}
                self.assertEqual(sorted(edges), sorted(O.JOIN_ARMS[piece]), jid)

    def test_the_wall_stubs_line_up_with_the_city_wall(self):
        # The city wall runs on voxels 2..6 of its tile; the tower's stubs on 2..6 and 10..14 of each side,
        # the gatehouse's on 10..14 (its middle tile) of the x sides; all eight high.
        def edge_rows(cid):
            files, _, problems = model.build_id(cid, "building", RECIPES[cid], CONTENT)
            self.assertEqual(problems, [], cid)
            v = files[0][3]
            return sorted({y for x, y, z in v.cells if x == 0 and z < 8}), max(z for x, y, z in v.cells if x == 0)
        wall, _ = edge_rows("city_wall")
        self.assertEqual(wall, [2, 3, 4, 5])
        tower, tower_h = edge_rows("tower")
        self.assertEqual(tower, [2, 3, 4, 5, 10, 11, 12, 13])
        gate, gate_h = edge_rows("gatehouse")
        self.assertEqual(gate, [10, 11, 12, 13])
        self.assertEqual((tower_h, gate_h), (7, 7))

    def test_the_crane_arm_sways_from_its_root(self):
        # export.ARM: weight 0 at the jib's root (rigid there), rising to ARM_SWAY at its tip.
        from nsvoxel import export
        files, entry, problems = model.build_id("repair_crane", "building", RECIPES["repair_crane"], CONTENT)
        self.assertEqual(problems, [], "repair_crane")
        self.assertIn("arm", entry["sway"])
        v = files[0][3]
        _, _, _, sway = export.build_tris(v.cells, v.w, v.d, 1 / 8)
        weights = [w for t in sway if t for w in t]
        self.assertAlmostEqual(min(weights), 0.0, places=6)
        self.assertGreater(max(weights), 0.9 * export.ARM_SWAY)
        self.assertLessEqual(max(weights), export.ARM_SWAY)


if __name__ == "__main__":
    unittest.main()
