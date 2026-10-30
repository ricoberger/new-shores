"""
Chapel (3 × 5, D-062; D-057 §3): a long nave of coursed pale stone on a
proud plinth with dressed quoins and buttresses, a gabled porch with a
pointed door and a stone step, lancet windows with dressed surrounds, a
round window in the nave's gable over the porch roof, tiles with ridge
tiles; a small bell gable with a brass bell and a cross on the nave's
front ridge; a low churchyard wall with a lych gap, gravestones, a conifer
and flowers.
"""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, STONE, STONE_DARK, STONE_LIGHT, TIMBER, WINDOW


def build(ctx):
    v = ctx.vox()  # 24 × 40
    seed = 21
    P.yard(v, 0, 0, 24, 40, "grass", seed=seed)
    P.path(v, [(x, y) for x in range(10, 14) for y in range(34, 40)], kind="paved")
    x0, y0, x1, y1 = 5, 3, 19, 29
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.coursed_stone(v, x0, y0, x1, y1, 1, 12, STONE_LIGHT, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, 12, m=P.mat("stone", 1.22))
    # Buttresses on the long sides.
    for y in (8, 13, 18, 23):
        for x, d in ((x0 - 1, -1), (x1, 1)):
            v.box(x, y, 1, x + 1, y + 1, 8, STONE)
            v.set(x + d, y, 1, STONE)
            v.set(x + d, y, 2, STONE)
            v.set(x + d, y, 3, STONE_DARK)
    r = P.roof(v, x0, x1, y0, y1, 12, "tiles", along="y", rise=1.5, gable=STONE_LIGHT, seed=seed)
    top = r.ridge_z + 1
    # The porch: a low gabled box on the front, the pointed door in its gable end.
    px0, px1, py0, py1 = 8, 16, 29, 35
    P.plinth(v, px0, py0, px1, py1, 1, STONE_DARK, out=1)
    P.coursed_stone(v, px0, py0, px1, py1, 1, 9, STONE_LIGHT, seed + 3)
    P.dressed_quoins(v, px0, py0, px1, py1, 2, 9, m=P.mat("stone", 1.22))
    P.roof(v, px0, px1, py0, py1, 9, "tiles", along="y", rise=1.2, gable=STONE_LIGHT, seed=seed)
    P.entrance(P.Face(v, "y+", py1 - 1), 10, 2, 4, 6, leaf=TIMBER, frame=P.DRESSED, arch=True, steps=2)
    for side, plane in (("x+", px1 - 1), ("x-", px0)):
        P.casement(P.Face(v, side, plane), 31, 3, 1, 3, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    # Round window in the nave's gable above the porch roof.
    f = P.Face(v, "y+", y1 - 1)
    for a, z in ((11, 15), (12, 15), (11, 16), (12, 16), (10, 16), (13, 16), (11, 17), (12, 17)):
        f.put(a, z, None)
        f.put(a, z, WINDOW, out=-1)
    for a, z in ((10, 15), (13, 15), (10, 17), (13, 17), (11, 14), (12, 14), (11, 18), (12, 18), (9, 16), (14, 16)):
        f.put(a, z, P.DRESSED)
    for side, plane in (("x+", x1 - 1), ("x-", x0)):
        for a in (5, 10, 15, 20, 25):
            P.casement(P.Face(v, side, plane), a, 5, 1, 4, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    # Bell gable on the nave's front ridge.
    v.box(10, y1 - 2, top - 1, 14, y1, top + 6, STONE_LIGHT)
    v.box(11, y1 - 2, top + 1, 13, y1, top + 4, None)
    v.box(11, y1 - 2, top + 2, 13, y1 - 1, top + 4, BRASS)
    v.box(10, y1 - 2, top + 6, 14, y1, top + 7, STONE)
    for z in (7, 8, 9):
        v.set(12, y1 - 1, top + z, STONE_DARK)
    v.set(11, y1 - 1, top + 8, STONE_DARK)
    v.set(13, y1 - 1, top + 8, STONE_DARK)
    # Low churchyard wall (two courses with a coping) with a lych gap, and gravestones.
    for x in range(1, 23):
        if x not in (10, 11, 12, 13):
            v.set(x, 38, 1, STONE)
            v.set(x, 38, 2, STONE_LIGHT if x % 3 else STONE)
    for y in range(2, 39):
        for x in (1, 22):
            v.set(x, y, 1, STONE)
            v.set(x, y, 2, STONE_LIGHT if y % 3 else STONE)
    for x, y in ((3, 7), (3, 12), (3, 17), (20, 9), (20, 5), (3, 22), (20, 15), (20, 21)):
        v.box(x, y, 1, x + 1, y + 2, 3, STONE_DARK)
        v.set(x, y, 3, STONE)
    P.tree(v, 20, 31, 1, "conifer")
    P.flower_bed(v, 15, 36, 18, 38, seed=seed)
    P.flower_bed(v, 6, 36, 9, 38, seed=seed + 1)
    P.scatter(v, 2, 2, 22, 38, 0.03, seed=seed, kinds=("tuft", "flower"))
    return P.colour_jitter(v, seed=seed)
