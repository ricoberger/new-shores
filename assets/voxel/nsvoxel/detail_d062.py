"""
Parts for the D-063 playhouse on top of the parts library: an octagonal
radius metric with fills and rings, a two-storey gallery ring round an
open yard, a banner pole with a hanging cloth banner (sway group `flag`),
a lantern on a post and a roof lantern (cupola).

Recipes import it next to the parts library:

    from nsvoxel import parts as P
    from nsvoxel import detail_d062 as H

Conventions as in parts.py / detail.py: voxels (8 per tile), x east, y
toward the front (+y), z up from the ground plate (z = 0); flat palette
colours (the shader jitters, V3b), shade steps only where they are
structure (floor boards, courses). Nothing here changes the other helper
libraries; every helper is deterministic (no randomness).
"""

import math

from . import parts as P
from .grid import mat, shade_of
from .mats import BRASS, CANVAS, IRON, PLANK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WINDOW

#: Banner cloths (sway group `flag`): Hanse blue and a warm ochre.
BANNER_BLUE = mat("dye-blue", 1.0, "flag")
BANNER_OCHRE = mat("ochre", 1.0, "flag")
BANNER_WHITE = mat("canvas", 1.0, "flag")


def oct_r(x, y, cx, cy):
    """
    The octagonal radius of the cell (x, y) about (cx, cy), measured at the
    cell centre: the inradius of the regular octagon through it. The axis
    edges lie at max(|dx|, |dy|) = r and the diagonal edges at
    (|dx| + |dy|) / √2 = r, so `oct_r <= r` is a regular octagon.
    """
    dx, dy = abs(x + 0.5 - cx), abs(y + 0.5 - cy)
    return max(dx, dy, (dx + dy) / math.sqrt(2))


def octagon_cells(cx, cy, r_lo, r_hi):
    """The cells (x, y) with r_lo < oct_r ≤ r_hi (r_lo may be negative: the whole octagon), in x-then-y order."""
    n = int(math.ceil(r_hi))
    return [
        (x, y)
        for x in range(int(cx) - n - 1, int(cx) + n + 2)
        for y in range(int(cy) - n - 1, int(cy) + n + 2)
        if r_lo < oct_r(x, y, cx, cy) <= r_hi
    ]


def octagon(v, cx, cy, r, z0, z1, m):
    """A solid octagonal prism of inradius r from layer z0 up to (excluding) z1."""
    for x, y in octagon_cells(cx, cy, -1, r):
        for z in range(z0, z1):
            v.set(x, y, z, m)


def sector(x, y, cx, cy, n=8):
    """The angular sector 0..n−1 of a cell about (cx, cy), the first one centred on the +x axis, counter-clockwise (y toward +y)."""
    a = math.atan2(y + 0.5 - cy, x + 0.5 - cx)
    return int(math.floor(a / (2 * math.pi) * n + 0.5)) % n


def edge_cells(cells):
    """The cells of a set that touch a cell outside it (4-neighbourhood): the outer wall ring of a filled shape."""
    s = set(cells)
    return [c for c in cells if any((c[0] + dx, c[1] + dy) not in s for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]


def gallery_ring(v, cx, cy, r_in, r_out, z, h=6, every=6, floor=PLANK, post=TIMBER, rail=TIMBER_LIGHT, skip=None):
    """
    One tier of a gallery round an open yard: a plank floor on layer z over
    the octagonal ring r_in < r ≤ r_out (boards in alternating shades), a
    post every `every` cells on the inner edge up to z + h, and a balustrade
    (balusters on every other cell, a rail above) along the inner edge at
    z + 1 … z + 2. `skip(x, y)` leaves cells out (the stage's opening).
    Returns the inner-edge cells.
    """
    ring = [c for c in octagon_cells(cx, cy, r_in, r_out) if skip is None or not skip(*c)]
    for x, y in ring:
        v.set(x, y, z, shade_of(floor, 1.0 if ((x + y) // 2) % 2 else 0.9))
    inner = [c for c in octagon_cells(cx, cy, r_in, r_in + 1.0) if skip is None or not skip(*c)]
    inner.sort(key=lambda c: (round(math.atan2(c[1] - cy, c[0] - cx), 6), c))
    for i, (x, y) in enumerate(inner):
        if i % every == 0:
            for zz in range(z + 1, z + h):
                v.set(x, y, zz, post)
        else:
            if i % 2 == 0:
                v.set(x, y, z + 1, post)
            v.set(x, y, z + 2, rail)
    return inner


def banner_pole(v, x, y, z, h=14, cloth=BANNER_BLUE, drop=8, width=4, stripe=BANNER_WHITE):
    """
    A pole at (x, y) from layer z up `h`, a brass ball, a cross arm one layer
    under the top reaching `width` voxels toward +x and a banner hanging from
    it `drop` layers (cloth material in sway group `flag`, a pale stripe in
    the middle, a notched lower edge). Returns the top z.
    """
    v.box(x, y, z, x + 1, y + 1, z + h, TIMBER_DARK)
    v.set(x, y, z + h, BRASS)
    top = z + h - 1
    for i in range(1, width + 2):
        v.set(x + i, y, top, TIMBER)
    for i in range(1, width + 1):
        for j in range(1, drop + 1):
            if j == drop and i % 2 == 0:
                continue  # the notched hem
            m = stripe if (j == drop // 2 or j == drop // 2 + 1) else cloth
            v.set(x + i, y, top - j, m)
    return z + h + 1


def lantern(v, x, y, z=1, h=9, post=TIMBER_DARK):
    """
    A lantern post: a timber post, a bracket arm one voxel out toward +x and
    a hanging cage of brass corners round a lit core under an iron cap
    (3 × 3 × 3). Returns the top z.
    """
    v.box(x, y, z, x + 1, y + 1, z + h, post)
    v.box(x, y, z + h - 1, x + 3, y + 1, z + h, post)
    cx, zz = x + 2, z + h - 4
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in range(3):
                edge = (abs(dx) == 1 and abs(dy) == 1) or dz in (0, 2)
                v.set(cx + dx, y + dy, zz + dz, BRASS if edge else mat("brass", 1.3))
    v.box(cx - 1, y - 1, zz + 3, cx + 2, y + 2, zz + 4, IRON)
    v.set(cx, y, zz + 4, IRON)
    return zz + 5


def cupola(v, cx, cy, z, size=8, h=7, roof=None, ridge=None, wall=None, flag=True):
    """
    A roof lantern (a small timber turret) centred on (cx, cy) standing on
    layer z: four timber corner posts size × size voxels apart, glazed
    sides (dark window panes between a sill and a head beam), a hipped roof
    with a brass finial and, with flag=True, a pennant on a short staff.
    Returns the top z.
    """
    roof = roof or TIMBER_DARK
    wall = wall or mat("plaster", 1.0)
    x0, y0 = cx - size // 2, cy - size // 2
    x1, y1 = x0 + size, y0 + size
    v.box(x0 - 1, y0 - 1, z, x1 + 1, y1 + 1, z + 1, TIMBER_DARK)  # the base plate
    for zz in range(z + 1, z + 1 + h):
        for x in range(x0, x1):
            for y in range(y0, y1):
                if x in (x0, x1 - 1) and y in (y0, y1 - 1):
                    v.set(x, y, zz, TIMBER)
                elif x in (x0, x1 - 1) or y in (y0, y1 - 1):
                    v.set(x, y, zz, wall if zz in (z + 1, z + h) else WINDOW)
    top = z + 1 + h
    v.box(x0 - 1, y0 - 1, top, x1 + 1, y1 + 1, top + 1, TIMBER_DARK)  # the head beam
    t = v.hip(x0 - 1, x1 + 1, y0 - 1, y1 + 1, top + 1, roof, ov=1, rise=1.2, ridge=ridge)
    v.set(cx, cy, t, BRASS)
    t += 1
    if flag:
        v.box(cx, cy, t, cx + 1, cy + 1, t + 4, TIMBER_DARK)
        for i in range(1, 4):
            v.set(cx + i, cy, t + 3, BANNER_BLUE)
            if i < 3:
                v.set(cx + i, cy, t + 2, BANNER_BLUE)
        t += 4
    return t
