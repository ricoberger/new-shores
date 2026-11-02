"""
Winepress (6 × 9; V7 rework, tier IV): a long cream plaster pressing hall on
an ashlar floor under slate with a slim chimney (smoke); in the paved
forecourt a giant timber screw press with a stone bed and a dark-red must
trough, a row of big vats, and a pyramid of wine barrels. 12 voxels per
tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("dye-blue", 0.7)
MUST = mat("terracotta", 0.7)
OAK = mat("timber", 1.25)

def build(ctx):
    v = ctx.vox()  # 72 × 108
    seed = 173
    K.ground(v, 36, 79, 33, 30, seed, "paved")
    h = K.hall(v, 6, 6, 72 - 6, 45, 4, "x", seed, door=("y+", 34), smoke=True, chim=(58, 10), wins=[])
    for dx in (0, 10):
        for dy in (0, 8):
            v.box(12 + dx, 56 + dy, 1, 14 + dx, 58 + dy, 20, TIMBER_DARK)
    v.box(12, 56, 18, 24, 66, 20, TIMBER)
    v.box(17, 59, 20, 19, 61, 28, TIMBER_LIGHT)
    v.box(13, 60, 28, 23, 62, 30, TIMBER_DARK)
    v.box(10, 54, 1, 26, 68, 4, mat("stone", 1.0))
    v.box(12, 56, 4, 24, 66, 7, MUST)
    for k, x in enumerate((38, 48, 58)):
        V.vat(v, x, 62, 1, r=4, h=8, m=OAK, liquid=MUST)
    for row, n in enumerate((6, 5, 4)):
        for i in range(n):
            P.barrel(v, 10 + i * 4 + row * 2, 82, 1 + row * 4, h=4, m=OAK)
    for i in range(5):
        P.barrel(v, 40 + i * 4, 82, 1, h=4, m=OAK)
    P.handcart(v, 8, 96, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 102, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
