"""
Shipyard (8 × 12, back 4 rows over water; D-057 §3): a plank slipway on
piles with keel blocks and a hull's ribs on the stocks running into the
sea (`slip`), a side pier as a fitting-out berth with bollards, a big
open thatched shed on posts with braces, a timber crane, a coursed-stone
workshop with tiles and a chimney, log and plank stacks, steam box,
pitch kettle and rope coils.
"""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, PLANK, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()  # 64 × 96, land from y 32
    W, D, land = ctx.W, ctx.D, ctx.land
    seed = 81
    # Slipway: a ramp of planks from the yard down into the water, keel blocks along its middle.
    for y in range(0, land + 18):
        z = min(0, (y - land) // 4)
        for x in range(10, 32):
            v.set(x, y, z, P.shade_of(PLANK, 1.0 if (y // 3) % 2 else 0.9))
        if y % 4 == 0:
            v.box(20, y, z + 1, 22, y + 1, z + 2, TIMBER_DARK)
    for y in range(0, land, 6):
        for x in (10, 31):
            v.box(x, y, -8, x + 1, y + 1, 1, TIMBER_DARK)
    v.anchor("slip", 20.8, 17.6, 0.5)
    # Side pier and quay.
    for y in range(4, land):
        for x in range(44, 52):
            v.set(x, y, 0, P.shade_of(PLANK, 1.0 if (y // 2) % 2 else 0.9))
        if y % 6 == 4:
            for x in (44, 51):
                v.box(x, y, -8, x + 1, y + 1, 0, TIMBER_DARK)
    for y in range(6, land, 8):
        v.box(44, y, 1, 45, y + 1, 3, TIMBER_DARK)
        v.set(44, y, 3, IRON)
    v.box(48, 8, 1, 50, 10, 2, P.mat("canvas", 0.85))
    for x in range(W):
        if not 10 <= x < 32:
            v.box(x, land, -2, x + 1, land + 2, 1, STONE_DARK if x % 4 else STONE)
    P.yard(v, 0, land + 2, W, D, "dirt", seed=seed)
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
    P.scatter(v, 0, land + 2, W, D, 0.012, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
