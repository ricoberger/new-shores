"""
Winepress (6 × 9; V7 variety pass, tier IV): a long two-storey cream plaster
pressing hall with an open bay and a slim chimney (smoke); under and before
it a giant timber screw press on a stone bed with a dark-red must trough,
big vats and a pyramid of wine barrels. 12 voxels per tile; massing and
signature prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("dye-blue", 0.7)
MUST = mat("terracotta", 0.7)
OAK = mat("timber", 1.25)

def build(ctx):
    v = ctx.vox()  # 72 × 108
    seed = 173
    K.ground(v, 36, 83, 33, 27, seed, "paved")
    h = K.workshop(v, 6, 6, 72 - 6, 52, 4, "d", seed, door=("y+", 34), smoke=True, chim=(58, 10), wins=[])
    for dx in (0, 14):
        for dy in (0, 10):
            v.box(14 + dx, 68 + dy, 1, 17 + dx, 71 + dy, 28, TIMBER_DARK)
    v.box(14, 68, 24, 31, 81, 27, TIMBER)
    v.box(21, 73, 27, 24, 76, 38, TIMBER_LIGHT)
    v.box(16, 74, 36, 29, 76, 38, TIMBER_DARK)
    v.box(12, 66, 1, 33, 83, 5, mat("stone", 1.0))
    v.box(15, 69, 5, 30, 80, 9, MUST)
    for x in (44, 56):
        V.vat(v, x, 62, 1, r=6, h=9, m=OAK, liquid=MUST)
    for row, n in enumerate((6, 5, 4)):
        for i in range(n):
            P.barrel(v, 44 + i * 4 + row * 2, 90, 1 + row * 4, h=4, m=OAK)
    P.handcart(v, 8, 96, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 102, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
