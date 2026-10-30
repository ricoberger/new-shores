"""
Parts for the D-060 models (city guard, fire station, surgery, trading
pier, depot) on top of the parts library: a red-and-white guard box, a
crenellation ring for a watch tower's parapet, a bell turret, a barber's
pole, a mooring ring on a quay edge and a plank loading ramp.

Recipes import it next to the parts library:

    from nsvoxel import parts as P
    from nsvoxel import detail_d060 as D

Conventions as in parts.py / detail.py: voxels (8 per tile), x east, y
toward the front (+y), z up from the ground plate (z = 0); flat palette
colours (the shader jitters, V3b), shade steps only where they are
structure (stripes, courses, rungs). Nothing here changes the helpers of
parts.py, detail.py, detail_v4.py or detail_v5.py; every helper is
deterministic (no randomness beyond `hash3` with the caller's seed).
"""

from . import parts as P
from .grid import mat, shade_of
from .mats import (
    BRASS,
    CANVAS,
    DYE_BLUE,
    IRON,
    PLANK,
    STONE,
    TERRACOTTA,
    TERRACOTTA_DARK,
    TIMBER,
    TIMBER_DARK,
)

#: Guard box stripes: terracotta red and canvas white.
STRIPE_RED = TERRACOTTA
STRIPE_WHITE = CANVAS


def guard_box(v, x, y, z=1, side="y+", w=5, d=4, h=8, roof=TERRACOTTA_DARK):
    """
    A red-and-white striped guard box (sentry box) with its lower corner at
    (x, y, z), w × d voxels (x × y): vertical stripes two voxels wide on
    the walls, the opening on `side` (y+, y-, x+, x-), a plank floor, a
    low hipped roof with a brass knob. Returns the top z (first free layer).
    """
    wall_top = z + h
    v.box(x, y, z, x + w, y + d, z + 1, PLANK)
    for zz in range(z + 1, wall_top):
        for xx in range(x, x + w):
            for yy in range(y, y + d):
                if xx in (x, x + w - 1) or yy in (y, y + d - 1):
                    stripe = ((xx - x) + (yy - y)) // 2 % 2
                    v.set(xx, yy, zz, STRIPE_RED if stripe == 0 else STRIPE_WHITE)
    f = P.faces_of(v, x, y, x + w, y + d)[side]
    a0, a1 = P.span(side, x, y, x + w, y + d)
    lo, hi = a0 + 1, a1 - 1
    for a in range(lo, hi):
        for zz in range(z + 1, wall_top - 2):
            f.put(a, zz, None)
    # A shadowed back wall shows the box is open, a lintel of dark timber closes the opening.
    for a in range(lo, hi):
        f.put(a, wall_top - 2, TIMBER_DARK)
    top = v.hip(x, x + w, y, y + d, wall_top, roof, ov=1, rise=1)
    v.set(x + w // 2, y + d // 2, top, BRASS)
    return top + 1


def crenellation(v, x0, y0, x1, y1, z, m=STONE, merlon=2, gap=2, h=2, cap=None):
    """
    A parapet of merlons round the rectangle x0..x1 × y0..y1 (exclusive)
    from layer z up `h` layers: every perimeter cell whose position along
    its edge falls in the first `merlon` of every `merlon + gap` cells is a
    merlon, corners always are; `cap` (a material) lays a capstone on top.
    Returns the top z.
    """
    period = merlon + gap
    for x in range(x0, x1):
        for y in range(y0, y1):
            if x not in (x0, x1 - 1) and y not in (y0, y1 - 1):
                continue
            on_corner = x in (x0, x1 - 1) and y in (y0, y1 - 1)
            p = (x - x0) if y in (y0, y1 - 1) else (y - y0)
            if on_corner or p % period < merlon:
                for zz in range(z, z + h):
                    v.set(x, y, zz, m)
                if cap is not None:
                    v.set(x, y, z + h, cap)
    return z + h + (1 if cap is not None else 0)


def bell_turret(v, cx, cy, z, size=4, h=5, post=TIMBER, beam=TIMBER_DARK, roof=TERRACOTTA, bell=BRASS, seed=0):
    """
    An open bell turret centred on (cx, cy) standing on layer z: a plank
    base, four posts size × size voxels apart, a hung bell, a ring beam
    and a hipped tile roof with a finial. Returns the top z (first free
    layer above the finial).
    """
    x0, y0 = cx - size // 2, cy - size // 2
    x1, y1 = x0 + size, y0 + size
    v.box(x0 - 1, y0 - 1, z, x1 + 1, y1 + 1, z + 1, beam)
    for px in (x0, x1 - 1):
        for py in (y0, y1 - 1):
            v.box(px, py, z + 1, px + 1, py + 1, z + 1 + h, post)
    # The bell: a brass cup hung from the beam, a clapper below it.
    bx, by = cx - 1, cy - 1
    v.box(bx, by, z + 2, bx + 2, by + 2, z + h - 1, bell)
    v.set(cx, cy, z + 1, IRON)
    ztop = z + 1 + h
    v.box(x0 - 1, y0 - 1, ztop, x1 + 1, y1 + 1, ztop + 1, beam)
    t = v.hip(x0 - 1, x1 + 1, y0 - 1, y1 + 1, ztop + 1, roof, ov=1, rise=1)
    v.set(cx, cy, t, bell)
    v.set(cx, cy, t + 1, shade_of(bell, 0.92))
    return t + 2


def barber_pole(v, x, y, z=1, h=11):
    """
    A barber's pole standing on layer z at (x, y): a 2 × 2 post whose
    stripes spiral in white, red and blue (a step every two layers), a
    plank foot and a brass ball on top. Returns the top z.
    """
    v.box(x - 1, y - 1, z, x + 3, y + 3, z + 1, TIMBER_DARK)
    colours = (STRIPE_WHITE, STRIPE_RED, DYE_BLUE)
    for zz in range(z + 1, z + h):
        for dx in range(2):
            for dy in range(2):
                v.set(x + dx, y + dy, zz, colours[((zz + dx * 2 + dy) // 2) % 3])
    v.box(x, y, z + h, x + 2, y + 2, z + h + 1, BRASS)
    v.set(x, y, z + h + 1, BRASS)
    return z + h + 2


def mooring_ring(v, x, y, z, plane="xz", m=IRON):
    """
    A mooring ring on a quay face: a 3 × 3 iron ring (empty centre) with
    its lower left cell at (x, y, z) in the xz plane (the wall faces ±y)
    or the yz plane (the wall faces ±x), and a brass bolt above it.
    """
    for i in range(3):
        for j in range(3):
            if (i, j) == (1, 1):
                continue
            if plane == "xz":
                v.set(x + i, y, z + j, m)
            else:
                v.set(x, y + i, z + j, m)
    if plane == "xz":
        v.set(x + 1, y, z + 3, BRASS)
    else:
        v.set(x, y + 1, z + 3, BRASS)


def loading_ramp(v, x0, x1, y0, y1, z_hi, z_lo, down="y-", m=PLANK, cleat=TIMBER_DARK, rail=TIMBER):
    """
    A plank loading ramp over x0..x1 × y0..y1 (exclusive), its top layer
    falling from `z_hi` at the high edge to `z_lo` at the low edge, which
    lies toward `down` (y-, y+, x-, x+). A solid wedge from `z_lo` up
    (hidden), alternating plank shades, a cleat every third row and a low
    rail along both flanks. Returns the number of rows.
    """
    along_y = down in ("y-", "y+")
    n = (y1 - y0) if along_y else (x1 - x0)
    for k in range(n):  # k = distance from the high edge
        top = z_hi - (k * (z_hi - z_lo)) // max(1, n - 1)
        for a in range(x0, x1) if along_y else range(y0, y1):
            if along_y:
                yy = y1 - 1 - k if down == "y-" else y0 + k
                xx = a
            else:
                xx = x1 - 1 - k if down == "x-" else x0 + k
                yy = a
            lo, hi = (x0, x1 - 1) if along_y else (y0, y1 - 1)
            edge = a in (lo, hi)
            for zz in range(min(z_lo, top), top + 1):
                v.set(xx, yy, zz, m if zz < top else shade_of(m, 1.0 if k % 2 == 0 else 0.9))
            if edge:
                v.set(xx, yy, top + 1, rail)
            elif k % 3 == 1:
                v.set(xx, yy, top, cleat)
    return n


#: Warm limestone/sandstone (the church's courses) and its darker quoins.
SANDSTONE = mat("cliff-upper", 1.12)
SANDSTONE_TRIM = mat("cliff-upper", 1.3)  # window frames, sills, string courses
SANDSTONE_QUOIN = mat("cliff-upper", 0.8)
SANDSTONE_PLINTH = mat("cliff-upper", 0.7)


def warm_hall(v, x0, y0, x1, y1, height, along="x", rise=None, kind="tiles", roof=None, stone=SANDSTONE, quoin=SANDSTONE_QUOIN, seed=0):
    """
    The "stone" style of building() in warm sandstone: a plinth, coursed
    walls of `stone` to `height`, darker quoins and a roof of courses
    (as building(): returns a Building with face()/span()).
    """
    from . import detail as _d

    P.plinth(v, x0, y0, x1, y1, 1, SANDSTONE_PLINTH, out=1)
    P.fill(v, x0, y0, x1, y1, 1, 2, SANDSTONE_PLINTH)
    P.coursed_stone(v, x0, y0, x1, y1, 2, height, stone, seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, height, m=quoin)
    r = _d.roof(v, x0, x1, y0, y1, height, kind, along=along, rise=rise, gable=stone, seed=seed, m=roof)
    return _d.Building(v, (x0, y0, x1, y1), (x0, y0, x1, y1), 1, None, height, r)
