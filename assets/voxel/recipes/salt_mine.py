"""
Salt mine (3 × 8, on a salt deposit; V7 rework, tier III): a rock hill with
white salt seams and a timbered adit, rails with two tubs of rock salt, a
horse whim over the brine shaft with brine casks, a big heap of white rock
salt and a stone-and-timber pump house under dark burgundy tiles; a cart.
12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

SALT = mat("foam")
BRINE = mat("shallows", 1.25)


def build(ctx):
    v = ctx.vox()  # 36 × 96
    seed = 89
    K.mine(v, seed, mat("plaster", 1.1), SALT, whim=BRINE, share=0.5)
    K.ground(v, 18, 74, 15, 20, seed)
    K.hall(v, 22, 68, 35, 90, 3, "y", seed, door=("x-", 74), wins=[])
    return P.colour_jitter(v, seed=seed)
