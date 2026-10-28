"""
Cheese dairy (4 × 5; D-057 §3): a dairy with a coursed-stone ground
floor (cool, small shuttered windows), a jettied plaster upper storey,
tiles and a chimney (smoke) over the curd kettle; cheese wheels ripening
on racks under a tiled lean-to, a press, milk churns, a whey tub and a
cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

CHEESE = P.mat("ochre", 1.25)
RIND = P.mat("ochre", 1.05)
CHURN = P.mat("iron", 1.4)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 66
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 2, 20, 30, 34, "paved", seed=seed)
    b = P.building(v, 4, 4, 22, 16, "citizen", along="x", upper=PLASTER, seed=seed, spacing=4)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 11, 2, 3, 5, frame=P.DRESSED, lintel=P.DRESSED)
    for a in (6, 17):
        P.casement(f, a, 4, 2, 2, frame=P.DRESSED, sill=P.DRESSED, shutters=TIMBER_LIGHT, bars=False)
    for a in (5, 11, 17):
        P.casement(F, a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=P.mat("dye-blue", 1.1))
    P.trade_sign(f, 9, 7, CHEESE)
    P.roof_chimney(v, b.roof, 17, 8, above=3, anchor=True)
    # Ripening racks under a lean-to.
    P.lean_to(v, 23, 30, 5, 16, 8, "tiles", down="x+", ov=1)
    for y in (6, 13):
        v.box(24, y, 1, 29, y + 1, 7, TIMBER)
    for z in (2, 4, 6):
        v.box(24, 7, z, 29, 13, z + 1, TIMBER_LIGHT)
        for y in range(7, 13, 2):
            v.box(25, y, z + 1, 27, y + 2, z + 2, CHEESE if y % 4 == 3 else RIND)
    # Press, churns, whey tub.
    v.box(4, 22, 1, 8, 26, 3, TIMBER_DARK)
    v.box(5, 23, 3, 7, 25, 4, CHEESE)
    v.box(5, 23, 4, 7, 25, 5, TIMBER_LIGHT)
    v.box(6, 24, 5, 7, 25, 8, IRON)
    for x in (11, 13):
        v.box(x, 22, 1, x + 2, 24, 4, CHURN)
        v.box(x, 22, 2, x + 2, 24, 3, IRON)
    P.cask(v, 16, 22, 1, h=2, lid=P.mat("plaster", 1.1))
    for x, y in ((20, 22), (22, 22), (20, 24)):
        v.box(x, y, 1, x + 2, y + 2, 2, RIND)
    P.handcart(v, 6, 30, 1, along="x", load=CHEESE)
    v.anchor("cart", 26, 37, 1)
    P.scatter(v, 0, 0, 32, 40, 0.025, seed=seed)
    return P.colour_jitter(v, seed=seed)
