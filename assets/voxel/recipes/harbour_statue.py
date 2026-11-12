"""
Harbour statue (2 × 2 shore, D-077 §2, Merchants, `look: civic`): a stone
figure of a sailor with a raised spyglass on a tall ashlar plinth with an
anchor carved on it, standing on the stone quay plinth of the harbour
buildings (D-078 §3, parts_d078.plinth: slabs under every tile, a dressed
side face into the water, so it stands on the quay, in shallows or on the
beach alike; mooring posts on the three water edges). 8 voxels per tile;
the plinth is the ground of the model (config.SHORE_MODELS, `placement:
shore`).
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel import parts_d078 as Q
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, IRON, STONE_DARK

FIG = mat("stone", 1.12)
FIG_HI = mat("stone", 1.25)
CLOAK = mat("stone", 0.98)


def build(ctx):
    v = ctx.vox()  # 16 × 16
    Q.plinth(v, 0, 0, 16, 16, vpt=8, seed=13)
    O.ashlar_box(v, 3, 3, 13, 13, 1, 3, O.ASHLAR_DARK, course=1)
    O.ashlar_box(v, 4, 4, 12, 12, 3, 5, O.ASHLAR, course=2)
    O.ashlar_box(v, 5, 5, 11, 11, 5, 11, O.ASHLAR, course=2)
    v.box(4, 4, 11, 12, 12, 12, O.CAP)
    v.box(5, 5, 12, 11, 11, 13, O.ASHLAR)
    # The anchor on the front of the plinth (y+ side).
    for z in range(6, 10):
        v.set(8, 10, z, IRON)
    v.box(7, 10, 9, 10, 11, 10, IRON)
    v.box(6, 10, 6, 7, 11, 7, IRON)
    v.box(9, 10, 6, 10, 11, 7, IRON)
    hand = O.figure(v, 8, 6, 13, 1, FIG, hi=FIG_HI, face=mat("stone", 0.8), arm="up", cloak=CLOAK)
    x, y, z = hand
    v.box(x, y, z, x + 1, y + 1, z + 3, BRASS)  # the spyglass
    return P.colour_jitter(v, seed=13)
