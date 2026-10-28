"""Blender-free consistency of the committed models (client/public/models)."""

import hashlib
import json
import os
import unittest

from helpers import LIVE_CONTENT, PALETTE_SHA
from nsassets import config, content, glb, pipeline, validate


def files_of(entry):
    out = []
    for info in [entry.get("file")] + entry.get("variants", []) + list(entry.get("levels", {}).values()) + list(entry.get("attachments", {}).values()):
        if info:
            out.append(info)
            if "lite" in info:
                out.append(info["lite"])
    return out


@unittest.skipUnless(os.path.isfile(os.path.join(config.MODELS_DIR, "manifest.json")), "no committed models yet")
class CommittedModelsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(config.MODELS_DIR, "manifest.json"), encoding="utf-8") as f:
            cls.manifest = json.load(f)

    def test_manifest_header(self):
        m = self.manifest
        self.assertEqual(m["version"], config.MANIFEST_VERSION)
        self.assertEqual(m["palette_sha256"], PALETTE_SHA)
        self.assertEqual(m["missing_recipes"], [])
        self.assertEqual(m["kit_scale"], config.KIT_SCALE)
        # Every content ID has a model; planned IDs (assets/build/planned) may still lack one.
        required = set(content.required_ids(LIVE_CONTENT))
        self.assertLessEqual(set(m["models"]), required)
        self.assertEqual(sorted(required - set(m["models"]) - set(content.planned_ids(LIVE_CONTENT))), [])

    def test_every_file_matches_and_meets_the_export_profile(self):
        listed = set()
        total = 0
        for cid, entry in self.manifest["models"].items():
            for info in files_of(entry):
                path = os.path.join(config.MODELS_DIR, info["path"])
                with open(path, "rb") as f:
                    data = f.read()
                listed.add(info["path"])
                total += len(data)
                self.assertEqual(hashlib.sha256(data).hexdigest(), info["sha256"], info["path"])
                self.assertEqual(len(data), info["bytes"], info["path"])
                self.assertEqual(validate.export_profile(data, info["path"]), [])
                doc, _ = glb.read(data)
                tris = doc["accessors"][doc["meshes"][0]["primitives"][0]["indices"]]["count"] // 3
                self.assertEqual(tris, info["triangles"], info["path"])
                self.assertLessEqual(tris, info["budget"], info["path"])
            if "budget_exception" in entry:
                self.assertIn(cid, config.EXCEPTION_ALLOWED)
        for did, entry in self.manifest.get("decor", {}).items():
            self.assertTrue(did.startswith(config.DECOR_PREFIX), did)
            info = entry["file"]
            with open(os.path.join(config.MODELS_DIR, info["path"]), "rb") as f:
                data = f.read()
            listed.add(info["path"])
            total += len(data)
            self.assertEqual(hashlib.sha256(data).hexdigest(), info["sha256"], info["path"])
            self.assertEqual(validate.export_profile(data, info["path"]), [])
            self.assertLessEqual(info["triangles"], config.BUDGET_DECOR, info["path"])
        for lid, entry in self.manifest.get("life", {}).items():
            self.assertTrue(lid.startswith(config.LIFE_PREFIX), lid)
            for info in files_of(entry):
                with open(os.path.join(config.MODELS_DIR, info["path"]), "rb") as f:
                    data = f.read()
                listed.add(info["path"])
                total += len(data)
                self.assertEqual(hashlib.sha256(data).hexdigest(), info["sha256"], info["path"])
                self.assertEqual(validate.export_profile(data, info["path"]), [])
                self.assertLessEqual(info["triangles"], info["budget"], info["path"])
        on_disk = {f for f in os.listdir(config.MODELS_DIR) if f.endswith(".glb")}
        self.assertEqual(on_disk, listed)
        self.assertLessEqual(total, config.MODELS_FOLDER_LIMIT)

    def test_variants_and_levels(self):
        models = self.manifest["models"]
        for house in ("house_settlers", "house_citizens", "house_merchants"):
            self.assertEqual(len(models[house]["variants"]), 3)
            for v in models[house]["variants"]:
                self.assertLessEqual(v["triangles"], config.BUDGET_HOUSE)
        self.assertEqual(sorted(models["warehouse"]["levels"]), ["1", "2", "3"])
        self.assertEqual(sorted(models["trading_post"]["levels"]), ["1", "2", "3", "4"])
        self.assertIn("cargo", models["sloop"]["attachments"])
        self.assertLessEqual(models["sloop"]["attachments"]["cargo"]["triangles"], config.BUDGET_ATTACHMENT)
        for cid in ("pasture", "wheat_field", "orchard_plot", "hemp_field", "hop_field", "woad_field"):
            self.assertEqual(models[cid]["kind"], "field")
            w, h = content.footprint(LIVE_CONTENT, cid)
            limit = pipeline.area_budget(config.BUDGET_FIELD, config.BUDGET_FIELD_PER_TILE, w * h)
            self.assertLessEqual(models[cid]["file"]["triangles"], limit, cid)


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(os.path.isfile(os.path.join(config.MODELS_DIR, "manifest.json")), "no committed models yet")
class CommittedFootprintTest(unittest.TestCase):
    """D-054: every building and field fills its content footprint, within its area budget, with its life anchors."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(config.MODELS_DIR, "manifest.json"), encoding="utf-8") as f:
            cls.manifest = json.load(f)

    def placed(self):
        for cid, entry in sorted(self.manifest["models"].items()):
            if content.kind_of(LIVE_CONTENT, cid) in ("building", "field"):
                yield cid, entry

    def test_footprint_and_area_budget(self):
        for cid, entry in self.placed():
            w, h = content.footprint(LIVE_CONTENT, cid)
            self.assertEqual(entry["footprint"], {"w": w, "h": h}, cid)
            if content.kind_of(LIVE_CONTENT, cid) == "field":
                flat, per_tile = config.BUDGET_FIELD, config.BUDGET_FIELD_PER_TILE
            elif content.is_house(LIVE_CONTENT, cid):
                flat, per_tile = config.BUDGET_HOUSE, config.BUDGET_HOUSE_PER_TILE
            else:
                flat, per_tile = config.BUDGET_BUILDING, config.BUDGET_BUILDING_PER_TILE
            limit = pipeline.area_budget(flat, per_tile, w * h)
            for info in [entry.get("file")] + entry.get("variants", []) + list(entry.get("levels", {}).values()):
                if not info:
                    continue
                self.assertLessEqual(info["triangles"], info["budget"], f"{cid} {info['path']}")
                self.assertIn(info["budget"], (limit, pipeline.area_budget(flat, per_tile, w * h, config.BUDGET_EXCEPTION_FACTOR)), cid)
                if "lite" in info:
                    self.assertLessEqual(info["lite"]["triangles"], int(info["budget"] * config.LITE_FACTOR), f"{cid} {info['path']}")

    def test_model_fills_its_footprint_and_touches_the_ground(self):
        tol = config.FOOTPRINT_TOLERANCE
        for cid, entry in self.placed():
            w, h = content.footprint(LIVE_CONTENT, cid)
            mn, mx = entry["bounds"]["min"], entry["bounds"]["max"]
            # glTF axes: x, z = −y of recipe space
            self.assertLessEqual(mx[0], w / 2 + tol, cid)
            self.assertGreaterEqual(mn[0], -w / 2 - tol, cid)
            self.assertLessEqual(mx[2], h / 2 + tol, cid)
            self.assertGreaterEqual(mn[2], -h / 2 - tol, cid)
            self.assertGreaterEqual(mx[0] - mn[0], w - tol, cid)
            self.assertGreaterEqual(mx[2] - mn[2], h - tol, cid)
            self.assertLessEqual(mn[1], 0.05, cid)

    def test_planned_models(self):
        """D-056 M2: the planned IDs have their models, signature anchors, ship classes and market levels."""
        models = self.manifest["models"]
        planned = set(content.planned_ids(LIVE_CONTENT))
        self.assertLessEqual(planned, set(models))
        for cid in sorted(planned):
            anchors = set(models[cid].get("anchors", {}))
            if content.needs_smoke(LIVE_CONTENT, cid):
                self.assertLessEqual({"chimney", "smoke"}, anchors, cid)
            if content.is_producer(LIVE_CONTENT, cid):
                self.assertIn("cart", anchors, cid)
        for cid in ("cheese_dairy", "meadery", "tannery"):
            self.assertTrue(content.needs_smoke(LIVE_CONTENT, cid), cid)
        for cid, (animal, n) in (("cattle_pasture", ("cattle", 3)), ("pig_pen", ("pig", 4))):
            want = {"gate"} | {f"{animal}_{i}" for i in range(1, n + 1)}
            self.assertEqual(set(models[cid]["anchors"]) - {"door", "status"}, want, cid)
        self.assertEqual(set(models["meadow"]["anchors"]), {"door", "status"})
        self.assertEqual(sorted(models["market_small"]["levels"]), ["1", "2", "3"])
        ships = {cid: models[cid] for cid in config.MODEL_SHIPS}
        self.assertEqual([ships[c]["ship"]["masts"] for c in config.MODEL_SHIPS], [3, 2, 3])
        lengths = [ships[c]["ship"]["length_tiles"] for c in config.MODEL_SHIPS]
        self.assertEqual(lengths, sorted(set(lengths)))
        for cid in ("brig", "galleon"):
            self.assertLessEqual(ships[cid]["file"]["triangles"], config.BUDGET_SHIPS[cid], cid)
            self.assertLessEqual(ships[cid]["attachments"]["cargo"]["triangles"], config.BUDGET_SHIP_CARGO[cid], cid)

    def test_life_anchors_inside_the_footprint(self):
        for cid, entry in self.placed():
            w, h = content.footprint(LIVE_CONTENT, cid)
            anchors = entry.get("anchors", {})
            for k in content.life_anchors(LIVE_CONTENT, cid):
                self.assertIn(k, anchors, cid)
            for k, v in anchors.items():
                if k == "status":
                    continue
                self.assertLessEqual(abs(v[0]), w / 2, f"{cid} {k}")
                self.assertLessEqual(abs(v[2]), h / 2, f"{cid} {k}")
