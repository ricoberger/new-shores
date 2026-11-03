"""
Printing press (4 × 5; V7 variety pass, tier III): a stone-and-timber print
shop with an open work bay (no chimney); under it a giant timber screw press
with its bar, tall stacks of pale paper and ink barrels. 12 voxels per tile;
massing and signature prop in NOTES.md.
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
    K.ground(v, 24, 48, 21, 14, seed)
    h = K.workshop(v, 6, 6, 48 - 6, 30, 3, "d", seed, door=("y+", 22), wins=[])
    for dx in (0, 12):
        v.box(8 + dx, 48, 1, 11 + dx, 51, 24, TIMBER_DARK)
    v.box(8, 48, 20, 23, 51, 23, TIMBER)
    v.box(14, 48, 23, 17, 51, 31, TIMBER_LIGHT)
    v.box(10, 49, 29, 21, 50, 31, TIMBER_DARK)
    v.box(8, 46, 1, 23, 54, 6, TIMBER_LIGHT)
    K.pile(v, 28, 36, 1, 10, 6, 8, GOODS, seed)
    K.pile(v, 38, 36, 1, 8, 6, 5, GOODS, seed + 1)
    P.cask(v, 8, 52, 1, h=5, lid=mat("iron", 0.6))
    P.cask(v, 12, 52, 1, h=5, lid=mat("iron", 0.6))
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
