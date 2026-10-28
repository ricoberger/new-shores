"""Sawmill (4 × 6): open-sided saw shed with a log on the saw bench, timber workshop with chimney, log and plank stacks."""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, PLANK, THATCH, TIMBER, TIMBER_DARK, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()  # 32 × 48
    P.yard(v, 0, 0, 32, 48, "dirt", seed=8)
    # Workshop at the back.
    top = P.house(v, 4, 4, 22, 16, "settler", along="x", seed=8)
    f = P.Face(v, "y+", 15)
    P.door(f, 11, 2, 3, 5)
    P.windows(v, "y+", 15, 5, 21, 4, skip=(11,))
    P.smoke(v, 18, 8, 1, top)
    # Open saw shed: posts and a lean-to roof over the bench.
    for x in (4, 13, 22):
        for y in (20, 29):
            v.box(x, y, 1, x + 1, y + 1, 9, TIMBER)
    v.shed(4, 23, 20, 30, 9, THATCH, down="y+", ov=1)
    v.box(6, 23, 1, 21, 26, 3, TIMBER_DARK)
    v.box(6, 24, 3, 20, 25, 4, TIMBER_LIGHT)  # log on the bench
    for z in range(3, 7):
        v.set(13, 23, z, IRON)  # frame saw blade
    v.box(12, 23, 7, 15, 24, 8, TIMBER)
    # Stacks.
    P.logs(v, 24, 4, 1, n=3, length=10, along="y")
    P.logs(v, 3, 33, 1, n=3, length=8, along="x")
    P.planks(v, 15, 33, 1, w=10, d=4, h=3)
    P.planks(v, 24, 34, 1, w=8, d=3, h=2, along="y")
    v.box(4, 40, 1, 12, 41, 2, PLANK)
    v.anchor("cart", 26, 44, 1)
    return v
