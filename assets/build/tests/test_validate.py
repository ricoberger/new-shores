import unittest

from helpers import CONTENT, ROLES, fake_loader
from nsassets import geometry, pipeline, validate


def mesh_of(parts, rid="test"):
    m = geometry.Mesh()
    for i, p in enumerate(parts):
        pm, _, _ = pipeline.part_mesh(rid, "parts", i, p, fake_loader())
        m.extend(pm)
    return m


class FootprintTest(unittest.TestCase):
    def test_inside_the_band_passes(self):
        m = mesh_of([{"prim": "box", "size": [1.8, 1.6, 0.5], "role": "plaster"}])
        self.assertEqual(validate.footprint_fit(m, 2, 2), [])

    def test_too_big_reports_measured_and_allowed_values_and_the_part(self):
        m = mesh_of([{"prim": "box", "size": [1.8, 1.8, 0.5], "role": "plaster", "name": "body"},
                     {"prim": "box", "size": [0.2, 0.2, 0.2], "position": [1.35, 0, 0], "role": "timber", "name": "crate"}])
        errs = validate.footprint_fit(m, 2, 2)
        self.assertEqual(len(errs), 1, errs)
        self.assertIn("x max 1.450 > allowed 1.300", errs[0])
        self.assertIn("'crate'", errs[0])

    def test_too_small_fails(self):
        m = mesh_of([{"prim": "box", "size": [1.0, 1.8, 0.5], "role": "plaster"}])
        errs = validate.footprint_fit(m, 2, 2)
        self.assertTrue(any("x max 0.500 < required 0.700" in e for e in errs), errs)
        self.assertTrue(any("x min -0.500 > required -0.700" in e for e in errs), errs)

    def test_ground_and_ship_length(self):
        m = mesh_of([{"prim": "box", "size": [1, 1, 1], "position": [0, 0, 0.3], "role": "stone"}])
        self.assertTrue(validate.ground_contact(m))
        hull = mesh_of([{"prim": "box", "size": [2.0, 0.5, 0.3], "role": "timber"}])
        self.assertEqual(validate.ship_length(hull, 2.0), [])
        self.assertIn("length 2.000 tiles, allowed 1.8 ± 0.1", validate.ship_length(hull, 1.8)[0])


class BudgetTest(unittest.TestCase):
    def test_over_budget_names_file_and_largest_part(self):
        m = mesh_of([{"prim": "cylinder", "radius": 0.5, "height": 1, "segments": 32, "caps": True, "role": "stone", "name": "tower"}])
        self.assertEqual(validate.budget(m, len(m), "x.glb"), [])
        errs = validate.budget(m, 50, "chapel.glb")
        self.assertEqual(len(errs), 1)
        self.assertIn("chapel.glb: 124 triangles > budget 50", errs[0])
        self.assertIn("'tower' 124", errs[0])


class PaletteTest(unittest.TestCase):
    def test_declared_shades_pass(self):
        m = mesh_of([{"prim": "box", "size": [1, 1, 1], "role": "timber", "shade": 0.8}])
        self.assertEqual(validate.palette_check(m, ROLES, {("timber", 0.8)}, "f.glb"), [])

    def test_clamped_or_undeclared_colours_fail(self):
        # plaster (#E7D7B8) × 1.2 exceeds 1 in the red channel: not palette × shade.
        m = mesh_of([{"prim": "box", "size": [1, 1, 1], "role": "plaster", "shade": 1.2, "name": "wall"}])
        errs = validate.palette_check(m, ROLES, {("plaster", 1.2)}, "f.glb")
        self.assertEqual(len(errs), 1, errs)
        self.assertIn("'wall'", errs[0])
        self.assertIn("is not palette plaster × 1.2", errs[0])
        errs = validate.palette_check(m, ROLES, set(), "f.glb")
        self.assertIn("undeclared role/shade", errs[0])


class PrimitiveTest(unittest.TestCase):
    def signed_volume(self, tris):
        v = 0.0
        for a, b, c in tris:
            v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        return v

    def test_closed_primitives_face_outward(self):
        self.assertAlmostEqual(self.signed_volume(geometry.box((1, 2, 3))), 6.0, places=6)
        self.assertGreater(self.signed_volume(geometry.cylinder(0.5, 1.0, segments=8, caps=True)), 0)
        self.assertGreater(self.signed_volume(geometry.lathe([[0, 0], [0.5, 0.1], [0.4, 0.8], [0, 1.0]], 8)), 0)
        self.assertGreater(self.signed_volume(geometry.rock((1, 1, 1), 1, geometry.Rng(7))), 0)
        closed_wedge = geometry.wedge((2, 1, 1), 0.3) + [((-1, -0.5, 0), (-1, 0.5, 0), (1, 0.5, 0)), ((-1, -0.5, 0), (1, 0.5, 0), (1, -0.5, 0))]
        self.assertGreater(self.signed_volume(closed_wedge), 0)

    def test_mirroring_keeps_the_winding_outward(self):
        tris = geometry.transformed([t + ("plaster", 1.0, "p") for t in geometry.box((1, 1, 1))], geometry.scaling((-1, 1, 1)))
        self.assertGreater(self.signed_volume([t[:3] for t in tris]), 0)

    def test_seeded_rocks_are_deterministic(self):
        a = geometry.rock((1, 1, 1), 0, geometry.Rng(geometry.seed_of("quarry", "parts", 3, 0)))
        b = geometry.rock((1, 1, 1), 0, geometry.Rng(geometry.seed_of("quarry", "parts", 3, 0)))
        c = geometry.rock((1, 1, 1), 0, geometry.Rng(geometry.seed_of("quarry", "parts", 4, 0)))
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)


if __name__ == "__main__":
    unittest.main()
