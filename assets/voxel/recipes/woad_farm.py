"""
Woad farm (3 × 4; V7 variety pass, tier III): a stone-and-timber farmhouse
with a lean-to shed (no chimney); in front two tall racks hung with deep
blue woad leaves and a heap of woad balls. 12 voxels per tile; massing and
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

GOODS = mat("dye-blue", 0.9)

def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 221
    K.ground(v, 18, 40, 15, 10, seed)
    h = K.workshop(v, 6, 6, 36 - 6, 26, 3, "b", seed, door=("y+", 16), wins=[])
    K.rack(v, 6, 30, 32, GOODS, h=16, drop=13)
    K.rack(v, 6, 30, 40, [GOODS, shade_of(GOODS, 1.2)], h=14, drop=11)
    V.heap(v, 28, 44, r=5, h=5, m=GOODS, seed=seed)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
