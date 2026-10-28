"""
Settler house (3 × 3; D-057 §3): single-storey cottages in a pegged timber
frame with plaster infill on a proud stone plinth, steep thatch with a
ridge roll and a ragged eave, a coursed stone chimney with a pot; small
framed windows with sills and plank shutters, a plank door with strap
hinges and a step. Three variants (gable to the side with a front garden,
gable to the front with a woodshed, L-plan with a kitchen garden).
"""

from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import PLASTER, PLASTER_WARM, STONE_DARK, TIMBER_LIGHT

VARIANTS = 3

#: Corner braces on the gable ends only: the eave sides keep plaster panels round the windows.
GABLES = ("x-", "x+")

#: Warm roof variety per variant (thatch shades) and wall infill.
THATCHES = (mat("thatch", 1.0), mat("thatch", 0.94), mat("thatch", 1.05))
WALLS = (PLASTER, PLASTER_WARM, mat("plaster", 0.95))


def windows(f, spots, z=5, shutters=TIMBER_LIGHT):
    for a in spots:
        P.casement(f, a, z, 2, 2, frame=None, sill=TIMBER_LIGHT, lintel=None, shutters=shutters, bars=False)


def build(ctx):
    v = ctx.vox()
    k = ctx.variant
    seed = 11 + k
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    wall, thatch = WALLS[k], THATCHES[k]
    if k == 0:
        # Gable to the side, front garden behind a picket fence.
        b = P.building(v, 4, 6, 20, 15, "settler", along="x", wall=wall, roof=thatch, seed=seed, spacing=5, braces=GABLES)
        f = b.face("y+")
        P.entrance(f, 10, 2, 3, 5)
        windows(f, (6, 16))
        P.casement(b.face("x-"), 10, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
        P.casement(b.face("x+"), 10, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
        P.roof_chimney(v, b.roof, 5, 9, above=3)
        P.path(v, [(x, y) for x in range(10, 13) for y in range(16, 24)])
        P.fence_line_v2(v, 1, 17, 1, 22, seed=seed)
        P.fence_line_v2(v, 2, 22, 9, 22, seed=seed)
        P.fence_line_v2(v, 13, 22, 22, 22, seed=seed)
        P.fence_line_v2(v, 22, 21, 22, 17, seed=seed)
        P.crop_rows(v, 3, 19, 9, 22, "cabbage", along="y", pitch=2, seed=seed)
        P.flower_bed(v, 14, 19, 21, 21, seed=seed)
        P.bench(v, 14, 16, 1, 3)
        P.woodpile(v, 21, 8, 1, length=5, along="y", rows=3)
        P.chopping_block(v, 21, 3)
        P.cask(v, 2, 13, 1)
    elif k == 1:
        # Gable to the front, a lean-to woodshed on the east.
        b = P.building(v, 5, 4, 17, 18, "settler", along="y", wall=wall, roof=thatch, seed=seed, spacing=5, braces=GABLES)
        f = b.face("y+")
        P.entrance(f, 7, 2, 3, 5)
        windows(f, (13,))
        P.casement(f, 10, 10, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
        for side in ("x-", "x+"):
            windows(b.face(side), (7, 12), shutters=None)
        v.box(17, 8, 1, 22, 15, 1, None)
        P.plinth(v, 17, 8, 21, 15, 1, STONE_DARK, out=0)
        P.lean_to(v, 17, 21, 8, 15, 6, "thatch", down="x+", ov=1, seed=seed)
        P.log_stack(v, 18, 9, 2, length=5, along="y", n=2)
        P.roof_chimney(v, b.roof, 10, 14, above=3)
        P.path(v, [(x, y) for x in range(7, 10) for y in range(19, 24)])
        P.fence_ring(v, 1, 20, 23, 23, kind="wattle", gaps={(7, 22), (8, 22), (9, 22)}, seed=seed)
        P.washing_line(v, 1, 4, 10, 6, (mat("canvas"), mat("dye-blue", 1.1)), every=2)
        P.chopping_block(v, 19, 18)
        P.sacks(v, 12, 20, 1, n=2)
        P.shrub(v, 20, 3, 1, 2, seed=seed)
    else:
        # L-plan: range along x at the back, a wing to the front on the west.
        b = P.building(v, 3, 4, 21, 12, "settler", along="x", wall=wall, roof=thatch, seed=seed, spacing=5, braces=GABLES)
        w = P.building(v, 3, 12, 11, 20, "settler", along="y", wall=wall, roof=thatch, seed=seed + 5, spacing=4, braces=GABLES)
        f = b.face("y+")
        P.entrance(f, 14, 2, 3, 5)
        windows(f, (18,))
        windows(w.face("y+"), (6,))
        windows(w.face("x+"), (15,), shutters=None)
        P.roof_chimney(v, b.roof, 17, 6, above=3)
        P.crop_rows(v, 13, 15, 21, 21, "cabbage", along="x", pitch=2, seed=seed)
        P.fence_ring(v, 12, 14, 22, 22, kind="picket", gaps={(17, 21), (18, 21)}, seed=seed)
        P.path(v, [(x, y) for x in range(14, 17) for y in range(12, 14)] + [(17, y) for y in range(21, 24)] + [(18, y) for y in range(21, 24)])
        P.cask(v, 11, 21, 1)
        P.box_crate(v, 1, 21, 1)
        P.handcart(v, 1, 1, 1, along="x", load=mat("thatch", 1.1))
        P.shrub(v, 22, 3, 1, 1, seed=seed)
    P.scatter(v, 0, 0, 24, 24, 0.035, seed=seed)
    return P.colour_jitter(v, seed=seed)
