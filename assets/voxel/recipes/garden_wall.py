"""
Garden wall (1 × 1 paint family, D-077 §2, Settlers, `look: civic`): a low
fieldstone wall running along x across the tile, two voxels wide and three
high, under a lighter coping course. The straight piece; the join
variants come with the paint-family models. 8 voxels per tile; no ground
paint.
"""

from nsvoxel import parts as P
from nsvoxel.mats import STONE, STONE_LIGHT


def build(ctx):
    v = ctx.vox()  # 8 × 8
    v.box(0, 3, 0, 8, 5, 3, STONE)
    v.box(0, 3, 3, 8, 5, 4, STONE_LIGHT)
    return P.colour_jitter(v, seed=32)
