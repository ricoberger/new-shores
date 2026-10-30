"""
Playhouse (11 × 14; D-063, Merchants, services ladder, replaces the
theatre): a timber-framed, galleried playhouse. An octagonal hall of
plaster and timber posts with a jettied upper storey round an open yard;
a steep ring roof of dark tile and brown slate over two tiers of timber
galleries (the yard stays open to the sky); a raised stage against a
taller stage house with a gable roof and a roof lantern (cupola) with a
pennant; banners (cloth, sway group `flag`) on the roof ridge and flanking
the gabled entrance porch; a ticket booth, a well and lantern posts on the
paved forecourt and linden-like broad trees at the sides.

Palette (D-063 §3): timber, plaster, dark tile and brown slate; the roof
carries terracotta only on the porch, the ticket booth and the cupola
(well under 20 % of the roof area).
"""

import math

from nsvoxel import parts as P
from nsvoxel import detail_d062 as H
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, CANVAS, IRON, PLASTER, STONE_DARK, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WINDOW

#: Roof materials (two course shades each): dark tile, brown slate and — in small doses — terracotta.
DARK_TILE = (mat("timber", 0.62), mat("timber", 0.56))
BROWN_SLATE = (mat("timber", 1.08), mat("timber", 0.98))
TERRA = (mat("terracotta", 0.92), mat("terracotta", 0.84))
RIDGE_DARK = mat("timber", 0.48)
RIDGE_SLATE = mat("timber", 0.82)
RIDGE_TERRA = mat("terracotta", 0.7)
#: The eight facets of the ring roof, counter-clockwise from the +x side.
HIP = mat("timber", 1.3)
FACETS = (DARK_TILE, DARK_TILE, BROWN_SLATE, DARK_TILE, DARK_TILE, BROWN_SLATE, DARK_TILE, BROWN_SLATE)

CX, CY = 44, 54  # centre of the hall (voxels)
R = 32  # inradius of the ground storey
R_UP = 33  # the jettied upper storey
R_YARD = 14  # the open yard
Z_WALL = 13  # top of the walls
SQRT2 = math.sqrt(2)


def ring_roof(v):
    """The steep ring roof over the galleries: eaves at r 35 (z 16), ridge ring at r 25 (z 29), inner eaves at r 18; the yard stays open."""
    for x, y in H.octagon_cells(CX, CY, 18, 35.5):
        r = H.oct_r(x, y, CX, CY)
        top = Z_WALL + 3 + (35 - r) * 1.3 if r >= 25 else Z_WALL + 3 + 10 * 1.3 - (25 - r) * 0.8
        top = int(round(top))
        course = int((35 - r) // 2) if r >= 25 else int((r - 18) // 2)
        pair = FACETS[H.sector(x, y, CX, CY)]
        ridge = RIDGE_DARK if pair is DARK_TILE else RIDGE_SLATE
        m = ridge if 24.4 <= r <= 25.6 else pair[course % 2]
        # A rib of lighter timber on every hip (the facet boundaries) of the outer slope.
        a = (math.atan2(y + 0.5 - CY, x + 0.5 - CX) / (2 * math.pi) * 8 + 0.5) % 1.0
        if r >= 25.6 and (a < 0.06 or a > 0.94):
            m = HIP
        for z in range(top - 3, top + 1):
            v.set(x, y, z, m)


def hall_walls(v, seed):
    """The octagonal hall: plaster ground storey with timber posts, a jetty course, a jettied upper storey, a top plate."""
    ground = H.octagon_cells(CX, CY, -1, R)
    upper = H.octagon_cells(CX, CY, -1, R_UP)
    for x, y in ground:
        for z in range(1, 8):
            v.set(x, y, z, PLASTER if z > 1 else STONE_DARK)
    ring_g = set(H.edge_cells(ground))
    ring_u = set(H.edge_cells(upper))
    for x, y in ring_g:
        a = (math.atan2(y + 0.5 - CY, x + 0.5 - CX) / (2 * math.pi)) * 36 % 1.0
        v.set(x, y, 1, STONE_DARK)
        for z in range(2, 8):
            if a < 0.2:
                v.set(x, y, z, TIMBER)  # a post every ten degrees
            elif 0.4 < a < 0.7 and 3 <= z <= 5:
                v.set(x, y, z, WINDOW)
            elif z == 2:
                v.set(x, y, z, TIMBER_DARK)
    for x, y in upper:
        v.set(x, y, 7, TIMBER_DARK)  # the jetty course
        for z in range(8, Z_WALL):
            v.set(x, y, z, PLASTER)
    for x, y in ring_u:
        a = (math.atan2(y + 0.5 - CY, x + 0.5 - CX) / (2 * math.pi)) * 36 % 1.0
        for z in range(8, Z_WALL):
            if a < 0.2:
                v.set(x, y, z, TIMBER)
            elif 0.35 < a < 0.65 and 9 <= z <= 11:
                v.set(x, y, z, WINDOW)
        v.set(x, y, Z_WALL, TIMBER_DARK)
    # The galleries inside, the yard floor and the inner face of the outer wall.
    for x, y in H.octagon_cells(CX, CY, -1, R_YARD):
        v.set(x, y, 1, mat("road-dirt", 1.0))


def stage(v):
    """The raised stage in the yard against the back, with a canopy ("heavens") on two posts."""
    for x in range(34, 56):
        for y in range(34, 48):
            v.set(x, y, 2, TIMBER_LIGHT)
            v.set(x, y, 3, P.shade_of(mat("timber", 1.62), 1.0 if (y // 2) % 2 else 0.9))
    for x in (34, 55):
        for y in (34, 47):
            v.box(x, y, 1, x + 1, y + 1, 2, TIMBER_DARK)
    v.box(34, 47, 4, 56, 48, 5, TIMBER_DARK)  # the stage's front rail
    for x in range(34, 56, 3):
        v.set(x, 47, 5, TIMBER)
    # The heavens: two painted posts, a beam and a little roof over the back half.
    for x in (35, 54):
        v.box(x, 35, 4, x + 1, 36, 14, TIMBER)
    v.box(34, 35, 14, 56, 36, 15, TIMBER_DARK)
    v.box(33, 34, 15, 57, 41, 16, mat("dye-blue", 0.9))


def stage_house(v, seed):
    """The taller stage house behind the hall: framed walls, a gable roof of brown slate and a roof lantern."""
    x0, x1, y0, y1 = 26, 62, 3, 26
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
    P.half_timber(v, x0, y0, x1, y1, 2, 19, PLASTER, TIMBER, spacing=6, braces=("x-", "x+"))
    r = P.roof(v, x0, x1, y0, y1, 19, "tiles", along="x", rise=1.25, m=BROWN_SLATE[0], ridge=RIDGE_SLATE, gable=PLASTER, seed=seed)
    f = P.Face(v, "x-", x0)
    for a in (8, 16):
        P.casement(f, a, 10, 2, 4, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    fb = P.Face(v, "y-", y0)
    for a in (31, 38, 50, 57):
        P.casement(fb, a, 10, 2, 4, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.barn_gate(fb, 42, 2, 6, 8)
    H.cupola(v, 44, 14, r.ridge_z + 1, size=8, h=7, roof=TERRA[0], ridge=RIDGE_TERRA, flag=True)


def porch(v, seed):
    """The gabled entrance porch: a timber-framed box on posts with a terracotta gable roof and the big double door behind it."""
    f = P.Face(v, "y+", CY + R - 1)
    P.entrance(f, 39, 2, 10, 8, leaf=TIMBER, frame=TIMBER_DARK, step=STONE_DARK, lintel=TIMBER_DARK, hinges=True, steps=2)
    x0, x1, y0, y1 = 34, 54, 88, 98
    for px in (x0, x1 - 1):
        for py in (y0, y1 - 1):
            v.box(px, py, 1, px + 1, py + 1, 10, TIMBER)
    v.box(x0, y0, 9, x1, y1, 10, TIMBER_DARK)
    P.roof(v, x0 - 1, x1 + 1, y0 - 1, y1 + 1, 10, "tiles", along="y", rise=1.2, m=TERRA[0], ridge=RIDGE_TERRA, gable=PLASTER, seed=seed)


def ticket_booth(v, x, y):
    """A small timber booth with a shuttered window, a counter and a terracotta roof."""
    P.fill(v, x, y, x + 9, y + 7, 1, 2, STONE_DARK)
    P.half_timber(v, x, y, x + 9, y + 7, 2, 8, PLASTER, TIMBER, spacing=4, braces=False)
    P.roof(v, x, x + 9, y, y + 7, 8, "tiles", along="x", rise=1.0, m=TERRA[1], ridge=RIDGE_TERRA, gable=PLASTER)
    f = P.Face(v, "y+", y + 6)
    P.casement(f, x + 1, 3, 4, 3, frame=TIMBER_DARK, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    v.box(x, y + 7, 3, x + 9, y + 8, 4, TIMBER_LIGHT)  # the counter
    P.entrance(P.Face(v, "x-", x), y + 2, 2, 3, 5)


def build(ctx):
    v = ctx.vox()  # 88 × 112
    seed = 63
    P.yard(v, 0, 0, 88, 112, "grass", seed=seed)
    P.yard(v, 10, 88, 78, 112, "paved", seed=seed)
    P.path(v, [(x, y) for x in range(38, 50) for y in range(98, 112)], kind="paved")
    P.yard(v, 20, 76, 68, 88, "paved", seed=seed)
    stage_house(v, seed)
    hall_walls(v, seed)
    # Two tiers of galleries round the yard; the lower tier opens at the stage.
    opening = lambda x, y: 28 <= x < 60 and y < 49
    H.gallery_ring(v, CX, CY, R_YARD, 30, 5, h=6, skip=opening)
    H.gallery_ring(v, CX, CY, R_YARD, 30, 11, h=7, skip=opening)
    ring_roof(v)
    stage(v)
    porch(v, seed)
    # Banners on the roof ridge and flanking the porch.
    for x, y, c in ((CX - 25, CY, H.BANNER_BLUE), (CX + 25, CY, H.BANNER_OCHRE), (CX + 18, CY + 18, H.BANNER_BLUE), (CX - 18, CY + 18, H.BANNER_OCHRE)):
        H.banner_pole(v, x, y, 30, h=13, cloth=c, drop=7)
    H.banner_pole(v, 30, 92, 1, h=17, cloth=H.BANNER_BLUE, drop=9)
    H.banner_pole(v, 58, 92, 1, h=17, cloth=H.BANNER_OCHRE, drop=9)
    # Forecourt: the ticket booth, a well, lantern posts and broad trees.
    ticket_booth(v, 62, 90)
    P.well(v, 15, 100, roof_m=DARK_TILE[0])
    for x, y in ((26, 90), (54, 90), (20, 108), (68, 108), (44, 108)):
        H.lantern(v, x, y, 1, h=9)
    P.bench(v, 26, 104, 1, 6, along="x")
    P.bench(v, 56, 104, 1, 6, along="x")
    for x, y in ((6, 20), (80, 20), (5, 78), (82, 78), (4, 100)):
        P.tree(v, x, y, 1, "broad")
    P.scatter(v, 0, 0, 88, 112, 0.012, seed=seed, kinds=("tuft", "flower"))
    v.anchor("door", 44, 112, 0)
    return P.colour_jitter(v, seed=seed)
