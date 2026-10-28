"""Charcoal burner (5 × 6): three earth-covered kilns (one smoking through its chimney vent), stacked billets, a hut and charcoal sacks."""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, DIRT, MOSS, TIMBER, TIMBER_LIGHT

EARTH = P.mat("rock-deep", 0.9)
SOOT = P.mat("iron", 0.8)


def kiln(v, cx, cy, r, h):
    v.ellipsoid(cx, cy, 0, r, r, h, lambda x, y, z: (MOSS if z >= h - 2 and (x + y) % 3 == 0 else EARTH) if z > 1 else SOOT, keep=lambda x, y, z: z >= 1)


def build(ctx):
    v = ctx.vox()  # 40 × 48
    P.yard(v, 0, 0, 40, 48, "dirt", seed=54)
    for x in range(40):
        for y in range(48):
            if (x // 4 + y // 4) % 5 == 0:
                v.set(x, y, 0, P.mat("road-dirt", 0.8))
    kiln(v, 11, 12, 7, 7)
    kiln(v, 28, 11, 6, 6)
    kiln(v, 26, 27, 5.5, 5)
    smoke = P.smoke(v, 10, 11, 6, 9, m=SOOT, cap=EARTH)
    del smoke
    # Billets stacked for the next kiln.
    P.logs(v, 4, 26, 1, n=4, length=12, along="x")
    P.logs(v, 4, 31, 1, n=3, length=12, along="x")
    # Burner's hut.
    top = P.house(v, 4, 36, 16, 46, "settler", along="x", seed=54)
    P.door(P.Face(v, "y+", 45), 8, 2, 3, 5)
    del top
    for x, y in ((20, 38), (22, 38), (20, 40), (24, 39)):
        P.sack(v, x, y, 1, m=P.mat("iron", 1.1))
    v.box(30, 38, 1, 33, 42, 2, TIMBER_LIGHT)
    v.anchor("cart", 34, 45, 1)

    return v
