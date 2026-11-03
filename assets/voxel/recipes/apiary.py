"""
Apiary (5 × 5; V7 variety pass, tier II): a half-timbered beekeeper's house
with a lean-to shed and a slim chimney (smoke); in front a long open bee
shelter on posts under a plank roof, two shelves of big straw skeps, more
skeps on the grass, flower beds, honey casks and a cart. 12 voxels per tile;
massing and signature prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("thatch", 1.3)

def build(ctx):
    v = ctx.vox()  # 60 × 60
    seed = 181
    K.ground(v, 30, 49, 27, 13, seed)
    h = K.workshop(v, 6, 6, 60 - 6, 32, 2, "b", seed, door=("y+", 28), smoke=True, chim=(46, 10), wins=[])
    for x in (8, 38):
        v.box(x, 38, 1, x + 1, 39, 14, TIMBER_DARK)
        v.box(x, 46, 1, x + 1, 47, 14, TIMBER_DARK)
    v.box(6, 37, 14, 41, 48, 15, mat("timber", 0.9))
    v.box(8, 38, 6, 39, 47, 7, TIMBER)
    for x in range(10, 38, 6):
        K.hive(v, x, 40, 7)
        K.hive(v, x, 40, 1)
    for x in range(8, 52, 8):
        K.hive(v, x + 4, 50)
    P.flower_bed(v, 44, 38, 54, 46, 1, seed=seed)
    P.cask(v, 50, 54, 1, lid=mat("ochre", 1.5))
    P.cask(v, 54, 54, 1, lid=mat("ochre", 1.5))
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
