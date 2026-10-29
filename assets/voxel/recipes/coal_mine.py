"""
Coal mine (3 × 8, on a coal deposit; D-057 §3): a rock hill with black
coal seams in its bands and a timbered adit, a tall timber headframe with
its sheave wheel over a shaft, rails with tubs of coal, a black coal heap
and a sooty spoil tip, a coursed-stone winding house with a tiled roof
and its drum, pit props and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, PLANK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

COAL = mat("iron", 0.5)
SPOIL = mat("rock-deep", 0.8)


def build(ctx):
    v = ctx.vox()  # 24 × 64
    seed = 83
    P.yard(v, 0, 0, 24, 64, "dirt", seed=seed)
    V.mine_hill(v, 0, 24, 0, 26, peak=14, seam=COAL, share=0.5, seed=seed)
    # Adit with timber frame.
    v.box(3, 16, 1, 9, 26, 7, None)
    v.box(3, 16, 1, 9, 20, 7, COAL)
    for x in (2, 9):
        v.box(x, 24, 1, x + 1, 26, 8, TIMBER)
    v.box(2, 24, 8, 10, 26, 9, TIMBER_DARK)
    for x in range(2, 10, 2):
        v.set(x, 25, 8, PLANK)
    # Rails from the adit to the heap with two tubs of coal.
    for y in range(20, 44):
        for x in (4, 7):
            v.set(x, y, 1, IRON)
        if y % 2 == 0:
            v.box(3, y, 0, 9, y + 1, 1, TIMBER)
    for ty in (29, 36):
        v.box(4, ty, 2, 8, ty + 4, 4, TIMBER_DARK)
        v.box(4, ty, 4, 8, ty + 4, 5, COAL)
    # Headframe over the shaft: four legs, braces, the sheave wheel.
    sx, sy = 16, 32
    for dx in (0, 5):
        for dy in (0, 5):
            v.box(sx + dx, sy + dy, 1, sx + dx + 1, sy + dy + 1, 18, TIMBER)
    for z in (6, 12, 17):
        v.walls(sx, sy, sx + 6, sy + 6, z, z + 1, TIMBER_DARK)
    for x in range(sx + 1, sx + 5):
        for y in range(sy + 1, sy + 5):
            v.set(x, y, 0, COAL)
    for a in range(-3, 4):
        for b in range(-3, 4):
            if 6 <= a * a + b * b <= 10:
                v.set(sx + 3 + a, sy + 2, 21 + b, IRON)
    v.box(sx + 3, sy + 2, 18, sx + 4, sy + 3, 21, TIMBER_DARK)
    for z in range(4, 18):
        v.set(sx + 3, sy + 3, z, mat("canvas", 0.8))
    # Winding house with its drum.
    b = P.building(v, 14, 44, 23, 56, "stone", along="y", seed=seed, height=9)
    P.entrance(b.face("x-"), 48, 2, 3, 5)
    P.casement(b.face("y+"), 17, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(b.face("x-"), 53, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.roof_chimney(v, b.roof, 20, 46, above=2)
    v.line((18, 44, 9), (19, 38, 18), mat("canvas", 0.8))
    # Coal heap, spoil tip, pit props, cart.
    V.heap(v, 6, 50, r=4.5, h=5, m=COAL, seed=seed)
    V.heap(v, 20, 6, r=3, h=3, m=SPOIL, seed=seed + 1, z=13)
    P.log_stack(v, 1, 57, 1, length=8, along="x", n=2)
    P.handcart(v, 13, 59, 1, along="x", load=COAL)
    v.anchor("cart", 9, 62, 1)
    P.scatter(v, 0, 26, 24, 64, 0.02, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)
