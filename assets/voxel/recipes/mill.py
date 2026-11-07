"""
Windmill (3 × 3; D-074 §6, the lone tower mill of Anno 1404, tier II): a
tapered tower of dark boards on a rubble foot with a gallery and a conical
thatch cap, four big pale lattice sails on a brass hub turned to the camera
(the sail plane faces the camera's left, the hub carried clear of the
tower on a shaft); no miller's house — a door on the camera side, a few
flour sacks and a hand cart on the worked ground round the foot.
12 voxels per tile.
"""

import math

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, CANVAS, STONE, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BOARD = mat("timber", 0.7)
SAIL = mat("canvas", 1.15)
SPAR = mat("timber", 1.3)


R2 = math.sqrt(0.5)


def sail(v, hx, hy, hz, ang, length=16):
    """
    One lattice sail in the vertical plane through (hx, hy) along (1, 1) — the plane faces the camera's left, along
    (−1, 1), so the sails read face on at rotation 0 and from behind at 2: a spar and a lattice of canvas on one side
    of it. A step of the plane is a step in x and in y, two voxels thick so the staircase holds together.
    """
    dx, dz = math.cos(ang), math.sin(ang)
    px, pz = -dz, dx

    def put(s, z, m):
        x, y = int(round(hx + s * R2)), int(round(hy + s * R2))
        v.set(x, y, int(round(z)), m)
        v.set(x + 1, y, int(round(z)), m)

    for t in range(2, length):
        for w in (0, 1):
            put(dx * t + px * w, hz + dz * t + pz * w, SPAR)
        if t >= 5:
            for k in range(2, 7):
                if 2 < k < 6 and (t + k) % 3 == 0 and t % 2 == 0:
                    continue
                put(dx * t + px * k, hz + dz * t + pz * k, SAIL)


def build(ctx):
    v = ctx.vox()  # 36 × 36
    seed = 3
    cx, cy, zt = 18, 18, 38
    K.ground(v, cx, cy + 3, 13, 12, seed)
    # the tower: rubble foot, then boards in two shades, tapering to the cap
    for z in range(1, zt):
        r = 7.0 - 0.45 * (z // 6)  # a stepped taper: whole courses merge into few faces
        for x in range(cx - 8, cx + 8):
            for y in range(cy - 8, cy + 8):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if d <= r:
                    if z < 12:
                        v.set(x, y, z, shade_of(STONE, 0.9 if (z // 6) % 2 else 1.0))
                    else:
                        v.set(x, y, z, BOARD if (z // 6) % 2 else shade_of(BOARD, 0.88))
    for x in range(cx - 6, cx + 6):
        for y in range(cy - 6, cy + 6):
            if math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 5:
                v.set(x, y, zt - 1, TIMBER_DARK)
    # gallery round the first boarded storey
    for x in range(cx - 9, cx + 9):
        for y in range(cy - 9, cy + 9):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if 6.4 < d <= 8.2:
                v.set(x, y, 12, TIMBER_LIGHT)
    V.cone_roof(v, cx, cy, 6.0, zt, K.THATCH, rise=1.0)
    # door and window on the camera side (+y)
    v.box(cx - 2, cy + 5, 1, cx + 2, cy + 8, 8, TIMBER_DARK)
    v.box(cx - 1, cy + 4, 18, cx + 1, cy + 7, 22, TIMBER_DARK)
    # hub and four sails on the camera side of the cap (−x / +y), the hub carried clear of the tower on a shaft
    hz = 36
    hx, hy = cx - 6, cy + 6
    for k in range(6):
        v.box(cx - 1 - k, cy - 1 + k, hz - 1, cx + 1 - k, cy + 1 + k, hz + 1, BRASS)
    v.box(hx - 1, hy - 1, hz - 1, hx + 2, hy + 2, hz + 2, BRASS)
    for k in range(4):
        sail(v, hx, hy, hz, math.radians(45 + 90 * k))
    # flour sacks by the door, a hand cart at the corner
    P.sacks(v, cx + 4, cy + 10, 1, n=3, m=CANVAS)
    P.sacks(v, cx + 9, cy + 7, 1, n=2, m=CANVAS, along="y")
    P.handcart(v, 3, cy + 12, 1, along="x", load=CANVAS)
    v.anchor("cart", cx - 4, cy + 13, 1)
    K.tufts(v, seed, density=0.015)
    return P.colour_jitter(v, seed=seed)
