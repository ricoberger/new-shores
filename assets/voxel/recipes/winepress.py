"""
Winepress (6 × 9; D-057 §3, V5): a long hall of coursed stone with
dressed quoins under a tiled roof, a tall timber press frame standing
through the roof (two posts, a crossbeam, the great screw and a brass
nut), a lean-to along its side sheltering rows of casks two high, a
chimney (smoke), a front yard with grape carts, treading tubs and a vine
pergola over the door.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

ROOF = mat("terracotta", 0.82)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 99
    P.yard(v, 0, 0, 48, 72, "dirt", seed=seed)
    P.yard(v, 2, 54, 46, 72, "paved", seed=seed)
    # The hall along y.
    b = P.building(v, 4, 6, 28, 50, "stone", along="y", height=13, roof=ROOF, seed=seed)
    f = b.face("y+")
    P.barn_gate(f, 12, 2, 6, 7)
    for a in (6, 22):
        Q.window(f, a, 5, 2, 4, hood="key", surround=True)
    for a in range(10, 46, 8):
        Q.window(b.face("x-"), a, 6, 2, 4, hood="key", surround=True)
    P.roof_chimney(v, b.roof, 7, 10, above=3, anchor=True)
    # The press frame through the roof.
    rz = b.roof.ridge_z
    for y in (24, 31):
        v.box(14, y, 1, 18, y + 2, rz + 8, TIMBER_DARK)
    v.box(13, 23, rz + 8, 19, 34, rz + 10, TIMBER)
    v.box(15, 26, rz - 2, 17, 31, rz + 8, IRON)
    v.box(14, 27, rz + 6, 18, 30, rz + 7, BRASS)
    v.box(13, 22, rz + 10, 19, 35, rz + 11, ROOF)
    # Lean-to along the east side with casks in rows two high.
    P.lean_to(v, 28, 44, 8, 48, 10, "tiles", down="x+", m=ROOF, posts=True, seed=seed)
    for y in (10, 22, 34):
        Q.cask_rack(v, 30, y, 1, n=5, along="x", tiers=2, length=12)
    # Front yard: carts of grapes, treading tubs, a pergola over the door.
    for y in (51, 55):
        for x in range(8, 24, 4):
            v.box(x, y, 1, x + 1, y + 1, 9, TIMBER)
    v.box(7, 51, 9, 25, 56, 10, TIMBER_LIGHT)
    for x in range(7, 25):
        for y in range(51, 56):
            if (x + y) % 3:
                v.set(x, y, 10, Q.VINE)
            elif (x * y) % 7 == 0:
                v.set(x, y, 9, Q.GRAPE)
    for x, y in ((30, 56), (35, 56), (40, 56)):
        P.cask(v, x, y, 1, h=2, lid=Q.GRAPE)
    P.handcart(v, 31, 62, 1, along="x", load=Q.GRAPE)
    P.handcart(v, 6, 62, 1, along="x", load=Q.GRAPE)
    Q.cask_rack(v, 39, 64, 1, n=2, along="x", tiers=2, length=5)
    v.anchor("cart", 24, 70, 1)
    P.scatter(v, 0, 0, 48, 6, 0.03, seed=seed)
    _ = (STONE, TIMBER_LIGHT)
    return P.colour_jitter(v, seed=seed)
