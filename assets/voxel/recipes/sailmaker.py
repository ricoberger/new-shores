"""
Sailmaker (4 × 8; V7 rework after the Anno 1404 ropeyard, tier II): a long
half-timbered sail loft on a rubble floor under terracotta with a slim
chimney (smoke), a tall frame hung with big swaying canvas sails, coils of
rope and a cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.25)
SAIL = (P.cloth(mat("canvas", 1.25)), P.cloth(mat("canvas", 1.15)))

def build(ctx):
    v = ctx.vox()  # 48 × 96
    seed = 197
    K.ground(v, 24, 82, 21, 16, seed)
    h = K.hall(v, 6, 6, 48 - 6, 62, 2, "y", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    V.drying_frame(v, 6, 42, 66, 1, 16, SAIL, post=TIMBER_DARK, every=7, drop=13)
    V.drying_frame(v, 6, 42, 76, 1, 14, SAIL, post=TIMBER_DARK, every=7, drop=11)
    K.pile(v, 8, 82, 1, 8, 6, 4, shade_of(TIMBER_LIGHT, 1.1), seed)
    for x in (22, 30):
        v.box(x, 82, 1, x + 5, 87, 3, shade_of(TIMBER, 1.1))
        v.box(x + 1, 83, 3, x + 4, 86, 4, shade_of(TIMBER, 1.2))
    P.handcart(v, 8, 84, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 90, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
