"""
Pastry kitchen (4 × 5; V7 rework, tier III): a stone-and-timber bakehouse
under dark burgundy tiles with a slim chimney (smoke), a striped awning over
a display table piled with golden pastries, a brick-accent oven and flour
sacks. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("ochre", 1.45)
PINK = mat("terracotta", 1.5)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 211
    K.ground(v, 24, 45, 21, 16, seed)
    h = K.hall(v, 6, 6, 48 - 6, 25, 3, "x", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    V.face_awning(h.face("y+"), 10, 26, 10, depth=4)
    v.box(8, 36, 1, 28, 40, 4, TIMBER_LIGHT)
    for i, x in enumerate(range(9, 27, 4)):
        v.box(x, 37, 4, x + 3, 39, 6, GOODS if i % 2 else PINK)
    K.kiln(v, 34, 36, 1, w=8, d=8, h=8)
    P.sacks(v, 8, 46, 1, n=3, m=CANVAS)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
