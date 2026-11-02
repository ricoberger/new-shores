"""
Parts of the V7 model rework (12 voxels per tile houses), added next to
`parts.py` / `detail*.py` without changing them; recipes import them as
`from nsvoxel import parts_v7 as W`.

`coursed_stone_2` is the rubble stone of the finer grid (courses two voxels
high, stones 2–5 voxels long in three shades), `heavy_frame` a half-timber
storey of few heavy timbers (two-voxel posts in bays, one rail, a diagonal
brace per bay, large plaster panels), `two_light` a tall two-light casement
with shutters, `framed_house` the tier-2/3 block of `detail_v4.townhouse` on
them (stone ground floor, jettied framed upper storey with its windows,
roof), `plank_shed` a boarded shed with a door under a gable roof, `stack` a
stone chimney of any width with a pot, `stairs` a plank stair beside a wall.
"""

from . import parts as _p  # first: parts imports detail at its end
from . import detail as _d
from . import detail_v4 as _v
from .grid import hash3, shade_of
from .mats import PLASTER, STONE, STONE_DARK, STONE_LIGHT, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT

#: The three stone shades of rubble: dark, mid, pale.
RUBBLE = (0.66, 0.84, 1.0)


def coursed_stone_2(v, x0, y0, x1, y1, z0, z1, m=STONE, seed=0, course=2, core=True, shades=RUBBLE):
    """
    Coursed rubble for the 12-voxel grid: courses `course` voxels high of
    stones 2–5 voxels long in three shades (`shades`), joints staggered
    course by course; far fewer quads than `detail.coursed_stone` (one voxel
    courses, proud stones). The core is filled solid unless core=False.
    """
    if core:
        _d.fill(v, x0, y0, x1, y1, z0, z1, m)
    else:
        v.walls(x0, y0, x1, y1, z0, z1, m)
    for side, f in _p.faces_of(v, x0, y0, x1, y1).items():
        a0, a1 = _p.span(side, x0, y0, x1, y1)
        sk = {"y+": 1, "y-": 2, "x+": 3, "x-": 4}[side]
        last = None
        for ci, z in enumerate(range(z0, z1, course)):
            a = a0 - int(hash3(ci, sk, 1, seed) * 4)
            while a < a1:
                n = 2 + int(hash3(a, ci, sk, seed + 2) * 4)
                h = hash3(a, ci, sk, seed + 3)
                s = shades[0] if h < 0.3 else (shades[2] if h < 0.6 else shades[1])
                if s == last:  # neighbours differ: the stones read
                    s = shades[1] if s != shades[1] else shades[2]
                last = s
                c = shade_of(m, s)
                for i in range(max(a, a0), min(a + n, a1)):
                    for zz in range(z, min(z + course, z1)):
                        f.put(i, zz, c)
                a += n


def bays(a0, a1, bay=11, post=2):
    """The post positions (first column of each post) of a wall a0..a1 in bays of about `bay` voxels: corners included."""
    n = max(1, round((a1 - a0 - post) / bay))
    return [a0 + round(k * (a1 - a0 - post) / n) for k in range(n + 1)]


def heavy_frame(v, x0, y0, x1, y1, z0, z1, infill=PLASTER, frame=TIMBER_DARK, bay=11, post=2, rail=None, sill=True, open=None, core=True):
    """
    A half-timbered storey of few heavy timbers: posts `post` voxels wide
    in bays of about `bay` voxels (corners included), a head beam at z1 − 1,
    a sill beam at z0 (sill=False: none), one rail at `rail` and a diagonal
    brace two voxels wide in every bay, rising toward the wall's nearer
    corner; large plaster panels between. `open` maps a side to the bay
    indices left free of rail and brace (for windows). Returns side → the
    bays' (a0, a1) panel spans.
    """
    if core:
        _d.fill(v, x0, y0, x1, y1, z0, z1, infill)
    else:
        v.walls(x0, y0, x1, y1, z0, z1, infill)
    open = open or {}
    out = {}
    for side, f in _p.faces_of(v, x0, y0, x1, y1).items():
        a0, a1 = _p.span(side, x0, y0, x1, y1)
        posts = bays(a0, a1, bay, post)
        panels = [(p + post, q) for p, q in zip(posts, posts[1:])]
        out[side] = panels
        for p in posts:
            for i in range(p, min(p + post, a1)):
                for z in range(z0, z1):
                    f.put(i, z, frame)
        for z in ([z0] if sill else []) + [z1 - 1]:
            for a in range(a0, a1):
                f.put(a, z, frame)
        mid = (a0 + a1) / 2
        for k, (p0, p1) in enumerate(panels):
            if k in open.get(side, ()):
                continue
            if rail is not None:
                for a in range(p0, p1):
                    f.put(a, rail, frame)
            lo, hi = z0 + (1 if sill else 0), z1 - 1
            rows = hi - lo
            w = p1 - p0
            toward_lo = (p0 + p1) / 2 < mid  # rise toward the nearer corner
            for j in range(rows):
                t = min(j, w - 2)  # 45°, from the foot of the inner post
                a = p0 + t if toward_lo else p1 - 2 - t
                f.put(a, lo + j, frame)
                f.put(a + 1, lo + j, frame)
    return out


def two_light(f, a, z, h=6, shutters=None, sill=TIMBER_LIGHT, frame=TIMBER_LIGHT, box=None):
    """A two-light casement five voxels wide and `h` tall: a mullion between the lights, a sill, open shutters either side (if given), an optional flower box."""
    _d.casement(f, a, z, 5, h, frame=None, sill=sill, shutters=shutters, bars=False, box=box)
    for j in range(h):
        f.put(a + 2, z + j, frame, out=-1)


def panel_window(f, panel, z, h=6, **kw):
    """A two_light centred in a heavy_frame panel (a0, a1)."""
    p0, p1 = panel
    two_light(f, (p0 + p1 - 5) // 2, z, h, **kw)


def framed_house(v, x0, y0, x1, y1, along="x", ground=10, top=19, infill=PLASTER, frame=TIMBER_DARK, roof=None, kind="tiles", rise=1.5, hip=False, seed=0, bay=11, windows=None, shutters=None, plain=("y-", "x+"), free=None, rail=None, gable_jetty=True, z0=1, ov=1, stone=STONE, plinth=STONE_LIGHT, quoins=True):
    """
    The block of `detail_v4.townhouse` on the V7 parts: a pale plinth band flush with the wall,
    a coursed-rubble ground floor to `ground` (dressed quoins), a jetty, a
    heavy-framed upper storey one voxel wider on each side up to `top` with
    two-light casements in the bays `windows` names (side → bay indices;
    shutters on the sides not in `plain`; `free`: more bays without rail and
    brace, e.g. for a door), jettied gable ends, a roof of
    courses. Returns a detail.Building with `.panels` (side → bay spans of
    the upper storey).
    """
    _d.plinth(v, x0, y0, x1, y1, z0, plinth, out=0)  # a band flush with the wall: it meets the painted ground
    _d.fill(v, x0, y0, x1, y1, z0, z0 + 1, plinth)
    coursed_stone_2(v, x0, y0, x1, y1, z0 + 1, ground, stone, seed)
    if quoins:
        _d.dressed_quoins(v, x0, y0, x1, y1, z0 + 1, ground)
    _d.jetty_course(v, x0, y0, x1, y1, ground)
    ux0, uy0, ux1, uy1 = x0 - 1, y0 - 1, x1 + 1, y1 + 1
    windows = windows or {}
    rail = rail if rail is not None else ground + 4
    open = {s: tuple(windows.get(s, ())) + tuple((free or {}).get(s, ())) for s in set(windows) | set(free or {})}
    panels = heavy_frame(v, ux0, uy0, ux1, uy1, ground + 1, top, infill, frame, bay=bay, rail=rail, open=open)
    rx0, rx1, ry0, ry1 = ux0, ux1, uy0, uy1
    if gable_jetty and not hip:
        if along == "x":
            for y in range(uy0, uy1):
                v.set(ux0 - 1, y, top - 1, frame if y % 2 else TIMBER_LIGHT)
                v.set(ux1, y, top - 1, frame if y % 2 else TIMBER_LIGHT)
            rx0, rx1 = ux0 - 1, ux1 + 1
        else:
            for x in range(ux0, ux1):
                v.set(x, uy0 - 1, top - 1, frame if x % 2 else TIMBER_LIGHT)
                v.set(x, uy1, top - 1, frame if x % 2 else TIMBER_LIGHT)
            ry0, ry1 = uy0 - 1, uy1 + 1
    r = _d.roof(v, rx0, rx1, ry0, ry1, top, kind, along=along, rise=rise, ov=ov, gable=infill, seed=seed, hip=hip, m=roof)
    if gable_jetty and not hip:
        _v._gable_frame(v, r, along, frame, infill)
    roof_core(v, r, infill, roof or _d.ROOFS[kind][0])
    b = _d.Building(v, (x0, y0, x1, y1), (ux0, uy0, ux1, uy1), z0, ground, top, r)
    b.panels = panels
    faces = _p.faces_of(v, ux0, uy0, ux1, uy1)
    for side, ks in windows.items():
        for k in ks:
            panel_window(faces[side], panels[side][k], ground + 2, top - ground - 3, shutters=None if side in plain else shutters)
    return b


def roof_core(v, r, core, m):
    """
    Recolours the hidden attic fill of Roof r (cells of `core` with all six
    neighbours set) in the roof material `m`: no visible change, but the
    lite level (grid.downsample, most common material of a block) reads the
    roof as roof instead of the gable plaster.
    """
    for x in range(r.x0, r.x1):
        for y in range(r.y0, r.y1):
            for z in range(r.z, r.top):
                if v.get(x, y, z) == core and all(v.has(x + dx, y + dy, z + dz) for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))):
                    v.set(x, y, z, m)


def plank_shed(v, x0, y0, x1, y1, wall=11, along="y", door="y+", m=TIMBER_LIGHT, batten=TIMBER_DARK, roof=None, kind="tiles", rise=1.5, seed=0, z0=1):
    """
    A boarded shed: a stone footing, walls of vertical boards in two shades
    with a dark batten every third voxel and corner posts to `wall`, a
    framed plank door on the `door` side, a gable roof along `along` with
    boarded gables. Returns the Roof.
    """
    _d.plinth(v, x0, y0, x1, y1, z0, STONE_LIGHT, out=0)
    _d.boarded(v, x0, y0, x1, y1, z0 + 1, wall, m=m, batten=batten, every=3)
    for side, f in _p.faces_of(v, x0, y0, x1, y1).items():
        a0, a1 = _p.span(side, x0, y0, x1, y1)
        for z in range(z0 + 1, wall):
            f.put(a0, z, TIMBER_DARK)
            f.put(a1 - 1, z, TIMBER_DARK)
        for a in range(a0, a1):
            f.put(a, wall - 1, TIMBER_DARK)
    r = _d.roof(v, x0 - 1, x1 + 1, y0 - 1, y1 + 1, wall, kind, along=along, rise=rise, ov=1, gable=shade_of(m, 0.92), seed=seed, m=roof)
    roof_core(v, r, shade_of(m, 0.92), roof or _d.ROOFS[kind][0])
    f = _p.faces_of(v, x0, y0, x1, y1)[door]
    a0, a1 = _p.span(door, x0, y0, x1, y1)
    _d.entrance(f, (a0 + a1) // 2 - 2, z0 + 1, 4, 7, leaf=TIMBER, frame=TIMBER_DARK, lintel=TIMBER_DARK, steps=1)
    return r


def stack(v, x, y, z0, z1, w=3, d=3, pot=None):
    """A stone chimney stack w × d from z0 to z1 in two shades in courses of three, a corbelled cap one voxel wider and a pot."""
    for z in range(z0, z1):
        for dx in range(w):
            for dy in range(d):
                v.set(x + dx, y + dy, z, STONE_LIGHT if (z // 3) % 2 == 0 else STONE)
    v.box(x - 1, y - 1, z1, x + w + 1, y + d + 1, z1 + 1, STONE_DARK)
    v.box(x, y, z1 + 1, x + w, y + d, z1 + 2, STONE)
    v.box(x + 1, y + 1, z1 + 2, x + w - 1, y + d - 1, z1 + 4, pot or shade_of(TERRACOTTA, 0.9))


def stairs(v, x, y0, z0, steps, side=1, width=3, m=TIMBER_LIGHT, stringer=TIMBER_DARK):
    """A plank stair along y at columns x..x+width, two voxels per step, rising from the ground (side=1 toward +y, −1 toward −y), on a stringer."""
    for i in range(steps):
        y = y0 + i * 2 * side
        for dy in (0, side):
            v.box(x, y + dy, z0 + i, x + width, y + dy + 1, z0 + i + 1, m)
        v.box(x, y, 1, x + width, y + 1, z0 + i, stringer)


