import unittest

from helpers import CONTENT, KIT_FILES, ROLES, SCHEMA, fake_loader
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
        field = {"id": "pasture", "kind": "field", "parts": [{"prim": "box", "size": [0.9, 0.9, 0.05], "role": "pasture"}]}
        files, _, errors = pipeline.build_recipe(field, CONTENT, ROLES, fake_loader())
        self.assertEqual((errors, [f[0] for f in files]), ([], ["pasture.glb"]))

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


if __name__ == "__main__":
    unittest.main()


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
