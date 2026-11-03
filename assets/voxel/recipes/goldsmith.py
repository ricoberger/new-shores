"""
Goldsmith (4 × 4; V7 variety pass, tier IV): an L-plan two-storey cream
plaster workshop under slate with a slim chimney (smoke); in front a big
glowing forge hearth, an anvil and a tall stack of bright gold ingots. 12
voxels per tile; massing and signature prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("ochre", 1.7)
GLOW = mat("ochre", 1.9)

def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 153
    K.ground(v, 24, 41, 21, 9, seed, "paved")
    h = K.workshop(v, 6, 6, 48 - 6, 28, 4, "c", seed, door=("y+", 22), smoke=True, chim=(34, 10), wins=[])
    v.box(6, 34, 1, 18, 44, 7, mat("stone", 0.8))
    v.box(8, 36, 7, 16, 42, 9, GLOW)
    W.stack(v, 8, 38, 9, 20, 2, 2)
    v.box(24, 36, 1, 28, 40, 5, TIMBER_DARK)
    v.box(22, 36, 5, 30, 40, 8, IRON)
    K.pile(v, 32, 36, 1, 10, 8, 9, GOODS, seed)
    P.handcart(v, 8, 36, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 42, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
