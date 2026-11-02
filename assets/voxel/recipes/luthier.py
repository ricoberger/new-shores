"""
Luthier (5 × 5; V7 rework, tier IV): a cream plaster workshop on an ashlar
floor under slate (no chimney), a rack of big violins and lutes with pale
necks and strings in the forecourt, a stack of pale tonewood planks drying
and a workbench. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("timber", 1.0)
NECK = mat("plaster", 1.1)

def build(ctx):
    v = ctx.vox()  # 60 × 60
    seed = 161
    K.ground(v, 30, 45, 27, 16, seed, "paved")
    h = K.hall(v, 6, 6, 60 - 6, 25, 4, "x", seed, door=("y+", 28), wins=[])
    for k, x in enumerate(range(10, 44, 8)):
        v.box(x, 34, 1, x + 1, 35, 11, TIMBER_DARK)
        v.box(x + 6, 34, 1, x + 7, 35, 11, TIMBER_DARK)
        v.box(x, 34, 10, x + 7, 35, 11, TIMBER_DARK)
        v.box(x + 2, 34, 3, x + 5, 35, 7, GOODS)
        v.box(x + 3, 34, 7, x + 4, 35, 10, NECK)
        v.box(x + 3, 34, 2, x + 4, 35, 3, TIMBER_DARK)
    K.pile(v, 40, 44, 1, 12, 5, 6, K.FRESH, seed)
    v.box(8, 46, 1, 28, 50, 3, TIMBER_LIGHT)
    v.box(10, 47, 3, 20, 49, 5, GOODS)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
