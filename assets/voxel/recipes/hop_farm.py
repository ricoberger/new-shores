"""
Hop farm (3 × 4; V7 rework, tier III; no 1404 render): a stone-and-timber
farmhouse under dark burgundy tiles, a yard of tall hop poles hung with
green bines and pale cones, a drying frame with bunches of hops, big
green hop bales and a cart. No chimney. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

HOPS = mat("hemp", 1.0)


def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 79
    K.ground(v, 18, 36, 15, 11, seed)
    h = K.workshop(v, 6, 5, 30, 22, 3, "a", seed, door=("y+", 14), wins=[7, 22])
    for x in range(5, 32, 6):
        for y in (28, 34):
            V.hop_pole(v, x, y, 13, seed)
    V.drying_frame(v, 6, 30, 42, 1, 9, (HOPS,), post=TIMBER_DARK, every=6, sway=False, drop=6)
    K.pile(v, 4, 38, 1, 6, 4, 4, HOPS, seed)
    P.handcart(v, 24, 38, 1, along="x", load=HOPS)
    v.anchor("cart", 28, 46, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
