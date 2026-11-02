"""
Tavern (4 × 6; V7 rework after the in-game tavern and the Anno 1404 bar,
tier II): a half-timbered inn gabled to the street, rubble ground floor
with a round-arched open arcade along the west flank, jettied framed
storey with shuttered casements under a terracotta roof and a slim
chimney (smoke); in the yard a big barrel cart, stacked barrels, a long
table with benches, a beer banner on a pole. 12 voxels per tile; dirt in
one rounded patch, the rest is grass.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BANNER = mat("ochre", 1.15)
ALE = mat("timber", 1.45)  # the pale new barrels


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 17
    K.ground(v, 28, 46, 19, 24, seed)
    h = K.hall(v, 5, 6, 29, 52, 2, "y", seed, door=("y+", 15), chimney=True, chim=(8, 10), windows=True, wins=[])
    W.round_arcade(h.face("x-"), 10, 44, 2, 8, bay=6, pier=2, depth=3, pier_m=P.DRESSED)
    # Barrel cart and stacked barrels east of the inn.
    P.handcart(v, 31, 62, 1, along="x", load=ALE)
    v.anchor("cart", 36, 68, 1)
    for i, (x, y) in enumerate(((33, 54), (36, 54), (39, 54), (34, 57), (37, 57))):
        P.barrel(v, x, y, 1, h=4, m=ALE)
    P.barrel(v, 35, 55, 5, h=4, m=ALE)
    # A long table with benches and a banner on a pole in front.
    v.box(8, 60, 3, 22, 63, 4, TIMBER_LIGHT)
    for x in (9, 20):
        v.box(x, 61, 1, x + 1, 62, 3, TIMBER_DARK)
    P.bench(v, 8, 58, length=14)
    P.bench(v, 8, 64, length=14)
    v.box(26, 58, 1, 27, 59, 16, TIMBER_DARK)
    v.box(27, 58, 9, 31, 59, 15, BANNER)
    P.barrel(v, 41, 60, 1, h=4, m=ALE)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
