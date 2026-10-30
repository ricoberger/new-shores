"""
Tier 3 (Merchants) models at the D-057 §3 detail (V4) and the parts added
for them (nsvoxel.detail_v4): every merchant building and field — plus
grain_distillery, the distillery class's patrician twin — has a recipe,
its life anchors per the content flags, a footprint fit and budgets, flat
colours, rigid cloth except where sway is allowed, deterministic output,
and three house variants richer than the citizen houses (stdlib
unittest).
"""

import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content, model  # noqa: E402
from nsvoxel import detail_v4 as V  # noqa: E402
from nsvoxel.grid import Vox, mat  # noqa: E402

CONTENT = content.load()
#: Authored with the merchants (the distillery class shares its look).
EXTRA = ("grain_distillery",)
#: Roles with no authored shade steps: adjacent voxels of one role mostly share one colour.
FLAT_ROLES = ("plaster", "brass")
#: Model files with a sway group among tier 3: the dyers' frames, the tailor's washing line and the surgery's awning (D-060).
SWAY_ALLOWED = {"dyer.glb", "dyer_works.glb", "tailor.glb", "surgery.glb"}


def tier_ids():
    """Every placed tier-3 content ID with a model, and the extra IDs."""
    ids = {cid for cid, b in CONTENT["buildings"].items() if b.get("tier") == "merchants" and content.kind_of(CONTENT, cid) in ("building", "field")}
    return sorted(ids | set(EXTRA))


class Tier3Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipes = model.recipe_modules()
        cls.cache = {}

    def built(self, cid):
        if cid not in self.cache:
            kind = build.kind_for(CONTENT, cid)
            recipe, _ = build.recipe_for(cid, kind, self.recipes)
            self.cache[cid] = model.build_id(cid, kind, recipe, CONTENT)
        return self.cache[cid]

    def test_every_tier_3_building_and_field_has_a_recipe(self):
        ids = tier_ids()
        self.assertGreaterEqual(len(ids), 26)
        # `theatre` is retired (D-063; its recipe is _south_theatre.py): it stays a placeholder only while the content still lists it.
        self.assertEqual([cid for cid in ids if cid not in self.recipes and cid not in ("theatre", "playhouse")], [])

    def test_anchors_budgets_and_footprint(self):
        for cid in tier_ids():
            with self.subTest(cid=cid):
                files, entry, problems = self.built(cid)
                self.assertEqual(problems, [])
                for a in model.required_anchors(CONTENT, cid):
                    self.assertIn(a, entry["anchors"])
                self.assertIn("door", entry["anchors"])
                self.assertIn("status", entry["anchors"])
                self.assertEqual("smoke" in entry["anchors"], content.needs_smoke(CONTENT, cid))
                self.assertEqual("chimney" in entry["anchors"], content.needs_smoke(CONTENT, cid))
                if content.is_producer(CONTENT, cid):
                    self.assertIn("cart", entry["anchors"])
                w, h = content.footprint(CONTENT, cid)
                cls = model.model_class(CONTENT, cid)
                for f in files:
                    v = f[3]
                    if v is None:  # the lite file
                        continue
                    self.assertEqual((v.w, v.d), (w * config.VOXELS_PER_TILE, h * config.VOXELS_PER_TILE), f[0])
                for info in [entry.get("file")] + entry.get("variants", []) + list(entry.get("levels", {}).values()):
                    if not info:
                        continue
                    self.assertLessEqual(info["triangles"], config.BUDGET_PER_TILE[cls] * w * h, info["path"])
                    if "lite" in info:
                        self.assertLessEqual(info["lite"]["triangles"], config.LITE_BUDGET_PER_TILE[cls] * w * h, info["path"])
                        self.assertGreater(info["lite"]["triangles"], 60, info["path"])

    def test_salt_pans_moor_a_boat_over_the_water_rows(self):
        _, entry, _ = self.built("salt_pans")
        self.assertIn("boat", entry["anchors"])

    def test_structure_fills_the_footprint(self):
        """Buildings use their plot: solid voxels above the ground plate reach into every quarter of it."""
        for cid in tier_ids():
            if content.kind_of(CONTENT, cid) != "building":
                continue
            with self.subTest(cid=cid):
                files, _, _ = self.built(cid)
                v = next(f[3] for f in files if f[3] is not None)
                quarters = {(x * 2 // v.w, y * 2 // v.d) for (x, y, z) in v.cells if z >= 1 and 0 <= x < v.w and 0 <= y < v.d}
                self.assertEqual(len(quarters), 4, cid)

    def test_export_is_flat_for_plain_materials(self):
        n = differing = 0
        for cid in tier_ids():
            files, _, _ = self.built(cid)
            for f in files:
                v = f[3]
                if v is None:
                    continue
                for (x, y, z), m in v.cells.items():
                    if m[0] not in FLAT_ROLES:
                        continue
                    for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
                        o = v.cells.get((x + d[0], y + d[1], z + d[2]))
                        if o is not None and o[0] == m[0]:
                            n += 1
                            differing += o[:2] != m[:2]
        self.assertGreater(n, 1000)
        # What differs is authored: plaster walls next to paper, salt sacks, tallow, icing.
        self.assertLess(differing / n, 0.05)

    def test_cloth_sways_only_where_allowed(self):
        for cid in tier_ids():
            files, entry, _ = self.built(cid)
            swaying = set()
            for g in files:
                if g[3] is None:
                    continue
                sway = any(len(m) > 2 for m in g[3].cells.values())
                self.assertEqual(sway, g[0] in SWAY_ALLOWED, g[0])
                swaying |= {m[2] for m in g[3].cells.values() if len(m) > 2}
            self.assertEqual(entry.get("sway", []), sorted(swaying), cid)

    def test_deterministic(self):
        for cid in ("house_merchants", "theatre", "salt_mine", "hop_field"):
            kind = build.kind_for(CONTENT, cid)
            recipe, _ = build.recipe_for(cid, kind, self.recipes)
            a = model.build_id(cid, kind, recipe, CONTENT)[0]
            b = model.build_id(cid, kind, recipe, CONTENT)[0]
            self.assertEqual([(f[0], f[3] and f[3].cells) for f in a], [(f[0], f[3] and f[3].cells) for f in b], cid)

    def test_three_merchant_houses_richer_than_citizens(self):
        stats = {}
        for cid in ("house_citizens", "house_merchants"):
            files, entry, _ = self.built(cid)
            self.assertEqual(len(entry["variants"]), 3, cid)
            full = [f[3] for f in files if f[3] is not None]
            self.assertEqual(len({frozenset(v.cells.items()) for v in full}), 3, cid)
            stats[cid] = [(len(v.cells), max(z for (_, _, z) in v.cells), {m[:2] for m in v.cells.values() if m[0] in ("terracotta", "slate")}) for v in full]
        citizens, merchants = stats["house_citizens"], stats["house_merchants"]
        # Every merchant house is bigger and taller than any citizen house.
        self.assertGreater(min(s[0] for s in merchants), max(s[0] for s in citizens))
        self.assertGreater(min(s[1] for s in merchants), max(s[1] for s in citizens))
        # Roofs differ between the variants.
        self.assertEqual(len({frozenset(s[2]) for s in merchants}), 3)


class DetailV4HelperTest(unittest.TestCase):
    def test_townhouse_faces_and_roof(self):
        v = Vox(24, 24, 40)
        b = V.townhouse(v, 4, 6, 20, 16, "x", ground=10, top=19, infill=mat("plaster"), seed=3)
        self.assertGreater(b.roof.ridge_z, 19)
        self.assertIsNotNone(v.get(4, 6, 5))
        V.oriel(b.face("y+", upper=True), 8, 12, 4, 5)
        self.assertTrue(any(y > 16 and z >= 12 for (x, y, z) in v.cells))

    def test_round_pieces_are_round_and_deterministic(self):
        a, b = Vox(24, 24, 24), Vox(24, 24, 24)
        for v in (a, b):
            V.still_tower(v, 12, 12, 6, 14, seed=5)
            V.vat(v, 3, 3, 1, r=2, h=3, liquid=mat("dye-blue"))
        self.assertEqual(a.cells, b.cells)
        self.assertIsNone(a.get(5, 5, 4))  # outside the tower's disc
        self.assertIsNotNone(a.get(12, 12, 4))
        self.assertEqual(a.get(3, 3, 2), mat("dye-blue"))

    def test_mine_hill_seams_and_terraces(self):
        v = Vox(24, 32, 20)
        V.mine_hill(v, 0, 24, 0, 28, peak=14, seam=mat("iron", 0.5), seed=1)
        self.assertGreater(sum(1 for m in v.cells.values() if m == mat("iron", 0.5)), 50)
        t = Vox(32, 32, 10)
        V.terraces(t, 8, 8, 24, 24, 3, mat("terracotta"), open_sides=("y+", "x-"))
        self.assertIsNone(t.get(16, 16, 1))  # the pit floor stays open
        self.assertIsNotNone(t.get(16, 3, 4))  # the back terraces rise
        self.assertIsNone(t.get(3, 16, 1))  # the west side is open


if __name__ == "__main__":
    unittest.main()
