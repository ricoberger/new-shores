"""
Depot (4 × 11 shore; D-062 as-built correction, D-060, D-077 §5, Merchants;
one level only): the island's storage on the stone quay plinth of the
harbour buildings (D-078 §3, parts_d078.plinth: slabs under every tile, a
dressed side face into the water with iron mooring rings on the three sea
faces); three parallel timber-framed sheds run seaward under tiled roofs (two dark
tile, the middle one brown slate), a plank walkway on either side of the
middle shed with loading gates toward it. Crates, sacks and casks stack on
the open end of the platform, bollards and lantern posts line its edge. On
the land rows a gatehouse wall (two arched passages in line with the
walkways, merlons, two corner turrets with terracotta roofs, a bell
turret) closes the sheds toward the land end of the plinth. No smoke anchor.

Voxels (12 per tile, D-078 step 6): x 0..48 along the coast, y 0..132 from
the sea (y = 0) to the land. Below the deck (z < 0) there is only the plinth's side face
on its rim; everything with volume stands on the deck, whose top is the
quay level z = 0 (floor level of every thing on it: z = 1).
"""


from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import detail_d062 as H
from nsvoxel import parts_d078 as Q
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

# The warm sandstone courses of the church and city guard (D.warm_hall), never a cold grey (ART_DIRECTION §2).
STONE = D.SANDSTONE
STONE_DARK = D.SANDSTONE_QUOIN
STONE_LIGHT = D.SANDSTONE_TRIM

# Roof roles (D-063 §3: dark tile / brown slate majority, terracotta the minority).
DARK_TILE = (mat("timber", 0.9), mat("timber", 0.84))
BROWN_SLATE = (mat("timber", 1.22), mat("timber", 1.1))
RIDGE_DARK = mat("timber", 0.68)
RIDGE_SLATE = mat("timber", 0.92)
TERRA = mat("terracotta", 0.92)
RIDGE_TERRA = mat("terracotta", 0.7)
PLANK = mat("timber", 1.62)

VOXELS_PER_TILE = 12

#: The plinth: x PX0..PX1, y PY0..PY1 (the whole footprint), its top layer at z DECK_TOP (the quay level).
PX0, PX1 = 0, 48
PY0, PY1 = 0, 132
DECK_TOP = 0
FLOOR = DECK_TOP + 1
#: The gatehouse's sea face (the D-062 first land row), in voxels.
LAND_Y = 108
#: The three sheds (x0, x1) and their roofs; the walkways lie between them.
SHEDS = ((3, 12), (19, 29), (36, 45))
SHED_Y0, SHED_Y1 = 15, LAND_Y
WALL_TOP = 16
#: The loading gates along the sheds' walkway sides (y of their first column).
GATES = (24, 51, 78)


def platform(v, seed):
    """The quay plinth under the whole footprint (its posts are the bollards of lights()) and the mooring rings on the three sea faces."""
    Q.plinth(v, PX0, PY0, PX1, PY1, vpt=12, posts=False, seed=seed)
    # Set into the face (the footprint keeps its 48 voxels).
    for x in (6, 16, 27, 37):
        D.mooring_ring(v, x, PY0, -6)
    for y in (19, 43, 67, 91):
        D.mooring_ring(v, PX0, y, -6, plane="yz")
        D.mooring_ring(v, PX1 - 1, y, -6, plane="yz")


def walkways(v):
    """Plank walkways on both sides of the middle shed, a lighter strip along their middle."""
    for lo, hi in ((SHEDS[0][1], SHEDS[1][0]), (SHEDS[1][1], SHEDS[2][0])):
        for y in range(PY0 + 12, 116):
            for x in range(lo, hi):
                mid = lo + 1 < x < hi - 2
                v.set(x, y, DECK_TOP, shade_of(PLANK, (1.1 if mid else 0.95) if (y // 2) % 2 else (1.0 if mid else 0.88)))
            if y % 6 == 0:  # the board ends: a darker joint across the walkway every half tile
                for x in range(lo, hi):
                    v.set(x, y, DECK_TOP, shade_of(PLANK, 0.8))


def shed(v, x0, x1, roof, ridge, seed, doors):
    """One long shed on the deck: stone plinth, heavy-framed walls, a gabled tile roof along y, loading gates on the `doors` sides (x- and/or x+)."""
    y0, y1 = SHED_Y0, SHED_Y1
    v.box(x0, y0, FLOOR, x1, y1, FLOOR + 2, STONE_DARK)
    for y in range(y0, y1, 4):  # the plinth in dressed blocks
        v.walls(x0, y, x1, min(y + 2, y1), FLOOR, FLOOR + 1, STONE)
    W.heavy_frame(v, x0, y0, x1, y1, FLOOR + 2, WALL_TOP, PLASTER, TIMBER, bay=9, rail=FLOOR + 9)
    r = P.roof(v, x0, x1, y0, y1, WALL_TOP, "tiles", along="y", rise=1.1, gable=PLASTER, m=roof[0], ridge=ridge, seed=seed, shades=(1.08, 0.92))
    W.roof_core(v, r, PLASTER, roof[0])
    for side in doors:
        face = P.Face(v, side, x0 if side == "x-" else x1 - 1)
        for a in GATES:
            P.barn_gate(face, a, FLOOR + 2, 8, 9)
            for i in range(-1, 9):  # a timber lintel over the gate
                face.put(a + i, FLOOR + 11, TIMBER_DARK, out=1)
    sea = P.Face(v, "y-", y0)
    P.entrance(sea, (x0 + x1) // 2 - 2, FLOOR + 2, 4, 8)
    for side, planes in (("x-", x0), ("x+", x1 - 1)):
        if side not in doors:
            face = P.Face(v, side, planes)
            for a in (36, 66, 93):
                P.casement(face, a, FLOOR + 5, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    return r


def gatehouse(v):
    """The end wall on the land rows: two arched passages in line with the walkways, a battlement, corner turrets and a bell turret."""
    x0, x1, y0, y1, top = PX0 + 1, PX1 - 1, LAND_Y, LAND_Y + 9, FLOOR + 12  # inside the plinth's rim

    def coursed(bx0, bx1, z1):
        v.box(bx0, y0, FLOOR, bx1, y1, z1, STONE)
        for z in range(FLOOR, z1):  # ashlar courses: a darker joint line every fourth layer, staggered joints
            if (z - FLOOR) % 4 == 3:
                v.walls(bx0, y0, bx1, y1, z, z + 1, STONE_DARK)
            else:
                k = (z - FLOOR) // 4
                for x in range(bx0 + (3 if k % 2 else 0), bx1, 6):
                    v.set(x, y0, z, STONE_DARK)
                    v.set(x, y1 - 1, z, STONE_DARK)

    coursed(x0, x1, top)
    arch = (6, 8, 9, 10, 9, 8, 6)
    for lo, hi in ((SHEDS[0][1], SHEDS[1][0]), (SHEDS[1][1], SHEDS[2][0])):
        for i, x in enumerate(range(lo, hi)):  # a stepped arch head over the seven-wide passage
            h = arch[i]
            for z in range(FLOOR, FLOOR + h):
                for y in range(y0, y1):
                    v.cells.pop((x, y, z), None)
            for y in range(y0, y1):
                v.set(x, y, DECK_TOP, shade_of(PLANK, 1.0 if (y // 2) % 2 else 0.9))
        for y in (y0, y1 - 1):  # dressed jambs and voussoirs on both faces
            v.box(lo, y, FLOOR, lo + 1, y + 1, FLOOR + 6, STONE_LIGHT)
            v.box(hi - 1, y, FLOOR, hi, y + 1, FLOOR + 6, STONE_LIGHT)
            for i, x in enumerate(range(lo, hi)):
                v.set(x, y, FLOOR + arch[i], STONE_LIGHT)
            v.set(lo + 3, y, FLOOR + arch[3] + 1, STONE_LIGHT)  # the keystone
    D.crenellation(v, x0, y0, x1, y1, top, m=STONE, merlon=2, gap=2, h=3, cap=STONE_LIGHT)
    for x in range(x0, x1):  # a string course under the battlement
        v.set(x, y0 - 1, top - 1, STONE_LIGHT)
    # Corner turrets with terracotta hip roofs (the minority roof of the depot).
    for tx0, tx1 in ((x0, SHEDS[0][1]), (SHEDS[2][0], x1)):
        coursed(tx0, tx1, top + 6)
        for x in range(tx0 - 1, tx1 + 1):  # a corbelled course under the roof
            v.set(x, y0 - 1, top + 5, STONE_LIGHT)
            v.set(x, y1, top + 5, STONE_LIGHT)
        P.casement(P.Face(v, "y-", y0), (tx0 + tx1) // 2 - 1, top, 2, 4, frame=STONE_LIGHT, sill=STONE_LIGHT, shutters=None, bars=False)
        P.casement(P.Face(v, "y+", y1 - 1), (tx0 + tx1) // 2 - 1, top - 2, 2, 4, frame=STONE_LIGHT, sill=STONE_LIGHT, shutters=None, bars=False)
        t = v.hip(tx0 - 1, tx1 + 1, y0 - 1, y1 + 1, top + 6, TERRA, ov=0, rise=1, ridge=RIDGE_TERRA)
        v.set((tx0 + tx1) // 2, (y0 + y1) // 2, t, IRON)
        v.set((tx0 + tx1) // 2, (y0 + y1) // 2, t + 1, IRON)
    D.bell_turret(v, 24, (y0 + y1) // 2, top + 3, size=6, h=9, roof=TERRA)


def cargo(v):
    """Goods on the open end of the platform and on the walkways: crate pyramids, sacks, casks, a hand cart."""
    z = FLOOR

    def stack(x, y, s=3, rows=2):
        for r in range(rows):
            for i in range(rows - r):
                P.box_crate(v, x + i * s + r, y + r, z + r * s, s=s)

    stack(4, 6)
    stack(33, 5, s=3, rows=2)
    P.sacks(v, 18, 5, z, n=4)
    P.sacks(v, 21, 9, z, n=3)
    for x, y in ((27, 4), (30, 4), (27, 7), (29, 10)):
        P.cask(v, x, y, z, h=4)
    P.sacks(v, 40, 10, z, n=3, along="y")
    P.box_crate(v, 13, 4, z, s=3)
    # On the walkways, against the sheds' walls.
    P.box_crate(v, 13, 38, z, s=3)
    P.box_crate(v, 13, 41, z, s=2)
    P.sacks(v, 13, 63, z, n=3, along="y")
    P.cask(v, 30, 42, z, h=4)
    P.cask(v, 33, 42, z, h=4)
    P.box_crate(v, 31, 72, z, s=3)
    P.handcart(v, 13, 87, z, along="x", load=CANVAS)


def lights(v):
    """Bollards along the edges and lantern posts on the walkways."""
    z = FLOOR
    for x in (5, 15, 31, 41):
        v.box(x, 2, z, x + 2, 4, z + 4, TIMBER_DARK)
        v.box(x, 2, z + 4, x + 2, 4, z + 5, IRON)
    for y in (24, 51, 78):
        v.box(PX0, y, z, PX0 + 1, y + 1, z + 4, TIMBER_DARK)
        v.set(PX0, y, z + 4, IRON)
        v.box(PX1 - 1, y, z, PX1, y + 1, z + 4, TIMBER_DARK)
        v.set(PX1 - 1, y, z + 4, IRON)
    for y in (18, 60, 99):
        H.lantern(v, 15, y, z, h=13)
        H.lantern(v, 32, y, z, h=13)


def build(ctx):
    v = ctx.vox()  # 32 × 88
    seed = 87
    D_ = ctx.D
    platform(v, seed)
    walkways(v)
    r_mid = None
    for k, (x0, x1) in enumerate(SHEDS):
        roof = BROWN_SLATE if k == 1 else DARK_TILE
        ridge = RIDGE_SLATE if k == 1 else RIDGE_DARK
        doors = {0: ("x+",), 1: ("x-", "x+"), 2: ("x-",)}[k]
        r = shed(v, x0, x1, roof, ridge, seed + k, doors)
        if k == 1:
            r_mid = r
    gatehouse(v)
    cargo(v)
    lights(v)
    v.anchor("cart", 24.3, 127.5, 1.5)
    v.anchor("door", 24, D_, 0)
    v.anchor("status", 24, 60, r_mid.top + 5)
    return P.colour_jitter(v, seed=seed)
