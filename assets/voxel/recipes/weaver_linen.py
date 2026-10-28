"""
Linen weaver (4 × 5; D-057 §3): a workshop with a coursed-stone ground
floor, a jettied plaster upper storey and tiles (chimney with smoke), a
loom with a white web under a tiled lean-to, linen bleaching on the
grass in long white strips, a winding frame, bales of flax and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, PLASTER, TIMBER, TIMBER_LIGHT

LINEN = P.mat("plaster", 1.08)
FLAX = P.mat("thatch", 1.15)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 62
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 2, 18, 30, 24, "dirt", seed=seed)
    b = P.building(v, 3, 4, 21, 16, "citizen", along="x", upper=PLASTER, seed=seed, spacing=4)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 9, 2, 3, 5, frame=P.DRESSED, lintel=P.DRESSED)
    P.casement(f, 4, 3, 3, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(f, 15, 3, 3, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    for a in (4, 10, 16):
        P.casement(F, a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=P.mat("dye-blue", 1.1))
    P.trade_sign(f, 13, 7, LINEN)
    P.roof_chimney(v, b.roof, 6, 8, above=3, brick=True, anchor=True)
    # Loom under a lean-to on the east.
    P.lean_to(v, 22, 30, 5, 15, 8, "tiles", down="x+", ov=1)
    v.box(23, 7, 1, 24, 13, 6, TIMBER)
    v.box(27, 7, 1, 28, 13, 6, TIMBER)
    v.box(23, 7, 6, 28, 13, 7, TIMBER_LIGHT)
    v.box(24, 8, 2, 27, 12, 3, TIMBER_LIGHT)
    v.box(24, 8, 3, 27, 12, 4, LINEN)
    # Bleaching green: long white strips pegged on the grass.
    for y in (27, 31, 35):
        for x in range(4, 24):
            v.set(x, y, 1, LINEN if (x // 6) % 2 == 0 else P.shade_of(LINEN, 0.96))
            v.set(x, y + 1, 1, LINEN if (x // 6) % 2 == 0 else P.shade_of(LINEN, 0.96))
        v.set(3, y, 1, TIMBER)
        v.set(24, y + 1, 1, TIMBER)
    # Winding frame, flax bales, cart.
    v.box(4, 19, 1, 5, 21, 4, TIMBER)
    v.box(8, 19, 1, 9, 21, 4, TIMBER)
    v.box(5, 19, 2, 8, 21, 4, CANVAS)
    P.bale(v, 12, 19, 1, 3, 2, 2, m=FLAX)
    P.bale(v, 16, 19, 1, 3, 2, 2, m=FLAX)
    P.handcart(v, 22, 19, 1, along="x", load=LINEN)
    v.anchor("cart", 26, 37, 1)
    P.scatter(v, 0, 0, 32, 40, 0.025, seed=seed)
    return P.colour_jitter(v, seed=seed)
