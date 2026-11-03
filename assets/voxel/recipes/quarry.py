"""
Quarry (3 × 8, on a stone deposit; V7 rework after the Anno 1404 stone
mason's hut, tier II): stepped pit faces of layered rock at the back with
pale freshly cut treads, a big timber hoist (A-frame, beam, rope and a
pale block on the hook), cut blocks in tall piles, a rubble-and-half-timber
mason's hut under terracotta with a slim chimney (smoke), a hand cart of
blocks. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import hash3, shade_of
from nsvoxel.mats import IRON, ROCK, ROCK_DEEP, ROCK_LIGHT, STONE, STONE_LIGHT, TIMBER, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

FRESH = shade_of(STONE_LIGHT, 1.2)


def build(ctx):
    v = ctx.vox()  # 36 × 96
    seed = 47
    for y in range(0, 40):
        h = 3 + (40 - y) // 3
        for x in range(0, 36):
            hh = h - (1 if hash3(x, y, 1, seed) < 0.12 else 0)
            for z in range(0, hh):
                v.set(x, y, z, ROCK_LIGHT if z == hh - 1 else (ROCK if (z // 3 + (x // 7)) % 2 else ROCK_DEEP))
    for y in (10, 20, 30):
        z = 3 + (40 - y) // 3
        for x in range(3, 33):
            v.set(x, y, z - 1, FRESH)
            v.set(x, y + 1, z - 1, FRESH if x % 4 else STONE)
            v.set(x, y + 2, z - 1, FRESH)
    # Hoist.
    for x in (8, 18):
        v.line((x, 44, 1), (13, 38, 20), TIMBER)
    v.box(13, 32, 20, 14, 42, 21, TIMBER_LIGHT)
    for z in range(11, 20):
        v.set(13, 32, z, IRON)
    v.box(11, 30, 8, 16, 34, 12, FRESH)
    P.stone_blocks(v, 4, 48, 1, n=6, seed=seed)
    P.stone_blocks(v, 22, 50, 1, n=5, seed=seed + 1)
    K.ground(v, 20, 66, 14, 22, seed)
    K.workshop(v, 4, 66, 22, 82, 2, "a", seed, door=("y+", 8), smoke=True, chim=(18, 70), wins=[])
    P.handcart(v, 24, 62, 1, along="x", load=FRESH)
    P.tool_rack(K.P.Face(v, "x-", 4), 70, 1, n=2)
    v.anchor("cart", 28, 70, 1)
    P.scatter(v, 0, 42, 36, 96, 0.012, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)
