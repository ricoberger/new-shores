"""
Thread spinner (3 × 4; V7 variety pass, tier IV): a two-storey cream plaster
house with an open work bay under slate (no chimney); under it a giant
spinning wheel on a stand, a tall rack of coloured skeins and wool bales. 12
voxels per tile; massing and signature prop in NOTES.md.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor, half-timber and terracotta tiles — whatever the unlock tier;
the special roofs and signature props are unchanged.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.3)
SKEIN = mat("dye-blue", 1.2)
SKEIN2 = mat("terracotta", 1.2)

def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 169
    K.ground(v, 18, 42, 15, 8, seed, "paved")
    h = K.workshop(v, 6, 6, 36 - 6, 30, 2, "d", seed, door=("y+", 16), wins=[])
    Q.wheel(v, 12, 42, 11, 9, plane="xz")
    v.box(10, 42, 1, 15, 43, 3, TIMBER_DARK)
    v.box(12, 42, 1, 13, 43, 12, TIMBER_DARK)
    K.rack(v, 22, 32, 38, [SKEIN, SKEIN2, GOODS], h=9, drop=6)
    K.pile(v, 6, 36, 1, 8, 5, 5, GOODS, seed)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
