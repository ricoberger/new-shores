"""
Depot (4 × 11, seven to nine water rows; D-062 as-built correction, D-060,
Citizens; one level only): the island's storage as a stone platform that
juts into the water, its short side on the beach. A warm grey ashlar deck
(courses, a coping, mooring rings on the three sea faces) stands on stone
piers and timber piles with shallow arches between them at the waterline;
three parallel timber-framed sheds run seaward under tiled roofs (two dark
tile, the middle one brown slate), a plank walkway on either side of the
middle shed with loading gates toward it. Crates, sacks and casks stack on
the open end of the platform, bollards and lantern posts line its edge. On
the land rows a gatehouse wall (two arched passages in line with the
walkways, merlons, two corner turrets with terracotta roofs, a bell
turret) closes the platform and a short stone ramp leads down to the
beach. No smoke anchor.

Voxels (8 per tile): x 0..32 along the coast, y 0..88 from the sea (y = 0)
to the land. The content allows 7–9 water rows (D-062): y < 56 is always
water, y ≥ 72 always land, in between either. Below the deck level (z < 0)
the water rows hold only piles, piers and the arches between them at the
platform's edge (`PILES` lists the pile and pier cells' footprints; the
test checks it); everything with volume stands on the deck, whose top is
at z = 2 (floor level of every thing on it: z = 3).
"""

import math

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import detail_d062 as H
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, PLASTER, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

# Roof roles (D-063 §3: dark tile / brown slate majority, terracotta the minority).
DARK_TILE = (mat("timber", 0.62), mat("timber", 0.56))
BROWN_SLATE = (mat("timber", 1.08), mat("timber", 0.98))
RIDGE_DARK = mat("timber", 0.48)
RIDGE_SLATE = mat("timber", 0.82)
TERRA = mat("terracotta", 0.92)
RIDGE_TERRA = mat("terracotta", 0.7)
PLANK = mat("timber", 1.62)

#: The platform: x PX0..PX1, y PY0..PY1 (deck slab z 0..2, top layer z DECK_TOP), the land end of the slab and the ramp.
PX0, PX1 = 1, 31
PY0, PY1 = 1, 80
DECK_TOP = 2
FLOOR = DECK_TOP + 1
#: Water rows that are water for certain (7) and the first row that is land for certain (9), in voxels.
SEA_Y, LAND_Y = 56, 72
#: Piers and piles every 7 voxels across and every 8 along the platform (2 × 2 each).
PIER_XS = (1, 8, 15, 22, 29)
PIER_YS = tuple(range(PY0, LAND_Y, 8))
#: Footprints (x, y) of every pile and pier column below the deck: the only solid below z = -3 and inside the platform's perimeter band.
PILES = frozenset((x + dx, y + dy) for x in PIER_XS for y in PIER_YS for dx in (0, 1) for dy in (0, 1))
#: The perimeter band (voxels) in which the arches between the piers hang under the deck's edge.
BAND = 2
#: The three sheds (x0, x1) and their roofs; the walkways lie between them.
SHEDS = ((2, 8), (13, 19), (24, 30))
SHED_Y0, SHED_Y1 = 10, LAND_Y
WALL_TOP = 11


def arch_cells(a, n):
    """The soffit height of an arch spanning n voxels from a: [(offset, z of the lowest solid cell)] — a segmental arch from z = -2 at the piers to z = 0 (the deck's underside) at the crown."""
    return [(i, -3 + math.ceil(2.4 * math.sin(math.pi * (i + 0.5) / n))) for i in range(n)]


def platform(v):
    """The ashlar deck, its piers, arches and timber piles, the coping, the walkway planking and the mooring rings."""
    # Slab body: courses of alternating shade, the top layer in staggered paving slabs.
    for y in range(PY0, PY1):
        for x in range(PX0, PX1):
            for z in (0, 1):
                joint = (x + 4 * (y // 4 % 2)) % 8 == 0
                v.set(x, y, z, STONE_DARK if (z == 0 or joint) else STONE)
            row = y // 3
            slab = (x + 3 * (row % 2)) // 6
            v.set(x, y, DECK_TOP, shade_of(STONE, 1.0 if (row + slab) % 2 else 0.94))
    # The coping: a lighter course round the three sea sides.
    for y in range(PY0, PY1):
        for x in range(PX0, PX1):
            if x in (PX0, PX1 - 1) or y == PY0:
                v.set(x, y, DECK_TOP, STONE_LIGHT)
    # Piers (stone from z = -3) and piles (timber below).
    for x, y in sorted(PILES):
        v.box(x, y, -3, x + 1, y + 1, 0, STONE_DARK)
        v.box(x, y, -8, x + 1, y + 1, -3, TIMBER_DARK)
    # Arches in the perimeter band between the piers (seaward face and both flanks).
    for x0 in PIER_XS[:-1]:
        span = [(x0 + 2 + i, dz) for i, dz in arch_cells(0, PIER_XS[1] - PIER_XS[0] - 2)]
        for x, soffit in span:
            for y in range(PY0, PY0 + BAND):
                v.box(x, y, soffit, x + 1, y + 1, 0, STONE_DARK if (x + y) % 2 else STONE)
    for y0 in PIER_YS[:-1]:
        for i, soffit in arch_cells(0, 6):
            y = y0 + 2 + i
            for x in list(range(PX0, PX0 + BAND)) + list(range(PX1 - BAND, PX1)):
                v.box(x, y, soffit, x + 1, y + 1, 0, STONE_DARK if (x + y) % 2 else STONE)
    # Mooring rings on the three sea faces, between the courses' joints.
    for x in (4, 11, 18, 25):
        D.mooring_ring(v, x, PY0 - 1, -1)
    for y in (13, 29, 45, 61):
        D.mooring_ring(v, PX0 - 1, y, -1, plane="yz")
        D.mooring_ring(v, PX1, y, -1, plane="yz")


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
    x0, x1, y0, y1, top = PX0, PX1, LAND_Y, LAND_Y + 6, FLOOR + 8
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


def ramp(v):
    """A short stone ramp from the platform's land end down to the beach, cheeks on both sides, a paved strip in the middle."""
    x0, x1, y0, y1 = SHEDS[0][1], SHEDS[2][0], PY1, 88
    for y in range(y0, y1):
        top = max(0, DECK_TOP - (y - y0) * 3 // (y1 - y0))
        for x in range(x0, x1):
            for z in range(0, top + 1):
                v.set(x, y, z, STONE_DARK if z < top else shade_of(STONE, 1.0 if (y // 2) % 2 else 0.92))
        for x in (x0, x1 - 1):
            v.set(x, y, top + 1, STONE_LIGHT)
    # Cheek walls of the slab where the ramp leaves it.
    for x in (x0 - 1, x1):
        for y in range(y0, y0 + 2):
            v.box(x, y, 0, x + 1, y + 1, DECK_TOP + 2, STONE_DARK)


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
    # The beach: the land rows' ground plate with the paved way from the ramp to the door.
    P.yard(v, 0, LAND_Y, W, D_, "dirt", seed=seed)
    P.path(v, [(x, y) for x in range(14, 19) for y in range(PY1, D_)], kind="paved")
    platform(v)
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
    ramp(v)
    cargo(v)
    lights(v)
    v.anchor("cart", 16.2, 85, 1)
    v.anchor("door", 16, D_, 0)
    v.anchor("status", 16, 40, r_mid.top + 3)
    P.scatter(v, 0, LAND_Y, W, D_, 0.012, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
