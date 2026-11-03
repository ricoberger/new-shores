"""
Paper mill (4 × 6; V7 rework, tier III): a stone-and-timber mill under dark
burgundy tiles with a slim chimney (smoke), a big timber water wheel on its
west flank, racks hung with pale sheets of paper, tall stacks of paper, a
pulp vat and a cart. 12 voxels per tile.
"""

import math

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

PAPER = mat("canvas", 1.3)
BARK = mat("timber", 0.9)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 223
    K.ground(v, 28, 44, 20, 22, seed)
    K.workshop(v, 12, 6, 44, 30, 3, "c", seed, door=("y+", 26), smoke=True, chim=(38, 10), wins=[])
    # The wheel: a ring of spokes and paddles in the y–z plane at x = 6.
    cy, cz, r = 18, 9, 8
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
    K.rack(v, 14, 42, 34, PAPER, h=12, drop=9)
    K.rack(v, 14, 42, 42, [PAPER, shade_of(PAPER, 0.92)], h=10, drop=7)
    K.pile(v, 30, 50, 1, 8, 6, 7, PAPER, seed)
    V.vat(v, 12, 52, 1, r=4, h=5, m=BARK, liquid=PAPER)
    P.handcart(v, 6, 62, 1, along="x", load=PAPER)
    v.anchor("cart", 12, 68, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
