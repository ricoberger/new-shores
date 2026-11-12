"""
Hedge (1 × 1 paint family, D-077 §2, Settlers, `look: civic`): a clipped
box hedge running along x across the tile, two voxels wide and four high,
its top a shade lighter. The straight piece; the join variants (corner,
T, cross, end) come with the paint-family models. 8 voxels per tile; no
ground paint.
"""

from nsvoxel import parts as P
from nsvoxel.grid import shade_of
from nsvoxel.mats import CROWN


def build(ctx):
    v = ctx.vox()  # 8 × 8
    v.box(0, 3, 0, 8, 5, 4, shade_of(CROWN, 0.9))
    v.box(0, 3, 4, 8, 5, 5, CROWN)
    return P.colour_jitter(v, seed=31)
