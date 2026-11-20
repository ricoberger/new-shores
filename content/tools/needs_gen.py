#!/usr/bin/env python3
"""Generates the goods rates of content/old_coast/needs.json (D-080).

Table A of D-080 is the source: every consumption good with its own tier,
its per-resident rate (the Anno 117 counterpart's per-house rate divided
by the Anno house size) and the counterpart it comes from. The own-tier
needs take the rate as it is; every carried need (`from_tier`) takes the
D-056 formula

    rate × (max_own / max_t) × 0.5^(distance / 3)

with the house sizes (`residents.max`) of tiers.json, rounded half-even to
the content's resolution of six decimal places (micro-units; the loader
rejects more). Everything else in needs.json (IDs, weights, building and
chain needs, the file's layout) is copied through unchanged: only the
`per_resident_per_min` numbers are rewritten.

    python3 content/tools/needs_gen.py          write needs.json (make content-gen)
    python3 content/tools/needs_gen.py --check  exit 1 if needs.json differs

Python 3 standard library only.
"""

import argparse
import decimal
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGION = os.path.join(ROOT, "old_coast")
NEEDS = os.path.join(REGION, "needs.json")
TIERS = os.path.join(REGION, "tiers.json")

# Table A (D-080): good, own tier, rate per resident per minute (the Anno
# counterpart's per-house rate / its house size, six decimals), counterpart.
TABLE_A = [
    ("fish", "settlers", "0.002975", "Sardines 0.01785 / 6"),
    ("wool_garments", "settlers", "0.002975", "Tunics 0.01785 / 6"),
    ("bread", "citizens", "0.001156", "Bread 0.016185 / 14"),
    ("cheese", "citizens", "0.000621", "Garum 0.0087 / 14 (role: second food)"),
    ("cider", "citizens", "0.001099", "Wine 0.015385 / 14 (Anno food)"),
    ("mead", "citizens", "0.000621", "Garum 0.0087 / 14 (role)"),
    ("linen_garments", "citizens", "0.001018", "Soap 0.01425 / 14 (Anno fashion, first)"),
    ("leather_jerkins", "citizens", "0.000465", "Sandals 0.006504 / 14"),
    ("sausages", "merchants", "0.000431", "Dates 0.0112 / 26 (role: first regular food)"),
    ("pies", "merchants", "0.000220", "Cheese 0.005725 / 26"),
    ("beer", "merchants", "0.000496", "Wine 0.012902 / 26"),
    ("brandy", "merchants", "0.000220", "Cheese 0.005725 / 26 (role)"),
    ("coats", "merchants", "0.000385", "Togas 0.01 / 26"),
    ("dyed_garments", "merchants", "0.000218", "Brooches 0.005669 / 26"),
    ("books", "merchants", "0.000192", "Writing Tablets 0.005001 / 26"),
    ("soap", "merchants", "0.000189", "Fine Glass 0.004922 / 26 (role)"),
    ("roast_beef", "patricians", "0.000175", "Oysters with Caviar 0.007528 / 43 (first food)"),
    ("oysters", "patricians", "0.000140", "Bird Tongues 0.006012 / 43"),
    ("wine", "patricians", "0.000140", "Bird Tongues 0.006012 / 43 (role)"),
    ("grain_spirit", "patricians", "0.000130", "Kayk 0.005594 / 43"),
    ("fine_garments", "patricians", "0.000201", "Cloaks 0.008658 / 43"),
    ("lace", "patricians", "0.000127", "Necklaces 0.0054645 / 43"),
    ("candles", "patricians", "0.000119", "Ivory Caskets 0.005102 / 43"),
    ("spectacles", "patricians", "0.000104", "Handmirrors 0.004474 / 43"),
    ("jewellery", "patricians", "0.000124", "Latrunculi Sets 0.005333 / 43"),
    ("instruments", "patricians", "0.000158", "Standing Lyres 0.006814 / 43"),
]

PLACES = decimal.Decimal("0.000001")
CTX = decimal.Context(prec=34, rounding=decimal.ROUND_HALF_EVEN)


def anno_rate(counterpart):
    """The per-resident rate the counterpart string states (per house / size)."""
    m = re.match(r"[^0-9]*([0-9.]+) / ([0-9]+)", counterpart)
    per_house, size = decimal.Decimal(m.group(1)), decimal.Decimal(m.group(2))
    return CTX.divide(per_house, size).quantize(PLACES, context=CTX), int(size)


def carried(rate, max_own, max_t, distance):
    """The D-056 carry formula, six decimals, half-even."""
    factor = CTX.power(decimal.Decimal("0.5"), CTX.divide(decimal.Decimal(distance), decimal.Decimal(3)))
    value = CTX.multiply(CTX.multiply(decimal.Decimal(rate), CTX.divide(decimal.Decimal(max_own), decimal.Decimal(max_t))), factor)
    return value.quantize(PLACES, context=CTX)


def rates(needs, tiers):
    """need ID -> [(good, rate as a six-decimal string)] for every goods need."""
    index = {t["id"]: i for i, t in enumerate(tiers)}
    size = {t["id"]: t["residents"]["max"] for t in tiers}
    own_rate = {}
    for good, tier, rate, _ in TABLE_A:
        if good in own_rate:
            raise SystemExit("table A lists %s twice" % good)
        own_rate[good] = (tier, rate)
    own = {}
    out = {}
    for n in needs:
        if "goods" not in n or n.get("from_tier"):
            continue
        rows = []
        for g in n["goods"]:
            tier, rate = own_rate.get(g["good"], (None, None))
            if tier != n["tier"]:
                raise SystemExit("%s: %s is not a %s good of table A" % (n["id"], g["good"], n["tier"]))
            rows.append((g["good"], rate))
        own[(n["tier"], n["category"])] = rows
        out[n["id"]] = rows
    for n in needs:
        if "goods" not in n or not n.get("from_tier"):
            continue
        src = own.get((n["from_tier"], n["category"]))
        if src is None or [g for g, _ in src] != [g["good"] for g in n["goods"]]:
            raise SystemExit("%s does not carry the goods of %s %s" % (n["id"], n["from_tier"], n["category"]))
        distance = index[n["tier"]] - index[n["from_tier"]]
        out[n["id"]] = [(g, str(carried(r, size[n["from_tier"]], size[n["tier"]], distance))) for g, r in src]
    used = {g for rows in own.values() for g, _ in rows}
    missing = sorted(set(own_rate) - used)
    if missing:
        raise SystemExit("table A goods without an own need: %s" % ", ".join(missing))
    return out


def generate(text, tiers):
    """needs.json text with every goods rate rewritten."""
    needs = json.loads(text)
    table = rates(needs, tiers)
    entries = [m.start() for m in re.finditer(r'\n  \{\n    "id": "', text)] + [len(text)]
    parts = [text[: entries[0]]]
    for a, z in zip(entries, entries[1:]):
        block = text[a:z]
        nid = re.search(r'"id": "([^"]+)"', block).group(1)
        for good, rate in table.get(nid, []):
            block, n = re.subn(
                r'(\{ "good": "%s", "per_resident_per_min": )[0-9.]+( \})' % re.escape(good),
                lambda m: m.group(1) + rate + m.group(2),
                block,
            )
            if n != 1:
                raise SystemExit("%s: %s rate not found once in needs.json" % (nid, good))
        parts.append(block)
    out = "".join(parts)
    json.loads(out)
    return out


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if needs.json differs from the output")
    args = parser.parse_args(argv)
    for good, _, rate, counterpart in TABLE_A:
        if str(anno_rate(counterpart)[0]) != rate:
            raise SystemExit("%s: rate %s, counterpart %s gives %s" % (good, rate, counterpart, anno_rate(counterpart)[0]))
    with open(TIERS, encoding="utf-8") as f:
        tiers = json.load(f)
    for good, tier, _, counterpart in TABLE_A:
        size = anno_rate(counterpart)[1]
        if size != next(t["residents"]["max"] for t in tiers if t["id"] == tier):
            raise SystemExit("%s: Anno house size %d differs from the %s max in tiers.json" % (good, size, tier))
    with open(NEEDS, encoding="utf-8") as f:
        text = f.read()
    out = generate(text, tiers)
    if args.check:
        if out != text:
            print("content/old_coast/needs.json differs from content/tools/needs_gen.py; run make content-gen", file=sys.stderr)
            return 1
        return 0
    if out != text:
        with open(NEEDS, "w", encoding="utf-8") as f:
            f.write(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
