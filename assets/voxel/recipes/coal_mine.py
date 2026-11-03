"""
Coal mine (3 × 8, on a coal deposit; V7 rework, tier III): a rock hill with
black coal seams and a timbered adit, a tall timber headframe with its
sheave wheel, rails with two tubs of coal, a black coal heap and a sooty
spoil tip, a stone-and-timber winding house under dark burgundy tiles, pit
props and a cart. No smoke. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

COAL = mat("iron", 0.5)
SPOIL = mat("rock-deep", 0.8)


def build(ctx):
    v = ctx.vox()  # 36 × 96
    seed = 83
    K.mine(v, seed, COAL, COAL, frame=True, spoil=SPOIL, share=0.5)
    K.ground(v, 18, 72, 15, 22, seed)
    K.workshop(v, 22, 68, 35, 90, 3, "a", seed, door=("x-", 74), wins=[])
    return P.colour_jitter(v, seed=seed)
