"""
Church (6 × 10; D-057 §3): a nave of warm coursed sandstone on a proud
plinth with buttresses and tall lancet windows under a steep red tile
roof, a lower apse with a half-cone roof at the east end of the axis (the
back), a square west tower at the front — three stages with string
courses, an arched portal with steps, a clock, paired belfry openings
with a bell, a tiled spire with a cross — and a side porch on the
west; a churchyard with a low coped wall and lych gate, gravestones,
yews, a path and flowers.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, STONE_DARK, TIMBER, TIMBER_DARK, WINDOW

WARM = mat("cliff-upper", 1.12)
WARM_DARK = mat("cliff-upper", 0.95)
DRESSED = mat("cliff-upper", 1.28)
ROOF = mat("terracotta")
SPIRE = mat("terracotta", 0.85)


def lancet(f, a, z, h=7, w=2):
    """A tall lancet window: glazing with a pointed head and a dressed surround."""
    for i in range(w):
        for j in range(h):
            f.put(a + i, z + j, WINDOW)
    for j in range(-1, h + 1):
        f.put(a - 1, z + j, DRESSED)
        f.put(a + w, z + j, DRESSED)
    for i in range(-1, w + 1):
        f.put(a + i, z - 1, DRESSED, out=1 if i in (0, w - 1) else 0)
        f.put(a + i, z + h, DRESSED)
    f.put(a + w // 2 - (1 if w > 1 else 0), z + h + 1, DRESSED)
    if w > 1:
        f.put(a + w // 2, z + h + 1, DRESSED)


def build(ctx):
    v = ctx.vox()  # 48 × 80
    seed = 179
    P.yard(v, 0, 0, 48, 80, "grass", seed=seed)
    P.path(v, [(x, y) for x in range(21, 27) for y in range(66, 80)], kind="paved")
    P.path(v, [(x, y) for x in range(4, 12) for y in range(38, 42)], kind="paved")
    # Nave along y.
    x0, x1, y0, y1 = 13, 35, 16, 58
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.coursed_stone(v, x0, y0, x1, y1, 1, 19, WARM, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, 19, m=DRESSED)
    for y in range(y0 + 3, y1 - 1, 7):
        for x, d in ((x0 - 1, -1), (x1, 1)):
            v.box(x, y, 1, x + 1, y + 2, 13, WARM_DARK)
            v.box(x + d, y, 1, x + d + 1, y + 2, 6, WARM_DARK)
            v.box(x + d, y, 6, x + d + 1, y + 2, 7, DRESSED)
            v.set(x, y, 13, DRESSED)
            v.set(x, y + 1, 13, DRESSED)
    for side, plane in (("x-", x0), ("x+", x1 - 1)):
        f = P.Face(v, side, plane)
        for a in range(y0 + 6, y1 - 3, 7):
            lancet(f, a - 1, 6, h=8)
    r = P.roof(v, x0, x1, y0, y1, 19, "tiles", along="y", rise=1.4, gable=WARM, seed=seed, m=ROOF)
    # Apse at the back: a half-disc with a half-cone roof.
    cx, cy = 24, y0
    for x, y, d in V._disc(cx, cy, 9):
        if y < cy:
            for z in range(1, 15):
                v.set(x, y, z, WARM if z % 3 else WARM_DARK)
    for k in range(10):
        rr = 10 - k
        for x, y, d in V._disc(cx, cy, rr):
            if y < cy:
                v.set(x, y, 15 + k, ROOF if k % 2 else mat("terracotta", 0.92))
    for a in (19, 24, 29):
        for z in range(5, 11):
            yy = min(y for (x, y, d) in V._disc(cx, cy, 9) if x == a)
            v.set(a, yy, z, WINDOW)
    # West tower at the front: three stages, portal, clock, belfry, spire.
    tx0, tx1, ty0, ty1 = 17, 31, 56, 70
    P.plinth(v, tx0, ty0, tx1, ty1, 1, STONE_DARK, out=1)
    P.coursed_stone(v, tx0, ty0, tx1, ty1, 1, 44, WARM, seed + 1)
    P.dressed_quoins(v, tx0, ty0, tx1, ty1, 2, 44, m=DRESSED)
    for z in (17, 31):
        v.walls(tx0 - 1, ty0 - 1, tx1 + 1, ty1 + 1, z, z + 1, DRESSED)
    v.walls(tx0 - 1, ty0 - 1, tx1 + 1, ty1 + 1, 44, 45, DRESSED)
    F = P.Face(v, "y+", ty1 - 1)
    P.entrance(F, 22, 2, 4, 9, leaf=TIMBER_DARK, frame=DRESSED, arch=True, steps=2)
    for a in range(20, 29):
        F.put(a, 12, DRESSED, out=1)
    lancet(F, 23, 20, h=7)
    # Clock face.
    for a in range(21, 28):
        for z in range(33, 40):
            if (a - 24) ** 2 + (z - 36) ** 2 <= 10:
                F.put(a, z, mat("plaster", 1.1) if (a - 24) ** 2 + (z - 36) ** 2 <= 5 else DRESSED, out=1)
    F.put(24, 36, TIMBER_DARK, out=2)
    F.put(24, 37, TIMBER_DARK, out=2)
    F.put(25, 36, TIMBER_DARK, out=2)
    # Paired belfry openings on every side with a bell, louvres in the back pair.
    for side, plane, a0 in (("y+", ty1 - 1, tx0), ("x-", tx0, ty0), ("x+", tx1 - 1, ty0), ("y-", ty0, tx0)):
        f = P.Face(v, side, plane)
        for a in (a0 + 4, a0 + 8):
            for i in range(2):
                for z in range(34 if side != "y+" else 41, 43):
                    f.put(a + i, z, None)
                    f.put(a + i, z, TIMBER_DARK, out=-1)
    v.box(23, 62, 38, 25, 64, 41, BRASS)
    # Spire: a steep tiled pyramid with a cross.
    k = 0
    while True:
        lo, hi = tx0 - 1 + k // 2, tx1 + 1 - k // 2
        if hi - lo < 1:
            break
        for x in range(lo, hi):
            for y in range(ty0 - 1 + k // 2, ty1 + 1 - k // 2):
                v.set(x, y, 45 + k, SPIRE if k % 4 == 3 else ROOF)
        k += 1
    top = 45 + k
    cxx, cyy = (tx0 + tx1) // 2, (ty0 + ty1) // 2
    v.box(cxx, cyy, top, cxx + 1, cyy + 1, top + 5, BRASS)
    v.box(cxx - 1, cyy, top + 3, cxx + 2, cyy + 1, top + 4, BRASS)
    # Side porch on the west: a small gabled stone porch with a door.
    P.coursed_stone(v, 6, 36, 13, 44, 1, 9, WARM, seed + 2)
    P.roof(v, 6, 13, 36, 44, 9, "tiles", along="x", rise=1.2, gable=WARM, seed=seed, m=ROOF)
    P.entrance(P.Face(v, "x-", 6), 39, 1, 3, 6, leaf=TIMBER, frame=DRESSED, arch=True)
    # Churchyard wall with a lych gate.
    for x in range(1, 47):
        for y in (1, 78):
            if y == 78 and 20 <= x <= 27:
                continue
            v.box(x, y, 1, x + 1, y + 1, 3, WARM_DARK)
            v.set(x, y, 3, DRESSED)
    for y in range(1, 79):
        for x in (1, 46):
            v.box(x, y, 1, x + 1, y + 1, 3, WARM_DARK)
            v.set(x, y, 3, DRESSED)
    for x in (19, 28):
        v.box(x, 77, 1, x + 1, 79, 7, TIMBER)
    P.roof(v, 18, 30, 76, 80, 7, "tiles", along="x", rise=1.0, ov=0, seed=seed, m=ROOF)
    # Gravestones, yews, flowers.
    for k, (x, y) in enumerate(((5, 10), (9, 12), (5, 18), (9, 22), (40, 12), (42, 20), (39, 28), (42, 36), (5, 50), (9, 54), (40, 48), (42, 56), (6, 62), (40, 64))):
        v.box(x, y, 1, x + 2, y + 1, 3 + k % 2, STONE_DARK)
        v.set(x, y, 3 + k % 2, mat("stone"))
    for x, y in ((6, 28), (41, 42), (8, 70), (40, 72)):
        P.tree(v, x, y, 1, "conifer", seed=seed + x)
    P.flower_bed(v, 14, 72, 19, 75, seed=seed)
    P.flower_bed(v, 29, 72, 34, 75, seed=seed + 1)
    P.scatter(v, 2, 2, 46, 78, 0.02, seed=seed, kinds=("tuft", "flower"))
    return P.colour_jitter(v, seed=seed)
