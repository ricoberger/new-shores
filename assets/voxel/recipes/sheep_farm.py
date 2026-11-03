"""
Sheep farm (3 × 3; D-057 §3; V7 rework after the Anno 1404 / Anno 117 sheep
farm): a boarded barn-cottage under a big weathered thatch roof (gable to the
front, a plank stair to the door, stone chimney with smoke) on a flush stone
band, a wattle-hurdle shearing pen at its west side with a shearing bench,
a fleece, white wool bales and red-dyed bales, a hay rack under a lean-to,
and in front a trough, sacks and a hand cart of wool. 12 voxels per tile;
dirt in one rounded patch round the buildings, the rest is grass.
"""

from nsvoxel import parts as P
from nsvoxel import parts_v7 as W
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import CANVAS, FLOWER, GRASS_A, GRASS_B, PLANK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

BOARDS = mat("timber", 0.8)  # the settlers' board walls
THATCH = mat("thatch", 0.8)  # weathered
PLINTH = mat("stone", 1.1)
WOOL = mat("canvas", 1.3)  # clean white wool
RED = mat("terracotta", 1.0)  # red-dyed wool
HAY = mat("thatch", 1.3)


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
            if (x, y) in v.ground or v.has(x, y, 1) or hash3(x, y, 91, seed) >= 0.045:
                continue
            if hash3(y, x, 92, seed) < 0.25:
                v.set(x, y, 1, shade_of(GRASS_A, 1.05))
                v.set(x, y, 2, FLOWER)
            else:
                v.set(x, y, 1, shade_of(GRASS_B, 1.08))
                if hash3(x, y, 93, seed) < 0.45:
                    v.set(x, y, 2, shade_of(GRASS_B, 1.16))


def build(ctx):
    v = ctx.vox()  # 36 × 36
    seed = 44
    blob(v, 18, 19, 17, 16, seed)
    # The barn-cottage: stone band, boarded walls, a big thatch roof, the gable to the front.
    x0, y0, x1, y1 = 14, 4, 30, 22
    P.plinth(v, x0, y0, x1, y1, 1, PLINTH, out=0)
    P.fill(v, x0, y0, x1, y1, 1, 2, PLINTH)
    P.boarded(v, x0, y0, x1, y1, 2, 14, m=BOARDS, batten=TIMBER_DARK, every=4)
    r = P.roof(v, x0, x1, y0, y1, 14, "thatch", along="y", rise=1.0, ov=2, gable=shade_of(BOARDS, 1.1), seed=seed, m=THATCH)
    W.thatch_finish(v, r, seed)
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 19, 3, 4, 7, leaf=TIMBER_LIGHT, frame=TIMBER, step=None)
    W.stairs(v, 19, y1 + 5, 1, 3, side=-1, width=4)
    P.casement(f, 24, 6, 3, 3, frame=PLANK, sill=PLANK, shutters=TIMBER_LIGHT, bars=False)
    for a in (8, 15):
        P.casement(P.Face(v, "x-", x0), a, 6, 3, 3, frame=PLANK, sill=PLANK, bars=False)
    P.roof_chimney(v, r, 25, 8, above=3, anchor=True)
    # Back relief: posts with a tie rail and a hay lean-to along the east wall.
    for x in range(x0 + 2, x1 - 1, 6):
        v.box(x, y0 - 1, 2, x + 1, y0, 14, TIMBER_DARK)
    v.box(x0 + 2, y0 - 1, 7, x1 - 2, y0, 8, TIMBER_DARK)
    P.lean_to(v, x1, x1 + 4, 8, 20, 7, "thatch", down="x+", ov=0, m=THATCH, seed=seed)
    v.box(x1, 9, 2, x1 + 3, 19, 5, HAY)
    # The shearing pen on the west side: wattle hurdles, a bench with a fleece, wool bales, red-dyed bales.
    P.fence_ring(v, 1, 8, 13, 28, kind="wattle", gaps={(7, 27), (8, 27), (9, 27)}, seed=seed)
    v.box(4, 12, 1, 5, 16, 3, TIMBER)
    v.box(8, 12, 1, 9, 16, 3, TIMBER)
    v.box(4, 12, 3, 9, 16, 4, TIMBER_LIGHT)
    v.box(5, 13, 4, 8, 15, 5, WOOL)  # the fleece on the bench
    P.bale(v, 3, 19, 1, 4, 3, 3, m=WOOL)
    P.bale(v, 8, 19, 1, 4, 3, 3, m=WOOL)
    P.bale(v, 4, 20, 4, 3, 2, 2, m=WOOL)
    P.bale(v, 3, 24, 1, 4, 3, 3, m=RED)
    P.bale(v, 8, 24, 1, 3, 3, 2, m=RED)
    # In front: trough, sacks, the hand cart of wool.
    P.trough(v, 14, 31, 1, length=6, along="x")
    P.sacks(v, 24, 30, 1, n=2, m=CANVAS)
    P.handcart(v, 25, 26, 1, along="x", load=WOOL)
    v.anchor("cart", 28, 33, 1)
    tufts(v, 0, 0, 36, 36, seed)
    return P.colour_jitter(v, seed=seed)
