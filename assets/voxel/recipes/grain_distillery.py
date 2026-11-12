"""
Grain distillery (5 × 6; V7 variety pass, tier IV): a two-storey cream
plaster distillery under slate with a slim chimney (smoke) and a round
granary silo at its west end; in front a giant copper still with head and
pipe, a golden grain heap and a pyramid of spirit barrels. 12 voxels per
tile; massing and signature prop in NOTES.md.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor, half-timber and terracotta tiles — whatever the unlock tier;
the special roofs and signature props are unchanged.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("wheat", 1.1)
COPPER = mat("terracotta", 1.3)

def build(ctx):
    v = ctx.vox()  # 60 × 72
    seed = 157
    K.ground(v, 30, 57, 27, 17, seed, "paved")
    h = K.workshop(v, 6, 6, 60 - 6, 36, 2, "e", seed, door=("y+", 28), smoke=True, chim=(46, 10), wins=[], out="silo")
    K.still(v, 16, 50, m=COPPER, r=7)
    K.pile(v, 34, 44, 1, 12, 8, 7, GOODS, seed)
    for row, n in enumerate((5, 4, 3)):
        for i in range(n):
            P.barrel(v, 8 + i * 4 + row * 2, 64, 1 + row * 4, h=4, m=mat("timber", 1.3))
    P.handcart(v, 8, 60, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 66, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
