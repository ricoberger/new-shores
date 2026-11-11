"""
Brewery (5 × 6; V7 rework after the Anno 1404 brewery, tier III): a long
stone-and-timber brewhouse under terracotta tiles with a slim chimney
(smoke), a round copper-capped kettle tower at its west corner, a big
stack of pale new barrels and rows of barrels on the cobbled-over yard,
a loading hatch with a hoist and a cart. 12 voxels per tile.
Re-dressed in the workshop look (D-075 §3, `look: workshop`): the tier-II look —
rubble ground floor, half-timber and terracotta tiles — whatever the unlock tier;
the special roofs and signature props are unchanged.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import STONE

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

ALE = mat("timber", 1.45)  # pale barrels
CAP = mat("hemp", 0.85)  # verdigris


def build(ctx):
    v = ctx.vox()  # 60 × 72
    seed = 67
    K.ground(v, 34, 48, 24, 20, seed)
    h = K.workshop(v, 22, 6, 54, 34, 2, "b", seed, door=("y+", 40), smoke=True, chim=(46, 10), wins=[26])
    W.loft_door(v, 33, 28, 12, w=5, h=6, frame=P.DRESSED, side="y+", length=6, rope=6)
    # Round kettle tower at the west corner with a copper cone.
    V.round_tower(v, 12, 22, 8, 1, 22, m=STONE, seed=seed)
    V.cone_roof(v, 12, 22, 8.6, 22, CAP, rise=1.2, tip=CAP)
    v.box(10, 29, 1, 14, 31, 8, mat("timber", 0.5))  # the door
    # Barrels: a big pale pyramid, rows on the yard, a cart.
    for i in range(5):
        P.barrel(v, 30 + i * 4, 44, 1, h=4, m=ALE)
    for i in range(4):
        P.barrel(v, 32 + i * 4, 44, 5, h=4, m=ALE)
    for i in range(3):
        P.barrel(v, 34 + i * 4, 44, 9, h=4, m=ALE)
    for i in range(6):
        P.barrel(v, 6 + i * 4, 52, 1, h=4, m=ALE)
    for i in range(5):
        P.barrel(v, 8 + i * 4, 52, 5, h=4, m=ALE)
    P.handcart(v, 40, 58, 1, along="x", load=ALE)
    v.anchor("cart", 44, 66, 1)
    K.low_wall(v, 4, 68, 24, 70, 3, seed)
    K.low_wall(v, 36, 68, 56, 70, 3, seed + 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
