"""
Depot (4 × 4, front row over water, levels 1–2; D-060, Citizens, the
second level Merchants): island storage at the water's edge. Level 1 is
a long timber-framed store with a planked roof and a gate onto a plank
loading ramp that runs down to the water row, a short stone quay with a
mooring post and rings, crates and sacks in the yard. Level 2 is a
coursed-stone hall with a tiled roof, a second storey, a hoist beam
out of the roof, and a striped cloth awning over the yard gate (it
sways). No smoke anchor.
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, PLASTER, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

PLANKED = mat("timber", 1.0)
PLANKED_RIDGE = mat("timber", 0.78)
AWNING_A = P.cloth(CANVAS, "cloth")
AWNING_B = P.cloth(mat("dye-blue", 1.1), "cloth")


def quay(v, x0, x1, land):
    """The short stone quay edge (two rows deep, top at the yard's level) with a mooring post and rings."""
    for x in range(x0, x1):
        v.box(x, land, -2, x + 1, land + 2, 1, STONE_DARK if x % 4 else STONE)
    D.mooring_ring(v, x0 + 2, land - 1, -2)
    D.mooring_ring(v, x1 - 5, land - 1, -2)
    v.box(x1 - 4, land, 1, x1 - 2, land + 2, 4, TIMBER_DARK)  # the mooring post
    v.box(x1 - 4, land, 4, x1 - 2, land + 2, 5, IRON)
    v.box(x1 - 4, land + 2, 1, x1 - 2, land + 3, 3, mat("canvas", 0.85))  # a rope coil at its foot


def build(ctx):
    v = ctx.vox()  # 32 × 32
    lv = ctx.level
    seed = 87 + lv
    W, D_, land = ctx.W, ctx.D, ctx.land  # land from y 8
    P.yard(v, 0, land, W, D_, "dirt", seed=seed)
    P.path(v, [(x, y) for x in range(13, 19) for y in range(land + 17, D_)], kind="paved")
    quay(v, 6, 26, land)
    x0, y0, x1, y1 = (4, 12, 28, 24) if lv == 1 else (3, 11, 29, 25)
    gx = 13  # the gates (6 wide) line up with the ramp
    if lv == 1:
        zt = 11
        P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
        P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
        P.half_timber(v, x0, y0, x1, y1, 2, zt, PLASTER, TIMBER, spacing=6, braces=("x-", "x+"))
        r = P.roof(v, x0, x1, y0, y1, zt, "tiles", along="x", gable=PLASTER, m=PLANKED, ridge=PLANKED_RIDGE, seed=seed)
        front, back = P.Face(v, "y+", y1 - 1), P.Face(v, "y-", y0)
        P.barn_gate(back, gx, 2, 6, 7)
        P.entrance(front, 14, 2, 4, 5)
        for a in (7, 22):
            P.casement(front, a, 5, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    else:
        zt = 16
        b = D.warm_hall(v, x0, y0, x1, y1, zt, along="x", seed=seed)
        r = b.roof
        front, back = b.face("y+"), b.face("y-")
        P.barn_gate(back, gx + 1, 2, 6, 7)
        P.barn_gate(front, gx + 1, 2, 6, 7)
        Q.string_course(v, x0, y0, x1, y1, 9, m=D.SANDSTONE_TRIM)
        for a in (6, 10, 21, 25):
            P.casement(front, a, 3, 2, 3, frame=D.SANDSTONE_TRIM, sill=D.SANDSTONE_TRIM, lintel=D.SANDSTONE_TRIM)
            P.casement(front, a, 11, 2, 3, frame=D.SANDSTONE_TRIM, sill=D.SANDSTONE_TRIM, lintel=D.SANDSTONE_TRIM)
        for a in (6, 10, 21, 25):
            P.casement(back, a, 11, 2, 3, frame=D.SANDSTONE_TRIM, sill=D.SANDSTONE_TRIM, lintel=D.SANDSTONE_TRIM)
        # The loft door with a hoist beam out of the roof above it.
        P.entrance(front, 15, 10, 3, 4, step=None, hinges=False)
        v.box(16, y1 + 1, zt, 17, y1 + 5, zt + 1, TIMBER_DARK)
        for k in range(3):
            v.set(16, y1 + 1 + k, zt - 1 - k, TIMBER)  # the brace under the beam
        for z in range(zt - 6, zt):
            v.set(16, y1 + 4, z, IRON)
        # The striped awning over the yard gate: it sways.
        V.face_awning(front, gx - 1, gx + 9, 9, depth=3, stripes=(AWNING_A, AWNING_B), posts=True)
    # The loading ramp from the back gate down to the water row.
    D.loading_ramp(v, gx, gx + 6, 2, land + 2, 1, -3, down="y-")
    for y in range(land + 2, y0):  # the plank apron from the ramp's head to the gate
        for x in range(gx, gx + 6):
            v.set(x, y, 1, P.shade_of(mat("timber", 1.62), 1.0 if y % 2 else 0.9))
    # Crates and sacks on the quay and in the yard.
    P.box_crate(v, 9, land, 1)
    P.sacks(v, 20, land, 1, n=1)
    spots = [(5, 27), (8, 27), (24, 27), (27, 27), (5, 30), (22, 30), (25, 30), (28, 30)]
    for k, (x, y) in enumerate(spots[: 3 + 3 * lv]):
        if k % 3 == 0:
            P.cask(v, x, y, 1)
        elif k % 3 == 1:
            P.box_crate(v, x, y, 1, s=2 if lv == 1 else 3)
        else:
            P.sacks(v, x, y, 1, n=1, m=CANVAS)
    P.lamp_post(v, 21, 27)
    v.anchor("cart", 15.2, 30, 1)
    v.anchor("door", 16, 32, 0)
    P.scatter(v, 0, land, W, D_, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
