"""
Cooperage (4 × 6; D-057 §3, V5): a barrel hall of ashlar under a thatched
roof with its front open on posts — barrels on the floor inside, a
firing basket and a chimney (smoke) — and in the yard barrels stacked
two high, hoops leaning against the wall and stacked flat, stacks of
staves, a shaving horse and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, PLANK, TIMBER, TIMBER_DARK, TIMBER_LIGHT  # noqa: F401

ROOF = mat("thatch")
GLOW = mat("flower", 1.0)


def hoop(v, x, y, z, along="x"):
    """An iron hoop standing on edge (a 4 × 4 ring)."""
    for i in range(4):
        for j in range(4):
            if i in (0, 3) or j in (0, 3):
                if (i, j) in ((0, 0), (0, 3), (3, 0), (3, 3)):
                    continue
                if along == "x":
                    v.set(x + i, y, z + j, IRON)
                else:
                    v.set(x, y + i, z + j, IRON)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 97
    P.yard(v, 0, 0, 32, 48, "dirt", seed=seed)
    # Barrel hall: three closed walls, the front open on posts.
    x0, y0, x1, y1 = 2, 3, 30, 22
    P.plinth(v, x0, y0, x1, y1, 1, mat("stone", 0.84), out=1)
    Q.ashlar(v, x0, y0, x1, y1, 1, 11, core=False)
    v.box(x0 + 1, y1 - 1, 1, x1 - 1, y1, 9, None)
    for x in (x0, 9, 16, 23, x1 - 1):
        v.box(x, y1 - 1, 1, x + 1, y1, 11, TIMBER)
    v.box(x0, y1 - 1, 9, x1, y1, 11, TIMBER_DARK)
    v.box(x0 + 1, y0 + 1, 0, x1 - 1, y1 - 1, 1, mat("road-dirt", 0.9))
    r = P.roof(v, x0, x1, y0, y1, 11, "thatch", along="x", m=ROOF, gable=Q.ASHLAR, seed=seed)
    P.roof_chimney(v, r, 6, 6, above=3, brick=True, anchor=True)
    # Inside: barrels on the floor, a firing basket under a half-made barrel.
    for x in (5, 9, 13):
        P.cask(v, x, 14, 1, h=4)
    v.box(19, 13, 1, 22, 16, 2, IRON)
    v.box(20, 14, 1, 21, 15, 2, GLOW)
    for i in range(3):
        v.set(19 + i, 13, 2, TIMBER_LIGHT)
        v.set(19 + i, 15, 2, TIMBER_LIGHT)
    v.box(19, 13, 3, 22, 16, 5, TIMBER_LIGHT)
    v.box(20, 14, 3, 21, 15, 5, None)
    # Yard: barrels two high, hoops, staves, a shaving horse.
    for x in range(3, 18, 3):
        P.cask(v, x, 26, 1, h=4)
        P.cask(v, x, 26, 5, h=4)
    for x in range(3, 15, 3):
        P.cask(v, x, 30, 1, h=4)
    for x in (19, 23, 27):
        hoop(v, x, 23, 1)
    for k in range(3):  # a stack of hoops lying flat
        for i in range(4):
            for j in range(4):
                if (i in (0, 3) or j in (0, 3)) and (i, j) not in ((0, 0), (0, 3), (3, 0), (3, 3)):
                    v.set(26 + i, 26 + j, 1 + k, IRON)
    P.planks(v, 20, 30, 1, w=8, d=3, h=3)
    P.sawhorse(v, 22, 36, 1, log=False)
    v.box(21, 37, 3, 27, 38, 4, PLANK)
    P.handcart(v, 4, 38, 1, along="x", load=TIMBER_LIGHT)
    v.anchor("cart", 14, 46, 1)
    P.scatter(v, 0, 40, 32, 48, 0.02, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
