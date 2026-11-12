"""
Rendering house (3 × 3; V7 variety pass, tier III): a long stone-and-timber
house with a slim chimney (smoke); in front a giant iron cauldron on a
hearth, a rail hung with dark hides and tallow barrels. 12 voxels per tile;
massing and signature prop in NOTES.md.
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

GOODS = mat("canvas", 1.1)
HIDE = mat("timber", 0.7)

def build(ctx):
    v = ctx.vox()  # 36 × 36
    seed = 217
    K.ground(v, 18, 30, 15, 8, seed)
    h = K.workshop(v, 6, 6, 36 - 6, 18, 2, "a", seed, door=("y+", 16), smoke=True, chim=(22, 10), wins=[])
    V.vat(v, 12, 28, 1, r=6, h=8, m=mat("iron", 0.8), liquid=mat("ochre", 1.2))
    K.rack(v, 20, 32, 24, HIDE, h=15, drop=11)
    P.cask(v, 6, 20, 1, h=5, lid=GOODS)
    v.anchor("cart", 14, 30, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
