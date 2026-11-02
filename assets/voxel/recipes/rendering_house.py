"""
Rendering house (3 × 3; V7 rework, tier III): a small stone-and-timber house
under dark burgundy tiles with a slim chimney (smoke), a big iron cauldron
on a hearth, barrels of tallow and hooks with hides. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.1)

def build(ctx):
    v = ctx.vox()  # 36 × 36
    seed = 217
    K.ground(v, 18, 30, 15, 8, seed)
    h = K.hall(v, 6, 6, 36 - 6, 18, 3, "y", seed, door=("y+", 16), smoke=True, chim=(22, 10), wins=[])
    V.vat(v, 10, 26, 1, r=4, h=6, m=mat("iron", 0.8), liquid=mat("ochre", 1.2))
    P.cask(v, 22, 24, 1, h=4, lid=GOODS)
    P.cask(v, 26, 24, 1, h=4, lid=GOODS)
    P.handcart(v, 8, 24, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 30, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
