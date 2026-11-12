"""
Cemetery (4 × 4, D-077 §2, Merchants, `look: civic`): a churchyard behind a
low coursed fieldstone wall with a timbered lych-gate (a little tiled roof on
four posts) in the middle of the front wall. Three rows of turf mounds with
stone headstones (a round-topped slab, a cross, a plain block) and one timber
cross, a path of dirt (`path()`) running from the gate to a stone cross at
the back, and an old yew in the corner. 8 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import GRASS_A, STONE, STONE_DARK, STONE_LIGHT, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT

YEW = mat("forest-floor", 0.82)
TURF = mat("grass-a", 1.02)
WALL = mat("stone", 0.92)


def headstone(v, x, y, kind, seed):
    m = shade_of(STONE_LIGHT, 0.9 + 0.2 * hash3(x, y, 1, seed))
    if kind == 0:  # round-topped slab
        v.box(x, y, 1, x + 2, y + 1, 4, m)
        v.set(x, y, 4, m)
    elif kind == 1:  # cross
        v.box(x, y, 1, x + 1, y + 1, 5, m)
        v.box(x - 1, y, 3, x + 2, y + 1, 4, m)
    else:  # plain block
        v.box(x, y, 1, x + 2, y + 1, 3, m)


def build(ctx):
    v = ctx.vox()  # 32 × 32
    seed = 67
    # The wall: three courses on all four sides, a gap for the gate in the front (y+) wall.
    for x in range(1, 31):
        for y in (1, 30):
            if y == 30 and 13 <= x <= 18:
                continue
            for z in range(3):
                v.set(x, y, z, WALL if (x + z) % 4 else STONE_DARK)
            v.set(x, y, 3, STONE_LIGHT if hash3(x, y, 3, seed) < 0.7 else None)
    for y in range(2, 30):
        for x in (1, 30):
            for z in range(3):
                v.set(x, y, z, WALL if (y + z) % 4 else STONE_DARK)
            v.set(x, y, 3, STONE_LIGHT if hash3(x, y, 3, seed) < 0.7 else None)
    # The lych-gate: four posts, a beam, a little tiled gable, a plank floor.
    for x in (12, 19):
        for y in (28, 31):
            v.box(x, y, 0, x + 1, y + 1, 8, TIMBER)
    v.box(12, 28, 7, 20, 29, 8, TIMBER_DARK)
    v.box(12, 31, 7, 20, 32, 8, TIMBER_DARK)
    v.box(13, 29, 0, 19, 31, 1, TIMBER_LIGHT)
    P.roof(v, 11, 21, 27, 33, 8, "tiles", along="x", rise=0.9, ov=0, gable=TIMBER_LIGHT, seed=seed, m=TERRACOTTA)
    # The path: from the gate to the back, and a cross path in the middle (dirt).
    path = [(x, y) for x in range(14, 18) for y in range(3, 32)] + [(x, y) for x in range(3, 29) for y in range(15, 17)]
    P.path(v, path, kind="dirt")
    # Graves: three rows left and right of the path (mounds with a stone or a cross at the head).
    k = 0
    for row, y in enumerate((5, 11, 20, 25)):
        for x in (4, 8, 20, 25):
            if y in (11, 20) and y == 99:
                continue
            gy = y
            v.box(x, gy, 0, x + 3, gy + 5, 1, TURF)
            v.box(x + 1, gy + 1, 1, x + 2, gy + 4, 2, shade_of(TURF, 1.08))
            kind = (row + x) % 3
            if (x, row) == (25, 3):
                v.box(x + 1, gy, 1, x + 2, gy + 1, 6, TIMBER)  # a timber cross
                v.box(x, gy, 4, x + 3, gy + 1, 5, TIMBER)
            else:
                headstone(v, x + 1 - (kind == 0) * 0, gy, kind, seed + k)
            k += 1
    # A stone cross at the back, centred on the path.
    v.box(14, 3, 0, 18, 5, 2, STONE_DARK)
    v.box(15, 3, 2, 17, 4, 9, STONE_LIGHT)
    v.box(13, 3, 6, 19, 4, 8, STONE_LIGHT)
    # The yew in the back corner: a dark rounded crown on a short trunk.
    v.box(25, 4, 0, 27, 6, 4, TIMBER_DARK)
    v.ellipsoid(26, 5, 8, 4.4, 4.2, 4.6, lambda x, y, z: shade_of(YEW, 1.0 if hash3(x, y, z, seed) < 0.7 else 0.9))
    return P.colour_jitter(v, seed=seed)
