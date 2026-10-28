"""
Dairy farm (4 × 5; D-057 §3): a farmhouse (coursed stone, thatch, a
chimney with smoke) and a cow byre of vertical boards with a wide door
and a hay loft; milk churns on a stand, hay bales, a manure heap, a
water trough and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, IRON, STONE_DARK, THATCH, TIMBER, TIMBER_LIGHT

CHURN = P.mat("iron", 1.4)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 65
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 2, 20, 30, 36, "dirt", seed=seed)
    # Byre at the back.
    x0, y0, x1, y1 = 2, 3, 22, 14
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
    P.boarded(v, x0, y0, x1, y1, 2, 10)
    P.roof(v, x0, x1, y0, y1, 10, "thatch", along="x", gable=TIMBER_LIGHT, seed=seed)
    f = P.Face(v, "y+", y1 - 1)
    P.barn_gate(f, 8, 2, 5, 6)
    P.entrance(f, 15, 9, 3, 2, step=None, hinges=False)
    f.put(16, 9, THATCH, out=-1)
    # Farmhouse.
    b = P.building(v, 22, 18, 30, 30, "stonethatch", along="y", seed=seed)
    P.entrance(b.face("x-"), 23, 2, 3, 5)
    P.casement(b.face("y+"), 25, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, shutters=TIMBER_LIGHT)
    P.roof_chimney(v, b.roof, 26, 21, above=3, anchor=True)
    # Churn stand, bales, manure heap, trough.
    v.box(4, 22, 1, 10, 24, 3, TIMBER)
    for x in (4, 6, 8):
        v.box(x, 22, 3, x + 2, 24, 6, CHURN)
        v.box(x, 22, 4, x + 2, 24, 5, IRON)
    P.bale(v, 12, 22, 1, 3, 2, 2, m=THATCH)
    P.bale(v, 12, 25, 1, 3, 2, 2, m=THATCH)
    P.bale(v, 13, 23, 3, 2, 2, 1, m=THATCH)
    v.ellipsoid(25, 7, 0, 3, 3, 2, P.mat("road-dirt", 0.65), keep=lambda x, y, z: z >= 1)
    P.trough(v, 4, 28, 1, length=6, along="x")
    P.sacks(v, 16, 22, 1, n=2, m=CANVAS)
    P.handcart(v, 12, 31, 1, along="x", load=CHURN)
    v.anchor("cart", 18, 37, 1)
    P.scatter(v, 0, 0, 32, 40, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)
