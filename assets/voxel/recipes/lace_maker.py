"""
Lace maker (3 × 5; V7 variety pass, tier IV): an L-plan two-storey cream
plaster house under slate (no chimney); in front two tall frames hung with
white lace, a pillow table and a flower bed. 12 voxels per tile; massing and
signature prop in NOTES.md.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.35)

def build(ctx):
    v = ctx.vox()  # 36 × 60
    seed = 159
    K.ground(v, 18, 49, 15, 13, seed, "paved")
    h = K.workshop(v, 6, 6, 36 - 6, 32, 4, "c", seed, door=("y+", 16), wins=[])
    K.rack(v, 4, 32, 38, GOODS, h=18, drop=14)
    K.rack(v, 4, 32, 46, [GOODS, shade_of(GOODS, 0.9)], h=15, drop=11)
    v.box(6, 52, 1, 22, 56, 3, TIMBER_LIGHT)
    K.pile(v, 8, 52, 3, 10, 4, 2, GOODS, seed)
    P.flower_bed(v, 24, 50, 32, 56, 1, seed=seed)
    P.handcart(v, 8, 48, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
