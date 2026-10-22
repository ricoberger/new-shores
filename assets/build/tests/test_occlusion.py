import unittest

from helpers import CONTENT, ROLES, fake_loader
from nsassets import config, geometry, glb, palette, pipeline

HOUSE = {"id": "chapel", "kind": "building", "parts": [
    {"prim": "box", "size": [1.8, 1.8, 0.6], "role": "plaster", "open": ["bottom"], "name": "body"},
    {"prim": "wedge", "size": [1.9, 1.9, 0.7], "position": [0, 0, 0.6], "role": "thatch", "shade": 0.9, "name": "roof"},
]}


class Loader:
    """The fake kit loader plus a fake occlusion: corners below z = 0.3 are fully occluded, others open."""

    def __init__(self):
        self.load = fake_loader()
        self.calls = []

    def __call__(self, kit, rel, simplify):
        return self.load(kit, rel, simplify)

    def occlusion(self, tris, ground):
        self.calls.append(ground)
        return [tuple(config.AO_LEVELS if p[2] < 0.3 else 0 for p in t[:3]) for t in tris]


class OcclusionTest(unittest.TestCase):
    def test_every_role_has_a_shadow_tone_darker_than_the_role(self):
        tones = palette.load_shadows()
        self.assertEqual(set(tones), set(ROLES))
        for role, rgb in ROLES.items():
            self.assertLess(sum(tones[role]), sum(rgb), role)

    def test_hemisphere_is_fixed_and_upward(self):
        dirs = geometry.hemisphere(config.AO_RAYS)
        self.assertEqual(dirs, geometry.hemisphere(config.AO_RAYS))
        for d in dirs:
            self.assertGreater(d[2], 0)
            self.assertAlmostEqual(sum(c * c for c in d), 1.0)

    def test_baked_levels_blend_corners_toward_the_shadow_tone(self):
        loader = Loader()
        files, entry, errors = pipeline.build_recipe(HOUSE, CONTENT, ROLES, loader)
        self.assertEqual(errors, [])
        self.assertEqual(loader.calls, [True])
        doc, binary = glb.read(files[0][1])
        cols = {tuple(round(c * 255) for c in v[:3]) for v in glb.accessor_values(doc, binary, doc["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"])}
        plaster = tuple(round(c * 255) for c in ROLES["plaster"])
        dark = tuple(round(c * 255) for c in pipeline.ao_color(ROLES["plaster"], palette.load_shadows()["plaster"], 1.0, config.AO_LEVELS))
        self.assertIn(plaster, cols)
        self.assertIn(dark, cols)
        self.assertLess(sum(dark), sum(plaster))

    def test_ships_are_baked_without_the_ground_plane(self):
        loader = Loader()
        sloop = {"id": "sloop", "kind": "ship", "ship": {"length_tiles": 2.0, "masts": 1, "sail_scale": 1.0},
                 "parts": [{"prim": "box", "size": [2.0, 0.5, 0.3], "role": "timber"}]}
        _, _, errors = pipeline.build_recipe(sloop, CONTENT, ROLES, loader)
        self.assertEqual(errors, [])
        self.assertEqual(loader.calls, [False])

    def test_bevel_needs_the_blender_build(self):
        r = {"id": "chapel", "kind": "building", "parts": [dict(HOUSE["parts"][0], bevel=0.04)]}
        _, _, errors = pipeline.build_recipe(r, CONTENT, ROLES, fake_loader())
        self.assertTrue(any("bevel needs the Blender build" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
