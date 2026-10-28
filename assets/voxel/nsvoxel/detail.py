"""
Building parts at the D-057 §3 detail level (V3), re-exported by parts.py
(recipes call them as P.<name>): per-voxel colour jitter, roofs as courses
with eaves, ridge tiles or a thatch roll, chimney stacks with pots, pegged
timber frames, coursed stone with a proud plinth, framed windows with
sills, lintels and shutters, doors with frames, strap hinges and a step,
uneven fences, crop rows, ground scatter, yard props, and `building()` —
the whole tier-style block behind `P.house`.

Conventions as in parts.py: voxels (8 per tile), x east, y toward the
front (+y), z up from the ground plate (z = 0); facades through Face.
Hidden volumes are filled solid (walls, attics) so that only the outer
shell is meshed and the jitter never pays for faces nobody sees.
"""

from . import parts as _p
from .grid import hash3, mat, shade_of
from .mats import (
    BRASS,
    CANVAS,
    CROWN,
    DIRT,
    FLOWER,
    GRASS_A,
    GRASS_B,
    HEMP,
    HEMP_MARK,
    IRON,
    OCHRE,
    PLANK,
    PLASTER,
    SLATE,
    STONE,
    STONE_DARK,
    STONE_LIGHT,
    TERRACOTTA,
    TERRACOTTA_DARK,
    THATCH,
    THATCH_DARK,
    THATCH_LIGHT,
    TIMBER,
    TIMBER_DARK,
    TIMBER_LIGHT,
    WHEAT,
    WHEAT_MARK,
    WINDOW,
)

Face = _p.Face

#: Pale timber of the pegs at the joints of a frame.
PEG = mat("timber", 1.3)
#: Dressed stone (quoins, window surrounds): clearly paler than wall stone.
DRESSED = mat("stone", 1.15)
#: Brick (chimney stacks, ovens): terracotta in a darker, browner shade.
BRICK = mat("terracotta", 0.9)

# ---------------------------------------------------------------- colour jitter


def colour_jitter(v, seed=0, scale=1.0, ground=0.12):
    """
    Kept for the recipes' signature (D-057 V3b): the export is flat. The
    per-voxel variety of every material is the client shader's
    (client/src/render/jitter.ts; strength by the palette role's class,
    nsvoxel/jitter.py), so a baked speckle would only split the greedy
    quads and fill the models folder. Authored structure — courses, ridge
    tiles, rows, quoins — stays in the recipes. `seed`, `scale` and
    `ground` have no effect; returns `v` unchanged.
    """
    return v


# ---------------------------------------------------------------- ground


GROUND_ROLES = ("grass-a", "grass-b", "road-dirt", "sand", "pasture", "pasture-mark", "orchard", "forest-floor")


def scatter(v, x0, y0, x1, y1, density=0.02, seed=0, kinds=("tuft", "tuft", "tuft", "flower", "pebble")):
    """Ground scatter on free ground cells: grass tufts (1–2 voxels), flowers and pebbles."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            g = v.get(x, y, 0)
            if g is None or g[0] not in GROUND_ROLES or v.has(x, y, 1):
                continue
            if hash3(x, y, 91, seed) >= density:
                continue
            k = kinds[int(hash3(y, x, 92, seed) * len(kinds))]
            if k == "tuft":
                base = GRASS_B if g[0] != "grass-b" else GRASS_A
                v.set(x, y, 1, shade_of(base, 1.08))
                if hash3(x, y, 93, seed) < 0.4:
                    v.set(x, y, 2, shade_of(base, 1.16))
            elif k == "flower":
                v.set(x, y, 1, shade_of(GRASS_A, 1.05))
                v.set(x, y, 2, FLOWER if hash3(x, y, 94, seed) < 0.6 else mat("canvas", 1.05))
            else:
                v.set(x, y, 1, STONE if hash3(x, y, 95, seed) < 0.5 else STONE_LIGHT)


def edging(v, cells, m=STONE_DARK, z=0):
    """Kerb or border cells (x, y) at the ground level."""
    for x, y in cells:
        v.set(x, y, z, m)


# ---------------------------------------------------------------- walls


def plinth(v, x0, y0, x1, y1, z=1, m=STONE_DARK, out=1, h=1):
    """A proud stone base course `out` voxels wider than the walls (ring, h layers)."""
    for zz in range(z, z + h):
        v.walls(x0 - out, y0 - out, x1 + out, y1 + out, zz, zz + 1, m)
        if out:
            v.walls(x0, y0, x1, y1, zz, zz + 1, m)


def fill(v, x0, y0, x1, y1, z0, z1, m):
    """A solid core (hidden): keeps the inner faces of walls out of the mesh."""
    v.box(x0, y0, z0, x1, y1, z1, m)


def coursed_stone(v, x0, y0, x1, y1, z0, z1, m=STONE, seed=0, proud=0.05, core=True):
    """
    Layered stone walls: courses one voxel high of stones 2–4 voxels long in
    three shades, the joints staggered course by course; a few stones stand
    one voxel proud. The core is filled solid unless core=False.
    """
    if core:
        fill(v, x0, y0, x1, y1, z0, z1, m)
    else:
        v.walls(x0, y0, x1, y1, z0, z1, m)
    for side, f in _p.faces_of(v, x0, y0, x1, y1).items():
        a0, a1 = _p.span(side, x0, y0, x1, y1)
        sk = {"y+": 1, "y-": 2, "x+": 3, "x-": 4}[side]
        for z in range(z0, z1):
            a = a0 - int(hash3(z, sk, 1, seed) * 3)
            while a < a1:
                n = 2 + int(hash3(a, z, sk, seed + 2) * 3)
                h = hash3(a, z, sk, seed + 3)
                s = 0.9 if h < 0.3 else (1.06 if h < 0.55 else 1.0)
                c = shade_of(m, s)
                out = 1 if hash3(a, z, sk, seed + 4) < proud and a > a0 and a + n < a1 - 1 else 0
                for i in range(max(a, a0), min(a + n, a1)):
                    f.put(i, z, c)
                    if out:
                        f.put(i, z, c, out=1)
                a += n


def dressed_quoins(v, x0, y0, x1, y1, z0, z1, m=DRESSED):
    """Corner stones in alternating long/short courses of two voxels, in a paler dressed stone."""
    for z in range(z0, z1):
        long = (z // 2) % 2 == 0
        for cx, cy, dx, dy in ((x0, y0, 1, 1), (x1 - 1, y0, -1, 1), (x0, y1 - 1, 1, -1), (x1 - 1, y1 - 1, -1, -1)):
            c = shade_of(m, 1.0 if (z // 2) % 2 else 0.95)
            v.set(cx, cy, z, c)
            for k in range(1, 3 if long else 2):
                v.set(cx + dx * k, cy, z, c)
            for k in range(1, 2 if long else 3):
                v.set(cx, cy + dy * k, z, c)


def half_timber(v, x0, y0, x1, y1, z0, z1, infill, frame=TIMBER, spacing=4, braces=True, rail=None, pegs=True, head=True, core=True, sill=True):
    """
    Half-timbered walls: infill panels between posts every `spacing` voxels
    (corners included), a sill beam at z0 (sill=False: none, e.g. on a
    jetty course), a head beam at z1 − 1, an
    optional mid rail at height `rail`, diagonal braces in the corner
    panels (braces: True, False or the sides that get them) and pale pegs where the timbers meet. The core is filled solid.
    """
    if core:
        fill(v, x0, y0, x1, y1, z0, z1, infill)
    else:
        v.walls(x0, y0, x1, y1, z0, z1, infill)
    for side, f in _p.faces_of(v, x0, y0, x1, y1).items():
        a0, a1 = _p.span(side, x0, y0, x1, y1)
        posts = list(range(a0, a1 - 1, spacing)) + [a1 - 1]
        for a in posts:
            for z in range(z0, z1):
                f.put(a, z, frame)
        beams = ([z0] if sill else []) + ([z1 - 1] if head else []) + ([rail] if rail else [])
        for z in beams:
            for a in range(a0, a1):
                f.put(a, z, frame)
        if braces and (braces is True or side in braces) and z1 - z0 >= 5:
            lo = (rail if rail else z0) + 1
            hi = z1 - 1 if head else z1
            h = min(spacing - 1, hi - lo)
            for k in range(h):
                f.put(a0 + 1 + k, lo + k, frame)
                f.put(a1 - 2 - k, lo + k, frame)
        if pegs:
            for a in posts:
                for z in beams:
                    if a not in (a0, a1 - 1):
                        f.put(a, z, PEG)


def boarded(v, x0, y0, x1, y1, z0, z1, m=TIMBER_LIGHT, batten=TIMBER, every=3, core=True):
    """Barn walls of vertical boards in two shades with a darker batten every `every` voxels, a corner post and a sill; core solid."""
    if core:
        fill(v, x0, y0, x1, y1, z0, z1, m)
    else:
        v.walls(x0, y0, x1, y1, z0, z1, m)
    for side, f in _p.faces_of(v, x0, y0, x1, y1).items():
        a0, a1 = _p.span(side, x0, y0, x1, y1)
        for a in range(a0, a1):
            c = batten if a in (a0, a1 - 1) or (a - a0) % every == 0 else shade_of(m, 1.0 if a % 2 == 0 else 0.9)
            for z in range(z0, z1):
                f.put(a, z, c)
        for a in range(a0, a1):
            f.put(a, z0, batten)


def jetty_course(v, x0, y0, x1, y1, z, m=TIMBER_DARK, end=TIMBER_LIGHT):
    """The jetty of an upper storey: a ring of joist ends (pale end grain every other voxel) one voxel out."""
    for x in range(x0 - 1, x1 + 1):
        for y in (y0 - 1, y1):
            v.set(x, y, z, end if x % 2 == 0 else m)
    for y in range(y0 - 1, y1 + 1):
        for x in (x0 - 1, x1):
            v.set(x, y, z, end if y % 2 == 0 else m)


def log_walls(v, x0, y0, x1, y1, z0, z1, m=TIMBER, end=PLANK, core=True):
    """
    Log-cabin walls: one log per course in alternating shades, every log
    round-ended (a darker underside voxel line every other course), the
    logs of alternate courses running one voxel past the corners with pale
    end grain (notched corners). The core is filled solid.
    """
    if core:
        fill(v, x0, y0, x1, y1, z0, z1, m)
    else:
        v.walls(x0, y0, x1, y1, z0, z1, m)
    for z in range(z0, z1):
        c = shade_of(m, 1.0 if z % 2 == 0 else 1.18)
        v.walls(x0, y0, x1, y1, z, z + 1, c)
        if z % 2 == 0:
            for x in (x0 - 1, x1):
                v.set(x, y0, z, end)
                v.set(x, y1 - 1, z, end)
        else:
            for y in (y0 - 1, y1):
                v.set(x0, y, z, end)
                v.set(x1 - 1, y, z, end)


# ---------------------------------------------------------------- openings


def casement(f, a, z, w=2, h=3, frame=TIMBER_LIGHT, glass=WINDOW, shutters=None, sill=None, lintel=None, bars=True, box=None):
    """
    A framed window: glass one voxel back with glazing bars (a transom
    when h ≥ 3, a mullion when w ≥ 3), the frame round it in the wall
    plane (frame=None: none — the studs of a timber frame or the wall
    itself frame it), a sill one voxel proud below (`sill`, default the
    frame), an
    optional lintel one voxel proud above, open shutters one voxel proud
    either side (plank shades) and an optional flower box under the sill.
    """
    for i in range(-1, w + 1):
        for j in range(-1, h + 1):
            if 0 <= i < w and 0 <= j < h:
                f.put(a + i, z + j, None)
                f.put(a + i, z + j, glass, out=-1)
            elif frame is not None:
                f.put(a + i, z + j, frame)
    frame = frame or TIMBER_LIGHT
    if bars:
        if h >= 3:
            for i in range(w):
                f.put(a + i, z + h // 2, frame, out=-1)
        if w >= 3:
            for j in range(h):
                f.put(a + w // 2, z + j, frame, out=-1)
    s = sill or frame
    for i in range(-1, w + 1):
        f.put(a + i, z - 1, s, out=1)
    if lintel is not None:
        for i in range(-1, w + 1):
            f.put(a + i, z + h, lintel, out=1)
    if shutters is not None:
        for j in range(h):
            c = shade_of(shutters, 1.0 if j % 2 == 0 else 0.88)
            f.put(a - 2, z + j, c, out=1)
            f.put(a + w + 1, z + j, c, out=1)
    if box is not None:
        for i in range(w):
            f.put(a + i, z - 2, TIMBER, out=1)
            f.put(a + i, z - 1, box if i % 2 == 0 else shade_of(GRASS_A, 1.05), out=2)


def entrance(f, a, z, w=3, h=5, leaf=TIMBER, frame=TIMBER_DARK, step=STONE_DARK, lintel=None, arch=False, hinges=True, knob=BRASS, steps=1):
    """
    A door: plank leaf one voxel back (alternate plank shades), iron strap
    hinges, a knob, a frame round it, an optional lintel one voxel proud,
    a stone step one voxel proud below the threshold (from the ground up
    to z) and `steps` − 1 more in front of it.
    """
    for i in range(-1, w + 1):
        for j in range(0, h + 1):
            inside = 0 <= i < w and j < h
            if arch and j == h - 1 and i in (0, w - 1):
                inside = False
            if inside:
                f.put(a + i, z + j, None)
                f.put(a + i, z + j, shade_of(leaf, 1.0 if i % 2 == 0 else 0.86), out=-1)
            else:
                f.put(a + i, z + j, frame)
    if hinges and h >= 4:
        for j in (1, h - 2):
            for i in range(0, max(1, w - 1)):
                f.put(a + i, z + j, IRON, out=-1)
    f.put(a + w - 1, z + h // 2, knob, out=-1)
    if lintel is not None:
        for i in range(-2, w + 2):
            f.put(a + i, z + h + 1, lintel, out=1)
    if step is not None:
        for zz in range(0, max(1, z)):
            for i in range(-1, w + 1):
                f.put(a + i, zz, step, out=1)
        for k in range(1, steps):
            for zz in range(0, max(1, z - k)):
                for i in range(-1, w + 1):
                    f.put(a + i, zz, shade_of(step, 1.05), out=1 + k)


def barn_gate(f, a, z, w=6, h=6, leaf=TIMBER, frame=TIMBER_DARK):
    """A wide two-leaf gate: plank leaves with strap hinges, the meeting stiles dark, a diagonal brace per leaf, no step."""
    entrance(f, a, z, w, h, leaf, frame, step=None, knob=IRON)
    half = w // 2
    for k in range(half):
        j = min(h - 1, (k * (h - 1)) // max(1, half - 1))
        f.put(a + k, z + j, TIMBER_DARK, out=-1)
        f.put(a + w - 1 - k, z + j, TIMBER_DARK, out=-1)
    if w >= 4:
        for j in range(h):
            f.put(a + half - 1, z + j, TIMBER_DARK, out=-1)


def trade_sign(f, a, z, colour, bracket=IRON, board=PLANK):
    """A hanging sign on an iron bracket out from a facade: a board with the good's colour, so the trade reads at mid zoom."""
    for k in range(1, 4):
        f.put(a, z + 3, bracket, out=k)
    for j in range(3):
        f.put(a, z + j, board, out=2)
        f.put(a, z + j, board, out=3)
    f.put(a, z + 1, colour, out=2)
    f.put(a, z + 1, colour, out=3)
    f.put(a, z + 2, colour, out=3)


# ---------------------------------------------------------------- roofs

#: Roof kinds: (material, rise per course, ridge material).
ROOFS = {
    "thatch": (THATCH, 1.5, THATCH_DARK),
    "tiles": (TERRACOTTA, 1.0, TERRACOTTA_DARK),
    "slate": (SLATE, 1.25, mat("slate", 0.8)),
}


def roof_kind(m):
    """The roof kind of a material (by palette role)."""
    return {"thatch": "thatch", "terracotta": "tiles", "slate": "slate"}.get(m[0], "tiles")


class Roof:
    """What roof() built: ridge height, the eave lines and the slope's height at a cell."""

    def __init__(self, x0, x1, y0, y1, z, rise, ov, along, hip, top, ridge_z):
        self.x0, self.x1, self.y0, self.y1 = x0, x1, y0, y1
        self.z, self.rise, self.ov, self.along, self.hip = z, rise, ov, along, hip
        self.top = top  # first free layer above the ridge (cap/roll included)
        self.ridge_z = ridge_z  # the ridge course's layer

    def course(self, x, y):
        """Course index (0 at the eaves) of the roof cell above (x, y)."""
        if self.along == "x" or self.hip:
            ky = min(y - (self.y0 - self.ov), (self.y1 + self.ov - 1) - y)
        if self.along == "y" or self.hip:
            kx = min(x - (self.x0 - self.ov), (self.x1 + self.ov - 1) - x)
        if self.hip:
            return min(kx, ky)
        return ky if self.along == "x" else kx

    def surface(self, x, y):
        """The top layer of the roof above (x, y) (z of the outermost roof voxel)."""
        k = self.course(x, y)
        return min(self.ridge_z, self.z + int((k + 1) * self.rise + 1e-9) - 1)


def roof(v, x0, x1, y0, y1, z, kind="thatch", along="x", rise=None, ov=1, gable=None, seed=0, hip=False, m=None, ridge=None, eaves=True, solid=True, cap=True):
    """
    A roof of courses over x0..x1 × y0..y1 from height z (D-057 §3):
    alternating course shades, eaves with a dark fascia (tiles, slate) or a
    ragged thatch fringe, verges a shade darker, and a raised ridge of
    ridge tiles in alternate shades (tiles, slate) or a thatch roll with
    liggers (cap=False: none). Gable ends (`gable` material, three voxels thick so the lite
    keeps them) close the attic, which is filled solid. Returns a Roof.
    """
    base, r0, rm = ROOFS[kind]
    m = m or base
    rise = rise or r0
    ridge = ridge or rm
    swap = along == "y" and not hip
    a0, a1, b0, b1 = (y0, y1, x0, x1) if swap else (x0, x1, y0, y1)

    def put(a, b, zz, c):
        if swap:
            v.set(b, a, zz, c)
        else:
            v.set(a, b, zz, c)

    lo0, hi0 = b0 - ov, b1 + ov - 1
    k = 0
    ridge_z = z
    while True:
        lo, hi = lo0 + k, hi0 - k
        if hip:
            alo, ahi = a0 - ov + k, a1 + ov - 1 - k
        else:
            alo, ahi = a0 - ov, a1 + ov - 1
        if lo > hi or alo > ahi:
            break
        zl = z + int(k * rise + 1e-9)
        zh = max(zl, z + int((k + 1) * rise + 1e-9) - 1)
        last = hi - lo <= 1 or (hip and ahi - alo <= 1)
        shade = 1.0 if k % 2 == 0 else (0.95 if kind == "thatch" else 0.92)
        for zz in range(zl, zh + 1):
            for a in range(alo, ahi + 1):
                verge = not hip and (a < a0 or a >= a1)
                for b in range(lo, hi + 1):
                    edge = b in (lo, hi) or (hip and a in (alo, ahi))
                    if last or edge:
                        c = ridge if last else shade_of(m, shade * (0.9 if verge or (hip and a in (alo, ahi) and b not in (lo, hi)) else 1.0))
                        put(a, b, zz, c)
                    elif not verge and solid:
                        end = not hip and (a < a0 + 3 or a >= a1 - 3)
                        put(a, b, zz, (gable or m) if end else m)
        ridge_z = zh
        if last:
            break
        k += 1
    top = ridge_z + 1
    # Eaves: a dark fascia under tiles and slate, a ragged fringe under thatch.
    if eaves and ov > 0:
        for a in range(a0 - ov, a1 + ov):
            for b in (lo0, hi0):
                if kind == "thatch":
                    if hash3(a, b, z, seed + 31) < 0.5:
                        put(a, b, z - 1, THATCH_DARK)
                else:
                    put(a, b, z - 1, TIMBER_DARK)
        if hip:
            for b in range(b0 - ov, b1 + ov):
                for a in (a0 - ov, a1 + ov - 1):
                    if kind == "thatch":
                        if hash3(a, b, z, seed + 32) < 0.5:
                            put(a, b, z - 1, THATCH_DARK)
                    else:
                        put(a, b, z - 1, TIMBER_DARK)
    # Ridge: a course of ridge tiles (alternate shades) or a thatch roll with liggers.
    if not cap:
        return Roof(x0, x1, y0, y1, z, rise, ov, along, hip, ridge_z + 1, ridge_z)
    lo, hi = lo0 + k, hi0 - k
    alo, ahi = (a0 - ov + k, a1 + ov - 1 - k) if hip else (a0 - ov, a1 + ov - 1)
    for a in range(alo, ahi + 1):
        for b in range(lo, hi + 1):
            if kind == "thatch":
                put(a, b, top, THATCH_LIGHT if a % 4 == 0 else ridge)
            else:
                put(a, b, top, shade_of(ridge, 0.94 if a % 2 == 0 else 1.04))
    top += 1
    x0r, x1r, y0r, y1r = x0, x1, y0, y1
    return Roof(x0r, x1r, y0r, y1r, z, rise, ov, along, hip, top, ridge_z)


def lean_to(v, x0, x1, y0, y1, z, kind="thatch", down="y+", ov=1, m=None, posts=True, seed=0):
    """
    A lean-to roof sloping down toward `down` (its eave side; z is the eave
    height) with a fascia or thatch fringe under the eave, and optional
    corner posts from the ground (open sheds).
    """
    base, _, _ = ROOFS[kind]
    m = m or base
    # Vox.shed's `down` names the high side (prototype naming): pass the opposite.
    sd = {"y+": "y-", "y-": "y+", "x+": "x-", "x-": "x+"}[down]
    v.shed(x0, x1, y0, y1, z, m, down=sd, ov=ov)
    if down in ("y+", "y-"):
        ye = y1 + ov - 1 if down == "y+" else y0 - ov
        for x in range(x0 - ov, x1 + ov):
            if kind == "thatch":
                if hash3(x, ye, z, seed + 5) < 0.5:
                    v.set(x, ye, z - 1, THATCH_DARK)
            else:
                v.set(x, ye, z - 1, TIMBER_DARK)
    else:
        xe = x1 + ov - 1 if down == "x+" else x0 - ov
        for y in range(y0 - ov, y1 + ov):
            if kind == "thatch":
                if hash3(xe, y, z, seed + 5) < 0.5:
                    v.set(xe, y, z - 1, THATCH_DARK)
            else:
                v.set(xe, y, z - 1, TIMBER_DARK)
    if posts:
        low = z - 1
        for px, py in ((x0, y0), (x1 - 1, y0), (x0, y1 - 1), (x1 - 1, y1 - 1)):
            hz = _shed_z(x0, x1, y0, y1, z, sd, ov, px, py)
            v.box(px, py, 1, px + 1, py + 1, max(low, hz), TIMBER)


def _shed_z(x0, x1, y0, y1, z, down, ov, x, y):
    """Height of the shed roof layer over (x, y) (as Vox.shed lays it)."""
    if down in ("y+", "y-"):
        n = y1 - y0 + 2 * ov
        i = (y - (y0 - ov)) if down == "y-" else (y1 + ov - 1 - y)
    else:
        n = x1 - x0 + 2 * ov
        i = (x - (x0 - ov)) if down == "x-" else (x1 + ov - 1 - x)
    return z + (n - 1 - i) // 2


def chimney_stack(v, x, y, z0, z1, m=STONE, brick=False, pots=1, cap=STONE_DARK, anchor=False):
    """
    A 2 × 2 chimney stack z0..z1 in courses (stone in two shades, or brick
    with staggered joints), a corbelled cap course one voxel wider, and
    none, one or two terracotta pots on top. anchor=True also sets the chimney and
    smoke anchors (producers with content `smoke`). Returns the smoke point.
    """
    for zz in range(z0, z1):
        for dx in range(2):
            for dy in range(2):
                if brick:
                    c = BRICK if (dx + dy + zz) % 2 == 0 else shade_of(BRICK, 0.9)
                else:
                    c = m if ((zz // 2) + dx + dy) % 2 == 0 else shade_of(m, 0.92)
                v.set(x + dx, y + dy, zz, c)
    v.box(x - 1, y - 1, z1, x + 3, y + 3, z1 + 1, cap)
    v.box(x, y, z1 + 1, x + 2, y + 2, z1 + 2, shade_of(cap, 0.92))
    pot = mat("terracotta", 0.95)
    sx, sy, sz = x + 0.5, y + 1.5, z1 + 4.0
    if pots == 0:
        sx, sy, sz = x + 1.0, y + 1.0, z1 + 2.0
    else:
        v.set(x, y + 1, z1 + 2, pot)
        v.set(x, y + 1, z1 + 3, shade_of(pot, 0.85))
    if pots >= 2:
        v.set(x + 1, y, z1 + 2, pot)
        sx, sy = x + 1.0, y + 1.0
    if anchor:
        v.anchor("chimney", sx, sy, sz - 1)
        v.anchor("smoke", sx, sy, sz)
    return (sx, sy, sz)


def roof_chimney(v, r, x, y, above=3, z0=1, anchor=False, **kw):
    """A chimney stack from z0 that stands `above` layers over the roof surface at (x, y) of Roof r."""
    s = max(r.surface(x, y), r.surface(x + 1, y), r.surface(x, y + 1), r.surface(x + 1, y + 1))
    return chimney_stack(v, x, y, z0, s + above, anchor=anchor, **kw)


def dormer_on(v, r, x0, x1, side="y+", wall=PLASTER, kind="tiles", frame=TIMBER_LIGHT, course=2, h=4):
    """
    A dormer on the front (y+) or back (y−) slope of an along-x Roof r: a
    front wall `course` courses up the slope with a framed window, cheeks
    back into the roof and its own little gable roof (no ridge cap).
    """
    hi0 = r.y1 + r.ov - 1
    lo0 = r.y0 - r.ov
    yf = hi0 - course if side == "y+" else lo0 + course
    zb = r.z + int(course * r.rise + 1e-9)
    depth = h + 1
    ys = (yf - depth + 1, yf + 1) if side == "y+" else (yf, yf + depth)
    v.box(x0, ys[0], zb, x1, ys[1], zb + h, wall)
    f = Face(v, side, ys[1] - 1 if side == "y+" else ys[0])
    casement(f, x0 + 1, zb + 1, x1 - x0 - 2, h - 2, frame, sill=frame, bars=False)
    roof(v, x0, x1, ys[0], ys[1], zb + h, kind, along="y", ov=1, gable=wall, eaves=False, cap=False)


# ---------------------------------------------------------------- fences


def _post_height(x, y, seed, lo=2, hi=3):
    return lo + int(hash3(x, y, 77, seed) * (hi - lo + 1))


def fence_cells(v, cells, z=1, kind="rail", every=4, seed=0, post=TIMBER, rail=TIMBER_LIGHT):
    """
    Fence along an ordered list of ground cells: uneven posts (2–3 voxels,
    hashed) every `every` cells and at the ends; rails between them (two
    rails on 3-high runs) — or pickets of uneven height (kind "picket") or
    a woven wattle hurdle (kind "wattle").
    """
    n = len(cells)
    for i, (x, y) in enumerate(cells):
        is_post = i % every == 0 or i == n - 1
        if kind == "picket":
            h = 2 + (1 if is_post or hash3(x, y, 78, seed) < 0.25 else 0)
            c = post if is_post else shade_of(rail, 1.0 if hash3(x, y, 79, seed) < 0.6 else 0.88)
            v.box(x, y, z, x + 1, y + 1, z + h, c)
        elif kind == "wattle":
            if is_post:
                v.box(x, y, z, x + 1, y + 1, z + 3, post)
            else:
                v.box(x, y, z, x + 1, y + 1, z + 2, shade_of(THATCH, 0.8 if (i + x + y) % 2 else 0.7))
        else:
            if is_post:
                v.box(x, y, z, x + 1, y + 1, z + _post_height(x, y, seed), post)
            else:
                v.set(x, y, z + 1, rail)


def ring_cells(x0, y0, x1, y1, gaps=()):
    """The cells round a rectangle, in order (gaps left out)."""
    ring = [(x, y0) for x in range(x0, x1)] + [(x1 - 1, y) for y in range(y0 + 1, y1)] + [(x, y1 - 1) for x in range(x1 - 2, x0 - 1, -1)] + [(x0, y) for y in range(y1 - 2, y0, -1)]
    return [c for c in ring if c not in set(gaps)]


def fence_ring(v, x0, y0, x1, y1, z=1, kind="rail", gaps=(), every=4, seed=0, **kw):
    """A fence round x0..x1 × y0..y1 (gaps open; posts either side of a gap)."""
    gaps = set(gaps)
    ring = [(x, y0) for x in range(x0, x1)] + [(x1 - 1, y) for y in range(y0 + 1, y1)] + [(x, y1 - 1) for x in range(x1 - 2, x0 - 1, -1)] + [(x0, y) for y in range(y1 - 2, y0, -1)]
    run = []
    for c in ring + [None]:
        if c is None or c in gaps:
            if run:
                fence_cells(v, run, z, kind, every, seed, **kw)
            run = []
        else:
            run.append(c)


def fence_line_v2(v, x0, y0, x1, y1, z=1, kind="rail", every=4, seed=0, **kw):
    """A straight fence from (x0, y0) to (x1, y1) inclusive (one axis)."""
    if x0 == x1:
        cells = [(x0, y) for y in (range(y0, y1 + 1) if y1 >= y0 else range(y0, y1 - 1, -1))]
    else:
        cells = [(x, y0) for x in (range(x0, x1 + 1) if x1 >= x0 else range(x0, x1 - 1, -1))]
    fence_cells(v, cells, z, kind, every, seed, **kw)


# ---------------------------------------------------------------- crops and plants


def soil_rows(v, x0, y0, x1, y1, along="y", pitch=2, z=0, soil=DIRT, furrow=1):
    """Ploughed soil: ridges and darker furrows (the last `furrow` voxels of every `pitch`) across the rows."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            i = (x - x0) if along == "y" else (y - y0)
            v.set(x, y, z, shade_of(soil, 0.78 if i % pitch >= pitch - furrow else 0.92))


def plant(v, x, y, z, kind, seed=0):
    """One plant on the ground cell (x, y) standing from z: wheat, hemp, flax, meadow, cabbage, grass."""
    h = hash3(x, y, 61, seed)
    if kind == "wheat":
        n = 2 + (1 if h < 0.6 else 0)
        for k in range(n - 1):
            v.set(x, y, z + k, WHEAT if k else shade_of(WHEAT, 0.86))
        v.set(x, y, z + n - 1, WHEAT_MARK if h < 0.8 else shade_of(WHEAT, 1.08))
    elif kind == "hemp":
        n = 4 + (1 if h < 0.5 else 0)
        for k in range(n):
            v.set(x, y, z + k, HEMP if k < n - 1 else HEMP_MARK)
    elif kind == "meadow":
        v.set(x, y, z, shade_of(GRASS_A, 1.05))
        if h < 0.35:
            v.set(x, y, z + 1, FLOWER if h < 0.2 else mat("canvas", 1.05) if h < 0.27 else mat("dye-blue", 1.3))
    elif kind == "cabbage":
        v.set(x, y, z, shade_of(HEMP, 1.2))
    else:
        v.set(x, y, z, shade_of(GRASS_B, 1.06))
        if h < 0.4:
            v.set(x, y, z + 1, shade_of(GRASS_B, 1.14))


def crop_rows(v, x0, y0, x1, y1, kind="wheat", along="y", pitch=2, z=0, seed=0, gap=0.0, furrow=1):
    """
    A crop bed: ploughed soil rows (`pitch` voxels apart, the last
    `furrow` voxels a furrow) with a plant of `kind` on every ridge cell
    (a hashed share `gap` left bare) — crops read as rows of plants
    (D-057 §3).
    """
    soil_rows(v, x0, y0, x1, y1, along, pitch, z, furrow=furrow)
    for x in range(x0, x1):
        for y in range(y0, y1):
            i = (x - x0) if along == "y" else (y - y0)
            if i % pitch >= pitch - furrow:
                continue
            if gap and hash3(x, y, 62, seed) < gap:
                continue
            plant(v, x, y, z + 1, kind, seed)


def shrub(v, x, y, z, r=2, m=CROWN, seed=0, berries=None):
    """An irregular shrub: a hashed, ragged blob in three shades (optional berry/flower dots)."""
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            for dz in range(0, r + 1):
                d = dx * dx + dy * dy + (dz * 1.3) ** 2
                h = hash3(x + dx, y + dy, z + dz, seed)
                if d <= r * r + 0.6 - h * 1.6:
                    c = shade_of(m, 1.1 if dz >= r - 1 and h < 0.5 else (0.92 if h > 0.8 else 1.0))
                    if berries is not None and h < 0.1:
                        c = berries
                    v.set(x + dx, y + dy, z + dz, c)


def fruit_tree(v, x, y, z, seed=0, fruit=None, crown=None, trunk=4, r=3.2):
    """A small tree with an irregular crown (ragged edge, three shades) and fruit dots."""
    v.box(x, y, z, x + 1, y + 1, z + trunk, TIMBER)
    v.set(x + 1, y, z + trunk - 1, TIMBER)
    cz = z + trunk + 2
    cm = crown or CROWN
    for dx in range(-4, 5):
        for dy in range(-4, 5):
            for dz in range(-3, 4):
                d = (dx / r) ** 2 + (dy / r) ** 2 + (dz / (r * 0.8)) ** 2
                h = hash3(x + dx, y + dy, cz + dz, seed)
                if d <= 1.0 - (h * 0.35 if d > 0.55 else 0):
                    c = shade_of(cm, 1.1 if dz >= 1 and h < 0.55 else (0.9 if dz <= -1 else 1.0))
                    if fruit is not None and d > 0.45 and hash3(dx, dy, dz, seed + 9) < 0.12:
                        c = fruit
                    v.set(x + dx, y + dy, cz + dz, c)


# ---------------------------------------------------------------- props


def woodpile(v, x, y, z, length=6, along="x", rows=3, end=PLANK):
    """Stacked split logs: pale end grain on the faces, bark between, rows getting shorter."""
    for course in range(rows):
        n = length - course
        for i in range(n):
            for d in range(2):
                c = end if d == 0 else shade_of(TIMBER_LIGHT, 0.9 if (i + course) % 2 else 1.0)
                if along == "x":
                    v.set(x + i + course // 2, y + d, z + course, c)
                else:
                    v.set(x + d, y + i + course // 2, z + course, c)


def log_stack(v, x, y, z, length=8, along="x", n=3):
    """Round logs with pale ends: n at the bottom, a pyramid on top."""
    for course in range(n):
        for i in range(n - course):
            for k in range(length):
                c = PLANK if k in (0, length - 1) else shade_of(TIMBER, 1.0 if (i + course) % 2 == 0 else 0.86)
                if along == "x":
                    v.set(x + k, y + i * 2 + course, z + course, c)
                    v.set(x + k, y + i * 2 + course + 1, z + course, c if k in (0, length - 1) else shade_of(c, 0.95))
                else:
                    v.set(x + i * 2 + course, y + k, z + course, c)
                    v.set(x + i * 2 + course + 1, y + k, z + course, c if k in (0, length - 1) else shade_of(c, 0.95))


def cask(v, x, y, z, h=3, m=TIMBER_LIGHT, lid=None):
    """A 2 × 2 barrel with iron hoops (one when h < 5) and a lid (or contents) on top."""
    v.box(x, y, z, x + 2, y + 2, z + h, m)
    for zz in ((z + 1, z + h - 2) if h >= 5 else (z + h // 2,)):
        v.box(x, y, zz, x + 2, y + 2, zz + 1, IRON)
    v.set(x, y, z + h - 1, shade_of(m, 0.9))
    if lid is not None:
        v.box(x, y, z + h, x + 2, y + 2, z + h + 1, lid)


def box_crate(v, x, y, z, s=2, m=TIMBER_LIGHT, contents=None):
    """A crate with a dark frame edge; open crates show their contents on top."""
    v.box(x, y, z, x + s, y + s, z + s, m)
    for dx, dy in ((0, 0), (s - 1, 0), (0, s - 1), (s - 1, s - 1)):
        v.set(x + dx, y + dy, z, TIMBER)
    if contents is not None:
        v.box(x, y, z + s - 1, x + s, y + s, z + s, contents)
    else:
        v.box(x, y, z + s - 1, x + s, y + s, z + s, shade_of(m, 1.08))


def sacks(v, x, y, z, n=3, m=CANVAS, along="x", tie=TIMBER_LIGHT):
    """A row of filled sacks (2 × 2 × 2 with a tied top), the next one leaning on it."""
    for i in range(n):
        sx, sy = (x + i * 2, y) if along == "x" else (x, y + i * 2)
        c = shade_of(m, 1.0 if i % 2 == 0 else 0.92)
        v.box(sx, sy, z, sx + 2, sy + 2, z + 2, c)
        v.set(sx, sy, z + 2, tie)


def bale(v, x, y, z, w=3, d=2, h=2, m=THATCH):
    """A bound bale (hay, wool, hemp): two shades with a darker band."""
    v.box(x, y, z, x + w, y + d, z + h, m)
    v.box(x, y, z + h - 1, x + w, y + d, z + h, shade_of(m, 1.1))
    for k in range(d):
        v.set(x + w // 2, y + k, z + h - 1, shade_of(m, 0.75))


def handcart(v, x, y, z=1, along="x", load=None):
    """A two-wheeled hand cart: bed, sides, wheels, shafts on the ground; optional load."""
    if along == "x":
        v.box(x, y, z + 1, x + 4, y + 3, z + 2, PLANK)
        for xx in range(x, x + 4):
            v.set(xx, y, z + 2, TIMBER)
            v.set(xx, y + 2, z + 2, TIMBER)
        for yy in (y - 1, y + 3):
            v.box(x + 1, yy, z, x + 3, yy + 1, z + 2, TIMBER_DARK)
        v.set(x + 4, y, z, TIMBER)
        v.set(x + 5, y, z, TIMBER)
        v.set(x + 4, y + 2, z, TIMBER)
        v.set(x + 5, y + 2, z, TIMBER)
        if load is not None:
            v.box(x, y + 1, z + 2, x + 4, y + 2, z + 3, load)
    else:
        v.box(x, y, z + 1, x + 3, y + 4, z + 2, PLANK)
        for yy in range(y, y + 4):
            v.set(x, yy, z + 2, TIMBER)
            v.set(x + 2, yy, z + 2, TIMBER)
        for xx in (x - 1, x + 3):
            v.box(xx, y + 1, z, xx + 1, y + 3, z + 2, TIMBER_DARK)
        v.set(x, y + 4, z, TIMBER)
        v.set(x, y + 5, z, TIMBER)
        v.set(x + 2, y + 4, z, TIMBER)
        v.set(x + 2, y + 5, z, TIMBER)
        if load is not None:
            v.box(x + 1, y, z + 2, x + 2, y + 4, z + 3, load)


def trough(v, x, y, z=1, length=5, along="x", water=True):
    """A plank water trough."""
    if along == "x":
        v.box(x, y, z, x + length, y + 2, z + 2, TIMBER)
        if water:
            v.box(x + 1, y, z + 1, x + length - 1, y + 2, z + 2, None)
            v.box(x + 1, y, z + 1, x + length - 1, y + 2, z + 2, mat("shallows"))
    else:
        v.box(x, y, z, x + 2, y + length, z + 2, TIMBER)
        if water:
            v.box(x, y + 1, z + 1, x + 2, y + length - 1, z + 2, mat("shallows"))


def bench(v, x, y, z=1, length=4, along="x"):
    """A plank bench on two legs."""
    if along == "x":
        v.box(x, y, z + 1, x + length, y + 1, z + 2, PLANK)
        v.set(x, y, z, TIMBER)
        v.set(x + length - 1, y, z, TIMBER)
    else:
        v.box(x, y, z + 1, x + 1, y + length, z + 2, PLANK)
        v.set(x, y, z, TIMBER)
        v.set(x, y + length - 1, z, TIMBER)


def chopping_block(v, x, y, z=1):
    """A stump with an axe stuck in it and a few split pieces."""
    v.box(x, y, z, x + 2, y + 2, z + 2, TIMBER)
    v.box(x, y, z + 1, x + 2, y + 2, z + 2, PLANK)
    v.set(x + 1, y, z + 2, IRON)
    v.set(x + 1, y, z + 3, TIMBER_LIGHT)
    v.set(x + 2, y + 2, z, PLANK)
    v.set(x - 1, y + 1, z, PLANK)


def well(v, cx, cy, z=1, roof_m=None):
    """A round stone well with a winch frame, a bucket and a little roof."""
    for x in range(cx - 2, cx + 3):
        for y in range(cy - 2, cy + 3):
            if abs(x - cx) == 2 or abs(y - cy) == 2:
                if abs(x - cx) + abs(y - cy) < 4:
                    v.box(x, y, z, x + 1, y + 1, z + 2, shade_of(STONE, 0.95 if (x + y) % 2 else 1.04))
            elif abs(x - cx) <= 1 and abs(y - cy) <= 1:
                v.set(x, y, z, mat("deep"))
    for px in (cx - 2, cx + 2):
        v.box(px, cy, z + 2, px + 1, cy + 1, z + 7, TIMBER)
    v.box(cx - 1, cy, z + 5, cx + 2, cy + 1, z + 6, TIMBER_LIGHT)
    v.set(cx, cy, z + 3, IRON)
    v.set(cx, cy, z + 4, TIMBER_DARK)
    rm = roof_m or TERRACOTTA
    v.box(cx - 3, cy - 1, z + 7, cx + 4, cy + 2, z + 8, rm)
    v.box(cx - 3, cy, z + 8, cx + 4, cy + 1, z + 9, shade_of(rm, 0.86))


def washing_line(v, x0, x1, y, z, cloths, posts=TIMBER, every=4, sway=True):
    """Two posts and a line with hanging cloths (materials cycled); cloth sways when its material has a sway group."""
    v.box(x0, y, 1, x0 + 1, y + 1, z + 1, posts)
    v.box(x1, y, 1, x1 + 1, y + 1, z + 1, posts)
    for x in range(x0 + 1, x1):
        v.set(x, y, z, TIMBER_LIGHT)
    k = 0
    for x in range(x0 + 2, x1 - 1, every):
        c = cloths[k % len(cloths)]
        k += 1
        for xx in range(x, min(x + every - 1, x1 - 1)):
            for zz in range(z - 3 + (xx - x) % 2, z):
                v.set(xx, y, zz, c)


def tool_rack(f, a, z=1, n=3):
    """Tools leaning against a wall: handles in timber, heads in iron."""
    for i in range(n):
        f.put(a + i * 2, z + 3, IRON, out=1)
        for j in range(3):
            f.put(a + i * 2, z + j, TIMBER_LIGHT, out=1)


def ladder(f, a, z0, z1):
    """A ladder against a facade."""
    for zz in range(z0, z1):
        f.put(a, zz, TIMBER_LIGHT, out=1)
        f.put(a + 2, zz, TIMBER_LIGHT, out=1)
        if zz % 2 == 0:
            f.put(a + 1, zz, TIMBER, out=1)


def lamp_post(v, x, y, z=1, h=6):
    """A post lantern: iron post, brass lantern with a dark cap."""
    v.box(x, y, z, x + 1, y + 1, z + h, TIMBER_DARK)
    v.set(x, y, z + h, BRASS)
    v.set(x, y, z + h + 1, IRON)


def flower_bed(v, x0, y0, x1, y1, z=1, seed=0):
    """A bed of flowers and herbs on dark soil."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            v.set(x, y, 0, shade_of(DIRT, 0.8))
            h = hash3(x, y, 66, seed)
            if h < 0.7:
                v.set(x, y, z, shade_of(GRASS_A, 1.0 if h < 0.4 else 1.12))
                if h < 0.25:
                    v.set(x, y, z + 1, FLOWER if h < 0.12 else mat("terracotta", 1.25))


def stump(v, x, y, z=1, h=1, seed=0):
    """A tree stump: bark round a pale cut top (2 × 2), sometimes with a root."""
    v.box(x, y, z, x + 2, y + 2, z + h, TIMBER)
    v.box(x, y, z + h - 1, x + 2, y + 2, z + h, PLANK)
    if hash3(x, y, 71, seed) < 0.5:
        v.set(x + 2, y, z - 1 if z > 1 else z, TIMBER_DARK)


def haystack(v, cx, cy, r=2.5, h=5, m=WHEAT, seed=0):
    """A rounded haystack with a ragged surface and a dark cap."""
    for x in range(int(cx - r - 1), int(cx + r + 2)):
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            for z in range(1, h + 1):
                t = (z - 1) / h
                rr = r * (1 - t * t * 0.85)
                d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
                hh = hash3(x, y, z, seed + 81)
                if d <= rr * rr + 0.4 - hh * 0.9:
                    v.set(x, y, z, shade_of(m, 0.9 + 0.12 * t + (0.05 if hh < 0.3 else 0)))
    v.set(int(cx), int(cy), h + 1, shade_of(THATCH_DARK, 0.9))


def sheaf(v, x, y, z=1, m=WHEAT):
    """A sheaf standing in the stubble: 3 high, a darker tie."""
    v.set(x, y, z, m)
    v.set(x, y, z + 1, shade_of(m, 0.8))
    v.set(x, y, z + 2, shade_of(m, 1.1))


def sawhorse(v, x, y, z=1, along="x", log=True):
    """A sawhorse (two crossed-leg trestles) with a log on it."""
    for k in (0, 3):
        if along == "x":
            v.set(x + k, y, z, TIMBER)
            v.set(x + k, y + 2, z, TIMBER)
            v.set(x + k, y + 1, z + 1, TIMBER)
        else:
            v.set(x, y + k, z, TIMBER)
            v.set(x + 2, y + k, z, TIMBER)
            v.set(x + 1, y + k, z + 1, TIMBER)
    if log:
        if along == "x":
            v.box(x - 1, y + 1, z + 2, x + 5, y + 2, z + 3, TIMBER_LIGHT)
            v.set(x - 1, y + 1, z + 2, PLANK)
        else:
            v.box(x + 1, y - 1, z + 2, x + 2, y + 5, z + 3, TIMBER_LIGHT)
            v.set(x + 1, y - 1, z + 2, PLANK)


def stone_blocks(v, x, y, z=1, n=3, m=STONE, seed=0):
    """Cut stone blocks (3 × 2 × 2) stacked in a little pile, in pale fresh shades."""
    spots = ((0, 0, 0), (3, 0, 0), (0, 2, 0), (1, 1, 2), (3, 2, 0))
    for i in range(min(n, len(spots))):
        dx, dy, dz = spots[i]
        c = shade_of(m, 1.1 if hash3(x + i, y, 51, seed) < 0.5 else 1.0)
        v.box(x + dx, y + dy, z + dz, x + dx + 3, y + dy + 2, z + dz + 2, c)


def cloth(m, sway="cloth"):
    """The material m as cloth (sway group: the client's sway mask, ART_DIRECTION §7)."""
    return mat(m[0], m[1], sway)


# ---------------------------------------------------------------- whole buildings


class Building:
    """What building() built: the blocks of the ground and upper storeys, the wall tops, the roof and its top."""

    def __init__(self, v, ground, upper, z0, mid, wall_top, r):
        self.v = v
        self.ground = ground  # (x0, y0, x1, y1)
        self.upper = upper  # the upper storey's block (== ground without a jetty)
        self.z0 = z0  # floor level (the plinth course)
        self.mid = mid  # floor of the upper storey (None: one storey)
        self.wall_top = wall_top
        self.roof = r
        self.top = r.top

    def face(self, side, upper=False):
        x0, y0, x1, y1 = self.upper if upper else self.ground
        return _p.faces_of(self.v, x0, y0, x1, y1)[side]

    def span(self, side, upper=False):
        x0, y0, x1, y1 = self.upper if upper else self.ground
        return _p.span(side, x0, y0, x1, y1)


#: Tier styles of building(): wall top (one storey), roof kind, wall infill.
STYLES_V2 = {
    "settler": {"wall": 10, "roof": "thatch", "infill": PLASTER},
    "citizen": {"wall": 16, "roof": "tiles", "infill": OCHRE},
    "stone": {"wall": 10, "roof": "tiles", "infill": STONE},
    "stonethatch": {"wall": 9, "roof": "thatch", "infill": STONE},
}


def building(v, x0, y0, x1, y1, style="settler", along="x", wall=None, upper=None, z0=1, height=None, roof=None, kind=None, rise=None, hip=False, seed=0, jetty=True, ov=1, spacing=4, braces=True):
    """
    A whole building block in a tier style (D-057 §3), the core of P.house:
    a proud stone plinth at z0, then
      settler      pegged timber frame with plaster infill, thatch;
      citizen      coursed-stone ground floor with dressed quoins, a jettied
                   (one voxel wider) timber-framed upper storey from z0 + 7,
                   tiles;
      stone        coursed stone with dressed quoins, tiles;
      stonethatch  coursed stone with dressed quoins, thatch;
    and a roof of courses (`roof` material or `kind` overrides the style's).
    The volume is filled solid. Returns a Building.
    """
    st = STYLES_V2[style]
    top = height or st["wall"]
    infill = wall or st["infill"]
    k = kind or (roof_kind(roof) if roof is not None else st["roof"])
    rm = roof if roof is not None else None
    plinth(v, x0, y0, x1, y1, z0, STONE_DARK, out=1)
    fill(v, x0, y0, x1, y1, z0, z0 + 1, STONE_DARK)
    ground = (x0, y0, x1, y1)
    up = ground
    mid = None
    if style == "settler":
        half_timber(v, x0, y0, x1, y1, z0 + 1, top, infill, TIMBER, spacing=spacing, braces=braces)
        gable = infill
    elif style == "citizen":
        mid = z0 + 7
        coursed_stone(v, x0, y0, x1, y1, z0 + 1, mid, STONE, seed)
        dressed_quoins(v, x0, y0, x1, y1, z0 + 1, mid)
        if jetty:
            jetty_course(v, x0, y0, x1, y1, mid)
            up = (x0 - 1, y0 - 1, x1 + 1, y1 + 1)
        upper_m = upper or infill
        half_timber(v, up[0], up[1], up[2], up[3], mid + (1 if jetty else 0), top, upper_m, TIMBER, spacing=spacing, braces=braces, sill=not jetty)
        gable = upper_m
    else:
        coursed_stone(v, x0, y0, x1, y1, z0 + 1, top, infill if infill[0] == "stone" else STONE, seed)
        dressed_quoins(v, x0, y0, x1, y1, z0 + 1, top)
        gable = STONE
    r = roof_fn(v, up[0], up[2], up[1], up[3], top, k, along=along, rise=rise, ov=ov, gable=gable, seed=seed, hip=hip, m=rm)
    return Building(v, ground, up, z0, mid, top, r)


roof_fn = roof
