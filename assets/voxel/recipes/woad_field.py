"""
Woad field tile (1 × 1; D-057 §3, V7 leftovers): rows of low blue-green woad
bushes in two shades, uneven, with yellow flower spikes standing out of a few
(woad flowers yellow; its blue is the dyer's). The rows run along x on the
painted ridges.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import FLOWER

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

#: Woad's leaves: a dull grey-green and a teal, bushes cell by cell.
GREEN = mat("hemp", 0.92)
BLUE = mat("woad", 0.9)


def build(ctx):
    v = ctx.vox()
    seed = 31
    for x in range(8):
        for y in range(8):
            if y % 4 >= 2:
                continue
            h = hash3(x, y, 63, seed)
            n = 2 + (1 if h < 0.7 else 0)
            m = BLUE if hash3(x, y, 64, seed) < 0.5 else GREEN
            for k in range(n):
                v.set(x, y, 1 + k, shade_of(m, 1.1) if k == n - 1 else m)
            if hash3(x, y, 65, seed) < 0.2:
                v.set(x, y, n + 1, FLOWER)
                if hash3(x, y, 66, seed) < 0.3:
                    v.set(x, y, n + 2, FLOWER)
    return P.colour_jitter(v, seed=seed)
