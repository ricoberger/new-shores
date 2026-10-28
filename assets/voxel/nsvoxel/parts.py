"""
Reusable voxel parts of the recipes: yards, timber-framed walls, windows
with frames and sills, doors, chimneys with pots, roofs (grid.Vox), fences
and props. Coordinates are voxels (8 per tile, grid.VPT); a facade is
addressed by its side ("y+" front, "y-" back, "x+" east, "x-" west) and the
plane of its outer wall layer.
"""

from .grid import hash3, mat, shade_of
from .mats import (
    BRASS,
    CANVAS,
    DIRT,
    FLOWER,
    GRASS_A,
    GRASS_B,
    IRON,
    PAVED,
    PLANK,
    SAND,
    STONE,
    STONE_DARK,
    THATCH,
    TIMBER,
    TIMBER_DARK,
    TIMBER_LIGHT,
    WINDOW,
    CROWN,
    FOREST,
)


class Face:
    """One facade: put(a, z, m, out) sets the cell at position a along the wall, height z, `out` voxels outward of the wall plane."""

    def __init__(self, v, side, plane):
        self.v = v
        self.side = side
        self.plane = plane

    def xy(self, a, out=0):
        s = self.side
        if s == "y+":
            return a, self.plane + out
        if s == "y-":
            return a, self.plane - out
        if s == "x+":
            return self.plane + out, a
        return self.plane - out, a

    def put(self, a, z, m, out=0):
        x, y = self.xy(a, out)
        self.v.set(x, y, z, m)

    def get(self, a, z, out=0):
        x, y = self.xy(a, out)
        return self.v.get(x, y, z)


def faces_of(v, x0, y0, x1, y1):
    """The four facades of a block x0..x1 × y0..y1 (exclusive), keyed by side."""
    return {"y+": Face(v, "y+", y1 - 1), "y-": Face(v, "y-", y0), "x+": Face(v, "x+", x1 - 1), "x-": Face(v, "x-", x0)}


def span(side, x0, y0, x1, y1):
    """(first, last+1) of the positions along a facade of the block."""
    return (x0, x1) if side in ("y+", "y-") else (y0, y1)


# ---------------------------------------------------------------- ground


def yard(v, x0, y0, x1, y1, kind="grass", z=0, seed=0):
    """The one-voxel ground plate of a yard (the footprint's plinth): grass, dirt, paved, sand or planks."""
    for x in range(x0, x1):
        for y in range(y0, y1):
            # Patches of 4 × 4 voxels (one per half tile): enough variation to read as hand-placed, few enough to keep the greedy quads large.
            h = hash3(x // 4, y // 4, z, seed)
            if kind == "grass":
                m = GRASS_A if h < 0.6 else GRASS_B
                if hash3(x, y, z, seed + 1) < 0.015:
                    m = FLOWER
            elif kind == "dirt":
                m = shade_of(DIRT, 1.0 if h < 0.65 else 0.93)
            elif kind == "paved":
                # Flagstones of 4 × 2 voxels in staggered rows.
                m = shade_of(PAVED, (1.0, 0.95, 1.04)[int(hash3((x + (y // 2) % 2 * 2) // 4, y // 2, 3, seed) * 3)])
            elif kind == "sand":
                m = shade_of(SAND, 1.0 if h < 0.7 else 0.96)
            elif kind == "planks":
                m = shade_of(PLANK, 1.0 if (y // 2) % 2 == 0 else 0.9)
            else:
                m = kind
            v.set(x, y, z, m)


def path(v, cells, kind="dirt", z=0, seed=0):
    """Overwrites ground cells (x, y) with a path material."""
    for x, y in cells:
        h = hash3(x // 3, y // 3, 5, seed)
        m = shade_of(DIRT if kind == "dirt" else PAVED, 1.0 if h < 0.75 else 0.92)
        v.set(x, y, z, m)


# ---------------------------------------------------------------- walls


def block(v, x0, y0, x1, y1, z0, z1, wall):
    """A hollow block of walls (one voxel thick) with a ceiling layer at z1 − 1."""
    v.walls(x0, y0, x1, y1, z0, z1, wall)
    v.box(x0, y0, z1 - 1, x1, y1, z1, wall)


def timber_frame(v, x0, y0, x1, y1, z0, z1, infill, frame=TIMBER, spacing=4, braces=True, sill=True):
    """
    Half-timbered walls: infill panels between posts every `spacing` voxels
    (corners included), a sill and a top beam, and optional diagonal braces
    in the corner panels (each brace one voxel line).
    """
    block(v, x0, y0, x1, y1, z0, z1, infill)
    for side, f in faces_of(v, x0, y0, x1, y1).items():
        a0, a1 = span(side, x0, y0, x1, y1)
        posts = list(range(a0, a1, spacing)) + [a1 - 1]
        for a in posts:
            for z in range(z0, z1):
                f.put(a, z, frame)
        for a in range(a0, a1):
            f.put(a, z1 - 1, frame)
            if sill:
                f.put(a, z0, frame)
        if braces and z1 - z0 >= 5:
            h = min(spacing - 1, z1 - z0 - 2)
            for k in range(h):
                f.put(a0 + 1 + k, z0 + 1 + k, frame)
                f.put(a1 - 2 - k, z0 + 1 + k, frame)


def beam(v, x0, y0, x1, y1, z, m=TIMBER):
    """A ring beam around a block at height z (floor line)."""
    v.walls(x0, y0, x1, y1, z, z + 1, m)


def jetty(v, x0, y0, x1, y1, z, m=TIMBER_DARK):
    """A one-voxel overhang course of joist ends below an upper storey (jettied floor)."""
    for x in range(x0, x1):
        for y in (y0, y1 - 1):
            if x % 2 == 0:
                v.set(x, y, z, m)
    for y in range(y0, y1):
        for x in (x0, x1 - 1):
            if y % 2 == 0:
                v.set(x, y, z, m)


def quoins(v, x0, y0, x1, y1, z0, z1, m=STONE_DARK):
    """Corner stones in alternating courses (stone buildings)."""
    for z in range(z0, z1):
        long = (z // 2) % 2 == 0
        for cx, cy, dx, dy in ((x0, y0, 1, 1), (x1 - 1, y0, -1, 1), (x0, y1 - 1, 1, -1), (x1 - 1, y1 - 1, -1, -1)):
            v.set(cx, cy, z, m)
            v.set(cx + dx * (1 if long else 0), cy, z, m)
            v.set(cx, cy + dy * (0 if long else 1), z, m)


def stone_wall(v, x0, y0, x1, y1, z0, z1, m=STONE, seed=0):
    """Rubble walls: the block in stone with two shades in staggered 3×2 courses."""
    block(v, x0, y0, x1, y1, z0, z1, m)
    for (x, y, z), c in list(v.cells.items()):
        if z0 <= z < z1 and c == m and (x in (x0, x1 - 1) or y in (y0, y1 - 1)):
            a = x if y in (y0, y1 - 1) else y
            if hash3((a + (z // 2) * 2) // 3, z // 2, 0, seed) < 0.35:
                v.set(x, y, z, shade_of(m, 0.93))


# ---------------------------------------------------------------- openings


def window(f, a, z, w=2, h=3, frame=TIMBER_LIGHT, glass=WINDOW, shutters=None, sill=True, cross=False):
    """
    A window in a facade: glass set one voxel back, a frame in the wall
    plane around it, a sill one voxel proud below and optional shutters
    (one voxel proud, either side).
    """
    for i in range(-1, w + 1):
        for j in range(-1, h + 1):
            if 0 <= i < w and 0 <= j < h:
                f.put(a + i, z + j, None)
                f.put(a + i, z + j, glass, out=-1)
            else:
                f.put(a + i, z + j, frame)
    if cross and w >= 3:
        for j in range(h):
            f.put(a + w // 2, z + j, frame)
    if cross and h >= 3:
        for i in range(w):
            f.put(a + i, z + h // 2, frame)
    if sill:
        for i in range(-1, w + 1):
            f.put(a + i, z - 1, frame, out=1)
    if shutters is not None:
        for j in range(h):
            f.put(a - 2, z + j, shutters, out=0)
            f.put(a + w + 1, z + j, shutters, out=0)
            f.put(a - 2, z + j, shutters, out=1)
            f.put(a + w + 1, z + j, shutters, out=1)


def door(f, a, z, w=3, h=5, leaf=TIMBER, frame=TIMBER_DARK, step=STONE_DARK, knob=BRASS, arch=False):
    """A plank door one voxel back in a frame, a brass knob and a stone step in front (when above the yard)."""
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
    f.put(a + w - 1, z + h // 2, knob, out=-1)
    if z > 0 and step is not None:
        for zz in range(0, z):
            for i in range(-1, w + 1):
                f.put(a + i, zz, step, out=1)


def gate(f, a, z, w=4, h=5, leaf=TIMBER, frame=TIMBER_DARK):
    """A wide barn/warehouse gate (two leaves with a diagonal brace each)."""
    door(f, a, z, w, h, leaf, frame, None, IRON)
    half = w // 2
    for k in range(min(half, h)):
        f.put(a + k, z + k, TIMBER_DARK, out=-1)
        f.put(a + w - 1 - k, z + k, TIMBER_DARK, out=-1)


# ---------------------------------------------------------------- roof furniture


def chimney(v, x, y, z0, z1, m=STONE, cap=STONE_DARK):
    """
    A 2 × 2 chimney stack from z0 to z1 with a wider cap course and a pot
    (one cell) on top; returns the smoke anchor (voxel units: the pot's top
    centre).
    """
    v.box(x, y, z0, x + 2, y + 2, z1, m)
    for zz in range(z0, z1):
        if (zz // 2) % 2:
            v.set(x, y, zz, shade_of(m, 0.92))
            v.set(x + 1, y + 1, zz, shade_of(m, 0.92))
    v.box(x - 1, y - 1, z1, x + 3, y + 3, z1 + 1, cap)
    v.box(x, y, z1 + 1, x + 2, y + 2, z1 + 2, cap)
    v.set(x, y, z1 + 2, mat("terracotta", 0.9))
    return (x + 1.0, y + 1.0, z1 + 3.0)


def dormer(v, x0, x1, y, z, roof, wall, frame=TIMBER_LIGHT, face="y+"):
    """A small dormer on a roof slope: a wall cell with a window and its own little gable roof (ridge along y)."""
    depth = 4
    ys = (y - depth + 1, y + 1) if face == "y+" else (y, y + depth)
    v.box(x0, ys[0], z, x1, ys[1], z + 4, wall)
    f = Face(v, face, ys[1] - 1 if face == "y+" else ys[0])
    window(f, x0 + 1, z + 1, x1 - x0 - 2, 2, frame, sill=False)
    v.gable(x0, x1, ys[0], ys[1], z + 4, roof, wall, along="y", ov=1, tiles=0)


# ---------------------------------------------------------------- fences and props


def fence(v, x0, y0, x1, y1, z=1, post=TIMBER_LIGHT, rail=PLANK, every=4, gaps=()):
    """A post-and-rail fence around x0..x1 × y0..y1 (cells in `gaps` stay open)."""
    ring = [(x, y0) for x in range(x0, x1)] + [(x1 - 1, y) for y in range(y0, y1)] + [(x, y1 - 1) for x in range(x1 - 1, x0 - 1, -1)] + [(x0, y) for y in range(y1 - 1, y0 - 1, -1)]
    seen = set()
    for i, (x, y) in enumerate(ring):
        if (x, y) in seen or (x, y) in gaps:
            continue
        seen.add((x, y))
        corner = (x in (x0, x1 - 1)) and (y in (y0, y1 - 1))
        if corner or i % every == 0:
            v.box(x, y, z, x + 1, y + 1, z + 2, post)
        else:
            v.set(x, y, z + 1, rail)


def fence_line(v, x0, y0, x1, y1, z=1, post=TIMBER_LIGHT, rail=PLANK, every=4):
    """A straight fence from (x0, y0) to (x1, y1) (one axis)."""
    n = max(abs(x1 - x0), abs(y1 - y0))
    for i in range(n + 1):
        x = x0 + (i if x1 > x0 else -i if x1 < x0 else 0)
        y = y0 + (i if y1 > y0 else -i if y1 < y0 else 0)
        if i % every == 0 or i == n:
            v.box(x, y, z, x + 1, y + 1, z + 2, post)
        else:
            v.set(x, y, z + 1, rail)


def crate(v, x, y, z, s=2, m=TIMBER_LIGHT):
    v.box(x, y, z, x + s, y + s, z + s, m)
    v.box(x, y, z + s - 1, x + s, y + s, z + s, shade_of(m, 1.1))
    v.set(x, y, z, TIMBER)
    v.set(x + s - 1, y + s - 1, z, TIMBER)


def barrel(v, x, y, z, h=3, m=TIMBER_LIGHT):
    """A 2 × 2 barrel with a darker hoop course."""
    v.box(x, y, z, x + 2, y + 2, z + h, m)
    v.box(x, y, z + 1, x + 2, y + 2, z + 2, TIMBER_DARK)
    v.set(x, y, z + h - 1, shade_of(m, 0.9))


def sack(v, x, y, z, m=CANVAS):
    v.box(x, y, z, x + 2, y + 1, z + 2, m)
    v.set(x, y, z + 1, shade_of(m, 0.9))


def logs(v, x, y, z, n=3, length=6, along="x", m=TIMBER_LIGHT):
    """A pile of logs: rows of one-voxel rounds with pale cut ends, n at the bottom, one fewer per course."""
    zz = z
    for course in range(n):
        for i in range(n - course):
            off = i * 1 + (course + 1) // 2 * 0 + (course // 1) * 0
            for k in range(length):
                end = k in (0, length - 1)
                c = PLANK if end else shade_of(m, 1.0 if (i + course) % 2 == 0 else 0.86)
                if along == "x":
                    v.set(x + k, y + off + (course + 1) // 2 * 0 + course // 2, zz, c)
                else:
                    v.set(x + off + course // 2, y + k, zz, c)
        zz += 1
    return zz


def planks(v, x, y, z, w=6, d=3, h=2, along="x"):
    """A stack of sawn planks (pale timber with darker layers)."""
    for k in range(h):
        c = PLANK if k % 2 == 0 else shade_of(PLANK, 0.86)
        if along == "x":
            v.box(x, y, z + k, x + w, y + d, z + k + 1, c)
        else:
            v.box(x, y, z + k, x + d, y + w, z + k + 1, c)


def hay(v, x, y, z, w=3, d=2, h=2):
    v.box(x, y, z, x + w, y + d, z + h, THATCH)
    v.box(x, y, z + h - 1, x + w, y + d, z + h, mat("thatch", 1.12))


def lantern(v, x, y, z, h=5):
    v.box(x, y, z, x + 1, y + 1, z + h, IRON)
    v.set(x, y, z + h, BRASS)


def bush(v, x, y, z, r=2, m=None, seed=0):
    """A small round shrub (2 shades)."""
    base = m or CROWN
    for dx in range(-r, r):
        for dy in range(-r, r):
            for dz in range(0, r + 1):
                if dx * dx + dy * dy + (dz * 1.6) ** 2 <= r * r + 0.5:
                    h = hash3(x + dx, y + dy, z + dz, seed)
                    v.set(x + dx, y + dy, z + dz, shade_of(base, 1.08 if dz >= r - 1 and h < 0.6 else 0.94))


def tree(v, x, y, z, kind="broad", seed=0):
    """A yard tree: a trunk and a stepped crown (broad, conifer or fruit)."""
    if kind == "conifer":
        v.box(x, y, z, x + 1, y + 1, z + 3, TIMBER)
        r = 3
        zz = z + 2
        while r >= 1:
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    if abs(dx) + abs(dy) <= r + 1:
                        v.box(x + dx, y + dy, zz, x + dx + 1, y + dy + 1, zz + 2, shade_of(FOREST, 1.0 + 0.08 * (3 - r)))
            zz += 2
            r -= 1
        return
    v.box(x, y, z, x + 1, y + 1, z + 4, TIMBER)
    crown = CROWN if kind == "broad" else mat("orchard")
    v.ellipsoid(x + 0.5, y + 0.5, z + 6, 3.2, 3.2, 2.6, lambda a, b, c: shade_of(crown, 1.1 if c >= z + 7 else 0.95))
    if kind == "fruit":
        for k in range(6):
            a = int(hash3(k, x, y, seed) * 6) - 3
            b = int(hash3(y, k, x, seed + 1) * 6) - 3
            v.set(x + a, y + b, z + 5 + (k % 3), mat("orchard-mark"))


# ---------------------------------------------------------------- signs and labels

#: 3 × 5 pixel glyphs (rows top to bottom) for the placeholder labels.
FONT = {
    "A": ("010", "101", "111", "101", "101"),
    "B": ("110", "101", "110", "101", "110"),
    "C": ("011", "100", "100", "100", "011"),
    "D": ("110", "101", "101", "101", "110"),
    "E": ("111", "100", "110", "100", "111"),
    "F": ("111", "100", "110", "100", "100"),
    "G": ("011", "100", "101", "101", "011"),
    "H": ("101", "101", "111", "101", "101"),
    "I": ("111", "010", "010", "010", "111"),
    "J": ("001", "001", "001", "101", "010"),
    "K": ("101", "101", "110", "101", "101"),
    "L": ("100", "100", "100", "100", "111"),
    "M": ("101", "111", "111", "101", "101"),
    "N": ("110", "101", "101", "101", "101"),
    "O": ("010", "101", "101", "101", "010"),
    "P": ("110", "101", "110", "100", "100"),
    "Q": ("010", "101", "101", "110", "011"),
    "R": ("110", "101", "110", "101", "101"),
    "S": ("011", "100", "010", "001", "110"),
    "T": ("111", "010", "010", "010", "010"),
    "U": ("101", "101", "101", "101", "111"),
    "V": ("101", "101", "101", "101", "010"),
    "W": ("101", "101", "111", "111", "101"),
    "X": ("101", "101", "010", "101", "101"),
    "Y": ("101", "101", "010", "010", "010"),
    "Z": ("111", "001", "010", "100", "111"),
}


def label(f, a, z, text, board=PLANK, ink=TIMBER_DARK, frame=BRASS):
    """A sign board with pixel letters on a facade (one voxel proud): placeholders say what they stand for."""
    n = len(text)
    w = n * 4 + 1
    for i in range(-1, w + 1):
        for j in range(-1, 7):
            edge = i in (-1, w) or j in (-1, 6)
            f.put(a + i, z + j, frame if edge else board, out=1)
    for k, ch in enumerate(text.upper()):
        g = FONT.get(ch)
        if not g:
            continue
        for row, bits in enumerate(g):
            for col, b in enumerate(bits):
                if b == "1":
                    f.put(a + 1 + k * 4 + col, z + 5 - row, ink, out=1)
    return w


def awning(v, x0, x1, y, z, depth=3, m=None, alt=CANVAS):
    """A striped awning sloping out from a wall at y (toward +y) over x0..x1."""
    stripe = m or mat("dye-blue")
    for k in range(depth):
        for x in range(x0, x1):
            v.set(x, y + 1 + k, z - k // 2, stripe if (x // 2) % 2 == 0 else alt)


# ---------------------------------------------------------------- whole buildings

#: Wall height (top z) and roof of the tier styles.
STYLES = {
    # settler: stone sill course, plaster in a timber frame, steep thatch
    "settler": {"wall": 9, "roof": mat("thatch"), "ridge": mat("thatch", 0.86), "rise": 1.5},
    # citizen: plaster/ochre timber frame on a stone course, terracotta at 45°
    "citizen": {"wall": 11, "roof": mat("terracotta"), "ridge": mat("terracotta", 0.84), "rise": 1},
    # stone: rubble walls with quoins, terracotta
    "stone": {"wall": 10, "roof": mat("terracotta"), "ridge": mat("terracotta", 0.84), "rise": 1},
    # workshop: rubble walls with a thatched roof
    "stonethatch": {"wall": 9, "roof": mat("thatch"), "ridge": mat("thatch", 0.86), "rise": 1.5},
}


def house(v, x0, y0, x1, y1, style="settler", along="x", wall=None, z0=1, height=None, roof=None, seed=0, hip=False):
    """
    A whole building block in a tier style: walls (timber frame or rubble)
    from z0 and a gable (or hipped) roof. Returns the height above the
    ridge. The quickest way to a plausible building; recipes add doors,
    windows, chimneys and props.
    """
    st = STYLES[style]
    top = height or st["wall"]
    infill = wall or (mat("plaster") if style != "citizen" else mat("ochre"))
    if style in ("stone", "stonethatch"):
        stone_wall(v, x0, y0, x1, y1, z0, top, STONE, seed)
        quoins(v, x0, y0, x1, y1, z0, top)
        gable_wall = STONE
    else:
        v.box(x0, y0, z0, x1, y1, z0 + 1, STONE_DARK)
        timber_frame(v, x0, y0, x1, y1, z0 + 1, top, infill, TIMBER, spacing=5, braces=False, sill=False)
        gable_wall = infill
    r = roof or st["roof"]
    if hip:
        return v.hip(x0, x1, y0, y1, top, r, ov=1, rise=st["rise"], ridge=st["ridge"])
    return v.gable(x0, x1, y0, y1, top, r, gable_wall, along=along, rise=st["rise"], ov=1, ridge=st["ridge"], seed=seed)


def windows(v, side, plane, a0, a1, z, every=6, w=2, h=2, skip=(), **kw):
    """A row of windows along a facade from a0 to a1, one every `every` voxels (positions in skip left out)."""
    f = Face(v, side, plane)
    for a in range(a0, a1 - w + 1, every):
        if not any(s - w - 1 <= a <= s + 3 for s in skip):
            window(f, a, z, w, h, **kw)


def smoke(v, x, y, z0, z1, **kw):
    """A chimney with the chimney and smoke anchors."""
    s = chimney(v, x, y, z0, z1, **kw)
    v.anchor("chimney", s[0], s[1], s[2] - 1)
    v.anchor("smoke", *s)
    return s
