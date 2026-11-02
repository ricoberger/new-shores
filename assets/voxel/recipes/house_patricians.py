"""
Patrician house (3 × 3, 12 voxels per tile; V7 rework after the Anno 1404
nobleman houses): three storeys with a dark dressed-ashlar ground floor
under cream plaster upper floors, a round-arched arcade, tall two-light
arched windows with light surrounds and dark glass, crow-stepped gables
with ball finials, a volute-like foot and a round window in the gable field,
an oriel, a turret with a steep slate cone, brick-red chimneys and steep
dark slate roofs with light course lines and a dark ridge, on cobbles over
the whole plot. Three massings: a long stepped-gable range with an arcade
and a taller range behind it (Nobleman_house_2/3); two gables with a turret
between them and an oriel (Nobleman_house_5); an L with an arcaded wing, a
corner turret and dormers (Nobleman_house_4).
"""

from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import PLASTER, SLATE

VARIANTS = 3
VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

ROOF = SLATE
RIDGE = mat("slate", 0.6)  # a dark ridge and verge, light course lines
SHADES = (1.18, 0.8)
VERGE = 0.66
ASHLAR = mat("stone", 0.8)  # the dark dressed ground floor
PIER = mat("stone", 0.9)
CREAM = mat("plaster", 0.95)
SAND = mat("plaster", 0.84)
STOREYS = (9, 7, 7)


def windows(f, spots, z, h=5, w=5, **kw):
    """A row of tall two-light arched windows with light surrounds and dark glass."""
    for a in spots:
        W.arched_window(f, a, z, w, h, **kw)


def both(b, side, spots):
    """A window row on the first and a shorter one on the second upper floor of `side`."""
    windows(b.face(side), spots, 12, h=5)
    windows(b.face(side), spots, 19, h=4)


def ground(b, side, spots):
    """Small arched windows in the ashlar ground floor."""
    for a in spots:
        W.arched_window(b.face(side), a, 4, 3, 5, mullion=False)


def arcade(b, side, a0, a1, bay=5):
    W.round_arcade(b.face(side), a0, a1, 2, 8, bay=bay, pier=2, depth=3, pier_m=PIER)


def gable(v, b, side, balls=True, oculus=True):
    """A crow-stepped gable in ashlar with ball finials, a volute-like foot and a round window."""
    W.stepped_gable(v, b.roof, side, m=Q.ASHLAR, balls=balls, foot=1)
    if oculus:
        r = b.roof
        if side in ("x-", "x+"):
            f = P.Face(v, side, r.x0 if side == "x-" else r.x1 - 1)
            W.round_window(f, (r.y0 + r.y1) // 2, r.z + 4, r=2)
        else:
            f = P.Face(v, side, r.y0 if side == "y-" else r.y1 - 1)
            W.round_window(f, (r.x0 + r.x1) // 2, r.z + 4, r=2)


def dormer(v, r, a0, a1, side="y+"):
    W.dormer(v, r, a0, a1, side, wall=CREAM, frame=Q.DRESSED, course=3, h=6, m=ROOF, ridge=RIDGE, shades=SHADES, verge=VERGE, kind="slate")


def turret(v, x0, y0, x1, y1, z0, z1, seed):
    """A turret of cream plaster on an ashlar foot under a steep slate cone with a finial."""
    Q.ashlar(v, x0, y0, x1, y1, 2, z0, ASHLAR, mat("stone", 0.73))
    Q.tower(v, x0, y0, x1, y1, z0, z1, wall=CREAM, plaster=True, roof=ROOF, kind="slate", rise=3.2, seed=seed, shades=SHADES, verge=VERGE, finial_h=4)


def build(ctx):
    v = ctx.vox()  # 36 × 36
    k = ctx.variant
    seed = 51 + k
    P.yard(v, 0, 0, 36, 36, "paved", seed=seed)  # merchants and patricians stand on cobbles over the whole plot
    kw = dict(roof=ROOF, ridge=RIDGE, shades=SHADES, verge=VERGE, base=ASHLAR, seed=seed)
    if k == 0:
        # A long range along x with a round-arched arcade, crow-stepped gables and a dormer; a taller range behind it.
        a = Q.palazzo(v, 3, 18, 29, 33, STOREYS, upper=CREAM, along="x", rise=1.4, **kw)
        gable(v, a, "x-")
        gable(v, a, "x+")
        arcade(a, "y+", 4, 28)
        both(a, "y+", (6, 15, 23))
        dormer(v, a.roof, 12, 18)
        b = Q.palazzo(v, 18, 3, 33, 18, STOREYS, upper=SAND, along="y", rise=1.4, **{**kw, "seed": seed + 1})
        both(b, "x+", (6,))
        ground(b, "x+", (7,))
        ground(a, "x+", (24,))
        P.roof_chimney(v, b.roof, 22, 8, above=3, brick=True, pots=2)
        P.roof_chimney(v, a.roof, 6, 22, above=3, brick=True, pots=2)
    elif k == 1:
        # A plastered gable on the west, a taller stepped-gable house on the east, a turret in front of the angle between them; an oriel over the arcade.
        a = Q.palazzo(v, 3, 4, 17, 32, STOREYS, upper=SAND, along="y", rise=1.4, **kw)
        arcade(a, "y+", 3, 17, bay=4)
        V.oriel(a.face("y+"), 6, 13, 5, 6, depth=2, wall=SAND, frame=Q.DRESSED, roof=ROOF, fascia=RIDGE)
        windows(a.face("y+"), (6,), 20, h=4)
        both(a, "x-", (9, 20))
        P.roof_chimney(v, a.roof, 7, 10, above=3, brick=True, pots=2)
        b = Q.palazzo(v, 18, 12, 33, 32, STOREYS, upper=CREAM, along="y", rise=1.4, **{**kw, "seed": seed + 1})
        gable(v, b, "y+")
        arcade(b, "y+", 19, 33, bay=4)
        both(b, "y+", (20,))
        both(b, "x+", (17, 25))
        ground(b, "x+", (16, 24))
        P.roof_chimney(v, b.roof, 26, 18, above=3, brick=True, pots=2)
        turret(v, 13, 28, 19, 34, 14, 33, seed)
        windows(P.Face(v, "y+", 33), (15,), 16, h=5, w=2, mullion=False)
    else:
        # An L: a range along x at the back and a wing to the front on the west with an arcade, a corner turret and dormers.
        a = Q.palazzo(v, 3, 3, 33, 17, STOREYS, upper=CREAM, along="x", rise=1.4, **kw)
        gable(v, a, "x+")
        both(a, "y-", (6, 15, 24))
        for x0 in (24, 29):
            dormer(v, a.roof, x0, x0 + 4)
        both(a, "y+", (22,))
        ground(a, "y+", (24,))
        b = Q.palazzo(v, 3, 18, 17, 33, STOREYS, upper=SAND, along="y", rise=1.4, **{**kw, "seed": seed + 1})
        gable(v, b, "y+")
        arcade(b, "y+", 3, 17, bay=4)
        both(b, "y+", (6,))
        both(b, "x-", (23,))
        turret(v, 17, 18, 23, 24, 14, 33, seed)
        windows(P.Face(v, "y+", 23), (19,), 16, h=5, w=2, mullion=False)
        P.roof_chimney(v, a.roof, 28, 6, above=3, brick=True, pots=2)
    P.scatter(v, 0, 0, 36, 36, 0.004, seed=seed)
    v.anchor("door", 18, 36, 0)
    return P.colour_jitter(v, seed=seed)
