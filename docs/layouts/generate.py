#!/usr/bin/env python3
"""Chain layout generator (standard library only).

Declares a layout as buildings on a tile grid, validates it against the
placement rules in docs/MECHANICS.md (§2 fields, §3 roads, §5 collectors) using
the numbers from content/old_coast/buildings.json, and renders an SVG in the
style of the Anno 1800 "layout" diagrams (coloured blocks per farm group, grey
roads, stats panel).

Usage: python3 docs/layouts/generate.py   (writes docs/layouts/<chain>.svg)
"""
import json
import math
import os
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CONTENT = os.path.join(ROOT, "content", "old_coast")
B = {b["id"]: b for b in json.load(open(os.path.join(CONTENT, "buildings.json")))}
DE = json.load(open(os.path.join(CONTENT, "i18n", "de.json")))
CELL = 36

LIGHT, DARK, WATER = "#5fb07a", "#25601a", "#6edcd0"


class Layout:
    def __init__(self, title):
        self.title = title
        self.items = []  # dict(id, kind, x, y, w, h, group, farm)
        self.roads = set()

    def add(self, bid, x, y, group, farm=None, rot=False):
        w, h = B[bid]["footprint"]
        if rot:
            w, h = h, w
        self.items.append(dict(id=bid, x=x, y=y, w=w, h=h, group=group, farm=farm))
        return len(self.items) - 1

    def road(self, x0, y0, x1, y1):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                self.roads.add((x, y))

    def lv(self, i):
        b = B[self.items[i]["id"]]
        return (b.get("warehouse") or b["trading_post"])["levels"][0]

    @staticmethod
    def tiles(it):
        return {(it["x"] + i, it["y"] + j) for i in range(it["w"]) for j in range(it["h"])}

    def validate(self):
        errs, seen = [], {}
        for n, it in enumerate(self.items):
            for t in self.tiles(it):
                if t in seen:
                    errs.append(f"overlap {it['id']}#{n} / {self.items[seen[t]]['id']}#{seen[t]} at {t}")
                if t in self.roads:
                    errs.append(f"{it['id']}#{n} on road {t}")
                seen[t] = n

        def road_adjacent(it):
            return any(
                (x + dx, y + dy) in self.roads
                for (x, y) in self.tiles(it)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )

        def edge_adjacent(a, b):
            return any(
                (x + dx, y + dy) in self.tiles(b)
                for (x, y) in self.tiles(a)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )

        # road connectivity to a collector (flood fill over road tiles)
        coll = [i for i, it in enumerate(self.items) if "warehouse" in B[it["id"]] or "trading_post" in B[it["id"]]]
        comp, stack = set(), []
        for i in coll:
            for (x, y) in self.tiles(self.items[i]):
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if (x + dx, y + dy) in self.roads:
                        stack.append((x + dx, y + dy))
        while stack:
            t = stack.pop()
            if t in comp:
                continue
            comp.add(t)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if (t[0] + dx, t[1] + dy) in self.roads:
                    stack.append((t[0] + dx, t[1] + dy))

        rate = 0.0
        for n, it in enumerate(self.items):
            b = B[it["id"]]
            if "recipe" in b:
                if not road_adjacent(it) or not any(
                    (x + dx, y + dy) in comp
                    for (x, y) in self.tiles(it)
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                ):
                    errs.append(f"{it['id']}#{n} not connected to a collector")
                rate += sum(o["amount"] for o in b["recipe"]["outputs"]) * 60 / b["recipe"]["cycle_seconds"]
                # reach: Euclidean distance between nearest tile centres
                best = min(
                    min(math.hypot(a[0] - c[0], a[1] - c[1]) for a in self.tiles(it) for c in self.tiles(self.items[i]))
                    for i in coll
                )
                reach = self.lv(coll[0])["reach"]
                if best > reach:
                    errs.append(f"{it['id']}#{n} out of reach ({best:.1f} > {reach})")
            if "field" in b:
                if self.items[it["farm"]]["id"] not in (
                    [b["field"]["farm"]] if isinstance(b["field"]["farm"], str) else b["field"]["farm"]
                ):
                    errs.append(f"{it['id']}#{n} wrong farm")
        # fields: active chain per farm
        for fi, f in enumerate(self.items):
            if "recipe" in B[f["id"]] and "fields" in B[f["id"]]:
                mine = [i for i, it in enumerate(self.items) if it["farm"] == fi]
                active, frontier = set(), [fi]
                while frontier:
                    cur = frontier.pop()
                    for j in mine:
                        if j not in active and edge_adjacent(self.items[cur], self.items[j]):
                            active.add(j)
                            frontier.append(j)
                need = B[f["id"]]["fields"]["required"]
                if len(active) != need or len(mine) != need:
                    errs.append(f"{f['id']}#{fi}: {len(active)} active / {len(mine)} placed / {need} required")
        tw = sum(self.lv(i)["throughput_per_min"] for i in coll)
        if rate > tw:
            errs.append(f"collector overload R={rate:.2f} > T={tw}")
        return errs, rate, tw

    def stats(self):
        xs = [t[0] for it in self.items for t in self.tiles(it)] + [r[0] for r in self.roads]
        ys = [t[1] for it in self.items for t in self.tiles(it)] + [r[1] for r in self.roads]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        used = sum(it["w"] * it["h"] for it in self.items)
        return x0, y0, bw, bh, used

    def svg(self):
        x0, y0, bw, bh, used = self.stats()
        errs, rate, cap = self.validate()
        assert not errs, errs
        pad, panel = 1, 330
        W = (bw + 2 * pad) * CELL + panel
        H = max((bh + 2 * pad) * CELL, 420)
        o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="Helvetica,Arial,sans-serif">',
             f'<rect width="{W}" height="{H}" fill="#fff"/>']
        # bounding box grid
        for i in range(bw + 2 * pad):
            for j in range(bh + 2 * pad):
                o.append(f'<rect x="{i*CELL}" y="{j*CELL}" width="{CELL}" height="{CELL}" fill="#fff" stroke="#000" stroke-width="1"/>')

        def px(x, y):
            return (x - x0 + pad) * CELL, (y - y0 + pad) * CELL

        for (x, y) in sorted(self.roads):
            a, b = px(x, y)
            o.append(f'<rect x="{a}" y="{b}" width="{CELL}" height="{CELL}" fill="#aaa" stroke="#000"/>')
        label = {"sheep_farm": "Sheep", "pasture": "", "weaver_wool": "Weaver", "warehouse": "Warehouse", "trading_post": "Trading Post"}
        for it in self.items:
            a, b = px(it["x"], it["y"])
            col = WATER if it["id"] in ("warehouse", "trading_post") else (LIGHT if it["group"] % 2 == 0 else DARK)
            if it["id"] == "weaver_wool":
                col = "#e6dfa0" if it["group"] % 2 == 0 else "#a9a35a"
            if it["id"] == "sheep_farm":
                col = "#2f8f55" if it["group"] % 2 == 0 else "#173d10"
            w, h = it["w"] * CELL, it["h"] * CELL
            o.append(f'<rect x="{a}" y="{b}" width="{w}" height="{h}" fill="{col}" stroke="#000" stroke-width="2"/>')
            if it["id"] == "pasture":
                cx, cy, r = a + w / 2, b + h / 2, CELL * 0.9
                o.append(f'<polygon points="{cx},{cy-r} {cx+r},{cy} {cx},{cy+r} {cx-r},{cy}" fill="#8fb44a" stroke="#7a5a2c" stroke-width="4"/>')
            else:
                tc = "#000" if it["id"] in ("weaver_wool", "warehouse", "trading_post") else "#fff"
                o.append(f'<text x="{a+w/2}" y="{b+h/2+5}" text-anchor="middle" font-size="15" font-weight="bold" fill="{tc}">{label[it["id"]]}</text>')
        # panel
        px0 = (bw + 2 * pad) * CELL + 20
        counts = {}
        for it in self.items:
            counts[it["id"]] = counts.get(it["id"], 0) + 1
        box = bw * bh
        lines = [("Bounding Box", [f"{bw}x{bh}", f"{box} Tiles"]),
                 ("Space Efficiency", [f"{round(100*used/box)}%  ({used} building tiles)"]),
                 ("Buildings", [f"{n} x {B[i]['name']}" for i, n in counts.items()]),
                 ("Throughput", [f"R / T = {rate:.2f} / {cap} per min"])]
        y = 40
        for head, rows in lines:
            o.append(f'<text x="{px0}" y="{y}" font-size="22" font-weight="bold">{escape(head)}</text>')
            y += 28
            for r in rows:
                o.append(f'<text x="{px0+12}" y="{y}" font-size="19">{escape(r)}</text>')
                y += 26
            y += 18
        o.append("</svg>")
        return "\n".join(o)

    def report(self):
        x0, y0, bw, bh, used = self.stats()
        errs, rate, cap = self.validate()
        counts = {}
        for it in self.items:
            counts[it["id"]] = counts.get(it["id"], 0) + 1
        gold = sum(B[i]["cost"].get("gold", 0) * n for i, n in counts.items())
        planks = sum(B[i]["cost"].get("planks", 0) * n for i, n in counts.items())
        upkeep = sum(B[i]["upkeep_per_min"] * n for i, n in counts.items())
        workers = sum(B[i].get("workforce", {}).get("amount", 0) * n for i, n in counts.items())
        print(self.title, f"box {bw}x{bh}={bw*bh}", f"used {used} ({100*used/(bw*bh):.0f}%)", f"roads {len(self.roads)}",
              f"gold {gold} planks {planks} upkeep {upkeep}/min workers {workers}", f"R/T {rate:.2f}/{cap}", "errors:", errs)


def wool_no_warehouse():
    """Same modules without a warehouse: the Trading Post is the collector."""
    L = Layout("Wool (Trading Post only)")
    L.road(6, 0, 6, 17)
    L.add("trading_post", 3, 18, -1)
    g = 0
    for bx, px in ((3, 0), (7, 10)):
        f = L.add("sheep_farm", bx, 0, g)
        for k in range(3):
            L.add("pasture", px, 3 * k, g, farm=f)
        L.add("weaver_wool", bx, 3, g)
        g += 1
        f = L.add("sheep_farm", bx, 15, g)
        for k in range(3):
            L.add("pasture", px, 9 + 3 * k, g, farm=f)
        L.add("weaver_wool", bx, 11, g)
        g += 1
    return L


def wool():
    L = Layout("Wool")
    # Pasture column (3 wide) | building column (3 wide) | road | building column | pasture column.
    # Each side: module 1 (farm on top, weaver below), warehouse in the middle of the spine,
    # module 2 mirrored vertically (weaver above, farm at the bottom).
    L.road(6, 0, 6, 6)
    L.road(6, 13, 6, 19)
    wh = L.add("warehouse", 3, 7, -1)
    g = 0
    for side in ("L", "R"):
        bx = 3 if side == "L" else 7   # building column x
        px = 0 if side == "L" else 10  # pasture column x
        # module 1 (top)
        f = L.add("sheep_farm", bx, 0, g)
        for k in range(3):
            L.add("pasture", px, 3 * k, g, farm=f)
        L.add("weaver_wool", bx, 3, g)
        g += 1
        # module 2 (bottom, mirrored)
        f = L.add("sheep_farm", bx, 17, g)
        for k in range(3):
            L.add("pasture", px, 11 + 3 * k, g, farm=f)
        L.add("weaver_wool", bx, 13, g)
        g += 1
    return L


if __name__ == "__main__":
    for name, fn in (("wool", wool), ("wool_no_warehouse", wool_no_warehouse)):
        lay = fn()
        lay.report()
        with open(os.path.join(HERE, f"{name}.svg"), "w") as fh:
            fh.write(lay.svg())
