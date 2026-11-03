"""
Fashion house (5 × 7; V7 variety pass, tier IV): a broad two-storey cream
plaster house on an ashlar floor under slate (no chimney); in the paved
forecourt three tall racks hung with bolts of blue, red and cream cloth and
piles of folded cloth. 12 voxels per tile; massing and signature prop in
NOTES.md.
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
    K.ground(v, 30, 63, 27, 23, seed, "paved")
    h = K.workshop(v, 6, 6, 60 - 6, 36, 4, "a", seed, door=("y+", 28), wins=[])
    K.rack(v, 6, 36, 46, [GOODS, RED, CREAM], h=18, drop=14)
    K.rack(v, 6, 36, 58, [CREAM, GOODS, RED], h=16, drop=12)
    K.rack(v, 6, 36, 70, [RED, CREAM, GOODS], h=14, drop=10)
    K.pile(v, 42, 46, 1, 10, 8, 6, GOODS, seed)
    K.pile(v, 42, 58, 1, 10, 8, 5, RED, seed + 1)
    P.handcart(v, 8, 72, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 78, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
