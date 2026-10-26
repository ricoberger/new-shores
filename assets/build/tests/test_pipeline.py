import hashlib
import json
import unittest

from helpers import A_KIT_FILE, CONTENT, PALETTE_SHA, ROLES, fake_loader, pinned
from nsassets import config, glb, pipeline, validate


def build(recipe):
    return pipeline.build_recipe(recipe, CONTENT, ROLES, fake_loader())


CHAPEL = {
    "id": "chapel",
    "kind": "building",
    "parts": [
        {"prim": "box", "size": [1.8, 1.8, 0.6], "role": "stone", "open": ["bottom"], "name": "nave"},
        {"prim": "wedge", "size": [1.9, 1.9, 0.7], "position": [0, 0, 0.6], "role": "thatch", "name": "roof"},
        {"prim": "box", "size": [0.2, 0.2, 0.2], "position": [0.6, 0.6, 0.6], "role": "brass", "lod": "full", "name": "bell"},
    ],
    "anchors": {"chimney": [0.5, -0.5, 1.2]},
}


class PipelineTest(unittest.TestCase):
    def test_valid_recipe_builds_full_and_lite_files(self):
        files, entry, errors = build(CHAPEL)
        self.assertEqual(errors, [])
        names = [f[0] for f in files]
        self.assertEqual(names, ["chapel.glb", "chapel.lite.glb"])
        self.assertEqual(entry["file"]["triangles"], 10 + 6 + 12)
        self.assertEqual(entry["file"]["lite"]["triangles"], 16)
        self.assertEqual(entry["footprint"], {"w": 2, "h": 2})
        # Anchors in glTF space (y up, front = −z): default door on the front edge, status above the model.
        self.assertEqual(entry["anchors"]["door"], [0.0, 0.0, -1.0])
        self.assertEqual(entry["anchors"]["status"], [0.0, 1.55, 0.0])
        self.assertEqual(entry["anchors"]["chimney"], [0.5, 1.2, 0.5])
        for name, data, _, _ in files:
            self.assertEqual(validate.export_profile(data, name), [])
            self.assertEqual(hashlib.sha256(data).hexdigest(), (entry["file"] if name == "chapel.glb" else entry["file"]["lite"])["sha256"])

    def test_over_budget_recipe_fails_naming_recipe_part_and_file(self):
        r = json.loads(json.dumps(CHAPEL))
        r["parts"].append({"prim": "cylinder", "radius": 0.3, "height": 0.4, "segments": 32, "caps": True, "role": "stone", "name": "big tower", "repeat": {"count": 64, "step": [0, 0, 0.0]}})
        _, entry, errors = build(r)
        self.assertIsNone(entry)
        self.assertTrue(any(e.startswith("recipes/chapel.json chapel.glb:") and "> budget 6000" in e and "'big tower'" in e for e in errors), errors)

    def test_model_outside_the_footprint_band_fails_with_values(self):
        r = json.loads(json.dumps(CHAPEL))
        r["parts"][0]["size"] = [2.8, 1.8, 0.6]
        _, _, errors = build(r)
        self.assertTrue(any("footprint fit: x max 1.400 > allowed 1.300" in e and "'nave'" in e for e in errors), errors)

    def test_houses_and_attachments_use_their_budgets(self):
        house = {"id": "house_settlers", "kind": "building", "parts": [{"prim": "box", "size": [1.8, 1.8, 0.5], "role": "plaster"}],
                 "variants": [[{"prim": "cylinder", "radius": 0.2, "height": 0.3, "segments": 32, "caps": True, "role": "stone", "repeat": {"count": 22, "step": [0, 0, 0]}}], [], []]}
        _, _, errors = build(house)
        self.assertTrue(any("house_settlers.v0.glb: 2740 triangles > budget 2500" in e for e in errors), errors)
        self.assertFalse(any("house_settlers.v1.glb" in e for e in errors), errors)
        sloop = {"id": "sloop", "kind": "ship", "ship": {"length_tiles": 2.0, "masts": 1, "sail_scale": 1.0},
                 "parts": [{"prim": "box", "size": [2.0, 0.5, 0.3], "role": "timber"}],
                 "attachments": {"cargo": [{"prim": "cylinder", "radius": 0.1, "height": 0.1, "segments": 32, "caps": True, "role": "timber", "repeat": {"count": 2, "step": [0, 0, 0.1]}}]}}
        _, _, errors = build(sloop)
        self.assertTrue(any("sloop.cargo.glb: 248 triangles > budget 150" in e for e in errors), errors)

    def test_kit_pieces_use_the_kit_scale_and_material_roles(self):
        kit, rel = A_KIT_FILE
        r = {"id": "chapel", "kind": "building", "parts": CHAPEL["parts"][:1] + [{"kit": kit, "file": rel, "position": [0, 0, 0.6], "scale": 0.1, "name": "piece"}]}
        files, entry, errors = build(r)
        self.assertEqual(errors, [])
        piece = [t for t in files[0][2].tris if t[5].endswith("'piece'")]
        self.assertEqual(len(piece), 12)
        # 1-unit kit cube × kit scale × part scale; the atlas's white cell → plaster.
        xs = [p[0] for t in piece for p in t[:3]]
        self.assertAlmostEqual(max(xs) - min(xs), config.KIT_SCALE["kaykit_hexagon"] * 0.1)
        self.assertEqual({t[3] for t in piece}, {"plaster"})
        self.assertEqual(entry["kit_sources"], [{"kit": kit, "files": [rel]}])

    def test_glb_bytes_and_manifest_are_stable(self):
        a = build(CHAPEL)
        b = build(CHAPEL)
        self.assertEqual([f[1] for f in a[0]], [f[1] for f in b[0]])
        m1 = pipeline.manifest({"chapel": a[1]}, PALETTE_SHA, "5.2", ["mill"])
        m2 = pipeline.manifest({"chapel": b[1]}, PALETTE_SHA, "5.2", ["mill"])
        self.assertEqual(m1, m2)
        doc = json.loads(m1)
        self.assertEqual(doc["missing_recipes"], ["mill"])
        self.assertEqual(list(doc), sorted(doc))
        self.assertTrue(m1.endswith(b"\n"))

    def test_exported_colours_are_palette_colours(self):
        files, _, _ = build(CHAPEL)
        doc, binary = glb.read(files[0][1])
        cols = glb.accessor_values(doc, binary, doc["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"])
        allowed = {tuple(round(c * 255) for c in ROLES[r]) for r in ("stone", "thatch", "brass")}
        self.assertTrue({tuple(round(c * 255) for c in v[:3]) for v in cols} <= allowed)


class DetailTest(unittest.TestCase):
    def test_lite_files_are_validated_like_full_ones(self):
        r = {"id": "chapel", "kind": "building", "parts": [
            {"prim": "box", "size": [1.9, 1.9, 0.02], "role": "road-dirt", "name": "yard"},
            {"prim": "box", "size": [1.0, 1.0, 0.6], "role": "stone", "name": "nave"},
            {"prim": "box", "size": [0.2, 0.2, 0.2], "position": [0.5, 0.5, 0.6], "role": "timber", "lod": "full", "name": "detail"},
        ]}
        files, entry, errors = build(r)
        self.assertEqual(errors, [])
        self.assertEqual(entry["file"]["lite"]["triangles"], 24)
        self.assertEqual(entry["file"]["lite"]["budget"], int(6000 * config.LITE_FACTOR))
        # A lite model without the yard no longer covers the footprint: it fails like a full one would.
        r["parts"][0]["lod"] = "full"
        _, _, errors = build(r)
        self.assertTrue(any("chapel.lite.glb: footprint fit" in e and "must cover" in e for e in errors), errors)
        self.assertFalse(any("chapel.glb: footprint fit" in e for e in errors), errors)

    def test_lite_budgets(self):
        self.assertEqual(pipeline.lite_budget({"id": "chapel", "kind": "building"}, CONTENT, 6000), 1500)
        self.assertEqual(pipeline.lite_budget({"id": "house_settlers", "kind": "building"}, CONTENT, 2500), 625)

    def test_budgets_scale_with_the_footprint_area_up_to_the_cap(self):
        # D-054 footprints; the 2 × 2 reference keeps the flat budgets.
        c = pinned(CONTENT, {"fisher": [3, 8], "warehouse": [6, 6], "trading_post": [6, 9], "shipyard": [8, 12],
                             "house_citizens": [3, 3], "pasture": [3, 3], "orchard_plot": [1, 1]})

        def budget(cid, kind="building", **extra):
            return pipeline.budget_of(dict({"id": cid, "kind": kind}, **extra), c, None)

        self.assertEqual(config.BUDGET_BUILDING_PER_TILE, 1500)
        self.assertEqual(config.BUDGET_BUILDING_CAP, 72000)
        self.assertEqual(budget("chapel"), 6000)
        self.assertEqual(budget("house_settlers"), 2500)
        self.assertEqual(budget("fisher"), 6 * budget("chapel"))
        self.assertEqual(budget("warehouse"), 54000)
        self.assertEqual(budget("shipyard"), config.BUDGET_BUILDING_CAP)
        self.assertEqual(budget("trading_post"), config.BUDGET_BUILDING_CAP)
        self.assertEqual(budget("trading_post", budget_exception={"reason": "x"}), config.BUDGET_BUILDING_CAP)
        self.assertEqual(budget("chapel", budget_exception={"reason": "x"}), 12000)
        self.assertEqual(budget("house_citizens"), 5625)
        self.assertEqual(budget("pasture", "field"), 675)
        self.assertEqual(budget("orchard_plot", "field"), 300)
        self.assertEqual(budget("sloop", "ship"), config.BUDGET_SHIP)
        # Lite models keep their share of the area budget.
        self.assertEqual(pipeline.lite_budget({"id": "fisher", "kind": "building"}, c, budget("fisher")), 9000)

    def test_sails_are_lit_from_both_sides(self):
        r = {"id": "sloop", "kind": "ship", "ship": {"length_tiles": 2.0, "masts": 1, "sail_scale": 1.0},
             "parts": [{"prim": "box", "size": [2.0, 0.5, 0.3], "role": "timber"},
                       {"prim": "sail", "width": 0.8, "height": 1.0, "bulge": 0.1, "position": [0, 0, 0.3], "rotation": [0, 0, 30], "role": "canvas"}]}
        files, _, errors = build(r)
        self.assertEqual(errors, [])
        doc, binary = glb.read(files[0][1])
        prim = doc["meshes"][0]["primitives"][0]
        normals = glb.accessor_values(doc, binary, prim["attributes"]["NORMAL"])
        cols = glb.accessor_values(doc, binary, prim["attributes"]["COLOR_0"])
        canvas = tuple(round(c * 255) for c in ROLES["canvas"])
        sail = [n for n, c in zip(normals, cols) if tuple(round(x * 255) for x in c[:3]) == canvas]
        self.assertTrue(sail)
        self.assertTrue(all(abs(n[1] - 1.0) < 1e-6 for n in sail))


class ProfileTest(unittest.TestCase):
    def test_export_profile_flags_extras(self):
        files, _, _ = build(CHAPEL)
        data = files[0][1]
        doc, binary = glb.read(data)
        doc["textures"] = [{"source": 0}]
        doc["nodes"][0]["translation"] = [1, 0, 0]
        doc["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_0"] = 0
        js = json.dumps(doc).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        import struct

        bad = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(binary)) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(binary), b"BIN\x00") + binary
        errs = validate.export_profile(bad, "x.glb")
        self.assertTrue(any("has textures" in e for e in errs), errs)
        self.assertTrue(any("node 0 has a transform" in e for e in errs), errs)
        self.assertTrue(any("attributes" in e for e in errs), errs)


if __name__ == "__main__":
    unittest.main()


class ThumbTest(unittest.TestCase):
    def test_thumb_file_is_the_first_full_model(self):
        f = lambda *names: [(n, b"", None, None) for n in names]
        self.assertEqual(pipeline.thumb_file(f("chapel.glb", "chapel.lite.glb")), "chapel.glb")
        self.assertEqual(pipeline.thumb_file(f("house.v1.glb", "house.v0.lite.glb", "house.v0.glb")), "house.v0.glb")
        self.assertEqual(pipeline.thumb_file(f("warehouse.l2.glb", "warehouse.l1.glb")), "warehouse.l1.glb")
        self.assertEqual(pipeline.thumb_file(f("sloop.cargo.glb", "sloop.glb")), "sloop.glb")
        self.assertIsNone(pipeline.thumb_file(f("x.lite.glb")))

    def test_thumb_frame_fits_and_centres(self):
        pts = [(0, 0, 0), (2, 0, 0), (0, 1, 0), (2, 1, 0)]
        centre, scale = pipeline.thumb_frame(pts, (1, 0, 0), (0, 1, 0), margin=0)
        self.assertEqual(centre, (1.0, 0.5))
        self.assertEqual(scale, 2.0)
        _, scale = pipeline.thumb_frame(pts, (1, 0, 0), (0, 1, 0), margin=0.1)
        self.assertAlmostEqual(scale, 2.4)


class AreaBudgetBuildTest(unittest.TestCase):
    """D-054: built entries record the area-scaled budgets and the life-layer anchors."""

    def setUp(self):
        self.content = pinned(CONTENT, {"fisher": [3, 8], "pasture": [3, 3], "trading_post": [6, 9]})

    def build(self, recipe):
        return pipeline.build_recipe(recipe, self.content, ROLES, fake_loader())

    def test_a_strip_records_its_area_budget_and_lite_share(self):
        r = {"id": "fisher", "kind": "building", "parts": [{"prim": "box", "size": [2.9, 7.9, 0.5], "role": "timber"}],
             "anchors": {"chimney": [0, 1, 0.5], "smoke": [0, 1, 0.55], "cart": [0, 3.5, 0], "boat": [0, -3, 0.05]}}
        _, entry, errors = self.build(r)
        self.assertEqual(errors, [])
        self.assertEqual(entry["footprint"], {"w": 3, "h": 8})
        self.assertEqual(entry["file"]["budget"], 36000)
        self.assertEqual(entry["file"]["lite"]["budget"], 9000)
        self.assertEqual(entry["anchors"]["boat"], [0.0, 0.05, 3.0])

    def test_pier_slots_and_pasture_anchors_reach_the_manifest(self):
        berths = {f"berth_{i}": [x, -4.2, 0.06] for i, x in enumerate((-2.1, -0.7, 0.7, 2.1), 1)}
        r = {"id": "trading_post", "kind": "building", "parts": [{"prim": "box", "size": [5.9, 8.9, 0.5], "role": "stone"}],
             "anchors": {"cart": [0, 4, 0], **berths}}
        _, entry, errors = self.build(r)
        self.assertEqual(errors, [])
        self.assertEqual([k for k in sorted(entry["anchors"]) if k.startswith("berth")], ["berth_1", "berth_2", "berth_3", "berth_4"])
        self.assertEqual(entry["anchors"]["berth_4"], [2.1, 0.06, 4.2])
        p = {"id": "pasture", "kind": "field", "parts": [{"prim": "box", "size": [2.9, 2.9, 0.05], "role": "pasture"}],
             "anchors": {"gate": [0, 1.42, 0], "sheep_1": [-0.6, -0.3, 0], "sheep_2": [0.6, 0, 0], "sheep_3": [0, 0.7, 0]}}
        _, entry, errors = self.build(p)
        self.assertEqual(errors, [])
        self.assertEqual(entry["file"]["budget"], 675)
        self.assertEqual(sorted(entry["anchors"]), ["door", "gate", "sheep_1", "sheep_2", "sheep_3", "status"])
