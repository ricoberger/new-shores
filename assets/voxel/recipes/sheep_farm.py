"""
Sheep farm (3 × 3; D-057 §3): a shepherd's cottage (pegged timber frame,
plaster, thatch, chimney with smoke), an open fold of wattle hurdles with
a thatched lean-to and a hay rack, a shearing bench with a fleece, wool
bales and sacks, a trough and a hand cart of wool.
"""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, THATCH, TIMBER, TIMBER_LIGHT

WOOL = P.mat("canvas", 1.08)


def build(ctx):
    v = ctx.vox()
    seed = 44
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    P.yard(v, 2, 14, 15, 23, "dirt", seed=seed)
    b = P.building(v, 2, 3, 14, 12, "settler", along="x", seed=seed, spacing=5, braces=("x-", "x+"))
    f = b.face("y+")
    P.entrance(f, 7, 2, 3, 5)
    P.casement(f, 3, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.casement(b.face("x-"), 6, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
    P.roof_chimney(v, b.roof, 11, 6, above=3, anchor=True)
    # Fold: wattle hurdles with a gap, a lean-to with a hay rack.
    P.fence_ring(v, 16, 2, 23, 15, kind="wattle", gaps={(19, 14), (20, 14)}, seed=seed)
    P.lean_to(v, 17, 22, 3, 8, 6, "thatch", down="x-", ov=0, seed=seed)
    v.box(17, 4, 2, 18, 7, 4, TIMBER)
    v.box(17, 4, 3, 18, 7, 4, THATCH)
    P.trough(v, 18, 11, 1, length=4, along="x")
    # Shearing bench with a fleece, wool bales and sacks.
    v.box(9, 17, 1, 14, 19, 2, TIMBER)
    v.box(9, 17, 2, 14, 19, 3, TIMBER_LIGHT)
    v.box(10, 17, 3, 13, 19, 4, WOOL)
    P.bale(v, 3, 15, 1, 3, 2, 2, m=WOOL)
    P.bale(v, 3, 18, 1, 3, 2, 2, m=WOOL)
    P.bale(v, 4, 16, 3, 2, 2, 1, m=WOOL)
    P.sacks(v, 3, 21, 1, n=2, m=CANVAS)
    P.handcart(v, 16, 18, 1, along="x", load=WOOL)
    v.anchor("cart", 19, 21, 1)
    P.scatter(v, 0, 0, 24, 24, 0.035, seed=seed)
    return P.colour_jitter(v, seed=seed)
