"""
Shipyard (8 × 12 shore, D-057 §3, D-077 §5): the yard stands on the stone
quay plinth of the harbour buildings (D-078 §3, parts_d078.plinth: slabs
under every tile, a dressed side face into the water, mooring posts on
the sea edge); a plank slipway on piles with keel blocks and a hull's
ribs on the stocks runs down a channel cut through the plinth into the
sea (`slip`, the channel's walls dressed like the plinth's face); the
fitting-out berth beside it with bollards, a big open thatched shed on
posts with braces, a timber crane, a coursed-stone workshop with tiles
and a chimney, log and plank stacks, steam box, pitch kettle and rope
coils.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d078 as Q
from nsvoxel.mats import IRON, PLANK, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

#: The slip channel through the plinth (x SLIP_X0..SLIP_X1 over the four front rows).
SLIP_X0, SLIP_X1 = 10, 32


def build(ctx):
    v = ctx.vox()  # 64 × 96, land from y 32
    W, D, land = ctx.W, ctx.D, ctx.land
    seed = 81
    Q.plinth(v, 0, 0, W, D, vpt=8, edges=("y-",), seed=seed)
    # The slip channel: the plinth cut away over the front rows, its walls dressed like the plinth's face.
    for (x, y, z) in [k for k in v.cells if SLIP_X0 <= k[0] < SLIP_X1 and k[1] < land]:
        v.set(x, y, z, None)
    for y in range(0, land):
        for x in (SLIP_X0 - 1, SLIP_X1):
            for k in range(1, Q.DEPTH_8 + 1):
                v.set(x, y, -k, Q.WET if k > Q.DEPTH_8 * 2 // 3 else (Q.COURSE if k % 2 else Q.COURSE_DARK))
            v.set(x, y, 0, Q.CAPPING)
    # Slipway: a ramp of planks from the yard down into the water, keel blocks along its middle.
    for y in range(0, land + 18):
        z = min(0, (y - land) // 4)
        for x in range(SLIP_X0, SLIP_X1):
            v.set(x, y, z, P.shade_of(PLANK, 1.0 if (y // 3) % 2 else 0.9))
        if y % 4 == 0:
            v.box(20, y, z + 1, 22, y + 1, z + 2, TIMBER_DARK)
    for y in range(0, land, 6):
        for x in (10, 31):
            v.box(x, y, -8, x + 1, y + 1, 1, TIMBER_DARK)
    v.anchor("slip", 20.8, 17.6, 0.5)
    # The fitting-out berth beside the slip: bollards and a tarpaulin.
    for y in range(6, land, 8):
        v.box(44, y, 1, 45, y + 1, 3, TIMBER_DARK)
        v.set(44, y, 3, IRON)
    v.box(48, 8, 1, 50, 10, 2, P.mat("canvas", 0.85))
    # A hull's ribs on the stocks at the head of the slip.
    for y in range(land - 6, land + 14, 3):
        hw = 6 - abs(y - (land + 4)) // 4
        for k in range(-hw, hw + 1):
            dz = (k * k) // 6
            v.set(21 + k, y, 3 + dz, TIMBER_LIGHT)
        v.box(21 - hw, y, 3 + (hw * hw) // 6, 21 - hw + 1, y + 1, 9, TIMBER_LIGHT)
        v.box(21 + hw, y, 3 + (hw * hw) // 6, 21 + hw + 1, y + 1, 9, TIMBER_LIGHT)
    v.box(21, land - 7, 2, 22, land + 15, 3, TIMBER_DARK)  # keel
    # Open shed over the head of the slip.
    for x in (8, 20, 33):
        for y in (land + 20, land + 34):
            v.box(x, y, 1, x + 2, y + 2, 14, TIMBER)
            for k in range(3):  # knee braces under the tie beam
                v.set(x + 2 + k, y, 13 - k, TIMBER)
                if x > 8:
                    v.set(x - 1 - k, y, 13 - k, TIMBER)
    v.box(8, land + 20, 14, 35, land + 22, 15, TIMBER_DARK)
    v.box(8, land + 34, 14, 35, land + 36, 15, TIMBER_DARK)
    # Wall plates carry the eaves of the thin roof shell on the tie beams.
    v.box(8, land + 18, 14, 35, land + 20, 15, TIMBER_DARK)
    v.box(8, land + 36, 14, 35, land + 38, 15, TIMBER_DARK)
    P.roof(v, 8, 35, land + 19, land + 37, 15, "thatch", along="x", ov=1, seed=seed, solid=False, gable=None)
    # Workshop with chimney on the east.
    b = P.building(v, 40, land + 20, 60, land + 36, "stone", along="y", seed=seed)
    P.barn_gate(b.face("y+"), 47, 2, 5, 6)
    P.casement(b.face("x-"), land + 24, 5, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(b.face("x-"), land + 30, 5, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.roof_chimney(v, b.roof, 54, land + 30, above=3)

    # Crane by the slip.
    v.box(34, land + 4, 1, 36, land + 6, 22, TIMBER)
    for j in range(12):
        v.set(35 - j, land + 5, 22, TIMBER_LIGHT)
    for z in range(14, 22):
        v.set(24, land + 5, z, IRON)
    # Timber stacks and planks.
    P.log_stack(v, 40, land + 4, 1, length=14, along="x", n=3)
    P.log_stack(v, 40, land + 10, 1, length=14, along="x", n=2)
    P.planks(v, 4, land + 40, 1, w=14, d=4, h=3)
    P.planks(v, 22, land + 42, 1, w=10, d=4, h=2)
    # Pitch kettle on a fire.
    v.box(54, land + 42, 1, 57, land + 45, 2, STONE)
    v.box(54, land + 42, 2, 57, land + 45, 4, IRON)
    v.set(55, land + 43, 4, P.mat("iron", 0.6))
    P.cask(v, 58, land + 42, 1)
    P.cask(v, 58, land + 45, 1)
    # Steam box for bending planks, rope coils, a cart.
    v.box(36, land + 40, 1, 50, land + 43, 4, TIMBER_DARK)
    v.box(36, land + 40, 4, 50, land + 43, 5, PLANK)
    for x in (4, 8):
        v.box(x, land + 48, 1, x + 2, land + 50, 2, P.mat("canvas", 0.85))
    P.handcart(v, 24, land + 50, 1, along="x", load=PLANK)
    P.sawhorse(v, 14, land + 50, 1, along="x")
    P.tie_floating(v, ground=0)
    return P.colour_jitter(v, seed=seed)
