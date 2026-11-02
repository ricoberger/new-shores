"""
Cheese dairy (4 × 5; V7 rework, tier II): a half-timbered dairy gabled to
the street on a rubble floor under terracotta with a slim chimney (smoke), a
tall stack of big pale cheese wheels on a shelf, milk churns, a cheese press
and a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("ochre", 1.55)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 183
    K.ground(v, 24, 49, 21, 12, seed)
    h = K.hall(v, 6, 6, 48 - 6, 33, 2, "y", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for z in (1, 4, 7):
        for i in range(3):
            v.box(8 + i * 8, 40, z, 14 + i * 8, 46, z + 3, GOODS)
    for x in (34, 38):
        P.cask(v, x, 40, 1, h=5, lid=CANVAS)
    v.box(8, 50, 1, 20, 54, 3, TIMBER_LIGHT)
    v.box(12, 51, 3, 16, 53, 8, TIMBER_DARK)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
