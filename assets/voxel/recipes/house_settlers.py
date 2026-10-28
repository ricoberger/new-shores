"""Settler house (3 × 3): timber frame, steep thatch, stone plinth; three variants (gable to the side, gable to the front, L-plan)."""

from nsvoxel import parts as P
from nsvoxel.mats import PLASTER, PLASTER_WARM, STONE, STONE_DARK, THATCH, THATCH_DARK, TIMBER, TIMBER_LIGHT, OCHRE

VARIANTS = 3


def body(v, x0, y0, x1, y1, wall, z1=9):
    v.box(x0, y0, 1, x1, y1, 2, STONE_DARK)
    P.timber_frame(v, x0, y0, x1, y1, 2, z1, wall, TIMBER, spacing=5, braces=False, sill=False)


def build(ctx):
    v = ctx.vox()
    k = ctx.variant
    seed = 11 + k
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    wall = (PLASTER, PLASTER_WARM, OCHRE)[k]
    if k == 0:
        x0, y0, x1, y1 = 4, 7, 20, 17
        body(v, x0, y0, x1, y1, wall)
        top = v.gable(x0, x1, y0, y1, 9, THATCH, wall, along="x", rise=1.5, ov=1, ridge=THATCH_DARK, seed=seed)
        f = P.Face(v, "y+", y1 - 1)
        P.door(f, 10, 2, 3, 5)
        P.window(f, 6, 4, 2, 2, shutters=TIMBER_LIGHT)
        P.window(f, 15, 4, 2, 2, shutters=TIMBER_LIGHT)
        P.window(P.Face(v, "x+", x1 - 1), 11, 4, 2, 2)
        P.window(P.Face(v, "x-", x0), 11, 4, 2, 2)
        P.chimney(v, 5, 11, 2, top + 1)
        P.logs(v, 20, 10, 1, n=3, length=4, along="y")
        P.fence(v, 1, 18, 23, 23, gaps={(10, 22), (11, 22), (12, 22)})
        P.path(v, [(x, y) for x in range(10, 13) for y in range(17, 24)])
        P.bush(v, 4, 20, 1, 2, seed=seed)
        P.barrel(v, 17, 18, 1)
    elif k == 1:
        x0, y0, x1, y1 = 6, 4, 18, 18
        body(v, x0, y0, x1, y1, wall)
        top = v.gable(x0, x1, y0, y1, 9, THATCH, wall, along="y", rise=1.5, ov=1, ridge=THATCH_DARK, seed=seed)
        f = P.Face(v, "y+", y1 - 1)
        P.door(f, 9, 2, 3, 5)
        P.window(f, 13, 4, 2, 2, shutters=TIMBER)
        P.window(f, 11, 10, 2, 2, sill=False)
        for side, plane in (("x+", x1 - 1), ("x-", x0)):
            F = P.Face(v, side, plane)
            P.window(F, 7, 4, 2, 2)
            P.window(F, 13, 4, 2, 2)
        # Lean-to woodshed on the east side.
        v.box(18, 9, 1, 22, 15, 2, STONE_DARK)
        for y in (9, 14):
            v.box(21, y, 2, 22, y + 1, 6, TIMBER)
        P.logs(v, 18, 10, 2, n=3, length=4, along="y")
        v.shed(18, 22, 9, 15, 6, THATCH, down="x+", ov=1)
        P.chimney(v, 13, 6, 2, top - 2)
        P.fence(v, 1, 19, 23, 23, gaps={(9, 22), (10, 22), (11, 22)})
        P.path(v, [(x, y) for x in range(9, 12) for y in range(18, 24)])
        P.bush(v, 3, 7, 1, 2, seed=seed)
        P.bush(v, 20, 4, 1, 2, seed=seed + 1)
    else:
        # L-plan: main range along x at the back, a wing toward the front on the west.
        body(v, 3, 5, 21, 13, wall)
        body(v, 3, 13, 11, 20, wall)
        top = v.gable(3, 21, 5, 13, 9, THATCH, wall, along="x", rise=1.5, ov=1, ridge=THATCH_DARK, seed=seed)
        v.gable(3, 11, 9, 20, 9, THATCH, wall, along="y", rise=1.5, ov=1, ridge=THATCH_DARK, seed=seed)
        f = P.Face(v, "y+", 12)
        P.door(f, 14, 2, 3, 5)
        P.window(f, 18, 4, 2, 2, shutters=TIMBER_LIGHT)
        P.window(P.Face(v, "y+", 19), 6, 4, 2, 2, shutters=TIMBER_LIGHT)
        P.window(P.Face(v, "x+", 10), 15, 4, 2, 2)
        P.chimney(v, 17, 7, 2, top)
        # Kitchen garden in the angle.
        for x in range(13, 21):
            for y in range(15, 21):
                v.set(x, y, 0, P.mat("road-dirt", 0.9) if x % 2 else P.mat("grass-b", 0.85))
                if x % 2 == 0 and y % 2 == 0:
                    v.set(x, y, 1, P.mat("grass-a", 1.1))
        P.fence(v, 12, 14, 22, 22, gaps={(17, 21)})
        P.barrel(v, 11, 21, 1)
        P.crate(v, 1, 21, 1)
    return v.jitter(0.04, roles={"plaster", "ochre", "stone"}, cell=2, seed=seed)
