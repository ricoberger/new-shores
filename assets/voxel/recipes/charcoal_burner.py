"""
Charcoal burner (5 × 6; V7 rework after the Anno 1404 charcoal burner's
hut, tier II): three big earth-covered kilns on stakes with a sooty base,
moss and turf patches, one smoking through its vent (the smoke); billets
stacked for the next kiln, a ladder against a kiln, a half-timbered burner's
hut under terracotta, a heap of black charcoal and a cart. 12 voxels per tile.
"""

import math

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import hash3
from nsvoxel.mats import MOSS, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

EARTH = P.mat("rock-deep", 0.9)
TURF = P.mat("grass-b", 0.75)
SOOT = P.mat("iron", 0.8)
CHARCOAL = P.mat("iron", 0.62)


def kiln(v, cx, cy, r, h, seed):
    def m(x, y, z):
        if z <= 1:
            return SOOT
        hh = hash3(x, y, z, seed)
        if z >= h - 3 and hh < 0.35:
            return MOSS
        return TURF if hh > 0.86 else EARTH

    v.ellipsoid(cx, cy, 0, r, r, h, m, keep=lambda x, y, z: z >= 1)
    for k in range(10):  # stakes round the base
        a = k * 0.628 + seed
        x, y = int(cx + math.cos(a) * (r + 0.6)), int(cy + math.sin(a) * (r + 0.6))
        v.box(x, y, 1, x + 1, y + 1, 5, TIMBER_DARK)


def build(ctx):
    v = ctx.vox()  # 60 × 72
    seed = 54
    K.ground(v, 30, 40, 26, 30, seed)
    kiln(v, 16, 38, 10, 11, 1)
    kiln(v, 42, 34, 9, 10, 2)
    kiln(v, 38, 58, 8, 8, 3)
    P.chimney_stack(v, 14, 37, 9, 12, m=SOOT, cap=EARTH, pots=0, anchor=True)
    P.ladder(P.Face(v, "y+", 45), 38, 1, 8)
    P.log_stack(v, 6, 24, 1, length=16, along="x", n=3)
    P.woodpile(v, 6, 30, 1, length=14, along="x", rows=3)
    for x in range(44, 54):
        for y in range(52, 60):
            h = 1 + (1 if hash3(x, y, 9, seed) < 0.5 else 0) + (2 if 47 < x < 52 and 54 < y < 58 else 0)
            v.box(x, y, 1, x + 1, y + 1, 1 + h, CHARCOAL)
    K.workshop(v, 6, 4, 26, 18, 2, "a", seed, door=("y+", 12), wins=[], chimney=False)
    P.handcart(v, 8, 62, 1, along="x", load=CHARCOAL)
    v.anchor("cart", 14, 68, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
