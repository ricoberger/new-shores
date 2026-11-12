"""
Dyer works (5 × 5; V7 variety pass, tier III): a wide stone-and-timber dye
works with a slim chimney (smoke); in front four big dye vats and two tall
frames of swaying dyed cloth. 12 voxels per tile; massing and signature prop
in NOTES.md.
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

GOODS = mat("dye-blue", 1.2)
RED = mat("terracotta", 1.2)
YEL = mat("ochre", 1.5)
GRN = mat("grass-b", 1.0)
SAIL = (P.cloth(GOODS), P.cloth(RED), P.cloth(YEL), P.cloth(GRN))

def build(ctx):
    v = ctx.vox()  # 60 × 60
    seed = 207
    K.ground(v, 30, 47, 27, 15, seed)
    h = K.workshop(v, 6, 6, 60 - 6, 28, 2, "a", seed, door=("y+", 28), smoke=True, chim=(46, 10), wins=[])
    for x, liq in ((10, GOODS), (23, RED), (36, YEL), (49, GRN)):
        V.vat(v, x, 38, 1, r=5, h=7, m=mat("timber", 0.9), liquid=liq)
    V.drying_frame(v, 4, 56, 50, 1, 15, SAIL, post=TIMBER_DARK, every=7, drop=12)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
