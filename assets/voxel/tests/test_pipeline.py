"""
Build rules of the voxel pipeline beyond single recipes: budgets fail the
build, a parallel build is byte-identical run to run, and the automatic
placeholders fit every footprint kind with its anchors (stdlib unittest).
"""

import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content as content_mod, glb, grid, model  # noqa: E402

CONTENT = content_mod.load()


def checkerboard(ctx):
    """A recipe far over any budget: every other voxel of the footprint, 8 layers high."""
    v = ctx.vox()
    m = grid.mat("plaster")
    for x in range(ctx.W):
        for y in range(ctx.D):
            for z in range(8):
                if (x + y + z) % 2 == 0:
                    v.set(x, y, z, m)
    return v


def block_checkerboard(ctx):
    """Every other 4 × 4 × 4 block: still a checkerboard after the lite level's 4× downsampling."""
    v = ctx.vox()
    m = grid.mat("plaster")
    f = config.LITE_DOWNSAMPLE
    for x in range(ctx.W):
        for y in range(ctx.D):
            for z in range(4 * f):
                if (x // f + y // f + z // f) % 2 == 0:
                    v.set(x, y, z, m)
    return v


class BudgetTest(unittest.TestCase):
    def test_a_model_over_its_budget_fails_the_build(self):
        for cid in ("chapel", "house_settlers", "wheat_field"):
            with self.subTest(cid=cid):
                kind = content_mod.kind_of(CONTENT, cid)
                _, _, problems = model.build_id(cid, kind, {"build": checkerboard}, CONTENT)
                self.assertTrue(any("triangles over the budget" in p for p in problems), problems)
                if kind == "building":
                    _, _, problems = model.build_id(cid, kind, {"build": block_checkerboard}, CONTENT)
                    self.assertTrue(any(".lite.glb" in p and "over the lite budget" in p for p in problems), problems)

    def test_budgets_scale_with_the_footprint_area_per_class(self):
        for cid, cls in (("chapel", "building"), ("house_settlers", "house"), ("wheat_field", "field"), ("trading_post", "building")):
            w, h = content_mod.footprint(CONTENT, cid)
            self.assertEqual(model.model_class(CONTENT, cid), cls)
            self.assertEqual(model.budget_of(cid, content_mod.kind_of(CONTENT, cid), CONTENT), config.BUDGET_PER_TILE[cls] * w * h)
        w, h = content_mod.footprint(CONTENT, "chapel")
        self.assertEqual(model.lite_budget_of("chapel", CONTENT), config.LITE_BUDGET_PER_TILE["building"] * w * h)
        self.assertEqual(model.budget_of("brig", "ship", CONTENT), config.BUDGET_SHIPS["brig"])
        self.assertEqual(model.budget_of("brig", "ship", CONTENT, ("attachment", "cargo")), config.BUDGET_SHIP_CARGO)
        self.assertEqual(model.budget_of("decor_tree_a", "decor", CONTENT), config.BUDGET_DECOR)
        self.assertEqual(model.budget_of("life_stage", "life", CONTENT), config.BUDGET_LIFE_STAGE)
        self.assertEqual(model.budget_of("life_stage_4", "life", CONTENT), config.BUDGET_LIFE_STAGE)
        self.assertEqual(model.budget_of("life_stage_scaffolding_8", "life", CONTENT), 2 * config.BUDGET_LIFE_STAGE)
        self.assertEqual(model.budget_of("life_cart", "life", CONTENT), config.BUDGET_LIFE)


class JitterClassTest(unittest.TestCase):
    def test_every_role_has_a_jitter_class_in_the_alpha_byte(self):
        from nsvoxel import export, jitter, palette

        roles, _ = palette.load()
        self.assertEqual(sorted(roles), sorted(jitter.ROLE_CLASS))
        for role, cls in jitter.ROLE_CLASS.items():
            self.assertTrue(0 <= cls <= 7, role)
            self.assertEqual(jitter.alpha_of(role), 255 - cls)
        v = grid.Vox(3, 1)
        v.set(0, 0, 0, grid.mat("stone"))
        v.set(1, 0, 0, grid.mat("plaster"))
        v.set(2, 0, 0, grid.mat("canvas", 1.0, "cloth"))
        tris, colors, ao_keys, sway = export.build_tris(v.cells, 1, 1, 1 / 8)
        data = glb.vertex_data(tris, {k: glb.color_bytes(c) for k, c in colors.items()}, ao_keys, sway)
        alphas = {c[3] for c in data[2]}
        self.assertIn(255 - jitter.STONE, alphas)
        self.assertIn(255 - jitter.PLASTER, alphas)
        # The cloth voxel sways: its alpha lies below the class codes.
        self.assertTrue(any(a <= jitter.SWAY_ALPHA_MAX for a in alphas))
        self.assertEqual(glb.sway_alpha(0.0), jitter.SWAY_ALPHA_MAX)


class DeterminismTest(unittest.TestCase):
    def test_two_parallel_builds_write_the_same_bytes(self):
        recipes = model.recipe_modules()
        chosen = [t for t in build.targets(CONTENT, recipes) if t[0] in (
            "house_settlers", "fisher", "trading_post", "brig", "wheat_field", "theatre", "grain_distillery", "decor_tree_a", "life_stage",
        )]
        self.assertEqual(len(chosen), 9)
        a, _, pa = build.build_outputs(4, chosen)
        b, _, pb = build.build_outputs(4, chosen)
        self.assertEqual((pa, pb), ([], []))
        self.assertEqual(sorted(a), sorted(b))
        for name in a:
            self.assertEqual(a[name], b[name], name)
        # Thumbnails for buildings, fields and ships only.
        self.assertIn("thumbs/fisher.png", a)
        self.assertIn("thumbs/brig.png", a)
        self.assertNotIn("thumbs/decor_tree_a.png", a)


class PlaceholderTest(unittest.TestCase):
    #: One ID per footprint kind: water rows with a boat, smoke, levels with berths, slipway, house variants, field, pasture module with animals, service.
    SAMPLES = ("fisher", "smelter", "trading_post", "shipyard", "house_settlers", "wheat_field", "pasture", "chapel", "warehouse")

    def test_every_footprint_kind_gets_a_placeholder_with_its_anchors_within_budget(self):
        for cid in self.SAMPLES:
            with self.subTest(cid=cid):
                kind = content_mod.kind_of(CONTENT, cid)
                recipe, placeholder = build.recipe_for(cid, kind, {})
                self.assertTrue(placeholder)
                files, entry, problems = model.build_id(cid, kind, recipe, CONTENT)
                self.assertEqual(problems, [])
                w, h = content_mod.footprint(CONTENT, cid)
                self.assertEqual(entry["footprint"], {"w": w, "h": h})
                for a in model.required_anchors(CONTENT, cid):
                    self.assertIn(a, entry["anchors"])
                self.assertIn("status", entry["anchors"])
                levels = content_mod.levels(CONTENT, cid)
                if levels:
                    self.assertEqual(sorted(entry["levels"]), [str(i) for i in range(1, levels + 1)])
                if kind == "building":
                    self.assertTrue(all(name.endswith(".glb") for name, *_ in files))
                    self.assertTrue(any(name.endswith(".lite.glb") for name, *_ in files))

    def test_ships_have_no_placeholder(self):
        recipe, placeholder = build.recipe_for("brig", "ship", {})
        self.assertIsNone(recipe)
        self.assertTrue(placeholder)

    def test_committed_placeholders_are_the_ids_without_a_recipe(self):
        recipes = model.recipe_modules()
        required = content_mod.required_ids(CONTENT)
        self.assertIn("grain_distillery", required)
        self.assertNotIn("grain_distillery", recipes)
        _, placeholder = build.recipe_for("grain_distillery", "building", recipes)
        self.assertTrue(placeholder)
        _, placeholder = build.recipe_for("fisher", "building", recipes)
        self.assertFalse(placeholder)


if __name__ == "__main__":
    unittest.main()
