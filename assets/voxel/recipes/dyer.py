"""
Dyer (4 × 5; V7 variety pass, tier III): a stone-and-timber dye house with
an open work bay and a slim chimney (smoke); in front big vats of blue, red
and yellow dye and a tall frame hung with swaying dyed cloth. 12 voxels per
tile; massing and signature prop in NOTES.md.
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
SAIL = (P.cloth(GOODS), P.cloth(RED), P.cloth(YEL))

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 203
    K.ground(v, 24, 48, 21, 14, seed)
    h = K.workshop(v, 6, 6, 48 - 6, 30, 3, "d", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    for x, liq in ((9, GOODS), (23, RED), (37, YEL)):
        V.vat(v, x, 38, 1, r=5, h=7, m=mat("timber", 0.9), liquid=liq)
    V.drying_frame(v, 4, 44, 54, 1, 15, SAIL, post=TIMBER_DARK, every=8, drop=12)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
