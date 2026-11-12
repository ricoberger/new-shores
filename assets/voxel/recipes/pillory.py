"""
Pillory (1 × 1, D-077 §2, Citizens, `look: civic`): a stone-and-plank platform
with two steps, two stout posts with a crossbeam and the hinged double board
with a head hole and two hand holes, an iron hasp; a rotten cabbage on the
platform. 8 voxels per tile; no ground paint.
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, PLANK, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

CABBAGE = mat("grass-b", 1.0)


def build(ctx):
    v = ctx.vox()  # 8 × 8
    v.box(1, 1, 0, 7, 7, 2, STONE)
    v.box(1, 1, 1, 7, 7, 2, STONE_DARK)
    v.box(1, 1, 2, 7, 7, 3, PLANK)
    v.box(3, 7, 0, 5, 8, 1, STONE)  # the step
    v.box(3, 7, 0, 5, 8, 1, STONE_LIGHT)
    for x in (2, 5):  # the posts
        v.box(x, 3, 3, x + 1, 5, 11, TIMBER)
    v.box(2, 3, 10, 6, 5, 11, TIMBER_DARK)  # the head beam
    # The board: two layers with a head hole in the middle and hand holes either side.
    for z in range(5, 8):
        for x in range(2, 6):
            for y in (3, 4):
                if z == 6 and x in (3, 4) and False:
                    continue
                v.set(x, y, z, TIMBER_LIGHT)
    for x, z in ((3, 6), (4, 6)):
        for y in (3, 4):
            v.set(x, y, z, None)
    v.set(3, 4, 6, TIMBER_DARK)
    v.set(4, 4, 6, TIMBER_DARK)
    v.set(2, 3, 6, IRON)
    v.set(5, 3, 6, IRON)
    v.box(5, 5, 3, 6, 6, 4, CABBAGE)
    return P.colour_jitter(v, seed=3)
