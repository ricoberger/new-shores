"""
Fashion house (5 × 7; V7 rework, tier IV): a broad cream plaster house on an
ashlar floor under slate with an arched shop door; in the paved forecourt
long racks hung with bolts of blue, red and cream cloth and tall piles of
folded cloth. No chimney. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("dye-blue", 1.2)
RED = mat("terracotta", 1.2)
CREAM = mat("canvas", 1.25)

def build(ctx):
    v = ctx.vox()  # 60 × 84
    seed = 151
    K.ground(v, 30, 62, 27, 23, seed, "paved")
    h = K.hall(v, 6, 6, 60 - 6, 35, 4, "x", seed, door=("y+", 28), wins=[])
    K.rack(v, 8, 36, 44, [GOODS, RED, CREAM], h=13, drop=10)
    K.rack(v, 8, 36, 56, [CREAM, GOODS, RED], h=13, drop=10)
    K.pile(v, 42, 44, 1, 8, 6, 5, GOODS, seed)
    K.pile(v, 42, 56, 1, 8, 6, 4, RED, seed + 1)
    K.pile(v, 42, 66, 1, 8, 6, 3, CREAM, seed + 2)
    P.handcart(v, 8, 72, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 78, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
