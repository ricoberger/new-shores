"""
The D-062/D-063 models (Anno-sized footprints, playhouse): every recipe fits
its footprint and budgets, declares the anchors LIFE_LAYER §7 and the content
need, stays deterministic and keeps its water rows and levels (stdlib unittest).
"""

import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content, model, palette  # noqa: E402
from nsvoxel import detail_d062 as H  # noqa: E402
from nsvoxel.grid import Vox  # noqa: E402

CONTENT = content.load()
ROLES = palette.load()[0]

#: id → (footprint w × d tiles, water rows the model stands over, anchors beyond status, model files).
D062 = {
    "trading_post": ((6, 6), 1, ("door", "cart", "berth_1", "berth_2", "berth_3", "berth_4"), 4),
    "chapel": ((3, 5), 0, ("door",), 1),
    "city_guard": ((4, 4), 0, ("door",), 1),
    "fire_station": ((4, 5), 0, ("door",), 1),
    "surgery": ((4, 6), 0, ("door",), 1),
    "trading_pier": ((6, 9), 5, ("berth_1", "berth_2", "cart"), 1),
    "depot": ((11, 4), 1, ("cart", "door"), 1),
    "playhouse": ((11, 14), 0, ("door",), 1),
}
#: Voxels of the model's water rows: the deck of the pier (all six), the front row of the depot (D-062: 5–6 and 0–1 in the content).
MODEL_WATER = {"trading_post": 8, "trading_pier": 48, "depot": 8}
#: Model files that carry a sway group (cloth) and the group.
SWAY = {"trading_post.l4.glb": ["flag"], "surgery.glb": ["cloth"], "playhouse.glb": ["flag"]}


def bounds_ok(v, lo, hi):
    """Whether every cell lies inside lo..hi (inclusive corners, voxels)."""
    return all(lo[i] <= k[i] <= hi[i] for k in v.cells for i in range(3))


class HelperTest(unittest.TestCase):
    def fresh(self):
        return Vox(96, 96, "t")

    def check(self, v):
        self.assertTrue(v.cells)
        for m in set(v.cells.values()):
            self.assertIn(m[0], ROLES, m)

    def test_the_octagon_is_regular_symmetric_and_the_right_size(self):
        cells = H.octagon_cells(48, 48, -1, 20)
        self.assertAlmostEqual(len(cells) / (8 * 20 * 20 * 0.41421356), 1.0, delta=0.03)
        s = set(cells)
        for x, y in cells:
            self.assertIn((95 - x, y), s)
            self.assertIn((x, 95 - y), s)
            self.assertIn((y, x), s)
        self.assertEqual(H.octagon_cells(48, 48, 20, 20), [])
        ring = H.edge_cells(cells)
        self.assertTrue(set(ring) < s)
        self.assertLess(len(ring), len(cells) / 3)

    def test_sectors_cover_eight_facets_evenly(self):
        counts = {}
        for x, y in H.octagon_cells(48, 48, 10, 30):
            counts[H.sector(x, y, 48, 48)] = counts.get(H.sector(x, y, 48, 48), 0) + 1
        self.assertEqual(sorted(counts), list(range(8)))
        self.assertLess(max(counts.values()) / min(counts.values()), 1.15)

    def test_gallery_ring_floor_posts_balustrade_and_skip(self):
        v = self.fresh()
        inner = H.gallery_ring(v, 48, 48, 14, 28, 5, h=6, skip=lambda x, y: y < 40)
        self.check(v)
        floor = {(x, y) for (x, y, z) in v.cells if z == 5}
        self.assertTrue(floor)
        self.assertTrue(all(y >= 40 for _, y in floor))
        self.assertTrue(all(14 < H.oct_r(x, y, 48, 48) <= 28 for x, y in floor))
        self.assertTrue(bounds_ok(v, (0, 0, 5), (95, 95, 10)))
        posts = [c for c in inner if (c[0], c[1], 10) in v.cells]
        self.assertTrue(posts)
        self.assertTrue(all((x, y, 7) in v.cells for x, y in inner))  # the rail at z + 2
        v2 = self.fresh()
        self.assertEqual(H.gallery_ring(v2, 48, 48, 14, 28, 5, h=6, skip=lambda x, y: y < 40), inner)
        self.assertEqual(v2.cells, v.cells)

    def test_banner_pole_sways_as_a_flag_and_hangs_under_its_arm(self):
        v = self.fresh()
        top = H.banner_pole(v, 10, 10, 1, h=14, drop=8, width=4)
        self.check(v)
        self.assertEqual(top, 16)
        groups = {m[2] for m in v.cells.values() if len(m) > 2}
        self.assertEqual(groups, {"flag"})
        self.assertTrue(bounds_ok(v, (10, 10, 1), (15, 10, 15)))
        self.assertIn((12, 10, 14 - 3), v.cells)  # banner under the arm at z 14
        self.assertNotIn((12, 10, 14 - 9), v.cells)

    def test_lantern_is_a_cage_on_a_post(self):
        v = self.fresh()
        top = H.lantern(v, 10, 10, 1, h=9)
        self.check(v)
        self.assertEqual(top, 1 + 9 - 4 + 5)
        self.assertTrue(bounds_ok(v, (9, 9, 1), (13, 11, top)))
        self.assertFalse(any(len(m) > 2 for m in v.cells.values()))

    def test_cupola_is_a_glazed_turret_with_a_pennant(self):
        v = self.fresh()
        top = H.cupola(v, 48, 48, 20, size=8, h=7)
        self.check(v)
        self.assertTrue(bounds_ok(v, (42, 42, 20), (54, 54, top)))  # the roof overhangs the walls by two
        self.assertTrue(any(m[0] == "window" for m in v.cells.values()))
        self.assertEqual({m[2] for m in v.cells.values() if len(m) > 2}, {"flag"})
        self.assertEqual(H.cupola(self.fresh(), 48, 48, 20, flag=False), top - 4)

    def test_helpers_are_deterministic(self):
        def make():
            v = self.fresh()
            H.gallery_ring(v, 48, 48, 14, 28, 5)
            H.banner_pole(v, 10, 10, 1)
            H.lantern(v, 20, 10, 1)
            H.cupola(v, 48, 48, 20)
            return v.cells

        self.assertEqual(make(), make())


class D062Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipes = model.recipe_modules()
        cls.cache = {}

    def built(self, cid):
        if cid not in self.cache:
            kind = build.kind_for(CONTENT, cid)
            recipe, placeholder = build.recipe_for(cid, kind, self.recipes)
            self.assertFalse(placeholder, cid)
            self.cache[cid] = model.build_id(cid, kind, recipe, CONTENT)
        return self.cache[cid]

    def test_footprints_are_the_anno_sized_ones(self):
        for cid, ((w, d), water, _, levels) in D062.items():
            with self.subTest(cid=cid):
                self.assertEqual(content.footprint(CONTENT, cid), (w, d))
                self.assertEqual(CONTENT["buildings"][cid].get("water_tiles", 0) if "water_rows" not in CONTENT["buildings"][cid] else water, water)
                self.assertEqual(content.levels(CONTENT, cid), levels if levels > 1 else 0)

    def test_budgets_footprint_anchors_and_levels(self):
        for cid, ((w, d), water, anchors, levels) in D062.items():
            with self.subTest(cid=cid):
                files, entry, problems = self.built(cid)
                self.assertEqual(problems, [])
                self.assertEqual(entry["footprint"], {"w": w, "h": d})
                for a in ("door", "status") + anchors:
                    self.assertIn(a, entry["anchors"], cid)
                self.assertNotIn("smoke", entry["anchors"])
                if levels > 1:
                    self.assertEqual(sorted(entry["levels"]), [str(i) for i in range(1, levels + 1)])
                else:
                    self.assertNotIn("levels", entry)
                for info in [entry.get("file")] + list(entry.get("levels", {}).values()):
                    if not info:
                        continue
                    self.assertLessEqual(info["triangles"], config.BUDGET_PER_TILE["building"] * w * d, info["path"])
                    self.assertLessEqual(info["lite"]["triangles"], config.LITE_BUDGET_PER_TILE["building"] * w * d, info["path"])
                    self.assertEqual(entry.get("sway", []) if info["path"] in SWAY else [], SWAY.get(info["path"], []))

    def test_sway_is_only_where_cloth_hangs(self):
        for cid in D062:
            _, entry, _ = self.built(cid)
            paths = [entry["file"]["path"]] if "file" in entry else [i["path"] for i in entry["levels"].values()]
            expected = sorted({g for p in paths for g in SWAY.get(p, [])})
            self.assertEqual(entry.get("sway", []), expected, cid)

    def test_the_city_guard_is_warm_sandstone_not_grey(self):
        files, _, _ = self.built("city_guard")
        v = [f[3] for f in files if f[0] == "city_guard.glb"][0]
        roles = [m[0] for m in v.cells.values()]
        self.assertLess(roles.count("stone") / len(roles), 0.03)
        self.assertGreater(roles.count("cliff-upper") / len(roles), 0.2)

    def test_the_surgery_is_a_patricians_stone_and_brick_house(self):
        self.assertEqual(CONTENT["buildings"]["surgery"]["tier"], "patricians")
        files, _, _ = self.built("surgery")
        v = [f[3] for f in files if f[0] == "surgery.glb"][0]
        roles = [m[0] for m in v.cells.values()]
        self.assertGreater(roles.count("stone"), 1000)  # the ashlar ground floor
        self.assertGreater(roles.count("terracotta"), 500)  # the brick upper storey

    def test_pier_berths_are_on_the_flanks_at_mid_deck(self):
        _, entry, _ = self.built("trading_pier")
        a = entry["anchors"]
        w = 6 * config.VOXELS_PER_TILE
        scale = config.VOXELS_PER_TILE
        self.assertAlmostEqual(a["berth_1"][0], (-1.2 - w / 2) / scale, places=2)
        self.assertAlmostEqual(a["berth_2"][0], (w + 1.2 - w / 2) / scale, places=2)
        self.assertAlmostEqual(a["berth_1"][2], a["berth_2"][2])
        # y at the middle of the deck's water rows (voxel 24 of 72); glTF +z points to the sea.
        self.assertAlmostEqual(a["berth_1"][2], (9 * scale / 2 - MODEL_WATER["trading_pier"] / 2) / scale, places=2)

    def test_the_depot_has_no_levels_and_no_cloth(self):
        files, entry, _ = self.built("depot")
        self.assertNotIn("levels", entry)
        self.assertEqual([f[0] for f in files], ["depot.glb", "depot.lite.glb"])
        self.assertEqual(entry.get("sway", []), [])

    def test_nothing_solid_stands_over_the_water_rows_and_only_piles_reach_below_ground(self):
        # The water rows hold decks, ramps, quay edges, posts and piles; walls and roofs stand on the land rows behind them.
        for cid, rows in MODEL_WATER.items():
            files, _, _ = self.built(cid)
            for f in files:
                if f[3] is None:
                    continue
                for (x, y, z), m in f[3].cells.items():
                    if z < 0:
                        self.assertLess(y, rows + 2, (cid, f[0], x, y, z))
                    if y < rows and z > 4:
                        self.assertIn(m[0], ("timber", "iron", "brass", "canvas"), (cid, f[0], x, y, z, m))

    def test_the_playhouse_roof_is_mostly_dark_and_brown_with_little_terracotta(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("pl", os.path.join(config.RECIPES_DIR, "playhouse.py"))
        pl = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pl)
        terra = set(pl.TERRA) | {pl.RIDGE_TERRA}
        roof = set(pl.DARK_TILE) | set(pl.BROWN_SLATE) | {pl.RIDGE_DARK, pl.RIDGE_SLATE, pl.HIP} | terra
        files, _, _ = self.built("playhouse")
        v = [f[3] for f in files if f[0] == "playhouse.glb"][0]
        top = {}
        for (x, y, z), m in v.cells.items():
            if z >= top.get((x, y), (-99, None))[0]:
                top[(x, y)] = (z, m)
        seen = [m for _, m in top.values() if m in roof]
        self.assertGreater(len(seen), 2500)
        share = sum(1 for m in seen if m in terra) / len(seen)
        self.assertLess(share, 0.2)
        self.assertGreater(share, 0.0)  # the porch, the booth and the cupola keep a little warmth
        # No Mediterranean cues: nothing of the roles reserved for a southern region is used.
        self.assertFalse({m[0] for m in v.cells.values()} & {"whitewash", "travertine"})

    def test_deterministic(self):
        for cid in D062:
            kind = build.kind_for(CONTENT, cid)
            recipe, _ = build.recipe_for(cid, kind, self.recipes)
            a = model.build_id(cid, kind, recipe, CONTENT)[0]
            b = model.build_id(cid, kind, recipe, CONTENT)[0]
            self.assertEqual([f[1] for f in a], [f[1] for f in b], cid)

    def test_trading_post_berths_keep_their_spacing_on_every_level(self):
        _, entry, _ = self.built("trading_post")
        xs = [entry["anchors"][f"berth_{i}"][0] for i in range(1, 5)]
        self.assertEqual(xs, [-0.75, 0.75, -2.25, 2.25])
        for i in range(1, 5):
            self.assertGreater(entry["anchors"][f"berth_{i}"][2], 2.5)  # at the water edge (glTF +z is the sea side)


if __name__ == "__main__":
    unittest.main()
