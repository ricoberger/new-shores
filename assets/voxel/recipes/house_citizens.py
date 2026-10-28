"""Citizen house (3 × 3): stone ground floor, jettied plaster/ochre upper storey with timber framing, terracotta roof; three variants."""

from nsvoxel import parts as P
from nsvoxel.mats import FLOWER, OCHRE, PLASTER, STONE, STONE_DARK, TERRACOTTA, TERRACOTTA_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, DYE_BLUE

VARIANTS = 3


def storeys(v, x0, y0, x1, y1, upper, seed, braces=False):
    """Stone ground floor z 1..8, joists, jettied timber-framed upper floor z 8..15 (one voxel wider)."""
    P.stone_wall(v, x0, y0, x1, y1, 1, 8, STONE, seed)
    P.quoins(v, x0, y0, x1, y1, 1, 8)
    P.jetty(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 7)
    P.timber_frame(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 8, 15, upper, TIMBER, spacing=5, braces=braces, sill=True)
    return x0 - 1, y0 - 1, x1 + 1, y1 + 1


def flowerbox(f, a, z, w=4):
    for i in range(w):
        f.put(a + i, z, TIMBER, out=1)
        f.put(a + i, z + 1, FLOWER if i % 2 == 0 else P.mat("grass-a", 1.05), out=1)


def build(ctx):
    v = ctx.vox()
    k = ctx.variant
    seed = 31 + k
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    P.yard(v, 2, 17, 22, 23, "paved", seed=seed)
    upper = (OCHRE, PLASTER, OCHRE)[k]
    if k == 0:
        X0, Y0, X1, Y1 = storeys(v, 4, 6, 20, 16, upper, seed)
        top = v.gable(X0, X1, Y0, Y1, 15, TERRACOTTA, upper, along="x", rise=1, ov=1, ridge=TERRACOTTA_DARK, seed=seed)
        f = P.Face(v, "y+", 15)
        P.door(f, 10, 1, 3, 5, leaf=DYE_BLUE)
        P.window(f, 6, 3, 2, 3, frame=STONE_DARK)
        P.window(f, 15, 3, 2, 3, frame=STONE_DARK)
        F = P.Face(v, "y+", Y1 - 1)
        for a in (6, 11, 16):
            P.window(F, a, 10, 2, 3, frame=TIMBER_LIGHT, shutters=TIMBER)
        flowerbox(F, 5, 8)
        flowerbox(F, 15, 8)
        P.window(P.Face(v, "x+", X1 - 1), 10, 10, 2, 3)
        P.window(P.Face(v, "x-", X0), 10, 10, 2, 3)
        P.dormer(v, 10, 14, 13, 18, TERRACOTTA, upper)
        P.chimney(v, 16, 9, 8, top + 1)
        P.barrel(v, 20, 18, 1)
        P.bush(v, 3, 20, 1, 2, seed=seed)
    elif k == 1:
        X0, Y0, X1, Y1 = storeys(v, 6, 4, 18, 17, upper, seed, braces=True)
        top = v.gable(X0, X1, Y0, Y1, 15, TERRACOTTA, upper, along="y", rise=1.3, ov=1, ridge=TERRACOTTA_DARK, seed=seed)
        f = P.Face(v, "y+", 16)
        P.door(f, 7, 1, 3, 5, leaf=TIMBER)
        P.window(f, 12, 3, 3, 3, frame=STONE_DARK, cross=True)
        F = P.Face(v, "y+", Y1 - 1)
        P.window(F, 8, 10, 2, 3, shutters=DYE_BLUE)
        P.window(F, 14, 10, 2, 3, shutters=DYE_BLUE)
        P.window(F, 11, 16, 2, 2)
        # Balcony over the door.
        for x in range(6, 18):
            v.set(x, Y1, 8, TIMBER)
            if x % 2 == 0:
                v.set(x, Y1 + 1, 9, TIMBER_LIGHT)
            v.set(x, Y1 + 1, 8, TIMBER)
            v.set(x, Y1 + 1, 10, TIMBER_LIGHT)
        for side, plane in (("x+", X1 - 1), ("x-", X0)):
            for a in (6, 12):
                P.window(P.Face(v, side, plane), a, 10, 2, 3)
        P.chimney(v, 7, 6, 8, top - 3)
        P.crate(v, 2, 19, 1)
        P.bush(v, 21, 6, 1, 2, seed=seed)
    else:
        X0, Y0, X1, Y1 = storeys(v, 4, 5, 20, 17, upper, seed)
        top = v.hip(X0, X1, Y0, Y1, 15, TERRACOTTA, ov=1, rise=1, ridge=TERRACOTTA_DARK)
        f = P.Face(v, "y+", 16)
        # A shop front: wide window, awning, crates of goods.
        P.window(f, 6, 2, 5, 4, frame=TIMBER_DARK, cross=True, sill=False)
        P.door(f, 14, 1, 3, 5, leaf=TIMBER_LIGHT)
        P.awning(v, 5, 13, 16, 7, depth=3)
        F = P.Face(v, "y+", Y1 - 1)
        for a in (5, 10, 15):
            P.window(F, a, 10, 2, 3, shutters=TIMBER)
        flowerbox(F, 9, 8)
        for side, plane in (("x+", X1 - 1), ("x-", X0)):
            P.window(P.Face(v, side, plane), 10, 10, 2, 3)
        P.chimney(v, 6, 8, 8, top)
        P.crate(v, 6, 19, 1)
        P.crate(v, 8, 20, 1, m=P.mat("ochre"))
        P.sack(v, 11, 20, 1)
    return v.jitter(0.035, roles={"plaster", "ochre"}, cell=2, seed=seed)
