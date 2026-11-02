"""
Iron mine (3 × 8, on an iron deposit; V7 rework after the Anno 1404 ore
mine, tier II): a banded rock hill with ore seams and a timbered adit,
rails with two big tubs of ore, a rubble-and-half-timber winding house
under terracotta with a slim chimney (smoke), a heap of ore, pit props
and a cart. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.mats import IRON_ORE

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)


def build(ctx):
    v = ctx.vox()  # 36 × 96
    seed = 55
    K.mine(v, seed, IRON_ORE, IRON_ORE)
    K.ground(v, 18, 70, 15, 24, seed)
    K.hall(v, 22, 64, 35, 88, 2, "y", seed, door=("x-", 70), smoke=True, chim=(26, 68), wins=[])
    return P.colour_jitter(v, seed=seed)
