"""
Quartz quarry (3 × 8, on a deposit; V7 rework, tier IV): a banded rock hill with seams
of its ore and a timbered adit, rails with two big tubs, a heap, pit props
and a cart, an ashlar-and-plaster office under slate (no smoke). 12 voxels
per tile; built on the shared mine kit.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

ORE = mat("canvas", 1.2)


def build(ctx):
    v = ctx.vox()  # 36 × 96
    seed = 139
    K.mine(v, seed, ORE, ORE, frame=False, share=0.55)
    K.ground(v, 18, 74, 15, 20, seed)
    K.workshop(v, 22, 68, 35, 90, 4, "a", seed, door=("x-", 74), wins=[])
    return P.colour_jitter(v, seed=seed)
