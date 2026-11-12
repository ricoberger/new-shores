"""
Tree ornament (1 × 1, D-077 §2, `look: civic`; three variants): a single
specimen tree for town squares and gardens, chosen by the building's seed —
variant 0 a lime (tall oval crown of light fresh green on a slim trunk),
variant 1 an oak (a broad, dark crown over a stout trunk with two heavy
limbs), variant 2 a pollarded willow (a short knobbly trunk with a round
head of thin yellow-green shoots and a few strands hanging down). 8 voxels
per tile, no ground paint: the grass is the terrain's.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import CROWN, FLOWER, GRASS_A, GRASS_B, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VARIANTS = 3

LIME = mat("grass-a", 0.95)
OAK = mat("tree-crown", 0.95)
WILLOW = mat("grass-b", 1.22)
WILLOW_DARK = mat("grass-b", 1.0)


def crown(v, cx, cy, cz, rx, ry, rz, m, seed, rough=0.5, lo=None):
    """A ragged leaf mass: an ellipsoid of cell centres with a hashed rim, sunlit tops and a darker underside."""
    cells = set()
    for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for z in range(max(0, int(cz - rz) - 1), int(cz + rz) + 2):
                d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2
                if d <= 1.0 + (hash3(x, y, z, seed) - 0.5) * rough:
                    cells.add((x, y, z))
    low = cz - rz * 0.35 if lo is None else lo
    for x, y, z in cells:
        if (x, y, z + 1) not in cells:
            f = 1.12 if hash3(x // 2, y // 2, z, seed + 3) < 0.55 else 1.04
        elif z + 0.5 < low:
            f = 0.82
        else:
            f = 1.0 if hash3(x // 2, y // 2, z // 2, seed + 5) < 0.7 else 0.92
        v.set(x, y, z, shade_of(m, f))
    return cells


def build(ctx):
    v = ctx.vox()  # 8 × 8
    k = ctx.variant
    seed = 31 + k
    if k == 0:  # lime: slim trunk, tall oval crown
        v.box(3, 3, 0, 5, 5, 5, TIMBER_DARK)
        v.set(3, 3, 0, TIMBER)
        crown(v, 4, 4, 10.5, 3.3, 3.3, 5.0, LIME, seed, lo=7.5)
        crown(v, 4.6, 3.6, 12.5, 2.2, 2.2, 2.4, LIME, seed + 1)
    elif k == 1:  # oak: stout trunk, two limbs, a broad dark crown
        v.box(3, 3, 0, 5, 5, 5, TIMBER_DARK)
        for x, y in ((2, 3), (5, 4), (3, 5), (4, 2)):
            v.set(x, y, 0, TIMBER)
        v.line((3, 3, 4), (1, 3, 7), TIMBER_DARK)
        v.line((4, 4, 4), (6, 4, 7), TIMBER_DARK)
        crown(v, 4, 4, 8.4, 4.0, 4.0, 3.4, OAK, seed, rough=0.6, lo=6.6)
        crown(v, 3.0, 4.4, 10.6, 2.4, 2.4, 1.9, OAK, seed + 2)
        crown(v, 5.4, 3.6, 10.2, 2.2, 2.2, 1.8, OAK, seed + 3)
    else:  # pollarded willow: knobbly stump, a round head of shoots, hanging strands
        v.box(3, 3, 0, 5, 5, 4, TIMBER)
        v.box(2, 2, 4, 6, 6, 6, TIMBER_DARK)
        for x, y in ((2, 2), (5, 2), (2, 5), (5, 5)):
            v.box(x, y, 6, x + 1, y + 1, 8, TIMBER_LIGHT)  # the pollard's stubs
        cells = crown(v, 4, 4, 9.2, 3.6, 3.6, 2.8, WILLOW, seed, rough=0.9, lo=7.5)
        for x, y in ((1, 3), (2, 6), (6, 5), (5, 1), (3, 1), (6, 2)):
            for z in range(5, 8):
                if (x, y, z) not in cells:
                    v.set(x, y, z, WILLOW_DARK if z < 7 else WILLOW)
    return P.colour_jitter(v, seed=seed)
