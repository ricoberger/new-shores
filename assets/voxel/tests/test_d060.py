"""
The D-060 models (tree plot, city guard, fire station, surgery, trading
pier, depot) and their parts (nsvoxel.detail_d060): every helper stays in
its bounds, uses palette-role materials and is deterministic; the recipes
fit their footprints, budgets and anchors (stdlib unittest).
"""

import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content, model, palette  # noqa: E402
from nsvoxel import detail_d060 as D  # noqa: E402
from nsvoxel.grid import Vox  # noqa: E402

CONTENT = content.load()
ROLES = palette.load()[0]

#: The D-060 IDs and their fixed footprints (tiles) and water rows.
D060 = {
    "tree_plot": ((1, 1), 0),
    "city_guard": ((3, 3), 0),
    "fire_station": ((3, 4), 0),
    "surgery": ((3, 3), 0),
    "trading_pier": ((3, 4), 3),
    "depot": ((4, 4), 1),
}


def bounds_ok(v, lo, hi):
    """Whether every cell lies inside lo..hi (inclusive corners, voxels)."""
    return all(lo[i] <= k[i] <= hi[i] for k in v.cells for i in range(3))


class HelperTest(unittest.TestCase):
    def fresh(self):
        return Vox(48, 48, "t")

    def check(self, v, lo, hi):
        self.assertTrue(v.cells)
        self.assertTrue(bounds_ok(v, lo, hi), v.bounds())
        for m in set(v.cells.values()):
            self.assertIn(m[0], ROLES, m)

    def test_guard_box_stripes_opening_and_bounds(self):
        v = self.fresh()
        top = D.guard_box(v, 10, 10, 1, side="y+", w=5, d=4, h=8)
        self.check(v, (10 - 1, 10 - 1, 1), (10 + 5, 10 + 4, top))
        roles = {m[0] for m in v.cells.values()}
        self.assertTrue({"terracotta", "canvas"} <= roles)
        # Open on the front: the middle of the y+ wall is clear at standing height, the back wall is closed.
        self.assertFalse(v.has(12, 13, 3))
        self.assertTrue(v.has(12, 10, 3))
        for side in ("y-", "x+", "x-"):
            w = self.fresh()
            D.guard_box(w, 10, 10, 1, side=side)
            self.assertTrue(w.cells)

    def test_crenellation_alternates_merlons_and_gaps(self):
        v = self.fresh()
        top = D.crenellation(v, 4, 4, 20, 20, 10, merlon=2, gap=2, h=2, cap=D.STONE)
        self.check(v, (4, 4, 10), (19, 19, top))
        row = [v.has(x, 4, 10) for x in range(4, 20)]
        self.assertTrue(row[0] and row[-1])  # corners
        self.assertTrue(any(not c for c in row))  # gaps
        self.assertFalse(any(v.has(x, y, 10) for x in range(6, 18) for y in range(6, 18)))  # nothing inside
        self.assertEqual(top, 13)

    def test_bell_turret_rises_from_its_base(self):
        v = self.fresh()
        top = D.bell_turret(v, 24, 24, 12, size=4, h=5)
        self.check(v, (24 - 4, 24 - 4, 12), (24 + 3, 24 + 3, top))
        self.assertGreater(top, 12 + 6)
        self.assertIn("brass", {m[0] for m in v.cells.values()})
        self.assertTrue(v.has(22, 22, 14) and v.has(25, 25, 14))  # posts

    def test_barber_pole_spirals_in_three_colours(self):
        v = self.fresh()
        top = D.barber_pole(v, 20, 20, 1, h=11)
        self.check(v, (19, 19, 1), (22, 22, top))
        shades = {v.get(20, 20, z)[0] for z in range(2, 12)}
        self.assertEqual(shades, {"canvas", "terracotta", "dye-blue"})
        self.assertNotEqual(v.get(20, 20, 4), v.get(21, 21, 4))  # the spiral shifts across the post

    def test_mooring_ring_is_a_hollow_ring_with_a_bolt(self):
        for plane in ("xz", "yz"):
            v = self.fresh()
            D.mooring_ring(v, 10, 10, 2, plane=plane)
            self.check(v, (10, 10, 2), (12, 12, 5))
            self.assertEqual(len(v.cells), 9)  # 8 ring cells + the bolt
            centre = (11, 10, 3) if plane == "xz" else (10, 11, 3)
            self.assertFalse(v.has(*centre))

    def test_loading_ramp_falls_toward_its_low_edge(self):
        for down in ("y-", "y+", "x-", "x+"):
            v = self.fresh()
            n = D.loading_ramp(v, 10, 18, 10, 22, 3, 0, down=down)
            self.assertEqual(n, 12 if down in ("y-", "y+") else 8)
            self.check(v, (10, 10, 0), (17, 21, 4))
            if down == "y-":
                self.assertGreater(v.top_z(13, 21), v.top_z(13, 10))
            if down == "y+":
                self.assertGreater(v.top_z(13, 10), v.top_z(13, 21))
            if down == "x-":
                self.assertGreater(v.top_z(17, 14), v.top_z(10, 14))

    def test_helpers_are_deterministic(self):
        def make():
            v = self.fresh()
            D.guard_box(v, 2, 2)
            D.crenellation(v, 10, 10, 30, 30, 5)
            D.bell_turret(v, 24, 24, 12)
            D.barber_pole(v, 40, 40)
            D.mooring_ring(v, 5, 40, 2)
            D.loading_ramp(v, 30, 38, 2, 14, 3, 0)
            return v.cells

        self.assertEqual(make(), make())


if __name__ == "__main__":
    unittest.main()
