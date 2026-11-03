"""The V7 rework parts (nsvoxel/parts_v7.py; stdlib unittest)."""

import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

from nsvoxel import parts_v7 as W  # noqa: E402
from nsvoxel.grid import Vox  # noqa: E402


class PartsV7Test(unittest.TestCase):
    def test_coursed_stone_2_fills_the_block_with_two_voxel_courses(self):
        v = Vox(20, 20, 14)
        W.coursed_stone_2(v, 2, 2, 18, 18, 1, 11, seed=3)
        self.assertEqual(sum(1 for (x, y, z) in v.cells if z == 5), 16 * 16)
        # Only stone; the wall faces are rubble in three shades, neighbouring stones of a course differ.
        self.assertEqual({m[0] for m in v.cells.values()}, {"stone"})
        self.assertEqual(len({v.get(x, 2, z)[1] for x in range(2, 18) for z in range(1, 11)}), 3)
        # A course is two voxels high (the layers pair up).
        self.assertEqual([v.get(x, 2, 2) for x in range(2, 18)], [v.get(x, 2, 1) for x in range(2, 18)])

    def test_framed_house_has_stone_below_frame_and_roof_above(self):
        v = Vox(36, 36, 40)
        b = W.framed_house(v, 4, 3, 22, 26, "y", ground=11, top=20, seed=1)
        self.assertEqual(v.get(10, 3, 6)[0], "stone")
        self.assertEqual(v.get(10, 2, 11)[0], "timber")  # the jetty
        self.assertGreater(b.roof.ridge_z, 20)
        self.assertEqual(v.get(12, 14, b.roof.ridge_z + 1)[0], "terracotta")

    def test_heavy_frame_has_few_posts_a_rail_and_a_brace_per_closed_bay(self):
        v = Vox(40, 20, 20)
        panels = W.heavy_frame(v, 2, 2, 34, 16, 2, 10, rail=5, open={"y+": (1,)})
        self.assertEqual(len(panels["y+"]), 3)  # 32 voxels: three bays
        f = W._p.faces_of(v, 2, 2, 34, 16)["y+"]
        (p0, p1), (q0, q1), _ = panels["y+"]
        self.assertEqual(f.get(p0 - 1, 6)[0], "timber")  # a two-voxel post
        self.assertEqual(f.get(p0 + 3, 5)[0], "timber")  # the rail
        self.assertNotEqual(f.get(q0 + 3, 5)[0], "timber")  # an open bay: no rail
        braced = sum(f.get(a, 3)[0] == "timber" for a in range(p0, p1))
        self.assertEqual(braced, 2)  # the brace's foot, two voxels wide
        self.assertEqual(sum(f.get(a, 3)[0] == "timber" for a in range(q0, q1)), 0)

    def test_framed_house_windows_and_plank_shed(self):
        v = Vox(40, 40, 40)
        b = W.framed_house(v, 3, 4, 31, 18, "x", windows={"y+": (0,)}, shutters=W.TIMBER)
        (p0, p1) = b.panels["y+"][0]
        f = b.face("y+", upper=True)
        a = (p0 + p1 - 5) // 2
        self.assertIsNone(f.get(a, 13))  # the glass sits one voxel back
        self.assertEqual(f.get(a + 2, 13, out=-1)[0], "timber")  # the mullion
        self.assertTrue(f.get(a - 2, 13, out=1))  # a shutter
        r = W.plank_shed(v, 24, 22, 34, 34)
        self.assertGreater(r.ridge_z, 11)
        self.assertEqual(v.get(25, 33, 5)[0], "timber")  # the boards
        self.assertIsNone(v.get(28, 33, 5))  # the door leaf sits one voxel back

    def test_no_proud_plinth(self):
        # The wall meets the painted ground: the z0 band lies inside the wall outline.
        v = Vox(40, 40, 40)
        W.framed_house(v, 3, 4, 31, 18, "x")
        W.plank_shed(v, 24, 22, 34, 34)
        band = {(x, y) for (x, y, z) in v.cells if z == 1}
        inside = {(x, y) for x in range(3, 31) for y in range(4, 18)} | {(x, y) for x in range(24, 34) for y in range(22, 34)}
        self.assertEqual({c for c in band - inside if c[1] != 34}, set())  # only the shed's door step stands out
        self.assertIn((3, 4), band)
        self.assertIn((24, 22), band)

    def test_stack_and_stairs(self):
        v = Vox(20, 20, 30)
        W.stack(v, 5, 5, 1, 20, 3, 3)
        self.assertTrue(v.has(6, 6, 19))
        self.assertTrue(v.has(6, 6, 22))  # the pot
        self.assertFalse(v.has(6, 6, 25))
        W.stairs(v, 10, 2, 2, 4)
        self.assertTrue(v.has(11, 2, 2))
        self.assertTrue(v.has(11, 8, 5))
        self.assertFalse(v.has(11, 10, 6))


if __name__ == "__main__":
    unittest.main()
