"""
Planned footprints (assets/voxel/planned) beneath the content (D-056):
the loader validates them, adds IDs the content lacks and lets the
content win per ID; the content directory override (NEW_SHORES_CONTENT_DIR).
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

VOXEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOXEL_DIR not in sys.path:
    sys.path.insert(0, VOXEL_DIR)

import build  # noqa: E402
from nsvoxel import config, content, model  # noqa: E402


def entry(cid, kind="producer", tier=2, footprint=(3, 4), **kw):
    e = {"id": cid, "kind": kind, "tier": tier, "footprint": list(footprint) if footprint else None, "water_tiles": 0, "slot": None}
    e.update(kw)
    return e


class PlannedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ns-planned-")
        shutil.copy(config.PLANNED_SCHEMA_PATH, self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, name, entries):
        with open(os.path.join(self.tmp, name), "w", encoding="utf-8") as f:
            json.dump(entries, f)

    def load(self):
        return content.load(config.CONTENT_DIR, planned_dir=self.tmp)

    def test_the_repository_files_are_valid(self):
        entries = content.load_planned()
        self.assertTrue(entries)
        self.assertEqual(len({e["id"] for e in entries}), len(entries))
        with open(config.PLANNED_SCHEMA_PATH, encoding="utf-8") as f:
            content.schema_mod.check_keywords(json.load(f))

    def test_planned_ids_are_added_beneath_the_content(self):
        self.write("tier9.json", [
            entry("cheese_test", smoke=True, footprint=(4, 5)),
            entry("farm_test", kind="farm"),
            entry("pen_test", kind="module", footprint=(3, 4)),
            entry("hall_test", kind="service", footprint=(6, 8)),
            entry("pier_test", kind="producer", water_tiles=3, slot="stone", footprint=(3, 8)),
            entry("brig_test", kind="ship", tier=3, footprint=None, slots=4),
        ])
        c = self.load()
        self.assertEqual(content.footprint(c, "cheese_test"), (4, 5))
        self.assertEqual(content.kind_of(c, "cheese_test"), "building")
        self.assertEqual(content.kind_of(c, "pen_test"), "field")
        self.assertEqual(content.kind_of(c, "brig_test"), "ship")
        self.assertEqual(c["buildings"]["cheese_test"]["tier"], "citizens")
        self.assertEqual(c["ships"]["brig_test"]["tier"], "merchants")
        self.assertTrue(content.is_planned(c, "brig_test"))
        self.assertFalse(content.is_planned(c, "sawmill"))
        self.assertEqual(c["buildings"]["pier_test"]["requires_deposit"], "stone")
        # Smoke only where flagged (producers that burn or cook): planned or content `smoke: true`.
        self.assertTrue(content.needs_smoke(c, "cheese_test"))
        self.assertFalse(content.needs_smoke(c, "farm_test"))
        self.assertFalse(content.needs_smoke(c, "hall_test"))
        self.assertTrue(content.needs_smoke(c, "smelter"))
        c["buildings"]["smelter"] = dict(c["buildings"]["smelter"], smoke=False)
        self.assertFalse(content.needs_smoke(c, "smelter"))
        self.assertEqual(content.life_anchors(c, "farm_test"), ["cart"])
        self.assertEqual(content.life_anchors(c, "pier_test"), ["cart", "boat"])
        required = content.required_ids(c)
        for cid in ("cheese_test", "farm_test", "pen_test", "hall_test", "pier_test", "brig_test"):
            self.assertIn(cid, required)
        self.assertEqual(sorted(set(required) - set(content.required_ids(content.load(config.CONTENT_DIR, planned_dir=None)))),
                         sorted(content.planned_ids(c)))

    def test_planned_ids_get_placeholders_with_their_anchors(self):
        self.write("tier9.json", [
            entry("cheese_test", smoke=True, footprint=(4, 5)),
            entry("pier_test", kind="producer", water_tiles=3, footprint=(3, 8)),
            entry("pen_test", kind="module", footprint=(3, 4)),
        ])
        c = self.load()
        for cid in ("cheese_test", "pier_test", "pen_test"):
            kind = content.kind_of(c, cid)
            recipe, placeholder = build.recipe_for(cid, kind, {})
            self.assertTrue(placeholder, cid)
            _, e, problems = model.build_id(cid, kind, recipe, c)
            self.assertEqual(problems, [], cid)
            self.assertEqual(e["footprint"], dict(zip("wh", content.footprint(c, cid))), cid)
            for a in model.required_anchors(c, cid):
                self.assertIn(a, e["anchors"], cid)
        self.assertIn("smoke", model.required_anchors(c, "cheese_test"))
        self.assertIn("boat", model.required_anchors(c, "pier_test"))

    def test_content_wins_and_levels_fill_in_only_where_the_content_has_none(self):
        self.write("a.json", [
            entry("fisher", footprint=(9, 9)),
            entry("chapel", kind="service", tier=1, footprint=(9, 9), levels=3),
            entry("market", kind="service", tier=1, footprint=(5, 6), levels=2),
            entry("trading_post", kind="service", tier=1, footprint=(6, 9), levels=2),
        ])
        base = content.load(config.CONTENT_DIR, planned_dir=None)
        c = self.load()
        self.assertEqual(content.footprint(c, "fisher"), content.footprint(base, "fisher"))
        self.assertEqual(content.footprint(c, "chapel"), content.footprint(base, "chapel"))
        self.assertFalse(content.is_planned(c, "fisher"))
        self.assertEqual(content.levels(base, "chapel"), 0)
        self.assertEqual(content.levels(c, "chapel"), 3)
        # The content's service levels (market, S1) win over the planned count.
        self.assertEqual(content.levels(base, "market"), 3)
        self.assertEqual(content.levels(c, "market"), 3)
        self.assertEqual(content.levels(c, "trading_post"), content.levels(base, "trading_post"))
        self.assertEqual(content.required_ids(c), content.required_ids(base))

    def test_invalid_files_name_every_problem(self):
        self.write("a.json", [
            entry("x_one", footprint=None),
            entry("x_two", kind="ship", footprint=None),
            entry("x_three", kind="service", smoke=True),
            entry("x_four", kind="field", footprint=(1, 1), water_tiles=2),
        ])
        self.write("b.json", [entry("x_one"), {"id": "x_five", "kind": "producer"}])
        with self.assertRaises(content.ContentError) as e:
            content.load_planned(self.tmp)
        msg = str(e.exception)
        self.assertIn("planned/a.json[0] 'x_one': ships (and only ships) have footprint null", msg)
        self.assertIn("planned/a.json[1] 'x_two': ships (and only ships) have slots", msg)
        self.assertIn("smoke is only for producers and farms", msg)
        self.assertIn("fields have no water rows", msg)
        self.assertIn("planned/b.json: $[1]: missing required field 'tier'", msg)
        self.write("b.json", [entry("x_one")])
        with self.assertRaises(content.ContentError) as e:
            content.load_planned(self.tmp)
        self.assertIn("planned/b.json[0] 'x_one': already planned in planned/a.json", str(e.exception))

    def test_no_directory_no_entries(self):
        self.assertEqual(content.load_planned(os.path.join(self.tmp, "nope")), [])


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
                b["footprint"] = [4, 9]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(buildings, f)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_default_is_the_repo_content_unless_the_env_is_set(self):
        with mock.patch.dict(os.environ, {config.CONTENT_ENV: ""}):
            self.assertEqual(config.content_dir(), config.CONTENT_DIR)
        with mock.patch.dict(os.environ, {config.CONTENT_ENV: self.tmp}):
            self.assertEqual(config.content_dir(), os.path.abspath(self.tmp))
            self.assertEqual(content.footprint(content.load(), "fisher"), (4, 9))


if __name__ == "__main__":
    unittest.main()
