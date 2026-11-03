"""
Soap maker (3 × 4; V7 variety pass, tier III): a stone-and-timber house
gabled to the street with a lean-to shed and a slim chimney (smoke); in
front a big copper cauldron, a tall stack of pale soap bars and lye barrels.
12 voxels per tile; massing and signature prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.4)

def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 219
    K.ground(v, 18, 40, 15, 10, seed)
    h = K.workshop(v, 6, 6, 36 - 6, 26, 3, "b", seed, door=("y+", 16), smoke=True, chim=(22, 10), wins=[])
    V.vat(v, 12, 38, 1, r=6, h=8, m=mat("terracotta", 1.2), liquid=GOODS)
    K.pile(v, 22, 32, 1, 10, 8, 10, GOODS, seed)
    P.cask(v, 6, 46, 1, h=5, lid=CANVAS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
