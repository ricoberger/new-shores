"""
Bakery (4 × 5; V7 rework after the Anno 1404 / Anno 117 bakery, tier II):
a half-timbered bakehouse (rubble ground floor, terracotta tiles, slim
chimney with smoke) with a striped awning over the shop window and a
hanging bread sign; a brick-accent bread oven with a slim brick chimney
against its west flank; in the yard a bread stall with a row of big
golden loaves, flour sacks, firewood and a hand cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, CANVAS, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BREAD = mat("wheat", 1.25)
CRUST = mat("ochre", 1.15)


def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 9
    K.ground(v, 26, 38, 20, 18, seed)
    h = K.hall(v, 14, 6, 44, 28, 2, "x", seed, door=("y+", 32), smoke=True, chim=(36, 10), wins=[])
    f = h.face("y+")
    P.casement(f, 18, 4, 8, 5, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED, bars=False)
    V.face_awning(f, 17, 27, 10, depth=4)
    V.signboard(f, 28, 14, w=4, h=3, colour=CRUST)
    K.kiln(v, 3, 8, 1, w=8, d=8, h=8)
    # Bread stall: a table with a row of big loaves.
    v.box(14, 34, 3, 32, 38, 4, TIMBER_LIGHT)
    for x in (15, 30):
        v.box(x, 35, 1, x + 1, 37, 3, TIMBER_DARK)
    for i, x in enumerate(range(15, 31, 4)):
        v.box(x, 35, 4, x + 3, 37, 6, BREAD if i % 2 else CRUST)
        v.box(x, 35, 6, x + 3, 37, 7, BREAD)
    P.sacks(v, 34, 36, 1, n=3, m=CANVAS)
    P.woodpile(v, 4, 24, 1, length=8, along="y", rows=3)
    P.handcart(v, 20, 46, 1, along="x", load=BREAD)
    v.anchor("cart", 26, 54, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
