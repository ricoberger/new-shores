"""
School (6 × 8; V7 rework, tier II; no 1404 render): a long schoolhouse
with a rubble ground floor and quoins, a half-timbered storey with tall
casements and shutters under terracotta tiles with dormers and a slim
chimney, buttress-like piers and string-course relief on the flanks, a
bell cote with a brass bell over the front gable, a porch with steps; a
fenced schoolyard with a well, benches, a slate board on an easel and a
tree. 12 voxels per tile; dirt in the yard, the rest grass.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BOARD = mat("slate", 0.8)


def build(ctx):
    v = ctx.vox()  # 72 × 96
    seed = 11
    K.ground(v, 36, 74, 28, 18, seed)
    h = K.hall(v, 8, 6, 64, 54, 2, "x", seed, door=("y+", 32), chimney=True, chim=(14, 12), wins=[12, 22, 42, 52])
    for a in (6, 24, 42):  # dormers
        W.dormer(v, h.roof, a, a + 6, "y+", wall=mat("plaster"), frame=TIMBER_LIGHT, course=3, h=6)
    # Bell cote on the front ridge.
    bz = h.ridge
    for dx in (0, 4):
        v.box(34 + dx, 28, bz, 35 + dx, 29, bz + 8, TIMBER_DARK)
    v.box(34, 28, bz + 7, 39, 29, bz + 8, TIMBER)
    v.box(35, 28, bz + 3, 38, 29, bz + 6, BRASS)
    # The porch.
    P.fill(v, 28, 54, 44, 60, 1, 2, STONE)
    W.plank_shed(v, 28, 54, 44, 60, wall=7, along="y", door="y+", m=TIMBER_LIGHT, kind="tiles", seed=seed)
    # Schoolyard: fence, well, benches, a board, a tree.
    P.fence_ring(v, 6, 60, 66, 92, kind="rail", gaps={(35, 91), (36, 91), (37, 91), (38, 91)}, seed=seed)
    P.well(v, 14, 72, 1)
    for x in (30, 46):
        P.bench(v, x, 78, length=8)
        P.bench(v, x, 84, length=8)
    v.box(52, 70, 1, 53, 71, 8, TIMBER)
    v.box(58, 70, 1, 59, 71, 8, TIMBER)
    v.box(52, 70, 4, 59, 71, 9, BOARD)
    P.fruit_tree(v, 60, 82, 1, seed=seed)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
