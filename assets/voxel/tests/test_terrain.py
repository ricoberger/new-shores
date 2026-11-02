"""V7: buildings stand on the terrain (no grass plate); hard yards are one-voxel plates; floating props are a build problem."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nsvoxel import content as content_mod, grid, model, parts as P  # noqa: E402

CONTENT = content_mod.load()


class TerrainTest(unittest.TestCase):
    def test_a_grass_yard_lays_nothing_and_a_turf_yard_the_old_plate(self):
        v = grid.Vox(16, 16)
        P.yard(v, 0, 0, 16, 16, "grass")
        self.assertEqual(v.cells, {})
        P.yard(v, 0, 0, 16, 16, "turf")
        self.assertEqual({k[2] for k in v.cells}, {0})
        self.assertEqual(len(v.cells), 256)

    def test_hard_yards_are_one_voxel_plates_and_dirt_is_a_blob(self):
        for kind in ("paved", "sand", "planks"):
            v = grid.Vox(16, 16)
            P.yard(v, 0, 0, 16, 16, kind)
            self.assertEqual((len(v.cells), {k[2] for k in v.cells}), (256, {0}), kind)
        v = grid.Vox(40, 40)
        P.yard(v, 0, 0, 40, 40, "dirt", seed=3)
        self.assertTrue(0.5 * 1600 < len(v.cells) < 1600)
        v = grid.Vox(40, 40)
        P.yard(v, 0, 0, 40, 40, "dirt", seed=3, blob=False)
        self.assertEqual(len(v.cells), 1600)

    def test_the_build_lowers_a_building_onto_the_terrain(self):
        def stand(ctx):
            v = ctx.vox()
            P.yard(v, 0, 0, 4, 4, "paved")
            v.box(0, 0, 1, 4, 4, 5, grid.mat("plaster"))
            v.anchor("door", ctx.W / 2, ctx.D, 1)
            return v

        _, _, problems = model.build_id("chapel", "building", {"build": stand}, CONTENT)
        self.assertEqual(problems, [])
        ctx = list(model.outputs("chapel", "building", {"build": stand}, CONTENT))[0][2]
        v = model.build_grid({"build": stand}, "building", None, ctx)
        self.assertEqual(sorted({k[2] for k in v.cells}), [0, 1, 2, 3])
        self.assertEqual(v.anchors["door"][2], 0)

    def test_a_floating_prop_is_a_problem_and_tie_floating_fixes_a_one_voxel_gap(self):
        def floating(ctx):
            v = ctx.vox()
            v.box(0, 0, 1, 4, 4, 3, grid.mat("plaster"))
            v.box(0, 0, 4, 2, 2, 5, grid.mat("timber"))  # one voxel above
            v.box(10, 10, 6, 12, 12, 8, grid.mat("iron"))  # far away
            return v

        _, _, problems = model.build_id("chapel", "building", {"build": floating}, CONTENT)
        self.assertEqual(sum("floating voxels" in p for p in problems), 2, problems)

        def tied(ctx):
            return P.tie_floating(floating(ctx))

        _, _, problems = model.build_id("chapel", "building", {"build": tied}, CONTENT)
        self.assertEqual(sum("floating voxels" in p for p in problems), 1, problems)


if __name__ == "__main__":
    unittest.main()
