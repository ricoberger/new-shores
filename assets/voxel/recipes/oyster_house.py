"""
Oyster house (6 × 6; V7 rework after the Anno 1404 fisherman's hut, tier IV):
a cream plaster kitchen on an ashlar floor under slate with a slim chimney
(smoke) and, against its flank, an open sorting shed on posts under tiles
with tables of oysters and tubs of brine; in the paved yard big pale heaps
of shells, packed crates and barrels, a well and a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

SHELL = mat("canvas", 1.3)
BRINE = mat("shallows", 1.2)


def build(ctx):
    v = ctx.vox()  # 72 × 72
    seed = 227
    K.ground(v, 36, 52, 30, 16, seed, "paved")
    K.hall(v, 6, 6, 30, 34, 4, "y", seed, door=("y+", 14), smoke=True, chim=(10, 10), wins=[])
    # The open sorting shed.
    K.lean(v, 34, 66, 8, 34, 11, "y+", tier=3, posts=True)
    for x in (38, 50):
        v.box(x, 18, 1, x + 8, 22, 4, TIMBER_LIGHT)
        for k in range(3):
            v.box(x + 1 + k * 2, 19, 4, x + 2 + k * 2, 21, 5, SHELL)
    V.vat(v, 62, 26, 1, r=3, h=4, m=mat("timber", 0.9), liquid=BRINE)
    V.heap(v, 12, 48, r=6, h=6, m=SHELL, seed=seed)
    V.heap(v, 28, 54, r=4, h=4, m=SHELL, seed=seed + 1)
    K.crates(v, ((40, 44, 1), (44, 44, 1), (42, 48, 1), (42, 44, 3), (48, 44, 1)))
    P.cask(v, 54, 46, 1, h=4, lid=BRINE)
    P.cask(v, 58, 46, 1, h=4, lid=BRINE)
    P.well(v, 62, 54, 1)
    P.handcart(v, 20, 62, 1, along="x", load=SHELL)
    v.anchor("cart", 26, 68, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
