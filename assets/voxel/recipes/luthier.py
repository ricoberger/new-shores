"""
Luthier (5 × 5; V7 variety pass, tier IV): a long two-storey cream plaster
workshop under slate (no chimney); in front a rack of big violins and lutes
with pale necks and a stack of pale tonewood planks. 12 voxels per tile;
massing and signature prop in NOTES.md.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor and half-timber — under the dark burgundy tile, one of the grand
tier-4 workshops that may wear it; the props are unchanged.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("timber", 1.0)
NECK = mat("plaster", 1.1)

def build(ctx):
    v = ctx.vox()  # 60 × 60
    seed = 161
    K.ground(v, 30, 49, 27, 13, seed, "paved")
    h = K.workshop(v, 6, 6, 60 - 6, 32, 2, "a", seed, door=("y+", 28), wins=[], dark=True)
    for k, x in enumerate(range(6, 46, 13)):
        v.box(x, 38, 1, x + 1, 39, 16, TIMBER_DARK)
        v.box(x + 10, 38, 1, x + 11, 39, 16, TIMBER_DARK)
        v.box(x, 38, 15, x + 11, 39, 16, TIMBER_DARK)
        v.box(x + 2, 38, 3, x + 9, 39, 10, GOODS)
        v.box(x + 4, 38, 10, x + 7, 39, 14, GOODS)
        v.box(x + 5, 38, 14, x + 6, 39, 15, NECK)
        v.box(x + 4, 38, 2, x + 7, 39, 3, TIMBER_DARK)
    K.pile(v, 38, 46, 1, 14, 6, 8, mat("timber", 1.3), seed)
    v.box(8, 48, 1, 28, 53, 3, TIMBER_LIGHT)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
