"""
City guard (4 × 4; V7 rework after the Anno 1404 Bailiwick, tier II): a
tall stone-and-timber block with a rubble ground floor, a framed upper
storey under terracotta tiles, two square corner turrets with pointed
caps and a crenellated gate arch in a low forecourt wall; a guard box, a
banner and a weapon rack in the yard. 12 voxels per tile.
"""

from nsvoxel import detail_d060 as D
from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import IRON, STONE, TERRACOTTA, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BANNER = mat("dye-blue", 1.1)
SAND = mat("cliff-upper")  # the Bailiwick is warm sandstone (D-062)


def build(ctx):
    v = ctx.vox()  # 48 × 48
    seed = 23
    K.ground(v, 24, 36, 18, 11, seed)
    h = K.hall(v, 8, 6, 40, 30, 2, "x", seed, door=("y+", 22), windows=True, wins=[11, 30], stone=SAND, plinth=SAND)
    # Two square corner turrets with pointed caps.
    for tx in (4, 38):
        W.coursed_stone_2(v, tx, 26, tx + 6, 32, 2, 21, SAND, seed + tx)
        V.cone_roof(v, tx + 3, 29, 4.5, 21, TERRACOTTA, rise=1.2, tip=IRON)
        P.casement(P.Face(v, "y+", 31), tx + 2, 9, 2, 4, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    # The forecourt wall with a gate.
    K.low_wall(v, 4, 44, 20, 46, 3, seed, SAND)
    K.low_wall(v, 28, 44, 44, 46, 3, seed + 1, SAND)
    v.box(20, 44, 1, 22, 46, 8, SAND)
    v.box(26, 44, 1, 28, 46, 8, SAND)
    v.box(20, 44, 8, 28, 46, 9, TIMBER_DARK)
    D.guard_box(v, 36, 36, 1)
    v.box(12, 36, 1, 13, 37, 14, TIMBER_DARK)
    v.box(13, 36, 8, 17, 37, 14, BANNER)
    P.tool_rack(P.Face(v, "y+", 29), 14, 2, n=3)
    v.anchor("door", 24, 31, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
