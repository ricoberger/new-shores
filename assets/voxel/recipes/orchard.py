"""
Orchard (4 × 4; V7 variety pass, tier II): a long half-timbered fruit
grower's house with a slim chimney (smoke); in front a row of big apple
trees, a wooden bin heaped with red apples and crates. 12 voxels per tile;
massing and signature prop in NOTES.md.
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
    K.ground(v, 24, 41, 21, 9, seed)
    h = K.workshop(v, 6, 6, 48 - 6, 28, 2, "a", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for x in (8, 22, 36):
        P.fruit_tree(v, x, 32, 1, seed=seed + x)
        P.fruit_tree(v, x + 6, 40, 1, seed=seed + x + 1)
    v.box(4, 38, 1, 16, 46, 6, TIMBER_LIGHT)
    V.heap(v, 10, 42, r=5, h=4, m=GOODS, seed=seed, z=6)
    K.crates(v, ((38, 42, 1), (41, 42, 1), (39, 45, 1)))
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
