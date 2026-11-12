"""
Garden wall (1 × 1 paint family, D-077 §2, Settlers, `look: civic`): a low
fieldstone wall two voxels wide and three high along the tile's centre
line, under a lighter coping course. The straight piece runs along x; the
join pieces (config.PAINT_JOINS: corner, T, cross, end;
`garden_wall.<piece>`) add arms toward the tile edges of their neighbours
(parts_d077.JOIN_ARMS). 8 voxels per tile; no ground paint.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.mats import STONE, STONE_LIGHT


def build(ctx):
    v = ctx.vox()  # 8 × 8
    for x, y in O.join_cells(ctx.join, v.w, 3, 5):
        v.box(x, y, 0, x + 1, y + 1, 3, STONE)
        v.set(x, y, 3, STONE_LIGHT)
    return P.colour_jitter(v, seed=32)
