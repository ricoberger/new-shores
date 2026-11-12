"""
Pastry kitchen (4 × 5; V7 variety pass, tier III): an L-plan stone-and-
timber bakehouse with a slim chimney (smoke); in front a big striped awning
over a long display of golden pastries and a brick-accent oven with a round
dome. 12 voxels per tile; massing and signature prop in NOTES.md.
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

GOODS = mat("ochre", 1.45)
PINK = mat("terracotta", 1.5)

def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 211
    K.ground(v, 24, 48, 21, 14, seed)
    h = K.workshop(v, 6, 6, 48 - 6, 30, 2, "c", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    V.face_awning(h.face("y+"), 28, 44, 10, depth=5)
    v.box(8, 40, 1, 40, 46, 5, TIMBER_LIGHT)
    for i, x in enumerate(range(9, 39, 5)):
        v.box(x, 41, 5, x + 4, 45, 8, GOODS if i % 2 else PINK)
    K.kiln(v, 30, 50, 1, w=14, d=8, h=11)
    P.sacks(v, 8, 52, 1, n=4, m=CANVAS)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
