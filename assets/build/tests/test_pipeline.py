import hashlib
import json
import unittest

from helpers import A_KIT_FILE, CONTENT, PALETTE_SHA, ROLES, fake_loader
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
        r = {"id": "chapel", "kind": "building", "parts": CHAPEL["parts"][:1] + [{"kit": kit, "file": rel, "position": [0, 0, 0.6], "name": "piece"}]}
        files, entry, errors = build(r)
        self.assertEqual(errors, [])
        piece = [t for t in files[0][2].tris if t[5].endswith("'piece'")]
        self.assertEqual(len(piece), 12)
        # 1 m kit cube → 0.25 tiles; MI_Plaster → plaster by the kit default.
        xs = [p[0] for t in piece for p in t[:3]]
        self.assertAlmostEqual(max(xs) - min(xs), 0.25)
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
