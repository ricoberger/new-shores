"""
Parts for the tier-4 (Patricians) recipes at the D-057 §3 detail (V5):
dressed ashlar in courses, string courses and cornices, a whole
Patrician block (`palazzo`: ashlar ground floor, plastered upper storeys,
quoins, cornice, roof), framed windows with hoods and keystones, arcades
and colonnades, balustrades, towers with pyramid roofs and finials,
lancets, rose windows, buttresses, domes, heaps, lying casks and cask
racks, vine trellis rows, a mine headframe with its wheel, and small
trade props (cloth bolts, mannequins, spinning wheels, candles).

Recipes import it next to the parts library:

    from nsvoxel import parts as P
    from nsvoxel import detail_v5 as Q

Conventions as in parts.py / detail.py: voxels (8 per tile), x east, y
toward the front (+y), z up from the ground plate (z = 0); facades through
P.Face; flat palette colours (the shader jitters, V3b), shade steps only
where they are structure (courses, bands, rows). Nothing here changes the
helpers of parts.py or detail.py.
"""

from . import parts as P
from .grid import hash3, mat, shade_of
from .mats import (
    BRASS,
    CROWN,
    IRON,
    PLANK,
    PLASTER,
    STONE,
    STONE_DARK,
    TERRACOTTA,
    TIMBER,
    TIMBER_DARK,
    TIMBER_LIGHT,
    WINDOW,
)

#: Pale dressed ashlar of the Patrician ground floors (paler than P.DRESSED's walls).
ASHLAR = mat("stone", 1.12)
#: The darker course of the ashlar bands.
ASHLAR_DARK = mat("stone", 1.02)
#: String courses, cornices, window surrounds of the Patrician tier.
DRESSED = P.DRESSED
#: Grapes on the vine (a deep blue-violet from the dyed cloth role).
GRAPE = mat("dye-blue", 0.62)
#: Vine leaves.
VINE = mat("hemp", 1.05)
#: Gold (bright brass) and verdigris (copper-green streaks).
GOLD = mat("flower", 1.08)
VERDIGRIS = mat("moss", 1.12)
#: Copper metal (a warm red-brown).
COPPER = mat("terracotta", 1.18)
#: Quartz and glass panes (pale, crystalline).
QUARTZ = mat("foam", 0.98)
QUARTZ_SHADE = mat("foam", 0.86)
#: Candle wax.
WAX = mat("canvas", 1.06)


# ---------------------------------------------------------------- walls


def ashlar(v, x0, y0, x1, y1, z0, z1, m=ASHLAR, dark=ASHLAR_DARK, course=2, core=True):
    """
    Dressed-stone walls in regular courses `course` voxels high, two shades
    alternating course by course (one merged band per course and face: the
    ashlar reads at mid zoom and stays cheap). Core solid unless core=False.
    """
    if core:
        P.fill(v, x0, y0, x1, y1, z0, z1, m)
    else:
        v.walls(x0, y0, x1, y1, z0, z1, m)
    for z in range(z0, z1):
        if ((z - z0) // course) % 2:
            v.walls(x0, y0, x1, y1, z, z + 1, dark)


def string_course(v, x0, y0, x1, y1, z, m=DRESSED, out=1):
    """A moulded band one voxel high round a block at height z, `out` voxels proud."""
    P.plinth(v, x0, y0, x1, y1, z, m, out=out, h=1)


def cornice(v, x0, y0, x1, y1, z, m=DRESSED):
    """A two-step cornice under the eaves: a band one voxel proud at z − 1 and one two voxels proud at z (on the walls' outline)."""
    string_course(v, x0, y0, x1, y1, z - 1, m, out=1)
    v.walls(x0 - 2, y0 - 2, x1 + 2, y1 + 2, z, z + 1, shade_of(m, 0.94))
    v.walls(x0 - 1, y0 - 1, x1 + 1, y1 + 1, z, z + 1, shade_of(m, 0.94))


def pilasters(f, spots, z0, z1, m=DRESSED):
    """Flat pilasters one voxel proud on a facade at the positions `spots`, z0..z1."""
    for a in spots:
        for z in range(z0, z1):
            f.put(a, z, m, out=1)


class Palazzo:
    """What palazzo() built: the block, storey floors, wall top and the Roof."""

    def __init__(self, v, rect, floors, top, r):
        self.v = v
        self.rect = rect
        self.floors = floors  # floor z of each storey (ground first)
        self.top = top  # wall top (the roof starts here)
        self.roof = r

    def face(self, side):
        x0, y0, x1, y1 = self.rect
        return P.faces_of(self.v, x0, y0, x1, y1)[side]

    def span(self, side):
        x0, y0, x1, y1 = self.rect
        return P.span(side, x0, y0, x1, y1)


def palazzo(v, x0, y0, x1, y1, storeys=(8, 6, 6), z0=1, upper=PLASTER, base=ASHLAR, roof=TERRACOTTA, kind="tiles", along="x", hip=False, rise=None, ov=1, seed=0, ridge=None, gable=None, quoins=False):
    """
    A Patrician block (D-057 §3, tier language "dressed stone, ornament,
    three storeys"): a proud plinth at z0, an ashlar ground floor
    storeys[0] high, plastered (flat `upper`) upper storeys (dressed
    quoins with quoins=True), a string course at every floor line, a two-step cornice and a
    roof of courses (`roof` material, `kind`, hipped or gabled). The volume
    is filled solid. Returns a Palazzo.
    """
    P.plinth(v, x0, y0, x1, y1, z0, STONE_DARK, out=1)
    P.fill(v, x0, y0, x1, y1, z0, z0 + 1, STONE_DARK)
    z = z0 + 1
    floors = [z]
    ashlar(v, x0, y0, x1, y1, z, z + storeys[0], base, shade_of(base, 0.91))
    z += storeys[0]
    for h in storeys[1:]:
        floors.append(z)
        P.fill(v, x0, y0, x1, y1, z, z + h, upper)
        if quoins:
            P.dressed_quoins(v, x0, y0, x1, y1, z, z + h)
        z += h
    for fz in floors[1:]:
        string_course(v, x0, y0, x1, y1, fz)
    r = P.roof(v, x0, x1, y0, y1, z, kind, along=along, rise=rise, ov=ov, gable=gable or upper, seed=seed, hip=hip, m=roof, ridge=ridge)
    if ov <= 1:
        string_course(v, x0, y0, x1, y1, z - 1, DRESSED)
    return Palazzo(v, (x0, y0, x1, y1), floors, z, r)


# ---------------------------------------------------------------- openings


def window(f, a, z, w=2, h=4, frame=DRESSED, hood="key", shutters=None, box=None, glass=WINDOW, surround=False, bars=TIMBER_LIGHT):
    """
    A Patrician window: glazing one voxel back with pale glazing bars, a
    dressed sill and a hood over it — "key" (a lintel with a raised
    keystone), "pediment" (a lintel stepping up to a point), "cornice" (a
    lintel only) or None; surround=True also frames the opening in the
    wall plane (ashlar storeys: the plaster storeys show their wall
    between the windows).
    """
    P.casement(f, a, z, w, h, frame=frame if surround else None, sill=frame, lintel=frame if hood else None, shutters=shutters, box=box, glass=glass)
    if not surround:
        if h >= 3:
            for i in range(w):
                f.put(a + i, z + h // 2, bars, out=-1)
        if w >= 3:
            for j in range(h):
                f.put(a + w // 2, z + j, bars, out=-1)
    if hood == "key":
        f.put(a + (w - 1) // 2, z + h + 1, frame, out=1)
        if w % 2 == 0:
            f.put(a + w // 2, z + h + 1, frame, out=1)
    elif hood == "pediment":
        for i in range(0, w):
            f.put(a + i, z + h + 1, frame, out=1)
        f.put(a + (w - 1) // 2, z + h + 2, frame, out=1)
        if w % 2 == 0:
            f.put(a + w // 2, z + h + 2, frame, out=1)


def lancet(f, a, z, w=2, h=7, frame=DRESSED, glass=WINDOW):
    """A tall pointed window: glazing with a transom, a frame and a pointed head (top corners closed, a point above)."""
    P.casement(f, a, z, w, h, frame=frame, sill=frame, glass=glass)
    if w >= 2:
        f.put(a, z + h - 1, frame)
        f.put(a + w - 1, z + h - 1, frame)
        f.put(a, z + h - 1, frame, out=-1)
        f.put(a + w - 1, z + h - 1, frame, out=-1)
    f.put(a + (w - 1) // 2, z + h + 1, frame)
    if w % 2 == 0:
        f.put(a + w // 2, z + h + 1, frame)


def rose_window(f, ca, cz, r=4, frame=DRESSED, glass=WINDOW, tracery=None):
    """A round window centred at (ca, cz): glass one voxel back inside a dressed ring, tracery spokes and a hub."""
    tracery = tracery or frame
    rr = r + 0.5
    for i in range(-r - 1, r + 2):
        for j in range(-r - 1, r + 2):
            d = (i * i + j * j) ** 0.5
            if d <= r - 0.5:
                f.put(ca + i, cz + j, None)
                spoke = i == 0 or j == 0 or abs(i) == abs(j) or d < 1.2
                f.put(ca + i, cz + j, tracery if spoke else glass, out=-1)
            elif d <= rr + 0.7:
                f.put(ca + i, cz + j, frame)
                f.put(ca + i, cz + j, frame, out=1)


def arcade(f, a0, a1, z0, h, bay=4, pier=2, depth=3, back=None, pier_m=None):
    """
    Open round-headed arches along a facade from a0 to a1: openings `bay`
    voxels wide between piers `pier` wide, `h` high, cut `depth` voxels deep
    with a shaded back wall (a loggia or cloister walk), the arch heads
    closed at the corners; piers optionally re-faced in `pier_m`.
    """
    back = back or shade_of(PLASTER, 0.82)
    a = a0 + pier
    while a + bay <= a1 - pier + 1:
        for i in range(bay):
            for j in range(h):
                corner = j == h - 1 and i in (0, bay - 1)
                if corner:
                    continue
                for k in range(depth):
                    f.put(a + i, z0 + j, None, out=-k)
                f.put(a + i, z0 + j, back, out=-depth)
        if pier_m is not None:
            for j in range(h + 1):
                for p in range(1, pier + 1):
                    f.put(a - p, z0 + j, pier_m)
        a += bay + pier
    if pier_m is not None:
        for j in range(h + 1):
            for p in range(1, pier + 1):
                f.put(a - p, z0 + j, pier_m)


def balustrade(v, cells, z, m=DRESSED, rail=None):
    """A balustrade along ground cells (x, y) at height z: balusters on every other cell, a rail above (two voxels high)."""
    rail = rail or m
    for i, (x, y) in enumerate(cells):
        if i % 2 == 0 or i == len(cells) - 1:
            v.set(x, y, z, m)
        v.set(x, y, z + 1, rail)


def colonnade(v, x0, x1, y, z0, h, every=4, m=DRESSED, beam=None, size=2):
    """
    A row of square columns (size × size) along x at y from x0 to x1 with a
    darker base and capital course and an entablature beam on top
    (x0 − 1 .. x1 + 1); returns the beam's top z.
    """
    beam = beam or m
    xs = list(range(x0, x1 - size + 1, every))
    if xs[-1] != x1 - size:
        xs.append(x1 - size)
    for x in xs:
        for z in range(z0, z0 + h):
            c = shade_of(m, 0.9) if z in (z0, z0 + h - 1) else m
            v.box(x, y, z, x + size, y + size, z + 1, c)
    v.box(x0 - 1, y - 0, z0 + h, x1 + 1, y + size, z0 + h + 1, beam)
    return z0 + h + 1


def grille(f, a, z, w, h, m=IRON):
    """Iron bars over an opening (every other column), one voxel proud: a strongroom window."""
    for i in range(0, w, 2):
        for j in range(h):
            f.put(a + i, z + j, m, out=1)
    for i in range(w):
        f.put(a + i, z + h - 1, m, out=1)


# ---------------------------------------------------------------- towers, domes, buttresses


def finial(v, x, y, z, m=BRASS, h=2):
    """A finial (ball and spike) on a roof's apex cell."""
    v.set(x, y, z, m)
    for k in range(1, h):
        v.set(x, y, z + k, shade_of(m, 0.92))


def tower(v, x0, y0, x1, y1, z0, z1, wall=ASHLAR, roof=TERRACOTTA, kind="tiles", rise=2.0, seed=0, finial_m=BRASS, cornice_m=DRESSED, plaster=False):
    """
    A square tower x0..x1 × y0..y1 from z0 to z1: ashlar (or flat
    plaster), a cornice under a steep pyramid roof (hip roof with
    `rise`) and a finial on the apex. Returns the Roof.
    """
    if plaster:
        P.fill(v, x0, y0, x1, y1, z0, z1, wall)
    else:
        ashlar(v, x0, y0, x1, y1, z0, z1, wall, shade_of(wall, 0.91))
    string_course(v, x0, y0, x1, y1, z1 - 1, cornice_m)
    r = P.roof(v, x0, x1, y0, y1, z1, kind, hip=True, rise=rise, m=roof, seed=seed, eaves=False)
    if finial_m is not None:
        finial(v, (x0 + x1) // 2, (y0 + y1) // 2, r.top, finial_m)
    return r


def buttress(v, x, y, z0, z1, side, w=2, depth=2, m=STONE, cap=DRESSED):
    """A stepped buttress against a wall at (x, y) (the wall cell's outer plane) toward `side`, w wide, `depth` deep at the foot, one step back halfway up."""
    dx, dy = {"y+": (0, 1), "y-": (0, -1), "x+": (1, 0), "x-": (-1, 0)}[side]
    ax, ay = (1, 0) if side in ("y+", "y-") else (0, 1)
    mid = z0 + (z1 - z0) // 2
    for k in range(1, depth + 1):
        top = z1 if k == 1 else mid
        for i in range(w):
            for z in range(z0, top):
                v.set(x + dx * k + ax * i, y + dy * k + ay * i, z, m)
            v.set(x + dx * k + ax * i, y + dy * k + ay * i, top, cap)


def dome(v, cx, cy, z, r, m=STONE, bands=None, lantern=None):
    """
    A hemispherical dome of radius r centred over (cx, cy) from z (solid),
    in courses of alternating shade every two layers (`bands`: the second
    shade); `lantern` (a material) adds a small open lantern on top.
    """
    bands = bands or shade_of(m, 0.92)
    for x in range(int(cx - r) - 1, int(cx + r) + 2):
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for zz in range(z, z + int(r) + 1):
                d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + ((zz - z) + 0.5) ** 2) ** 0.5
                if d <= r:
                    v.set(x, y, zz, m if ((zz - z) // 2) % 2 == 0 else bands)
    if lantern is not None:
        top = z + int(r)
        v.box(int(cx) - 1, int(cy) - 1, top, int(cx) + 1, int(cy) + 1, top + 2, lantern)
        v.box(int(cx) - 1, int(cy) - 1, top + 2, int(cx) + 1, int(cy) + 1, top + 3, shade_of(lantern, 0.85))


def heap(v, cx, cy, rx, ry, h, m):
    """A heap on the ground: an ellipsoid cap (z ≥ 1) of material m (or m(x, y, z))."""
    v.ellipsoid(cx, cy, 0, rx, ry, h, m, keep=lambda x, y, z: z >= 1)


# ---------------------------------------------------------------- casks, racks, trellis


def lying_cask(v, x, y, z, along="x", length=4, m=TIMBER_LIGHT, end=PLANK):
    """A cask on its side (2 × 2 section, `length` long): pale heads, iron hoops near both ends."""
    for k in range(length):
        c = end if k in (0, length - 1) else (IRON if k in (1, length - 2) and length >= 5 else m)
        for i in range(2):
            for j in range(2):
                if along == "x":
                    v.set(x + k, y + i, z + j, c)
                else:
                    v.set(x + i, y + k, z + j, c)


def cask_rack(v, x, y, z, n=3, along="x", tiers=2, length=4, m=TIMBER_LIGHT):
    """Casks lying side by side on a timber cradle, `tiers` high (the upper tier in the gaps): n per row."""
    span = n * 2 + 1
    if along == "x":
        v.box(x, y - 1, z, x + 1, y + span - 1, z + 1, TIMBER_DARK)
        v.box(x + length - 1, y - 1, z, x + length, y + span - 1, z + 1, TIMBER_DARK)
    else:
        v.box(x - 1, y, z, x + span - 1, y + 1, z + 1, TIMBER_DARK)
        v.box(x - 1, y + length - 1, z, x + span - 1, y + length, z + 1, TIMBER_DARK)
    for t in range(tiers):
        for i in range(n - t):
            o = i * 2 + t
            if along == "x":
                lying_cask(v, x, y + o, z + 1 + t * 2, "x", length, shade_of(m, 1.0 if (i + t) % 2 == 0 else 0.9))
            else:
                lying_cask(v, x + o, y, z + 1 + t * 2, "y", length, shade_of(m, 1.0 if (i + t) % 2 == 0 else 0.9))


def trellis_row(v, x0, x1, y, z=1, h=5, every=6, seed=0, grapes=True, post=TIMBER, along="x"):
    """
    A vine row on a trellis from x0 to x1 (inclusive) at y: posts every
    `every` cells, vine stocks and a leafy hedge
    three cells wide (the outer cells ragged by hash: shape, not colour)
    from z + 2 to the top (one flat leaf colour), with grape
    bunches hanging under the leaves on both sides. along="y" swaps the
    axes (the row runs along y at x = y).
    """

    def put(a, b, zz, m):
        if along == "x":
            v.set(a, b, zz, m)
        else:
            v.set(b, a, zz, m)

    for a in range(x0, x1 + 1):
        is_post = (a - x0) % every == 0 or a == x1
        leaf = VINE
        if is_post:
            for zz in range(z, z + h + 1):
                put(a, y, zz, post)
        else:
            put(a, y, z, TIMBER_DARK)
            put(a, y, z + 1, shade_of(TIMBER, 1.1))
            for zz in range(z + 2, z + h + 1):
                put(a, y, zz, leaf)
            if hash3(a, y, 44, seed) < 0.2:
                put(a, y, z + h + 1, leaf)
        for side in (-1, 1):
            lo = z + 3 if hash3(a, y + side, 41, seed) < 0.5 else z + 2
            for zz in range(lo, z + h):
                put(a, y + side, zz, leaf)
            if grapes and hash3(a, y + side, 42, seed) < 0.3:
                put(a, y + side, lo - 1, GRAPE)


# ---------------------------------------------------------------- machines


def wheel(v, cx, cy, cz, r, plane="xz", rim=TIMBER, spokes=TIMBER_LIGHT, hub=IRON):
    """A spoked wheel of radius r centred at (cx, cy, cz) in the xz or yz plane: rim ring, four spokes, a hub."""
    for i in range(-r, r + 1):
        for j in range(-r, r + 1):
            d = (i * i + j * j) ** 0.5
            c = None
            if r - 0.6 <= d <= r + 0.4:
                c = rim
            elif i == 0 or j == 0:
                c = spokes
            if c is None:
                continue
            if i == 0 and j == 0:
                c = hub
            if plane == "xz":
                v.set(cx + i, cy, cz + j, c)
            else:
                v.set(cx, cy + i, cz + j, c)


def headframe(v, x, y, z0, h, along="x", m=TIMBER, r=3):
    """
    A mine hoist: two A-frame legs (2 apart along `along`) over a shaft at
    (x, y), a cross-head at z0 + h with a sheave wheel of radius r, a
    rope down the shaft and back-stays. Returns the wheel's centre z.
    """
    top = z0 + h
    for side in (-2, 2):
        for zz in range(z0, top + 1):
            k = (top - zz) // 3
            if along == "x":
                v.set(x - k - 1, y + side, zz, m)
                v.set(x + k + 1, y + side, zz, m)
            else:
                v.set(x + side, y - k - 1, zz, m)
                v.set(x + side, y + k + 1, zz, m)
    if along == "x":
        v.box(x - 1, y - 2, top, x + 2, y + 3, top + 1, TIMBER_DARK)
        wheel(v, x, y, top + r, r, "xz")
        for zz in range(z0, top):
            v.set(x + r, y, zz, IRON if zz % 3 else TIMBER_DARK)
    else:
        v.box(x - 2, y - 1, top, x + 3, y + 2, top + 1, TIMBER_DARK)
        wheel(v, x, y, top + r, r, "yz")
        for zz in range(z0, top):
            v.set(x, y + r, zz, IRON if zz % 3 else TIMBER_DARK)
    return top + r


# ---------------------------------------------------------------- trade props


def bolts(v, x, y, z, colours, along="x", length=4):
    """Cloth bolts lying side by side (2 × 2 section each, `length` long) in the given colours; rigid (not cloth on a line)."""
    for i, c in enumerate(colours):
        for k in range(length):
            for j in range(2):
                if along == "x":
                    v.set(x + k, y + i * 2, z + j, c if k not in (0, length - 1) else shade_of(c, 0.88))
                    v.set(x + k, y + i * 2 + 1, z + j, c if k not in (0, length - 1) else shade_of(c, 0.88))
                else:
                    v.set(x + i * 2, y + k, z + j, c if k not in (0, length - 1) else shade_of(c, 0.88))
                    v.set(x + i * 2 + 1, y + k, z + j, c if k not in (0, length - 1) else shade_of(c, 0.88))


def mannequin(v, x, y, z, dress, trim=None):
    """A dress on a stand: a timber foot and pole, a 2 × 2 bodice and a 4-voxel skirt widening to 3 × 3, a pale head knob."""
    trim = trim or shade_of(dress, 0.85)
    v.set(x + 1, y + 1, z, TIMBER_DARK)
    v.box(x, y, z + 1, x + 3, y + 3, z + 3, dress)
    v.box(x, y, z + 1, x + 3, y + 3, z + 2, trim)
    v.box(x + 1, y, z + 3, x + 3, y + 2, z + 5, dress)
    v.set(x + 1, y, z + 5, TIMBER_LIGHT)


def spinning_wheel(v, x, y, z, along="x"):
    """A spinning wheel: bench on legs, a wheel of radius 2 upright on it, a spool (canvas)."""
    if along == "x":
        v.box(x, y, z + 1, x + 5, y + 1, z + 2, TIMBER)
        v.set(x, y, z, TIMBER_DARK)
        v.set(x + 4, y, z, TIMBER_DARK)
        wheel(v, x + 1, y, z + 4, 2, "xz", rim=TIMBER_LIGHT, spokes=TIMBER, hub=TIMBER_DARK)
        v.set(x + 4, y, z + 2, mat("canvas", 1.0))
        v.set(x + 4, y, z + 3, mat("canvas", 0.92))
    else:
        v.box(x, y, z + 1, x + 1, y + 5, z + 2, TIMBER)
        v.set(x, y, z, TIMBER_DARK)
        v.set(x, y + 4, z, TIMBER_DARK)
        wheel(v, x, y + 1, z + 4, 2, "yz", rim=TIMBER_LIGHT, spokes=TIMBER, hub=TIMBER_DARK)
        v.set(x, y + 4, z + 2, mat("canvas", 1.0))
        v.set(x, y + 4, z + 3, mat("canvas", 0.92))


def candle_rack(v, x0, x1, y, z, h=6, m=WAX, along="x"):
    """A dipping rack: two posts and a bar at z + h with rows of hanging candles (two voxels, alternate lengths) under it."""
    for a in (x0, x1):
        if along == "x":
            v.box(a, y, z, a + 1, y + 1, z + h + 1, TIMBER)
        else:
            v.box(y, a, z, y + 1, a + 1, z + h + 1, TIMBER)
    for a in range(x0, x1 + 1):
        if along == "x":
            v.set(a, y, z + h, TIMBER_DARK)
        else:
            v.set(y, a, z + h, TIMBER_DARK)
    for a in range(x0 + 1, x1, 1):
        n = 2 if a % 2 else 3
        for k in range(1, n + 1):
            if along == "x":
                v.set(a, y, z + h - k, m)
            else:
                v.set(y, a, z + h - k, m)


def shell_heap(v, cx, cy, r, h, seed=0):
    """A heap of oyster shells in layers: pale shell over a grey stone course (flat colours; the shader jitters)."""

    def m(x, y, z):
        return mat("canvas", 0.95) if z % 2 else mat("stone", 1.05)

    heap(v, cx, cy, r, r, h, m)


def leafy_bank(v, x0, y0, x1, y1, seed=0, m=CROWN):
    """A low hedge bank (two layers, ragged by hash) over x0..x1 × y0..y1."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            v.set(x, y, 1, m)
            if hash3(x, y, 2, seed) < 0.6:
                v.set(x, y, 2, shade_of(m, 1.1))
