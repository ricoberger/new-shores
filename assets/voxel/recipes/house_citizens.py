"""
Citizen house (3 × 3; D-057 §3): clearly richer than the settler cottage —
two storeys: a coursed-stone ground floor with dressed quoins on a proud
plinth, a jettied timber-framed upper storey (joist ends under it), tiled
roofs with ridge tiles and a dark eave, dormers, brick chimneys with two
pots; framed windows with dressed surrounds below and painted shutters and
flower boxes above, panelled doors with a lintel and two steps, paved
fronts. Three variants: townhouse with dormers, gable-fronted house with
a balcony, shop with a shop front, awning and goods.
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, DYE_BLUE, FLOWER, OCHRE, PLASTER, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT

VARIANTS = 3

# Jettied fronts sit on a lite block boundary (upper-storey planes at
# x ≡ 3 / y ≡ 0 (mod 4) on the −x / +y sides): shutters, sills and flower
# boxes then share a lite block with the wall and the lite keeps the
# infill colour instead of turning timber-brown.

DRESSED = P.DRESSED
RED_DOOR = mat("terracotta", 0.8)
GREEN = mat("grass-b", 0.8)


def ground_windows(f, spots, z=3, w=2):
    for a in spots:
        P.casement(f, a, z, w, 3, frame=DRESSED, sill=DRESSED, lintel=DRESSED)


def upper_windows(f, spots, z, shutters, box=True):
    """Upper-storey casements between the studs: a pale sill, painted shutters, flower boxes."""
    for a in spots:
        P.casement(f, a, z, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=shutters, box=FLOWER if box else None)


def build(ctx):
    v = ctx.vox()
    k = ctx.variant
    seed = 31 + k
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    P.yard(v, 1, 17, 23, 24, "paved", seed=seed)
    if k == 0:
        # Townhouse along the street: dormers, blue shutters, flower boxes.
        b = P.building(v, 4, 7, 20, 16, "citizen", along="x", upper=OCHRE, seed=seed, spacing=5, braces=("x-", "x+"))
        f, F = b.face("y+"), b.face("y+", upper=True)
        P.entrance(f, 11, 2, 3, 5, leaf=DYE_BLUE, frame=DRESSED, lintel=DRESSED, steps=2)
        ground_windows(f, (6, 16))
        upper_windows(F, (5, 11, 17), 11, DYE_BLUE)
        upper_windows(b.face("x-", upper=True), (8, 12), 11, DYE_BLUE, box=False)
        upper_windows(b.face("x+", upper=True), (8, 12), 11, DYE_BLUE, box=False)
        P.dormer_on(v, b.roof, 7, 11, "y+", wall=OCHRE)
        P.dormer_on(v, b.roof, 13, 17, "y+", wall=OCHRE)
        P.roof_chimney(v, b.roof, 17, 8, above=3, brick=True, pots=2)
        P.lamp_post(v, 9, 18)
        P.bench(v, 15, 18, 1, 4)
        P.flower_bed(v, 1, 18, 6, 20, seed=seed)
        P.shrub(v, 21, 4, 1, 2, seed=seed)
        P.cask(v, 21, 13, 1, h=4)
    elif k == 1:
        # Gable to the street, a balcony over the door, a well in the yard.
        b = P.building(v, 4, 4, 16, 16, "citizen", along="y", upper=PLASTER, seed=seed, spacing=4, rise=1.25)
        f, F = b.face("y+"), b.face("y+", upper=True)
        P.entrance(f, 6, 2, 3, 5, leaf=RED_DOOR, frame=DRESSED, lintel=DRESSED, steps=2)
        ground_windows(f, (11,), w=3)
        upper_windows(F, (5, 12), 11, GREEN, box=False)
        P.casement(F, 9, 17, 2, 2, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT)
        for side in ("x-", "x+"):
            ground_windows(b.face(side), (9,))
            upper_windows(b.face(side, upper=True), (6, 12), 11, GREEN, box=False)
        # Balcony: plank floor on brackets with a railing and flower pots.
        for x in range(4, 11):
            v.set(x, 17, 9, TIMBER_LIGHT)
            v.set(x, 18, 9, TIMBER_LIGHT)
            v.set(x, 18, 10, TIMBER if x % 2 == 0 else None)
            v.set(x, 18, 11, TIMBER_DARK)
        v.set(4, 17, 8, TIMBER_DARK)
        v.set(10, 17, 8, TIMBER_DARK)
        v.set(5, 18, 12, FLOWER)
        v.set(9, 18, 12, FLOWER)
        P.roof_chimney(v, b.roof, 12, 7, above=3, brick=True, pots=2)
        P.well(v, 20, 9, roof_m=TERRACOTTA)
        P.flower_bed(v, 19, 18, 23, 21, seed=seed)
        P.shrub(v, 21, 14, 1, 2, seed=seed)
        P.lamp_post(v, 4, 18)
    else:
        # Shop: a hipped roof, a shop window with an awning, goods out front.
        b = P.building(v, 4, 7, 20, 16, "citizen", along="x", upper=mat("ochre", 1.06), seed=seed, spacing=5, hip=True)
        f, F = b.face("y+"), b.face("y+", upper=True)
        P.entrance(f, 15, 2, 3, 5, leaf=TIMBER, frame=DRESSED, lintel=DRESSED, steps=1)
        P.casement(f, 6, 3, 6, 3, frame=TIMBER_DARK, sill=TIMBER_DARK)
        stripes = (CANVAS, mat("terracotta", 1.05))
        for x in range(4, 14):
            for d in range(3):
                v.set(x, 16 + d, 7 - d // 2, stripes[(x // 2) % 2])
        P.trade_sign(f, 13, 7, WHEAT)
        upper_windows(F, (6, 13), 11, mat("terracotta", 0.85))
        upper_windows(b.face("x+", upper=True), (9,), 11, mat("terracotta", 0.85), box=False)
        upper_windows(b.face("x-", upper=True), (9,), 11, mat("terracotta", 0.85))
        upper_windows(b.face("y-", upper=True), (7, 14), 11, mat("terracotta", 0.85), box=False)
        ground_windows(b.face("x-"), (10,))
        ground_windows(b.face("y-"), (8, 14))
        P.flower_bed(v, 4, 2, 12, 5, seed=seed)
        P.roof_chimney(v, b.roof, 7, 9, above=3, brick=True, pots=2)
        P.box_crate(v, 5, 19, 1, contents=mat("orchard-mark"))
        P.box_crate(v, 8, 19, 1, contents=mat("hemp", 1.2))
        P.sacks(v, 11, 19, 1, n=2, m=CANVAS)
        P.cask(v, 19, 18, 1, h=4)
        P.cask(v, 21, 18, 1)
        P.bench(v, 19, 4, 1, 3)
        P.handcart(v, 1, 3, 1, along="y", load=WHEAT)
    P.scatter(v, 0, 0, 24, 17, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)
