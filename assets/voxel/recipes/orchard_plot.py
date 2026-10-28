"""Orchard plot (1 × 1 field): one apple tree on mown grass."""

from nsvoxel import parts as P
from nsvoxel.mats import ORCHARD


def build(ctx):
    v = ctx.vox()
    for x in range(8):
        for y in range(8):
            v.set(x, y, 0, ORCHARD)
    P.tree(v, 4, 4, 1, "fruit", 5)
    return v
