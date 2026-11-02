"""
Apiary (5 × 5; V7 rework, tier II): a half-timbered beekeeper's house on a
rubble floor under terracotta with a slim chimney (smoke), two rows of big
straw skeps on planks, flower beds, honey barrels and a cart. 12 voxels per
tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("thatch", 1.3)

def build(ctx):
    v = ctx.vox()  # 60 × 60
    seed = 181
    K.ground(v, 30, 45, 27, 16, seed)
    h = K.hall(v, 6, 6, 60 - 6, 25, 2, "x", seed, door=("y+", 28), smoke=True, chim=(46, 10), wins=[])
    for k, x in enumerate(range(8, 50, 8)):
        K.hive(v, x, 36)
        K.hive(v, x + 2, 46)
    P.flower_bed(v, 8, 52, 30, 56, 1, seed=seed)
    P.cask(v, 46, 54, 1, lid=mat("ochre", 1.5))
    P.cask(v, 50, 54, 1, lid=mat("ochre", 1.5))
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
