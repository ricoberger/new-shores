"""The content directory override (build.py --content, NEW_SHORES_CONTENT_DIR)."""

import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

import helpers  # noqa: F401  (puts assets/build on sys.path)
import build
from nsassets import config, content


class ContentOverrideTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ns-content-")
        for f in ("buildings.json", "ships.json"):
            shutil.copy(os.path.join(config.CONTENT_DIR, f), self.tmp)
        path = os.path.join(self.tmp, "buildings.json")
        with open(path, encoding="utf-8") as f:
            buildings = json.load(f)
        for b in buildings:
            if b["id"] == "fisher":
                b["footprint"] = [3, 8]
                b["water_tiles"] = 3
        with open(path, "w", encoding="utf-8") as f:
            json.dump(buildings, f)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_default_is_the_repo_content_unless_the_env_is_set(self):
        with mock.patch.dict(os.environ, {config.CONTENT_ENV: ""}):
            self.assertEqual(config.content_dir(), config.CONTENT_DIR)
        with mock.patch.dict(os.environ, {config.CONTENT_ENV: self.tmp}):
            self.assertEqual(config.content_dir(), os.path.abspath(self.tmp))
            self.assertEqual(content.footprint(content.load(), "fisher"), (3, 8))

    def test_flag_overrides_the_env_and_feeds_footprints_and_water_rows(self):
        with mock.patch.dict(os.environ, {config.CONTENT_ENV: ""}):
            args = build.parse(["build.py", "--", "validate", "--content", self.tmp])
        self.assertEqual(args.content, self.tmp)
        c = content.load(args.content)
        self.assertEqual(content.footprint(c, "fisher"), (3, 8))
        self.assertEqual(content.ground_range(c, "fisher"), config.GROUND_RANGE_WATER_EDGE)
        self.assertEqual(content.required_ids(c), content.required_ids(content.load(config.CONTENT_DIR)))
        with mock.patch.dict(os.environ, {config.CONTENT_ENV: self.tmp}):
            self.assertEqual(build.parse(["build.py"]).content, os.path.abspath(self.tmp))


if __name__ == "__main__":
    unittest.main()
