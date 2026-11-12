"""
Well (1 × 1, D-077 §2, Settlers, `look: civic`): a round stone ring of
coursed fieldstone round dark water, two timber posts carrying a windlass
with its crank and a rope and bucket, under a little thatched gable roof.
8 voxels per tile; no ground paint.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import IRON, PLANK, STONE, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

WATER = mat("shallows", 0.8)
THATCH = mat("thatch", 0.8)


def build(ctx):
    v = ctx.vox()  # 8 × 8
    seed = 5
    cx = cy = 4.0
    O.ring(v, cx, cy, 3.5, 2.0, 0, 3, STONE)
    O.disc(v, cx, cy, 2.0, 0, 1, mat("stone", 0.6))
    O.disc(v, cx, cy, 2.0, 1, 2, WATER)
    O.ring(v, cx, cy, 3.5, 2.4, 3, 4, STONE_LIGHT)  # the coping
    # Two posts on the ring either side, a windlass between them, the roof on top.
    for y in (2, 5):
        v.box(0 if False else 1, y, 3, 2, y + 1, 10, TIMBER)
        v.box(6, y, 3, 7, y + 1, 10, TIMBER)
    for x in range(1, 7):
        v.set(x, 3, 6, TIMBER_LIGHT)  # the windlass roll
        v.set(x, 4, 6, TIMBER_LIGHT)
    v.set(7, 3, 6, TIMBER_DARK)  # the crank
    v.set(7, 3, 7, TIMBER_DARK)
    v.set(7, 3, 8, IRON)
    v.set(4, 3, 5, PLANK)  # the rope and the bucket
    v.set(4, 3, 4, PLANK)
    v.box(3, 3, 2, 5, 4, 4, TIMBER_DARK)
    r = P.roof(v, 0, 8, 1, 7, 10, "thatch", along="x", rise=1.0, ov=0, gable=TIMBER, seed=seed, m=THATCH)
    return P.colour_jitter(v, seed=seed)
