"""
Soap maker (3 × 4; D-057 §3): a timber-framed workshop with an ochre
infill and red tiles and its chimney (smoke), an open kettle shed on
posts over a copper on a brick hearth with a stirring paddle, drying
racks and stacked soap cakes in pale colours, ash and lye casks, a
bench and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, OCHRE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SOAP = mat("plaster", 1.08)
SOAP_B = mat("pasture-mark", 1.1)
SOAP_C = mat("ochre", 1.25)
ASH = mat("stone", 0.8)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 137
    P.yard(v, 0, 0, 24, 32, "grass", seed=seed)
    P.yard(v, 0, 14, 24, 32, "dirt", seed=seed)
    b = P.building(v, 10, 2, 22, 13, "citizen", along="x", upper=OCHRE, seed=seed, spacing=4, height=13, rise=1.4)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 12, 2, 3, 5)
    V.shop_front(f, 16, 3, 4, 3, goods=(SOAP, SOAP_B, SOAP_C))
    P.casement(F, 13, 9, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=mat("dye-blue"))
    P.casement(F, 18, 9, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=mat("dye-blue"))
    P.casement(b.face("x-"), 6, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED)
    P.roof_chimney(v, b.roof, 19, 6, above=3, brick=True, anchor=True)
    # Kettle shed on the west.
    P.lean_to(v, 1, 10, 2, 13, 10, "tiles", down="x-", posts=True)
    top = V.kettle(v, 5, 7.5, 1, r=2.6, h=3, hearth_h=2)
    v.box(4, 6, top - 1, 7, 9, top, SOAP)
    v.line((5, 7, top), (7, 9, top + 3), TIMBER_LIGHT)
    # Drying racks of soap cakes and stacked cakes.
    for x0 in (2, 9):
        v.box(x0, 17, 1, x0 + 1, 18, 7, TIMBER)
        v.box(x0 + 5, 17, 1, x0 + 6, 18, 7, TIMBER)
        for z in (2, 4, 6):
            v.box(x0, 17, z, x0 + 6, 19, z + 1, TIMBER_LIGHT)
            for x in range(x0 + 1, x0 + 5):
                if (x + z) % 3:
                    v.set(x, 18, z + 1, (SOAP, SOAP_B, SOAP_C)[(x + z) % 3])
    for k, (x, y) in enumerate(((16, 17), (19, 17), (16, 20))):
        V.stack(v, x, y, x + 2, y + 2, 1, 3 + k % 2, (SOAP, SOAP_C, SOAP_B)[k], every=1, band=None)
    # Ash and lye, bench, cart.
    V.heap(v, 3, 24, r=2.2, h=2, m=ASH, seed=seed)
    P.cask(v, 7, 23, 1, lid=ASH)
    P.cask(v, 10, 23, 1, lid=mat("shallows", 1.2))
    P.bench(v, 16, 24, length=4)
    P.sacks(v, 20, 23, 1, n=1, m=CANVAS)
    P.handcart(v, 3, 28, 1, along="x", load=SOAP)
    v.anchor("cart", 14, 30, 1)
    P.scatter(v, 0, 0, 24, 14, 0.02, seed=seed)
    return P.colour_jitter(v, seed=seed)
