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
(well under 20 % of the roof area). 12 voxels per tile (D-078 step 6).
"""

import math

from nsvoxel import parts as P
from nsvoxel import detail_d062 as H
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import CROWN, PLASTER, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WINDOW

VOXELS_PER_TILE = 12

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

CX, CY = 66, 81  # centre of the hall (voxels)
R = 48  # inradius of the ground storey
R_UP = 50  # the jettied upper storey
R_YARD = 21  # the open yard
Z_JETTY = 11  # the jetty course between the storeys
Z_WALL = 20  # top of the walls
#: The ring roof: outer eaves, ridge ring and inner eaves (octagonal radii) and the eaves' height over the wall top.
R_EAVES, R_RIDGE, R_INNER = 52.5, 37.5, 27
#: Posts round the octagon (sectors of the full turn).
POSTS = 48
SQRT2 = math.sqrt(2)


def ring_roof(v):
    """The steep ring roof over the galleries: eaves at r 52.5 (z 24), ridge ring at r 37.5 (z 44), inner eaves at r 27; the yard stays open."""
    for x, y in H.octagon_cells(CX, CY, R_INNER, R_EAVES + 0.5):
        r = H.oct_r(x, y, CX, CY)
        if r >= R_RIDGE:
            top = Z_WALL + 4 + (R_EAVES - r) * 1.3
        else:
            top = Z_WALL + 4 + (R_EAVES - R_RIDGE) * 1.3 - (R_RIDGE - r) * 0.8
        top = int(round(top))
        course = int((R_EAVES - r) // 2) if r >= R_RIDGE else int((r - R_INNER) // 2)
        pair = FACETS[H.sector(x, y, CX, CY)]
        ridge = RIDGE_DARK if pair is DARK_TILE else RIDGE_SLATE
        m = ridge if R_RIDGE - 0.6 <= r <= R_RIDGE + 0.6 else pair[course % 2]
        # A rib of lighter timber on every hip (the facet boundaries) of the outer slope.
        a = (math.atan2(y + 0.5 - CY, x + 0.5 - CX) / (2 * math.pi) * 8 + 0.5) % 1.0
        if r >= R_RIDGE + 0.6 and (a < 0.04 or a > 0.96):
            m = HIP
        for z in range(top - 4, top + 1):
            v.set(x, y, z, m)
    # A drip course of dark timber along the outer eaves.
    for x, y in H.edge_cells(H.octagon_cells(CX, CY, -1, R_EAVES + 0.5)):
        z = int(round(Z_WALL + 4 + (R_EAVES - H.oct_r(x, y, CX, CY)) * 1.3)) - 4
        v.set(x, y, z, TIMBER_DARK)


def hall_walls(v, seed):
    """The octagonal hall: plaster ground storey with timber posts and a rail, a jetty course, a jettied upper storey with braces, a top plate."""
    ground = H.octagon_cells(CX, CY, -1, R)
    upper = H.octagon_cells(CX, CY, -1, R_UP)
    for x, y in ground:
        for z in range(1, Z_JETTY):
            v.set(x, y, z, PLASTER if z > 2 else STONE_DARK)
    ring_g = set(H.edge_cells(ground))
    ring_u = set(H.edge_cells(upper))
    for x, y in ring_g:
        a = (math.atan2(y + 0.5 - CY, x + 0.5 - CX) / (2 * math.pi)) * POSTS % 1.0
        for z in range(3, Z_JETTY):
            if a < 0.2:
                v.set(x, y, z, TIMBER)  # a post every 7.5 degrees
            elif 0.4 < a < 0.75 and 5 <= z <= 8:
                v.set(x, y, z, WINDOW)
            elif z in (3, 9):
                v.set(x, y, z, TIMBER_DARK)  # sill and head rails
    for x, y in upper:
        v.set(x, y, Z_JETTY, TIMBER_DARK)  # the jetty course
        for z in range(Z_JETTY + 1, Z_WALL):
            v.set(x, y, z, PLASTER)
    for x, y in ring_u:
        a = (math.atan2(y + 0.5 - CY, x + 0.5 - CX) / (2 * math.pi)) * POSTS % 1.0
        for z in range(Z_JETTY + 1, Z_WALL):
            if a < 0.2:
                v.set(x, y, z, TIMBER)
            elif 0.35 < a < 0.7 and 13 <= z <= 17:
                v.set(x, y, z, WINDOW if z > 13 else TIMBER_LIGHT)
            elif z == 15 and (a < 0.3 or a > 0.75):
                v.set(x, y, z, TIMBER_DARK)  # the rail between the windows
        v.set(x, y, Z_WALL, TIMBER_DARK)
    # The yard floor.
    for x, y in H.octagon_cells(CX, CY, -1, R_YARD):
        v.set(x, y, 1, mat("road-dirt", 1.0))


def stage(v):
    """The raised stage in the yard against the back, with a canopy ("heavens") on two posts."""
    for x in range(51, 84):
        for y in range(51, 72):
            v.set(x, y, 2, TIMBER_LIGHT)
            v.set(x, y, 3, TIMBER_LIGHT)
            v.set(x, y, 4, P.shade_of(mat("timber", 1.62), 1.0 if (y // 2) % 2 else 0.9))
    for x in (51, 82):
        for y in (51, 70):
            v.box(x, y, 1, x + 2, y + 2, 4, TIMBER_DARK)
    v.box(51, 71, 5, 84, 72, 6, TIMBER_DARK)  # the stage's front rail
    for x in range(51, 84, 3):
        v.set(x, 71, 6, TIMBER)
    for x in range(52, 83, 2):  # the stage front's boarding
        v.box(x, 72, 1, x + 1, 73, 4, TIMBER_DARK)
    # The heavens: two painted posts, a beam and a little roof over the back half.
    for x in (52, 81):
        v.box(x, 52, 5, x + 2, 54, 21, TIMBER)
        v.set(x, 54, 20, mat("ochre"))
    v.box(51, 52, 21, 84, 54, 22, TIMBER_DARK)
    v.box(49, 51, 22, 86, 62, 23, mat("dye-blue", 0.9))
    for x in range(49, 86, 3):  # a fringed valance
        v.set(x, 61, 21, mat("ochre"))
    # The backcloth.
    v.box(53, 51, 5, 82, 52, 20, mat("dye-blue", 0.75))


def stage_house(v, seed):
    """The taller stage house behind the hall: heavy-framed walls, a gable roof of brown slate and a roof lantern."""
    x0, x1, y0, y1 = 39, 93, 4, 39
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 3, STONE_DARK)
    W.heavy_frame(v, x0, y0, x1, y1, 3, 30, PLASTER, TIMBER, bay=9, rail=16)
    r = P.roof(v, x0, x1, y0, y1, 30, "tiles", along="x", rise=1.3, m=BROWN_SLATE[0], ridge=RIDGE_SLATE, gable=PLASTER, seed=seed, shades=(1.06, 0.92))
    W.roof_core(v, r, PLASTER, BROWN_SLATE[0])
    f = P.Face(v, "x-", x0)
    for a in (11, 23):
        P.casement(f, a, 17, 3, 6, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    fb = P.Face(v, "y-", y0)
    for a in (46, 56, 75, 85):
        P.casement(fb, a, 17, 3, 6, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.barn_gate(fb, 61, 3, 10, 12)
    H.cupola(v, 66, 21, r.ridge_z + 1, size=12, h=12, roof=TERRA[0], ridge=RIDGE_TERRA, flag=True)


def porch(v, seed):
    """The gabled entrance porch: a timber-framed box on posts with a terracotta gable roof and the big double door behind it."""
    f = P.Face(v, "y+", CY + R - 1)
    P.entrance(f, 59, 3, 14, 12, leaf=TIMBER, frame=TIMBER_DARK, step=STONE_DARK, lintel=TIMBER_DARK, hinges=True, steps=3)
    x0, x1, y0, y1 = 51, 81, 132, 147
    for px in (x0, x1 - 2):
        for py in (y0, y1 - 2):
            v.box(px, py, 1, px + 2, py + 2, 15, TIMBER)
            v.box(px - 1, py - 1, 1, px + 3, py + 3, 2, STONE_DARK)
    v.box(x0, y0, 14, x1, y1, 15, TIMBER_DARK)
    for px in (x0, x1 - 2):  # knee braces under the side beams
        for k in range(3):
            v.set(px + (2 + k if px == x0 else -1 - k), y1 - 1, 13 - k, TIMBER)
    r = P.roof(v, x0 - 1, x1 + 1, y0 - 1, y1 + 1, 15, "tiles", along="y", rise=1.2, m=TERRA[0], ridge=RIDGE_TERRA, gable=PLASTER, seed=seed, shades=(1.06, 0.92))
    W.roof_core(v, r, PLASTER, TERRA[0])


def ticket_booth(v, x, y):
    """A small timber booth with a shuttered window, a counter and a terracotta roof."""
    P.fill(v, x, y, x + 13, y + 10, 1, 2, STONE_DARK)
    P.half_timber(v, x, y, x + 13, y + 10, 2, 12, PLASTER, TIMBER, spacing=5, braces=False)
    P.roof(v, x, x + 13, y, y + 10, 12, "tiles", along="x", rise=1.0, m=TERRA[1], ridge=RIDGE_TERRA, gable=PLASTER)
    f = P.Face(v, "y+", y + 9)
    P.casement(f, x + 2, 4, 6, 4, frame=TIMBER_DARK, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    v.box(x, y + 10, 4, x + 13, y + 11, 5, TIMBER_LIGHT)  # the counter
    P.entrance(P.Face(v, "x-", x), y + 3, 2, 3, 7)


GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)


def build(ctx):
    v = ctx.vox()  # 132 × 168
    seed = 63
    P.yard(v, 0, 0, 132, 168, "grass", seed=seed)
    P.yard(v, 15, 132, 117, 168, "paved", seed=seed)
    P.path(v, [(x, y) for x in range(57, 75) for y in range(147, 168)], kind="paved")
    P.yard(v, 30, 114, 102, 132, "paved", seed=seed)
    stage_house(v, seed)
    hall_walls(v, seed)
    # Two tiers of galleries round the yard; the lower tier opens at the stage.
    opening = lambda x, y: 42 <= x < 90 and y < 73
    H.gallery_ring(v, CX, CY, R_YARD, 45, 7, h=9, every=8, skip=opening)
    H.gallery_ring(v, CX, CY, R_YARD, 45, 16, h=9, every=8, skip=opening)
    ring_roof(v)
    stage(v)
    porch(v, seed)
    # Banners on the roof ridge and flanking the porch.
    for x, y, c in ((CX - 37, CY, H.BANNER_BLUE), (CX + 37, CY, H.BANNER_OCHRE), (CX + 27, CY + 27, H.BANNER_BLUE), (CX - 27, CY + 27, H.BANNER_OCHRE)):
        H.banner_pole(v, x, y, 43, h=21, cloth=c, drop=10, width=6)
    H.banner_pole(v, 45, 138, 1, h=25, cloth=H.BANNER_BLUE, drop=13, width=6)
    H.banner_pole(v, 87, 138, 1, h=25, cloth=H.BANNER_OCHRE, drop=13, width=6)
    # Forecourt: the ticket booth, a well, lantern posts and broad trees.
    ticket_booth(v, 93, 135)
    P.well(v, 22, 150, roof_m=DARK_TILE[0])
    for x, y in ((39, 135), (81, 135), (30, 162), (102, 162), (54, 162), (78, 162)):
        H.lantern(v, x, y, 1, h=13)
    P.bench(v, 39, 156, 1, 9, along="x")
    P.bench(v, 84, 156, 1, 9, along="x")
    for x, y in ((9, 30), (120, 30), (8, 117), (123, 117), (6, 150)):
        P.fruit_tree(v, x, y, 1, seed=seed + x + y, crown=CROWN, fruit=None, trunk=6, r=4)
    P.scatter(v, 0, 0, 132, 168, 0.006, seed=seed, kinds=("tuft", "flower"))
    v.anchor("door", 66, 168, 0)
    return P.colour_jitter(v, seed=seed)
