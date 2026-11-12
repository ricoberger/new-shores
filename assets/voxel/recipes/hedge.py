"""
Hedge (1 × 1 paint family, D-077 §2, Settlers, `look: civic`): a clipped
box hedge two voxels wide and four high along the tile's centre line, its
top course a shade lighter. The straight piece runs along x; the join
pieces (config.PAINT_JOINS: corner, T, cross, end; `hedge.<piece>`) add
arms toward the tile edges of their neighbours (parts_d077.JOIN_ARMS), so
a painted line joins like a road. 8 voxels per tile; no ground paint.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import shade_of
from nsvoxel.mats import CROWN


def build(ctx):
    v = ctx.vox()  # 8 × 8
    for x, y in O.join_cells(ctx.join, v.w, 3, 5):
        v.box(x, y, 0, x + 1, y + 1, 4, shade_of(CROWN, 0.9))
        v.set(x, y, 4, CROWN)
    return P.colour_jitter(v, seed=31)
