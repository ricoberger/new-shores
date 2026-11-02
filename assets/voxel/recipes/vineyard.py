"""
Vineyard (4 × 5; V7 rework, tier IV): a cream plaster winegrower's house on
an ashlar floor under slate (no chimney) with three rows of staked vines
hung with green leaf and dark grapes in front, grape baskets and a cart. 12
voxels per tile.
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
LEAF = mat("grass-b", 0.85)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 171
    K.ground(v, 24, 45, 21, 16, seed, "paved")
    h = K.hall(v, 6, 6, 48 - 6, 25, 4, "x", seed, door=("y+", 22), wins=[])
    for y in (34, 42, 50):
        for x in range(8, 41, 4):
            v.box(x, y, 1, x + 1, y + 1, 7, TIMBER_DARK)
        v.box(8, y, 6, 41, y + 1, 7, TIMBER)
        v.box(8, y, 2, 41, y + 1, 6, LEAF)
        for x in range(9, 40, 3):
            v.box(x, y, 3, x + 1, y + 1, 5, GOODS)
    P.cask(v, 42, 56, 1, lid=GOODS)
    P.cask(v, 40, 56, 1, lid=GOODS)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
