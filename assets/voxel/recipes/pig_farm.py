"""
Pig farm (3 × 4; V7 rework after the Anno 1404 pig farm, tier II): a big
barn of a rubble ground floor, half-timber and a tiled roof with two wide
open barn doors and a slim chimney (smoke), a lean-to feed store with
crates, a long feeding trough, hay and a low field-stone wall; dirt in
one rounded patch round the doors. 12 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

HAY = mat("thatch", 1.3)
SLOP = mat("hemp", 1.2)


def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 31
    K.ground(v, 20, 28, 15, 18, seed)
    h = K.workshop(v, 12, 5, 34, 27, 2, "b", seed, door=("y+", 28), smoke=True, chim=(26, 9), wins=[])
    W.gate(h.face("y+"), 14, 8, 9, frame=P.DRESSED)  # the wide barn doors
    P.casement(h.face("y+"), 24, 4, 3, 4, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    # A lean-to feed store with crates at the west gable.
    K.lean(v, 2, 12, 8, 24, 9, "x-", tier=2)
    K.crates(v, ((4, 10, 1), (4, 14, 1), (7, 10, 1), (4, 18, 1), (7, 18, 1), (5, 12, 3)))
    # Feeding trough, hay, wall.
    P.trough(v, 12, 34, 1, length=10, along="x")
    K.pile(v, 28, 36, 1, 7, 5, 5, HAY, seed)
    K.pile(v, 2, 30, 1, 5, 4, 3, HAY, seed + 1)
    K.pig(v, 14, 32, 1)
    K.pig(v, 22, 38, 1, along='y')
    K.pig(v, 8, 38, 1, tone=0.9)
    P.handcart(v, 18, 40, 1, along="x", load=HAY)
    v.anchor("cart", 22, 46, 1)
    K.low_wall(v, 2, 44, 12, 46, 3, seed)
    K.low_wall(v, 24, 44, 34, 46, 3, seed + 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
