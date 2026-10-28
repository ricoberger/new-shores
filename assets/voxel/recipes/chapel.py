"""Chapel (3 × 3): stone nave with a pointed door, lancet windows, a bell gable with a brass bell, small graveyard wall."""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, STONE, STONE_DARK, STONE_LIGHT, TERRACOTTA, TERRACOTTA_DARK, TIMBER, WINDOW


def build(ctx):
    v = ctx.vox()
    P.yard(v, 0, 0, 24, 24, "grass", seed=21)
    P.path(v, [(x, y) for x in range(10, 14) for y in range(18, 24)], kind="paved")
    x0, y0, x1, y1 = 6, 3, 18, 19
    P.stone_wall(v, x0, y0, x1, y1, 1, 11, STONE_LIGHT, 21)
    P.quoins(v, x0, y0, x1, y1, 1, 11, STONE)
    top = v.gable(x0, x1, y0, y1, 11, TERRACOTTA, STONE_LIGHT, along="y", rise=1.5, ov=1, ridge=TERRACOTTA_DARK, seed=21)
    f = P.Face(v, "y+", y1 - 1)
    P.door(f, 10, 1, 4, 7, leaf=TIMBER, frame=STONE_DARK, arch=True)
    # Rose window in the gable.
    for a, z in ((11, 13), (12, 13), (11, 14), (12, 14), (10, 13), (13, 13)):
        f.put(a, z, None)
        f.put(a, z, WINDOW, out=-1)
    for side, plane in (("x+", x1 - 1), ("x-", x0)):
        for a in (6, 10, 14):
            P.window(P.Face(v, side, plane), a, 4, 1, 4, frame=STONE_DARK, sill=False)
    # Bell gable on the front ridge.
    v.box(10, y1 - 2, top - 1, 14, y1, top + 6, STONE_LIGHT)
    v.box(11, y1 - 2, top + 1, 13, y1, top + 4, None)
    v.box(11, y1 - 2, top + 2, 13, y1 - 1, top + 4, BRASS)
    v.box(11, y1 - 2, top + 6, 13, y1, top + 7, STONE)
    v.set(12, y1 - 1, top + 8, STONE_DARK)
    v.set(12, y1 - 1, top + 9, STONE_DARK)
    v.set(11, y1 - 1, top + 9, STONE_DARK)
    v.set(13, y1 - 1, top + 9, STONE_DARK)
    # Low churchyard wall and two gravestones.
    for x in range(1, 23):
        if x not in (10, 11, 12, 13):
            v.set(x, 22, 1, STONE)
    for y in range(2, 23):
        v.set(1, y, 1, STONE)
        v.set(22, y, 1, STONE)
    for x, y in ((3, 6), (3, 11), (20, 8)):
        v.box(x, y, 1, x + 1, y + 2, 3, STONE_DARK)
    P.tree(v, 20, 15, 1, "conifer")
    return v.jitter(0.03, roles={"stone"}, cell=2, seed=21)
