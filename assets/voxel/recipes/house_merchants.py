"""
Merchant house (3 × 3, 12 voxels per tile; V7 rework after the Anno 1404
merchant houses): a dense cluster of tall gabled ranges under steep dark
burgundy tile roofs (`tile-dark`), each a coursed-rubble ground floor, a
jettied storey of heavy timber framing with whitewashed panels and
shuttered two-light casements, chimneys and dormers, on cobbles over the
whole plot. Three massings: a crow-stepped stone-gabled range with an
arcaded wing and a low gabled annex (merchant_house); three gables side
by side, the long one with an arcade and dormers (merchant_house_3 / _5);
a courtyard house, a gate house between two wings (merchant_house_4).
"""

from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import DYE_BLUE, PLASTER, PLASTER_WARM, STONE, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VARIANTS = 3
VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

DRESSED = P.DRESSED
ROOF = mat("tile-dark")
RIDGE = mat("tile-dark", 0.62)  # a dark ridge and verge, two strong tile shades per course
SHADES = (1.2, 0.84)
VERGE = 0.62
COPING = P.DRESSED
FRAME = mat("timber", 0.62)
GREEN = mat("grass-b", 0.8)
OXBLOOD = mat("terracotta", 0.62)
G, T = 11, 22  # top of the stone ground floor, top of the framed storey
RISE = 1.8


def ground_windows(f, spots, z=4, w=3, h=5):
    for a in spots:
        P.casement(f, a, z, w, h, frame=DRESSED, sill=DRESSED, lintel=DRESSED, bars=False)
        f.put(a + w // 2, z, DRESSED, out=-1)


def door(f, a, z=2, leaf=TIMBER, **kw):
    P.entrance(f, a, z, 4, 8, leaf=leaf, frame=DRESSED, lintel=DRESSED, steps=1, **kw)


def loggia(b, side, a0, a1, pier=TIMBER, bay=5):
    """An open arcade over the ground floor of `side`, piers in `pier`, the upper storey carried over it."""
    Q.arcade(b.face(side), a0, a1, 2, 8, bay=bay, pier=2, depth=3, back=shade(PLASTER, 0.6), pier_m=pier)


def dormers(v, r, spans, side, wall=PLASTER):
    """Tiled dormers on one slope of Roof r (a0, a1 along the eaves)."""
    for a0, a1 in spans:
        W.dormer(v, r, a0, a1, side, wall=wall, frame=TIMBER_LIGHT, course=3, h=6, m=ROOF, ridge=RIDGE, shades=SHADES, verge=VERGE)


def shade(m, k=0.82):
    from nsvoxel.grid import shade_of

    return shade_of(m, k)


def wing(v, x0, y0, x1, y1, seed, along="x", h=9, roof=ROOF):
    """A low stone wing: rubble walls to h under its own tiled gable roof; returns the Roof."""
    P.plinth(v, x0, y0, x1, y1, 1, STONE_LIGHT, out=0)
    W.coursed_stone_2(v, x0, y0, x1, y1, 2, h, STONE, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, h)
    r = P.roof(v, x0 - 1, x1 + 1, y0 - 1, y1 + 1, h, "tiles", along=along, rise=RISE, ov=1, gable=PLASTER, seed=seed, m=roof, ridge=RIDGE, shades=SHADES, verge=VERGE)
    W.roof_core(v, r, PLASTER, roof)
    return r


def build(ctx):
    v = ctx.vox()  # 36 × 36
    k = ctx.variant
    seed = 41 + k
    P.yard(v, 0, 0, 36, 36, "paved", seed=seed)  # merchants and patricians stand on cobbles over the whole plot
    kw = dict(ground=G, top=T, rise=RISE, roof=ROOF, ridge=RIDGE, shades=SHADES, verge=VERGE, seed=seed)
    if k == 0:
        # Two gables side by side: a stone-arcaded range on the west, a plastered range on the east, both with crow-stepped stone gables.
        a = W.framed_house(v, 3, 8, 19, 33, "y", infill=PLASTER, frame=FRAME, windows={"x-": (0,), "y+": (0,)}, shutters=DYE_BLUE, **{**kw, "gable_jetty": False})
        W.stepped_gable(v, a.roof, "y+", m=STONE, coping=COPING)
        W.stepped_gable(v, a.roof, "y-", m=STONE, coping=COPING)
        loggia(a, "y+", 4, 18, pier=STONE_LIGHT, bay=4)
        W.stack(v, 7, 10, 1, a.roof.ridge_z + 4, 3, 3)
        b = W.framed_house(v, 20, 3, 34, 27, "y", infill=PLASTER_WARM, frame=FRAME, shutters=GREEN, **{**kw, "gable_jetty": False, "seed": seed + 1})
        W.stepped_gable(v, b.roof, "y+", m=STONE, coping=COPING)
        W.stepped_gable(v, b.roof, "y-", m=STONE, coping=COPING)
        W.stack(v, 27, 6, 1, b.roof.ridge_z + 4, 3, 3)
    elif k == 1:
        # The long gable on the west with an arcade on its side and dormers, a shorter gable beside it, a lower bay in front.
        a = W.framed_house(v, 3, 6, 17, 32, "y", infill=PLASTER, frame=FRAME, windows={"x-": (0,)}, shutters=GREEN, **{**kw, "seed": seed})
        loggia(a, "x-", 8, 24, pier=TIMBER)
        door(a.face("y+"), 5, leaf=OXBLOOD)
        dormers(v, a.roof, ((14, 20),), "x-")
        W.stack(v, 9, 8, 1, a.roof.ridge_z + 4, 3, 3)
        b = W.framed_house(v, 18, 3, 33, 21, "y", infill=PLASTER_WARM, frame=TIMBER_DARK, windows={"y+": (0,)}, shutters=DYE_BLUE, **{**kw, "seed": seed + 1, "top": T - 6})
        door(b.face("y+"), 22, leaf=TIMBER)
        W.stack(v, 27, 6, 1, b.roof.ridge_z + 4, 3, 3)
    else:
        # A gate house gabled to the front (arched cart door, stone ground floor) in front of a wider range along x.
        a = W.framed_house(v, 3, 3, 31, 15, "x", infill=PLASTER, frame=FRAME, windows={}, shutters=DYE_BLUE, **{**kw, "top": T - 2})
        dormers(v, a.roof, ((5, 11),), "y+")
        W.stack(v, 27, 5, 1, a.roof.ridge_z + 4, 3, 3)
        g = W.framed_house(v, 11, 16, 25, 33, "y", infill=PLASTER_WARM, frame=TIMBER_DARK, windows={"x-": (0,), "y+": (0,)}, shutters=GREEN, **{**kw, "seed": seed + 1, "top": T, "rise": 1.6, "gable_jetty": False})
        W.stepped_gable(v, g.roof, "y+", m=STONE, coping=COPING)
        W.stepped_gable(v, g.roof, "y-", m=STONE, coping=COPING)
        door(g.face("y+"), 15, leaf=TIMBER, arch=True)
        ground_windows(g.face("x-"), (22,))
        W.stack(v, 20, 20, 1, g.roof.ridge_z + 4, 3, 3)
    P.scatter(v, 0, 0, 36, 36, 0.004, seed=seed)
    return P.colour_jitter(v, seed=seed)
