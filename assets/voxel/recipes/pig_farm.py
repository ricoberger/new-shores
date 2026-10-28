"""
Pig farm (3 × 4; D-057 §3): a farmhouse (pegged frame, plaster, thatch,
chimney with smoke), a low sty of rough stone with a lean-to roof, a
swill trough and buckets, a muddy yard, a heap of turnips, a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import STONE, TIMBER_LIGHT

MUD = P.mat("road-dirt", 0.7)
TURNIP = P.mat("plaster", 1.05)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    seed = 69
    P.yard(v, 0, 0, 24, 32, "grass", seed=seed)
    P.yard(v, 2, 15, 22, 30, "dirt", seed=seed)
    b = P.building(v, 2, 3, 15, 12, "settler", along="x", seed=seed, spacing=5, braces=("x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 7, 2, 3, 5)
    P.casement(f, 3, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.casement(f, 12, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.roof_chimney(v, b.roof, 4, 6, above=3, anchor=True)
    # Sty: rough stone walls, a lean-to roof, a muddy run with a trough.
    P.coursed_stone(v, 16, 3, 23, 9, 1, 5, STONE, seed, core=False)
    P.lean_to(v, 16, 23, 3, 9, 6, "thatch", down="y+", ov=1, seed=seed, posts=False)
    v.box(18, 8, 1, 21, 9, 4, None)
    for x in range(16, 24):
        for y in range(9, 15):
            v.set(x, y, 0, MUD if P.hash3(x, y, 1, seed) < 0.7 else P.shade_of(MUD, 1.1))
    P.fence_ring(v, 16, 9, 24, 15, kind="rail", seed=seed)
    P.trough(v, 17, 12, 1, length=5, along="x", water=False)
    v.box(18, 12, 1, 21, 14, 2, P.mat("hemp", 1.1))
    # Turnips, buckets, cart.
    for x, y in ((4, 18), (5, 19), (6, 18), (5, 17), (4, 20)):
        v.set(x, y, 1, TURNIP)
        v.set(x, y, 2, P.mat("hemp", 1.2))
    P.cask(v, 10, 18, 1, h=2)
    P.cask(v, 13, 18, 1, h=2)
    P.handcart(v, 4, 24, 1, along="x", load=TURNIP)
    v.anchor("cart", 18, 29, 1)
    P.scatter(v, 0, 0, 24, 32, 0.03, seed=seed)
    return P.colour_jitter(v, seed=seed)
