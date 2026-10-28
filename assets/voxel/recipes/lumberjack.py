"""Lumberjack (3 × 3): log cabin with a stone chimney, log piles, chopping block with an axe, a young conifer."""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, PLANK, THATCH, THATCH_DARK, TIMBER, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()
    P.yard(v, 0, 0, 24, 24, "dirt", seed=3)
    P.yard(v, 0, 0, 24, 5, "grass", seed=3)
    # Log cabin: alternating courses of logs with pale crossed ends at the corners.
    x0, y0, x1, y1 = 3, 5, 16, 15
    for z in range(1, 8):
        m = TIMBER if z % 2 else TIMBER_LIGHT
        v.walls(x0, y0, x1, y1, z, z + 1, m)
        for cx, cy in ((x0 - 1, y0), (x1, y0), (x0 - 1, y1 - 1), (x1, y1 - 1)):
            if z % 2:
                v.set(cx, cy, z, PLANK)
    v.box(x0, y0, 7, x1, y1, 8, TIMBER)
    top = v.gable(x0, x1, y0, y1, 8, THATCH, TIMBER, along="x", rise=1.5, ov=1, ridge=THATCH_DARK, seed=3)
    f = P.Face(v, "y+", y1 - 1)
    P.door(f, 8, 1, 3, 5)
    P.window(f, 4, 3, 2, 2, frame=PLANK)
    P.window(f, 12, 3, 2, 2, frame=PLANK)
    P.smoke(v, 4, 9, 1, top + 1)
    P.logs(v, 17, 6, 1, n=3, length=6, along="y")
    P.logs(v, 3, 17, 1, n=3, length=7, along="x")
    # Chopping block with an axe, split wood.
    v.box(14, 18, 1, 16, 20, 3, TIMBER_LIGHT)
    v.set(15, 18, 3, IRON)
    v.set(15, 19, 3, TIMBER)
    P.planks(v, 17, 16, 1, w=4, d=2, h=2, along="y")
    P.tree(v, 20, 3, 1, "conifer")
    v.anchor("cart", 20, 22, 1)
    return v
