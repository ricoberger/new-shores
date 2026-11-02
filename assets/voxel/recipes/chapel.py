"""
Chapel (3 × 5; V7 rework after the Anno 1404 / Anno 117 chapel, tier I): a
long nave of dark rubble with pale dressed quoins, buttresses and lancet
windows under weathered thatch, a gabled timber porch with a pointed door
over a stone step, a small timber bell turret with a brass bell and a
thatched cone on the nave's front ridge, a low churchyard wall with a lych
gap, gravestones, a conifer and flowers. Rubble (not boards) is the civic
exception of tier I: it makes the chapel the first rung of the
chapel → church → cathedral ladder. 12 voxels per tile; the ground is grass
with a worn dirt path to the porch.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, CROWN, FLOWER, STONE, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WINDOW

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

WALL = mat("stone", 0.86)


def build(ctx):
    v = ctx.vox()  # 36 × 60
    seed = 5
    K.ground(v, 18, 52, 9, 7, seed)  # the worn path before the porch
    x0, y0, x1, y1 = 8, 6, 28, 44
    P.plinth(v, x0, y0, x1, y1, 1, STONE_LIGHT, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_LIGHT)
    W.coursed_stone_2(v, x0, y0, x1, y1, 2, 13, WALL, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, 13)
    r = P.roof(v, x0, x1, y0, y1, 13, "thatch", along="y", rise=1.15, ov=2, gable=WALL, seed=seed, m=K.THATCH)
    W.thatch_finish(v, r, seed)
    # Buttresses and lancets along both flanks, a round window in the front gable.
    for yy in (12, 22, 32):
        Q.buttress(v, x0 - 1, yy, 2, 12, "x-", w=2, depth=1, m=WALL)
        Q.buttress(v, x1, yy, 2, 12, "x+", w=2, depth=1, m=WALL)
    for yy in (16, 27, 37):
        Q.lancet(P.Face(v, "x-", x0), yy, 5, w=2, h=7)
        Q.lancet(P.Face(v, "x+", x1 - 1), yy, 5, w=2, h=7)
    Q.lancet(P.Face(v, "y-", y0), 16, 5, w=2, h=7)
    Q.lancet(P.Face(v, "y-", y0), 24, 5, w=2, h=7)
    # The porch: a gabled timber porch with a pointed door.
    px0, py0, px1, py1 = 13, 44, 23, 52
    P.fill(v, px0, py0, px1, py1, 1, 2, STONE_LIGHT)
    P.boarded(v, px0, py0, px1, py1, 2, 10, m=K.BOARDS, batten=TIMBER_DARK, every=4)
    pr = P.roof(v, px0, px1, py0, py1, 10, "thatch", along="y", rise=1.0, ov=1, gable=shade_of(K.BOARDS, 1.1), seed=seed + 1, m=K.THATCH)
    W.thatch_finish(v, pr, seed + 1)
    f = P.Face(v, "y+", py1 - 1)
    W.gate(f, 15, 6, 8, frame=STONE_LIGHT, arch=True)
    v.box(14, py1, 1, 22, py1 + 2, 2, STONE_LIGHT)  # the step
    v.anchor("door", 18, py1 + 2, 1)
    Q.rose_window(P.Face(v, "y+", y1 - 1), 18, 17, r=3)
    # The bell turret on the front ridge.
    bz = r.ridge_z
    for dx, dy in ((0, 0), (3, 0), (0, 3), (3, 3)):
        v.box(16 + dx, 36 + dy, bz, 17 + dx, 37 + dy, bz + 7, TIMBER_DARK)
    v.box(16, 36, bz + 6, 20, 40, bz + 7, TIMBER)
    v.box(17, 37, bz + 2, 19, 39, bz + 5, BRASS)
    V.cone_roof(v, 18, 38, 3.2, bz + 7, K.THATCH, rise=0.9, tip=BRASS)
    # The churchyard: a low wall with a lych gap, gravestones, a conifer, flowers.
    K.low_wall(v, 1, 56, 15, 58, 2, seed)
    K.low_wall(v, 21, 56, 35, 58, 2, seed + 1)
    K.low_wall(v, 1, 20, 3, 56, 2, seed + 2)
    K.low_wall(v, 33, 20, 35, 56, 2, seed + 3)
    for sx, sy, hh in ((4, 28, 4), (4, 36, 3), (31, 26, 4), (31, 34, 3), (30, 46, 3), (5, 46, 4)):
        v.box(sx, sy, 1, sx + 2, sy + 1, 1 + hh, STONE_LIGHT)
    P.scatter(v, 1, 1, 35, 59, 0.03, seed=seed, kinds=("tuft", "flower"))
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
