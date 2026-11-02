"""D-068: ground cover is texture — yards are a per-tile ground map, models stand on the terrain at z = 0, no plates, no floating props."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build  # noqa: E402
from nsvoxel import config, content as content_mod, grid, model, parts as P  # noqa: E402

CONTENT = content_mod.load()


def land_ids(recipes):
    """Building and field IDs with a recipe, but the water structures of D-068 §5."""
    for cid in sorted(recipes):
        kind = build.kind_for(CONTENT, cid)
        if kind in ("building", "field") and cid not in config.WATER_MODELS:
            yield cid, kind


class GroundMapTest(unittest.TestCase):
    def test_a_yard_lays_no_voxels_and_declares_its_kind(self):
        v = grid.Vox(16, 16)
        P.yard(v, 0, 0, 16, 16, "dirt")
        P.yard(v, 0, 0, 16, 8, "paved")
        P.yard(v, 0, 0, 4, 4, "grass")
        P.path(v, [(15, 15)], kind="paved")
        self.assertEqual(v.cells, {})
        self.assertEqual(v.ground[(8, 12)], "dirt")
        self.assertEqual(v.ground[(8, 4)], "paved")
        self.assertNotIn((1, 1), v.ground)
        self.assertEqual(v.ground[(15, 15)], "paved")
        with self.assertRaises(ValueError):
            P.yard(v, 0, 0, 1, 1, "turf")

    def test_the_ground_map_takes_the_kind_covering_half_a_tile(self):
        ctx = model.Ctx("chapel", "building", 3, 2, {}, scale=8)
        v = ctx.vox()
        P.yard(v, 0, 0, 8, 8, "paved")  # tile (0, 0)
        P.yard(v, 8, 0, 12, 8, "dirt")  # half of tile (1, 0)
        P.yard(v, 16, 8, 19, 16, "sand")  # 3/8 of tile (2, 1): too little
        self.assertEqual(model.ground_map(v, ctx), [["paved", "dirt", "none"], ["none", "none", "none"]])
        self.assertIsNone(model.ground_map(ctx.vox(), ctx))

    def test_the_manifest_carries_the_ground_of_every_drawn_file(self):
        with open(os.path.join(config.MODELS_DIR, "manifest.json")) as f:
            models = json.load(f)["models"]
        seen = 0
        for cid, entry in models.items():
            files = [entry["file"]] if "file" in entry else list(entry.get("variants", [])) + list(entry.get("levels", {}).values())
            for info in files:
                self.assertNotIn("ground", info.get("lite", {}), cid)
                g = info.get("ground")
                if g is None:
                    continue
                self.assertEqual(entry["kind"], "building", cid)
                seen += 1
                fp = entry["footprint"]
                self.assertEqual(len(g), fp["h"], cid)
                for row in g:
                    self.assertEqual(len(row), fp["w"], cid)
                    for k in row:
                        self.assertIn(k, config.GROUND_KINDS, cid)
                self.assertTrue(any(k != "none" for row in g for k in row), cid)
        self.assertGreater(seen, 40)

    def test_reworked_houses_of_tiers_1_and_2_stand_on_dirt_over_the_whole_plot(self):
        # The 1404 peasant and citizen houses sit on bare earth (merchants and patricians: cobbles).
        with open(os.path.join(config.MODELS_DIR, "manifest.json")) as f:
            models = json.load(f)["models"]
        for cid in ("house_settlers", "house_citizens"):
            for info in models[cid]["variants"]:
                self.assertEqual({k for row in info["ground"] for k in row}, {"dirt"}, cid)

    def test_the_water_models_are_the_content_ids_with_water_rows(self):
        water = {cid for cid, d in CONTENT["buildings"].items() if (d.get("water_rows") or {}).get("max", d.get("water_tiles", 0))}
        self.assertEqual(set(config.WATER_MODELS), water)


class StandOnTheTerrainTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipes = model.recipe_modules()
        cls.grids = {}
        for cid, kind in land_ids(cls.recipes):
            for fname, key, ctx in model.outputs(cid, kind, cls.recipes[cid], CONTENT):
                ctx.needs = model.required_anchors(CONTENT, cid)
                cls.grids[fname] = (model.build_grid(cls.recipes[cid], kind, key, ctx), ctx)

    def test_every_land_model_starts_at_z_0(self):
        for fname, (v, _) in self.grids.items():
            self.assertEqual(min(z for (_, _, z) in v.cells), 0, fname)

    def test_no_land_model_has_a_ground_plate(self):
        for fname, (v, ctx) in self.grids.items():
            self.assertLessEqual(model.plate_share(v, ctx), config.PLATE_SHARE, fname)

    def test_a_plate_is_a_build_problem(self):
        def plate(ctx):
            v = ctx.vox()
            v.box(0, 0, 0, ctx.W, ctx.D, 1, grid.mat("road-dirt"))
            v.box(0, 0, 0, 4, 4, 6, grid.mat("plaster"))
            return v

        _, _, problems = model.build_id("chapel", "building", {"build": plate}, CONTENT)
        self.assertTrue(any("ground plate" in p for p in problems), problems)

    def test_a_recipe_on_the_old_plate_is_settled(self):
        def legacy(ctx):
            v = ctx.vox()
            v.box(0, 0, 0, ctx.W, ctx.D, 1, grid.mat("road-paved"))  # the old plate, paved
            v.box(0, 0, 1, 4, 4, 5, grid.mat("plaster"))
            v.anchor("door", ctx.W / 2, ctx.D, 1)
            return v

        recipe = {"build": legacy, "ground_z": 1}
        _, _, problems = model.build_id("chapel", "building", recipe, CONTENT)
        self.assertEqual(problems, [])
        ctx = model.outputs("chapel", "building", recipe, CONTENT)[0][2]
        v = model.build_grid(recipe, "building", None, ctx)
        self.assertEqual(sorted({k[2] for k in v.cells}), [0, 1, 2, 3])
        self.assertEqual(v.anchors["door"][2], 0)
        # The plate's paved cells became the ground map.
        self.assertEqual({k for row in model.ground_map(v, ctx) for k in row}, {"paved"})

    def test_a_water_model_keeps_its_deck_and_settles_its_land(self):
        recipe = {"build": None, "ground_z": 1}

        def pier(ctx):
            v = ctx.vox()
            v.box(0, 0, 0, ctx.W, ctx.land, 1, grid.mat("timber"))  # deck over the water rows
            v.box(0, 0, -8, 1, 1, 0, grid.mat("timber"))  # a pile
            v.box(2, 2, 1, 4, 4, 3, grid.mat("canvas"))  # a crate on the deck
            P.yard(v, 0, ctx.land, ctx.W, ctx.D, "dirt")
            v.box(2, ctx.land + 2, 1, 4, ctx.land + 4, 3, grid.mat("canvas"))  # a crate on the land
            return v

        recipe["build"] = pier
        ctx = model.outputs("fisher", "building", recipe, CONTENT)[0][2]
        v = model.build_grid(recipe, "building", None, ctx)
        self.assertIn((2, 2, 1), v.cells)  # on the deck: stays
        self.assertNotIn((2, 2, 3), v.cells)
        self.assertIn((2, ctx.land + 2, 0), v.cells)  # on the land: settled
        self.assertNotIn((2, ctx.land + 2, 2), v.cells)
        self.assertIn((0, 0, -8), v.cells)

    def test_a_floating_prop_is_a_problem_and_tie_floating_fixes_a_one_voxel_gap(self):
        def floating(ctx):
            v = ctx.vox()
            v.box(0, 0, 0, 4, 4, 2, grid.mat("plaster"))
            v.box(0, 0, 3, 2, 2, 4, grid.mat("timber"))  # one voxel above
            v.box(10, 10, 6, 12, 12, 8, grid.mat("iron"))  # far away
            return v

        _, _, problems = model.build_id("chapel", "building", {"build": floating}, CONTENT)
        self.assertEqual(sum("floating voxels" in p for p in problems), 2, problems)

        def tied(ctx):
            return P.tie_floating(floating(ctx), ground=0)

        _, _, problems = model.build_id("chapel", "building", {"build": tied}, CONTENT)
        self.assertEqual(sum("floating voxels" in p for p in problems), 1, problems)


if __name__ == "__main__":
    unittest.main()
