"""Iron mine (3 × 8, on an iron deposit): a rock hill with a timbered adit, rails with an ore cart, a winding house with chimney, ore heaps."""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, IRON_ORE, PLANK, ROCK, ROCK_DEEP, ROCK_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT, MOSS


def build(ctx):
    v = ctx.vox()  # 24 × 64
    P.yard(v, 0, 0, 24, 64, "dirt", seed=55)
    # The hill at the back.
    for x in range(24):
        for y in range(0, 28):
            h = int(14 - abs(x - 12) * 0.5 - max(0, y - 14) * 0.9 + P.hash3(x // 2, y // 2, 0, 55) * 2)
            for z in range(max(1, h)):
                m = MOSS if z == h - 1 and h > 10 else (ROCK_LIGHT if z == h - 1 else (ROCK if (z // 3) % 2 else ROCK_DEEP))
                if P.hash3(x, y, z, 56) < 0.06:
                    m = IRON_ORE
                v.set(x, y, z, m)
    # Adit: dark opening framed in timber.
    v.box(9, 18, 1, 15, 28, 7, None)
    v.box(9, 18, 1, 15, 22, 7, IRON)
    for x in (8, 15):
        v.box(x, 26, 1, x + 1, 28, 8, TIMBER)
    v.box(8, 26, 8, 16, 28, 9, TIMBER_DARK)
    # Rails and an ore cart.
    for y in range(22, 46):
        for x in (10, 13):
            v.set(x, y, 1, IRON)
        if y % 2 == 0:
            v.box(9, y, 0, 15, y + 1, 1, TIMBER)
    v.box(10, 32, 2, 14, 37, 4, TIMBER_DARK)
    v.box(10, 32, 4, 14, 37, 5, IRON_ORE)
    # Winding house with chimney and ore heaps.
    top = P.house(v, 15, 44, 23, 58, "stone", along="y", seed=55)
    P.door(P.Face(v, "x-", 15), 49, 1, 3, 5)
    P.smoke(v, 19, 46, 1, top)
    for cx, cy in ((5, 40), (5, 50)):
        v.ellipsoid(cx, cy, 0, 3.5, 3.5, 3, lambda x, y, z: IRON_ORE if (x + z) % 3 else ROCK_DEEP, keep=lambda x, y, z: z >= 1)
    v.box(2, 56, 1, 10, 58, 2, PLANK)
    v.anchor("cart", 8, 61, 1)

    return v
