"""Blender-free consistency of the committed models (client/public/models)."""

import hashlib
import json
import os
import unittest

from helpers import CONTENT, PALETTE_SHA
from nsassets import config, content, glb, validate


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
        self.assertEqual(sorted(m["models"]), content.required_ids(CONTENT))

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
        on_disk = {f for f in os.listdir(config.MODELS_DIR) if f.endswith(".glb")}
        self.assertEqual(on_disk, listed)
        self.assertLessEqual(total, 5 * 1024 * 1024)

    def test_variants_and_levels(self):
        models = self.manifest["models"]
        for house in ("house_settlers", "house_citizens"):
            self.assertEqual(len(models[house]["variants"]), 3)
            for v in models[house]["variants"]:
                self.assertLessEqual(v["triangles"], config.BUDGET_HOUSE)
        self.assertEqual(sorted(models["warehouse"]["levels"]), ["1", "2"])
        self.assertIn("cargo", models["sloop"]["attachments"])
        self.assertLessEqual(models["sloop"]["attachments"]["cargo"]["triangles"], config.BUDGET_ATTACHMENT)
        for cid in ("pasture", "wheat_field", "orchard_plot", "hemp_field"):
            self.assertEqual(models[cid]["kind"], "field")
            self.assertLessEqual(models[cid]["file"]["triangles"], config.BUDGET_FIELD)


if __name__ == "__main__":
    unittest.main()
