import os
import tempfile
import unittest

import helpers  # noqa: F401
from nsassets import config, kits


class KitsTest(unittest.TestCase):
    def test_manifest_pins_licences_and_hashes(self):
        manifest = kits.load_manifest()
        ids = [k["id"] for k in manifest["kits"]]
        self.assertEqual(ids, ["medieval", "pirate", "kaykit_hexagon", "kaykit_forest"])
        authors = {"medieval": "Quaternius", "pirate": "Quaternius", "kaykit_hexagon": "Kay Lousberg", "kaykit_forest": "Kay Lousberg"}
        for k in manifest["kits"]:
            self.assertEqual(k["author"], authors[k["id"]])
            self.assertIn(k["id"], config.KIT_SCALE)
            self.assertEqual(k["licence"], "CC0-1.0")
            self.assertTrue(k.get("licence_file") or k.get("licence_url"))
            for rel, sha in k["files"].items():
                self.assertRegex(sha, r"^[0-9a-f]{64}$", rel)
        medieval = manifest["kits"][0]
        self.assertIn("License_Source.txt", medieval["files"])
        for k in manifest["kits"][2:]:
            self.assertEqual(k["licence_file"], "License.txt")
            self.assertIn("License.txt", k["files"])

    def test_empty_kit_root_lists_every_missing_file(self):
        manifest = kits.load_manifest()
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(kits.KitError) as ctx:
                kits.verify(manifest, root=root)
        msg = str(ctx.exception)
        self.assertIn("assets/kits/README.md", msg)
        for k in manifest["kits"]:
            self.assertIn(f"missing kit directory {k['dir']}/", msg)
            for rel in k["files"]:
                self.assertIn(f"missing {k['dir']}/{rel}", msg)

    def test_changed_file_is_reported(self):
        manifest = {"kits": [{"id": "medieval", "dir": "K", "files": {"a.gltf": "0" * 64, "b.bin": "1" * 64}}]}
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "K"))
            with open(os.path.join(root, "K", "a.gltf"), "w") as f:
                f.write("{}")
            with self.assertRaises(kits.KitError) as ctx:
                kits.verify(manifest, root=root)
        self.assertIn("changed K/a.gltf (sha256 differs from MANIFEST.json)", str(ctx.exception))
        self.assertIn("missing K/b.bin", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
