"""
Fisher (3 × 8, back 3 rows over water; D-057 §3): a thatched settler hut
(pegged frame, plaster, shutters), a coursed-stone smokehouse with a
squat chimney (smoke), net racks with hanging nets and drying fish, fish
barrels and baskets, a plank jetty on piles with a mooring post and
lobster pots (the boat's mooring: `boat`).
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, PLANK, PLASTER_WARM, TIMBER, TIMBER_DARK, TIMBER_LIGHT

NET = mat("timber", 1.2)
FISH = mat("iron", 1.45)


def build(ctx):
    v = ctx.vox()
    W, D, land = ctx.W, ctx.D, ctx.land  # 24 × 64, land from y 24
    seed = 5
    # Jetty: planks x 12..17 from the shore out to y 2, piles every 5 rows.
    for y in range(2, land + 2):
        for x in range(12, 17):
            v.set(x, y, 0, P.shade_of(PLANK, 1.0 if (y // 2) % 2 else 0.9))
        if y % 5 == 2:
            for x in (12, 16):
                v.box(x, y, -8, x + 1, y + 1, 0, TIMBER_DARK)
                v.set(x, y, 1, TIMBER_DARK)
    v.box(11, 3, -6, 12, 4, 2, TIMBER)  # mooring post
    v.set(11, 4, 1, TIMBER_LIGHT)
    P.box_crate(v, 13, 4, 1)
    for x, y in ((14, 8), (13, 12)):  # lobster pots
        v.box(x, y, 1, x + 2, y + 2, 3, P.shade_of(TIMBER_LIGHT, 0.85))
        v.set(x, y, 2, None)
    v.anchor("boat", 8.4, 11.2, 0.4)
    # Shore and yard.
    P.yard(v, 0, land, W, land + 6, "sand", seed=seed)
    P.yard(v, 0, land + 6, W, D, "dirt", seed=seed)
    P.yard(v, 0, D - 8, W, D, "grass", seed=seed)
    P.path(v, [(x, y) for x in range(10, 14) for y in range(land, D)])
    # Hut: timber frame and thatch, door toward the road.
    b = P.building(v, 2, 31, 15, 43, "settler", along="y", wall=PLASTER_WARM, seed=seed, spacing=5, braces=("x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 7, 2, 3, 5)
    P.casement(f, 3, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.casement(b.face("y-"), 6, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
    P.casement(b.face("x-"), 36, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
    P.roof_chimney(v, b.roof, 5, 38, above=2)
    # Smokehouse: coursed stone, thatch, a squat chimney (the smoke anchor).
    s = P.building(v, 17, 33, 23, 41, "stonethatch", along="y", seed=seed + 1, height=8)
    P.entrance(s.face("y+"), 19, 2, 2, 4, step=None)
    P.roof_chimney(v, s.roof, 19, 36, above=2, anchor=True)
    # Net racks between the hut and the road: posts with hanging nets and drying fish.
    for ry in (47, 52):
        for x in (2, 8, 14):
            v.box(x, ry, 1, x + 1, ry + 1, 6, TIMBER)
        v.box(2, ry, 6, 15, ry + 1, 7, TIMBER_LIGHT)
        for x in range(3, 14):
            if x != 8:
                for z in range(3, 6):
                    if (x + z) % 2 == 0:
                        v.set(x, ry, z, NET)
    for x in range(17, 22, 2):
        v.box(x, 48, 5, x + 1, 49, 6, TIMBER_LIGHT)
        v.box(x, 48, 2, x + 1, 49, 5, FISH)
    v.box(16, 48, 6, 23, 49, 7, TIMBER)
    v.box(16, 48, 1, 17, 49, 6, TIMBER)
    v.box(22, 48, 1, 23, 49, 6, TIMBER)
    P.cask(v, 17, 51, 1, lid=FISH)
    P.cask(v, 20, 52, 1)
    P.box_crate(v, 18, 55, 1, contents=FISH)
    P.box_crate(v, 2, 57, 1)
    P.sacks(v, 5, 57, 1, n=2, m=CANVAS)
    v.anchor("cart", 13.6, 60.8, 1)
    v.anchor("door", 12, 64, 0)
    P.scatter(v, 0, land + 6, W, D, 0.02, seed=seed)
    return P.colour_jitter(v, seed=seed)
