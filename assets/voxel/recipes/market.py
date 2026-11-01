"""
Market place (5 × 6, levels 1–3; D-057 §3): a paved square with a kerb,
striped stalls with goods in baskets and crates round a roofed well,
benches, trees, barrels and sacks; level 2 adds a timber-framed market
hall over an open arcade, level 3 a coursed-ochre-stone hall with dressed
quoins, shuttered windows and a bell turret. The content's level 4
(D-065) has no model yet: the client draws level 3.
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, OCHRE, PLASTER, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT, BRASS, WHEAT, APPLE, DYE_BLUE

STRIPES = (mat("dye-blue"), mat("terracotta"), mat("ochre"), mat("hemp-mark", 1.2))
#: Modelled levels; the content's level 4 (D-065) may follow in a later model round.
LEVELS = 3

GOODS = (WHEAT, APPLE, mat("orchard"), mat("canvas", 0.9), mat("timber", 1.4))


def stall(v, x, y, k, face="y+"):
    """A 6 × 4 stall: counter with goods, four posts, a striped canvas roof sloping to the front."""
    stripe = STRIPES[k % len(STRIPES)]
    v.box(x, y + 2, 1, x + 6, y + 4, 3, TIMBER_LIGHT)
    for i in range(6):
        v.set(x + i, y + 2 + (i % 2), 3, GOODS[(k + i) % len(GOODS)])
    for px, py in ((x, y), (x + 5, y), (x, y + 3), (x + 5, y + 3)):
        v.box(px, py, 1, px + 1, py + 1, 6, TIMBER)
    for j in range(5):
        for i in range(-1, 7):
            v.set(x + i, y - 1 + j, 7 - j // 2, stripe if (i // 2) % 2 == 0 else CANVAS)
    P.box_crate(v, x + 1, y, 1, contents=GOODS[(k + 2) % len(GOODS)])
    P.cask(v, x + 4, y, 1, h=2)


def build(ctx):
    v = ctx.vox()
    lv = ctx.level
    seed = 50 + lv
    W, D = ctx.W, ctx.D  # 40 × 48
    P.yard(v, 0, 0, W, D, "paved", seed=seed)
    # A low kerb of darker stone round the square.
    P.edging(v, [(x, y) for x in range(W) for y in (0, D - 1)] + [(x, y) for y in range(D) for x in (0, W - 1)])
    P.well(v, 20, 28)
    k = 0
    for x in (3, 31):
        for y in (22, 30, 38):
            stall(v, x, y, k)
            k += 1
    for x in (12, 23):
        stall(v, x, 39, k)
        k += 1
    # Benches and trees at the corners.
    P.tree(v, 3, 44, 1, "broad", seed)
    P.tree(v, 36, 44, 1, "broad", seed + 1)
    P.bench(v, 14, 33, 1, 4)
    P.bench(v, 23, 33, 1, 4)
    P.lamp_post(v, 12, 27)
    P.lamp_post(v, 28, 27)
    if lv == 1:
        for x in (6, 16, 26):
            stall(v, x, 6, k)
            k += 1
        P.cask(v, 34, 8, 1)
        P.cask(v, 36, 10, 1)
        P.sacks(v, 33, 13, 1, n=2)
        P.bale(v, 3, 12, 1, 3, 2, 2)
        P.handcart(v, 3, 15, 1, along="x", load=WHEAT)
        return P.colour_jitter(v, seed=seed, ground=0.4)
    # Market hall across the back: open arcade below, hall above.
    x0, y0, x1, y1 = 4, 3, 36, 17
    wall = PLASTER if lv == 2 else OCHRE
    for x in range(x0, x1, 4):
        for y in (y0, y1 - 1):
            v.box(x, y, 1, x + 2 if lv == 3 else x + 1, y + 1, 8, STONE if lv == 3 else TIMBER)
    v.box(x0, y0, 1, x1, y1, 1, None)
    v.box(x0, y0, 8, x1, y1, 9, TIMBER_DARK)
    if lv == 2:
        P.half_timber(v, x0, y0, x1, y1, 9, 15, wall, TIMBER, spacing=4, braces=("x-", "x+"))
    else:
        P.coursed_stone(v, x0, y0, x1, y1, 9, 16, mat("ochre", 1.0), seed)
        P.dressed_quoins(v, x0, y0, x1, y1, 9, 16)
    zt = 15 if lv == 2 else 16
    F = P.Face(v, "y+", y1 - 1)
    for a in range(x0 + 3, x1 - 3, 6):
        if lv == 2:
            P.casement(F, a, zt - 5, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=None)
        else:
            P.casement(F, a, zt - 5, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED, shutters=DYE_BLUE)
    r = P.roof(v, x0, x1, y0, y1, zt, "tiles", along="x", gable=wall, seed=seed)
    top = r.top - 1
    for x in range(x0 + 2, x1 - 2, 6):
        stall(v, x, y0 + 5, k)
        k += 1
    if lv == 3:
        # Bell turret on the ridge.
        tx, ty = 18, 8
        v.box(tx, ty, top - 2, tx + 4, ty + 4, top + 5, STONE)
        v.box(tx + 1, ty, top + 1, tx + 3, ty + 4, top + 4, None)
        v.box(tx + 1, ty + 1, top + 2, tx + 3, ty + 3, top + 4, BRASS)
        P.roof(v, tx, tx + 4, ty, ty + 4, top + 5, "tiles", hip=True, eaves=False, seed=seed)
    return P.colour_jitter(v, seed=seed, ground=0.4)
