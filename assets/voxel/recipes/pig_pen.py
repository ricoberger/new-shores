"""
Pig pen (3 × 4 module; D-057 §3): a muddy pen with puddles and straw,
uneven wattle-and-post fencing with a gate at the front, a swill
trough, a thatched shelter in a corner; the pigs are life instances
(anchors).
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3
from nsvoxel.mats import THATCH, TIMBER

MUD = P.mat("road-dirt", 0.7)


def build(ctx):
    v = ctx.vox()  # 24 × 32
    W, D = ctx.W, ctx.D
    seed = 19
    for x in range(W):
        for y in range(D):
            h = hash3(x // 4, y // 4, 0, seed)
            v.set(x, y, 0, MUD if h < 0.55 else (P.shade_of(MUD, 1.12) if h < 0.85 else P.mat("shallows", 0.7)))
            if hash3(x, y, 2, seed) < 0.025:
                v.set(x, y, 1, P.mat("thatch", 1.1))
    P.fence_ring(v, 0, 0, W, D, kind="wattle", gaps={(x, D - 1) for x in range(10, 14)}, seed=seed)
    v.box(9, D - 1, 1, 10, D, 4, TIMBER)
    v.box(14, D - 1, 1, 15, D, 4, TIMBER)
    P.trough(v, 3, 22, 1, length=6, along="x", water=False)
    v.box(4, 22, 1, 8, 24, 2, P.mat("hemp", 1.1))
    # Shelter in the back corner.
    for x, y in ((14, 2), (21, 2), (14, 9), (21, 9)):
        v.box(x, y, 1, x + 1, y + 1, 6, TIMBER)
    P.lean_to(v, 14, 22, 2, 10, 6, "thatch", down="y+", ov=1, seed=seed, posts=False)
    v.box(15, 3, 1, 21, 9, 2, THATCH)
    v.anchor("gate", 12, D - 0.6, 0)
    v.anchor("pig_1", 5.6, 6.4, 1)
    v.anchor("pig_2", 9.6, 14.4, 1)
    v.anchor("pig_3", 16.8, 18.4, 1)
    v.anchor("pig_4", 6.4, 27.2, 1)
    v.anchor("door", 12, D, 0)
    return P.colour_jitter(v, seed=seed, ground=0.25)
