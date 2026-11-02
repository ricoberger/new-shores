"""
Lace maker (3 × 5; V7 rework, tier IV): a narrow cream plaster house on an
ashlar floor under slate (no chimney), tall frames hung with white lace, a
pale pillow and bobbins on a table, a flower bed. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.35)

def build(ctx):
    v = ctx.vox()  # 36 × 60
    seed = 159
    K.ground(v, 18, 49, 15, 12, seed, "paved")
    h = K.hall(v, 6, 6, 36 - 6, 33, 4, "y", seed, door=("y+", 16), wins=[])
    K.rack(v, 6, 30, 34, GOODS, h=13, drop=10)
    K.rack(v, 6, 30, 42, [GOODS, shade_of(GOODS, 0.9)], h=11, drop=8)
    v.box(8, 48, 1, 20, 52, 3, TIMBER_LIGHT)
    K.pile(v, 10, 48, 3, 8, 4, 2, GOODS, seed)
    P.flower_bed(v, 24, 46, 32, 52, 1, seed=seed)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
