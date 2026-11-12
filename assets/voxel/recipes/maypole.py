"""
Maypole (2 × 2, D-077 §2, Citizens, `look: civic`): a tall pole of pale
timber with red spiral stripes on a low stepped timber foot, a cross of two
spokes under the top, a wreath of green with flowers round the crown and a
weathervane-cock of brass above; eight ribbons of different colours run from
the spokes down and out to the ground in the cloth sway group. A ring of
paved ground round the pole (`path()`) is the dancing floor. 8 voxels per
tile.
"""

import math

from nsvoxel import parts as P
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, FLOWER, GRASS_B, TIMBER, TIMBER_DARK, TIMBER_LIGHT

POLE = mat("timber", 1.5)
STRIPE = mat("terracotta", 1.05)
RIBBONS = (mat("dye-blue", 1.15), mat("terracotta", 1.2), mat("canvas", 1.2), mat("ochre", 1.15))
TOP = 36


def build(ctx):
    v = ctx.vox()  # 16 × 16
    seed = 51
    c = 8
    # The dancing floor: a paved ring.
    P.path(v, [(x, y) for x in range(16) for y in range(16) if 3.2 < math.hypot(x + 0.5 - c, y + 0.5 - c) <= 7.9], kind="paved")
    # The foot and the pole: a spiral of red on pale timber.
    v.box(c - 2, c - 2, 0, c + 2, c + 2, 1, TIMBER_DARK)
    v.box(c - 1, c - 1, 1, c + 1, c + 1, 3, TIMBER)
    for z in range(3, TOP):
        for i, (x, y) in enumerate(((c - 1, c - 1), (c, c - 1), (c, c), (c - 1, c))):
            v.set(x, y, z, STRIPE if (z + 2 * i) // 4 % 2 == 0 and z > 6 else POLE)
    # Two spokes under the top, the wreath and the cock.
    zs = TOP - 3
    v.box(c - 4, c - 1, zs, c + 4, c + 1, zs + 1, TIMBER_DARK)
    v.box(c - 1, c - 4, zs - 1, c + 1, c + 4, zs, TIMBER_DARK)
    for dx, dy in ((-4, -1), (3, 0), (-1, -4), (0, 3)):
        pass
    wreath = [(c - 2, c - 2), (c + 1, c - 2), (c - 2, c + 1), (c + 1, c + 1)]
    for x in range(c - 2, c + 2):
        for y in range(c - 2, c + 2):
            if (x, y) in ((c - 2, c - 2), (c + 1, c + 1), (c - 2, c + 1), (c + 1, c - 2)) or x in (c - 2, c + 1) or y in (c - 2, c + 1):
                v.set(x, y, zs + 1, GRASS_B)
                v.set(x, y, zs + 2, shade_of(GRASS_B, 1.1) if (x + y) % 2 else mat("terracotta", 1.25))
    v.box(c - 1, c - 1, TOP, c + 1, c + 1, TOP + 2, POLE)
    v.set(c, c, TOP + 2, BRASS)
    v.box(c - 1, c, TOP + 2, c + 1, c + 1, TOP + 4, BRASS)  # the cock
    v.set(c - 1, c, TOP + 4, BRASS)
    # Eight ribbons from the spokes down and out to the ground: lines from the spoke ends to the ground ring.
    ends = [(c - 4, c - 1), (c + 3, c), (c - 1, c - 4), (c, c + 3), (c - 4, c), (c + 3, c - 1), (c, c - 4), (c - 1, c + 3)]
    for k, (sx, sy) in enumerate(ends):
        ang = math.atan2(sy - c + 0.5, sx - c + 0.5) + (0.35 if k < 4 else -0.35)
        gx, gy = round(c - 0.5 + 6.2 * math.cos(ang)), round(c - 0.5 + 6.2 * math.sin(ang))
        gx, gy = max(0, min(15, gx)), max(0, min(15, gy))
        m = P.cloth(RIBBONS[k % 4], "flag")
        a, b = (sx, sy, zs), (gx, gy, 1)
        n = max(abs(b[0] - a[0]), abs(b[1] - a[1]), abs(b[2] - a[2]))
        for t in range(n + 1):
            x, y, z = (round(a[i] + (b[i] - a[i]) * t / n) for i in range(3))
            v.set(x, y, z, m)
    return P.colour_jitter(v, seed=seed)
