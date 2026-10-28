"""
Quarry (3 × 8, on a stone deposit; D-057 §3): stepped pit faces of
layered rock at the back with pale freshly cut treads and loose rubble, a
timber hoist with rope and a hanging block, cut blocks in piles, a
mason's hut in coursed stone with thatch and a chimney (smoke), a hand
cart of blocks and a tool rack.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3
from nsvoxel.mats import IRON, ROCK, ROCK_DEEP, ROCK_LIGHT, STONE, STONE_LIGHT, TIMBER, TIMBER_LIGHT

FRESH = P.mat("stone", 1.12)


def build(ctx):
    v = ctx.vox()  # 24 × 64
    seed = 9
    P.yard(v, 0, 0, 24, 64, "dirt", seed=seed)
    # Quarry face: layered rock terraces stepping up toward the back.
    for y in range(0, 26):
        h = 2 + (26 - y) // 3
        for x in range(0, 24):
            hh = h - (1 if hash3(x, y, 1, seed) < 0.12 else 0)
            for z in range(0, hh):
                band = ROCK_LIGHT if z == hh - 1 else (ROCK if (z // 2 + (x // 5)) % 2 else ROCK_DEEP)
                v.set(x, y, z, band)
    # Cut terraces: pale fresh stone on the treads, cut lines, rubble.
    for y in (8, 14, 20):
        for x in range(2, 22):
            z = 2 + (26 - y) // 3
            v.set(x, y, z - 1, FRESH)
            v.set(x, y + 1, z - 1, FRESH if x % 4 else STONE)
        for x in range(3, 21, 5):
            if hash3(x, y, 2, seed) < 0.6:
                v.set(x, y + 1, 2 + (26 - y) // 3, STONE_LIGHT)
    for x, y in ((4, 27), (5, 27), (18, 27), (11, 28)):
        v.set(x, y, 1, ROCK_LIGHT)
    # Hoist: A-frame, a beam, rope and a block on the hook.
    for x in (6, 12):
        v.line((x, 28, 1), (9, 24, 14), TIMBER)
    v.box(9, 21, 14, 10, 27, 15, TIMBER_LIGHT)
    for z in range(9, 14):
        v.set(9, 21, z, IRON)
    v.box(8, 20, 7, 11, 22, 9, FRESH)
    # Cut blocks in piles.
    P.stone_blocks(v, 2, 30, 1, n=5, seed=seed)
    P.stone_blocks(v, 14, 31, 1, n=4, seed=seed + 1)
    P.stone_blocks(v, 17, 36, 1, n=2, m=STONE, seed=seed + 2)
    # Mason's hut with chimney.
    b = P.building(v, 4, 43, 17, 53, "stonethatch", along="x", seed=seed)
    f = b.face("y+")
    P.entrance(f, 9, 2, 3, 5)
    for a in (5, 14):
        P.casement(f, a, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED, shutters=TIMBER_LIGHT)
    P.roof_chimney(v, b.roof, 13, 46, above=3, anchor=True)
    P.tool_rack(b.face("x+"), 45, 1, n=3)
    P.handcart(v, 19, 44, 1, along="y", load=FRESH)
    P.cask(v, 2, 55, 1)
    P.box_crate(v, 5, 56, 1)
    v.anchor("cart", 20, 60, 1)
    P.scatter(v, 0, 27, 24, 64, 0.02, seed=seed, kinds=("pebble", "pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
