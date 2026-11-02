"""
Clay pit (4 × 6; V7 rework, tier III; no 1404 render): a raised bank round
a pit with layered orange clay faces and wet clay in the floor, wooden
walkways and a ladder, heaps of clay and a barrow, a stack of tile blanks
drying on a rack under a tiled shed, a stone-and-timber hut under dark
burgundy tiles. No chimney. 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel.grid import hash3, mat
from nsvoxel.mats import MOSS, PLANK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

CLAY = mat("terracotta", 1.1)
CLAY_DARK = mat("terracotta", 0.8)
WET = mat("terracotta", 0.65)
TURF = mat("grass-b", 0.8)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 97
    # The bank: a rim ring two to three voxels high round a clay floor.
    for x in range(0, 48):
        for y in range(0, 34):
            edge = min(x, 47 - x, y, 33 - y)
            if edge < 5:
                h = 3 + (1 if hash3(x // 2, y // 2, 0, seed) < 0.4 else 0)
                for z in range(h):
                    v.set(x, y, z, TURF if z == h - 1 else (CLAY_DARK if z % 2 else CLAY))
            else:
                v.set(x, y, 0, WET if hash3(x, y, 2, seed) < 0.7 else CLAY_DARK)
    V.heap(v, 34, 20, r=5, h=5, m=CLAY, seed=seed)
    V.heap(v, 14, 20, r=4, h=4, m=CLAY_DARK, seed=seed + 1)
    for x in (22, 26):
        v.box(x, 6, 3, x + 1, 30, 4, PLANK)
    v.box(22, 6, 3, 27, 7, 4, PLANK)
    P.ladder(P.Face(v, "x-", 5), 14, 1, 4)
    # Tile blanks drying under a tiled shed.
    K.ground(v, 14, 50, 12, 10, seed)
    K.lean(v, 4, 24, 38, 50, 11, "y+", tier=3)
    for x in range(6, 22, 4):
        v.box(x, 40, 1, x + 3, 48, 3, CLAY)
        v.box(x, 40, 3, x + 3, 48, 4, CLAY_DARK)
    K.hall(v, 26, 38, 46, 58, 3, "y", seed, door=("x-", 44), wins=[])
    P.handcart(v, 8, 60, 1, along="x", load=CLAY)
    v.anchor("cart", 14, 66, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
