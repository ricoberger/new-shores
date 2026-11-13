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
12 voxels per tile (D-078 step 6): brick courses, more and slimmer
windows, dormers on the V7 parts; the bell turret's finial stays at 7.5
tiles (the castle keep is measured against it, tests/test_d077.py).
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, CROWN, DYE_BLUE, IRON, TIMBER_DARK

VOXELS_PER_TILE = 12

#: Brick walls and dark brown tile (Hanse, D-063): ochre plaster under a terracotta roof read Italian.
WALL = mat("terracotta", 0.88)
ROOF = mat("timber", 0.7)
WATER = mat("shallows")
SHADES = (1.06, 0.92)

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)


def brick(v, b, wall):
    """Brick courses on the plastered (brick) storeys of a Palazzo: a darker bed joint every third layer, the floor lines and cornice left alone."""
    x0, y0, x1, y1 = b.rect
    skip = set(b.floors) | {b.top - 1, b.top - 2}
    dark = shade_of(wall, 0.9)
    for z in range(b.floors[1], b.top):
        if z not in skip and (z - b.floors[1]) % 3 == 2:
            v.walls(x0, y0, x1, y1, z, z + 1, dark)


def build(ctx):
    v = ctx.vox()  # 144 × 144
    seed = 131
    P.yard(v, 0, 0, 144, 144, "grass", seed=seed)
    P.yard(v, 3, 123, 141, 144, "paved", seed=seed)
    # The great hall across the back.
    hall = Q.palazzo(v, 9, 6, 135, 39, (15, 12, 11), upper=WALL, roof=ROOF, along="x", hip=True, seed=seed, shades=SHADES)
    brick(v, hall, WALL)
    f = hall.face("y+")
    for a in range(14, 128, 8):
        Q.window(f, a, 19, 3, 7, hood="pediment")
        Q.window(f, a, 31, 3, 6, hood="key")
    for a in (12, 30, 111, 129):
        Q.window(f, a, 4, 3, 8, hood="key", surround=True)
    Q.pilasters(f, range(18, 126, 8), 17, 39)
    fx = hall.face("x-")
    for a in (12, 21, 30):
        Q.window(fx, a, 4, 3, 8, hood="key", surround=True)
        Q.window(fx, a, 19, 3, 7, hood="pediment")
        Q.window(fx, a, 31, 3, 6, hood="key")
    for x0 in (33, 60, 81, 105):
        W.dormer(v, hall.roof, x0, x0 + 7, "y+", wall=WALL, m=ROOF, h=7)
    for x in (21, 123):
        P.roof_chimney(v, hall.roof, x, 18, above=5, brick=True, pots=2)
    # The library wing down the west side.
    lib = Q.palazzo(v, 9, 39, 39, 114, (18, 17), upper=mat("terracotta", 0.82), roof=ROOF, along="y", seed=seed + 1, shades=SHADES)
    brick(v, lib, mat("terracotta", 0.82))
    fl = lib.face("x-")
    for a in range(43, 110, 7):
        Q.window(fl, a, 4, 3, 12, hood="key", surround=True)
        Q.window(fl, a, 23, 3, 10, hood="cornice")
    Q.pilasters(fl, range(47, 109, 7), 21, 36)
    for a in (16, 29):
        Q.window(lib.face("y+"), a, 23, 3, 10, hood="pediment")
    # The lower east range.
    east = Q.palazzo(v, 105, 39, 135, 114, (13, 11), upper=WALL, roof=ROOF, along="y", seed=seed + 2, shades=SHADES)
    brick(v, east, WALL)
    for a in range(44, 110, 7):
        Q.window(east.face("x-"), a, 4, 3, 8, hood="key", surround=True)
        Q.window(east.face("x-"), a, 17, 3, 6, hood="cornice")
    # Front range: an open arcade to the forecourt either side of the gate.
    front = Q.palazzo(v, 9, 114, 135, 126, (15,), upper=WALL, roof=ROOF, along="x", seed=seed + 3, shades=SHADES)
    ff = front.face("y+")
    Q.arcade(ff, 9, 63, 2, 11, bay=5, pier=2, depth=10, pier_m=Q.DRESSED)
    Q.arcade(ff, 81, 135, 2, 11, bay=5, pier=2, depth=10, pier_m=Q.DRESSED)
    Q.window(front.face("x-"), 118, 4, 3, 8, hood="key", surround=True)
    # The gatehouse tower with the bell turret.
    gx0, gx1, gy0, gy1 = 63, 81, 111, 129
    Q.ashlar(v, gx0, gy0, gx1, gy1, 1, 57)
    for z in (18, 33, 45):
        Q.string_course(v, gx0, gy0, gx1, gy1, z)
    Q.cornice(v, gx0, gy0, gx1, gy1, 56)
    P.dressed_quoins(v, gx0, gy0, gx1, gy1, 2, 55)
    gf = P.Face(v, "y+", gy1 - 1)
    P.entrance(gf, 69, 2, 6, 13, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED, steps=3)
    Q.rose_window(gf, 72, 25, r=4)
    for a in (66, 76):
        Q.window(gf, a, 35, 2, 7, hood=None, surround=True)
        Q.window(gf, a, 47, 2, 5, hood=None, surround=True)
    # Clock face over the gate.
    for i in range(-3, 4):
        for j in range(-3, 4):
            if i * i + j * j <= 10:
                gf.put(72 + i, 39 + j, mat("canvas", 1.1), out=1)
    for i, j in ((0, 0), (0, 1), (0, 2), (1, 0), (2, 0)):
        gf.put(72 + i, 39 + j, IRON, out=2)
    # Bell turret: four corner posts, the bell, a pyramid roof and finial.
    bx0, by0, bx1, by1, bz = 66, 114, 78, 126, 58
    v.box(bx0, by0, bz - 1, bx1, by1, bz, Q.DRESSED)
    for x, y in ((bx0, by0), (bx1 - 3, by0), (bx0, by1 - 3), (bx1 - 3, by1 - 3)):
        v.box(x, y, bz, x + 3, y + 3, bz + 11, Q.ASHLAR)
        v.box(x, y, bz + 5, x + 3, y + 3, bz + 6, Q.DRESSED)  # an impost band
    v.box(bx0, by0, bz + 11, bx1, by1, bz + 12, Q.DRESSED)
    v.box(70, 118, bz + 4, 74, 122, bz + 9, BRASS)
    v.box(69, 117, bz + 3, 75, 123, bz + 5, BRASS)
    v.box(71, 119, bz + 9, 73, 121, bz + 11, TIMBER_DARK)
    v.set(71, 119, bz + 2, IRON)  # the clapper
    r = P.roof(v, bx0, bx1, by0, by1, bz + 12, "tiles", hip=True, rise=2.0, m=ROOF, seed=seed, eaves=False, shades=SHADES)
    Q.finial(v, 72, 120, r.top, BRASS, h=6)
    # The cloister walks round the court.
    cx0, cy0, cx1, cy1 = 39, 39, 105, 114
    Q.colonnade(v, 48, 96, 46, 1, 10, every=8)
    Q.colonnade(v, 48, 96, 103, 1, 10, every=8)
    for x in (46, 95):
        for y in range(46, 106, 8):
            v.box(x, y, 1, x + 2, y + 2, 11, Q.DRESSED)
            v.box(x, y, 10, x + 2, y + 2, 11, shade_of(Q.DRESSED, 0.9))
        v.box(x, 46, 11, x + 2, 107, 12, Q.DRESSED)
    P.lean_to(v, cx0, cx1, cy0, cy0 + 10, 12, "tiles", down="y+", m=ROOF, posts=False, seed=seed)
    P.lean_to(v, cx0, cx1, cy1 - 10, cy1, 12, "tiles", down="y-", m=ROOF, posts=False, seed=seed)
    P.lean_to(v, cx0, cx0 + 10, cy0 + 10, cy1 - 10, 12, "tiles", down="x+", m=ROOF, posts=False, seed=seed)
    P.lean_to(v, cx1 - 10, cx1, cy0 + 10, cy1 - 10, 12, "tiles", down="x-", m=ROOF, posts=False, seed=seed)
    # The lawn: paths quartering it, a fountain, four trees.
    lx0, ly0, lx1, ly1 = cx0 + 11, cy0 + 11, cx1 - 11, cy1 - 11
    mx, my = (lx0 + lx1) // 2, (ly0 + ly1) // 2
    P.path(v, [(x, y) for x in range(lx0, lx1) for y in range(my - 2, my + 3)], kind="paved")
    P.path(v, [(x, y) for x in range(mx - 2, mx + 3) for y in range(ly0, ly1)], kind="paved")
    v.cyl(mx, my, 1, 4, 6.5, Q.DRESSED)
    v.cyl(mx, my, 3, 4, 5.2, WATER)
    v.box(mx - 1, my - 1, 1, mx + 2, my + 2, 9, Q.DRESSED)
    v.box(mx - 2, my - 2, 6, mx + 3, my + 3, 7, Q.DRESSED)  # the upper basin's lip
    v.box(mx - 1, my - 1, 9, mx + 2, my + 2, 10, WATER)
    for tx, ty in ((lx0 + 9, ly0 + 10), (lx1 - 10, ly0 + 10), (lx0 + 9, ly1 - 12), (lx1 - 10, ly1 - 12)):
        P.fruit_tree(v, tx, ty, 1, seed=seed + tx, crown=CROWN, fruit=None, trunk=6, r=4)
    # Forecourt: steps, lamps, benches, flower beds, banners at the gate.
    for k in range(2):
        v.box(66 - k * 2, 129 + k * 2, 1, 78 + k * 2, 131 + k * 2, 2, Q.DRESSED)
    for x in (57, 86):
        P.lamp_post(v, x, 132, h=12)
    for x in (18, 39, 93, 114):
        P.bench(v, x, 135, 1, 9)
    P.flower_bed(v, 15, 129, 51, 132, seed=seed)
    P.flower_bed(v, 93, 129, 129, 132, seed=seed + 1)
    for x in (64, 79):
        for z in range(19, 31):
            v.set(x, 129, z, P.cloth(DYE_BLUE))
            v.set(x + 1, 129, z, P.cloth(DYE_BLUE) if z != 25 else P.cloth(mat("canvas")))
        v.set(x, 129, 31, BRASS)
        v.set(x + 1, 129, 31, BRASS)
    return P.colour_jitter(v, seed=seed)
