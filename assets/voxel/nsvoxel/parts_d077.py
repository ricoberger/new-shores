"""
Parts of the D-077 models (ornaments, military, Kontor, repair crane), imported
as `O`: round walls and rings, a stone figure on any scale, a deck over every
tile of a shore building, courses of stone.
"""

import math

from . import parts as P
from .grid import hash3, mat, shade_of
from .mats import PLANK, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_DARK

ASHLAR = mat("stone", 0.95)
ASHLAR_DARK = mat("stone", 0.8)
CAP = mat("stone", 1.14)
DECK = mat("timber", 1.62)


def cells_in_disc(cx, cy, r, r_in=None):
    """Cell (x, y) whose centre lies within radius r of (cx, cy) (and beyond r_in)."""
    out = []
    for x in range(math.floor(cx - r) - 1, math.ceil(cx + r) + 1):
        for y in range(math.floor(cy - r) - 1, math.ceil(cy + r) + 1):
            d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
            if d2 <= r * r and (r_in is None or d2 > r_in * r_in):
                out.append((x, y))
    return out


def ring(v, cx, cy, r_out, r_in, z0, z1, m, course=None):
    """A round wall: cells between the radii from z0 up to (excluding) z1; every other layer in the `course` shade."""
    course = course or shade_of(m, 0.9)
    for x, y in cells_in_disc(cx, cy, r_out, r_in):
        for z in range(z0, z1):
            v.set(x, y, z, course if (z - z0) % 2 else m)


def disc(v, cx, cy, r, z0, z1, m):
    for x, y in cells_in_disc(cx, cy, r):
        for z in range(z0, z1):
            v.set(x, y, z, m)


def ashlar_box(v, x0, y0, x1, y1, z0, z1, m=ASHLAR, course=2, cap=None):
    """A solid block of ashlar: a darker joint layer every `course` layers, a lighter cap layer on top."""
    for z in range(z0, z1):
        shade = ASHLAR_DARK if (z - z0) % course == course - 1 and z < z1 - 1 else m
        v.box(x0, y0, z, x1, y1, z + 1, shade)
    if cap is not None:
        v.box(x0 - 0, y0, z1 - 1, x1, y1, z1, cap)


def figure(v, cx, y0, z, s, m, hi=None, face=None, arm="down", cloak=None):
    """
    A robed standing figure on layer z at x centre cx (an integer x between two cells) and y row y0, `s` voxels per unit
    (s = 1: 12 voxels tall, 6 wide; s = 2: 24 tall): a skirt, a torso with arms either side, a head, in the material
    `m` (highlights `hi`). `arm` "up" raises the right arm (a torch, a staff, a spyglass can be added by the recipe)
    and returns the position of the raised hand (x, y, z). The figure is 2 voxels deep at s = 1.
    """
    hi = hi or shade_of(m, 1.15)
    d = 2 * s
    x0 = cx - 2 * s
    v.box(x0, y0, z, x0 + 4 * s, y0 + d, z + 5 * s, m)  # skirt / legs
    v.box(x0, y0, z + 5 * s, x0 + 4 * s, y0 + d, z + 9 * s, hi)  # torso
    if cloak is not None:
        v.box(x0, y0 - 1, z + 5 * s, x0 + 4 * s, y0, z + 9 * s + 1, cloak)
    for sx in (x0 - s, x0 + 4 * s):  # arms
        top = z + 9 * s
        bottom = z + 5 * s
        v.box(sx, y0, bottom, sx + s, y0 + d - (1 if s > 1 else 0), top, m)
    hand = None
    if arm == "up":
        sx = x0 + 4 * s
        v.box(sx, y0, z + 9 * s, sx + s, y0 + d - (1 if s > 1 else 0), z + 12 * s, m)
        hand = (sx, y0, z + 12 * s)
    v.box(cx - s, y0, z + 9 * s, cx + s, y0 + d, z + 12 * s, hi)  # head
    if face is not None:
        v.box(cx - s, y0 + d - 1, z + 10 * s, cx + s, y0 + d, z + 10 * s + 1, face)
    return hand


def piles(v, x0, y0, x1, y1, z_top=0, depth=6, every=6, m=TIMBER_DARK):
    """Timber piles under a deck: at the corners and every `every` voxels along the edges, from z_top - depth up to z_top."""
    xs = sorted(set(range(x0, x1, every)) | {x1 - 1})
    ys = sorted(set(range(y0, y1, every)) | {y1 - 1})
    for x in xs:
        for y in ys:
            if x in (x0, x1 - 1) or y in (y0, y1 - 1):
                v.box(x, y, z_top - depth, x + 1, y + 1, z_top, m)


def deck(v, x0, y0, x1, y1, z=0, m=DECK, board=2, with_piles=True):
    """A plank deck of one layer at z under every tile of the rectangle, boards in two shades, piles at the edge."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            v.set(x, y, z, shade_of(m, 1.0 if (y // board) % 2 else 0.9))
    if with_piles:
        piles(v, x0, y0, x1, y1, z)


def bollard(v, x, y, z=1, h=2):
    v.box(x, y, z, x + 1, y + 1, z + h, TIMBER_DARK)
    v.set(x, y, z + h - 1, mat("iron"))


def merlons(v, x0, y0, x1, y1, z, h=2, step=2):
    """Crenellations on the rim of a rectangle (corners always merlons)."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            if x not in (x0, x1 - 1) and y not in (y0, y1 - 1):
                continue
            p = (x - x0) if y in (y0, y1 - 1) else (y - y0)
            if p % (2 * step) < step or (x in (x0, x1 - 1) and y in (y0, y1 - 1)):
                for k in range(h):
                    v.set(x, y, z + k, ASHLAR)
                v.set(x, y, z + h, CAP)
