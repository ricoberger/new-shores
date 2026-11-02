"""
Tannery (3 × 4; V7 rework after the Anno 1404 tannery, tier II): a
rubble-and-half-timber tannery under terracotta (slim chimney, smoke) with
a big undershot water wheel of timber spokes on its west flank, hides
stretched in frames and hung on drying racks, pale tanning vats, a bark
pile and a cart of hides. 12 voxels per tile.
"""

import math

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

HIDE = mat("ochre", 1.05)
HIDE_DARK = mat("timber", 1.0)
BARK = mat("timber", 0.9)
LIQUOR = mat("timber", 0.55)


def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 103
    K.ground(v, 18, 26, 15, 16, seed)
    K.hall(v, 12, 4, 34, 24, 2, "x", seed, door=("y+", 26), smoke=True, chim=(26, 8), wins=[])
    # The wheel: a ring of spokes and paddles in the y–z plane at x = 6.
    cy, cz, r = 14, 9, 8
    for a in range(0, 360, 6):
        y = cy + r * math.cos(math.radians(a))
        z = cz + r * math.sin(math.radians(a))
        v.box(5, int(round(y)), max(1, int(round(z))), 8, int(round(y)) + 1, max(1, int(round(z))) + 1, TIMBER_DARK)
    for a in range(0, 180, 30):
        for t in range(-r, r + 1):
            y = cy + t * math.cos(math.radians(a))
            z = cz + t * math.sin(math.radians(a))
            if z >= 1:
                v.set(6, int(round(y)), int(round(z)), TIMBER)
    v.box(5, cy - 1, cz - 1, 9, cy + 1, cz + 1, TIMBER_LIGHT)
    for y in (cy - 8, cy + 8):
        v.box(4, y, 1, 10, y + 1, 3, TIMBER_DARK)
    # Hides in frames and on the racks, vats and bark.
    V.hide_frame(v, 6, 30, 1, 5, 7, HIDE, frame=TIMBER_DARK)
    V.hide_frame(v, 14, 30, 1, 5, 7, HIDE_DARK, frame=TIMBER_DARK)
    for x in (22, 28):
        v.box(x, 30, 1, x + 5, 34, 4, TIMBER)
        v.box(x + 1, 31, 4, x + 4, 33, 5, LIQUOR)
    K.pile(v, 26, 38, 1, 6, 4, 4, BARK, seed)
    P.handcart(v, 6, 40, 1, along="x", load=HIDE)
    v.anchor("cart", 12, 46, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
