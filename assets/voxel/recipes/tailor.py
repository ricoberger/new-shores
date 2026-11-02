"""
Tailor (4 × 5; V7 rework after the Anno 1404 furrier's workshop, tier III):
a half-timbered workshop gabled to the street (stone ground floor, framed
storey, dark burgundy tiles) with a hanging sign, pelts and furs stretched
in hide frames and hung on drying racks in the yard, a tanning tub and a
cart of cloth. No chimney: the tailor makes no smoke. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import mat
from nsvoxel.mats import TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

FUR = mat("ochre", 1.2)
FUR_DARK = mat("timber", 1.1)
FUR_LIGHT = mat("canvas", 1.2)
CLOTH = mat("dye-blue", 1.15)


def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 61
    K.ground(v, 24, 40, 20, 17, seed)
    h = K.hall(v, 6, 5, 30, 28, 3, "y", seed, door=("y+", 16), wins=[])
    P.trade_sign(h.face("y+"), 24, 10, mat("dye-blue", 1.0))
    # Hide frames with pelts along the east and across the yard, a drying rack with furs.
    V.hide_frame(v, 34, 8, 1, 6, 6, FUR, frame=TIMBER_DARK, along="y")
    V.hide_frame(v, 34, 18, 1, 6, 6, FUR_DARK, frame=TIMBER_DARK, along="y")
    V.hide_frame(v, 10, 36, 1, 6, 7, FUR_LIGHT, frame=TIMBER_DARK)
    V.hide_frame(v, 20, 36, 1, 6, 7, FUR, frame=TIMBER_DARK)
    V.drying_frame(v, 8, 40, 52, 1, 9, (FUR, FUR_DARK, FUR_LIGHT), post=TIMBER_DARK, every=6, drop=7)
    P.cask(v, 36, 36, 1, h=4, lid=FUR_DARK)
    P.cask(v, 40, 36, 1, h=4, lid=FUR)
    K.pile(v, 36, 42, 1, 6, 4, 3, CLOTH, seed)
    P.handcart(v, 8, 44, 1, along="x", load=CLOTH)
    v.anchor("cart", 14, 50, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
