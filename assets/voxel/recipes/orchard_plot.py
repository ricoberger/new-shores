"""Orchard plot (1 × 1 field; D-057 §3): one apple tree with an irregular crown and fruit on mown grass with a few windfalls."""

from nsvoxel import parts as P
from nsvoxel.grid import hash3
from nsvoxel.mats import APPLE, ORCHARD


def build(ctx):
    v = ctx.vox()
    for x in range(8):
        for y in range(8):
            v.set(x, y, 0, P.shade_of(ORCHARD, 1.0 if hash3(x, y, 0, 5) < 0.7 else 0.92))
    P.fruit_tree(v, 4, 4, 1, seed=5, fruit=APPLE, trunk=3, r=2.8)
    v.set(1, 6, 1, APPLE)
    v.set(6, 1, 1, APPLE)
    return P.colour_jitter(v, seed=5, scale=0.6)
