"""
Vine row (1 × 1 field; D-057 §3, V5): two trellis rows along the tile
(posts at the tile edges, a wire, vine stocks and a leafy band with grape
bunches) on a strip of worked soil, mown grass between the rows; rows
line up across a chain of tiles.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.mats import DIRT, GRASS_A


def build(ctx):
    v = ctx.vox()  # 8 × 8
    seed = 27
    for x in range(8):
        for y in range(8):
            v.set(x, y, 0, P.shade_of(DIRT, 0.9) if x in (1, 2, 3, 5, 6, 7) else GRASS_A)
    for x in (2, 6):
        Q.trellis_row(v, 0, 7, x, z=1, h=5, every=7, seed=seed + x, along="y")
    return P.colour_jitter(v, seed=seed)
