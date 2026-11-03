"""
Wool weaver (3 × 4; V7 rework after the Anno 1404 weaver's hut, tier I): a
boarded workshop under weathered thatch with a blue trade sign and a slim
chimney (smoke), a thatched lean-to over a loom with a half-woven blue
cloth, a tall drying frame hung with dyed cloth (swaying), dye vats and
white wool bales and a hand cart. 12 voxels per tile; dirt only round the
workshop and the dye yard, the rest grass.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, DYE_BLUE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

CLOTH = (P.mat("dye-blue", 1.1, "cloth"), P.mat("terracotta", 1.15, "cloth"), P.mat("ochre", 1.1, "cloth"), P.mat("canvas", 1.2, "cloth"))
WOOL = mat("canvas", 1.3)
BLUE = mat("dye-blue", 1.15)


def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 53
    K.ground(v, 18, 31, 16, 14, seed)
    h = K.workshop(v, 3, 5, 25, 19, 1, "d", seed, door=("y+", 8), smoke=True, chim=(19, 9), wins=[3, 16])
    P.trade_sign(h.face("y+"), 13, 8, DYE_BLUE)
    # The loom in the open bay: two posts, a top beam, the warp and a half-woven blue cloth.
    v.box(7, 21, 1, 8, 28, 11, TIMBER_DARK)
    v.box(22, 21, 1, 23, 28, 11, TIMBER_DARK)
    v.box(7, 21, 10, 23, 28, 11, TIMBER_LIGHT)
    for x in range(9, 22):
        for y in (23, 24):
            for z in range(3, 10):
                v.set(x, y, z, CANVAS)  # the warp
            for z in range(3, 6):
                v.set(x, y, z, BLUE)  # the woven part
    v.box(8, 21, 2, 22, 28, 3, TIMBER_LIGHT)
    # Drying frame with swaying cloth across the front of the yard.
    V.drying_frame(v, 4, 31, 45, 1, 12, CLOTH, post=TIMBER_DARK, every=7, drop=10)
    # Dye vats, wool bales and the hand cart.
    P.cask(v, 5, 33, 1, h=4, lid=mat("dye-blue", 1.0))
    P.cask(v, 9, 33, 1, h=4, lid=mat("terracotta", 1.1))
    P.cask(v, 13, 33, 1, h=4, lid=mat("ochre", 1.1))
    P.bale(v, 20, 32, 1, 5, 3, 3, m=WOOL)
    P.bale(v, 20, 37, 1, 5, 3, 3, m=WOOL)
    P.bale(v, 21, 34, 4, 4, 3, 2, m=WOOL)
    P.handcart(v, 26, 38, 1, along="x", load=WOOL)
    v.anchor("cart", 27, 40, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
