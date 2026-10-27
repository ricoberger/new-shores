import unittest

from helpers import CONTENT, KIT_FILES, LIVE_CONTENT, ROLES, SCHEMA, fake_loader
from nsassets import config, geometry, pipeline, recipes


class Decimating:
    """The fake kit loader plus a fake decimate that keeps the first ratio × n triangles."""

    def __init__(self):
        self.load = fake_loader()
        self.ratios = []

    def __call__(self, kit, rel, simplify):
        return self.load(kit, rel, simplify)

    def decimate(self, mesh, ratio):
        self.ratios.append(ratio)
        return geometry.Mesh(mesh.tris[: int(len(mesh) * ratio)])


def chapel(parts):
    return {"id": "chapel", "kind": "building", "parts": parts}


class LiteTest(unittest.TestCase):
    def test_lite_is_generated_for_buildings_only_and_leaves_out_full_parts(self):
        r = chapel([{"prim": "box", "size": [1.8, 1.8, 0.6], "role": "stone", "name": "nave"},
                    {"prim": "cylinder", "radius": 0.1, "height": 0.2, "segments": 32, "role": "brass", "lod": "full", "name": "bell"}])
        files, entry, errors = pipeline.build_recipe(r, CONTENT, ROLES, fake_loader())
        self.assertEqual(errors, [])
        self.assertEqual([f[0] for f in files], ["chapel.glb", "chapel.lite.glb"])
        self.assertEqual(entry["file"]["lite"]["triangles"], 12)
        field = {"id": "wheat_field", "kind": "field", "parts": [{"prim": "box", "size": [0.9, 0.9, 0.05], "role": "wheat"}]}
        files, _, errors = pipeline.build_recipe(field, CONTENT, ROLES, fake_loader())
        self.assertEqual((errors, [f[0] for f in files]), ([], ["wheat_field.glb"]))

    def test_decimation_steps_up_until_the_footprint_is_covered(self):
        # 408 small core triangles first, then 408 yard triangles (only they cover the footprint).
        yard = {"prim": "box", "size": [1.9, 1.9, 0.02], "role": "road-dirt", "name": "yard", "repeat": {"count": 34, "step": [0, 0, 0]}}
        core = {"prim": "box", "size": [0.5, 0.5, 0.5], "role": "stone", "name": "core", "repeat": {"count": 34, "step": [0, 0, 0]}}
        loader = Decimating()
        _, entry, errors = pipeline.build_recipe(chapel([core, yard]), CONTENT, ROLES, loader)
        self.assertEqual(errors, [])
        # Up to 50 % only core triangles survive (no coverage); 70 % reaches the yard.
        self.assertEqual(loader.ratios, list(config.LITE_RATIOS[:4]))
        self.assertEqual(entry["file"]["lite"]["triangles"], int(816 * 0.7))

    def test_the_lite_tier_can_be_switched_off(self):
        r = chapel([{"prim": "box", "size": [1.8, 1.8, 0.6], "role": "stone", "name": "nave"}])
        old = config.LITE_MODELS
        try:
            config.LITE_MODELS = False
            files, entry, errors = pipeline.build_recipe(r, CONTENT, ROLES, fake_loader())
        finally:
            config.LITE_MODELS = old
        self.assertEqual((errors, [f[0] for f in files]), ([], ["chapel.glb"]))
        self.assertNotIn("lite", entry["file"])

    def test_houses_aim_at_the_house_lite_target_first(self):
        ratios = pipeline.lite_ratios(1600, house=True)
        self.assertAlmostEqual(ratios[0], config.LITE_HOUSE_TRIS / 1600)
        self.assertAlmostEqual(ratios[1], config.LITE_HOUSE_TRIS * config.LITE_HOUSE_STEP / 1600)
        house_steps = ratios[: len(ratios) - len(config.LITE_RATIOS)]
        self.assertTrue(all(r < config.LITE_RATIOS[0] for r in house_steps))
        self.assertEqual(ratios[len(house_steps):], [max(r, config.LITE_MIN_TRIS / 1600) for r in config.LITE_RATIOS])
        self.assertEqual(pipeline.lite_ratios(1600), ratios[len(house_steps):])

    def test_small_models_are_not_decimated(self):
        loader = Decimating()
        pipeline.build_recipe(chapel([{"prim": "box", "size": [1.8, 1.8, 0.6], "role": "stone"}]), CONTENT, ROLES, loader)
        self.assertEqual(loader.ratios, [])


class KitBuildingTest(unittest.TestCase):
    def test_expands_to_the_kit_piece_turned_to_the_front(self):
        part = {"kit_building": "home_A", "rotation": [0, 0, 90], "roles": {"Atlas/team": "terracotta"}}
        out = recipes.expand_part(part)
        self.assertEqual(out["kit"], "kaykit_hexagon")
        self.assertEqual(out["file"], "Assets/gltf/buildings/blue/building_home_A_blue.gltf")
        self.assertEqual(out["rotation"], [0, 0, 270.0])
        self.assertEqual(out["name"], "home_A")
        self.assertNotIn("kit_building", out)
        self.assertEqual(part["rotation"], [0, 0, 90])

    def test_validation(self):
        files = dict(KIT_FILES)
        files[("kaykit_hexagon", "Assets/gltf/buildings/blue/building_home_A_blue.gltf")] = "0" * 64
        r = chapel([{"kit_building": "home_A", "scale": 1.1}])
        self.assertEqual(recipes.check_recipe(r, "recipes/chapel.json", SCHEMA, CONTENT, files, ROLES), [])
        errs = recipes.check_recipe(chapel([{"kit_building": "palace"}]), "recipes/chapel.json", SCHEMA, CONTENT, files, ROLES)
        self.assertTrue(any("unknown kit_building 'palace'" in e for e in errs), errs)
        errs = recipes.check_recipe(chapel([{"kit_building": "home_A", "prim": "box"}]), "recipes/chapel.json", SCHEMA, CONTENT, files, ROLES)
        self.assertTrue(any("kit_building replaces kit/file/prim" in e for e in errs), errs)
        # Not pinned yet: named like any kit file.
        errs = recipes.check_recipe(chapel([{"kit_building": "castle"}]), "recipes/chapel.json", SCHEMA, CONTENT, files, ROLES)
        self.assertTrue(any("building_castle_blue.gltf is not listed" in e for e in errs), errs)


class ExaggerateTest(unittest.TestCase):
    def test_scales_the_selection_about_its_bottom_centre(self):
        low = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), "Atlas/wood@1")
        top = ((0.0, 0.0, 1.0), (1.0, 0.0, 1.0), (0.0, 1.0, 1.5), "Atlas/team@1")
        out = pipeline.exaggerate([low, top], {"min": [-9, -9, 0.9], "max": [9, 9, 9], "scale": 2.0})
        self.assertEqual(out[0], low)
        # Pivot (0.5, 0.5, 1.0): x/y spread about the centre, z grows upward from the selection's base.
        self.assertEqual(out[1][:3], ((-0.5, -0.5, 1.0), (1.5, -0.5, 1.0), (-0.5, 1.5, 2.0)))
        same = pipeline.exaggerate([low], {"min": [5, 5, 5], "max": [6, 6, 6], "scale": 2.0})
        self.assertEqual(same, [low])


class DecorTest(unittest.TestCase):
    def test_decor_recipes_build_without_content_ids_or_lite(self):
        r = {"id": "decor_rock", "kind": "decor", "parts": [{"prim": "rock", "size": [0.2, 0.2, 0.15], "role": "mountain"}]}
        self.assertEqual(recipes.check_recipe(r, "recipes/decor_rock.json", SCHEMA, CONTENT, KIT_FILES, ROLES), [])
        files, entry, errors = pipeline.build_recipe(r, CONTENT, ROLES, fake_loader())
        self.assertEqual(errors, [])
        self.assertEqual([f[0] for f in files], ["decor_rock.glb"])
        self.assertEqual(entry["kind"], "decor")
        self.assertEqual(entry["file"]["budget"], config.BUDGET_DECOR)
        self.assertNotIn("footprint", entry)

    def test_decor_ids_need_the_prefix_and_no_content_options(self):
        r = {"id": "rock", "kind": "decor", "parts": [{"prim": "rock", "size": [0.2, 0.2, 0.15], "role": "mountain"}], "variants": [[], []]}
        errs = recipes.check_recipe(r, "recipes/rock.json", SCHEMA, CONTENT, KIT_FILES, ROLES)
        self.assertTrue(any("start with 'decor_'" in e for e in errs), errs)
        self.assertTrue(any("variants is not for decoration" in e for e in errs), errs)

    def test_manifest_lists_decor_apart_from_content_models(self):
        doc = pipeline.manifest({"decor_rock": {"kind": "decor", "file": {}}, "chapel": {"kind": "building"}}, "x", "5.2", [])
        import json as _json

        m = _json.loads(doc)
        self.assertEqual(sorted(m["decor"]), ["decor_rock"])
        self.assertEqual(sorted(m["models"]), ["chapel"])


class LifeTest(unittest.TestCase):
    def test_life_recipes_build_with_variants_and_anchors_without_lite(self):
        body = {"prim": "box", "size": [0.1, 0.1, 0.3], "role": "canvas"}
        r = {
            "id": "life_walker",
            "kind": "life",
            "parts": [body],
            "variants": [[{"prim": "box", "size": [0.12, 0.12, 0.05], "position": [0, 0, 0.3], "role": "thatch"}], []],
            "anchors": {"wheel_front": [0.0, 0.2, 0.1]},
        }
        self.assertEqual(recipes.check_recipe(r, "recipes/life_walker.json", SCHEMA, CONTENT, KIT_FILES, ROLES), [])
        files, entry, errors = pipeline.build_recipe(r, CONTENT, ROLES, fake_loader())
        self.assertEqual(errors, [])
        self.assertEqual([f[0] for f in files], ["life_walker.v0.glb", "life_walker.v1.glb"])
        self.assertEqual(entry["kind"], "life")
        self.assertEqual(entry["variants"][0]["budget"], config.BUDGET_LIFE)
        # Recipe space (z up, +y front) → glTF (y up, −z front).
        self.assertEqual(entry["anchors"], {"wheel_front": [0.0, 0.1, -0.2]})
        self.assertNotIn("footprint", entry)

    def test_life_ids_need_the_prefix_and_no_content_options(self):
        r = {"id": "walker", "kind": "life", "parts": [{"prim": "box", "size": [0.1, 0.1, 0.3], "role": "canvas"}], "levels": {"1": []}}
        errs = recipes.check_recipe(r, "recipes/walker.json", SCHEMA, CONTENT, KIT_FILES, ROLES)
        self.assertTrue(any("start with 'life_'" in e for e in errs), errs)
        self.assertTrue(any("levels is not for life-layer elements" in e for e in errs), errs)

    def test_construction_stages_take_the_stage_budget(self):
        r = {"id": "life_stage_a", "kind": "life", "parts": [{"prim": "box", "size": [1, 1, 0.3], "role": "timber"}]}
        _, entry, errors = pipeline.build_recipe(r, CONTENT, ROLES, fake_loader())
        self.assertEqual(errors, [])
        self.assertEqual(entry["file"]["budget"], config.BUDGET_LIFE_STAGE)

    def test_manifest_lists_life_apart_from_content_models(self):
        import json as _json

        m = _json.loads(pipeline.manifest({"life_cart": {"kind": "life", "file": {}}, "chapel": {"kind": "building"}}, "x", "5.2", []))
        self.assertEqual(sorted(m["life"]), ["life_cart"])
        self.assertEqual(sorted(m["models"]), ["chapel"])


class SmokeAnchorTest(unittest.TestCase):
    def test_producers_need_chimney_and_smoke_anchors(self):
        r = {"id": "sawmill", "kind": "building", "parts": [{"prim": "box", "size": [1.8, 1.8, 0.5], "role": "plaster"}]}
        errs = recipes.check_recipe(r, "recipes/sawmill.json", SCHEMA, CONTENT, KIT_FILES, ROLES)
        self.assertTrue(any("producers need anchors chimney, smoke" in e for e in errs), errs)
        r["anchors"] = {"chimney": [0, 0, 0.5]}
        errs = recipes.check_recipe(r, "recipes/sawmill.json", SCHEMA, CONTENT, KIT_FILES, ROLES)
        self.assertTrue(any("producers need anchors smoke" in e for e in errs), errs)
        r["anchors"]["smoke"] = [0, 0, 0.55]
        errs = recipes.check_recipe(r, "recipes/sawmill.json", SCHEMA, CONTENT, KIT_FILES, ROLES)
        self.assertTrue(any("needs life-layer anchors cart" in e for e in errs), errs)
        r["anchors"]["cart"] = [0.5, 0.9, 0]
        self.assertEqual(recipes.check_recipe(r, "recipes/sawmill.json", SCHEMA, CONTENT, KIT_FILES, ROLES), [])
        r["anchors"]["cart"] = [0.5, 1.4, 0]
        errs = recipes.check_recipe(r, "recipes/sawmill.json", SCHEMA, CONTENT, KIT_FILES, ROLES)
        self.assertTrue(any("anchor cart [0.5, 1.4] lies outside the 2×2 footprint" in e for e in errs), errs)

    def test_life_anchors_follow_the_content(self):
        from nsassets import content as content_mod

        self.assertEqual(content_mod.life_anchors(CONTENT, "sawmill"), ["cart"])
        self.assertEqual(content_mod.life_anchors(CONTENT, "fisher"), ["cart", "boat"])
        self.assertEqual(content_mod.life_anchors(CONTENT, "warehouse"), ["cart"])
        self.assertEqual(content_mod.life_anchors(CONTENT, "trading_post"), ["cart", "berth_1", "berth_2", "berth_3", "berth_4"])
        self.assertEqual(content_mod.life_anchors(CONTENT, "pasture"), ["gate", "sheep_1", "sheep_2", "sheep_3"])
        self.assertEqual(content_mod.life_anchors(CONTENT, "house_settlers"), [])
        self.assertEqual(content_mod.life_anchors(CONTENT, "wheat_field"), [])
        self.assertEqual(content_mod.life_anchors(CONTENT, "shipyard"), ["slip"])
        # D-056 modules (planned until the content defines them): a gate and their animals.
        c = content_mod.merge_planned(content_mod.load(config.CONTENT_DIR, planned_dir=None), [
            {"id": "cattle_pasture", "kind": "module", "tier": 2, "footprint": [4, 7], "water_tiles": 0, "slot": None},
            {"id": "pig_pen", "kind": "module", "tier": 2, "footprint": [3, 4], "water_tiles": 0, "slot": None},
            {"id": "meadow", "kind": "field", "tier": 2, "footprint": [1, 1], "water_tiles": 0, "slot": None},
        ])
        self.assertEqual(content_mod.life_anchors(c, "cattle_pasture"), ["gate", "cattle_1", "cattle_2", "cattle_3"])
        self.assertEqual(content_mod.life_anchors(c, "pig_pen"), ["gate", "pig_1", "pig_2", "pig_3", "pig_4"])
        self.assertEqual(content_mod.life_anchors(c, "meadow"), [])
        # By field ID first: content may give the modules the field type "pasture".
        c["buildings"]["pig_pen"]["field"] = {"type": "pasture"}
        self.assertEqual(content_mod.life_anchors(c, "pig_pen"), ["gate", "pig_1", "pig_2", "pig_3", "pig_4"])

    def test_declared_anchors_are_exported_to_the_manifest(self):
        r = {"id": "sawmill", "kind": "building", "parts": [{"prim": "box", "size": [1.8, 1.8, 0.5], "role": "plaster"}],
             "anchors": {"chimney": [0, 0, 0.5], "smoke": [0, 0, 0.55], "cart": [0.5, 0.9, 0]}}
        _, entry, errors = pipeline.build_recipe(r, CONTENT, ROLES, fake_loader())
        self.assertEqual(errors, [])
        self.assertEqual(sorted(entry["anchors"]), ["cart", "chimney", "door", "smoke", "status"])
        self.assertEqual(entry["anchors"]["cart"], [0.5, 0.0, -0.9])

    def test_every_committed_producer_recipe_has_them(self):
        import json
        import os

        from nsassets import content as content_mod

        for cid in recipe_ids(LIVE_CONTENT):
            if not content_mod.needs_smoke(LIVE_CONTENT, cid):
                continue
            with open(os.path.join(config.RECIPES_DIR, f"{cid}.json"), encoding="utf-8") as f:
                anchors = json.load(f).get("anchors", {})
            self.assertIn("chimney", anchors, cid)
            self.assertIn("smoke", anchors, cid)

    def test_every_committed_recipe_has_its_life_anchors_inside_the_footprint(self):
        import json
        import os

        from nsassets import content as content_mod

        for cid in recipe_ids(LIVE_CONTENT):
            if content_mod.kind_of(LIVE_CONTENT, cid) not in ("building", "field"):
                continue
            with open(os.path.join(config.RECIPES_DIR, f"{cid}.json"), encoding="utf-8") as f:
                anchors = json.load(f).get("anchors", {})
            for k in content_mod.life_anchors(LIVE_CONTENT, cid):
                self.assertIn(k, anchors, cid)
            w, h = content_mod.footprint(LIVE_CONTENT, cid)
            for k, v in anchors.items():
                self.assertLessEqual(abs(v[0]), w / 2, f"{cid} {k}")
                self.assertLessEqual(abs(v[1]), h / 2, f"{cid} {k}")


def recipe_ids(c):
    """Required IDs with a committed recipe: every content ID, planned IDs once their recipe exists."""
    import os

    from nsassets import content as content_mod

    return [
        cid
        for cid in content_mod.required_ids(c)
        if not content_mod.is_planned(c, cid) or os.path.isfile(os.path.join(config.RECIPES_DIR, f"{cid}.json"))
    ]


class SwayMaskTest(unittest.TestCase):
    def alphas(self, recipe):
        import struct

        from nsassets import glb

        files, _, errors = pipeline.build_recipe(recipe, CONTENT, ROLES, fake_loader())
        self.assertEqual(errors, [])
        doc, blob = glb.read(files[0][1])
        acc = doc["accessors"][doc["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"]]
        view = doc["bufferViews"][acc["bufferView"]]
        return [struct.unpack_from("<4B", blob, view["byteOffset"] + 4 * i)[3] for i in range(acc["count"])]

    def test_cloth_and_flags_sway_with_a_belly_profile_the_rest_is_rigid(self):
        r = {
            "id": "sailmaker",
            "kind": "building",
            "anchors": {"chimney": [0, 0, 1], "smoke": [0, 0, 1.05]},
            "parts": [
                {"prim": "box", "size": [1.8, 1.8, 0.5], "role": "plaster"},
                {"name": "spread sail", "prim": "sail", "width": 0.6, "height": 0.6, "position": [0, 0, 0.6], "role": "canvas"},
                {"name": "flag pole", "prim": "box", "size": [0.05, 0.05, 1.0], "role": "timber"},
                {"name": "flag", "prim": "box", "size": [0.3, 0.02, 0.2], "position": [0.15, 0, 0.8], "role": "dye-blue"},
            ],
        }
        a = self.alphas(r)
        self.assertIn(255, a)
        swaying = [x for x in a if x < 255]
        self.assertTrue(swaying, a)
        # 0.3 at the edges (alpha 255 − 77), 1 at mid-height (alpha 0) at most.
        self.assertGreaterEqual(min(swaying), 0)
        self.assertLessEqual(max(swaying), 255 - 76)

    def test_no_cloth_no_mask(self):
        r = {"id": "decor_rock", "kind": "decor", "parts": [{"prim": "rock", "size": [0.2, 0.2, 0.15], "role": "mountain"}]}
        self.assertEqual(set(self.alphas(r)), {255})

    def test_ship_sails_are_the_kit_hull_canvas(self):
        hull = {"prim": "box", "size": [1, 1, 1], "role": "canvas"}
        r = {"id": "x", "kind": "ship"}
        self.assertEqual(pipeline._sways(r, {"kit": "k", "file": "a.gltf"}), "canvas")
        self.assertIsNone(pipeline._sways(r, hull))
        self.assertEqual(pipeline._sways({"kind": "building"}, {"kit": "k", "file": "x/flag_blue.gltf"}), "all")
        self.assertIsNone(pipeline._sways({"kind": "building"}, {"name": "flag pole", "prim": "box"}))


if __name__ == "__main__":
    unittest.main()
