"""
Tier 1–2 models at the D-057 §3 detail and the v2 parts (nsvoxel.detail):
every settler and citizen building and field has a recipe, its life
anchors per the content flags, a footprint fit and budgets, per-voxel
flat colours (no baked jitter), rigid cloth except where sway is allowed, three house
variants per tier with citizen houses richer than settler houses, and
deterministic helpers (stdlib unittest).
"""

import json
import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content, model  # noqa: E402
from nsvoxel import parts as P  # noqa: E402
from nsvoxel.grid import Vox  # noqa: E402

CONTENT = content.load()
TIERS = ("settlers", "citizens")
#: Roles with no authored shade steps (courses, stripes, rows): adjacent voxels of one role share one colour.
FLAT_ROLES = ("plaster", "brass")
#: Ground-plate roles (z = 0) that are one flat colour (grass keeps its two-grass patches as separate roles).
FLAT_GROUND_ROLES = ("road-dirt", "sand")
#: Model files with a sway group among tiers 1–2 (LIFE_LAYER §7): hung cloth, sails on frames, awnings and flags.
SWAY_ALLOWED = {"weaver_wool.glb", "weaver_linen.glb", "sailmaker.glb", "warehouse.l3.glb", "trading_post.l4.glb"}


def tier_ids():
    """Every placed tier 1–2 content ID (roads have no model)."""
    return sorted(cid for cid, b in CONTENT["buildings"].items() if b.get("tier") in TIERS and content.kind_of(CONTENT, cid) in ("building", "field"))


class TierDetailTest(unittest.TestCase):
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

    def test_every_tier_1_2_building_and_field_has_a_recipe(self):
        ids = tier_ids()
        self.assertGreaterEqual(len(ids), 38)
        self.assertEqual([cid for cid in ids if cid not in self.recipes], [])

    def test_anchors_budgets_and_footprint(self):
        for cid in tier_ids():
            with self.subTest(cid=cid):
                files, entry, problems = self.built(cid)
                self.assertEqual(problems, [])
                for a in model.required_anchors(CONTENT, cid):
                    self.assertIn(a, entry["anchors"])
                smoke = content.needs_smoke(CONTENT, cid)
                self.assertEqual("smoke" in entry["anchors"], smoke)
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
                        # The automatic lite level still reads: more than a box.
                        self.assertGreater(info["lite"]["triangles"], 60, info["path"])

    def test_module_animals(self):
        for cid, animal, n in (("pasture", "sheep", 3), ("cattle_pasture", "cattle", 3), ("pig_pen", "pig", 4)):
            _, entry, _ = self.built(cid)
            for k in ["gate"] + [f"{animal}_{i}" for i in range(1, n + 1)]:
                self.assertIn(k, entry["anchors"], cid)

    def test_export_is_flat_for_plain_materials(self):
        """D-057 V3b: no baked speckle; the variety of a material is the client shader's."""
        pairs = {"walls": [0, 0], "ground": [0, 0]}  # adjacent same-role voxels, of which differing
        for cid in tier_ids():
            files, _, _ = self.built(cid)
            for f in files:
                v = f[3]
                if v is None:
                    continue
                for (x, y, z), m in v.cells.items():
                    kind = "walls" if m[0] in FLAT_ROLES else ("ground" if m[0] in FLAT_GROUND_ROLES and z == 0 else None)
                    if kind is None:
                        continue
                    for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
                        o = v.cells.get((x + d[0], y + d[1], z + d[2]))
                        if o is not None and o[0] == m[0]:
                            pairs[kind][0] += 1
                            pairs[kind][1] += o[:2] != m[:2]
        # The old speckle differed at 20–60 %; what is left is authored (bleaching strips, furrows, a scorched clearing, flower beds).
        for kind, (n, differing) in pairs.items():
            self.assertGreater(n, 1000, kind)
            self.assertLess(differing / n, 0.02, kind)

    def test_cloth_sways_only_where_allowed(self):
        with open(os.path.join(config.MODELS_DIR, "manifest.json")) as f:
            manifest = json.load(f)["models"]
        for cid in tier_ids():
            files, entry, _ = self.built(cid)
            swaying = set()
            for g in files:
                if g[3] is None:
                    continue
                sway = any(len(m) > 2 for m in g[3].cells.values())
                self.assertEqual(sway, g[0] in SWAY_ALLOWED, g[0])
                swaying |= {m[2] for m in g[3].cells.values() if len(m) > 2}
            # The manifest lists exactly the groups the cells carry.
            self.assertEqual(entry.get("sway", []), sorted(swaying), cid)
            self.assertEqual(manifest[cid].get("sway", []), sorted(swaying), cid)

    def test_three_house_variants_and_citizens_are_richer(self):
        stats = {}
        for cid in ("house_settlers", "house_citizens"):
            files, entry, _ = self.built(cid)
            self.assertEqual(len(entry["variants"]), 3, cid)
            full = [f[3] for f in files if f[3] is not None]
            self.assertEqual(len({frozenset(v.cells.items()) for v in full}), 3, cid)
            stats[cid] = [
                (len(v.cells), sum(1 for m in v.cells.values() if m[0] == "window"), {m[0] for m in v.cells.values()})
                for v in full
            ]
        settlers, citizens = stats["house_settlers"], stats["house_citizens"]
        # Every citizen house has more voxels and glazing than any settler house, and a tiled roof.
        self.assertGreater(min(s[0] for s in citizens), max(s[0] for s in settlers))
        self.assertGreater(min(s[1] for s in citizens), max(s[1] for s in settlers))
        for _, _, roles in citizens:
            self.assertIn("terracotta", roles)


class DetailHelperTest(unittest.TestCase):
    def test_colour_jitter_leaves_the_model_flat(self):
        v = Vox(16, 16, 16)
        v.box(0, 0, 1, 16, 16, 8, P.mat("plaster"))
        v.box(0, 0, 8, 16, 16, 9, P.mat("terracotta"))
        before = dict(v.cells)
        self.assertIs(P.colour_jitter(v, seed=4, scale=2.0, ground=1.0), v)
        self.assertEqual(v.cells, before)

    def test_building_faces_and_roof(self):
        v = Vox(24, 24, 32)
        b = P.building(v, 2, 2, 22, 14, "citizen", along="x", seed=3)
        self.assertGreater(b.roof.ridge_z, 10)
        P.roof_chimney(v, b.roof, 6, 6, above=3, anchor=True)
        self.assertIn("chimney", v.anchors)
        self.assertGreater(v.anchors["smoke"][2], v.anchors["chimney"][2])
        P.entrance(b.face("y+"), 9, 2, 3, 5)
        self.assertTrue(any(y >= 14 and z == 1 for (x, y, z) in v.cells))  # the step

    def test_uneven_fence_posts(self):
        v = Vox(32, 32, 8)
        P.fence_ring(v, 0, 0, 32, 32, kind="rail", seed=7)
        tops = {}
        for (x, y, z), m in v.cells.items():
            tops[(x, y)] = max(tops.get((x, y), 0), z)
        self.assertGreater(len(set(tops.values())), 1)


if __name__ == "__main__":
    unittest.main()
