"""
Woad farm (3 × 4; D-057 §3): a stone farmhouse with a tiled roof and a
woad mill — a round stone bed with an upright edge-runner stone on a
sweep beam — beside an open drying shed whose shelves are full of dark
blue-green woad balls; leaf baskets, a vat, a cart.
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

LEAF = mat("hemp", 0.82)
BALL = mat("shallows", 0.5)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 69
    P.yard(v, 0, 0, 24, 32, "grass", seed=seed)
    P.yard(v, 1, 14, 23, 30, "dirt", seed=seed)
    # Farmhouse: coursed stone, tiles, chimney, door to the yard.
    b = P.building(v, 2, 3, 13, 12, "stone", along="y", seed=seed, height=9)
    P.entrance(b.face("y+"), 6, 2, 3, 5)
    P.casement(b.face("x+"), 5, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, shutters=TIMBER_LIGHT)
    P.casement(b.face("x-"), 7, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, shutters=TIMBER_LIGHT)
    P.roof_chimney(v, b.roof, 4, 4, above=3)
    # Drying shed: posts, a tiled lean-to, three shelves of woad balls.
    P.lean_to(v, 15, 23, 2, 12, 11, "tiles", down="y+", posts=True)
    for z in (3, 6, 9):
        v.box(15, 3, z - 1, 23, 11, z, TIMBER_LIGHT)
        for x in range(15, 23):
            for y in range(4, 11):
                if (x + y) % 2 == 0:
                    v.set(x, y, z, BALL)
    for x in (15, 19, 22):
        v.box(x, 6, 1, x + 1, 7, 11, TIMBER)
    # Woad mill: a round stone bed, the runner stone on its sweep beam.
    cx, cy = 7, 21
    for x in range(cx - 5, cx + 6):
        for y in range(cy - 5, cy + 6):
            d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            if d <= 5:
                v.set(x, y, 1, STONE if d > 3.6 else LEAF)
                if d > 4.4:
                    v.set(x, y, 2, STONE_DARK)
    v.box(cx, cy, 1, cx + 1, cy + 1, 6, TIMBER_DARK)
    v.box(cx + 1, cy - 1, 2, cx + 3, cy + 2, 6, STONE_LIGHT)  # runner stone on edge
    v.box(cx - 6, cy, 5, cx + 1, cy + 1, 6, TIMBER)  # sweep beam
    # Leaf baskets, a steeping vat, sacks, cart.
    for x, y in ((15, 16), (18, 16)):
        P.box_crate(v, x, y, 1, s=2, m=TIMBER_LIGHT, contents=LEAF)
    v.box(19, 21, 1, 23, 25, 4, TIMBER)
    v.box(20, 22, 3, 22, 24, 4, BALL)
    for zz in (1, 3):
        v.box(19, 21, zz, 23, 25, zz + 1, TIMBER_DARK)
    v.box(20, 22, 3, 22, 24, 4, mat("shallows", 0.6))
    P.sacks(v, 14, 25, 1, n=2, m=CANVAS)
    P.handcart(v, 2, 28, 1, along="x", load=BALL)
    v.anchor("cart", 16, 29, 1)
    P.scatter(v, 0, 0, 24, 32, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)
