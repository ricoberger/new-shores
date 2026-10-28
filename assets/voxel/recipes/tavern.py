"""Tavern (4 × 6): two-storey timber-framed inn with a hanging sign, a beer garden with tables and barrels, an ochre wing."""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, DYE_BLUE, IRON, OCHRE, PLASTER, STONE, TERRACOTTA, TERRACOTTA_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, FLOWER


def build(ctx):
    v = ctx.vox()  # 32 × 48
    P.yard(v, 0, 0, 32, 48, "grass", seed=33)
    P.yard(v, 2, 30, 30, 46, "paved", seed=33)
    # Main house: stone ground floor, jettied plaster upper floor.
    x0, y0, x1, y1 = 3, 6, 23, 22
    P.stone_wall(v, x0, y0, x1, y1, 1, 8, STONE, 33)
    P.quoins(v, x0, y0, x1, y1, 1, 8)
    P.jetty(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 7)
    P.timber_frame(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 8, 16, PLASTER, TIMBER, spacing=4, braces=True)
    top = v.gable(x0 - 1, x1 + 1, y0 - 1, y1 + 1, 16, TERRACOTTA, PLASTER, along="x", rise=1, ov=1, ridge=TERRACOTTA_DARK, seed=33)
    f = P.Face(v, "y+", y1 - 1)
    P.door(f, 11, 1, 4, 5, leaf=TIMBER_DARK)
    P.window(f, 5, 2, 4, 3, frame=TIMBER_DARK, cross=True)
    P.window(f, 17, 2, 4, 3, frame=TIMBER_DARK, cross=True)
    P.windows(v, "y+", y1, x0 + 1, x1, 11, every=5, w=2, h=3, shutters=DYE_BLUE)
    # Hanging sign on an iron bracket.
    for k in range(4):
        v.set(9 - k, y1, 8, IRON)
    v.box(6, y1, 5, 9, y1 + 1, 7, BRASS)
    P.chimney(v, 5, 12, 8, top + 1)
    P.chimney(v, 19, 12, 8, top + 1)
    # Ochre wing (kitchen) to the east.
    P.house(v, 24, 8, 31, 20, "citizen", along="y", wall=OCHRE, seed=34)
    P.door(P.Face(v, "y+", 19), 26, 2, 3, 5)
    # Beer garden: tables with benches, barrels, flower tubs.
    for x, y in ((5, 33), (14, 33), (5, 40), (14, 40)):
        v.box(x, y, 1, x + 6, y + 3, 2, TIMBER)
        v.box(x, y, 2, x + 6, y + 3, 3, TIMBER_LIGHT)
        v.box(x, y - 1, 1, x + 6, y, 2, TIMBER_LIGHT)
        v.box(x, y + 3, 1, x + 6, y + 4, 2, TIMBER_LIGHT)
    for x, y in ((24, 32), (26, 32), (24, 35)):
        P.barrel(v, x, y, 1)
    for x in (2, 28):
        v.box(x, 44, 1, x + 2, 46, 2, TIMBER)
        v.box(x, 44, 2, x + 2, 46, 3, FLOWER)
    P.tree(v, 26, 41, 1, "broad", 33)
    return v.jitter(0.035, roles={"plaster", "ochre", "stone"}, cell=2, seed=33)
