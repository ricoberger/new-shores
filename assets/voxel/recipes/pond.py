"""
Pond (3 × 3, D-077 §2, Citizens, `look: civic`): an irregular oval of still
water — a model-contained layer of shallows voxels, a lighter one in the
middle — held by a rim of rough stones (a low, mossy course with a few
higher blocks) and fringed on the shore by reeds (green stems with brown
cattail heads) and a few lily pads. 8 voxels per tile. The water layer is
the whole point of the model, so it is exempt from the plate check
(config.PLATE_EXEMPT); nothing else lies flat.
"""

import math

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import GRASS_A, GRASS_B, MOSS, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_LIGHT

WATER = mat("shallows", 0.9)
WATER_LIGHT = mat("shallows", 1.12)
REED = mat("grass-b", 0.82)
REED_DRY = mat("dry", 0.95)
PAD = mat("grass-a", 0.85)


def inside(x, y, k=1.0):
    """The pond's outline: an oval, x-wise a little wider than y-wise, with a lobe on one side."""
    dx, dy = (x + 0.5 - 12) / (10.2 * k), (y + 0.5 - 12) / (8.6 * k)
    lobe = 1.0 + 0.18 * math.sin((x + 0.5) * 0.45)
    return dx * dx + dy * dy <= lobe


def build(ctx):
    v = ctx.vox()  # 24 × 24
    seed = 41
    water = [(x, y) for x in range(24) for y in range(24) if inside(x, y)]
    wset = set(water)
    for x, y in water:
        deep = inside(x, y, 0.62)
        v.set(x, y, 0, WATER_LIGHT if deep and hash3(x, y, 0, seed) < 0.5 else WATER)
    # The rim: the ring of cells outside the water, mostly one course, with higher blocks.
    rim = []
    for x in range(24):
        for y in range(24):
            if (x, y) in wset:
                continue
            if any((x + dx, y + dy) in wset for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                rim.append((x, y))
    for x, y in rim:
        h = 1 + (1 if hash3(x, y, 1, seed) < 0.5 else 0) + (1 if hash3(x, y, 2, seed) < 0.18 else 0)
        for z in range(h):
            v.set(x, y, z, MOSS if hash3(x, y, z, seed + 1) < 0.25 else (STONE_LIGHT if z == h - 1 else STONE))
    # Reeds along the western and northern shore, in clumps.
    clumps = [(3, 8), (2, 13), (4, 17), (7, 20), (11, 21), (16, 21), (20, 4), (15, 2), (9, 2)]
    for cx, cy in clumps:
        for dx, dy in ((0, 0), (1, 0), (0, 1), (-1, 1), (1, 1)):
            x, y = cx + dx, cy + dy
            if (x, y) in wset or not (0 <= x < 24 and 0 <= y < 24):
                continue
            hh = 3 + int(hash3(x, y, 4, seed) * 3)
            for z in range(0, hh):
                if (x, y, z) not in v.cells or z >= 1:
                    v.set(x, y, z, REED if z < hh - 1 else REED_DRY)
            if (dx + dy) % 2 == 0:
                v.set(x, y, hh, TIMBER_LIGHT)  # the cattail head
                v.set(x, y, hh + 1, TIMBER)
    # Lily pads on the water (a flat voxel stand at z = 1).
    for x, y in ((9, 11), (14, 9), (12, 14), (15, 13)):
        if (x, y) in wset:
            v.set(x, y, 1, PAD)
    return P.colour_jitter(v, seed=seed)
