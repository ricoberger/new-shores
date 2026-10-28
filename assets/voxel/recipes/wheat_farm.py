"""
Wheat farm (3 × 4; D-057 §3): a big barn of vertical boards with a
thatched roof, a wide two-leaf gate and a hay loft door with sheaves; a
coursed-stone farmhouse with thatch and a chimney (smoke); haystacks,
stooks of sheaves, sacks of grain on a threshing floor and a hand cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, PAVED, STONE_DARK, TIMBER_LIGHT, WHEAT


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 41
    P.yard(v, 0, 0, 24, 32, "dirt", seed=seed)
    P.yard(v, 0, 0, 24, 3, "grass", seed=seed)
    # Barn at the back.
    x0, y0, x1, y1 = 2, 3, 22, 15
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
    P.boarded(v, x0, y0, x1, y1, 2, 12)
    r = P.roof(v, x0, x1, y0, y1, 12, "thatch", along="x", gable=TIMBER_LIGHT, seed=seed)
    f = P.Face(v, "y+", y1 - 1)
    P.barn_gate(f, 9, 2, 6, 7)
    P.entrance(f, 10, 10, 4, 2, step=None, hinges=False)
    f.put(11, 10, WHEAT, out=-1)
    f.put(12, 10, WHEAT, out=-1)
    del r
    # Farmhouse.
    b = P.building(v, 2, 19, 12, 28, "stonethatch", along="y", seed=seed + 1)
    P.entrance(b.face("y+"), 4, 2, 3, 5)
    P.casement(b.face("y+"), 8, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, shutters=TIMBER_LIGHT)
    P.casement(b.face("x+"), 22, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, shutters=TIMBER_LIGHT)
    P.roof_chimney(v, b.roof, 4, 21, above=3, anchor=True)
    # Threshing floor with sacks; haystacks and stooks.
    for x in range(14, 22):
        for y in range(23, 28):
            v.set(x, y, 0, P.shade_of(PAVED, 0.95 if (x + y) % 3 else 1.04))
    P.sacks(v, 14, 24, 1, n=3, m=CANVAS)
    P.haystack(v, 16, 19, 2.6, 5, seed=seed)
    for x in range(15, 22, 2):
        P.sheaf(v, x, 29)
    P.handcart(v, 21, 20, 1, along="y", load=WHEAT)
    v.anchor("cart", 19, 30, 1)
    P.scatter(v, 0, 0, 24, 32, 0.02, seed=seed)
    return P.colour_jitter(v, seed=seed)
