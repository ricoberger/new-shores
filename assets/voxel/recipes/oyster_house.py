"""
Oyster house (6 × 6; D-057 §3, V5): an open sorting hall on posts under
a long brown-tiled roof — tables with oysters, tubs of brine — and at its end
a closed ashlar kitchen with a tall kettle chimney (smoke); shell heaps
in the yard, packed crates and barrels, a well, a fenced herb bed and a
cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

ROOF = mat("timber", 1.3)  # brown tile
RIDGE = mat("timber", 1.1)
OYSTER = mat("stone", 0.9)
BRINE = mat("shallows")


def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 95
    P.yard(v, 0, 0, 48, 48, "dirt", seed=seed)
    P.yard(v, 2, 30, 46, 48, "paved", seed=seed)
    # Sorting hall: posts, a long roof, tables and tubs.
    for x in range(4, 33, 7):
        for y in (6, 23):
            v.box(x, y, 1, x + 2, y + 1, 11, TIMBER)
    v.box(3, 6, 10, 34, 7, 11, TIMBER_DARK)
    v.box(3, 23, 10, 34, 24, 11, TIMBER_DARK)
    P.roof(v, 3, 34, 6, 24, 11, "tiles", along="x", m=ROOF, ridge=RIDGE, gable=TIMBER_LIGHT, solid=False, seed=seed)
    for y in (10, 17):
        v.box(6, y, 1, 30, y + 3, 3, TIMBER_LIGHT)
        for x in range(7, 29, 3):
            v.set(x, y + 1, 3, OYSTER)
            v.set(x + 1, y + 2, 3, OYSTER)
    for x in (8, 20):
        P.cask(v, x, 14, 1, h=2, lid=BRINE)
    # Kitchen with the kettle chimney.
    b = P.building(v, 34, 5, 46, 25, "stone", along="x", height=11, roof=mat("terracotta", 0.66), seed=seed)
    P.entrance(b.face("y+"), 38, 2, 3, 5)
    Q.window(b.face("x+"), 10, 5, 2, 3, hood="key", surround=True)
    Q.window(b.face("x+"), 18, 5, 2, 3, hood="key", surround=True)
    P.roof_chimney(v, b.roof, 41, 13, above=7, brick=True, pots=2, anchor=True)
    # Yard: shell heaps, crates, barrels, a well, herbs.
    Q.shell_heap(v, 8, 36, 4.0, 3)
    Q.shell_heap(v, 15, 41, 3.0, 2)
    for x in (24, 27, 30):
        P.box_crate(v, x, 33, 1, contents=OYSTER)
    P.box_crate(v, 27, 33, 3)
    P.cask(v, 34, 32, 1, lid=BRINE)
    P.cask(v, 37, 33, 1)
    P.well(v, 42, 38)
    P.fence_ring(v, 1, 26, 12, 30, kind="picket", seed=seed)
    P.flower_bed(v, 2, 27, 11, 29, seed=seed)
    P.sacks(v, 24, 40, 1, n=3, m=CANVAS)
    P.handcart(v, 32, 42, 1, along="x", load=OYSTER)
    v.anchor("cart", 24, 46, 1)
    _ = (STONE, TIMBER_DARK)
    return P.colour_jitter(v, seed=seed)
