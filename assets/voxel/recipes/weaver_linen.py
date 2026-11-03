"""
Linen weaver (4 × 5; V7 rework after the Anno 1404 weaver's hut, tier II): a
half-timbered workshop (rubble ground floor, terracotta, slim chimney with
smoke) with a tiled lean-to over a loom with a white web, linen bleaching in
long white sheets on lines (cloth: they sway), flax bales, a winding frame
and a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

LINEN = mat("canvas", 1.25)
SHEET = (P.cloth(LINEN), P.cloth(mat("canvas", 1.18)))
FLAX = mat("hemp", 1.05)


def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 59
    K.ground(v, 20, 28, 17, 14, seed)
    h = K.workshop(v, 4, 5, 30, 24, 2, "b", seed, door=("y+", 14), smoke=True, chim=(22, 9), wins=[7, 22])
    K.lean(v, 30, 40, 7, 22, 10, "x+", tier=2)
    v.box(31, 9, 1, 32, 20, 9, TIMBER_DARK)
    v.box(38, 9, 1, 39, 20, 9, TIMBER_DARK)
    for x in (33, 36):
        for y in (10, 18):
            v.box(x, y, 1, x + 1, y + 1, 9, TIMBER_DARK)
    for y in range(10, 19):
        for x in (34, 35):
            for z in range(3, 8):
                v.set(x, y, z, CANVAS)
        for z in range(3, 5):
            v.set(34, y, z, LINEN)
            v.set(35, y, z, LINEN)
    # Bleaching lines across the front, hung with long white sheets.
    V.drying_frame(v, 4, 40, 50, 1, 11, SHEET, post=TIMBER_DARK, every=6, drop=7)
    V.drying_frame(v, 4, 40, 42, 1, 10, SHEET, post=TIMBER_DARK, every=6, drop=7)
    P.bale(v, 6, 30, 1, 5, 3, 3, m=FLAX)
    P.bale(v, 12, 30, 1, 5, 3, 3, m=FLAX)
    P.bale(v, 9, 30, 4, 5, 3, 2, m=FLAX)
    P.handcart(v, 30, 30, 1, along="x", load=FLAX)
    v.anchor("cart", 34, 36, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
