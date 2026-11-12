"""
Gold statue (3 × 3, D-077 §2, Patricians, `look: civic`; 12 voxels per
tile): a gilded figure of brass — a robed merchant prince with a raised
sceptre, a cloak and a chain — on a three-step plinth of warm ashlar with a
brass plaque; four low lantern posts with brass cages at the corners of the
lowest step. The one place the brass role is the main material of a model
(D-064).
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, IRON

GOLD = mat("brass", 1.05)
GOLD_HI = mat("brass", 1.3)
GOLD_DARK = mat("brass", 0.8)


def build(ctx):
    v = ctx.vox()  # 36 × 36
    O.ashlar_box(v, 3, 3, 33, 33, 0, 2, O.ASHLAR_DARK, course=1)
    O.ashlar_box(v, 6, 6, 30, 30, 2, 5, O.ASHLAR, course=2)
    O.ashlar_box(v, 9, 9, 27, 27, 5, 8, O.ASHLAR, course=2)
    O.ashlar_box(v, 12, 12, 24, 24, 8, 16, O.ASHLAR, course=2)
    v.box(10, 10, 16, 26, 26, 18, O.CAP)
    v.box(12, 12, 18, 24, 24, 19, O.ASHLAR)
    v.box(15, 24, 10, 21, 25, 13, GOLD)  # the plaque on the front face
    v.box(16, 25, 11, 20, 26, 12, GOLD_DARK)
    # Four low lantern posts with brass cages.
    for x, y in ((5, 5), (30, 5), (5, 30), (30, 30)):
        v.box(x, y, 2, x + 2, y + 2, 7, O.ASHLAR_DARK)
        v.box(x, y, 7, x + 2, y + 2, 9, GOLD_HI)
        v.box(x, y, 9, x + 2, y + 2, 10, IRON)
    hand = O.figure(v, 18, 15, 19, 3, GOLD, hi=GOLD_HI, face=GOLD_DARK, arm="up", cloak=GOLD_DARK)
    x, y, z = hand
    v.box(x + 1, y + 1, z, x + 2, y + 2, z + 8, GOLD_HI)  # the sceptre
    v.box(x, y, z + 8, x + 3, y + 3, z + 10, GOLD)
    return P.colour_jitter(v, seed=17)

VOXELS_PER_TILE = 12
