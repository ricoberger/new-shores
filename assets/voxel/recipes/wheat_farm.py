"""
Wheat farm (3 × 4; D-057 §3; V7 rework in the tier-I vocabulary, D-064 §3):
a boarded farmhouse (dark boards on a flush stone band, weathered thatch,
plain stone chimney with smoke) with a thatched lean-to cart shed at its
east gable, a round plank granary with a conical thatch roof, two haystacks,
stooks of sheaves, sacks of grain and a hand cart of wheat in the yard, and
a low field-stone wall with a gate gap along the front. 12 voxels per tile;
dirt in one rounded patch, the rest is grass.
"""

from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import CANVAS, FLOWER, GRASS_A, GRASS_B, PLANK, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BOARDS = mat("timber", 0.8)  # the settlers' board walls
THATCH = mat("thatch", 0.8)  # weathered
PLINTH = mat("stone", 1.1)
SILO = shade_of(PLANK, 0.95)
CONE = mat("thatch", 0.95)


def blob(v, cx, cy, rx, ry, seed, kind="dirt"):
    """An irregular rounded patch of ground: an ellipse with a noisy rim (the yard map, D-068)."""
    for x in range(cx - rx - 2, cx + rx + 3):
        for y in range(cy - ry - 2, cy + ry + 3):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d < 1.0 + (hash3(x // 4, y // 4, 5, seed) - 0.5) * 0.3:
                P.yard(v, x, y, x + 1, y + 1, kind, seed=seed)


def tufts(v, x0, y0, x1, y1, seed):
    """Grass tufts and flowers on the cells left to the terrain."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            if (x, y) in v.ground or v.has(x, y, 1) or hash3(x, y, 91, seed) >= 0.04:
                continue
            if hash3(y, x, 92, seed) < 0.25:
                v.set(x, y, 1, shade_of(GRASS_A, 1.05))
                v.set(x, y, 2, FLOWER)
            else:
                v.set(x, y, 1, shade_of(GRASS_B, 1.08))
                if hash3(x, y, 93, seed) < 0.45:
                    v.set(x, y, 2, shade_of(GRASS_B, 1.16))


def silo(v, cx, cy, r, h, seed):
    """A round plank granary: a one-voxel wall of radius r with timber bands, a conical thatch roof, a little door."""
    for x in range(cx - r - 1, cx + r + 2):
        for y in range(cy - r - 1, cy + r + 2):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= r + 0.3 and d > r - 0.9:
                for z in range(1, h):
                    band = z % 5 == 0
                    v.set(x, y, z, TIMBER_DARK if band else shade_of(SILO, 1.0 if (x + y) % 2 else 0.92))
            if d <= r + 0.3 and h - 1 >= 1:
                v.set(x, y, h - 1, shade_of(SILO, 0.9))  # the loft floor
    rr, z = r + 1, h
    while rr >= 1:
        for x in range(cx - rr, cx + rr + 1):
            for y in range(cy - rr, cy + rr + 1):
                if ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 <= rr + 0.2:
                    c = shade_of(CONE, 1.0 if (z // 1) % 2 else 0.9)
                    for k in range(2):
                        v.set(x, y, z + k, c)
        rr -= 1
        z += 2
    v.box(cx, cy, z, cx + 1, cy + 1, z + 2, TIMBER_DARK)  # finial
    # the little door and loft hatch on the front (y+) side
    v.box(cx - 1, cy + r - 1, 1, cx + 1, cy + r + 1, 6, TIMBER_DARK)
    v.box(cx - 1, cy + r, 8, cx + 1, cy + r + 1, 10, TIMBER_DARK)


def build(ctx):
    v = ctx.vox()  # 36 × 48
    seed = 41
    blob(v, 18, 28, 17, 19, seed)
    # Tier-I farmhouse: boarded walls on a flush stone band under weathered thatch, a plain stone chimney,
    # a thatched lean-to cart shed on the east gable.
    x0, y0, x1, y1 = 3, 6, 27, 21
    P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, PLINTH)
    P.boarded(v, x0, y0, x1, y1, 2, 13, m=BOARDS, batten=TIMBER_DARK, every=4)
    r = P.roof(v, x0, x1, y0, y1, 13, "thatch", along="x", rise=1.0, ov=2, gable=shade_of(BOARDS, 1.1), seed=seed, m=THATCH)
    W.thatch_finish(v, r, seed)
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 10, 2, 4, 7, leaf=TIMBER_LIGHT, frame=TIMBER, step=PLINTH, steps=1)
    for a in (4, 17):
        P.casement(f, a, 6, 3, 3, frame=PLANK, sill=PLANK, shutters=TIMBER_LIGHT, bars=False)
    for a in (5, 9):
        P.casement(P.Face(v, "x-", x0), a, 6, 3, 3, frame=PLANK, sill=PLANK, bars=False)
    P.roof_chimney(v, r, 21, 11, above=3, anchor=True)
    for x in range(x0 + 2, x1 - 1, 6):  # relief on the back wall
        v.box(x, y0 - 1, 2, x + 1, y0, 13, TIMBER_DARK)
    v.box(x0 + 2, y0 - 1, 7, x1 - 2, y0, 8, TIMBER_DARK)
    P.lean_to(v, x1, x1 + 6, 8, 20, 8, "thatch", down="x+", ov=0, m=THATCH, seed=seed)
    v.box(x1, 9, 2, x1 + 3, 19, 5, shade_of(WHEAT, 1.0))  # the stored sheaves under it
    P.sacks(v, x1 + 3, 9, 1, n=3, m=CANVAS, along="y")
    # The granary at the west front corner, a haystack at the east.
    silo(v, 29, 33, 4, 14, seed)
    P.haystack(v, 8, 31, 3.4, 7, seed=seed)
    P.haystack(v, 15, 40, 2.3, 4, seed=seed + 2)
    for x in range(14, 22, 3):
        P.sheaf(v, x, 35)
        P.sheaf(v, x + 1, 36)
    P.sacks(v, 15, 27, 1, n=3, m=CANVAS)
    P.handcart(v, 22, 26, 1, along="y", load=WHEAT)
    v.anchor("cart", 24, 40, 1)
    # A low field-stone wall along the front with a gate gap.
    W.coursed_stone_2(v, 3, 43, 15, 45, 1, 4, STONE, seed)
    W.coursed_stone_2(v, 21, 43, 33, 45, 1, 4, STONE, seed + 1)
    tufts(v, 0, 0, 36, 48, seed)
    return P.colour_jitter(v, seed=seed)
