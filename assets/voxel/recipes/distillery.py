"""
Distillery (5 × 6; V7 rework, tier III): a stone-and-timber still house
under dark burgundy tiles with a slim chimney (smoke), a big copper still
with head and pipe, grain sacks, barrels of spirit and a cart. 12 voxels per
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

GOODS = mat("wheat", 1.1)
COPPER = mat("terracotta", 1.3)

def build(ctx):
    v = ctx.vox()  # 60 × 72
    seed = 201
    K.ground(v, 30, 54, 27, 20, seed)
    h = K.hall(v, 6, 6, 60 - 6, 30, 3, "x", seed, door=("y+", 28), smoke=True, chim=(46, 10), wins=[])
    K.still(v, 14, 46, m=COPPER, r=5)
    K.pile(v, 32, 44, 1, 8, 6, 4, GOODS, seed)
    for i in range(4):
        P.barrel(v, 8 + i * 4, 60, 1, h=4, m=mat("timber", 1.3))
    for i in range(3):
        P.barrel(v, 10 + i * 4, 60, 5, h=4, m=mat("timber", 1.3))
    P.handcart(v, 8, 60, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 66, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
