"""
Surgery (4 × 6; V7 rework, tier IV, civic): an ashlar ground floor with
tall windows under a brick upper storey and slate, a pedimented front door
(door anchor), no chimney; a green-and-white striped cloth awning over the
front (sway group `cloth`), a barber's pole by the door, a bench, a sign
and a walled herb garden in raised beds with a well on the west. 12 voxels
per tile; paved forecourt.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, TERRACOTTA, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 121
    K.ground(v, 28, 56, 19, 14, seed, "paved")
    h = K.workshop(v, 4, 8, 44, 36, 4, "a", seed, door=("y+", 34), wins=[], upper=mat("terracotta", 0.95), tall=True)
    V.face_awning(h.face("y+"), 26, 42, 9, depth=4, stripes=(P.cloth(CANVAS), P.cloth(mat("grass-b", 0.9))))
    v.anchor("door", 36, 40, 1)
    P.bench(v, 8, 40, length=8)
    v.box(10, 44, 1, 11, 45, 8, TIMBER_DARK)  # the barber's pole
    for z in range(2, 8, 2):
        v.box(10, 44, z, 11, 45, z + 1, CANVAS)
        v.box(10, 44, z + 1, 11, 45, z + 2, mat("terracotta", 1.2))
    for y in (50, 56):
        P.flower_bed(v, 6, y, 22, y + 4, 1, seed=seed)
    P.well(v, 28, 58, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
