"""
Paper mill (4 × 6; D-057 §3): a long two-storey drying hall — stone
ground floor, a timber upper storey with louvred sides for the air, a
red tile roof — with a vat house on its west side (rag vat, smoke
chimney), a big screw press under a lean-to, stacks of paper and reams
on pallets, rag bales and a cart. No water wheel.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

PAPER = mat("plaster", 1.12)
RAG = mat("canvas", 0.95)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 149
    P.yard(v, 0, 0, 32, 48, "grass", seed=seed)
    P.yard(v, 0, 24, 32, 48, "dirt", seed=seed)
    # Drying hall along y on the east: stone ground floor, louvred timber loft.
    x0, x1, y0, y1 = 14, 30, 2, 30
    P.plinth(v, x0, y0, x1, y1)
    P.coursed_stone(v, x0, y0, x1, y1, 1, 8, seed=seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 1, 8)
    P.jetty_course(v, x0, y0, x1, y1, 8)
    v.box(x0, y0, 9, x1, y1, 17, TIMBER_DARK)
    for side, a0, a1 in (("x-", y0 + 1, y1 - 1), ("y+", x0 + 1, x1 - 1)):
        F = P.Face(v, side, x0 if side == "x-" else y1 - 1)
        V.louvres(F, a0, a1, 9, 17)
        for a in range(a0 - 1, a1 + 1, 4):
            for z in range(9, 17):
                F.put(a, z, TIMBER, out=1)
    r = P.roof(v, x0, x1, y0, y1, 17, "tiles", along="y", rise=1.3, seed=seed)
    f = P.Face(v, "y+", y1 - 1)
    P.barn_gate(f, 19, 1, 5, 6)
    P.casement(P.Face(v, "x-", x0), 6, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(P.Face(v, "x-", x0), 24, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    # Vat house on the west: stone, tiled, a chimney (smoke), the rag vat.
    b = P.building(v, 2, 4, 13, 14, "stone", along="x", seed=seed, height=8)
    P.entrance(b.face("y+"), 5, 2, 3, 5)
    P.casement(b.face("x-"), 8, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED)
    P.roof_chimney(v, b.roof, 4, 8, above=3, brick=True, anchor=True)
    # Screw press under a lean-to.
    P.lean_to(v, 2, 13, 16, 26, 10, "tiles", down="x-", posts=True)
    for x in (4, 10):
        v.box(x, 19, 1, x + 1, 21, 9, TIMBER_DARK)
    v.box(4, 19, 8, 11, 21, 9, TIMBER_DARK)
    v.box(7, 19, 4, 8, 21, 8, IRON)
    v.box(5, 18, 3, 10, 22, 4, TIMBER)
    V.stack(v, 5, 19, 10, 21, 1, 2, PAPER, every=1, band=PAPER)
    v.box(6, 21, 6, 11, 22, 7, TIMBER_LIGHT)  # the bar
    V.vat(v, 7, 24.5, 1, r=1.8, h=3, liquid=RAG)
    # Paper stacks, reams on pallets, rag bales, cart.
    for x, h in ((4, 4), (8, 3), (12, 5)):
        v.box(x, 30, 0, x + 3, 33, 1, TIMBER)
        V.stack(v, x, 30, x + 3, 33, 1, h, PAPER)
    for x in (18, 22):
        P.bale(v, x, 33, 1, w=3, d=2, h=2, m=RAG)
    P.sacks(v, 26, 33, 1, n=2, m=CANVAS)
    P.handcart(v, 4, 39, 1, along="x", load=PAPER)
    P.lamp_post(v, 13, 40)
    v.anchor("cart", 20, 44, 1)
    P.scatter(v, 0, 34, 32, 48, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
