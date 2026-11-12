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

Voxels (8 per tile): x 0..32 along the coast, y 0..88 from the sea (y = 0)
to the land. Below the deck (z < 0) there is only the plinth's side face
on its rim; everything with volume stands on the deck, whose top is the
quay level z = 0 (floor level of every thing on it: z = 1).
"""


from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import detail_d062 as H
from nsvoxel import parts_d078 as Q
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

#: The plinth: x PX0..PX1, y PY0..PY1 (the whole footprint), its top layer at z DECK_TOP (the quay level).
PX0, PX1 = 0, 32
PY0, PY1 = 0, 88
DECK_TOP = 0
FLOOR = DECK_TOP + 1
#: The gatehouse's sea face (the D-062 first land row), in voxels.
LAND_Y = 72
#: The three sheds (x0, x1) and their roofs; the walkways lie between them.
SHEDS = ((2, 8), (13, 19), (24, 30))
SHED_Y0, SHED_Y1 = 10, LAND_Y
WALL_TOP = 11


def platform(v, seed):
    """The quay plinth under the whole footprint (its posts are the bollards of lights()) and the mooring rings on the three sea faces."""
    Q.plinth(v, PX0, PY0, PX1, PY1, vpt=8, posts=False, seed=seed)
    # Set into the face (the footprint keeps its 32 voxels).
    for x in (4, 11, 18, 25):
        D.mooring_ring(v, x, PY0, -4)
    for y in (13, 29, 45, 61):
        D.mooring_ring(v, PX0, y, -4, plane="yz")
        D.mooring_ring(v, PX1 - 1, y, -4, plane="yz")


def walkways(v):
    """Plank walkways on both sides of the middle shed, a lighter strip along their middle."""
    for lo, hi in ((SHEDS[0][1], SHEDS[1][0]), (SHEDS[1][1], SHEDS[2][0])):
        for y in range(PY0 + 8, 77):
            for x in range(lo, hi):
                mid = lo + 1 < x < hi - 2
                v.set(x, y, DECK_TOP, shade_of(PLANK, (1.1 if mid else 0.95) if (y // 2) % 2 else (1.0 if mid else 0.88)))


def shed(v, x0, x1, roof, ridge, seed, doors):
    """One long shed on the deck: stone plinth, half-timbered walls, a gabled tile roof along y, loading gates on the `doors` sides (x- and/or x+)."""
    y0, y1 = SHED_Y0, SHED_Y1
    v.box(x0, y0, FLOOR, x1, y1, FLOOR + 1, STONE_DARK)
    P.half_timber(v, x0, y0, x1, y1, FLOOR + 1, WALL_TOP, PLASTER, TIMBER, spacing=6)
    r = P.roof(v, x0, x1, y0, y1, WALL_TOP, "tiles", along="y", rise=1.1, gable=PLASTER, m=roof[0], ridge=ridge, seed=seed)
    gates = (16, 34, 52)
    for side in doors:
        face = P.Face(v, side, x0 if side == "x-" else x1 - 1)
        for a in gates:
            P.barn_gate(face, a, FLOOR + 1, 6, 6)
    sea = P.Face(v, "y-", y0)
    P.entrance(sea, (x0 + x1) // 2 - 1, FLOOR + 1, 3, 5)
    for side, planes in (("x-", x0), ("x+", x1 - 1)):
        if side not in doors:
            face = P.Face(v, side, planes)
            for a in (24, 44, 62):
                P.casement(face, a, FLOOR + 3, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    return r


def gatehouse(v):
    """The end wall on the land rows: two arched passages in line with the walkways, a battlement, corner turrets and a bell turret."""
    x0, x1, y0, y1, top = PX0 + 1, PX1 - 1, LAND_Y, LAND_Y + 6, FLOOR + 8  # inside the plinth's rim
    v.box(x0, y0, FLOOR, x1, y1, top, STONE)
    for z in range(FLOOR, top):  # ashlar courses: a darker joint line every third layer
        if (z - FLOOR) % 3 == 2:
            v.walls(x0, y0, x1, y1, z, z + 1, STONE_DARK)
    for lo, hi in ((SHEDS[0][1], SHEDS[1][0]), (SHEDS[1][1], SHEDS[2][0])):
        for i, x in enumerate(range(lo, hi)):  # a stepped arch head over the five-wide passage
            h = (4, 5, 6, 5, 4)[i]
            for z in range(FLOOR, FLOOR + h):
                for y in range(y0, y1):
                    v.cells.pop((x, y, z), None)
            for y in range(y0, y1):
                v.set(x, y, DECK_TOP, shade_of(PLANK, 1.0 if (y // 2) % 2 else 0.9))
        for y in (y0, y1 - 1):  # dressed jambs and a keystone course on both faces
            v.box(lo, y, FLOOR, lo + 1, y + 1, FLOOR + 4, STONE_LIGHT)
            v.box(hi - 1, y, FLOOR, hi, y + 1, FLOOR + 4, STONE_LIGHT)
            v.box(lo + 1, y, FLOOR + 5, hi - 1, y + 1, FLOOR + 7, STONE_LIGHT)
    D.crenellation(v, x0, y0, x1, y1, top, m=STONE, merlon=2, gap=2, h=2, cap=STONE_LIGHT)
    # Corner turrets with terracotta hip roofs (the minority roof of the depot).
    for tx0, tx1 in ((x0, SHEDS[0][1]), (SHEDS[2][0], x1)):
        v.box(tx0, y0, FLOOR, tx1, y1, top + 4, STONE)
        for z in range(FLOOR, top + 4):
            if (z - FLOOR) % 3 == 2:
                v.walls(tx0, y0, tx1, y1, z, z + 1, STONE_DARK)
        P.casement(P.Face(v, "y-", y0), (tx0 + tx1) // 2 - 1, top, 2, 3, frame=STONE_LIGHT, sill=STONE_LIGHT, shutters=None, bars=False)
        t = v.hip(tx0 - 1, tx1 + 1, y0 - 1, y1 + 1, top + 4, TERRA, ov=0, rise=1, ridge=RIDGE_TERRA)
        v.set((tx0 + tx1) // 2, (y0 + y1) // 2, t, IRON)
    D.bell_turret(v, 16, (y0 + y1) // 2, top + 2, size=4, h=4, roof=TERRA)


def cargo(v):
    """Goods on the open end of the platform and on the walkways: crate pyramids, sacks, casks, a hand cart."""
    z = FLOOR

    def stack(x, y, s=3, rows=2):
        for r in range(rows):
            for i in range(rows - r):
                P.box_crate(v, x + i * s + r, y + r, z + r * s, s=s)

    stack(3, 4)
    stack(22, 3, s=2)
    P.sacks(v, 12, 3, z, n=3)
    P.sacks(v, 14, 6, z, n=2)
    P.cask(v, 18, 3, z)
    P.cask(v, 20, 3, z)
    P.cask(v, 18, 5, z)
    P.sacks(v, 26, 7, z, n=2, along="y")
    P.box_crate(v, 9, 3, z, s=2)
    # On the walkways, against the sheds' walls.
    P.box_crate(v, 9, 25, z)
    P.sacks(v, 9, 42, z, n=2, along="y")
    P.cask(v, 20, 28, z)
    P.cask(v, 22, 28, z)
    P.box_crate(v, 21, 48, z)
    P.handcart(v, 9, 58, z, along="x", load=CANVAS)


def lights(v):
    """Bollards along the edges and lantern posts on the walkways."""
    z = FLOOR
    for x in (3, 10, 21, 28):
        v.box(x, 2, z, x + 2, 4, z + 3, TIMBER_DARK)
        v.box(x, 2, z + 3, x + 2, 4, z + 4, IRON)
    for y in (16, 34, 52):
        v.box(PX0, y, z, PX0 + 1, y + 1, z + 3, TIMBER_DARK)
        v.set(PX0, y, z + 3, IRON)
        v.box(PX1 - 1, y, z, PX1, y + 1, z + 3, TIMBER_DARK)
        v.set(PX1 - 1, y, z + 3, IRON)
    for y in (12, 40, 66):
        H.lantern(v, 10, y, z, h=9)
        H.lantern(v, 21, y, z, h=9)


def build(ctx):
    v = ctx.vox()  # 32 × 88
    seed = 87
    W, D_ = ctx.W, ctx.D
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
    v.anchor("cart", 16.2, 85, 1)
    v.anchor("door", 16, D_, 0)
    v.anchor("status", 16, 40, r_mid.top + 3)
    return P.colour_jitter(v, seed=seed)
