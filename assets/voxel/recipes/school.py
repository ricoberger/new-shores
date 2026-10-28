"""
School (6 × 8; D-057 §3): a schoolhouse of coursed stone with dressed
quoins on a plinth, tall framed windows with lintels, a tiled roof with
dormers and ridge tiles, a bell cote with a brass bell over the gable,
a porch with steps, a fenced schoolyard with a well, benches, a slate
board on an easel, a tree and flower beds.
"""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, DYE_BLUE, STONE, TIMBER, TIMBER_LIGHT

SLATE_BOARD = P.mat("slate", 0.8)


def build(ctx):
    v = ctx.vox()  # 48 × 64
    seed = 72
    P.yard(v, 0, 0, 48, 64, "grass", seed=seed)
    P.yard(v, 4, 34, 44, 58, "paved", seed=seed)
    P.path(v, [(x, y) for x in range(21, 27) for y in range(58, 64)], kind="paved")
    b = P.building(v, 6, 6, 42, 26, "stone", along="x", height=14, seed=seed)
    f = b.face("y+")
    for a in range(9, 40, 6):
        if not 20 <= a <= 27:
            P.casement(f, a, 4, 3, 6, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    for side in ("x-", "x+"):
        for a in (10, 16, 21):
            P.casement(b.face(side), a, 4, 2, 6, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.entrance(f, 22, 2, 4, 7, leaf=DYE_BLUE, frame=P.DRESSED, steps=2)
    # Porch with a little gable roof on posts.
    for x in (20, 27):
        v.box(x, 26, 1, x + 1, 29, 10, TIMBER)
    P.roof(v, 19, 29, 26, 30, 10, "tiles", along="y", ov=1, seed=seed, solid=False)
    P.dormer_on(v, b.roof, 11, 16, "y+", wall=P.mat("plaster"))
    P.dormer_on(v, b.roof, 32, 37, "y+", wall=P.mat("plaster"))
    P.roof_chimney(v, b.roof, 36, 12, above=3)
    # Bell cote on the west gable.
    top = b.roof.ridge_z
    v.box(6, 14, top - 2, 10, 18, top + 5, STONE)
    v.box(7, 14, top, 9, 18, top + 3, None)
    v.box(7, 15, top + 1, 9, 17, top + 3, BRASS)
    P.roof(v, 6, 10, 14, 18, top + 5, "tiles", along="y", ov=1, eaves=False, seed=seed)
    # Schoolyard: a fence, a well, benches, an easel with a slate, a tree.
    P.fence_ring(v, 2, 30, 46, 60, kind="picket", gaps={(x, 59) for x in range(21, 27)}, seed=seed)
    P.well(v, 36, 46)
    P.bench(v, 8, 38, 1, 6)
    P.bench(v, 8, 42, 1, 6)
    P.bench(v, 8, 46, 1, 6)
    v.box(17, 39, 1, 18, 40, 6, TIMBER)
    v.box(17, 43, 1, 18, 44, 6, TIMBER)
    v.box(17, 40, 3, 18, 43, 7, SLATE_BOARD)
    v.box(17, 40, 2, 18, 43, 3, TIMBER_LIGHT)
    P.fruit_tree(v, 40, 54, 1, seed=seed, trunk=6, r=4)
    P.flower_bed(v, 4, 28, 18, 30, seed=seed)
    P.flower_bed(v, 30, 28, 44, 30, seed=seed + 1)
    P.scatter(v, 0, 0, 48, 64, 0.025, seed=seed)
    return P.colour_jitter(v, seed=seed)
