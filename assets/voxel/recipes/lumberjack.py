"""
Lumberjack (3 × 3; D-057 §3; V7 rework after the Anno 1404 lumberjack's hut):
a log cabin of dark logs with pale notched ends on short piles on stone
footings, the gable to the front, a plank stair up to the door, a steep roof
of weathered thatch (the shade of the settlers' houses), a stone chimney
(smoke). The lumberjack's signature is the pale cut end: bark-dark log stack,
felled logs and stumps all show light end discs / cut tops. Readable props:
a chopping block with a big axe (bright blade), wood chips round it, and a
trestle with a log and a two-man saw. Dirt only round the cabin and under
the log stack (D-068); the rest of the plot is grass with tufts and flowers.
"""

from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.parts_v7 import BARK, CUT, log, log_pile, stump  # noqa: F401
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import FLOWER, GRASS_A, GRASS_B, PLANK, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

FLOOR = 3  # the cabin floor stands on piles
GABLE = mat("timber", 1.12)
LOGS = mat("timber", 0.8)  # the settlers' log walls
BLADE = mat("iron", 2.1)  # a bright steel edge


def chopping_block(v, x, y, z=1):
    """A 3 × 3 × 3 block with a pale top and a big axe stuck in it: a bright blade on a long haft."""
    stump(v, x, y, z, h=3, seed=1)
    ax, ay, az = x + 1, y + 1, z + 3  # the axe stands at the block's centre
    for k in range(5):  # haft rising, tilted toward y-
        v.set(ax, ay - (1 if k >= 3 else 0), az + k, TIMBER_LIGHT)
    for k in range(3):  # the head: iron eye, bright edge on the x- side
        v.set(ax, ay - 1, az + 3 + k, shade_of(mat("iron"), 1.0))
        v.set(ax - 1, ay - 1, az + 3 + k, BLADE)
        v.set(ax - 2, ay - 1, az + 3 + k if k < 2 else az + 4, BLADE)


def trestle(v, x, y, z=1, length=10):
    """A sawing trestle (two X-legs) with a 2 × 2 log across it and a two-man saw cutting it: a bright blade, two handles."""
    for k in (3, length - 5):
        for dy in (0, 3):
            v.box(x + k, y + dy, z, x + k + 1, y + dy + 1, z + 4, TIMBER_DARK)
    for k in (3, length - 5):
        v.box(x + k, y, z + 3, x + k + 1, y + 4, z + 4, TIMBER)
    log(v, x, y + 1, z + 4, length, "x")
    sx = x + length // 2  # the saw stands in the cut
    v.box(sx, y - 2, z + 5, sx + 1, y + 6, z + 8, BLADE)
    for yy in (y - 3, y + 6):
        v.box(sx, yy, z + 6, sx + 1, yy + 1, z + 10, TIMBER_LIGHT)


def speckle(v, x0, y0, x1, y1, density, seed):
    """Grass tufts and flowers (1–2 voxels) on the cells left to the terrain."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            if (x, y) in v.ground or v.has(x, y, 1) or hash3(x, y, 91, seed) >= density:
                continue
            if hash3(y, x, 92, seed) < 0.28:
                v.set(x, y, 1, shade_of(GRASS_A, 1.05))
                v.set(x, y, 2, FLOWER if hash3(x, y, 94, seed) < 0.6 else mat("canvas", 1.05))
            else:
                v.set(x, y, 1, shade_of(GRASS_B, 1.08))
                if hash3(x, y, 93, seed) < 0.45:
                    v.set(x, y, 2, shade_of(GRASS_B, 1.16))


def chips(v, cx, cy, r, seed):
    """Wood chips: a light speckle round the chopping block."""
    for x in range(cx - r, cx + r + 1):
        for y in range(cy - r, cy + r + 1):
            d = (x - cx) ** 2 + (y - cy) ** 2
            if d <= r * r and not v.has(x, y, 1) and hash3(x, y, 77, seed) < 0.5 - d / (2.6 * r * r):
                v.set(x, y, 1, shade_of(CUT, 1.1 if hash3(y, x, 78, seed) < 0.5 else 0.95))


def build(ctx):
    v = ctx.vox()  # 36 × 36
    seed = 3
    x0, y0, x1, y1 = 10, 8, 28, 24
    # Dirt round the cabin, the stair and the work area, under the log stack — the rest is grass.
    P.yard(v, 7, 5, 33, 31, "dirt", seed=seed)
    P.yard(v, 1, 7, 10, 23, "dirt", seed=seed)
    # Piles on stone footings, planked floor, dark log walls with pale ends.
    for x in (x0, (x0 + x1) // 2 - 1, x1 - 2):
        for y in (y0, (y0 + y1) // 2 - 1, y1 - 2):
            v.box(x - 1, y - 1, 1, x + 3, y + 3, 2, STONE)
            v.box(x, y, 2, x + 2, y + 2, FLOOR, TIMBER_DARK)
    P.fill(v, x0, y0, x1, y1, FLOOR, FLOOR + 1, PLANK)
    P.log_walls(v, x0, y0, x1, y1, FLOOR + 1, FLOOR + 11, m=LOGS)
    r = P.roof(v, x0, x1, y0, y1, FLOOR + 11, "thatch", along="y", rise=1.25, ov=2, gable=GABLE, seed=seed, m=mat("thatch", 0.8))
    W.thatch_finish(v, r, seed)
    for (x, y, z), m in list(v.cells.items()):  # boarded gables: a dark batten every third board
        if m == GABLE and y in (y0, y1 - 1) and x % 3 == 0:
            v.set(x, y, z, TIMBER_DARK)
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 17, FLOOR + 1, 4, 6, leaf=TIMBER_LIGHT, frame=TIMBER, step=None)
    for a in (12, 23):
        P.casement(f, a, FLOOR + 4, 2, 3, frame=PLANK, sill=PLANK, shutters=TIMBER_LIGHT, bars=False)
    W.stairs(v, 17, y1 + 5, 1, 3, side=-1, width=4)
    for a in (13, 18):
        P.casement(P.Face(v, "x+", x1 - 1), a, FLOOR + 4, 2, 3, frame=PLANK, sill=PLANK, bars=False)
        P.casement(P.Face(v, "x-", x0), a, FLOOR + 4, 2, 3, frame=PLANK, sill=PLANK, bars=False)
    P.roof_chimney(v, r, 20, y0 + 2, above=3, anchor=True)
    # The yard: log stack under the west eave, trestle with the saw, block with the axe, stumps, felled logs, a cart.
    log_pile(v, 2, 8, 1, 14, "y", 3)
    trestle(v, 24, 27)
    chopping_block(v, 7, 27)
    chips(v, 8, 28, 5, seed)
    stump(v, 2, 24, seed=seed + 1)
    stump(v, 31, 8, seed=seed + 2)
    log(v, 29, 11, 1, 9, "y")
    log(v, 31, 13, 1, 7, "y")
    P.woodpile(v, 31, 20, 1, length=6, along="y", rows=3)
    P.handcart(v, 15, 33, 1, along="x", load=TIMBER_LIGHT)
    v.anchor("cart", 17, 34, 1)
    speckle(v, 0, 0, 36, 36, 0.045, seed)
    return P.colour_jitter(v, seed=seed)
