"""Fisher (3 × 8, back 3 rows over water): thatched hut, stone smokehouse with chimney, net racks, a jetty on piles with the boat's mooring."""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, PLASTER_WARM, PLANK, STONE, STONE_DARK, THATCH, THATCH_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

NET = mat("timber", 1.2)


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
    P.crate(v, 13, 4, 1)
    v.anchor("boat", 8.4, 11.2, 0.4)
    # Shore and yard.
    P.yard(v, 0, land, W, land + 6, "sand", seed=seed)
    P.yard(v, 0, land + 6, W, D, "dirt", seed=seed)
    P.yard(v, 0, D - 8, W, D, "grass", seed=seed)
    P.path(v, [(x, y) for x in range(10, 14) for y in range(land, D)])
    # Hut: timber frame and thatch, door toward the road.
    x0, y0, x1, y1 = 2, 31, 15, 43
    v.box(x0, y0, 1, x1, y1, 2, STONE_DARK)
    P.timber_frame(v, x0, y0, x1, y1, 2, 9, PLASTER_WARM, TIMBER, spacing=4, braces=False, sill=False)
    top = v.gable(x0, x1, y0, y1, 9, THATCH, PLASTER_WARM, along="y", rise=1.5, ov=1, ridge=THATCH_DARK, seed=seed)
    f = P.Face(v, "y+", y1 - 1)
    P.door(f, 7, 2, 3, 5)
    P.window(f, 3, 4, 2, 2, shutters=TIMBER_LIGHT)
    P.window(P.Face(v, "y-", y0), 6, 4, 2, 2)
    P.window(P.Face(v, "x-", x0), 36, 4, 2, 2)
    # Smokehouse: stone, a squat chimney (the smoke anchor).
    sx0, sy0, sx1, sy1 = 16, 33, 23, 41
    P.stone_wall(v, sx0, sy0, sx1, sy1, 1, 8, STONE, seed)
    v.gable(sx0, sx1, sy0, sy1, 8, THATCH_DARK, STONE, along="y", rise=1, ov=1, seed=seed)
    P.door(P.Face(v, "y+", sy1 - 1), 18, 1, 2, 4, step=None)
    smoke = P.chimney(v, 18, 36, 8, 15)
    v.anchor("chimney", smoke[0], smoke[1], smoke[2] - 1)
    v.anchor("smoke", *smoke)
    # Net racks between the hut and the road: posts with hanging nets and drying fish.
    for ry in (47, 52):
        for x in (2, 8, 14):
            v.box(x, ry, 1, x + 1, ry + 1, 6, TIMBER)
        v.box(2, ry, 6, 15, ry + 1, 7, TIMBER_LIGHT)
        for x in range(3, 14):
            if x not in (8,):
                for z in range(3, 6):
                    if (x + z) % 2 == 0:
                        v.set(x, ry, z, NET)
    for x in range(17, 22, 2):
        v.box(x, 48, 1, x + 1, 49, 4, CANVAS)
    P.barrel(v, 17, 51, 1)
    P.barrel(v, 20, 52, 1)
    P.crate(v, 18, 55, 1)
    P.crate(v, 2, 57, 1)
    v.anchor("cart", 13.6, 60.8, 1)
    v.anchor("door", 12, 64, 0)
    del top
    return v.jitter(0.035, roles={"plaster", "stone"}, cell=2, seed=seed)
