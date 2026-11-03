"""
Dairy farm (4 × 5; V7 variety pass, tier II): a half-timbered barn with a
lean-to shed and a slim chimney (smoke); in front a fenced paddock with
three cows, a long trough, a row of big milk churns and a cart. 12 voxels
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

GOODS = mat("canvas", 1.3)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 189
    K.ground(v, 24, 48, 21, 14, seed)
    h = K.workshop(v, 6, 6, 48 - 6, 30, 2, "b", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    P.fence_ring(v, 4, 34, 44, 58, kind="rail", gaps={(40, 34), (41, 34)}, seed=seed)
    K.cow(v, 8, 40, 1)
    K.cow(v, 24, 46, 1, along="y")
    K.cow(v, 32, 38, 1)
    P.trough(v, 8, 54, 1, length=14, along="x")
    for x in (28, 32, 36):
        P.cask(v, x, 53, 1, h=6, lid=CANVAS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
