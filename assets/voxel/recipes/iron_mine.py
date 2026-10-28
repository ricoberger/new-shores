"""
Iron mine (3 × 8, on an iron deposit; D-057 §3): a layered rock hill with
ore seams, moss and a timbered adit (posts, cap beam, lagging), rails on
sleepers with an ore tub, a coursed-stone winding house with dressed
quoins, tiles and a chimney (smoke), ore heaps, pit props and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, IRON_ORE, MOSS, PLANK, ROCK, ROCK_DEEP, ROCK_LIGHT, TIMBER, TIMBER_DARK


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
        v.set(x, 27, 1, TIMBER_DARK)
    v.box(8, 26, 8, 16, 28, 9, TIMBER_DARK)
    for x in range(8, 16, 2):
        v.set(x, 27, 8, PLANK)
    v.box(9, 26, 7, 15, 27, 8, TIMBER)  # lagging under the cap
    # Rails and an ore cart.
    for y in range(22, 46):
        for x in (10, 13):
            v.set(x, y, 1, IRON)
        if y % 2 == 0:
            v.box(9, y, 0, 15, y + 1, 1, TIMBER)
    v.box(10, 32, 2, 14, 37, 4, TIMBER_DARK)
    v.box(10, 32, 3, 14, 37, 4, IRON)
    v.box(10, 32, 4, 14, 37, 5, IRON_ORE)
    v.set(11, 33, 5, IRON_ORE)
    v.set(12, 35, 5, P.mat("rock-deep"))
    for y in (33, 36):
        v.set(9, y, 1, TIMBER_DARK)
        v.set(14, y, 1, TIMBER_DARK)
    # Winding house with chimney and ore heaps.
    b = P.building(v, 15, 44, 23, 58, "stone", along="y", seed=55)
    P.entrance(b.face("x-"), 49, 2, 3, 5)
    P.casement(b.face("x-"), 54, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(b.face("y+"), 18, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.roof_chimney(v, b.roof, 18, 46, above=3, anchor=True)
    for cx, cy in ((5, 40), (5, 50)):
        v.ellipsoid(cx, cy, 0, 3.5, 3.5, 3, lambda x, y, z: IRON_ORE if P.hash3(x, y, z, 57) < 0.6 else ROCK_DEEP, keep=lambda x, y, z: z >= 1)
    P.log_stack(v, 2, 56, 1, length=8, along="x", n=2)
    P.handcart(v, 16, 60, 1, along="x", load=IRON_ORE)
    P.tool_rack(b.face("x-"), 45, 1, n=2)
    v.anchor("cart", 8, 61, 1)
    P.scatter(v, 0, 28, 24, 64, 0.02, seed=55, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=55)
