"""
Statue (2 × 2, D-077 §2, Merchants, `look: civic`): a robed figure of pale
stone on a two-stage ashlar plinth with a moulded cap, one arm raised with a
scroll, a cloak behind. The warm stone of the town, never a cold grey
(ART_DIRECTION §2). 8 voxels per tile; no ground paint.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import PLASTER, STONE_LIGHT

FIG = mat("stone", 1.12)
FIG_HI = mat("stone", 1.25)
CLOAK = mat("stone", 0.98)


def build(ctx):
    v = ctx.vox()  # 16 × 16
    O.ashlar_box(v, 2, 2, 14, 14, 0, 2, O.ASHLAR_DARK, course=1)  # the lower step
    O.ashlar_box(v, 3, 3, 13, 13, 2, 4, O.ASHLAR, course=2)
    O.ashlar_box(v, 5, 5, 11, 11, 4, 8, O.ASHLAR, course=2)
    v.box(4, 4, 8, 12, 12, 9, O.CAP)  # the moulded cap
    v.box(5, 5, 9, 11, 11, 10, O.ASHLAR)
    hand = O.figure(v, 8, 6, 10, 1, FIG, hi=FIG_HI, face=mat("stone", 0.8), arm="up", cloak=CLOAK)
    x, y, z = hand
    v.box(x, y, z, x + 1, y + 1, z + 3, mat("canvas", 1.1))  # the scroll in the raised hand
    return P.colour_jitter(v, seed=11)
