"""
Flower bed (1 × 1, D-077 §2, `look: civic`): a low timber-edged bed of dark
earth planted in rows of three colours — red, yellow and white-blue — with a
few green leaves between, and a taller clump of the red at the middle.
8 voxels per tile; no ground paint.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import DIRT, GRASS_B, TIMBER, TIMBER_DARK, TIMBER_LIGHT

RED = mat("terracotta", 1.25)
YELLOW = mat("ochre", 1.2)
BLUE = mat("dye-blue", 1.2)
WHITE = mat("canvas", 1.25)
EARTH = shade_of(DIRT, 0.7)
LEAF = shade_of(GRASS_B, 0.9)


def build(ctx):
    v = ctx.vox()  # 8 × 8
    seed = 21
    v.box(1, 1, 0, 7, 7, 1, EARTH)
    for x in range(1, 7):  # the timber edge: planks on edge, posts at the corners
        for y in (1, 6):
            v.box(x, y, 0, x + 1, y + 1, 2, TIMBER_LIGHT if x % 2 else TIMBER)
    for y in range(2, 6):
        for x in (1, 6):
            v.box(x, y, 0, x + 1, y + 1, 2, TIMBER_LIGHT if y % 2 else TIMBER)
    for x, y in ((1, 1), (6, 1), (1, 6), (6, 6)):
        v.set(x, y, 2, TIMBER_DARK)
    rows = (RED, YELLOW, BLUE, WHITE)
    for y in range(2, 6):
        for x in range(2, 6):
            c = rows[(y - 2) % 4] if (x + y) % 2 == 0 else LEAF
            v.set(x, y, 1, LEAF)
            v.set(x, y, 2, c)
            if hash3(x, y, 3, seed) < 0.5:
                v.set(x, y, 3, c if c != LEAF else shade_of(LEAF, 1.15))
    v.set(3, 3, 3, RED)
    v.set(4, 4, 3, RED)
    v.set(3, 4, 4, RED)
    return P.colour_jitter(v, seed=seed)
