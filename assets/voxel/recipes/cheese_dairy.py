"""
Cheese dairy (4 × 5; V7 variety pass, tier II): a half-timbered dairy with a
small stable outbuilding and a slim chimney (smoke); in front a tall open
cheese shelf with three tiers of big pale cheese wheels, milk churns and a
cart. 12 voxels per tile; massing and signature prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("ochre", 1.55)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 183
    K.ground(v, 24, 49, 21, 13, seed)
    h = K.workshop(v, 6, 6, 48 - 6, 32, 2, "e", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[], out="stable")
    for x in (8, 36):
        v.box(x, 40, 1, x + 1, 41, 17, TIMBER_DARK)
        v.box(x, 46, 1, x + 1, 47, 17, TIMBER_DARK)
    for z in (1, 6, 11):
        v.box(8, 40, z + 4, 37, 47, z + 5, TIMBER)
        for i in range(5):
            v.box(10 + i * 5, 41, z + 5, 14 + i * 5, 46, z + 8, GOODS)
    v.box(6, 39, 17, 39, 48, 18, mat("timber", 0.9))
    for x in (6, 10, 14):
        P.cask(v, x, 52, 1, h=5, lid=CANVAS)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
