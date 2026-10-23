import os
import tempfile
import unittest

import helpers  # noqa: F401
from nsassets import config, kits


class KitsTest(unittest.TestCase):
    def test_manifest_pins_licences_and_hashes(self):
        manifest = kits.load_manifest()
        ids = [k["id"] for k in manifest["kits"]]
        # The KayKit SOURCE editions only (the Quaternius and FREE kits were dropped).
        self.assertEqual(ids, ["kaykit_hexagon", "kaykit_forest"])
        for k in manifest["kits"]:
            self.assertEqual(k["author"], "Kay Lousberg")
            self.assertTrue(k["dir"].endswith("_1.0_SOURCE"), k["dir"])
            self.assertIn(k["id"], config.KIT_SCALE)
            self.assertEqual(k["licence"], "CC0-1.0")
            self.assertTrue(k.get("licence_file") or k.get("licence_url"))
            for rel, sha in k["files"].items():
                self.assertRegex(sha, r"^[0-9a-f]{64}$", rel)
        for k in manifest["kits"]:
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
        manifest = {"kits": [{"id": "kaykit_hexagon", "dir": "K", "files": {"a.gltf": "0" * 64, "b.bin": "1" * 64}}]}
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
