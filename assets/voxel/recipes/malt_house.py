"""
Malt house (4 × 6; D-057 §3, V5): a long low malting floor of coursed
stone with a row of small shuttered vents and a tiled roof, and at its
end the square drying kiln rising above it to a steep pyramid roof
crowned by a timber cowl — the tallest element (the kiln's smoke rises
from it); sacks of barley, a barley heap on a threshing floor, a hoist
door and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT

ROOF = mat("terracotta", 1.0)
KILN_ROOF = mat("terracotta", 0.8)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 101
    P.yard(v, 0, 0, 32, 48, "dirt", seed=seed)
    P.yard(v, 0, 0, 32, 3, "grass", seed=seed)
    # Malting floor.
    b = P.building(v, 3, 4, 17, 40, "stone", along="y", height=9, roof=ROOF, seed=seed)
    for a in range(7, 38, 5):
        P.casement(b.face("x-"), a, 4, 2, 2, frame=Q.DRESSED, sill=Q.DRESSED, shutters=TIMBER_LIGHT, bars=False)
    P.entrance(b.face("y+"), 8, 2, 3, 5)
    # The kiln: a square stone tower, a steep roof and the cowl on top.
    x0, y0, x1, y1 = 17, 8, 29, 20
    P.plinth(v, x0, y0, x1, y1, 1, mat("stone", 0.84), out=1)
    P.coursed_stone(v, x0, y0, x1, y1, 1, 18, mat("stone", 1.0), seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 1, 18)
    r = P.roof(v, x0, x1, y0, y1, 18, "tiles", hip=True, rise=1.5, m=KILN_ROOF, seed=seed)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    top = r.ridge_z
    v.box(cx - 2, cy - 2, top - 1, cx + 2, cy + 2, top + 4, TIMBER)
    v.box(cx - 2, cy - 1, top + 1, cx + 2, cy + 1, top + 3, None)
    v.box(cx - 1, cy - 2, top + 1, cx + 1, cy + 2, top + 3, None)
    v.box(cx - 1, cy - 1, top + 1, cx + 1, cy + 1, top + 3, TIMBER_DARK)
    v.box(cx - 3, cy - 3, top + 4, cx + 3, cy + 3, top + 5, KILN_ROOF)
    v.box(cx - 2, cy - 2, top + 5, cx + 2, cy + 2, top + 6, KILN_ROOF)
    v.box(cx - 1, cy - 1, top + 6, cx + 1, cy + 1, top + 8, TIMBER_DARK)
    v.box(cx + 1, cy - 1, top + 7, cx + 3, cy + 1, top + 8, TIMBER_DARK)  # the vane
    v.anchor("chimney", cx, cy, top + 6)
    v.anchor("smoke", cx, cy, top + 9)
    F = P.Face(v, "y+", y1 - 1)
    P.entrance(F, 21, 2, 3, 5)
    P.entrance(F, 21, 11, 3, 3, step=None, hinges=False)  # hoist door
    v.box(22, y1, 16, 23, y1 + 3, 17, TIMBER_DARK)
    v.box(22, y1 + 2, 12, 23, y1 + 3, 16, mat("canvas", 0.85))
    # Barley: a heap on the threshing floor, sacks, a cart.
    v.box(19, 24, 0, 30, 34, 1, mat("road-dirt", 0.9))
    Q.heap(v, 24, 29, 3.5, 3.5, 2.5, lambda x, y, z: WHEAT if z % 2 else mat("wheat", 0.9))
    P.sacks(v, 19, 36, 1, n=4, m=CANVAS)
    P.sacks(v, 21, 36, 3, n=2, m=CANVAS)
    P.handcart(v, 4, 42, 1, along="x", load=CANVAS)
    v.anchor("cart", 16, 46, 1)
    P.scatter(v, 0, 0, 32, 4, 0.04, seed=seed)
    _ = TIMBER
    return P.colour_jitter(v, seed=seed)
