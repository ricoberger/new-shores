"""
Grain distillery (5 × 6; D-057 §3; the distillery class): a round still
tower in brick courses with a copper dome, a brick stack (smoke), a
barrel hall in coursed stone with a slate roof, and a malt loft — a
framed ochre loft over an open threshing floor with a pyramid-roofed
kiln vent and a hoist — sacks of grain, a cask rack and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, OCHRE, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT


def build(ctx):
    v = ctx.vox()  # 40 × 48
    seed = 163
    P.yard(v, 0, 0, 40, 48, "dirt", seed=seed)
    P.yard(v, 0, 36, 40, 48, "paved", seed=seed)
    # Barrel hall at the back along x: coursed stone, slate.
    b = P.building(v, 14, 2, 38, 14, "stone", along="x", seed=seed, height=11, kind="slate")
    f = b.face("y+")
    P.barn_gate(f, 26, 2, 6, 6)
    P.casement(f, 18, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(f, 34, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    # Still tower in brick courses on the west, with its stack.
    V.still_tower(v, 8, 12, 6.5, 17, wall=P.BRICK, seed=seed)
    P.chimney_stack(v, 2, 3, 1, 22, anchor=True)
    # Malt loft in front of the hall: posts, framed ochre loft, tiles, kiln vent, hoist.
    x0, x1, y0, y1 = 18, 36, 16, 30
    for x in (x0, x0 + 6, x1 - 7, x1 - 1):
        for y in (y0, y1 - 1):
            v.box(x, y, 1, x + 1, y + 1, 8, TIMBER)
    P.timber_frame(v, x0, y0, x1, y1, 8, 15, OCHRE, frame=TIMBER_DARK)
    r = P.roof(v, x0, x1, y0, y1, 15, "tiles", along="x", rise=1.2, seed=seed, m=mat("terracotta", 1.08))
    v.box(24, 21, r.ridge_z - 1, 30, 25, r.ridge_z + 2, TIMBER_LIGHT)  # kiln vent
    P.roof(v, 23, 31, 20, 26, r.ridge_z + 2, "slate", hip=True, rise=1.0, ov=0, seed=seed)
    F = P.Face(v, "y+", y1 - 1)
    P.entrance(F, 26, 10, 2, 4, step=None, hinges=False)
    V.hoist(F, 27, 14, length=2, rope=4, load=CANVAS)
    for a in (21, 32):
        P.casement(F, a, 10, 2, 3, frame=None, sill=TIMBER_LIGHT)
    # The threshing floor under the loft: grain on the floor, sacks.
    v.box(x0 + 1, y0 + 1, 0, x1 - 1, y1 - 1, 1, mat("wheat", 0.95))
    for x in range(20, 34, 3):
        P.sacks(v, x, 22, 1, n=1, m=CANVAS)
    v.line((15, 13, 9), (18, 13, 9), V.COPPER)
    # Cask rack, grain sacks, cart.
    for y in (34,):
        v.box(2, y, 1, 14, y + 1, 2, TIMBER_DARK)
        for x in range(2, 14, 3):
            P.cask(v, x, y - 1, 2, h=3, m=TIMBER, lid=TIMBER_DARK)
    P.bale(v, 4, 26, 1, w=3, d=2, h=2, m=WHEAT)
    P.sacks(v, 30, 38, 1, n=3, m=CANVAS)
    P.lamp_post(v, 16, 40)
    v.anchor("cart", 8, 44, 1)
    P.scatter(v, 0, 0, 40, 36, 0.01, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
