"""
Hemp field tile (1 × 1; D-057 §3, V7 leftovers): rows of tall hemp — single
stalks of uneven height (five to seven voxels, one every other cell, a few missing) in the field
palette's hemp-mark green with a lighter tip on some, between the furrows the
client paints. The rows run along x on the painted ridges.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3, shade_of
from nsvoxel.mats import HEMP_MARK

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

STALK = shade_of(HEMP_MARK, 0.9)
TIP = shade_of(HEMP_MARK, 1.12)


def build(ctx):
    v = ctx.vox()
    seed = 23
    for x in range(8):
        for y in range(8):
            if y % 4 >= 2 or (x + y) % 2:
                continue  # a stalk every other cell, the rows two cells wide
            h = hash3(x, y, 61, seed)
            if hash3(x, y, 60, seed) < 0.2:
                continue
            n = 5 + (1 if h < 0.65 else 0) + (1 if h < 0.3 else 0)
            for k in range(n - 1):
                v.set(x, y, 1 + k, STALK)
            v.set(x, y, n, TIP if hash3(y, x, 62, seed) < 0.2 else HEMP_MARK)
    return P.colour_jitter(v, seed=seed, scale=0.5)
