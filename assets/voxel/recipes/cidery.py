"""
Cidery (5 × 6; V7 variety pass, tier II): a half-timbered cider house with a
plank drying tower for apples at its west end and a slim chimney (smoke); in
front a giant stone cider press with a timber screw, a heap of red apples
and a pyramid of cider barrels. 12 voxels per tile; massing and signature
prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("terracotta", 1.35)

def build(ctx):
    v = ctx.vox()  # 60 × 72
    seed = 187
    K.ground(v, 30, 57, 27, 17, seed)
    h = K.workshop(v, 6, 6, 60 - 6, 36, 2, "e", seed, door=("y+", 28), smoke=True, chim=(46, 10), wins=[], out="tower")
    v.box(24, 44, 1, 38, 58, 5, mat("stone", 1.0))
    for dx in (0, 11):
        v.box(26 + dx, 46, 5, 28 + dx, 48, 24, TIMBER_DARK)
        v.box(26 + dx, 54, 5, 28 + dx, 56, 24, TIMBER_DARK)
    v.box(26, 46, 22, 39, 56, 24, TIMBER)
    v.box(31, 49, 24, 34, 52, 30, TIMBER_LIGHT)
    v.box(28, 50, 30, 37, 51, 32, TIMBER_DARK)
    v.box(28, 48, 5, 37, 54, 8, GOODS)
    V.heap(v, 12, 52, r=7, h=8, m=GOODS, seed=seed)
    for row, n in enumerate((5, 4, 3)):
        for i in range(n):
            P.barrel(v, 44 + i * 4 + row * 2, 60, 1 + row * 4, h=4, m=mat("timber", 1.25))
    P.handcart(v, 8, 60, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 66, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
