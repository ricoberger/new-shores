"""
Warehouse (6 × 6, four levels; D-057 §3, D-065; V7 rework after the Anno 1404
market buildings): 1 a weathered plank barn under heavy dark thatch, a
wide gate in the gable end with a hoist beam out of the apex and an open
thatched lean-to shed with goods on the side; 2 a half-timbered hall with
a rubble ground floor and an arched gate under terracotta tile, a taller
cross wing with a gallery and hoist; 3 the same on a stone ground floor
with round arcades, a third wing and dark tile; 4 a large dressed-stone
brick Speicher with light stone dressings, a round-arched arcade, stepped
gables with two finials, dormers and a steep slate roof. Brick (D-064 §3) is
the warehouse role: the ground floor of level 3 and all of level 4. Dirt yard at levels 1–2, cobbles at 3–4.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import CANVAS, IRON, PLASTER, PLANK, SLATE, STONE, STONE_DARK, STONE_LIGHT, TERRACOTTA, THATCH_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
LEVELS = 4
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BOARDS = mat("timber", 0.85)
PLINTH = mat("stone", 1.1)
BASE = 2
TERRA_RIDGE = mat("terracotta", 0.66)
TILE = mat("tile-dark")
TILE_RIDGE = mat("tile-dark", 0.62)
SLATE_RIDGE = mat("slate", 0.6)
SHADE_TILE = (1.2, 0.84)
SHADE_SLATE = (1.18, 0.8)
BRICK = mat("brick")
CREAM = mat("plaster", 0.95)
BRICK_SHADES = (0.9, 1.0, 1.08)


def level1(v, seed):
    thatch = mat("thatch", 0.8)  # the weathered thatch of the settlers' house v0
    x0, y0, x1, y1 = 22, 8, 52, 50
    top = 14
    P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
    P.fill(v, x0, y0, x1, y1, 1, BASE, PLINTH)
    P.boarded(v, x0, y0, x1, y1, BASE, top, m=BOARDS, batten=TIMBER, every=4)
    r = P.roof(v, x0, x1, y0, y1, top, "thatch", along="y", rise=2.0, ov=2, gable=BOARDS, seed=seed, m=thatch)
    W.thatch_finish(v, r, seed)
    f = P.Face(v, "y+", y1 - 1)
    W.gate(f, 31, 12, 10)
    V.hoist(f, 37, r.ridge_z - 5, length=9, rope=8, load=TIMBER_LIGHT)
    for a in (27, 45):
        P.casement(f, a, 7, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    wf = P.Face(v, "x-", x0)
    for a in (12, 18):
        P.casement(wf, a, 6, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    for x in range(x0 + 4, x1 - 2, 6):  # back wall relief
        v.box(x, y0 - 1, 3, x + 1, y0, 13, TIMBER_DARK)
    for x in range(x0 + 1, x1 - 1):
        v.set(x, y0 - 1, 9, TIMBER_DARK)
    # The open lean-to shed against the west wall.
    sx0, sx1, sy0, sy1 = 8, 22, 24, 46
    P.lean_to(v, sx0, sx1, sy0, sy1, 9, "thatch", down="x-", ov=1, m=mat("thatch", 1.1), posts=True, seed=seed)
    W.thatch_finish(v, W.roof_span(sx0, sx1, sy0, sy1, 9, 1, "y"), seed + 4, eave=False)
    W.store_goods(v, [(10, 27), (14, 27), (18, 27), (10, 33), (14, 33), (18, 33), (11, 39), (16, 39)])
    P.woodpile(v, 56, 12, 1, length=8, along="y", rows=3)
    W.store_goods(v, [(30, 56), (36, 58), (44, 56), (52, 54)])
    P.handcart(v, 12, 56, 1, along="x", load=CANVAS)


def stone_wing(v, x0, y0, x1, y1, along, ground, top, roof, ridge, shades, verge, seed, kind="tiles", rise=1.4, windows=None, shutters=None, stone=STONE, wall_shades=W.RUBBLE):
    return W.framed_house(v, x0, y0, x1, y1, along, ground=ground, top=top, roof=roof, ridge=ridge, shades=shades, verge=verge, kind=kind, rise=rise, seed=seed, windows=windows, shutters=shutters, stone=stone, wall_shades=wall_shades, plain=("y-",))


def level2(v, seed):
    a = stone_wing(v, 6, 28, 44, 56, "x", 12, 24, TERRACOTTA, TERRA_RIDGE, SHADE_TILE, 0.66, seed, windows={"y+": (0, 2), "x-": (1,)}, shutters=mat("dye-blue"))
    W.gate(a.face("y+"), 19, 10, 10, arch=True)
    b = stone_wing(v, 46, 8, 66, 56, "y", 12, 27, TERRACOTTA, TERRA_RIDGE, SHADE_TILE, 0.66, seed + 1, rise=1.5, windows={"y+": (0,), "x-": (0, 2)}, shutters=mat("dye-green") if False else mat("dye-blue"))
    W.gate(b.face("y+"), 52, 8, 9, arch=True)
    W.loft_door(v, b.upper[3] - 1, 54, 14, frame=P.DRESSED, beam_z=27 + 4, rope=11)
    V.balcony(a.face("y+"), 8, 17, 13, depth=2)
    W.dormer(v, a.roof, 10, 16, "y+", wall=PLASTER, frame=TIMBER_LIGHT, course=3, h=6, m=TERRACOTTA, ridge=TERRA_RIDGE, shades=SHADE_TILE, verge=0.66)
    W.dormer(v, a.roof, 30, 36, "y+", wall=PLASTER, frame=TIMBER_LIGHT, course=3, h=6, m=TERRACOTTA, ridge=TERRA_RIDGE, shades=SHADE_TILE, verge=0.66)
    W.stack(v, 12, 36, a.roof.ridge_z - 2, a.roof.ridge_z + 4, 3, 3)
    W.store_goods(v, [(8, 61), (30, 62), (50, 62)])
    P.handcart(v, 20, 66, 1, along="x", load=CANVAS)


def level3(v, seed):
    kw = dict(roof=TILE, ridge=TILE_RIDGE, shades=SHADE_TILE, verge=0.62, stone=mat("stone", 0.95), shutters=mat("dye-blue"))
    a = stone_wing(v, 20, 28, 48, 56, "x", 12, 24, **kw, seed=seed, windows={"y+": (0, 2)})
    b = stone_wing(v, 50, 8, 68, 56, "y", 12, 28, **kw, seed=seed + 1, rise=1.5, windows={"y+": (), "x-": (0, 2)})
    c = stone_wing(v, 2, 12, 18, 56, "y", 12, 25, **kw, seed=seed + 2, rise=1.5, windows={"y+": (), "x+": (0, 2)})
    back = shade_of(mat("stone", 0.95), 0.5)
    W.gate(a.face("y+"), 29, 10, 10, arch=True)
    W.round_arcade(b.face("y+"), 50, 68, 2, 9, bay=6, pier=2, depth=3, back=back, pier_m=BRICK, arch_m=BRICK)
    W.round_arcade(c.face("y+"), 2, 18, 2, 9, bay=5, pier=2, depth=3, back=back, pier_m=BRICK, arch_m=BRICK)
    W.loft_door(v, b.upper[3] - 1, 57, 14, frame=P.DRESSED, beam_z=28 + 4, rope=11)
    W.loft_door(v, c.upper[3] - 1, 8, 14, frame=P.DRESSED, beam_z=25 + 4, rope=11)
    for x0 in (24, 36):
        W.dormer(v, a.roof, x0, x0 + 6, "y+", wall=PLASTER, frame=Q.DRESSED, course=3, h=6, m=TILE, ridge=TILE_RIDGE, shades=SHADE_TILE, verge=0.62)
    W.stack(v, 30, 34, a.roof.ridge_z - 2, a.roof.ridge_z + 4, 3, 3)
    W.store_goods(v, [(52, 60), (4, 60), (22, 62), (36, 62)])


def level4(v, seed):
    """A brick Speicher: brick walls with light stone dressings, a front gable with a loading door and hoist, stepped gables, slate."""
    x0, y0, x1, y1 = 14, 8, 58, 64
    cx = (x0 + x1) // 2
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
    floors = (2, 12, 20)
    top = 26
    Q.ashlar(v, x0, y0, x1, y1, 2, floors[1], BRICK, shade_of(BRICK, 0.88))  # brick ground floor
    P.fill(v, x0, y0, x1, y1, floors[1], top, CREAM)  # cream plaster floors 2 and 3
    P.dressed_quoins(v, x0, y0, x1, y1, 2, top)
    Q.string_course(v, x0, y0, x1, y1, floors[1])
    r = P.roof(v, x0, x1, y0, y1, top, "slate", along="y", rise=0.9, ov=1, gable=BRICK, m=SLATE, ridge=SLATE_RIDGE, shades=SHADE_SLATE, verge=0.66)
    W.roof_core(v, r, BRICK, SLATE)
    ff, fx = P.Face(v, "y+", y1 - 1), P.Face(v, "x-", x0)
    back = shade_of(BRICK, 0.55)
    W.round_arcade(ff, x0, x1, 2, 9, bay=6, pier=2, depth=3, back=back, pier_m=BRICK, arch_m=Q.DRESSED)
    W.round_arcade(fx, y0, y1, 2, 9, bay=6, pier=2, depth=3, back=back, pier_m=BRICK, arch_m=Q.DRESSED)
    for z, h in ((13, 5), (21, 4)):
        for a in range(x0 + 5, x1 - 6, 8):
            if abs(a + 2 - cx) > 6:
                W.arched_window(ff, a, z, 5, h)
        for a in range(y0 + 5, y1 - 6, 8):
            W.arched_window(fx, a, z, 5, h)
    W.loft_door(v, y1 - 1, cx - 2, 13, frame=Q.DRESSED, beam_z=top + 4, rope=13, length=9)
    W.stepped_gable(v, r, "y+", m=BRICK, coping=Q.DRESSED, balls="apex")
    W.stepped_gable(v, r, "y-", m=BRICK, coping=Q.DRESSED, balls="apex")
    for a in (18, 34, 50):
        W.dormer(v, r, a, a + 6, "x-", wall=CREAM, frame=Q.DRESSED, course=3, h=6, m=SLATE, ridge=SLATE_RIDGE, shades=SHADE_SLATE, verge=0.66, kind="slate")
    P.roof_chimney(v, r, x1 - 10, y0 + 14, above=3, brick=True, pots=2)
    W.store_goods(v, [(16, 68), (30, 69), (46, 68)])
    W.store_goods(v, [(4, 20), (4, 40)])


def build(ctx):
    v = ctx.vox()  # 72 × 72
    lv = ctx.level
    seed = 60 + lv
    P.yard(v, 0, 0, 72, 72, "dirt" if lv <= 2 else "paved", seed=seed)
    {1: level1, 2: level2, 3: level3, 4: level4}[lv](v, seed)
    v.anchor("cart", 34, 68, 1)
    P.tie_floating(v)
    return P.colour_jitter(v, seed=seed)
