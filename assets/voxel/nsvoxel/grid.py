"""
The voxel grid of a model (D-057; ART_DIRECTION §7): a sparse
map (x, y, z) → material with drawing helpers. 8 voxels per tile; x east,
y toward the front of the building (+y, the road side; the water rows of a
harbour building are the low y), z up from the ground (z = 0 is the first
layer above the terrain). A material is (role, shade[, sway group]): a
palette role of assets/palette.json times a brightness factor; the sway
group marks cloth (sails, flags) for the client's sway mask.

Everything is integer and hash based: the same recipe always gives the same
grid (no random module, no clock).
"""

import math

#: Voxels per tile of the building models (the lite level halves it).
VPT = 8


def mat(role, shade=1.0, sway=None):
    """A material: palette role × shade (rounded so that equal shades merge), optional sway group."""
    s = round(shade, 3)
    return (role, s) if sway is None else (role, s, sway)


def shade_of(m, f):
    """The material m with its shade multiplied by f."""
    return mat(m[0], m[1] * f, m[2] if len(m) > 2 else None)


def hash3(x, y, z, seed=0):
    """Deterministic hash of integer coordinates → [0, 1)."""
    h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFF) / 65536.0


class Vox:
    """A sparse voxel model with anchors (voxel coordinates, floats)."""

    def __init__(self, w, d, name=""):
        self.w = w  # footprint in voxels along x
        self.d = d  # footprint in voxels along y
        self.name = name
        self.cells = {}
        self.anchors = {}
        #: Voxel-space point that maps to the model origin's offset from the footprint centre (e.g. (0.5, 0.5, 0.5): a wheel centred on a cell).
        self.offset = (0.0, 0.0, 0.0)

    # ------------------------------------------------------------ cells
    def set(self, x, y, z, m):
        if m is None:
            self.cells.pop((x, y, z), None)
        else:
            self.cells[(x, y, z)] = m

    def get(self, x, y, z):
        return self.cells.get((x, y, z))

    def has(self, x, y, z):
        return (x, y, z) in self.cells

    def box(self, x0, y0, z0, x1, y1, z1, m):
        """Fills x0 ≤ x < x1, y0 ≤ y < y1, z0 ≤ z < z1 (m None clears)."""
        for x in range(x0, x1):
            for y in range(y0, y1):
                for z in range(z0, z1):
                    self.set(x, y, z, m)

    def frame(self, x0, y0, z0, x1, y1, z1, m):
        """The border cells of a box one voxel thick on one axis (a window or door frame)."""
        for x in range(x0, x1):
            for y in range(y0, y1):
                for z in range(z0, z1):
                    if (x1 - x0 > 1 and x in (x0, x1 - 1)) or (y1 - y0 > 1 and y in (y0, y1 - 1)) or (z1 - z0 > 1 and z in (z0, z1 - 1)):
                        self.set(x, y, z, m)

    def walls(self, x0, y0, x1, y1, z0, z1, m):
        """Four walls of one voxel thickness around x0..x1 × y0..y1 (the inside stays empty)."""
        for z in range(z0, z1):
            for x in range(x0, x1):
                self.set(x, y0, z, m)
                self.set(x, y1 - 1, z, m)
            for y in range(y0, y1):
                self.set(x0, y, z, m)
                self.set(x1 - 1, y, z, m)

    def cyl(self, cx, cy, z0, z1, r, m):
        """Vertical cylinder about (cx, cy) (cell centres inside radius r)."""
        for x in range(math.floor(cx - r), math.ceil(cx + r) + 1):
            for y in range(math.floor(cy - r), math.ceil(cy + r) + 1):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                if dx * dx + dy * dy <= r * r:
                    for z in range(z0, z1):
                        self.set(x, y, z, m)

    def ellipsoid(self, cx, cy, cz, rx, ry, rz, m, keep=None):
        """Ellipsoid of cell centres; keep(x, y, z) may veto cells (e.g. a ragged crown)."""
        for x in range(math.floor(cx - rx), math.ceil(cx + rx) + 1):
            for y in range(math.floor(cy - ry), math.ceil(cy + ry) + 1):
                for z in range(math.floor(cz - rz), math.ceil(cz + rz) + 1):
                    dx, dy, dz = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry, (z + 0.5 - cz) / rz
                    if dx * dx + dy * dy + dz * dz <= 1.0 and (keep is None or keep(x, y, z)):
                        self.set(x, y, z, m(x, y, z) if callable(m) else m)

    def line(self, a, b, m):
        """A voxel line from a to b (inclusive)."""
        n = max(abs(b[i] - a[i]) for i in range(3))
        for k in range(n + 1):
            t = k / n if n else 0.0
            self.set(*(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3)), m)

    # ------------------------------------------------------------ roofs
    def gable(self, x0, x1, y0, y1, z, roof, wall, along="x", rise=1, ov=1, ridge=None, tiles=0.12, seed=0):
        """
        Gable roof over x0..x1 × y0..y1 from height z: one course of roof
        tiles per step (alternating shades, so the courses read as rows of
        tiles; `tiles` is the share of single darker tiles), gable ends in the
        wall material, overhang ov at eaves and verges, `rise` layers per step
        inward (2: steep). ridge: material of the ridge course. Returns the
        height above the ridge.
        """
        swap = along == "y"
        a0, a1, b0, b1 = (y0, y1, x0, x1) if swap else (x0, x1, y0, y1)

        def put(a, b, zz, m):
            if swap:
                self.set(b, a, zz, m)
            else:
                self.set(a, b, zz, m)

        j = 0
        while True:
            k = int(j / rise + 1e-9)
            lo = b0 - ov + k
            hi = b1 + ov - 1 - k
            if lo > hi:
                break
            last = hi - lo <= 1
            course = 1.0 if k % 2 == 0 else 0.9
            for a in range(a0 - ov, a1 + ov):
                verge = a < a0 or a >= a1
                for b in range(lo, hi + 1):
                    edge = b in (lo, hi) or last
                    if verge and not edge:
                        continue
                    if not edge and wall is not None and a in (a0, a1 - 1):
                        put(a, b, z + j, wall)
                        continue
                    f = course
                    if tiles and edge and hash3(a, b, z + j, seed + 7) < tiles:
                        f *= 0.9
                    put(a, b, z + j, ridge if (last and ridge is not None) else shade_of(roof, f))
            j += 1
        return z + j

    def hip(self, x0, x1, y0, y1, z, roof, ov=1, rise=1, ridge=None):
        """Hipped roof: every course steps in on all four sides. Returns the height above the top."""
        j = 0
        while True:
            k = int(j / rise + 1e-9)
            ax0, ax1, by0, by1 = x0 - ov + k, x1 + ov - k, y0 - ov + k, y1 + ov - k
            if ax0 >= ax1 or by0 >= by1:
                break
            last = ax1 - ax0 <= 2 or by1 - by0 <= 2
            m = ridge if (last and ridge is not None) else shade_of(roof, 1.0 if k % 2 == 0 else 0.9)
            for x in range(ax0, ax1):
                for y in range(by0, by1):
                    self.set(x, y, z + j, m)
            j += 1
        return z + j

    def shed(self, x0, x1, y0, y1, z, roof, down="y+", ov=1):
        """Lean-to roof sloping down toward `down` (y+, y-, x+, x-), one layer per voxel."""
        if down in ("y+", "y-"):
            n = y1 - y0 + 2 * ov
            for i in range(n):
                y = y0 - ov + i if down == "y-" else y1 + ov - 1 - i
                zz = z + (n - 1 - i) // 2
                for x in range(x0 - ov, x1 + ov):
                    self.set(x, y, zz, shade_of(roof, 1.0 if (i // 2) % 2 == 0 else 0.9))
        else:
            n = x1 - x0 + 2 * ov
            for i in range(n):
                x = x0 - ov + i if down == "x-" else x1 + ov - 1 - i
                zz = z + (n - 1 - i) // 2
                for y in range(y0 - ov, y1 + ov):
                    self.set(x, y, zz, shade_of(roof, 1.0 if (i // 2) % 2 == 0 else 0.9))

    # ------------------------------------------------------------ queries and edits
    def front_y(self, x, z):
        """The largest y with a voxel at (x, ·, z) (−1: none)."""
        ys = [k[1] for k in self.cells if k[0] == x and k[2] == z]
        return max(ys) if ys else -1

    def top_z(self, x, y):
        zs = [k[2] for k in self.cells if k[0] == x and k[1] == y]
        return max(zs) if zs else -1

    def stamp(self, other, ox, oy, oz, replace=True):
        """Copies another model's cells in at an offset (anchors not copied)."""
        for (x, y, z), m in other.cells.items():
            if replace or not self.has(x + ox, y + oy, z + oz):
                self.set(x + ox, y + oy, z + oz, m)

    def mirror_x(self):
        """Mirrors the model about its footprint's centre line x = w/2 (anchors too)."""
        self.cells = {(self.w - 1 - x, y, z): m for (x, y, z), m in self.cells.items()}
        self.anchors = {k: (self.w - p[0], p[1], p[2]) for k, p in self.anchors.items()}
        return self

    def repeat(self, fn, count, step):
        """Calls fn(i, dx, dy, dz) for i < count with the offsets i × step (rows of windows, fence posts …)."""
        for i in range(count):
            fn(i, i * step[0], i * step[1], i * step[2])

    def jitter(self, amount=0.05, roles=None, cell=1, seed=0, levels=2):
        """
        Hash-based brightness noise per voxel (cell 1) or per cell³ block:
        the hand-made voxel look. Quantised to ±amount in `levels` steps so
        that greedy meshing still merges equal neighbours; roles limits it to
        some materials.
        """
        out = {}
        for (x, y, z), m in self.cells.items():
            if roles is not None and m[0] not in roles:
                out[(x, y, z)] = m
                continue
            h = hash3(x // cell, y // cell, z // cell, seed + len(m[0]))
            q = round((h * 2 - 1) * levels) / levels
            out[(x, y, z)] = shade_of(m, 1 + q * amount)
        self.cells = out
        return self

    def anchor(self, name, x, y, z):
        """A named anchor point (voxel units; e.g. the door's ground centre)."""
        self.anchors[name] = (float(x), float(y), float(z))

    def bounds(self):
        xs = [k[0] for k in self.cells]
        ys = [k[1] for k in self.cells]
        zs = [k[2] for k in self.cells]
        return (min(xs), min(ys), min(zs)), (max(xs) + 1, max(ys) + 1, max(zs) + 1)


def downsample(cells, factor=2, keep=2):
    """
    The grid at 1/factor resolution: a block becomes solid when at least
    `keep` of its factor³ cells are, with the most common material among
    the block's visible (topmost first) cells. The far-zoom lite level.
    """
    blocks = {}
    for (x, y, z), m in cells.items():
        k = (x // factor, y // factor, z // factor)
        blocks.setdefault(k, []).append((z, m))
    out = {}
    for k, items in blocks.items():
        if len(items) < keep:
            continue
        count = {}
        for z, m in items:
            # Higher cells weigh more (roofs over walls, a crop over its soil).
            count[m] = count.get(m, 0) + 1 + (z % factor)
        out[k] = max(sorted(count), key=lambda m: count[m])
    return out
