"""Voxel pipeline unit tests: meshing, grid helpers, export, recipes and placeholders (stdlib unittest; `make assets-test`)."""

import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import content as content_mod, export, grid, mesh, model  # noqa: E402

M = grid.mat("plaster")
R = grid.mat("terracotta")


def tri_count(cells, **kw):
    return 2 * len(mesh.greedy(cells, **kw))


class MeshTest(unittest.TestCase):
    def test_single_voxel_has_five_faces(self):
        # The bottom face is never seen by the fixed camera elevation.
        self.assertEqual(tri_count({(0, 0, 0): M}), 10)
        self.assertEqual(tri_count({(0, 0, 0): M}, skip_down=False), 12)

    def test_equal_faces_merge(self):
        v = grid.Vox(8, 8)
        v.box(0, 0, 0, 8, 8, 1, M)
        self.assertEqual(tri_count(v.cells), 10)

    def test_materials_do_not_merge(self):
        v = grid.Vox(2, 1)
        v.set(0, 0, 0, M)
        v.set(1, 0, 0, R)
        self.assertEqual(tri_count(v.cells), 20 - 4)

    def test_corner_occlusion(self):
        # The top face of a voxel beside a wall is darkened along the wall only.
        cells = {(0, 0, 0): M, (1, 0, 0): M, (1, 0, 1): M}
        faces = mesh.faces(cells)
        top = faces[(2, 1, 1)][(0, 0)][1]
        self.assertEqual(top, (0, 1, 1, 0))

    def test_gradient_faces_merge_along_the_gradient_free_axis(self):
        # A floor row along a wall: the faces share the gradient across the row and merge
        # (the two end faces also see the wall's end, so 3 quads instead of 8).
        v = grid.Vox(8, 2)
        v.box(0, 0, 0, 8, 1, 1, M)
        v.box(0, 1, 0, 8, 2, 2, M)
        tops = [q for q in mesh.greedy(v.cells) if q[1] == 2 and q[0][0][2] == 1]
        self.assertEqual(len(tops), 3)

    def test_quads_face_outward(self):
        for corners, axis, sign, _, _ in mesh.greedy({(0, 0, 0): M}):
            a, b, c = corners[0], corners[1], corners[2]
            u = [b[i] - a[i] for i in range(3)]
            w = [c[i] - a[i] for i in range(3)]
            n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
            self.assertGreater(n[axis] * sign, 0)


class GridTest(unittest.TestCase):
    def test_downsample_keeps_majority_material(self):
        v = grid.Vox(2, 2)
        v.box(0, 0, 0, 2, 2, 2, M)
        v.set(0, 0, 1, R)
        self.assertEqual(grid.downsample(v.cells), {(0, 0, 0): M})

    def test_downsample_drops_thin_specks(self):
        self.assertEqual(grid.downsample({(0, 0, 0): M}), {})

    def test_gable_is_symmetric(self):
        v = grid.Vox(12, 8)
        v.gable(0, 12, 0, 8, 0, R, M, along="x", tiles=0)
        ys = sorted({y for (_, y, _) in v.cells})
        self.assertEqual(ys[0] + ys[-1], 7)

    def test_mirror(self):
        v = grid.Vox(4, 1)
        v.set(0, 0, 0, M)
        v.anchor("door", 1, 0, 0)
        v.mirror_x()
        self.assertIn((3, 0, 0), v.cells)
        self.assertEqual(v.anchors["door"], (3.0, 0.0, 0.0))

    def test_jitter_is_deterministic(self):
        a = grid.Vox(4, 4)
        a.box(0, 0, 0, 4, 4, 4, M)
        b = grid.Vox(4, 4)
        b.box(0, 0, 0, 4, 4, 4, M)
        self.assertEqual(a.jitter(0.1).cells, b.jitter(0.1).cells)


class ModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = content_mod.load()
        cls.recipes = model.recipe_modules()

    def built(self, cid):
        kind = build.kind_for(self.content, cid)
        recipe, _ = build.recipe_for(cid, kind, self.recipes)
        return model.build_id(cid, kind, recipe, self.content)

    def test_deterministic_bytes(self):
        a, _, _ = self.built("house_settlers")
        b, _, _ = self.built("house_settlers")
        self.assertEqual([f[1] for f in a], [f[1] for f in b])

    def test_every_recipe_fits_its_footprint_and_declares_its_anchors(self):
        for cid in sorted(self.recipes):
            with self.subTest(cid=cid):
                _, entry, problems = self.built(cid)
                self.assertEqual(problems, [])
                self.assertIsNotNone(entry)

    def test_placeholders_build(self):
        for cid in ("theatre", "wheat_field", "trading_post", "shipyard", "pasture"):
            if cid in self.recipes:
                continue
            with self.subTest(cid=cid):
                _, entry, problems = self.built(cid)
                self.assertEqual(problems, [])
                for a in model.required_anchors(self.content, cid):
                    self.assertIn(a, entry["anchors"])

    def test_lite_is_cheaper(self):
        files, entry, _ = self.built("house_settlers")
        for f in entry["variants"]:
            self.assertLess(f["lite"]["triangles"], f["triangles"] / 2)

    def test_full_detail_is_eight_voxels_per_tile(self):
        files, _, _ = self.built("house_settlers")
        v = files[0][3]
        self.assertEqual((v.w, v.d), (24, 24))


class ExportTest(unittest.TestCase):
    def test_side_normals_tilt_up(self):
        tris, _, _, _ = export.build_tris({(0, 0, 0): M}, 0, 0, 1 / 8)
        normals = {t[6] for t in tris}
        self.assertIn((0.0, 0.0, 1.0), normals)
        self.assertTrue(all(n[2] > 0 for n in normals))


if __name__ == "__main__":
    unittest.main()
