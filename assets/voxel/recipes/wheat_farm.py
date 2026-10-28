"""Wheat farm (3 × 4): farmhouse with chimney, a big barn with a hay loft, haystacks and a cart shed."""

from nsvoxel import parts as P
from nsvoxel.mats import OCHRE, PLASTER, THATCH, TIMBER, TIMBER_LIGHT, WHEAT


def build(ctx):
    v = ctx.vox()  # 24 × 32
    P.yard(v, 0, 0, 24, 32, "dirt", seed=41)
    P.yard(v, 0, 0, 24, 3, "grass", seed=41)
    # Barn at the back.
    top = P.house(v, 2, 3, 22, 15, "citizen", along="x", wall=TIMBER_LIGHT, roof=THATCH, seed=41)
    f = P.Face(v, "y+", 14)
    P.gate(f, 9, 1, 6, 7)
    P.door(f, 10, 9, 4, 2, step=None)
    v.box(10, 14, 9, 14, 15, 10, WHEAT)
    # Farmhouse.
    top = P.house(v, 2, 18, 13, 27, "citizen", along="y", wall=OCHRE, seed=42)
    P.door(P.Face(v, "y+", 26), 6, 2, 3, 5)
    P.window(P.Face(v, "x+", 12), 21, 4, 2, 2)
    P.smoke(v, 4, 21, 1, top - 3)
    # Haystacks and sheaves.
    for x, y in ((15, 18), (19, 21)):
        v.ellipsoid(x + 1.5, y + 1.5, 1, 2.2, 2.2, 4, WHEAT, keep=lambda a, b, c: c >= 1)
        v.set(x + 1, y + 1, 5, P.mat("wheat-mark"))
    for x in range(15, 22, 2):
        v.box(x, 26, 1, x + 1, 27, 3, WHEAT)
    v.anchor("cart", 19, 30, 1)

    return v
