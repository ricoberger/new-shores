"""
Cattle farm (4 × 5; V7 rework after the Anno 1404 cattle farm, tier IV): a
two-storey cream plaster barn on an ashlar floor under slate, the ridge along
y like the dairy farm's, with a hayloft door and hoist in the front gable and
an open lean-to milking shed on the west flank (a cow, churns); in front a
fenced paddock with two cows, a long water trough, a haystack and a cart.
12 voxels per tile.
Re-dressed in the rural look (D-075 §3, `look: rural`): the tier-I look — boarded
walls on a stone band under weathered thatch — whatever the unlock tier; the
props and the signature parts are unchanged.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

HAY = mat("thatch", 1.3)


def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 127
    K.ground(v, 24, 48, 21, 14, seed)
    h = K.workshop(v, 6, 4, 42, 30, 1, "b", seed, door=("y+", 24), wins=None)
    W.loft_door(v, 29, 24, 13, frame=P.DRESSED, beam_z=26, rope=11)
    K.cow(v, 8, 12, 1, along="y")
    for y in (22, 25):
        P.cask(v, 14, y, 1, h=6, lid=CANVAS)
    P.fence_ring(v, 4, 34, 44, 58, kind="rail", gaps={(40, 34), (41, 34)}, seed=seed)
    K.cow(v, 10, 40, 1)
    K.cow(v, 28, 44, 1, along="y")
    P.trough(v, 8, 54, 1, length=12, along="x")
    K.pile(v, 36, 48, 1, 6, 5, 5, HAY, seed)
    v.anchor("cart", 4, 58, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
