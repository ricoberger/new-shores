"""
Meadery (4 × 5; V7 rework, tier II): a half-timbered meadery gabled to the
street on a rubble floor under terracotta with a slim chimney (smoke), a row
of straw skeps, golden mead barrels in a pyramid and honey jars. 12 voxels
per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("ochre", 1.5)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 191
    K.ground(v, 24, 49, 21, 12, seed)
    h = K.hall(v, 6, 6, 48 - 6, 33, 2, "y", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for x in (30, 36, 42):
        K.hive(v, x, 38)
    for row, n in enumerate((4, 3, 2)):
        for i in range(n):
            P.barrel(v, 8 + i * 4 + row * 2, 40, 1 + row * 4, h=4, m=GOODS)
    P.cask(v, 30, 50, 1, h=4, lid=GOODS)
    P.cask(v, 34, 50, 1, h=4, lid=GOODS)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
