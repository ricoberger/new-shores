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
            "house_settlers", "fisher", "trading_post", "brig", "wheat_field", "playhouse", "grain_distillery", "decor_tree_a", "life_stage",
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


class WaterAnchorsTest(unittest.TestCase):
    def test_water_rows_and_legacy_water_tiles_require_boat_anchors(self):
        cases = (
            ("absent", {}, False),
            ("legacy", {"water_tiles": 2}, True),
            ("legacy_zero", {"water_tiles": 0}, False),
            ("range", {"water_rows": {"min": 2, "max": 3}}, True),
            ("zero_min", {"water_rows": {"min": 0, "max": 1}}, True),
            ("zero_max", {"water_rows": {"min": 0, "max": 0}}, False),
            ("range_wins", {"water_rows": {"min": 0, "max": 1}, "water_tiles": 0}, True),
            ("zero_range_wins", {"water_rows": {"min": 0, "max": 0}, "water_tiles": 2}, False),
        )
        for name, water, boat in cases:
            for producer in (True, False):
                with self.subTest(case=name, producer=producer):
                    b = dict(water)
                    if producer:
                        b["recipe"] = {}
                    definitions = {"buildings": {"test": b}, "ships": {}}
                    expected = ["cart"] if producer else []
                    if producer and boat:
                        expected.append("boat")
                    self.assertEqual(content_mod.life_anchors(definitions, "test"), expected)
                    self.assertEqual(model.required_anchors(definitions, "test"), expected)


def solid_tile_high(ctx):
    """The whole footprint one tile high, at the recipe's density (ctx.vpt voxels per tile)."""
    v = ctx.vox()
    m = grid.mat("plaster")
    for x in range(ctx.W):
        for y in range(ctx.D):
            for z in range(ctx.vpt):
                v.set(x, y, z, m)
    v.anchors["door"] = (ctx.W / 2, ctx.D, 0)
    return v


class VoxelsPerTileTest(unittest.TestCase):
    """V7: a recipe may declare VOXELS_PER_TILE (8, 12 or 16); the output stays in tile units, the lite at 2 per tile."""

    def test_a_recipe_at_16_round_trips_in_tile_units(self):
        w, h = content_mod.footprint(CONTENT, "chapel")
        for vpt in config.ALLOWED_VOXELS_PER_TILE:
            with self.subTest(vpt=vpt):
                files, entry, problems = model.build_id("chapel", "building", {"build": solid_tile_high, "scale": vpt}, CONTENT)
                self.assertEqual(problems, [])
                self.assertEqual(entry["voxels_per_tile"], vpt)
                # The grid is the footprint at vpt voxels per tile.
                v = files[0][3]
                self.assertEqual((v.w, v.d), (w * vpt, h * vpt))
                # Bounds in tiles (glTF: x, y up, z), whatever the density: a w × 1 × h box at the origin.
                expected = {"min": [-w / 2, 0.0, -h / 2], "max": [w / 2, 1.0, h / 2]}
                self.assertEqual(entry["bounds"], expected)
                self.assertEqual(entry["file"]["bounds"], expected)
                self.assertEqual(entry["file"]["lite"]["bounds"], expected)
                # A box is 10 triangles at any density (greedy quads, no face toward the ground); the GLB's node scale is one voxel.
                self.assertEqual(entry["file"]["triangles"], 10)
                self.assertEqual(entry["file"]["lite"]["triangles"], 10)
                doc, _ = glb.read(files[0][1])
                self.assertAlmostEqual(glb.node_scale(doc), 1 / vpt, places=6)
                lite = next(f for f in files if f[0].endswith(".lite.glb"))
                doc, _ = glb.read(lite[1])
                self.assertAlmostEqual(glb.node_scale(doc), 1 / config.LITE_VOXELS_PER_TILE, places=6)
                # The door anchor (front centre, +y in recipe space: glTF −z) in tiles.
                self.assertEqual(entry["anchors"]["door"], [0.0, 0.0, -h / 2])
                # Budgets are per footprint tile, not per voxel.
                self.assertEqual(entry["file"]["budget"], config.BUDGET_PER_TILE["building"] * w * h)

    def test_the_lite_level_is_two_voxels_per_tile_at_every_density(self):
        for vpt in config.ALLOWED_VOXELS_PER_TILE:
            self.assertEqual(vpt // model.lite_factor(vpt), config.LITE_VOXELS_PER_TILE)
        self.assertEqual(model.lite_factor(config.VOXELS_PER_TILE), config.LITE_DOWNSAMPLE)

    def test_a_density_outside_the_allowed_list_fails_the_build(self):
        _, _, problems = model.build_id("chapel", "building", {"build": solid_tile_high, "scale": 10}, CONTENT)
        self.assertTrue(any("10 voxels per tile" in p for p in problems), problems)

    def test_recipe_modules_read_voxels_per_tile(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "fine.py"), "w", encoding="utf-8") as f:
                f.write("VOXELS_PER_TILE = 16\n\ndef build(ctx):\n    return ctx.vox()\n")
            with open(os.path.join(d, "plain.py"), "w", encoding="utf-8") as f:
                f.write("def build(ctx):\n    return ctx.vox()\n")
            recipes = model.recipe_modules(d)
        self.assertEqual(recipes["fine"]["scale"], 16)
        self.assertEqual(recipes["plain"]["scale"], config.VOXELS_PER_TILE)

    def test_every_committed_model_entry_carries_its_density(self):
        import json

        with open(os.path.join(config.MODELS_DIR, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        recipes = model.recipe_modules()
        for cid, entry in manifest["models"].items():
            want = recipes[cid].get("scale", config.VOXELS_PER_TILE) if cid in recipes else config.VOXELS_PER_TILE
            self.assertEqual(entry["voxels_per_tile"], want, cid)
            if entry["kind"] != "ship":
                self.assertIn(entry["voxels_per_tile"], config.ALLOWED_VOXELS_PER_TILE, cid)


class ShipLiteTest(unittest.TestCase):
    """V7: every ship has a lite model for the far LOD — hull, masts and sails at 5 voxels per tile, the same length and anchors."""

    def test_every_ship_has_a_lite_model_within_its_budget_and_the_full_length(self):
        recipes = model.recipe_modules()
        for cid in config.MODEL_SHIPS:
            with self.subTest(cid=cid):
                files, entry, problems = model.build_id(cid, "ship", recipes[cid], CONTENT)
                self.assertEqual(problems, [])
                lite = entry["file"]["lite"]
                self.assertTrue(lite["path"].endswith(".lite.glb"))
                self.assertEqual(lite["budget"], config.LITE_BUDGET_SHIPS[cid])
                self.assertLessEqual(lite["triangles"], lite["budget"])
                self.assertLess(lite["triangles"], entry["file"]["triangles"] / 5)
                # Hull length at the waterline (glTF x) within one lite voxel of the full model's, bowsprit included.
                vox = config.SHIP_LITE_DOWNSAMPLE / recipes[cid]["scale"]
                full = entry["file"]["bounds"]
                for i in (0, 2):
                    self.assertAlmostEqual(lite["bounds"]["min"][i], full["min"][i], delta=vox + 1e-6)
                    self.assertAlmostEqual(lite["bounds"]["max"][i], full["max"][i], delta=2 * vox + 1e-6)
                # Masts and sails rise well above the hull (a silhouette, not a hull only).
                self.assertGreater(lite["bounds"]["max"][1], 0.6 * full["max"][1])
                self.assertLessEqual(lite["bounds"]["min"][1], 0.0)
                # The entry's anchors (wake, status) serve both files; the cargo attachment has no lite file.
                self.assertIn("wake", entry["anchors"])
                self.assertNotIn("lite", entry["attachments"]["cargo"])
                # The lite grid: sails (sway group sail), timber and the hull's trim band.
                grid_ = recipes[cid]["lite"](files[0][4])
                roles = {m[0] for m in grid_.cells.values()}
                self.assertIn("canvas", roles)
                self.assertIn("timber", roles)
                self.assertIn("sail", {m[2] for m in grid_.cells.values() if len(m) > 2})

    def test_the_wake_width_is_the_stern_beam_or_declared(self):
        recipes = model.recipe_modules()
        for cid, half in (("sloop", 8), ("brig", 10), ("galleon", 12)):
            _, entry, _ = model.build_id(cid, "ship", recipes[cid], CONTENT)
            # The stern transom is one voxel narrower than the half-beam to each side (_ships.half_beam).
            self.assertAlmostEqual(entry["ship"]["wake_width"], 2 * (half - 1) / recipes[cid]["scale"], places=6)
            self.assertLess(entry["ship"]["wake_width"], 2 * entry["bounds"]["max"][2] + 1e-6)
        declared = dict(recipes["sloop"], ship=dict(recipes["sloop"]["ship"], wake_width=0.5))
        _, entry, _ = model.build_id("sloop", "ship", declared, CONTENT)
        self.assertEqual(entry["ship"]["wake_width"], 0.5)

    def test_a_lite_ship_over_its_budget_fails_the_build(self):
        recipes = model.recipe_modules()

        def dense(ctx):
            v = ctx.vox(0, 0)
            for x in range(-20, 20):
                for y in range(-6, 6):
                    for z in range(0, 8):
                        if (x + y + z) % 2 == 0:
                            v.set(x, y, z, grid.mat("timber"))
            return v

        _, _, problems = model.build_id("sloop", "ship", dict(recipes["sloop"], lite=dense), CONTENT)
        self.assertTrue(any(".lite.glb" in p and "over the lite budget" in p for p in problems), problems)


class SheetTurnTest(unittest.TestCase):
    """make model-sheet ROTATION=n: the sheet's camera turns by quarter turns (2: the backs, V7 step 5)."""

    def test_a_half_turn_shows_another_view_and_a_full_turn_the_same(self):
        import tempfile

        build._init()
        with tempfile.TemporaryDirectory() as d:
            out = {}
            for turn in (0, 2, 4):
                path = os.path.join(d, f"t{turn}.png")
                build.write_sheet(path, ["well"] if "well" in build._RECIPES else ["sloop"], cell=48, turn=turn)
                with open(path, "rb") as f:
                    out[turn] = f.read()
            self.assertNotEqual(out[0], out[2])
            self.assertEqual(out[0], out[4])
        self.assertEqual(build.parse(["--only", "chapel", "--sheet", "x.png", "--turn", "2"]).turn, 2)


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
        # A required building without a recipe gets the placeholder (any such ID; none once every tier is authored).
        for cid in sorted(c for c in required if c not in recipes and content_mod.kind_of(CONTENT, c) == "building")[:1]:
            _, placeholder = build.recipe_for(cid, "building", recipes)
            self.assertTrue(placeholder, cid)
        for cid in ("fisher", "grain_distillery"):
            _, placeholder = build.recipe_for(cid, "building", recipes)
            self.assertFalse(placeholder, cid)


if __name__ == "__main__":
    unittest.main()
