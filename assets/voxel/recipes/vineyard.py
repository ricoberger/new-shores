"""
Vineyard (4 × 5 farm with vine-row fields; D-057 §3, V5): a winegrower's
house of ashlar with a tiled roof and a loggia porch, a press yard under
a tiled lean-to with a beam press over a stone basin of must, grape tubs
and baskets, casks lying in a rack, three trellis rows of vines with
grape bunches behind the house, a picket fence and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

MUST = mat("dye-blue", 0.5)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 81
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 1, 21, 31, 39, "dirt", seed=seed)
    # Vines behind the house: three trellis rows on worked soil.
    for y in (3, 8, 13):
        for x in range(1, 31):
            for d in (-1, 0, 1):
                v.set(x, y + d, 0, P.shade_of(mat("road-dirt"), 0.9))
        Q.trellis_row(v, 1, 30, y, z=1, h=5, every=6, seed=seed + y)
    # The winegrower's house: ashlar, tiles, a two-arch porch.
    b = P.building(v, 18, 19, 30, 30, "stone", along="y", height=12, roof=mat("terracotta", 0.9), seed=seed)
    f = b.face("y+")
    Q.arcade(f, 18, 30, 2, 5, bay=3, pier=2, depth=2)
    P.entrance(P.Face(v, "y+", 27), 23, 2, 2, 4, step=None)
    for side in ("x-", "x+"):
        for a in (21, 26):
            Q.window(b.face(side), a, 6, 2, 3, hood="key", surround=True)
    Q.window(f, 23, 9, 2, 2, hood=None)
    P.roof_chimney(v, b.roof, 26, 21, above=3, brick=True, pots=2)
    # Press yard: a lean-to on posts over the beam press and its basin.
    P.lean_to(v, 2, 16, 22, 30, 9, "tiles", down="y+", seed=seed)
    v.box(4, 23, 1, 13, 29, 2, STONE_DARK)
    v.box(5, 24, 1, 12, 28, 2, MUST)
    for x in (4, 12):
        v.box(x, 25, 2, x + 1, 27, 9, TIMBER)
    v.box(3, 25, 7, 14, 27, 8, TIMBER_DARK)  # the beam
    v.box(8, 25, 2, 9, 27, 7, IRON)  # the screw
    v.box(6, 24, 2, 11, 28, 3, TIMBER_LIGHT)  # the press board
    # Grape tubs and baskets, casks in a rack.
    for x, y in ((2, 32), (6, 32), (2, 35)):
        P.cask(v, x, y, 1, h=2, lid=Q.GRAPE)
    Q.cask_rack(v, 10, 32, 1, n=3, along="x", tiers=2, length=5)
    P.box_crate(v, 17, 33, 1, contents=Q.GRAPE)
    P.fence_line_v2(v, 0, 20, 0, 39, kind="picket", seed=seed)
    P.handcart(v, 20, 34, 1, along="x", load=Q.GRAPE)
    v.anchor("cart", 16, 38, 1)
    P.scatter(v, 0, 17, 32, 21, 0.04, seed=seed)
    _ = STONE
    return P.colour_jitter(v, seed=seed)
