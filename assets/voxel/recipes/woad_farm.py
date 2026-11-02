"""
Woad farm (3 × 4; V7 rework, tier III): a stone-and-timber farmhouse gabled
to the street under dark burgundy tiles (no chimney), racks hung with deep
blue woad leaves, a heap of blue-green balls and a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("dye-blue", 0.9)

def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 221
    K.ground(v, 18, 40, 15, 10, seed)
    h = K.hall(v, 6, 6, 36 - 6, 26, 3, "y", seed, door=("y+", 16), wins=[])
    K.rack(v, 6, 30, 34, GOODS, h=11, drop=8)
    V.heap(v, 10, 42, r=4, h=4, m=GOODS, seed=seed)
    K.pile(v, 22, 38, 1, 6, 5, 3, GOODS, seed)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
