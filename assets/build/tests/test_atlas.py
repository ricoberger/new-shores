import unittest

from helpers import CONTENT, KIT_FILES, ROLES, SCHEMA
from nsassets import atlas, config, geometry, pipeline, recipes

HEX = config.KIT_ATLAS_CELLS["kaykit_hexagon"]


def uv(col, row, frac, grid=(8, 4)):
    """A degenerate UV triangle at (column, row, gradient fraction) of a grid (Blender v: 0 at the bottom)."""
    u = (col + 0.5) / grid[0]
    v = 1.0 - (row + frac) / grid[1]
    return [(u, v)] * 3


def kaykit_loader(materials):
    """A kit loader without Blender: one 1-unit cube per material (12 triangles each)."""

    def load(kit, rel, simplify):
        out = []
        for k, m in enumerate(materials):
            cube = geometry.transformed(geometry.box((1.0, 1.0, 1.0)), geometry.translation((k * 2.0, 0.0, 0.0)))
            out += [(a, b, c, m) for a, b, c in cube]
        return out

    return load


class AtlasTest(unittest.TestCase):
    def test_classify_by_cell_and_gradient_band(self):
        self.assertEqual(atlas.classify(HEX, uv(6, 0, 0.1)), "Atlas/wood@0")
        self.assertEqual(atlas.classify(HEX, uv(6, 0, 0.5)), "Atlas/wood@1")
        self.assertEqual(atlas.classify(HEX, uv(6, 0, 0.9)), "Atlas/wood@2")
        self.assertEqual(atlas.classify(HEX, uv(1, 0, 0.5)), "Atlas/white@1")
        # Every team colour cell is the same swatch (blue/red/yellow/green files differ only there).
        self.assertEqual({atlas.classify(HEX, uv(c, 3, 0.5)) for c in range(4)}, {"Atlas/team@1"})

    def test_split_and_swatch(self):
        self.assertEqual(atlas.split("Atlas/wood@2"), ("Atlas/wood", 2))
        self.assertEqual(atlas.split("MI_Plaster"), ("MI_Plaster", None))
        self.assertEqual(atlas.swatch(HEX, "Atlas/wood"), ("timber", 1.0))
        self.assertIsNone(atlas.swatch(HEX, "Atlas/nope"))
        self.assertIn("team", atlas.names(HEX))

    def test_shared_swatch_names_agree(self):
        for spec in config.KIT_ATLAS_CELLS.values():
            seen = {}
            for name, role, shade in list(spec["cells"].values()) + [spec["default"]]:
                self.assertEqual(seen.setdefault(name, (role, shade)), (role, shade), name)
                self.assertIn(role, ROLES, name)

    def test_kit_role_defaults_bands_overrides_and_no_clamp(self):
        part = {}
        self.assertEqual(pipeline.kit_role("kaykit_hexagon", "Atlas/wood@1", part, ROLES), ("timber", 1.0))
        self.assertEqual(pipeline.kit_role("kaykit_hexagon", "Atlas/wood@2", part, ROLES), ("timber", 0.86))
        self.assertEqual(pipeline.kit_role("kaykit_hexagon", "Atlas/wood@0", {"shade": 0.9}, ROLES), ("timber", 0.99))
        # Recipe override: by swatch, by band (first), with a shade.
        part = {"roles": {"Atlas/team": "terracotta", "Atlas/team@0": {"role": "slate", "shade": 0.9}}}
        self.assertEqual(pipeline.kit_role("kaykit_hexagon", "Atlas/team@1", part, ROLES), ("terracotta", 1.0))
        self.assertEqual(pipeline.kit_role("kaykit_hexagon", "Atlas/team@0", part, ROLES), ("slate", 0.99))
        # A light band on a light role is capped so that no channel clamps.
        role, shade = pipeline.kit_role("kaykit_hexagon", "Atlas/white@0", {"roles": {"Atlas/white": "canvas"}}, ROLES)
        self.assertEqual(role, "canvas")
        self.assertLess(shade, 1.1)
        self.assertLessEqual(max(ROLES["canvas"]) * shade, 1.0)

    def test_kaykit_piece_builds_with_scale_roles_and_drop(self):
        loader = kaykit_loader(["Atlas/white@1", "Atlas/team@0", "Atlas/stone@2"])
        r = {"id": "chapel", "kind": "building", "parts": [
            {"kit": "kaykit_hexagon", "file": "x.gltf", "position": [-0.6, 0, 0], "scale": 0.3, "roles": {"Atlas/team": "terracotta"}, "drop": ["Atlas/stone"], "name": "home"},
            {"prim": "box", "size": [1.8, 1.8, 0.2], "role": "stone", "name": "yard"},
        ]}
        files, entry, errors = pipeline.build_recipe(r, CONTENT, ROLES, loader)
        self.assertEqual(errors, [])
        home = [t for t in files[0][2].tris if t[5].endswith("'home'")]
        self.assertEqual(len(home), 24)
        self.assertEqual({(t[3], t[4]) for t in home}, {("plaster", 1.0), ("terracotta", 1.1)})
        xs = [p[0] for t in home if t[3] == "plaster" for p in t[:3]]
        self.assertAlmostEqual(max(xs) - min(xs), config.KIT_SCALE["kaykit_hexagon"] * 0.3)

    def test_recipe_validation_names_unknown_swatches(self):
        files = dict(KIT_FILES)
        files[("kaykit_hexagon", "Assets/gltf/x.gltf")] = "0" * 64
        part = {"kit": "kaykit_hexagon", "file": "Assets/gltf/x.gltf", "roles": {"Atlas/team": {"role": "terracotta", "shade": 0.9}, "Atlas/wood@2": "timber"}, "drop": ["Atlas/stone"]}
        r = {"id": "chapel", "kind": "building", "parts": [part]}
        self.assertEqual(recipes.check_recipe(r, "recipes/chapel.json", SCHEMA, CONTENT, files, ROLES), [])
        part["roles"] = {"Atlas/roof": "terracotta", "Atlas/wood@3": "timber"}
        part["drop"] = ["MI_Plaster"]
        errs = recipes.check_recipe(r, "recipes/chapel.json", SCHEMA, CONTENT, files, ROLES)
        self.assertEqual(len(errs), 3, errs)
        self.assertTrue(all("is not a swatch of kit kaykit_hexagon" in e for e in errs), errs)
        part["roles"] = {"Atlas/team": {"role": "purple"}}
        part["drop"] = []
        errs = recipes.check_recipe(r, "recipes/chapel.json", SCHEMA, CONTENT, files, ROLES)
        self.assertTrue(any("unknown role 'purple'" in e for e in errs), errs)


if __name__ == "__main__":
    unittest.main()
