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
        # The full model and its generated lite model.
        self.assertEqual(loader.calls, [True, True])
        doc, binary = glb.read(files[0][1])
        cols = {tuple(round(c * 255) for c in v[:3]) for v in glb.accessor_values(doc, binary, doc["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"])}
        plaster = tuple(round(c * 255) for c in ROLES["plaster"])
        dark = tuple(round(c * 255) for c in pipeline.ao_color(ROLES["plaster"], palette.load_shadows()["plaster"], 1.0, config.AO_LEVELS))
        self.assertIn(plaster, cols)
        self.assertIn(dark, cols)
        self.assertLess(sum(dark), sum(plaster))

    def test_thatch_keeps_its_chroma_in_shadow(self):
        def chroma(c):
            return max(c) - min(c)

        thatch = ROLES["thatch"]
        tone = palette.load_shadows()["thatch"]
        plain = pipeline.ao_color(thatch, tone, 0.86, config.AO_LEVELS)
        biased = pipeline.shadow_chroma("thatch", thatch, plain)
        # Darker colours gain chroma, keep their luminance and hue order; the palette colour is unchanged.
        self.assertGreater(chroma(biased), chroma(plain))
        self.assertAlmostEqual(pipeline.luminance(biased), pipeline.luminance(plain), places=6)
        self.assertEqual(sorted(range(3), key=lambda i: biased[i]), sorted(range(3), key=lambda i: plain[i]))
        self.assertEqual(pipeline.shadow_chroma("thatch", thatch, thatch), thatch)
        # Lighter bands and other roles are unchanged.
        light = tuple(c * 1.1 for c in thatch)
        self.assertEqual(pipeline.shadow_chroma("thatch", thatch, light), light)
        self.assertEqual(pipeline.shadow_chroma("plaster", ROLES["plaster"], plain), plain)

    def test_thatch_normals_tilt_toward_up(self):
        slope = ((0, 0, 0), (1, 0, 0), (0, 1, 1), "thatch", 1.0, "roof")
        wall = ((0, 0, 0), (1, 0, 0), (0, 0, 1), "plaster", 1.0, "wall")
        out = geometry.tilt_normals([slope, wall], {"thatch": 0.7})
        face = geometry.normal(*slope[:3])
        self.assertEqual(out[0][6], face)
        for n in out[0][7]:
            self.assertAlmostEqual(sum(c * c for c in n), 1.0)
            self.assertGreater(n[2], face[2])
        self.assertEqual(out[1], wall)
        self.assertIn("thatch", config.NORMAL_TILT)

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


class ShadingTest(unittest.TestCase):
    def test_crevices_keep_only_the_strongest_occlusion(self):
        tris = [((0, 0, z), (1, 0, z), (0, 1, z + 0.5), "plaster", 1.0, "a") for z in (0.0, 0.1, 0.2, 0.4)]
        mesh = pipeline.bake(geometry.Mesh(tris), {**HOUSE, "ao": "crevices"}, Loader())
        full = pipeline.bake(geometry.Mesh(tris), HOUSE, Loader())
        self.assertTrue(any(lvl > 0 for t in full.ao for lvl in t))
        cut = config.AO_CREVICE_CUT
        for a, b in zip(mesh.ao, full.ao):
            self.assertEqual(a, tuple(max(0, lvl - cut) for lvl in b))

    def test_smooth_shading_averages_normals_per_role_and_position(self):
        # Two faces of a ridge (same role) and one of another role at the same edge.
        tris = [
            ((0, 0, 0), (1, 0, 0), (0, 1, 1), "thatch", 1.0, "a"),
            ((1, 0, 0), (0, 0, 0), (0, -1, 1), "thatch", 1.0, "a"),
            ((0, 0, 0), (1, 0, 0), (0, 0, 1), "timber", 1.0, "b"),
        ]
        out = geometry.smooth_normals(tris)
        ridge = out[0][7][0]
        self.assertAlmostEqual(ridge[0], 0.0)
        self.assertAlmostEqual(ridge[1], 0.0, places=6)
        self.assertGreater(ridge[2], 0.99)
        self.assertEqual(out[2][7][0], out[2][6])
        positions, normals, _, _ = glb.vertex_data(out, {(r, s): (1, 1, 1, 1) for r in ("thatch", "timber") for s in (1.0,)})
        self.assertEqual(len(positions), 7)


if __name__ == "__main__":
    unittest.main()
