"""Orchard (4 × 4): cider house with chimney, a cellar door, apple crates and ladders, two fruit trees."""

from nsvoxel import parts as P
from nsvoxel.mats import APPLE, OCHRE, TIMBER, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()  # 32 × 32
    P.yard(v, 0, 0, 32, 32, "grass", seed=46)
    P.path(v, [(x, y) for x in range(13, 18) for y in range(18, 32)])
    top = P.house(v, 4, 4, 24, 16, "citizen", along="x", wall=OCHRE, seed=46)
    f = P.Face(v, "y+", 15)
    P.door(f, 13, 2, 3, 5)
    P.windows(v, "y+", 15, 5, 23, 4, skip=(13,))
    P.smoke(v, 20, 8, 1, top)
    # Cellar hatch.
    v.box(25, 9, 1, 29, 13, 2, TIMBER)
    for x, y in ((4, 20), (7, 20), (4, 23)):
        P.crate(v, x, y, 1)
        v.box(x, y, 2, x + 2, y + 2, 3, APPLE)
    v.line((22, 20, 1), (22, 22, 7), TIMBER_LIGHT)
    v.line((23, 20, 1), (23, 22, 7), TIMBER_LIGHT)
    P.tree(v, 27, 22, 1, "fruit", 46)
    P.tree(v, 26, 4, 1, "fruit", 47)
    v.anchor("cart", 20, 29, 1)

    return v
