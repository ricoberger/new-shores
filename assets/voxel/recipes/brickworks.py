"""
Brickworks (4 × 5; V7 rework, tier III; no 1404 render): the brick
building: a rectangular brick kiln with a dark chimney (smoke) and an arched
fire-mouth under a long open tiled drying shed with racks of pale unfired
bricks, clay heaps, a stack of fired red bricks and a cart. The kiln is the
only big brick mass; the rest is timber and tile. 12 voxels per tile.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor, half-timber and terracotta tiles — whatever the unlock tier;
the special roofs and signature props are unchanged.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

RAW = mat("plaster", 0.9)
CLAY = mat("terracotta", 1.1)
STONE = mat("stone", 0.9)
EMBER = mat("terracotta", 1.5)


def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 113
    K.ground(v, 24, 32, 21, 18, seed)
    # The kiln: brick walls with buttresses, a stone cap, a slim chimney.
    x0, y0, x1, y1 = 4, 6, 24, 26
    W.coursed_stone_2(v, x0, y0, x1, y1, 1, 16, K.BRICK, seed)
    for x in range(x0 - 1, x1 + 1, 5):
        v.box(x, y1, 1, x + 2, y1 + 2, 12, K.BRICK)
    v.box(x0 - 1, y0 - 1, 16, x1 + 1, y1 + 1, 18, STONE)
    v.box(x0 + 2, y0 + 2, 16, x1 - 2, y1 - 2, 17, K.BRICK)
    W.stack(v, 12, 14, 18, 36, 2, 2)
    v.anchor("chimney", 13, 15, 36)
    v.anchor("smoke", 13, 15, 37)
    v.box(10, y1 - 1, 1, 16, y1 + 2, 9, None)
    v.box(11, y1 - 1, 1, 15, y1 + 1, 7, EMBER)
    # Open drying shed with racks of pale unfired bricks.
    K.lean(v, 26, 46, 6, 30, 12, "y+", tier=2, posts=True)
    for y in (10, 18):
        for x in range(28, 44, 4):
            v.box(x, y, 1, x + 3, y + 6, 3, RAW)
            v.box(x, y, 3, x + 3, y + 6, 5, RAW)
    K.pile(v, 4, 38, 1, 8, 6, 5, K.BRICK, seed)
    K.pile(v, 18, 38, 1, 6, 5, 4, CLAY, seed + 1)
    P.handcart(v, 28, 44, 1, along="x", load=K.BRICK)
    v.anchor("cart", 34, 52, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
