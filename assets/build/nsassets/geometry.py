"""
Pure-Python mesh data: triangles in tile units (recipe space: Blender axes,
z up) with the palette role, shade and part label they came from, affine
transforms and the procedural primitives. No bpy here.
"""

import hashlib
import math


class Mesh:
    """
    Triangles: (a, b, c, role, shade, label[, normal]) with a/b/c as (x, y, z)
    tuples (an explicit normal overrides the face normal). `ao` is None or one
    (level, level, level) tuple of baked occlusion levels per triangle.
    """

    __slots__ = ("tris", "ao")

    def __init__(self, tris=None, ao=None):
        self.tris = list(tris or [])
        self.ao = ao

    def extend(self, other):
        self.tris.extend(other.tris)
        self.ao = None

    def __len__(self):
        return len(self.tris)

    def bounds(self):
        """((minx, miny, minz), (maxx, maxy, maxz)) in recipe space."""
        if not self.tris:
            return (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
        mn = [math.inf] * 3
        mx = [-math.inf] * 3
        for t in self.tris:
            for p in t[:3]:
                for i in range(3):
                    if p[i] < mn[i]:
                        mn[i] = p[i]
                    if p[i] > mx[i]:
                        mx[i] = p[i]
        return tuple(mn), tuple(mx)

    def labels(self):
        """Triangle count per part label (insertion order)."""
        out = {}
        for t in self.tris:
            out[t[5]] = out.get(t[5], 0) + 1
        return out


# Matrices: 4×4 as tuples of rows, column vectors (p' = M p).

IDENTITY = ((1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))


def mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)) for i in range(4))


def translation(t):
    return ((1.0, 0.0, 0.0, t[0]), (0.0, 1.0, 0.0, t[1]), (0.0, 0.0, 1.0, t[2]), (0.0, 0.0, 0.0, 1.0))


def scaling(s):
    if isinstance(s, (int, float)):
        s = (s, s, s)
    return ((s[0], 0.0, 0.0, 0.0), (0.0, s[1], 0.0, 0.0), (0.0, 0.0, s[2], 0.0), (0.0, 0.0, 0.0, 1.0))


def rot_x(deg):
    c, s = _cs(deg)
    return ((1.0, 0.0, 0.0, 0.0), (0.0, c, -s, 0.0), (0.0, s, c, 0.0), (0.0, 0.0, 0.0, 1.0))


def rot_y(deg):
    c, s = _cs(deg)
    return ((c, 0.0, s, 0.0), (0.0, 1.0, 0.0, 0.0), (-s, 0.0, c, 0.0), (0.0, 0.0, 0.0, 1.0))


def rot_z(deg):
    c, s = _cs(deg)
    return ((c, -s, 0.0, 0.0), (s, c, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))


def _cs(deg):
    # Exact values for the right angles keep axis-aligned pieces exact.
    d = deg % 360.0
    exact = {0.0: (1.0, 0.0), 90.0: (0.0, 1.0), 180.0: (-1.0, 0.0), 270.0: (0.0, -1.0)}
    if d in exact:
        return exact[d]
    r = math.radians(deg)
    return math.cos(r), math.sin(r)


def euler_xyz(rot):
    """Blender's XYZ Euler (degrees): R = Rz · Ry · Rx."""
    return mat_mul(rot_z(rot[2]), mat_mul(rot_y(rot[1]), rot_x(rot[0])))


def trs(position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), scale=1.0):
    return mat_mul(translation(position), mat_mul(euler_xyz(rotation), scaling(scale)))


def apply(m, p):
    x, y, z = p
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
        m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
        m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
    )


def det3(m):
    return (
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    )


def transformed(tris, m, flip=False):
    """Triangles (a, b, c, ...) transformed by m; the winding is kept outward (reversed for mirroring)."""
    rev = (det3(m) < 0) != flip
    out = []
    for t in tris:
        a, b, c = apply(m, t[0]), apply(m, t[1]), apply(m, t[2])
        out.append((a, c, b) + tuple(t[3:]) if rev else (a, b, c) + tuple(t[3:]))
    return out


def area2(a, b, c):
    """Twice the triangle area."""
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    return math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2)


def normal(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    length = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
    return (n[0] / length, n[1] / length, n[2] / length)


# Deterministic random numbers for perturbations (seeded by recipe ID and part).


def seed_of(*keys):
    return int(hashlib.sha256(":".join(str(k) for k in keys).encode()).hexdigest()[:8], 16)


class Rng:
    """32-bit LCG (the client fixtures use the same constants)."""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s / 4294967296.0


# Primitives: lists of (a, b, c) triangles, counter-clockwise seen from outside.


def _quad(a, b, c, d):
    """Two triangles of the quad a-b-c-d (counter-clockwise)."""
    return [(a, b, c), (a, c, d)]


def box(size, open_faces=()):
    """A box centred in x and y, standing on z = 0."""
    x, y, z = size[0] / 2, size[1] / 2, size[2]
    v = {
        "---": (-x, -y, 0.0), "+--": (x, -y, 0.0), "++-": (x, y, 0.0), "-+-": (-x, y, 0.0),
        "--+": (-x, -y, z), "+-+": (x, -y, z), "+++": (x, y, z), "-++": (-x, y, z),
    }
    faces = {
        "bottom": ("---", "-+-", "++-", "+--"),
        "top": ("--+", "+-+", "+++", "-++"),
        "-y": ("---", "+--", "+-+", "--+"),
        "+y": ("-+-", "-++", "+++", "++-"),
        "-x": ("---", "--+", "-++", "-+-"),
        "+x": ("+--", "++-", "+++", "+-+"),
    }
    out = []
    for name in ("bottom", "top", "-y", "+y", "-x", "+x"):
        if name in open_faces:
            continue
        out += _quad(*(v[k] for k in faces[name]))
    return out


def _ring(r, z, n, phase):
    return [(r * math.cos(phase + 2 * math.pi * i / n), r * math.sin(phase + 2 * math.pi * i / n), z) for i in range(n)]


def cylinder(radius, height, radius_top=None, segments=8, caps=False):
    """A cylinder or frustum (radius_top 0: cone) on z = 0; top cap always, bottom cap with caps."""
    rt = radius if radius_top is None else radius_top
    phase = math.pi / segments
    lo = _ring(radius, 0.0, segments, phase)
    hi = _ring(rt, height, segments, phase)
    out = []
    for i in range(segments):
        j = (i + 1) % segments
        if rt == 0:
            out.append((lo[i], lo[j], (0.0, 0.0, height)))
        else:
            out += _quad(lo[i], lo[j], hi[j], hi[i])
    if rt > 0:
        for i in range(1, segments - 1):
            out.append((hi[0], hi[i], hi[i + 1]))
    if caps:
        for i in range(1, segments - 1):
            out.append((lo[0], lo[i + 1], lo[i]))
    return out


def wedge(size, hip=0.0):
    """A roof: ridge along x at height z over the y-depth; gable ends (hip 0) or hipped ends."""
    x, y, z = size[0] / 2, size[1] / 2, size[2]
    h = min(hip, x)
    r0, r1 = (-x + h, 0.0, z), (x - h, 0.0, z)
    a, b, c, d = (-x, -y, 0.0), (x, -y, 0.0), (x, y, 0.0), (-x, y, 0.0)
    out = []
    out += _quad(a, b, r1, r0) if h < x else [(a, b, r1)]
    out += _quad(c, d, r0, r1) if h < x else [(c, d, r1)]
    out.append((b, c, r1))
    out.append((d, a, r0))
    return [t for t in out if area2(*t) > 1e-12]


def sail(width, height, width_top=None, bulge=0.0, rows=3):
    """A vertical sail in the x-z plane (y = 0) bulged toward +y; both sides (double-sided)."""
    wt = width if width_top is None else width_top
    cols = 2
    grid = []
    for j in range(rows + 1):
        v = j / rows
        w = width + (wt - width) * v
        row = []
        for i in range(cols + 1):
            u = i / cols
            belly = bulge * math.sin(math.pi * u) * math.sin(math.pi * (0.2 + 0.6 * v))
            row.append(((u - 0.5) * w, belly, v * height))
        grid.append(row)
    out = []
    for j in range(rows):
        for i in range(cols):
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            for t in _quad(a, b, c, d):
                if area2(*t) > 1e-12:
                    out.append(t)
                    out.append((t[0], t[2], t[1]))
    return out


def lathe(profile, segments=8):
    """The (radius, z) profile revolved about z (a 0 radius closes the end)."""
    phase = math.pi / segments
    rings = [_ring(r, z, segments, phase) if r > 0 else None for r, z in profile]
    out = []
    for k in range(len(profile) - 1):
        lo, hi = rings[k], rings[k + 1]
        zlo, zhi = profile[k][1], profile[k + 1][1]
        for i in range(segments):
            j = (i + 1) % segments
            if lo is None and hi is None:
                continue
            if lo is None:
                out.append(((0.0, 0.0, zlo), hi[j], hi[i]))
            elif hi is None:
                out.append((lo[i], lo[j], (0.0, 0.0, zhi)))
            else:
                out += _quad(lo[i], lo[j], hi[j], hi[i])
    return [t for t in out if area2(*t) > 1e-12]


_ICO = None


def _icosahedron():
    global _ICO
    if _ICO is None:
        p = (1 + math.sqrt(5)) / 2
        v = [(-1, p, 0), (1, p, 0), (-1, -p, 0), (1, -p, 0), (0, -1, p), (0, 1, p), (0, -1, -p), (0, 1, -p), (p, 0, -1), (p, 0, 1), (-p, 0, -1), (-p, 0, 1)]
        v = [tuple(c / math.sqrt(1 + p * p) for c in q) for q in v]
        f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        # Rotate 90° about x so that the shape's z axis is up (z-up convention).
        _ICO = ([(x, -z, y) for x, y, z in v], f)
    return _ICO


def rock(size, detail, rng):
    """A jagged rock: an icosahedron (detail 1: subdivided once) with seeded radial jitter, radii size."""
    verts, faces = _icosahedron()
    verts = list(verts)
    if detail:
        mids = {}
        new_faces = []

        def mid(i, j):
            key = (min(i, j), max(i, j))
            if key not in mids:
                a, b = verts[i], verts[j]
                m = tuple((a[k] + b[k]) / 2 for k in range(3))
                length = math.sqrt(sum(c * c for c in m))
                verts.append(tuple(c / length for c in m))
                mids[key] = len(verts) - 1
            return mids[key]

        for a, b, c in faces:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            new_faces += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        faces = new_faces
    jitter = [0.78 + 0.4 * rng.next() for _ in verts]
    pts = [(v[0] * size[0] * j, v[1] * size[1] * j, v[2] * size[2] * j) for v, j in zip(verts, jitter)]
    return [(pts[a], pts[b], pts[c]) for a, b, c in faces]


def hemisphere(n):
    """n fixed cosine-weighted directions about +z (golden-angle spiral; deterministic)."""
    out = []
    golden = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        r = math.sqrt((i + 0.5) / n)
        a = i * golden
        out.append((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1.0 - r * r))))
    return out


def frame(nrm):
    """An orthonormal (tangent, bitangent, normal) frame about a unit normal."""
    nx, ny, nz = nrm
    h = (1.0, 0.0, 0.0) if abs(nx) < 0.9 else (0.0, 1.0, 0.0)
    t = (h[1] * nz - h[2] * ny, h[2] * nx - h[0] * nz, h[0] * ny - h[1] * nx)
    ln = math.sqrt(sum(c * c for c in t)) or 1.0
    t = tuple(c / ln for c in t)
    b = (ny * t[2] - nz * t[1], nz * t[0] - nx * t[2], nx * t[1] - ny * t[0])
    return t, b, nrm
