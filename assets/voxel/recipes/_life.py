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


#: Diameters (voxels at 16 per tile) of the smoke puff variants (render/life.ts SMOKE_SIZES).
SMOKE_SIZES = (2, 3, 4, 6)


def smoke(ctx):
    """A smoke puff: a rounded voxel blob, light on top and greyer beneath, centred on the origin."""
    d = SMOKE_SIZES[ctx.variant]
    v = ctx.vox(0, 0)
    r = d / 2
    for x in range(d):
        for y in range(d):
            for z in range(d):
                q = ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 + (z + 0.5 - r) ** 2) / (r * r)
                if d > 2 and q > 1.0 + 0.15 * (d > 4):
                    continue
                v.set(x - d // 2, y - d // 2, z, mat("foam", 0.98) if z >= r else mat("stone", 1.12))
    v.offset = (0.0 if d % 2 == 0 else 0.5, 0.0 if d % 2 == 0 else 0.5, r)
    return v


def wake(ctx):
    """A wake fleck: two flat foam voxels (16 per tile), centred on the origin at the water line."""
    v = ctx.vox(0, 0)
    v.set(0, 0, 0, mat("foam", 1.0))
    v.set(-1, 0, 0, mat("foam", 0.94))
    return v


#: Footprint classes of the construction stages (tiles per side): a building's
#: stage is the class nearest its footprint, stretched by at most ~1.5 (the
#: client's stageClass in render/buildings.ts).
STAGE_CLASSES = (2, 4, 8)


def stage(n):
    """Construction stages a (foundations), b (timber skeleton), c (rafters) on an n × n-tile footprint at 8 voxels per tile."""

    def b(ctx):
        v = ctx.vox(0, 0)
        k = ctx.variant
        half = 4 * n
        inset = 1 if n == 1 else 2
        lo, hi = -half + inset, half - inset
        wall = 7 if n == 1 else (9 if n <= 3 else 12)
        for x in range(-half, half):
            for y in range(-half, half):
                # Trodden earth in one shade (one face; the shader jitter adds the voxel variety).
                v.set(x, y, 0, mat("road-dirt", 0.92))
        v.walls(lo, lo, hi, hi, 0, 1, STONE_DARK)
        v.walls(lo, lo, hi, hi, 1, 2, STONE)
        if k == 0:
            # Foundations, a stone pile and a stack of planks in the yard.
            v.box(lo, hi - 3, 1, lo + 3, hi - 1, 3, STONE)
            v.box(hi - 4, lo + 1, 1, hi - 1, lo + 3, 2, PLANK)
            return v
        step = 4 if n <= 2 else 8
        posts = sorted(set(list(range(lo, hi - 1, step)) + [hi - 1]))
        for x in posts:
            for y in (lo, hi - 1):
                v.box(x, y, 2, x + 1, y + 1, wall + 1, TIMBER_LIGHT)
        for y in posts:
            for x in (lo, hi - 1):
                v.box(x, y, 2, x + 1, y + 1, wall + 1, TIMBER_LIGHT)
        v.walls(lo, lo, hi, hi, wall, wall + 1, TIMBER_LIGHT)
        if k == 1:
            v.walls(lo, lo, hi, hi, 2, 2 + wall // 3, PLASTER)
            v.box(lo - 1, hi, 1, lo + 3, hi + 1, 2, PLANK)
            return v
        v.walls(lo, lo, hi, hi, 2, wall - 2, PLASTER)
        # Rafters across y (every other post on big footprints), rising to a ridge beam along x.
        rise = min((hi - lo) // 2, 4 + n)
        run = (hi - lo) // 2
        # Three rafters (the gable ends and the middle) beyond 2 tiles: the stage files stay small (models-folder limit).
        rafters = posts if n <= 2 else sorted({lo, (lo + hi) // 2, hi - 1})
        for x in rafters:
            for j in range(rise):
                y = j * run // rise
                v.box(x, lo + y, wall + 1 + j, x + 1, lo + (j + 1) * run // rise, wall + 2 + j, TIMBER)
                v.box(x, hi - (j + 1) * run // rise, wall + 1 + j, x + 1, hi - y, wall + 2 + j, TIMBER)
        v.box(lo, -1, wall + rise, hi, 1, wall + rise + 1, TIMBER)
        # The first course of roof tiles on the front slope.
        v.box(lo, lo - 1, wall + 1, hi, lo + 1, wall + 2, mat("terracotta"))
        return v

    return b


def scaffolding(n):
    """Poles every half tile around an n × n-tile footprint (a voxel outside it), two plank decks and a ladder."""

    def b(ctx):
        v = ctx.vox(0, 0)
        half = 4 * n
        lo, hi = -half - 1, half
        h = 12 if n <= 4 else 16
        every = 4 if n <= 2 else (8 if n <= 4 else 16)
        for x in range(lo, hi + 1, every):
            for y in (lo, hi):
                v.box(x, y, 0, x + 1, y + 1, h, TIMBER_LIGHT)
        for y in range(lo, hi + 1, every):
            for x in (lo, hi):
                v.box(x, y, 0, x + 1, y + 1, h, TIMBER_LIGHT)
        for z in (h // 2 - 1, h - 2):
            for x in range(lo, hi + 1):
                for y in (lo, hi):
                    v.set(x, y, z, PLANK)
            for y in range(lo, hi + 1):
                for x in (lo, hi):
                    v.set(x, y, z, PLANK)
        for z in range(1, h - 2, 2):
            v.set(lo + 1, hi, z, TIMBER)
        return v

    return b


RECIPES = {
    "life_villager_settlers": {"build": villager("settlers"), "variants": 3, "scale": 16},
    "life_villager_citizens": {"build": villager("citizens"), "variants": 3, "scale": 16},
    "life_cart": {"build": cart(False), "scale": 16},
    "life_cart_merchant": {"build": cart(True), "scale": 16},
    "life_cart_axle": {"build": axle, "scale": 16},
    "life_sheep": {"build": sheep, "scale": 16},
    "life_boat": {"build": boat, "scale": 16},
    "life_crate": {"build": crate, "scale": 16},
    "life_wake": {"build": wake, "scale": 16},
    "life_smoke": {"build": smoke, "variants": len(SMOKE_SIZES), "scale": 16},
    # The 2-tile class keeps the plain IDs; the others carry their size.
    "life_stage": {"build": stage(2), "variants": 3},
    "life_stage_scaffolding": {"build": scaffolding(3)},
    **{f"life_stage_{n}": {"build": stage(n), "variants": 3} for n in STAGE_CLASSES if n != 2},
    **{f"life_stage_scaffolding_{n}": {"build": scaffolding(n)} for n in STAGE_CLASSES if n > 4},
}

del SAND
