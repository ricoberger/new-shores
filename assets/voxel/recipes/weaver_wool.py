"""Wool weaver (3 × 4): settler workshop with a loom visible under a lean-to, dyed cloth drying on a line, wool bales."""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, DYE_BLUE, TERRACOTTA, THATCH, TIMBER, TIMBER_LIGHT, OCHRE

CLOTH = (P.mat("dye-blue", 1.0, "cloth"), P.mat("terracotta", 1.05, "cloth"), P.mat("ochre", 1.0, "cloth"), P.mat("canvas", 1.0, "cloth"))


def build(ctx):
    v = ctx.vox()  # 24 × 32
    P.yard(v, 0, 0, 24, 32, "grass", seed=53)
    P.yard(v, 2, 16, 22, 30, "dirt", seed=53)
    top = P.house(v, 2, 3, 16, 14, "settler", along="x", seed=53)
    f = P.Face(v, "y+", 13)
    P.door(f, 7, 2, 3, 5)
    P.window(f, 3, 4, 2, 2, shutters=DYE_BLUE)
    P.window(f, 12, 4, 2, 2, shutters=DYE_BLUE)
    P.smoke(v, 13, 6, 1, top - 1)
    # Lean-to with a loom.
    for y in (4, 12):
        v.box(21, y, 1, 22, y + 1, 6, TIMBER)
    v.shed(16, 22, 4, 13, 6, THATCH, down="x+", ov=0)
    v.box(17, 6, 1, 20, 11, 4, TIMBER_LIGHT)
    v.box(18, 7, 1, 19, 10, 4, None)
    v.box(17, 7, 3, 20, 10, 4, CANVAS)
    # Washing line with cloth.
    for x in (3, 20):
        v.box(x, 20, 1, x + 1, 21, 7, TIMBER)
    for k, x in enumerate(range(5, 19, 4)):
        v.box(x, 20, 3, x + 3, 21, 7, CLOTH[k % 4])
    for x, y in ((4, 25), (7, 25), (4, 27)):
        v.box(x, y, 1, x + 2, y + 2, 3, P.mat("canvas", 1.05))
    v.anchor("cart", 18, 29, 1)

    return v
