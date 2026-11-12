"""
Parts of the D-078 models, imported as `Q`: the stone quay plinth the
harbour-look shore buildings stand on (D-078 §3: the trading pier, depot,
shipyard, repair crane, harbour tower, harbour statue and Kontor) — the
quay block of the terrain (render/roadvoxels.ts, ART_DIRECTION §4 quay
walls) as a model part: a level-0 deck of stone slabs in two shades, a
light capping course round its rim, a side face of dressed courses that
darken to a wet foot, and timber mooring posts with iron caps on the
water edges. Rural water buildings (fisher, salt pans, oyster beds) keep
their timber decks.
"""

from .grid import hash3, mat, shade_of
from .mats import IRON, TIMBER_DARK

#: The quay's stone (the terrain's quay deck and wall: palette island.rock-light / rock).
SLAB = mat("rock-light")
SLAB_DARK = mat("rock")
CAPPING = mat("rock-light", 1.06)
COURSE = mat("rock-light", 0.86)
COURSE_DARK = mat("rock-light", 0.76)
WET = mat("rock", 0.72)
POST = shade_of(TIMBER_DARK, 0.92)

#: How deep the plinth's side face reaches below the deck (voxels at 8 per tile; scaled with the resolution).
DEPTH_8 = 6


def plinth(v, x0, y0, x1, y1, vpt=8, z=0, edges=("y-", "x-", "x+"), posts=True, seed=0, slab=None):
    """
    The quay block under x0..x1 × y0..y1 (voxels): the deck layer at z of
    stone slabs (`slab` voxels a side, two shades and a darker one now and
    then), the capping course on its rim, the side face from z - depth up
    to the deck in courses of `vpt // 8` voxels darkening to a wet foot,
    and on each named water edge ("y-" the front at rotation 0, "x-",
    "x+", "y+") a timber mooring post every two tiles. Returns the posts'
    (x, y) columns so a recipe can keep its goods off them.
    """
    s = max(2, vpt // 4) if slab is None else slab
    step = max(1, vpt // 8)
    depth = DEPTH_8 * step
    for y in range(y0, y1):
        for x in range(x0, x1):
            rim = x in (x0, x1 - 1) or y in (y0, y1 - 1)
            r = hash3(x // s, y // s, 7, seed)
            if rim:
                m = CAPPING
            elif r > 0.93:
                m = SLAB_DARK
            else:
                m = shade_of(SLAB, 0.93 if ((x - x0) // s + (y - y0) // s) % 2 else 1.0)
            v.set(x, y, z, m)
            if not rim:
                continue
            for k in range(1, depth + 1):
                course = (k - 1) // step
                m = COURSE if course % 2 == 0 else COURSE_DARK
                if k > depth * 2 // 3:
                    m = WET
                v.set(x, y, z - k, m)
    out = []
    if not posts:
        return out
    every = 2 * vpt
    h = 3 * step
    w = step
    for e in edges:
        if e in ("y-", "y+"):
            y = y0 if e == "y-" else y1 - w
            spots = [(x, y) for x in range(x0 + vpt // 2, x1 - w, every)]
        else:
            x = x0 if e == "x-" else x1 - w
            spots = [(x, y) for y in range(y0 + vpt // 2, y1 - w, every)]
        for (px, py) in spots:
            v.box(px, py, z + 1, px + w, py + w, z + 1 + h - step, POST)
            v.box(px, py, z + h - step + 1, px + w, py + w, z + h + 1, IRON)
            out.append((px, py))
    return out
