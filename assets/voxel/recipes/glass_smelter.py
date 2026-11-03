"""
Glass smelter (4 × 6; V7 rework, tier IV): a battered ashlar furnace tower with a
glowing mouth and a slim stack (smoke) beside a cream-plaster casting hall
under slate, stacked sheets of pale green glass, a heap of sand, a cart. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("shallows", 1.4)
GLOW = mat("ochre", 1.8)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 147
    K.ground(v, 24, 50, 20, 18, seed, "paved")
    K.furnace(v, 14, 18, glow=GLOW)
    K.workshop(v, 26, 8, 44, 34, 4, "a", seed, door=("x-", 22), wins=[])
    for i in range(3):
        v.box(30, 40 + i * 4, 1, 40, 43 + i * 4, 3, GOODS)
    v.box(30, 40, 3, 38, 43, 5, GOODS)
    K.pile(v, 4, 44, 1, 8, 6, 4, mat("iron", 0.6), seed)
    P.handcart(v, 28, 60, 1, along="x", load=GOODS)
    v.anchor("cart", 34, 68, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
