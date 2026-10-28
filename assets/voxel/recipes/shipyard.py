"""Shipyard (8 × 12, back 4 rows over water): slipway with keel blocks running into the sea, a big open timber shed, a crane, timber stacks and a pitch kettle."""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, PLANK, STONE, STONE_DARK, TERRACOTTA, THATCH, TIMBER, TIMBER_DARK, TIMBER_LIGHT


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
            v.set(x, y, 0, PLANK)
    for x in range(W):
        if not 10 <= x < 32:
            v.box(x, land, -2, x + 1, land + 2, 1, STONE_DARK if x % 4 else STONE)
    P.yard(v, 0, land + 2, W, D, "dirt", seed=seed)
    for x in range(10, 32):
        for y in range(land + 2, land + 18):
            pass
    # Open shed over the head of the slip.
    for x in (8, 20, 33):
        for y in (land + 20, land + 34):
            v.box(x, y, 1, x + 2, y + 2, 14, TIMBER)
    v.gable(8, 35, land + 19, land + 37, 14, THATCH, None, along="x", rise=1.5, ov=1, seed=seed)
    # Workshop with chimney (pitch kettle) on the east.
    top = P.house(v, 40, land + 20, 60, land + 36, "stone", along="y", seed=seed, roof=TERRACOTTA)
    P.gate(P.Face(v, "y+", land + 35), 47, 1, 5, 6)

    # Crane by the slip.
    v.box(34, land + 4, 1, 36, land + 6, 22, TIMBER)
    for j in range(12):
        v.set(35 - j, land + 5, 22, TIMBER_LIGHT)
    for z in range(14, 22):
        v.set(24, land + 5, z, IRON)
    # Timber stacks and planks.
    P.logs(v, 40, land + 4, 1, n=3, length=14, along="x")
    P.logs(v, 40, land + 9, 1, n=3, length=14, along="x")
    P.planks(v, 4, land + 40, 1, w=14, d=4, h=3)
    P.planks(v, 22, land + 42, 1, w=10, d=4, h=2)
    # Pitch kettle on a fire.
    v.box(54, land + 42, 1, 57, land + 45, 2, STONE)
    v.box(54, land + 42, 2, 57, land + 45, 4, IRON)
    P.barrel(v, 58, land + 42, 1)
    P.barrel(v, 58, land + 45, 1)
    return v.jitter(0.03, roles={"stone"}, cell=2, seed=seed)
