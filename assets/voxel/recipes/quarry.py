"""Quarry (3 × 8, on a stone deposit): stepped pit faces of cut stone at the back, a hoist, cut blocks and a stone mason's hut."""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, ROCK, ROCK_DEEP, ROCK_LIGHT, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()  # 24 × 64
    P.yard(v, 0, 0, 24, 64, "dirt", seed=9)
    # Quarry face: terraces of rock stepping up toward the back.
    for y in range(0, 26):
        h = 2 + (26 - y) // 3
        for x in range(0, 24):
            hh = h - (1 if (x * 7 + y) % 11 == 0 else 0)
            for z in range(0, hh):
                band = ROCK_LIGHT if z == hh - 1 else (ROCK if (z // 2) % 2 else ROCK_DEEP)
                v.set(x, y, z, band)
    # Cut terraces: pale fresh stone on the step treads.
    for y in (8, 14, 20):
        for x in range(2, 22):
            v.set(x, y, 2 + (26 - y) // 3, STONE_LIGHT)
    # Hoist: A-frame with rope.
    for x in (6, 12):
        v.line((x, 27, 1), (9, 24, 14), TIMBER)
    v.box(9, 22, 14, 10, 27, 15, TIMBER_LIGHT)
    for z in range(8, 14):
        v.set(9, 22, z, IRON)
    # Cut blocks.
    for k, (x, y) in enumerate(((2, 30), (6, 30), (2, 34), (14, 31), (17, 31), (15, 35))):
        v.box(x, y, 1, x + 3, y + 3, 3 + (k % 2), STONE if k % 2 else STONE_LIGHT)
    # Mason's hut with chimney.
    top = P.house(v, 4, 42, 18, 54, "stonethatch", along="x", seed=9)
    P.door(P.Face(v, "y+", 53), 9, 1, 3, 5)
    P.windows(v, "y+", 53, 5, 17, 4, skip=(9,))
    P.smoke(v, 14, 46, 1, top)
    v.box(19, 44, 1, 22, 50, 2, STONE_DARK)
    v.anchor("cart", 20, 60, 1)
    return v
