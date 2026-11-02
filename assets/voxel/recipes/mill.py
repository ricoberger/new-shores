"""
Windmill (4 × 6; V7 rework after the Anno 1404 / Anno 117 mill, tier II):
a tapered tower of dark boards on a rubble foot with a conical thatch cap
and a gallery, four big pale lattice sails on a brass hub turned to the
front, a miller's cottage (rubble ground floor, half-timber, tiles, slim
chimney with smoke), flour sacks, a cart and a stack of grain bags.
12 voxels per tile; dirt only round the tower foot and the cottage door.
"""

import math

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, CANVAS, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BOARD = mat("timber", 0.7)
SAIL = mat("canvas", 1.15)
SPAR = mat("timber", 1.3)


def sail(v, hx, hy, hz, ang, length=19):
    """One lattice sail in the x–z plane at y = hy: a spar and a lattice of canvas on one side of it."""
    dx, dz = math.cos(ang), math.sin(ang)
    px, pz = -dz, dx
    for t in range(2, length):
        cx, cz = hx + dx * t, hz + dz * t
        for w in (0, 1):
            v.set(int(round(cx + px * w)), hy, int(round(cz + pz * w)), SPAR)
        if t >= 7:
            for s in range(2, 7):
                if 2 < s < 6 and (t + s) % 3 == 0 and t % 2 == 0:
                    continue
                v.set(int(round(cx + px * s)), hy, int(round(cz + pz * s)), SAIL)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 3
    K.ground(v, 19, 24, 11, 11, seed)
    K.ground(v, 33, 56, 11, 9, seed + 1)
    cx, cy, zt = 19, 22, 30
    for z in range(1, zt):
        r = 8.2 - 2.6 * (z / zt)
        for x in range(cx - 10, cx + 11):
            for y in range(cy - 10, cy + 11):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if r - 1.1 < d <= r:
                    if z < 9:
                        v.set(x, y, z, shade_of(STONE, 0.9 if (z // 2) % 2 else 1.0))
                    else:
                        v.set(x, y, z, BOARD if (z // 2) % 2 else shade_of(BOARD, 0.88))
    for x in range(cx - 7, cx + 8):
        for y in range(cy - 7, cy + 8):
            if math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 6:
                v.set(x, y, zt - 1, TIMBER_DARK)
    # gallery
    for x in range(cx - 10, cx + 11):
        for y in range(cy - 10, cy + 11):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if 7.2 < d <= 9.2:
                v.set(x, y, 13, TIMBER_LIGHT)
    V.cone_roof(v, cx, cy, 7.6, zt, K.THATCH, rise=1.0)
    # door and window of the tower
    v.box(cx - 2, cy + 6, 1, cx + 2, cy + 9, 9, TIMBER_DARK)
    v.box(cx - 1, cy + 6, 18, cx + 1, cy + 8, 22, TIMBER_DARK)
    # hub and four sails turned to the front
    hy = cy + 10
    hz = 23
    v.box(cx - 1, cy + 4, hz - 1, cx + 1, hy + 1, hz + 1, BRASS)
    for k in range(4):
        sail(v, cx, hy, hz, math.radians(45 + 90 * k))
    # the cottage
    h = K.hall(v, 22, 44, 44, 62, 2, "x", seed, door=("y+", 30), smoke=True, chim=(26, 48), wins=[24, 38])
    P.sacks(v, 10, 44, 1, n=4, m=CANVAS)
    P.sacks(v, 10, 52, 1, n=3, m=CANVAS)
    P.handcart(v, 8, 62, 1, along="x", load=CANVAS)
    v.anchor("cart", 12, 68, 1)
    P.fence_ring(v, 2, 38, 20, 60, kind="rail", gaps={(10, 59), (11, 59), (12, 59)}, seed=seed)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
