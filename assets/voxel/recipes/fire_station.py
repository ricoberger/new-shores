"""
Fire station (4 × 5; V7 rework after the Anno 1404 fire station, tier III):
a stone-and-timber engine house under dark burgundy tiles with two big
arched engine doors, an open timber bell frame on the ridge, a water tank
on a trestle platform with a ladder, buckets and a hose cart in the yard.
12 voxels per tile; dirt only in front of the doors.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, IRON, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

WATER = mat("dye-blue", 1.2)


def build(ctx):
    v = ctx.vox()  # 48 × 60
    seed = 29
    K.ground(v, 26, 46, 18, 12, seed)
    h = K.workshop(v, 12, 6, 44, 34, 3, "a", seed, door=("y+", 36), windows=True, wins=[16])
    for a in (17, 27):  # two engine doors
        W.gate(h.face("y+"), a, 7, 9, frame=P.DRESSED, arch=True)
    # The bell frame on the ridge.
    bz = h.ridge
    for dx in (0, 4):
        for dy in (0, 4):
            v.box(26 + dx, 16 + dy, bz, 27 + dx, 17 + dy, bz + 7, TIMBER_DARK)
    v.box(26, 16, bz + 6, 31, 21, bz + 7, TIMBER)
    v.box(27, 17, bz + 2, 30, 20, bz + 5, BRASS)
    # The water tank on a trestle platform with a ladder, west of the station.
    for x in (2, 9):
        for y in (14, 24):
            v.box(x, y, 1, x + 2, y + 2, 9, TIMBER_DARK)
    v.box(2, 14, 9, 11, 26, 10, TIMBER_LIGHT)
    P.cask(v, 3, 16, 10, h=6, lid=WATER)
    P.cask(v, 7, 20, 10, h=6, lid=WATER)
    P.ladder(P.Face(v, "x+", 11), 20, 1, 9)
    P.barrel(v, 16, 42, 1, h=3)
    P.barrel(v, 19, 42, 1, h=3)
    P.handcart(v, 28, 40, 1, along="x", load=WATER)
    v.anchor("door", 26, 35, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
