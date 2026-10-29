"""
Salt pans (5 × 9, back 3 rows over water; D-057 §3): evaporation basins
on low stone walls over the water rows — sea water, brine and white
crystallising pans with raked salt ridges — plank walks between them, a
jetty with a moored salt barge (the boat's mooring beside it: `boat`);
on land a great white salt heap, a tiled salt-workers' hut, rakes, salt
sacks and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, PLANK, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SALT = mat("foam")
SACK = mat("plaster", 1.1)
BRINE = mat("shallows", 1.15)
BRINE_PALE = mat("shallows", 1.35)
SEA = mat("shallows", 0.95)


def build(ctx):
    v = ctx.vox()
    W, D, land = ctx.W, ctx.D, ctx.land  # 40 × 72, land from y 24
    seed = 79
    # Basins: three columns × two rows on low walls standing in the water.
    stages = ((SEA, BRINE, BRINE_PALE), (BRINE, BRINE_PALE, SALT))
    for j, (ya, yb) in enumerate(((2, 12), (13, 23))):
        for i, (xa, xb) in enumerate(((1, 11), (11, 21), (21, 31))):
            for x in range(xa, xb):
                for y in range(ya, yb):
                    edge = x in (xa, xb - 1) or y in (ya, yb - 1)
                    if edge:
                        v.box(x, y, -6, x + 1, y + 1, 1, STONE if (x + y) % 3 else STONE_DARK)
                    else:
                        c = stages[j][i]
                        v.box(x, y, -6, x + 1, y + 1, 0, STONE_DARK)
                        v.set(x, y, 0, c)
                        # Raked ridges of salt in the white pans.
                        if c == SALT and (y - ya) % 3 == 0:
                            v.set(x, y, 1, SALT)
    # Plank walks over the walls between the rows.
    for x in range(1, 31):
        v.set(x, 12, 1, PLANK)
    # Jetty on piles and the moored barge.
    for y in range(1, land):
        for x in range(32, 36):
            v.set(x, y, 0, P.shade_of(PLANK, 1.0 if (y // 2) % 2 else 0.9))
        if y % 5 == 1:
            for x in (32, 35):
                v.box(x, y, -8, x + 1, y + 1, 0, TIMBER_DARK)
    for y in (3, 15):
        v.box(36, y, -1, 37, y + 1, 2, TIMBER)  # mooring posts
    bx0, bx1, by0, by1 = 36, 41, 4, 18
    for y in range(by0, by1):
        taper = 1 if y in (by0, by1 - 1) else 0
        for x in range(bx0 + taper, bx1 - taper):
            v.set(x, y, -1, TIMBER_DARK)
            side = x in (bx0 + taper, bx1 - 1 - taper) or y in (by0, by1 - 1)
            if side:
                v.set(x, y, 0, TIMBER)
                v.set(x, y, 1, TIMBER_LIGHT)
            else:
                v.set(x, y, 0, PLANK)
    P.sacks(v, 37, 7, 1, n=3, m=SACK, along="y")
    v.anchor("boat", 37.6, 21.6, 0.4)
    # Quay edge and the land.
    for x in range(W):
        v.box(x, land, -2, x + 1, land + 1, 1, STONE_DARK if x % 4 else STONE)
    P.yard(v, 0, land + 1, W, D, "sand", seed=seed)
    P.yard(v, 0, land + 30, W, D, "dirt", seed=seed)
    V.heap(v, 11, 36, r=7.5, h=9, m=SALT, seed=seed, ragged=0.35)
    for x in range(4, 19, 4):
        v.box(x, 44, 1, x + 1, 45, 4, TIMBER_LIGHT)  # a rake leaning on the heap's foot
        v.set(x, 45, 3, TIMBER_DARK)
    # Salt-workers' hut: stone, tiles, a door to the yard.
    b = P.building(v, 22, 30, 36, 42, "stone", along="x", seed=seed, height=9)
    P.entrance(b.face("y+"), 27, 2, 3, 5)
    P.casement(b.face("y+"), 32, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, shutters=mat("dye-blue"))
    P.casement(b.face("x-"), 35, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, shutters=mat("dye-blue"))
    P.roof_chimney(v, b.roof, 24, 33, above=2)
    P.sacks(v, 23, 46, 1, n=3, m=SACK)
    P.sacks(v, 24, 48, 1, n=2, m=CANVAS)
    P.box_crate(v, 31, 46, 1, contents=SALT)
    # A tiled store shed with stacked sacks, a second heap, the cart.
    P.lean_to(v, 26, 38, 52, 62, 8, "tiles", down="y+", posts=True)
    for x in range(27, 37, 2):
        P.sacks(v, x, 54, 1, n=1, m=SACK)
        P.sacks(v, x, 57, 1, n=1, m=SACK)
    V.heap(v, 8, 54, r=4, h=5, m=SALT, seed=seed + 1, ragged=0.35)
    P.handcart(v, 14, 60, 1, along="x", load=SALT)
    P.cask(v, 34, 48, 1)
    v.anchor("cart", 20, 66, 1)
    v.anchor("door", 20, 72, 0)
    P.scatter(v, 0, land + 30, W, D, 0.02, seed=seed)
    return P.colour_jitter(v, seed=seed)
