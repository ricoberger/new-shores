"""
Dyer works (5 × 5; V7 rework, tier III): a wide stone-and-timber dye works
under dark burgundy tiles with a slim chimney (smoke), two rows of big dye
vats in blue, red, yellow and green and two frames of swaying dyed cloth. 12
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

GOODS = mat("dye-blue", 1.2)
RED = mat("terracotta", 1.2)
YEL = mat("ochre", 1.5)
GRN = mat("grass-b", 1.0)
SAIL = (P.cloth(GOODS), P.cloth(RED), P.cloth(YEL), P.cloth(GRN))

def build(ctx):
    v = ctx.vox()  # 60 × 60
    seed = 207
    K.ground(v, 30, 45, 27, 16, seed)
    h = K.hall(v, 6, 6, 60 - 6, 25, 3, "x", seed, door=("y+", 28), smoke=True, chim=(46, 10), wins=[])
    for x, liq in ((10, GOODS), (22, RED), (34, YEL), (46, GRN)):
        V.vat(v, x, 34, 1, r=4, h=5, m=mat("timber", 0.9), liquid=liq)
    V.drying_frame(v, 6, 52, 44, 1, 12, SAIL, post=TIMBER_DARK, every=6, drop=9)
    V.drying_frame(v, 6, 52, 52, 1, 12, SAIL[::-1], post=TIMBER_DARK, every=6, drop=9)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
