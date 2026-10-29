"""
University (12 × 12; D-057 §3, V5): a quadrangle round a cloister. The
great hall across the back — three storeys of ashlar and warm plaster,
pedimented windows, a hipped tile roof with dormers and chimneys — the
library wing down the west side with two storeys of tall windows between
pilasters, a lower east range, and the front range opening to the
forecourt as an arcade either side of the gatehouse, whose tower carries
the open bell turret (a brass bell under a pyramid roof and finial). The
cloister walks run round the inner court under lean-to roofs on
colonnades; the lawn is quartered by paths round a fountain, with
trees. A paved forecourt with steps, lamps, benches and flower beds.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, DYE_BLUE, IRON, TIMBER_DARK

WALL = mat("ochre", 1.16)
ROOF = mat("terracotta", 0.86)
WATER = mat("shallows")


def build(ctx):
    v = ctx.vox()  # 96 × 96
    seed = 131
    P.yard(v, 0, 0, 96, 96, "grass", seed=seed)
    P.yard(v, 2, 82, 94, 96, "paved", seed=seed)
    # The great hall across the back.
    hall = Q.palazzo(v, 6, 4, 90, 26, (10, 8, 7), upper=WALL, roof=ROOF, along="x", hip=True, seed=seed)
    f = hall.face("y+")
    for a in range(10, 86, 7):
        Q.window(f, a, 13, 2, 5, hood="pediment")
        Q.window(f, a, 21, 2, 4, hood="key")
    for a in (8, 20, 74, 86):
        Q.window(f, a, 3, 2, 5, hood="key", surround=True)
    Q.pilasters(f, range(9, 88, 7), 12, 26)
    fx = hall.face("x-")
    for a in (9, 15, 21):
        Q.window(fx, a, 3, 2, 5, hood="key", surround=True)
        Q.window(fx, a, 13, 2, 5, hood="pediment")
        Q.window(fx, a, 21, 2, 4, hood="key")
    for x0 in (22, 40, 58, 72):
        P.dormer_on(v, hall.roof, x0, x0 + 4, "y+", wall=WALL)
    for x in (14, 82):
        P.roof_chimney(v, hall.roof, x, 12, above=3, brick=True, pots=2)
    # The library wing down the west side.
    lib = Q.palazzo(v, 6, 26, 26, 76, (12, 11), upper=mat("ochre", 1.06), roof=ROOF, along="y", seed=seed + 1)
    fl = lib.face("x-")
    for a in range(29, 74, 6):
        Q.window(fl, a, 3, 2, 8, hood="key", surround=True)
        Q.window(fl, a, 16, 2, 7, hood="cornice")
    Q.pilasters(fl, range(32, 74, 6), 14, 25)
    for a in (11, 19):
        Q.window(lib.face("y+"), a, 16, 2, 7, hood="pediment")
    # The lower east range.
    east = Q.palazzo(v, 70, 26, 90, 76, (9, 7), upper=WALL, roof=ROOF, along="y", seed=seed + 2)
    for a in range(30, 74, 6):
        Q.window(east.face("x-"), a, 3, 2, 5, hood="key", surround=True)
        Q.window(east.face("x-"), a, 12, 2, 4, hood="cornice")
    # Front range: an open arcade to the forecourt either side of the gate.
    front = Q.palazzo(v, 6, 76, 90, 84, (10,), upper=WALL, roof=ROOF, along="x", seed=seed + 3)
    ff = front.face("y+")
    Q.arcade(ff, 6, 42, 2, 7, bay=4, pier=2, depth=7)
    Q.arcade(ff, 54, 90, 2, 7, bay=4, pier=2, depth=7)
    Q.window(front.face("x-"), 79, 3, 2, 5, hood="key", surround=True)
    # The gatehouse tower with the bell turret.
    gx0, gx1, gy0, gy1 = 42, 54, 74, 86
    Q.ashlar(v, gx0, gy0, gx1, gy1, 1, 38)
    Q.string_course(v, gx0, gy0, gx1, gy1, 12)
    Q.string_course(v, gx0, gy0, gx1, gy1, 22)
    Q.string_course(v, gx0, gy0, gx1, gy1, 30)
    Q.cornice(v, gx0, gy0, gx1, gy1, 37)
    gf = P.Face(v, "y+", gy1 - 1)
    P.entrance(gf, 46, 2, 4, 9, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED, steps=2)
    Q.rose_window(gf, 48, 17, r=3)
    for a in (44, 51):
        Q.window(gf, a, 24, 1, 4, hood=None, surround=True)
        Q.window(gf, a, 32, 1, 3, hood=None, surround=True)
    # Clock face over the gate.
    for i in range(-2, 3):
        for j in range(-2, 3):
            if i * i + j * j <= 5:
                gf.put(48 + i, 26 + j, mat("canvas", 1.1), out=1)
    gf.put(48, 26, IRON, out=2)
    gf.put(48, 27, IRON, out=2)
    # Bell turret: four corner posts, the bell, a pyramid roof and finial.
    bx0, by0, bx1, by1, bz = 44, 76, 52, 84, 39
    v.box(bx0, by0, bz - 1, bx1, by1, bz, Q.DRESSED)
    for x, y in ((bx0, by0), (bx1 - 2, by0), (bx0, by1 - 2), (bx1 - 2, by1 - 2)):
        v.box(x, y, bz, x + 2, y + 2, bz + 7, Q.ASHLAR)
    v.box(bx0, by0, bz + 7, bx1, by1, bz + 8, Q.DRESSED)
    v.box(47, 79, bz + 3, 49, 81, bz + 6, BRASS)
    v.box(46, 78, bz + 2, 50, 82, bz + 4, BRASS)
    v.box(47, 79, bz + 6, 49, 81, bz + 7, TIMBER_DARK)
    r = P.roof(v, bx0, bx1, by0, by1, bz + 8, "tiles", hip=True, rise=2.0, m=ROOF, seed=seed, eaves=False)
    Q.finial(v, 48, 80, r.top, BRASS, h=3)
    # The cloister walks round the court.
    cx0, cy0, cx1, cy1 = 26, 26, 70, 76
    Q.colonnade(v, cx0 + 6, cx1 - 6, cy0 + 5, 1, 6, every=6)
    Q.colonnade(v, cx0 + 6, cx1 - 6, cy1 - 7, 1, 6, every=6)
    for x in (cx0 + 5, cx1 - 7):
        for y in range(cy0 + 5, cy1 - 6, 6):
            v.box(x, y, 1, x + 2, y + 2, 7, Q.DRESSED)
        v.box(x, cy0 + 5, 7, x + 2, cy1 - 5, 8, Q.DRESSED)
    P.lean_to(v, cx0, cx1, cy0, cy0 + 7, 8, "tiles", down="y+", m=ROOF, posts=False, seed=seed)
    P.lean_to(v, cx0, cx1, cy1 - 7, cy1, 8, "tiles", down="y-", m=ROOF, posts=False, seed=seed)
    P.lean_to(v, cx0, cx0 + 7, cy0 + 7, cy1 - 7, 8, "tiles", down="x+", m=ROOF, posts=False, seed=seed)
    P.lean_to(v, cx1 - 7, cx1, cy0 + 7, cy1 - 7, 8, "tiles", down="x-", m=ROOF, posts=False, seed=seed)
    # The lawn: paths quartering it, a fountain, four trees.
    lx0, ly0, lx1, ly1 = cx0 + 7, cy0 + 7, cx1 - 7, cy1 - 7
    mx, my = (lx0 + lx1) // 2, (ly0 + ly1) // 2
    P.path(v, [(x, y) for x in range(lx0, lx1) for y in range(my - 1, my + 2)], kind="paved")
    P.path(v, [(x, y) for x in range(mx - 1, mx + 2) for y in range(ly0, ly1)], kind="paved")
    v.cyl(mx, my, 1, 3, 4.5, Q.DRESSED)
    v.cyl(mx, my, 2, 3, 3.5, WATER)
    v.box(mx - 1, my - 1, 1, mx + 1, my + 1, 6, Q.DRESSED)
    v.box(mx - 1, my - 1, 6, mx + 1, my + 1, 7, WATER)
    for tx, ty in ((lx0 + 6, ly0 + 7), (lx1 - 7, ly0 + 7), (lx0 + 6, ly1 - 8), (lx1 - 7, ly1 - 8)):
        P.tree(v, tx, ty, 1, kind="broad", seed=seed + tx)
    # Forecourt: steps, lamps, benches, flower beds, a banner at the gate.
    for x in (38, 57):
        P.lamp_post(v, x, 88, h=8)
    for x in (12, 26, 62, 76):
        P.bench(v, x, 90, 1, 6)
    P.flower_bed(v, 10, 86, 34, 88, seed=seed)
    P.flower_bed(v, 62, 86, 86, 88, seed=seed + 1)
    for z in range(13, 21):
        v.set(43, 86, z, P.cloth(DYE_BLUE))
        v.set(52, 86, z, P.cloth(DYE_BLUE))
    v.set(43, 86, 21, BRASS)
    v.set(52, 86, 21, BRASS)
    return P.colour_jitter(v, seed=seed)
