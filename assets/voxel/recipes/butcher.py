"""
Butcher (4 × 5; V7 rework after the Anno 1404 butcher's shop, tier III): a
stone-and-timber shop under dark burgundy tiles with a slim chimney (smoke)
and a wide shop hatch, beside an open smoking shed on posts with a tiled
roof from whose rails sides of red meat and hams hang; a chopping block, a
scalding tub, salt casks, a woodpile and a cart; a low forecourt wall.
12 voxels per tile; dirt in the yard, the rest grass.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

MEAT = mat("terracotta", 1.25)
HAM = mat("terracotta", 0.9)


def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 19
    K.ground(v, 24, 38, 21, 18, seed)
    h = K.hall(v, 22, 6, 46, 28, 3, "x", seed, door=("y+", 36), smoke=True, chim=(40, 10), wins=[])
    P.casement(h.face("y+"), 26, 4, 8, 5, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED, bars=False)
    v.box(26, 29, 3, 34, 31, 4, TIMBER_LIGHT)  # the counter
    # The smoking shed on posts at the west.
    for x in (2, 18):
        for y in (8, 12, 20, 26):
            v.box(x, y, 1, x + 1, y + 1, 12, TIMBER_DARK)
    K.lean(v, 2, 19, 8, 27, 12, "y+", tier=3, posts=False)
    v.box(2, 12, 11, 19, 13, 12, TIMBER)
    v.box(2, 20, 11, 19, 21, 12, TIMBER)
    V.hanging(v, 3, 18, 12, 11, ((MEAT, 5), (HAM, 4)), every=3)
    V.hanging(v, 3, 18, 20, 11, ((HAM, 4), (MEAT, 5)), every=3)
    P.chopping_block(v, 8, 34, 1)
    P.cask(v, 26, 40, 1, h=4)
    P.cask(v, 30, 40, 1, h=4)
    P.woodpile(v, 4, 44, 1, length=8, along="x", rows=3)
    P.handcart(v, 28, 46, 1, along="x", load=MEAT)
    v.anchor("cart", 34, 54, 1)
    K.low_wall(v, 2, 56, 16, 58, 3, seed)
    K.low_wall(v, 30, 56, 46, 58, 3, seed + 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
