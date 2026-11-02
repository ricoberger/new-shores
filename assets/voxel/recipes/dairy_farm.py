"""
Dairy farm (4 × 5; V7 rework after the Anno 1404 cattle farm, tier II): a
big half-timbered barn on a rubble floor under terracotta with a slim
chimney (smoke), a fenced paddock with two cows, a row of milk churns, a
trough and a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.3)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 189
    K.ground(v, 24, 49, 21, 12, seed)
    h = K.hall(v, 6, 6, 48 - 6, 33, 2, "x", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    P.fence_ring(v, 6, 32, 42, 56, kind="rail", gaps={(40, 32), (41, 32)}, seed=seed)
    K.cow(v, 12, 38, 1)
    K.cow(v, 28, 44, 1, along="y")
    for x in (8, 12, 16):
        P.cask(v, x, 58 - 4, 1, h=5, lid=CANVAS)
    P.trough(v, 22, 52, 1, length=8, along="x")
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
