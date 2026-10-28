"""
Cidery (5 × 6; D-057 §3): a cider house with a coursed-stone ground
floor, jettied ochre upper storey and tiles (brick chimney with smoke), a
cellar ramp, a screw press under a tiled roof on posts, apple heaps and
crates, casks of cider in racks, a hand cart of apples.
"""

from nsvoxel import parts as P
from nsvoxel.mats import APPLE, OCHRE, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()  # 40 × 48
    seed = 64
    P.yard(v, 0, 0, 40, 48, "grass", seed=seed)
    P.yard(v, 2, 22, 38, 44, "dirt", seed=seed)
    b = P.building(v, 4, 4, 28, 18, "citizen", along="x", upper=OCHRE, seed=seed, spacing=5)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 14, 2, 3, 5, frame=P.DRESSED, lintel=P.DRESSED)
    for a in (6, 21):
        P.casement(f, a, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    for a in (6, 12, 18, 24):
        P.casement(F, a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=P.mat("grass-b", 0.8))
    P.trade_sign(f, 19, 7, APPLE)
    P.roof_chimney(v, b.roof, 24, 8, above=3, brick=True, anchor=True)
    # Cellar ramp with doors.
    v.box(29, 8, 1, 35, 14, 2, STONE)
    v.box(30, 9, 1, 34, 13, 2, TIMBER)
    for y in range(9, 13):
        v.set(32, y, 1, TIMBER_DARK)
    # Press house: tiled roof on posts over a screw press.
    P.lean_to(v, 4, 16, 24, 34, 9, "tiles", down="y+", ov=1)
    v.box(7, 27, 1, 13, 31, 3, TIMBER_DARK)
    v.box(8, 28, 3, 12, 30, 4, APPLE)
    v.box(9, 28, 4, 11, 30, 5, TIMBER_LIGHT)
    v.box(10, 29, 5, 11, 30, 9, TIMBER)
    v.box(7, 29, 8, 13, 30, 9, TIMBER)
    # Apple heaps and crates.
    for cx, cy in ((21, 27), (26, 28)):
        v.ellipsoid(cx, cy, 0, 2.5, 2.5, 2, APPLE, keep=lambda x, y, z: z >= 1)
    for x, y in ((19, 32), (22, 32), (25, 32)):
        P.box_crate(v, x, y, 1, contents=APPLE)
    # Casks in a rack.
    v.box(30, 24, 1, 37, 34, 2, TIMBER)
    for y in (24, 27, 30):
        P.cask(v, 30, y, 2, h=2)
        P.cask(v, 33, y, 2, h=2)
    P.handcart(v, 20, 38, 1, along="x", load=APPLE)
    P.fruit_tree(v, 3, 40, 1, seed=seed, fruit=APPLE)
    v.anchor("cart", 32, 45, 1)
    P.scatter(v, 0, 0, 40, 48, 0.025, seed=seed)
    return P.colour_jitter(v, seed=seed)
