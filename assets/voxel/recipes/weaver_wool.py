"""
Wool weaver (3 × 4; D-057 §3): a settler workshop (pegged frame, plaster,
thatch, chimney with smoke, blue shutters), a loom with a half-woven
cloth under a thatched lean-to, dyed cloth drying on a line (swaying),
dye vats, wool bales and a hand cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, DYE_BLUE, TIMBER, TIMBER_LIGHT

CLOTH = (P.mat("dye-blue", 1.0, "cloth"), P.mat("terracotta", 1.05, "cloth"), P.mat("ochre", 1.0, "cloth"), P.mat("canvas", 1.0, "cloth"))
WOOL = P.mat("canvas", 1.08)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 53
    P.yard(v, 0, 0, 24, 32, "grass", seed=seed)
    P.yard(v, 2, 16, 22, 30, "dirt", seed=seed)
    b = P.building(v, 2, 3, 16, 13, "settler", along="x", seed=seed, spacing=5, braces=("x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 7, 2, 3, 5)
    P.casement(f, 3, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=DYE_BLUE, bars=False)
    P.casement(f, 13, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=DYE_BLUE, bars=False)
    P.trade_sign(f, 11, 7, DYE_BLUE)
    P.roof_chimney(v, b.roof, 13, 6, above=3, anchor=True)
    # Lean-to with a loom: frame, warp threads, a half-woven blue cloth.
    P.lean_to(v, 17, 22, 4, 13, 7, "thatch", down="x+", ov=1, seed=seed)
    v.box(17, 6, 1, 18, 11, 5, TIMBER)
    v.box(20, 6, 1, 21, 11, 5, TIMBER)
    v.box(17, 6, 5, 21, 11, 6, TIMBER_LIGHT)
    for y in range(7, 10):
        v.set(18, y, 3, CANVAS)
        v.set(19, y, 3, CANVAS)
        v.set(18, y, 4, P.mat("dye-blue", 1.1))
    v.box(18, 6, 2, 20, 11, 3, TIMBER_LIGHT)
    # Washing line with cloth.
    for x in (3, 20):
        v.box(x, 20, 1, x + 1, 21, 7, TIMBER)
    for x in range(4, 20):
        v.set(x, 20, 7, TIMBER_LIGHT)
    for k, x in enumerate(range(5, 19, 4)):
        v.box(x, 20, 3, x + 3, 21, 7, CLOTH[k % 4])
    # Dye vats and wool.
    P.cask(v, 4, 24, 1, h=3, lid=P.mat("dye-blue", 0.9))
    P.cask(v, 7, 24, 1, h=3, lid=P.mat("terracotta", 1.0))
    P.bale(v, 11, 24, 1, 3, 2, 2, m=WOOL)
    P.bale(v, 11, 27, 1, 3, 2, 2, m=WOOL)
    P.handcart(v, 15, 25, 1, along="x", load=WOOL)
    v.anchor("cart", 18, 29, 1)
    P.scatter(v, 0, 0, 24, 32, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)
