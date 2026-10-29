"""
Merchant house (3 × 3; D-057 §3, tier 3): richer and taller than the
citizen house — a tall coursed-stone ground floor with dressed quoins and
a shop front, a jettied half-timbered upper storey, a steep roof with an
attic behind a jettied, framed gable, an oriel or a balcony, a hoist beam,
a shop sign in the colour of the goods sold, brick chimneys and a paved
front with goods. Variants differ in roof and timber colour and the
arrangement: v0 street-side eaves, an oriel over the door and two
dormers (red tiles, dark timber, ochre); v1 gable to the street with a
balcony, a loft door and hoist and a market lean-to (brown tiles, oak
timber, plaster); v2 crow-stepped stone gables, a side oriel, a wall dormer with a hoist
and a balcony (dark red-brown tiles, ox-blood timber,
warm plaster).
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import APPLE, CANVAS, DYE_BLUE, FLOWER, OCHRE, PLASTER, PLASTER_WARM, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT

VARIANTS = 3

DRESSED = P.DRESSED
#: Roof tiles per variant: red, brown, deep red-brown (all terracotta: warm).
ROOFS = (mat("terracotta"), mat("terracotta", 0.8), mat("terracotta", 0.66))
#: Timber per variant: dark, oak, ox-blood paint.
FRAMES = (TIMBER_DARK, TIMBER, mat("terracotta", 0.6))
SHUTTERS = (DYE_BLUE, mat("grass-b", 0.75), mat("ochre", 0.8))
CLOTH = mat("dye-blue", 1.1)


def ground_windows(f, spots, z=3, w=2, h=4):
    for a in spots:
        P.casement(f, a, z, w, h, frame=DRESSED, sill=DRESSED, lintel=DRESSED)


def upper_windows(f, spots, z, shutters, box=True, h=4):
    for a in spots:
        P.casement(f, a, z, 2, h, frame=None, sill=TIMBER_LIGHT, shutters=shutters, box=FLOWER if box else None)


def build(ctx):
    v = ctx.vox()
    k = ctx.variant
    seed = 41 + k
    roof, frame, shut = ROOFS[k], FRAMES[k], SHUTTERS[k]
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    P.yard(v, 0, 18, 24, 24, "paved", seed=seed)
    if k == 0:
        # Eaves to the street: a framed cross gable over an oriel, a shop front with an awning, two dormers.
        b = V.townhouse(v, 4, 6, 20, 16, "x", ground=10, top=19, infill=OCHRE, frame=frame, roof=roof, rise=1.5, seed=seed, spacing=4, braces=("x-", "x+"))
        f, F = b.face("y+"), b.face("y+", upper=True)
        V.shop_front(f, 5, 3, 6, 4, frame=TIMBER_DARK, goods=(APPLE, WHEAT, CANVAS))
        V.face_awning(f, 4, 12, 9, depth=3)
        P.entrance(f, 14, 2, 3, 6, leaf=DYE_BLUE, frame=DRESSED, lintel=DRESSED, steps=2)
        P.trade_sign(f, 18, 5, APPLE)
        V.cross_gable(v, b, 6, 18, OCHRE, frame=frame, roof=roof, rise=1.25)
        V.oriel(F, 9, 12, 6, 6, depth=2, wall=OCHRE, frame=frame, roof=roof)
        for a in (9, 14):
            P.casement(F, a, 21, 1, 3, frame=None, sill=TIMBER_LIGHT, bars=False)
        upper_windows(F, (4, 18), 12, shut)
        for side in ("x-", "x+"):
            ground_windows(b.face(side), (10,))
            upper_windows(b.face(side, upper=True), (7, 12), 12, shut, box=False)
        upper_windows(b.face("y-", upper=True), (6, 16), 12, shut, box=False)
        P.roof_chimney(v, b.roof, 16, 8, above=3, brick=True, pots=2)
        P.box_crate(v, 5, 19, 1, contents=APPLE)
        P.sacks(v, 8, 19, 1, n=1, m=CANVAS)
        P.lamp_post(v, 13, 19)
        P.flower_bed(v, 19, 19, 23, 21, seed=seed)
        P.shrub(v, 21, 3, 1, 2, seed=seed)
        P.woodpile(v, 3, 1, 1, length=6, rows=2)
    elif k == 1:
        # Gable to the street: a balcony, a loft door with a hoist, a market lean-to beside.
        b = V.townhouse(v, 4, 4, 16, 16, "y", ground=10, top=19, infill=PLASTER, frame=frame, roof=roof, rise=1.5, seed=seed, spacing=4)
        f, F = b.face("y+"), b.face("y+", upper=True)
        P.entrance(f, 5, 2, 3, 6, leaf=mat("terracotta", 0.75), frame=DRESSED, lintel=DRESSED, steps=2)
        V.shop_front(f, 10, 3, 4, 4, frame=TIMBER_DARK, goods=(CLOTH, CANVAS))
        V.balcony(F, 3, 17, 11, depth=2, rail=frame, flowers=FLOWER)
        P.entrance(F, 5, 12, 2, 5, leaf=TIMBER, frame=frame, step=None, hinges=False)
        upper_windows(F, (10, 13), 13, shut, box=False)
        # Loft door and hoist in the jettied gable.
        G = P.Face(v, "y+", b.roof.y1 - 1)
        P.entrance(G, 9, 21, 2, 3, leaf=TIMBER, frame=frame, step=None, hinges=False)
        V.hoist(G, 10, 25, length=3, rope=4, load=CANVAS)
        P.casement(G, 6, 20, 1, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
        P.casement(G, 13, 20, 1, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
        for side in ("x-", "x+"):
            ground_windows(b.face(side), (7, 12))
            upper_windows(b.face(side, upper=True), (5, 9, 13), 12, shut, box=False)
        P.roof_chimney(v, b.roof, 6, 6, above=3, brick=True, pots=2)
        # Market lean-to against the east wall: posts, a tiled lean-to, a counter with cloth.
        P.lean_to(v, 18, 23, 5, 16, 9, "tiles", down="x+", m=roof, posts=True)
        v.box(19, 9, 1, 22, 15, 3, TIMBER_LIGHT)
        for y in range(9, 15):
            v.set(19 + (y % 3), y, 3, (CLOTH, CANVAS, mat("terracotta", 1.1))[y % 3])
        P.cask(v, 20, 18, 1, h=4)
        P.sacks(v, 17, 20, 1, n=1, m=CANVAS)
        P.lamp_post(v, 2, 19)
        P.flower_bed(v, 1, 4, 3, 14, seed=seed)
        P.fruit_tree(v, 20, 2, 1, seed=seed, trunk=4, r=2.6, fruit=APPLE)
    else:
        # Crow-stepped stone gables, a side oriel, a balcony over the shop, a wall dormer with a hoist.
        b = V.townhouse(v, 4, 6, 20, 16, "x", ground=10, top=19, infill=PLASTER_WARM, frame=frame, roof=roof, rise=1.5, seed=seed, spacing=4, braces=False, gable_jetty=False)
        ux0, uy0, ux1, uy1 = b.upper
        for xs in ((ux0, ux0 + 1), (ux1 - 1, ux1)):
            P.coursed_stone(v, xs[0], uy0, xs[1], uy1, 11, 19, seed=seed, core=False)
        V.stepped_gable(v, b.roof, "x-")
        V.stepped_gable(v, b.roof, "x+")
        f, F = b.face("y+"), b.face("y+", upper=True)
        P.entrance(f, 6, 2, 3, 6, leaf=TIMBER, frame=DRESSED, lintel=DRESSED, steps=1)
        V.shop_front(f, 11, 3, 6, 4, frame=TIMBER_DARK, goods=(WHEAT, mat("hemp", 1.2), APPLE))
        V.balcony(F, 10, 19, 11, depth=2, rail=frame, flowers=FLOWER)
        upper_windows(F, (5,), 13, shut)
        P.entrance(F, 13, 12, 3, 5, leaf=TIMBER, frame=frame, step=None, hinges=False)
        V.oriel(b.face("x-", upper=True), 8, 12, 5, 6, depth=2, wall=PLASTER_WARM, frame=frame, roof=roof)
        ground_windows(b.face("x-"), (9,))
        for a in (7, 12):
            P.casement(b.face("x+", upper=True), a, 13, 2, 4, frame=DRESSED, sill=DRESSED, lintel=DRESSED)
        upper_windows(b.face("y-", upper=True), (7, 15), 13, shut, box=False)
        # Wall dormer: the front wall rises into the roof with a loft door and a hoist.
        V.cross_gable(v, b, 9, 15, PLASTER_WARM, frame=frame, roof=roof, rise=1.5)
        W = P.Face(v, "y+", uy1 - 1)
        P.entrance(W, 11, 19, 2, 3, leaf=TIMBER, frame=frame, step=None, hinges=False)
        V.hoist(W, 11, 23, length=2, rope=3)
        P.roof_chimney(v, b.roof, 6, 9, above=3, brick=True, pots=2)
        P.trade_sign(f, 20, 5, WHEAT)
        P.handcart(v, 1, 19, 1, along="x", load=WHEAT)
        P.cask(v, 18, 19, 1, h=4)
        P.box_crate(v, 21, 19, 1, contents=APPLE)
        P.well(v, 19, 3)
        P.flower_bed(v, 1, 3, 4, 8, seed=seed)
    P.scatter(v, 0, 0, 24, 18, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)
