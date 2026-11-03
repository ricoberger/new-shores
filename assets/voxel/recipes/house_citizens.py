"""
Citizen house (3 × 3, 12 voxels per tile; V7 rework after the Anno 1404
citizen houses): a main block about two and a half tiles long — a
coursed-rubble ground floor with dressed quoins on a pale stone band flush with the wall, a
jettied upper storey of few heavy timbers (posts, one rail, a brace per
bay) with large whitewashed panels and tall two-light casements with
shutters — under a steep orange terracotta roof with dormers or a cross
gable, a tall stone chimney, and a wing that takes the rest of the plot.
Three massings: a long house with two dormers and a boarded shed with a
door under a tiled roof (Citizen_house_4); a gable-fronted house with a
gabled stone annex beside it (Citizen_house_3); a cross-gabled L with a
lean-to and an outside stair to the upper floor (Citizen_house_5).
"""

from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import DYE_BLUE, PLASTER, STONE, STONE_LIGHT, TIMBER, TIMBER_LIGHT

VARIANTS = 3
VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

DRESSED = P.DRESSED
FRAME = mat("timber", 0.62)
GREEN = mat("grass-b", 0.8)
RED_DOOR = mat("terracotta", 0.8)
G, T = 10, 19  # top of the stone ground floor, top of the framed storey


def ground_windows(f, spots, z=4, w=4, h=4, lintel=DRESSED):
    """Ground-floor windows in the rubble: dressed frame, sill and lintel."""
    for a in spots:
        P.casement(f, a, z, w, h, frame=DRESSED, sill=DRESSED, lintel=lintel, bars=False)
        f.put(a + w // 2, z, DRESSED, out=-1)


def door(f, a, z=2, leaf=DYE_BLUE, **kw):
    P.entrance(f, a, z, 4, 7, leaf=leaf, frame=DRESSED, lintel=DRESSED, steps=1, **kw)


def build(ctx):
    v = ctx.vox()  # 36 × 36
    k = ctx.variant
    seed = 31 + k
    P.yard(v, 0, 0, 36, 36, "dirt", seed=seed)  # houses of tiers 1–2 stand on bare earth over the whole plot
    if k == 0:
        # Long house along x (2.5 tiles), two dormers, chimney on the east gable; a boarded shed in front on the east.
        b = W.framed_house(v, 3, 6, 31, 20, "x", ground=G, top=T, infill=PLASTER, frame=FRAME, rise=1.5, seed=seed, windows={"y+": (0, 2), "y-": (0, 2), "x-": (0,)}, shutters=DYE_BLUE)
        f = b.face("y+")
        door(f, 14)
        ground_windows(f, (6, 22))
        ground_windows(b.face("x-"), (9,))
        for x0 in (7, 19):
            P.dormer_on(v, b.roof, x0, x0 + 6, "y+", wall=PLASTER, kind="tiles", frame=TIMBER_LIGHT, course=3, h=6)
        W.stack(v, 27, 11, 1, b.roof.ridge_z + 4, 3, 3)
        W.plank_shed(v, 23, 23, 34, 34, wall=11, along="y", door="y+", seed=seed + 2)
        P.casement(P.Face(v, "x-", 23), 27, 5, 3, 3, frame=TIMBER, sill=TIMBER, bars=False)
        P.bench(v, 3, 24, length=4)
    elif k == 1:
        # Gable-fronted house along y on the west, a gabled stone annex beside it on the east.
        b = W.framed_house(v, 3, 3, 18, 31, "y", ground=G, top=T, infill=PLASTER, frame=FRAME, rise=1.5, seed=seed, windows={"y+": (0,), "x-": (0, 2), "y-": (0,), "x+": (1,)}, shutters=GREEN)
        f = b.face("y+")
        door(f, 10, leaf=RED_DOOR)
        ground_windows(f, (4,))
        ground_windows(b.face("x-"), (7, 19))
        W.stack(v, 8, 6, 1, b.roof.ridge_z + 4, 3, 3)
        # The annex: rubble walls to the eaves, a tiled gable roof along y, a door and a window to the front.
        ax0, ay0, ax1, ay1 = 21, 8, 34, 30
        P.plinth(v, ax0, ay0, ax1, ay1, 1, STONE_LIGHT, out=0)
        W.coursed_stone_2(v, ax0, ay0, ax1, ay1, 2, 12, STONE, seed + 1)
        P.dressed_quoins(v, ax0, ay0, ax1, ay1, 2, 12)
        r = P.roof(v, ax0 - 1, ax1 + 1, ay0 - 1, ay1 + 1, 12, "tiles", along="y", rise=1.5, ov=1, gable=PLASTER, seed=seed + 2)
        W.roof_core(v, r, PLASTER, mat("terracotta"))
        af = P.Face(v, "y+", ay1 - 1)
        door(af, 23, leaf=TIMBER)
        ground_windows(af, (29,), w=3)
        W.two_light(P.Face(v, "y+", ay1), 25, 14, h=5, shutters=GREEN)
        P.casement(P.Face(v, "y-", ay0 - 1), 26, 14, 3, 4, frame=TIMBER_LIGHT, sill=TIMBER_LIGHT, bars=False)  # the back gable
        P.flower_bed(v, 22, 32, 33, 35, seed=seed)
    else:
        # Cross-gabled L: a range along x at the back, a wing to the front on the west; a lean-to with an outside stair in the corner.
        b = W.framed_house(v, 3, 3, 33, 15, "x", ground=G, top=T, infill=PLASTER, frame=FRAME, rise=1.5, seed=seed, windows={"y+": (1,), "y-": (1,)}, free={"y+": (2,)}, shutters=DYE_BLUE)
        w = W.framed_house(v, 3, 15, 16, 32, "y", ground=G, top=T, infill=PLASTER, frame=FRAME, rise=1.5, seed=seed + 1, windows={"y+": (0,)}, shutters=GREEN)
        door(w.face("y+"), 5, leaf=TIMBER, arch=True)
        ground_windows(w.face("x-"), (20,))
        W.stack(v, 27, 6, 1, b.roof.ridge_z + 4, 3, 3)
        # Lean-to against the wing's east wall, the stair beside it up to a door in the range's upper storey.
        lx0, ly0, lx1, ly1 = 17, 19, 25, 31
        P.plinth(v, lx0, ly0, lx1, ly1, 1, STONE_LIGHT, out=0)
        P.boarded(v, lx0, ly0, lx1, ly1, 2, 9, m=TIMBER_LIGHT, batten=mat("timber", 0.62), every=3)
        P.lean_to(v, lx0 - 1, lx1 + 1, ly0, ly1 + 1, 9, "tiles", down="x+", ov=1, posts=False, seed=seed)
        P.entrance(P.Face(v, "y+", ly1 - 1), 19, 2, 3, 6, leaf=TIMBER, frame=TIMBER_LIGHT, steps=0, hinges=False)
        W.stairs(v, 27, 34, 2, 9, side=-1, width=3)
        v.box(27, 16, 10, 30, 17, 11, TIMBER_LIGHT)  # the landing
        P.entrance(P.Face(v, "y+", 15), 27, G + 1, 3, 6, leaf=TIMBER, frame=TIMBER_LIGHT, steps=0, hinges=False)
    P.scatter(v, 0, 0, 36, 36, 0.006, seed=seed)
    return P.colour_jitter(v, seed=seed)
