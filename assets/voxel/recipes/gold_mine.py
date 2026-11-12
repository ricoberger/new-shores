"""
Gold mine (3 × 8, on a deposit; V7 rework, tier IV): a banded rock hill with seams
of its ore and a timbered adit, rails with two big tubs, a heap, pit props
and a cart, an ashlar-and-plaster office under slate (no smoke). 12 voxels
per tile; built on the shared mine kit.
Re-dressed in the rural look (D-075 §3, `look: rural`): the tier-I look — boarded
walls on a stone band under weathered thatch — whatever the unlock tier; the
props and the signature parts are unchanged.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

ORE = mat("ochre", 1.45)


def build(ctx):
    v = ctx.vox()  # 36 × 96
    seed = 137
    K.mine(v, seed, ORE, ORE, frame=True, share=0.4)
    K.ground(v, 18, 74, 15, 20, seed)
    K.workshop(v, 22, 68, 35, 90, 1, "a", seed, door=("x-", 74), wins=[])
    return P.colour_jitter(v, seed=seed)
