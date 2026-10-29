"""
Lace maker (3 × 5; D-057 §3, V5): a long low workshop — an ashlar
ground floor with a row of tall windows for the light, plastered gables
and a tiled roof with a long dormer — lace pillows on stands at the
door, a frame with a finished piece of lace hung to air (cloth that
sways, LIFE_LAYER §7), boxes of fine cloth, a bench and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

ROOF = mat("terracotta", 0.9)
LACE = P.cloth(mat("canvas", 1.12))
LACE_HOLE = P.cloth(mat("canvas", 0.96))
PILLOW = mat("dye-blue", 1.1)


def build(ctx):
    v = ctx.vox()  # 24 × 40
    seed = 107
    P.yard(v, 0, 0, 24, 40, "grass", seed=seed)
    P.yard(v, 1, 30, 23, 40, "paved", seed=seed)
    b = Q.palazzo(v, 9, 3, 21, 28, (8, 5), upper=PLASTER, roof=ROOF, along="y", seed=seed)
    f = b.face("y+")
    P.entrance(f, 13, 2, 3, 6, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED)
    for side in ("x-", "x+"):
        for a in (5, 10, 15, 20, 24):
            Q.window(b.face(side), a, 3, 2, 5, hood="cornice", surround=True)
        for a in (8, 18):
            Q.window(b.face(side), a, 10, 2, 3, hood=None)
    P.roof_chimney(v, b.roof, 17, 5, above=2, brick=True)
    # Lace pillows on stands by the door.
    for x in (3, 6):
        v.box(x, 31, 1, x + 1, 32, 3, TIMBER)
        v.box(x - 1, 30, 3, x + 2, 33, 4, PILLOW)
        v.set(x, 31, 4, mat("canvas", 1.12))
    # A frame with a hung piece of lace (sways).
    for y in (6, 22):
        v.box(4, y, 1, 5, y + 1, 11, TIMBER)
    v.box(4, 6, 11, 5, 23, 12, TIMBER_LIGHT)
    for y in range(8, 21):
        for z in range(4, 11):
            v.set(4, y, z, LACE_HOLE if (y + z) % 3 == 0 else LACE)
    # Boxes of fine cloth, a bench, a cart.
    P.box_crate(v, 2, 25, 1, contents=mat("canvas", 1.1))
    P.box_crate(v, 5, 25, 1, contents=PILLOW)
    P.bench(v, 16, 31, 1, 5)
    P.handcart(v, 9, 34, 1, along="x", load=CANVAS)
    v.anchor("cart", 18, 39, 1)
    P.scatter(v, 0, 0, 24, 30, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)
