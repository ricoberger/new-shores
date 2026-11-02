"""
Optician (4 × 4; V7 rework, tier IV): a cream plaster house on an ashlar
floor under slate with a slim chimney (smoke), a big brass telescope on a
tripod pointing at the sky, a bright round lens on a stand, glass blanks on
a bench. 12 voxels per tile.
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
BRASS = mat("ochre", 1.5)
GLASS = mat("shallows", 1.5)

def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 163
    K.ground(v, 24, 40, 21, 10, seed, "paved")
    h = K.hall(v, 6, 6, 48 - 6, 26, 4, "y", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for dx, dy in ((0, 0), (6, 0), (3, 5)):
        v.box(12 + dx, 30 + dy, 1, 13 + dx, 31 + dy, 9, TIMBER_DARK)
    v.box(10, 30, 9, 20, 36, 10, TIMBER_DARK)
    v.line((12, 32, 10), (24, 34, 20), BRASS)
    v.line((12, 33, 10), (24, 35, 20), BRASS)
    v.box(24, 33, 19, 27, 37, 22, BRASS)
    v.ellipsoid(36, 34, 5, 3.5, 3.5, 3.5, lambda x, y, z: GLASS, keep=lambda x, y, z: z >= 2)
    v.box(35, 33, 1, 37, 35, 3, TIMBER_DARK)
    v.box(30, 40, 1, 44, 44, 3, TIMBER_LIGHT)
    v.box(32, 41, 3, 36, 43, 4, GLASS)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
