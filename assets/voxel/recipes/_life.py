"""Life models (LIFE_LAYER): villagers, carts and their wheel axle, sheep, rowing boat, crate at 16 voxels per tile, construction stages and scaffolding at 8. Forward is +y (recipe space)."""

from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import (
    BRASS,
    CANVAS,
    DYE_BLUE,
    IRON,
    OCHRE,
    PLANK,
    SAND,
    STONE,
    STONE_DARK,
    TERRACOTTA,
    THATCH,
    TIMBER,
    TIMBER_DARK,
    TIMBER_LIGHT,
    WHEAT,
    PLASTER,
)

SKIN = mat("sand", 0.92)
HAIR = TIMBER_DARK


def villager(tier):
    clothes = {"settlers": ((CANVAS, TIMBER), (THATCH, TIMBER_DARK), (mat("canvas", 0.85), mat("dye-blue", 0.9))), "citizens": ((DYE_BLUE, TIMBER_DARK), (TERRACOTTA, CANVAS), (OCHRE, TIMBER))}[tier]

    def b(ctx):
        v = ctx.vox(0, 0)
        top, legs = clothes[ctx.variant]
        # Legs (two columns), torso, arms, head with hair; a hat or headscarf per variant.
        for x in (-1, 0):
            v.box(x, 0, 0, x + 1, 1, 3, legs)
        v.box(-2, -1, 3, 1, 1, 6, top)
        v.box(-2, 0, 6, 1, 1, 7, top)
        v.box(-3, 0, 3, -2, 1, 6, top)
        v.box(1, 0, 3, 2, 1, 6, top)
        v.set(-3, 0, 3, SKIN)
        v.set(1, 0, 3, SKIN)
        v.box(-2, -1, 7, 1, 1, 9, SKIN)
        v.box(-2, -1, 9, 1, 1, 10, HAIR)
        v.set(-2, -1, 8, HAIR)
        v.set(0, -1, 8, HAIR)
        if ctx.variant == 1:
            v.box(-3, -2, 9, 2, 2, 10, THATCH if tier == "settlers" else TIMBER_DARK)
            v.box(-2, -1, 10, 1, 1, 11, THATCH if tier == "settlers" else TIMBER_DARK)
        if ctx.variant == 2 and tier == "citizens":
            v.box(-2, -1, 1, 1, 1, 3, top)
        return v

    return b


def cart(merchant):
    def b(ctx):
        v = ctx.vox(0, 0)
        # Bed z 2..5 over the axle, shaft toward +y.
        v.box(-3, -5, 2, 4, 6, 3, TIMBER)
        for x, y0, y1 in ((-4, -5, 6), (4, -5, 6)):
            v.box(x, y0, 3, x + 1, y1, 5, TIMBER_LIGHT)
        v.box(-3, -6, 3, 4, -5, 5, TIMBER_LIGHT)
        v.box(-3, 6, 3, 4, 7, 4, TIMBER_LIGHT)
        for x in (-2, 2):
            v.box(x, 7, 3, x + 1, 11, 4, TIMBER)
        if merchant:
            for x, y in ((-4, -5), (4, -5), (-4, 5), (4, 5)):
                v.box(x, y, 5, x + 1, y + 1, 10, TIMBER)
            for k in range(9):
                v.box(-4 + k, -5, 10 + (1 if 2 <= k <= 6 else 0) + (1 if 3 <= k <= 5 else 0), -3 + k, 6, 11 + (1 if 2 <= k <= 6 else 0) + (1 if 3 <= k <= 5 else 0), CANVAS if k % 2 else mat("dye-blue", 1.05))
            v.box(-3, -4, 3, 0, -1, 6, TIMBER_LIGHT)
            v.box(0, -4, 3, 3, -2, 5, CANVAS)
            v.box(-2, 1, 3, 2, 4, 5, BRASS)
        else:
            v.box(-3, -4, 3, 0, -1, 5, CANVAS)
            v.box(0, -4, 3, 3, 0, 4, WHEAT)
            v.box(-2, 0, 3, 2, 4, 6, TIMBER_LIGHT)
        v.anchor("wheel_front", 0, 2.4, 1.55)
        v.anchor("wheel_rear", 0, -2.4, 1.55)
        return v

    return b


def axle(ctx):
    """Axle with two wheels (spun about x by the life layer): spoked rims of radius 1.5 voxels."""
    v = ctx.vox(0, 0)
    v.box(-4, 0, 0, 5, 1, 1, TIMBER_DARK)
    for x in (-5, 5):
        for y, z in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            v.set(x, y, z, TIMBER if (y + z) % 2 else TIMBER_LIGHT)
        v.set(x, 0, 0, IRON)
    # The wheels' cells span -1..2: their centre (0.5, 0.5) is the spin axis.
    v.offset = (0.5, 0.5, 0.5)
    return v


def sheep(ctx):
    v = ctx.vox(0, 0)
    wool = mat("canvas", 1.02)
    for x, y in ((-1, -2), (1, -2), (-1, 1), (1, 1)):
        v.set(x, y, 0, TIMBER_DARK)
    v.box(-1, -2, 1, 2, 2, 3, wool)
    v.set(0, -2, 3, wool)
    v.box(0, 2, 2, 1, 3, 4, TIMBER_DARK)
    return v


def boat(ctx):
    v = ctx.vox(0, 0)
    for y in range(-5, 5):
        w = 2 if -3 <= y <= 2 else 1
        v.box(-w, y, 0, w + 1, y + 1, 1, TIMBER)
        v.set(-w, y, 1, TIMBER_LIGHT)
        v.set(w, y, 1, TIMBER_LIGHT)
    v.box(-1, -5, 1, 2, -4, 2, TIMBER_LIGHT)
    v.box(-1, 4, 1, 2, 5, 2, TIMBER_LIGHT)
    v.box(-1, 0, 1, 2, 1, 2, PLANK)
    return v


def crate(ctx):
    v = ctx.vox(0, 0)
    v.box(-1, -1, 0, 2, 2, 3, TIMBER_LIGHT)
    v.box(-1, -1, 2, 2, 2, 3, PLANK)
    v.set(-1, -1, 1, TIMBER)
    v.set(1, 1, 1, TIMBER)
    return v


def stage(ctx):
    """Construction stages a (foundations), b (timber skeleton), c (rafters) on a 2 × 2-tile unit stretched to the footprint."""
    v = ctx.vox(0, 0)
    k = ctx.variant
    for x in range(-8, 8):
        for y in range(-8, 8):
            v.set(x, y, 0, mat("road-dirt", 0.95 if (x + y) % 3 else 0.88))
    v.walls(-6, -6, 6, 6, 1, 2, STONE)
    v.walls(-6, -6, 6, 6, 0, 1, STONE_DARK)
    if k == 0:
        v.box(-7, 5, 1, -4, 7, 3, STONE)
        for x in range(-2, 3, 2):
            v.box(x, 7, 1, x + 1, 8, 2, PLANK)
        v.box(3, -8, 1, 7, -6, 2, PLANK)
        return v
    for x, y in ((-6, -6), (5, -6), (-6, 5), (5, 5), (-1, -6), (-1, 5), (-6, -1), (5, -1)):
        v.box(x, y, 2, x + 1, y + 1, 9, TIMBER_LIGHT)
    v.walls(-6, -6, 6, 6, 8, 9, TIMBER_LIGHT)
    if k == 1:
        v.walls(-6, -6, 6, 6, 2, 4, PLASTER)
        P_planks = PLANK
        v.box(-8, 6, 1, -4, 8, 2, P_planks)
        return v
    v.walls(-6, -6, 6, 6, 2, 7, PLASTER)
    for x in range(-7, 7, 3):
        for j in range(7):
            v.set(x, -7 + j, 9 + j, TIMBER)
            v.set(x, 6 - j, 9 + j, TIMBER)
    v.box(-7, -1, 15, 7, 1, 16, TIMBER)
    v.box(-7, -7, 9, 7, -5, 10, mat("terracotta"))
    return v


def scaffolding(ctx):
    """Poles every half tile around a 2.4-tile square, two plank decks and ladders."""
    v = ctx.vox(0, 0)
    for x in range(-9, 10, 4):
        for y in (-10, 9):
            v.box(x, y, 0, x + 1, y + 1, 12, TIMBER_LIGHT)
    for y in range(-10, 10, 4):
        for x in (-9, 9):
            v.box(x, y, 0, x + 1, y + 1, 12, TIMBER_LIGHT)
    for z in (5, 10):
        for x in range(-9, 10):
            for y in (-10, 9):
                v.set(x, y, z, PLANK)
        for y in range(-10, 10):
            for x in (-9, 9):
                v.set(x, y, z, PLANK)
    for z in range(1, 10, 2):
        v.set(-8, 9, z, TIMBER)
    return v


RECIPES = {
    "life_villager_settlers": {"build": villager("settlers"), "variants": 3, "scale": 16},
    "life_villager_citizens": {"build": villager("citizens"), "variants": 3, "scale": 16},
    "life_cart": {"build": cart(False), "scale": 16},
    "life_cart_merchant": {"build": cart(True), "scale": 16},
    "life_cart_axle": {"build": axle, "scale": 16},
    "life_sheep": {"build": sheep, "scale": 16},
    "life_boat": {"build": boat, "scale": 16},
    "life_crate": {"build": crate, "scale": 16},
    "life_stage": {"build": stage, "variants": 3},
    "life_stage_scaffolding": {"build": scaffolding},
}

del SAND
