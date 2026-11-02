"""
Slaughterhouse (4 × 4; V7 rework, tier IV): a stone-and-plaster block on an
ashlar floor under slate with a slim chimney (smoke), a rail with sides of
red meat hanging in the yard, scalding tubs, a chopping block, barrels of
salt and a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("terracotta", 1.25)
HAM = mat("terracotta", 0.9)

def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 167
    K.ground(v, 24, 40, 21, 10, seed, "paved")
    h = K.hall(v, 6, 6, 48 - 6, 26, 4, "y", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for x in (10, 38):
        v.box(x, 30, 1, x + 1, 31, 13, TIMBER_DARK)
    v.box(10, 30, 12, 39, 31, 13, TIMBER)
    V.hanging(v, 12, 38, 30, 12, ((GOODS, 6), (HAM, 5)), every=3)
    P.cask(v, 12, 36, 1, h=4, lid=mat("shallows", 1.2))
    P.cask(v, 18, 36, 1, h=4, lid=mat("shallows", 1.2))
    P.chopping_block(v, 28, 36, 1)
    P.cask(v, 36, 38, 1, lid=CANVAS)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
