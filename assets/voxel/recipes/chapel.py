"""
Chapel (3 × 3; D-057 §3): a nave of coursed pale stone on a proud plinth
with dressed quoins and buttresses, a pointed door with a stone step,
lancet windows with dressed surrounds, a round window in the gable, tiles
with ridge tiles; a bell gable with a brass bell and a cross; a low
churchyard wall with a lych gap, gravestones, a conifer and flowers.
"""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, STONE, STONE_DARK, STONE_LIGHT, TIMBER, WINDOW


def build(ctx):
    v = ctx.vox()
    seed = 21
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    P.path(v, [(x, y) for x in range(10, 14) for y in range(18, 24)], kind="paved")
    x0, y0, x1, y1 = 6, 3, 18, 19
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.coursed_stone(v, x0, y0, x1, y1, 1, 12, STONE_LIGHT, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, 12, m=P.mat("stone", 1.22))
    # Buttresses on the long sides.
    for y in (7, 11, 15):
        for x, d in ((x0 - 1, -1), (x1, 1)):
            v.box(x, y, 1, x + 1, y + 1, 8, STONE)
            v.set(x + d, y, 1, STONE)
            v.set(x + d, y, 2, STONE)
            v.set(x + d, y, 3, STONE_DARK)
    r = P.roof(v, x0, x1, y0, y1, 12, "tiles", along="y", rise=1.5, gable=STONE_LIGHT, seed=seed)
    top = r.ridge_z + 1
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 10, 2, 4, 7, leaf=TIMBER, frame=P.DRESSED, arch=True, steps=2)
    # Round window in the gable.
    for a, z in ((11, 14), (12, 14), (11, 15), (12, 15), (10, 15), (13, 15), (11, 16), (12, 16)):
        f.put(a, z, None)
        f.put(a, z, WINDOW, out=-1)
    for a, z in ((10, 14), (13, 14), (10, 16), (13, 16), (11, 13), (12, 13), (11, 17), (12, 17), (9, 15), (14, 15)):
        f.put(a, z, P.DRESSED)
    for side, plane in (("x+", x1 - 1), ("x-", x0)):
        for a in (5, 9, 13, 17):
            P.casement(P.Face(v, side, plane), a, 5, 1, 4, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    # Bell gable on the front ridge.
    v.box(10, y1 - 2, top - 1, 14, y1, top + 6, STONE_LIGHT)
    v.box(11, y1 - 2, top + 1, 13, y1, top + 4, None)
    v.box(11, y1 - 2, top + 2, 13, y1 - 1, top + 4, BRASS)
    v.box(10, y1 - 2, top + 6, 14, y1, top + 7, STONE)
    v.set(12, y1 - 1, top + 7, STONE_DARK)
    v.set(12, y1 - 1, top + 8, STONE_DARK)
    v.set(12, y1 - 1, top + 9, STONE_DARK)
    v.set(11, y1 - 1, top + 8, STONE_DARK)
    v.set(13, y1 - 1, top + 8, STONE_DARK)
    # Low churchyard wall (two courses with a coping) and gravestones.
    for x in range(1, 23):
        if x not in (10, 11, 12, 13):
            v.set(x, 22, 1, STONE)
            v.set(x, 22, 2, STONE_LIGHT if x % 3 else STONE)
    for y in range(2, 23):
        for x in (1, 22):
            v.set(x, y, 1, STONE)
            v.set(x, y, 2, STONE_LIGHT if y % 3 else STONE)
    for x, y in ((3, 6), (3, 11), (20, 8), (20, 4), (3, 15)):
        v.box(x, y, 1, x + 1, y + 2, 3, STONE_DARK)
        v.set(x, y, 3, STONE)
    P.tree(v, 20, 15, 1, "conifer")
    P.flower_bed(v, 14, 20, 17, 22, seed=seed)
    P.flower_bed(v, 7, 20, 10, 22, seed=seed + 1)
    P.scatter(v, 2, 2, 22, 22, 0.03, seed=seed, kinds=("tuft", "flower"))
    return P.colour_jitter(v, seed=seed)
