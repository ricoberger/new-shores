"""
Salt mine (3 × 8, on a salt deposit; D-057 §3): a rock hill with white
salt seams in its bands and a timbered adit, rails with a tub of rock
salt, a horse whim (a round treading floor with a drum on a post and
its sweep) over the brine shaft, brine casks and a dripping trough, a
heap of white rock salt and a coursed-stone pump house with a tiled
roof; a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import DIRT, IRON, PLANK, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SALT = mat("foam")
SEAM = mat("plaster", 1.1)
BRINE = mat("shallows", 1.25)


def build(ctx):
    v = ctx.vox()  # 24 × 64
    seed = 81
    P.yard(v, 0, 0, 24, 64, "dirt", seed=seed)
    V.mine_hill(v, 0, 24, 0, 28, peak=15, seam=SEAM, share=0.5, seed=seed)
    # Adit: dark opening in a timber frame with lagging.
    v.box(9, 18, 1, 15, 28, 7, None)
    v.box(9, 18, 1, 15, 22, 7, IRON)
    for x in (8, 15):
        v.box(x, 26, 1, x + 1, 28, 8, TIMBER)
    v.box(8, 26, 8, 16, 28, 9, TIMBER_DARK)
    for x in range(8, 16, 2):
        v.set(x, 27, 8, PLANK)
    v.box(9, 26, 7, 15, 27, 8, TIMBER)
    # Rails and a tub of rock salt.
    for y in range(22, 40):
        for x in (10, 13):
            v.set(x, y, 1, IRON)
        if y % 2 == 0:
            v.box(9, y, 0, 15, y + 1, 1, TIMBER)
    v.box(10, 31, 2, 14, 36, 4, TIMBER_DARK)
    v.box(10, 31, 4, 14, 36, 5, SALT)
    v.set(11, 33, 5, SALT)
    # Horse whim over the brine shaft: treading floor, post, drum, sweep.
    cx, cy = 6, 45
    for x in range(cx - 5, cx + 6):
        for y in range(cy - 5, cy + 6):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= 25:
                v.set(x, y, 0, P.shade_of(DIRT, 0.9))
    v.box(cx, cy, 1, cx + 1, cy + 1, 11, TIMBER_DARK)
    v.box(cx - 2, cy - 2, 7, cx + 3, cy + 3, 9, TIMBER_LIGHT)
    v.box(cx - 5, cy, 4, cx + 6, cy + 1, 5, TIMBER)
    v.box(cx - 1, cy - 1, 11, cx + 2, cy + 2, 12, TIMBER)
    # Brine: casks, a trough, the pump house.
    P.trough(v, 14, 42, 1, length=6, along="y", water=False)
    v.box(14, 43, 2, 16, 47, 3, BRINE)
    for y in (49, 52):
        P.cask(v, 2, y, 1, lid=BRINE)
    b = P.building(v, 15, 50, 23, 60, "stone", along="y", seed=seed, height=9)
    P.entrance(b.face("x-"), 53, 2, 3, 5)
    P.casement(b.face("y+"), 18, 4, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.roof_chimney(v, b.roof, 18, 52, above=2)
    V.heap(v, 6, 56, r=4, h=5, m=SALT, seed=seed, ragged=0.35)
    P.tool_rack(b.face("x-"), 56, 1, n=2)
    P.handcart(v, 14, 60, 1, along="x", load=SALT)
    v.anchor("cart", 9, 62, 1)
    P.scatter(v, 0, 28, 24, 64, 0.02, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
