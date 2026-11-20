"""Tests of needs_gen.py (Python 3 standard library; part of `make check` via content-test)."""

import decimal
import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import needs_gen  # noqa: E402


class NeedsGenTest(unittest.TestCase):
    def setUp(self):
        with open(needs_gen.TIERS, encoding="utf-8") as f:
            self.tiers = json.load(f)
        with open(needs_gen.NEEDS, encoding="utf-8") as f:
            self.text = f.read()

    def test_needs_json_is_the_generator_output(self):
        # The drift test: needs.json is never typed by hand (D-080 §3).
        self.assertEqual(needs_gen.generate(self.text, self.tiers), self.text, "run make content-gen")

    def test_table_a_is_the_anno_rate(self):
        size = {t["id"]: t["residents"]["max"] for t in self.tiers}
        for good, tier, rate, counterpart in needs_gen.TABLE_A:
            got, anno_size = needs_gen.anno_rate(counterpart)
            self.assertEqual(str(got), rate, good)
            self.assertEqual(anno_size, size[tier], good)

    def test_carried_formula(self):
        # rate × (max_own / max_t) × 0.5^(d/3), six decimals: fish of the Settlers (6)
        # carried to the Citizens (14), Merchants (26) and Patricians (43).
        got = [str(needs_gen.carried("0.002975", 6, m, d)) for m, d in ((14, 1), (26, 2), (43, 3))]
        self.assertEqual(got, ["0.001012", "0.000432", "0.000208"])
        self.assertEqual(needs_gen.carried("0.000001", 6, 43, 3), decimal.Decimal("0.000000"))

    def test_every_rate_is_loadable(self):
        # The loader takes at most six decimals and no exponent (content.ParseFixed).
        numbers = re.findall(r'"per_resident_per_min": ([^ ,}]+)', self.text)
        self.assertEqual(len(numbers), sum(len(n.get("goods", [])) for n in json.loads(self.text)))
        for number in numbers:
            self.assertRegex(number, r"^0\.\d{1,6}$")
            self.assertGreater(decimal.Decimal(number), 0, number)


if __name__ == "__main__":
    unittest.main()
