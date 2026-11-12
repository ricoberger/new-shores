"""
Kontor (4 × 11 shore, D-076/D-077 §6, Patricians, `look: harbour`; the
footprint of the depot class): the trading house of the Hanseatic league on
the stone quay plinth of the harbour buildings (D-078 §3,
parts_d078.plinth: slabs under every tile, a dressed side face into the
water, mooring posts and iron rings on the sea edge). One long hall of brick — the
first model whose accent role is `brick` — on a stone plinth, with a
tall stepped (crow-step) gable toward the sea (y-) and another toward the
land, a dark tile roof with a lighter ridge, white-framed casements, a
loading door with a hoist door above it in the sea gable and a timber crane
beam projecting from the gable top over the deck with a pulley, rope and a
hanging crate. A banner on the ridge in sway group `flag`. 8 voxels per
tile: x 0..32 along the coast, y 0..88 from the sea (y = 0) to the land.
"""

import math

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel import parts_d078 as Q
from nsvoxel import detail_d060 as D
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import BRASS, IRON, PLASTER, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

BRICK = mat("brick", 1.0)
BRICK_DARK = mat("brick", 0.85)
TILE = mat("tile-dark", 1.0)
RIDGE = mat("tile-dark", 0.72)
BANNER = mat("dye-blue", 1.1)
HX0, HX1, HY0, HY1 = 3, 29, 18, 74
PLINTH = 3
WALL_TOP = 20


def brick_walls(v, x0, y0, x1, y1, z0, z1, seed):
    """Walls of brick: courses with a lighter and darker mix."""
    for z in range(z0, z1):
        for x in range(x0, x1):
            for y in range(y0, y1):
                if x in (x0, x1 - 1) or y in (y0, y1 - 1):
                    k = hash3(x, y, z, seed)
                    v.set(x, y, z, BRICK_DARK if (z % 2 == 0 and k < 0.3) else (shade_of(BRICK, 1.08) if k > 0.75 else BRICK))


def stepped_gable(v, y, thick, x0, x1, z0, hw):
    """A crow-step gable of brick over the width x0..x1: steps two voxels in and two up from z0 to the apex, a stone cap on every tread."""
    xc = (x0 + x1) // 2
    for u in range(hw + 1):
        top = z0 + 2 * math.ceil((hw - u) / 2) + 2
        for xx in (xc - u - 1, xc + u):
            for yy in range(y, y + thick):
                for z in range(z0, top):
                    v.set(xx, yy, z, BRICK if z % 2 else BRICK_DARK)
                v.set(xx, yy, top, STONE_LIGHT)
    return z0 + 2 * math.ceil(hw / 2) + 2


def build(ctx):
    v = ctx.vox()  # 32 × 88
    seed = 89
    Q.plinth(v, 0, 0, 32, 88, vpt=8, edges=("y-",), seed=seed)
    for x in (10, 18):
        D.mooring_ring(v, x, 0, -3)
    # Plinth, brick walls, the roof along y.
    v.box(HX0 - 1, HY0 - 1, 1, HX1 + 1, HY1 + 1, 1 + PLINTH, STONE)
    for z in range(1, 1 + PLINTH):
        v.walls(HX0 - 1, HY0 - 1, HX1 + 1, HY1 + 1, z, z + 1, STONE_DARK if z % 2 else STONE)
    z0 = 1 + PLINTH
    brick_walls(v, HX0, HY0, HX1, HY1, z0, WALL_TOP, seed)
    hw = (HX1 - HX0) // 2
    r = P.roof(v, HX0, HX1, HY0, HY1, WALL_TOP, "tiles", along="y", rise=0.9, ov=0, gable=BRICK, m=TILE, ridge=RIDGE, seed=seed)
    # The crow-step gables on both ends, a pinnacle on the peaks.
    for y in (HY0, HY1 - 2):
        peak = stepped_gable(v, y, 2, HX0, HX1, WALL_TOP, hw)
        v.box((HX0 + HX1) // 2 - 1, y, peak, (HX0 + HX1) // 2 + 1, y + 2, peak + 3, BRICK)
        v.set((HX0 + HX1) // 2, y, peak + 3, BRASS)
    # Doors and windows: loading door and hoist door in the sea gable, casements along the sides.
    sea = P.Face(v, "y-", HY0)
    P.barn_gate(sea, 10, z0, 8, 9, leaf=TIMBER, frame=O.CAP)
    P.casement(sea, 11, z0 + 12, 4, 4, frame=PLASTER, sill=STONE_LIGHT, shutters=None, bars=False)
    land = P.Face(v, "y+", HY1 - 1)
    P.entrance(land, 12, z0, 6, 9, frame=STONE_LIGHT, leaf=TIMBER_DARK, step=STONE_DARK)
    for side, plane in (("x-", HX0), ("x+", HX1 - 1)):
        f = P.Face(v, side, plane)
        for a in range(HY0 + 7, HY1 - 8, 12):
            P.casement(f, a, z0 + 5, 3, 6, frame=PLASTER, sill=STONE_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    # The crane beam: a timber beam from the sea gable's upper part out over the deck, a brace, a pulley, rope and a crate.
    xc = (HX0 + HX1) // 2
    v.box(xc - 1, HY0 - 12, WALL_TOP + 6, xc + 1, HY0 + 2, WALL_TOP + 8, TIMBER)
    v.line((xc, HY0 - 1, WALL_TOP + 1), (xc, HY0 - 10, WALL_TOP + 6), TIMBER_DARK)
    v.line((xc - 1, HY0 - 1, WALL_TOP + 1), (xc - 1, HY0 - 10, WALL_TOP + 6), TIMBER_DARK)
    v.box(xc - 1, HY0 - 12, WALL_TOP + 4, xc + 1, HY0 - 11, WALL_TOP + 6, IRON)  # the pulley block
    for z in range(z0 + 5, WALL_TOP + 4):
        v.set(xc, HY0 - 12, z, TIMBER_LIGHT)
    P.box_crate(v, xc - 1, HY0 - 13, z0 + 2, s=3)
    # The banner on a pole on the ridge near the land gable.
    ridge_z = WALL_TOP + int(0.9 * hw) + 1
    v.box(xc, HY1 - 14, ridge_z, xc + 1, HY1 - 13, ridge_z + 10, TIMBER_DARK)
    v.box(xc + 1, HY1 - 14, ridge_z + 5, xc + 8, HY1 - 13, ridge_z + 10, P.cloth(BANNER, "flag"))
    # Crates and casks on the deck in front of the sea gable and beside the hall.
    P.box_crate(v, 4, 6, 1, s=3)
    P.box_crate(v, 7, 7, 1, s=3)
    P.box_crate(v, 5, 7, 4, s=2)
    P.cask(v, 24, 6, 1, h=3)
    P.cask(v, 26, 8, 1, h=3)
    P.sacks(v, 22, 10, 1, n=3)
    v.anchor("door", 15, HY1, 1)
    return P.colour_jitter(v, seed=seed)
