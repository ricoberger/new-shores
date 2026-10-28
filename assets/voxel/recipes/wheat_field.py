"""Wheat field tile (1 × 1): furrows of soil between ripe wheat rows with darker ears."""

from nsvoxel.grid import shade_of
from nsvoxel.mats import DIRT, WHEAT, WHEAT_MARK


def build(ctx):
    v = ctx.vox()
    for x in range(8):
        for y in range(8):
            if x % 4 == 3:
                v.set(x, y, 0, shade_of(DIRT, 0.9))
                continue
            v.set(x, y, 0, shade_of(WHEAT, 0.8))
            v.set(x, y, 1, WHEAT)
            v.set(x, y, 2, WHEAT_MARK if (x + y) % 4 == 0 else WHEAT)
    return v
