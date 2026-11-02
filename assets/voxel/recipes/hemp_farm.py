"""
Hemp farm (3 × 4; V7 rework after the Anno 1404 hemp plantation, tier II):
a timber-framed farmhouse (rubble ground floor, half-timber, terracotta,
slim chimney with smoke) with an outside plank stair to a loft platform
loaded with green hemp bundles, a drying rack of hemp stooks, a retting
pond with bundles soaking, big bales of hemp and a hand cart. 12 voxels
per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import HEMP, HEMP_MARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

FIBRE = mat("hemp", 1.05)  # bright green-grey bundles


def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 37
    K.ground(v, 20, 24, 15, 16, seed)
    h = K.hall(v, 10, 5, 32, 25, 2, "x", seed, door=("y+", 20), smoke=True, chim=(24, 9), wins=[14])
    # Outside stair on the west gable to a loft platform with hemp bundles.
    W.stairs(v, 6, 8, 1, 5, side=1, width=3)
    v.box(4, 14, 10, 10, 24, 11, TIMBER_LIGHT)
    for y in (14, 23):
        v.box(4, y, 1, 5, y + 1, 10, TIMBER_DARK)
    K.pile(v, 5, 16, 11, 4, 6, 4, FIBRE, seed)
    # Drying rack with stooks, retting pond, bales and the cart.
    for x in range(14, 30, 4):
        v.box(x, 34, 1, x + 1, 35, 9, TIMBER_DARK)
    v.box(14, 34, 9, 30, 35, 10, TIMBER_LIGHT)
    for x in range(15, 30, 4):
        v.box(x, 34, 3, x + 3, 36, 9, FIBRE)
    K.ground(v, 7, 38, 5, 4, seed, "dirt")
    for x, y in ((5, 37), (8, 39), (6, 41)):
        v.box(x, y, 1, x + 3, y + 2, 2, shade_of(HEMP_MARK, 0.8))
    K.pile(v, 24, 38, 1, 5, 4, 4, FIBRE, seed + 1)
    P.handcart(v, 16, 42, 1, along="x", load=FIBRE)
    v.anchor("cart", 22, 46, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
