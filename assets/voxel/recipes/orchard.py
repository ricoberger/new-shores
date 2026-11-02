"""
Orchard (4 × 4; V7 rework after the Anno 1404 cider farm, tier II): a small
half-timbered fruit grower's house on a rubble floor under terracotta with a
slim chimney (smoke), a row of big apple trees with red fruit, crates of
apples and a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("terracotta", 1.35)

def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 193
    K.ground(v, 24, 40, 21, 10, seed)
    h = K.hall(v, 6, 6, 48 - 6, 26, 2, "y", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for x in (8, 22, 36):
        P.fruit_tree(v, x, 32, 1, seed=seed + x)
        P.fruit_tree(v, x + 6, 40, 1, seed=seed + x + 1)
    K.crates(v, ((4, 38, 1), (7, 38, 1), (5, 42, 1)))
    V.heap(v, 40, 44, r=3, h=3, m=GOODS, seed=seed)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
