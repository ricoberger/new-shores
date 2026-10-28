"""
The committed models (client/public/models) against the build and the
content: deterministic rebuild, manifest header, one model per content ID
(recipe or placeholder), triangle budgets per footprint tile, footprint
fit, life anchors, export profile and the folder size (stdlib unittest).
"""

import hashlib
import json
import os
import sys
import unittest

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content, glb, model, palette  # noqa: E402

CONTENT = content.load()


def files_of(entry):
    """Every file of a manifest entry (full, lite, variants, levels, attachments)."""
    out = []
    for info in [entry.get("file")] + entry.get("variants", []) + list(entry.get("levels", {}).values()) + list(entry.get("attachments", {}).values()):
        if info:
            out.append(info)
            if "lite" in info:
                out.append(info["lite"])
    return out


def main_files(entry):
    """The full model files of a building or field (no lite, no attachments)."""
    return [f for f in [entry.get("file")] + entry.get("variants", []) + list(entry.get("levels", {}).values()) if f]


class CommittedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(config.MODELS_DIR, "manifest.json"), encoding="utf-8") as f:
            cls.manifest = json.load(f)
        cls.recipes = build.model.recipe_modules()

    def placed(self):
        for cid, entry in sorted(self.manifest["models"].items()):
            if content.kind_of(CONTENT, cid) in ("building", "field"):
                yield cid, entry

    def test_the_committed_output_is_the_build_of_the_recipes(self):
        # Rebuilds everything into a temp dir and compares byte for byte (make assets-check).
        self.assertEqual(build.main(["--check", "--jobs", str(os.cpu_count() or 4)]), 0)

    def test_manifest_header(self):
        m = self.manifest
        self.assertEqual(m["version"], config.MANIFEST_VERSION)
        self.assertEqual(m["generator"], config.GENERATOR)
        self.assertEqual(m["voxels_per_tile"], config.VOXELS_PER_TILE)
        self.assertEqual(m["palette_sha256"], palette.load()[1])
        self.assertEqual(sorted(m), ["decor", "generator", "life", "models", "palette_sha256", "placeholders", "version", "voxels_per_tile"])

    def test_every_content_id_has_a_model_and_placeholders_are_the_ids_without_a_recipe(self):
        required = set(content.required_ids(CONTENT))
        self.assertEqual(set(self.manifest["models"]), required)
        self.assertEqual(self.manifest["placeholders"], sorted(required - set(self.recipes)))
        # Decor and life come from the family recipe files only.
        self.assertEqual(set(self.manifest["decor"]), {c for c in self.recipes if c.startswith(config.DECOR_PREFIX)})
        self.assertEqual(set(self.manifest["life"]), {c for c in self.recipes if c.startswith(config.LIFE_PREFIX)})
        # No orphan recipe (e.g. a content ID that was renamed).
        self.assertEqual(sorted(set(self.recipes) - required - set(self.manifest["decor"]) - set(self.manifest["life"])), [])

    def test_every_file_matches_its_entry_and_the_export_profile(self):
        listed = set()
        total = 0
        for group in ("models", "decor", "life"):
            for _, entry in self.manifest[group].items():
                for info in files_of(entry):
                    with open(os.path.join(config.MODELS_DIR, info["path"]), "rb") as f:
                        data = f.read()
                    listed.add(info["path"])
                    total += len(data)
                    self.assertEqual(hashlib.sha256(data).hexdigest(), info["sha256"], info["path"])
                    self.assertEqual(len(data), info["bytes"], info["path"])
                    doc, _ = glb.read(data)
                    self.assertEqual(len(doc["meshes"]), 1, info["path"])
                    prim = doc["meshes"][0]["primitives"]
                    self.assertEqual(len(prim), 1, info["path"])
                    self.assertEqual(sorted(prim[0]["attributes"]), ["COLOR_0", "NORMAL", "POSITION"], info["path"])
                    for k in ("textures", "images", "animations", "extensionsUsed"):
                        self.assertNotIn(k, doc, info["path"])
                    self.assertEqual(doc["accessors"][prim[0]["indices"]]["count"] // 3, info["triangles"], info["path"])
        on_disk = {f for f in os.listdir(config.MODELS_DIR) if f.endswith(".glb")}
        self.assertEqual(on_disk, listed)
        self.assertLessEqual(total, config.MODELS_FOLDER_LIMIT, f"{total} bytes of GLBs")
        thumbs = set(os.listdir(os.path.join(config.MODELS_DIR, "thumbs")))
        self.assertEqual(thumbs, {f"{cid}.png" for cid in self.manifest["models"]})

    def test_budgets_per_footprint_tile(self):
        for cid, entry in self.placed():
            w, h = content.footprint(CONTENT, cid)
            cls = model.model_class(CONTENT, cid)
            for info in main_files(entry):
                self.assertEqual(info["budget"], config.BUDGET_PER_TILE[cls] * w * h, cid)
                self.assertLessEqual(info["triangles"], info["budget"], info["path"])
                if cls == "field":
                    self.assertNotIn("lite", info, cid)
                    continue
                self.assertEqual(info["lite"]["budget"], config.LITE_BUDGET_PER_TILE[cls] * w * h, cid)
                self.assertLessEqual(info["lite"]["triangles"], info["lite"]["budget"], info["lite"]["path"])
        for cid in config.MODEL_SHIPS:
            entry = self.manifest["models"][cid]
            self.assertLessEqual(entry["file"]["triangles"], config.BUDGET_SHIPS[cid], cid)
            self.assertLessEqual(entry["attachments"]["cargo"]["triangles"], config.BUDGET_SHIP_CARGO, cid)
        for cid, entry in self.manifest["decor"].items():
            for info in files_of(entry):
                self.assertLessEqual(info["triangles"], config.BUDGET_DECOR, cid)
        for cid, entry in self.manifest["life"].items():
            # Stages: BUDGET_LIFE_STAGE, more for the sized classes beyond 4 tiles (model.budget_of).
            limit = model.budget_of(cid, "life", CONTENT)
            self.assertGreaterEqual(limit, config.BUDGET_LIFE_STAGE if cid.startswith(config.LIFE_STAGE_PREFIX) else config.BUDGET_LIFE, cid)
            for info in files_of(entry):
                self.assertLessEqual(info["triangles"], limit, cid)

    def test_sway_groups_are_listed(self):
        # The manifest lists each model's sway groups (the recipes' sail, flag and cloth voxels), the trees sway with "canopy".
        self.assertIn("cloth", self.manifest["models"]["weaver_wool"]["sway"])
        self.assertIn("sail", self.manifest["models"]["sloop"]["sway"])
        self.assertEqual(self.manifest["decor"]["decor_tree_a"]["sway"], ["canopy"])
        for entry in list(self.manifest["models"].values()) + list(self.manifest["decor"].values()):
            self.assertEqual(entry.get("sway", []), sorted(set(entry.get("sway", []))))

    def test_models_fill_their_footprint_and_stand_on_the_ground(self):
        slack = model.FOOTPRINT_SLACK / config.VOXELS_PER_TILE
        for cid, entry in self.placed():
            w, h = content.footprint(CONTENT, cid)
            self.assertEqual(entry["footprint"], {"w": w, "h": h}, cid)
            mn, mx = entry["bounds"]["min"], entry["bounds"]["max"]
            # glTF axes: x, y up, z = −y of recipe space.
            self.assertLessEqual(mx[0], w / 2 + slack, cid)
            self.assertGreaterEqual(mn[0], -w / 2 - slack, cid)
            self.assertLessEqual(mx[2], h / 2 + slack, cid)
            self.assertGreaterEqual(mn[2], -h / 2 - slack, cid)
            self.assertGreaterEqual(mx[0] - mn[0], w - 0.3, cid)
            self.assertGreaterEqual(mx[2] - mn[2], h - 0.3, cid)
            self.assertLessEqual(mn[1], 0.05, cid)

    def test_life_anchors(self):
        for cid, entry in self.placed():
            anchors = entry["anchors"]
            for k in model.required_anchors(CONTENT, cid):
                self.assertIn(k, anchors, cid)
            # Chimney and smoke exactly on the smoking producers (content `smoke`).
            smoke = content.needs_smoke(CONTENT, cid)
            self.assertEqual("smoke" in anchors, smoke, cid)
            self.assertEqual("chimney" in anchors, smoke, cid)
            if smoke:
                self.assertGreater(anchors["smoke"][1], anchors["chimney"][1], cid)
            if content.kind_of(CONTENT, cid) == "building":
                self.assertIn("door", anchors, cid)
                self.assertIn("status", anchors, cid)

    def test_variants_levels_and_ships(self):
        models = self.manifest["models"]
        for house in ("house_settlers", "house_citizens"):
            self.assertEqual(len(models[house]["variants"]), 3, house)
        for cid in ("warehouse", "trading_post", "market"):
            self.assertEqual(sorted(models[cid]["levels"]), [str(i) for i in range(1, content.levels(CONTENT, cid) + 1)], cid)
        for cid in config.MODEL_SHIPS:
            ship = models[cid]["ship"]
            self.assertAlmostEqual(ship["length_tiles"], CONTENT["ships"][cid]["length_tiles"], places=6, msg=cid)
            self.assertIn("cargo", models[cid]["attachments"], cid)


if __name__ == "__main__":
    unittest.main()
