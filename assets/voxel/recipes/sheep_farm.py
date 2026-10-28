"""Sheep farm (3 × 3): shepherd's cottage with chimney, an open fold with hurdles, wool sacks and a shearing bench."""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, THATCH, TIMBER, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()
    P.yard(v, 0, 0, 24, 24, "grass", seed=44)
    top = P.house(v, 2, 3, 15, 13, "settler", along="x", seed=44)
    f = P.Face(v, "y+", 12)
    P.door(f, 7, 2, 3, 5)
    P.window(f, 3, 4, 2, 2, shutters=TIMBER_LIGHT)
    P.window(f, 12, 4, 2, 2)
    P.smoke(v, 11, 6, 1, top)
    # Fold: hurdle fence with a lean-to shelter.
    P.fence(v, 15, 2, 23, 14, gaps={(18, 13), (19, 13)})
    for y in (3, 7):
        v.box(21, y, 1, 22, y + 1, 6, TIMBER)
    v.shed(17, 22, 3, 8, 6, THATCH, down="x-", ov=0)
    for x, y in ((3, 16), (5, 16), (3, 18)):
        P.sack(v, x, y, 1, m=CANVAS)
    v.box(9, 17, 1, 14, 19, 2, TIMBER)
    v.box(9, 17, 2, 14, 19, 3, TIMBER_LIGHT)
    v.anchor("cart", 19, 21, 1)
    return v
