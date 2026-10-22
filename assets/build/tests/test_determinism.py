"""Two Blender builds of a small recipe set give identical bytes (skipped without Blender or the kits)."""

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import helpers  # noqa: F401
from nsassets import config, kits


def find_blender():
    for c in (os.environ.get("BLENDER"), "/opt/homebrew/bin/blender", shutil.which("blender")):
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def skip_reason():
    if find_blender() is None:
        return "Blender not found"
    try:
        kits.verify(kits.load_manifest())
    except kits.KitError:
        return f"kits not present (set {config.KITS_ENV})"
    return None


REASON = skip_reason()
if REASON:
    print(f"\nassets-test: determinism test skipped ({REASON})", file=sys.stderr)


@unittest.skipIf(REASON is not None, REASON or "")
class DeterminismTest(unittest.TestCase):
    def build(self, out):
        script = os.path.join(config.BUILD_DIR, "build.py")
        cmd = [find_blender(), "-b", "--factory-startup", "--python-exit-code", "1", "--python", script, "--",
               "--out", out, "--no-sheets", "--only", "pasture,sloop,lumberjack"]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])

    def digests(self, d):
        out = {}
        for f in sorted(os.listdir(d)):
            with open(os.path.join(d, f), "rb") as fh:
                out[f] = hashlib.sha256(fh.read()).hexdigest()
        return out

    def test_two_builds_are_identical(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            self.build(a)
            self.build(b)
            da, db = self.digests(a), self.digests(b)
            self.assertIn("manifest.json", da)
            self.assertIn("sloop.cargo.glb", da)
            self.assertEqual(da, db)


if __name__ == "__main__":
    unittest.main()
