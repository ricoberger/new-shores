"""
Printing press (4 × 5; V7 rework, tier III): a stone-and-timber print shop
gabled to the street under dark burgundy tiles (no chimney), a giant timber
screw press with its bar, tall stacks of pale paper and ink barrels. 12
voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.35)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 213
    K.ground(v, 24, 49, 21, 12, seed)
    h = K.hall(v, 6, 6, 48 - 6, 33, 3, "y", seed, door=("y+", 22), wins=[])
    for dx in (0, 8):
        v.box(8 + dx, 40, 1, 10 + dx, 42, 16, TIMBER_DARK)
    v.box(8, 40, 14, 18, 42, 16, TIMBER)
    v.box(12, 40, 16, 14, 42, 22, TIMBER_LIGHT)
    v.box(8, 41, 20, 18, 42, 22, TIMBER_DARK)
    v.box(8, 38, 1, 18, 44, 5, TIMBER_LIGHT)
    K.pile(v, 26, 38, 1, 8, 6, 8, GOODS, seed)
    K.pile(v, 36, 38, 1, 8, 6, 5, GOODS, seed + 1)
    P.cask(v, 8, 48, 1, h=4, lid=mat("iron", 0.6))
    P.cask(v, 12, 48, 1, h=4, lid=mat("iron", 0.6))
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
