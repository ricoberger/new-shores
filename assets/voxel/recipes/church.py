"""
Church (6 × 10; V7 rework after the Anno 1404 church, tier III): the
second rung of the chapel → church → cathedral ladder. A nave of pale
rubble with buttresses and tall lancets under dark burgundy tiles, a lower
apse at the back, a square west tower in three stages with an arched
portal, belfry openings and a steep tiled spire with a cross, a churchyard
with a low wall, gravestones and yews on a paved forecourt. 12 voxels per
tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, CROWN, IRON, STONE_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

WALL = mat("stone", 0.92)


def build(ctx):
    v = ctx.vox()  # 72 × 120
    seed = 13
    K.ground(v, 36, 108, 24, 10, seed, "paved")  # the forecourt
    # Nave.
    x0, y0, x1, y1 = 20, 24, 44, 92
    P.plinth(v, x0, y0, x1, y1, 1, STONE_LIGHT, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_LIGHT)
    W.coursed_stone_2(v, x0, y0, x1, y1, 2, 20, WALL, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, 20)
    r = P.roof(v, x0, x1, y0, y1, 20, "tiles", along="y", rise=1.5, ov=1, gable=WALL, seed=seed, m=K.TILE_DARK, ridge=K.TILE_RIDGE, shades=(1.2, 0.84), verge=0.62)
    W.roof_core(v, r, WALL, K.TILE_DARK)
    for yy in range(30, 88, 12):
        Q.buttress(v, x0 - 1, yy, 2, 18, "x-", w=2, depth=1, m=WALL)
        Q.buttress(v, x1, yy, 2, 18, "x+", w=2, depth=1, m=WALL)
        Q.lancet(P.Face(v, "x-", x0), yy + 4, 5, w=2, h=10)
        Q.lancet(P.Face(v, "x+", x1 - 1), yy + 4, 5, w=2, h=10)
    # Apse at the back.
    W.coursed_stone_2(v, 26, 12, 38, 24, 2, 14, WALL, seed + 1)
    ar = P.roof(v, 26, 38, 12, 24, 14, "tiles", along="y", rise=1.5, ov=1, gable=WALL, seed=seed, m=K.TILE_DARK, ridge=K.TILE_RIDGE, shades=(1.2, 0.84), verge=0.62, hip=True)
    W.roof_core(v, ar, WALL, K.TILE_DARK)
    Q.lancet(P.Face(v, "y-", 12), 29, 5, w=2, h=8)
    # West tower: three stages, portal, belfry, spire.
    tx0, ty0, tx1, ty1 = 24, 92, 40, 108
    P.plinth(v, tx0, ty0, tx1, ty1, 1, STONE_LIGHT, out=0)
    W.coursed_stone_2(v, tx0, ty0, tx1, ty1, 2, 44, WALL, seed + 2)
    P.dressed_quoins(v, tx0, ty0, tx1, ty1, 2, 44)
    for zz in (16, 30, 43):
        Q.string_course(v, tx0, ty0, tx1, ty1, zz)
    f = P.Face(v, "y+", ty1 - 1)
    W.gate(f, 29, 6, 11, frame=STONE_LIGHT, arch=True)
    v.box(28, ty1, 1, 36, ty1 + 2, 2, STONE_LIGHT)
    W.round_window(f, 32, 24, r=2)
    for s, plane in (("y+", ty1 - 1), ("x-", tx0), ("x+", tx1 - 1)):
        for a in (29, 33) if s == "y+" else (97, 101):
            Q.lancet(P.Face(v, s, plane), a, 33, w=2, h=9)
    sp = V.cone_roof(v, 32, 100, 9.5, 44, K.TILE_DARK, rise=2.2, tip=IRON)
    v.box(32, 100, sp, 33, 101, sp + 5, BRASS)
    # Churchyard: low wall, gravestones, yews.
    K.low_wall(v, 4, 114, 28, 116, 3, seed)
    K.low_wall(v, 36, 114, 68, 116, 3, seed + 1)
    for sx, sy in ((8, 40), (8, 52), (8, 64), (60, 40), (60, 56), (10, 100), (58, 98)):
        v.box(sx, sy, 1, sx + 2, sy + 1, 5, STONE_LIGHT)
    for tx, ty in ((10, 82), (54, 80), (52, 104)):
        P.fruit_tree(v, tx, ty, 1, seed=seed, crown=mat("tree-crown", 0.7), fruit=None, trunk=5, r=3.6)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
