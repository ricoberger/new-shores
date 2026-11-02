"""
Toolmaker (4 × 4; V7 rework after the Anno 1404 toolmaker's workshop, tier
II): a rubble-and-half-timber smithy under terracotta with an open forge on
its west flank — a stone hearth with a glowing fire and a slim stone chimney
(smoke) — an anvil on a block, a quenching tub, a rack of finished tools,
crates and a cart of tools; paved round the forge. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, STONE, STONE_DARK, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GLOW = mat("ochre", 1.7)
EMBER = mat("terracotta", 1.5)
STEEL = mat("iron", 1.9)


def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 101
    K.ground(v, 20, 30, 18, 16, seed)
    K.hall(v, 16, 4, 44, 26, 2, "x", seed, door=("y+", 26), wins=[20], chimney=False)
    # The open forge at the west: hearth, glowing fire, a tall slim stone stack.
    W.coursed_stone_2(v, 3, 8, 13, 18, 1, 7, STONE, seed)
    v.box(4, 9, 7, 12, 17, 8, STONE_DARK)
    v.box(5, 12, 7, 11, 16, 9, EMBER)
    v.box(6, 13, 7, 10, 15, 10, GLOW)
    W.stack(v, 4, 9, 8, 26, 2, 2)
    v.anchor("chimney", 5.5, 10.5, 26)
    v.anchor("smoke", 5.5, 10.5, 27)
    # Anvil on a block, quenching tub, tool rack, crates.
    v.box(8, 22, 1, 11, 25, 5, TIMBER_DARK)
    v.box(7, 22, 5, 13, 25, 7, IRON)
    v.box(13, 22, 5, 15, 24, 6, IRON)
    P.cask(v, 4, 24, 1, h=5, lid=mat("shallows", 1.0))
    K.crates(v, ((6, 34, 1), (10, 34, 1), (6, 38, 1), (8, 36, 3)))
    for x in range(4, 14, 3):
        v.box(x, 30, 1, x + 1, 31, 7, STEEL)
    P.handcart(v, 24, 34, 1, along="x", load=STEEL)
    v.anchor("cart", 30, 42, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
