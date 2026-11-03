"""
Meadery (4 × 5; V7 variety pass, tier II): an L-plan half-timbered meadery
with a lower wing and a slim chimney (smoke); in front a big open honey vat
with golden mead, a pyramid of mead barrels and a row of skeps. 12 voxels
per tile; massing and signature prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("ochre", 1.5)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 191
    K.ground(v, 24, 49, 21, 13, seed)
    h = K.workshop(v, 6, 6, 48 - 6, 32, 2, "c", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    V.vat(v, 14, 42, 1, r=7, h=10, m=mat("timber", 0.9), liquid=GOODS)
    for row, n in enumerate((4, 3, 2)):
        for i in range(n):
            P.barrel(v, 28 + i * 4 + row * 2, 44, 1 + row * 4, h=4, m=GOODS)
    for x in (28, 34, 40):
        K.hive(v, x, 54)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
