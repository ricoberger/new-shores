"""
Charcoal burner (5 × 6; D-057 §3): three earth-covered kilns with a
sooty base, moss and turf patches, one smoking through its vent (the
smoke); billets stacked for the next kiln, a ladder against a kiln, a
burner's hut with a timber frame and thatch, charcoal sacks and a cart.
"""

import math

from nsvoxel import parts as P
from nsvoxel.grid import hash3
from nsvoxel.mats import MOSS, PLANK, TIMBER_LIGHT

EARTH = P.mat("rock-deep", 0.9)
TURF = P.mat("grass-b", 0.75)
SOOT = P.mat("iron", 0.8)
CHARCOAL = P.mat("iron", 0.7)


def kiln(v, cx, cy, r, h, seed):
    def m(x, y, z):
        if z <= 1:
            return SOOT
        hh = hash3(x, y, z, seed)
        if z >= h - 2 and hh < 0.35:
            return MOSS
        return TURF if hh > 0.86 else EARTH

    v.ellipsoid(cx, cy, 0, r, r, h, m, keep=lambda x, y, z: z >= 1)
    # Vent holes round the base.
    for k in range(6):
        a = k * 1.047 + seed
        x, y = int(cx + math.cos(a) * (r - 0.4)), int(cy + math.sin(a) * (r - 0.4))
        v.set(x, y, 1, CHARCOAL)


def build(ctx):
    v = ctx.vox()  # 40 × 48
    seed = 54
    P.yard(v, 0, 0, 40, 48, "dirt", seed=seed)
    for x in range(40):
        for y in range(48):
            if hash3(x // 3, y // 3, 5, seed) < 0.18:
                v.set(x, y, 0, P.mat("road-dirt", 0.8))
    kiln(v, 11, 12, 7, 7, 1)
    kiln(v, 28, 11, 6, 6, 2)
    kiln(v, 26, 27, 5.5, 5, 3)
    P.chimney_stack(v, 10, 11, 6, 8, m=SOOT, cap=EARTH, pots=0, anchor=True)
    P.ladder(P.Face(v, "y+", 16), 27, 1, 6)
    # Billets stacked for the next kiln, a pile of finished charcoal.
    P.log_stack(v, 4, 24, 1, length=12, along="x", n=3)
    P.woodpile(v, 4, 31, 1, length=10, along="x", rows=3)
    for x in range(30, 36):
        for y in range(36, 41):
            h = 1 + (1 if hash3(x, y, 9, seed) < 0.5 else 0) + (1 if 31 < x < 35 and 36 < y < 40 else 0)
            v.box(x, y, 1, x + 1, y + 1, 1 + h, CHARCOAL)
    # Burner's hut.
    b = P.building(v, 4, 37, 16, 45, "settler", along="x", seed=seed, spacing=5, braces=("x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 8, 2, 3, 5)
    P.casement(f, 13, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.roof_chimney(v, b.roof, 6, 40, above=2)
    P.sacks(v, 19, 38, 1, n=3, m=P.mat("canvas", 0.8))
    P.sacks(v, 19, 41, 1, n=2, m=P.mat("canvas", 0.8))
    P.handcart(v, 25, 40, 1, along="x", load=CHARCOAL)
    P.cask(v, 1, 44, 1)
    P.box_crate(v, 17, 45, 1, m=PLANK)
    v.anchor("cart", 34, 45, 1)
    P.scatter(v, 0, 0, 40, 48, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
