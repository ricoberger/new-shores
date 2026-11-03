"""
Salt works (4 × 6; V7 rework after the Anno 1404 salt processing, tier III):
a tall stone-and-timber boiling house under dark burgundy tiles with a slim
chimney (smoke), a round copper evaporation pan on a hearth at its flank, a
long shallow trough of brine, big white heaps of salt, salt barrels and a
cart. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

SALT = mat("foam")
BRINE = mat("shallows", 1.25)
COPPER = mat("terracotta", 1.2)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 117
    K.ground(v, 24, 48, 20, 20, seed)
    K.workshop(v, 18, 6, 44, 34, 3, "b", seed, door=("y+", 24), smoke=True, chim=(38, 10), wins=[])
    # Round copper pan on a stone hearth.
    v.ellipsoid(10, 20, 0, 8, 8, 5, lambda x, y, z: mat("stone", 0.85), keep=lambda x, y, z: z >= 1 and z <= 4)
    v.ellipsoid(10, 20, 3, 6.5, 6.5, 2.5, lambda x, y, z: COPPER, keep=lambda x, y, z: z >= 4)
    v.ellipsoid(10, 20, 4, 5, 5, 1.2, lambda x, y, z: BRINE, keep=lambda x, y, z: z >= 5)
    # Brine trough, salt heaps, barrels, cart.
    P.trough(v, 14, 40, 1, length=14, along="x", water=False)
    v.box(14, 41, 2, 28, 43, 3, BRINE)
    V.heap(v, 10, 52, r=6, h=7, m=SALT, seed=seed)
    V.heap(v, 26, 56, r=5, h=5, m=SALT, seed=seed + 1)
    P.cask(v, 36, 44, 1, lid=SALT)
    P.cask(v, 40, 44, 1, lid=SALT)
    P.handcart(v, 32, 60, 1, along="x", load=SALT)
    v.anchor("cart", 38, 68, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
