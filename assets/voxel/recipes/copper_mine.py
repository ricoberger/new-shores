"""
Copper mine (3 × 8, on a copper deposit; D-057 §3, V5): a rock hill with
green-brown ore seams in courses (verdigris over rock-brown) and a
timbered adit, a headframe hoist with its sheave wheel over a shaft in
the yard, rails with an ore tub, heaps of green-brown ore, a winding
house of ashlar with tiles, pit props and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat
from nsvoxel.mats import IRON, MOSS, PLANK, ROCK, ROCK_DEEP, ROCK_LIGHT, STONE_DARK, TIMBER, TIMBER_DARK

ORE = mat("deposit-iron", 0.95)
ROOF = mat("terracotta", 0.9)


def ore(x, y, z):
    """Green-brown ore in courses: verdigris and ore-brown bands."""
    return Q.VERDIGRIS if z % 2 else ORE


def build(ctx):
    v = ctx.vox()  # 24 × 64
    seed = 89
    P.yard(v, 0, 0, 24, 64, "dirt", seed=seed)
    # The hill with green seams in courses.
    for x in range(24):
        for y in range(0, 26):
            h = int(14 - abs(x - 12) * 0.45 - max(0, y - 12) * 0.9 + hash3(x // 3, y // 3, 0, seed) * 2)
            for z in range(max(1, h)):
                if z == h - 1:
                    m = MOSS if h > 11 else ROCK_LIGHT
                elif (z + x // 6) % 4 == 1:
                    m = Q.VERDIGRIS
                elif (z + x // 6) % 4 == 2:
                    m = ORE
                else:
                    m = ROCK if (z // 3) % 2 else ROCK_DEEP
                v.set(x, y, z, m)
    # Adit framed in timber.
    v.box(3, 16, 1, 9, 26, 7, None)
    v.box(3, 16, 1, 9, 20, 7, IRON)
    for x in (2, 9):
        v.box(x, 24, 1, x + 1, 26, 8, TIMBER)
    v.box(2, 24, 8, 10, 26, 9, TIMBER_DARK)
    for x in range(2, 10, 2):
        v.set(x, 25, 8, PLANK)
    # Rails from the adit, an ore tub.
    for y in range(20, 40):
        for x in (4, 7):
            v.set(x, y, 1, IRON)
        if y % 2 == 0:
            v.box(3, y, 0, 9, y + 1, 1, TIMBER)
    v.box(4, 30, 2, 8, 35, 4, TIMBER_DARK)
    v.box(4, 30, 4, 8, 35, 5, Q.VERDIGRIS)
    v.set(5, 32, 5, ORE)
    # Headframe over the shaft.
    v.box(13, 30, 0, 20, 36, 1, STONE_DARK)
    v.box(15, 32, 0, 18, 34, 1, IRON)
    Q.headframe(v, 16, 33, 1, 16, along="x")
    # Winding house: ashlar, tiles.
    b = P.building(v, 13, 42, 23, 56, "stone", along="y", height=10, roof=ROOF, seed=seed)
    P.entrance(b.face("x-"), 50, 2, 3, 5)
    Q.window(b.face("x-"), 45, 4, 2, 3, hood="key", surround=True)
    Q.window(b.face("y+"), 17, 4, 2, 3, hood="key", surround=True)
    v.box(17, 36, 9, 18, 42, 10, TIMBER_DARK)  # rope to the winding house
    # Ore heaps, pit props, cart.
    Q.heap(v, 5, 46, 3.5, 3.5, 3, ore)
    Q.heap(v, 5, 55, 3.0, 3.0, 2.5, ore)
    P.log_stack(v, 13, 58, 1, length=8, along="x", n=2)
    P.handcart(v, 2, 59, 1, along="x", load=Q.VERDIGRIS)
    P.tool_rack(b.face("x-"), 53, 1, n=2)
    v.anchor("cart", 10, 61, 1)
    P.scatter(v, 0, 26, 24, 64, 0.02, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
