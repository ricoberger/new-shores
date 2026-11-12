"""
Fountain (2 × 2, D-077 §2, Merchants, `look: civic`): a round basin of
dressed stone (a coursed rim with a lighter coping) filled with water to a
hand below the rim, a stepped octagonal pedestal in the middle with a small
upper bowl and a jet — a column of water voxels topped by foam that falls
back as a few droplets. 8 voxels per tile; no ground paint.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import FOAM, STONE, STONE_DARK, STONE_LIGHT

WATER = mat("shallows", 0.95)
JET = mat("shallows", 1.35)


def build(ctx):
    v = ctx.vox()  # 16 × 16
    c = 8.0
    O.disc(v, c, c, 7.5, 0, 2, O.ASHLAR_DARK)  # the foot of the basin
    O.ring(v, c, c, 7.5, 5.6, 2, 6, O.ASHLAR)
    O.ring(v, c, c, 7.5, 5.0, 6, 7, O.CAP)  # the coping
    O.disc(v, c, c, 5.6, 2, 4, O.ASHLAR_DARK)
    O.disc(v, c, c, 5.6, 4, 5, WATER)
    # The pedestal: a drum, a slimmer shaft, an upper bowl.
    O.disc(v, c, c, 2.6, 5, 8, O.ASHLAR)
    O.disc(v, c, c, 1.6, 8, 11, O.ASHLAR_DARK)
    O.ring(v, c, c, 3.6, 2.4, 11, 12, O.ASHLAR)
    O.disc(v, c, c, 2.4, 11, 12, WATER)
    O.disc(v, c, c, 1.2, 11, 12, O.CAP)
    # The jet and its spray.
    v.box(7, 7, 12, 9, 9, 17, JET)
    v.box(7, 7, 17, 9, 9, 18, FOAM)
    for x, y in ((6, 7), (6, 8), (9, 7), (9, 8), (7, 6), (8, 6), (7, 9), (8, 9)):
        v.set(x, y, 17, FOAM)
        v.set(x, y, 16, JET)
    return P.colour_jitter(v, seed=7)
