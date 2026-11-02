"""
Goldsmith (4 × 4; V7 rework after the Anno 1404 redsmith, tier IV): a cream
plaster workshop on an ashlar floor under slate with a slim chimney (smoke),
a glowing forge hearth by the door, an anvil, a gold sign and a stack of
bright gold ingots on a pallet, a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("ochre", 1.7)
GLOW = mat("ochre", 1.9)

def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 153
    K.ground(v, 24, 40, 21, 10, seed, "paved")
    h = K.hall(v, 6, 6, 48 - 6, 26, 4, "y", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    v.box(8, 30, 1, 14, 36, 5, mat("stone", 0.8))
    v.box(9, 31, 5, 13, 35, 6, GLOW)
    v.box(20, 30, 1, 23, 33, 4, TIMBER_DARK)
    v.box(19, 30, 4, 25, 33, 6, IRON)
    v.box(30, 30, 1, 40, 36, 3, TIMBER_LIGHT)
    v.box(31, 31, 3, 39, 35, 5, GOODS)
    v.box(33, 32, 5, 37, 34, 7, GOODS)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
