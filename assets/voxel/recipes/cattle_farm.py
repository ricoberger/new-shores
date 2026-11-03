"""
Cattle farm (4 × 5; V7 rework after the Anno 1404 cattle farm, tier IV): a
big cream plaster barn on an ashlar floor under slate with an arched cart
door, a haystack, a long water trough, a fenced paddock with three cows,
hay and a cart. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

HAY = mat("thatch", 1.3)


def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 127
    K.ground(v, 24, 38, 20, 18, seed)
    h = K.workshop(v, 6, 4, 42, 24, 4, "a", seed, door=("y+", 28), wins=[])
    W.gate(h.face("y+"), 12, 8, 9, frame=P.DRESSED, arch=True)
    P.fence_ring(v, 6, 30, 42, 56, kind="rail", gaps={(40, 30), (41, 30)}, seed=seed)
    K.cow(v, 10, 38, 1)
    K.cow(v, 24, 44, 1, along="y")
    K.cow(v, 32, 36, 1)
    P.trough(v, 10, 52, 1, length=10, along="x")
    K.pile(v, 36, 46, 1, 6, 5, 5, HAY, seed)
    v.anchor("cart", 4, 58, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
