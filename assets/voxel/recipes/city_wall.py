"""
City wall (1 × 1 paint family, D-077 §3, Citizens, `look: civic`): a
stone curtain wall running along x across the tile, four voxels thick and
eight high, a wall-walk on top behind a crenellated parapet on both
faces. The straight piece; the join variants and the road arch come with
the paint-family models. 8 voxels per tile; no ground paint.
"""

from nsvoxel import parts as P
from nsvoxel.mats import STONE, STONE_DARK, STONE_LIGHT


def build(ctx):
    v = ctx.vox()  # 8 × 8
    v.box(0, 2, 0, 8, 6, 1, STONE_DARK)
    v.box(0, 2, 1, 8, 6, 8, STONE)
    for y in (2, 5):  # the parapets, merlons every other pair of voxels
        for x in range(0, 8, 4):
            v.box(x, y, 8, x + 2, y + 1, 10, STONE_LIGHT)
    return P.colour_jitter(v, seed=33)
