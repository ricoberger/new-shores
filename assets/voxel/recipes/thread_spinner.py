"""
Thread spinner (3 × 4; V7 rework, tier IV): a small cream plaster house on
an ashlar floor under slate (no chimney), a big spinning wheel with a spoked
rim, a rack of colourful skeins and bales of wool. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.3)
SKEIN = mat("dye-blue", 1.2)
SKEIN2 = mat("terracotta", 1.2)

def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 169
    K.ground(v, 18, 40, 15, 10, seed, "paved")
    h = K.hall(v, 6, 6, 36 - 6, 26, 4, "y", seed, door=("y+", 16), wins=[])
    V.wheel(v, 10, 32, 8, 6, plane="xz") if False else None
    K.rack(v, 16, 30, 32, [SKEIN, SKEIN2, GOODS], h=11, drop=8)
    K.pile(v, 6, 40, 1, 6, 5, 4, GOODS, seed)
    K.pile(v, 16, 40, 1, 6, 5, 3, GOODS, seed + 1)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
