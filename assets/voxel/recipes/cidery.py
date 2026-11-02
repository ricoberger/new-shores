"""
Cidery (5 × 6; V7 rework, tier II): a half-timbered cider house on a rubble
floor under terracotta with a slim chimney (smoke), a big heap of red
apples, a stone press with a screw, rows of cider barrels and two apple
trees. 12 voxels per tile.
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
    v = ctx.vox()  # 60 × 72
    seed = 187
    K.ground(v, 30, 54, 27, 20, seed)
    h = K.hall(v, 6, 6, 60 - 6, 30, 2, "x", seed, door=("y+", 28), smoke=True, chim=(46, 10), wins=[])
    V.heap(v, 12, 48, r=6, h=6, m=GOODS, seed=seed)
    v.box(26, 44, 1, 36, 54, 4, mat("stone", 1.0))
    v.box(29, 47, 4, 33, 51, 12, TIMBER_DARK)
    v.box(27, 48, 12, 35, 50, 14, TIMBER)
    for i in range(5):
        P.barrel(v, 40 + i * 4, 62, 1, h=4, m=mat("timber", 1.25))
    for i in range(4):
        P.barrel(v, 42 + i * 4, 62, 5, h=4, m=mat("timber", 1.25))
    P.fruit_tree(v, 8, 62, 1, seed=seed)
    P.fruit_tree(v, 50, 46, 1, seed=seed + 1)
    P.handcart(v, 8, 60, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 66, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
