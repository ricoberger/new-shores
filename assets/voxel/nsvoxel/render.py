"""
A small software rasteriser for contact sheets and build-card thumbnails
of the voxel models (no Blender): orthographic view from the front-left at
the game's 30° elevation, a z-buffer, vertex colours (the baked occlusion)
times a warm sun and a sky fill. Pure Python; PNG writer with zlib.
"""

import math
import struct
import zlib

ELEVATION = math.radians(30)
#: The camera looks at the front (+y) and the west side (−x) of a model.
AZIMUTH = math.radians(-35)
SUN = (-0.45, 0.55, 0.70)
SUN_COLOR = (1.0, 0.945, 0.84)
SKY = (0.62, 0.66, 0.74)


def _norm(v):
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / n for c in v)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def view_axes(azimuth=AZIMUTH, elevation=ELEVATION):
    cam = (math.cos(elevation) * math.sin(azimuth), math.cos(elevation) * math.cos(azimuth), math.sin(elevation))
    fwd = tuple(-c for c in cam)
    right = _norm(_cross(fwd, (0.0, 0.0, 1.0)))
    up = _cross(right, fwd)
    return cam, right, up


def render(tris, size=128, background=None, azimuth=AZIMUTH, margin=0.06, scale=None, centre=None):
    """
    RGBA rows (bytes per row) of triangles [(p0, p1, p2), (c0, c1, c2)] in
    recipe space (z up) with 0..1 colours; framed to fit unless scale
    (pixels per tile) and centre are given.
    """
    cam, right, up = view_axes(azimuth)
    sun = _norm(SUN)
    pts = [(_dot(p, right), _dot(p, up)) for t, _, _ in tris for p in t]
    if not pts:
        return [bytes(size * 4) for _ in range(size)]
    if scale is None:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        ext = max(max(xs) - min(xs), max(ys) - min(ys), 1e-3) * (1 + 2 * margin)
        scale = size / ext
        centre = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2)
    cx, cy = centre
    depth = [-1e30] * (size * size)
    rgba = bytearray(size * size * 4)
    if background is not None:
        for i in range(size * size):
            rgba[i * 4 : i * 4 + 4] = bytes(background)
    half = size / 2
    for t, cols, shading in tris:
        n = _norm(_cross(tuple(t[1][i] - t[0][i] for i in range(3)), tuple(t[2][i] - t[0][i] for i in range(3))))
        if _dot(n, cam) <= 0:
            continue
        lam = max(0.0, _dot(shading or n, sun))
        light = tuple(SKY[i] * 0.75 + SUN_COLOR[i] * lam * 0.55 for i in range(3))
        col = [sum(c[i] for c in cols) / 3 for i in range(3)]
        rgb = bytes(min(255, int(col[i] * light[i] * 255 + 0.5)) for i in range(3)) + b"\xff"
        sx = [(_dot(p, right) - cx) * scale + half for p in t]
        sy = [half - (_dot(p, up) - cy) * scale for p in t]
        sz = [_dot(p, cam) for p in t]
        x0 = max(0, int(math.floor(min(sx))))
        x1 = min(size - 1, int(math.ceil(max(sx))))
        y0 = max(0, int(math.floor(min(sy))))
        y1 = min(size - 1, int(math.ceil(max(sy))))
        area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])
        if abs(area) < 1e-12:
            continue
        inv = 1.0 / area
        for py in range(y0, y1 + 1):
            fy = py + 0.5
            for px in range(x0, x1 + 1):
                fx = px + 0.5
                w0 = ((sx[1] - fx) * (sy[2] - fy) - (sx[2] - fx) * (sy[1] - fy)) * inv
                w1 = ((sx[2] - fx) * (sy[0] - fy) - (sx[0] - fx) * (sy[2] - fy)) * inv
                w2 = 1.0 - w0 - w1
                if w0 < -1e-9 or w1 < -1e-9 or w2 < -1e-9:
                    continue
                z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2]
                i = py * size + px
                if z > depth[i]:
                    depth[i] = z
                    rgba[i * 4 : i * 4 + 4] = rgb
    return [bytes(rgba[r * size * 4 : (r + 1) * size * 4]) for r in range(size)]


def downsample(rows, size, f=2):
    """Box filter of RGBA rows (premultiplied by alpha) by f."""
    out = []
    n = size // f
    for r in range(n):
        row = bytearray(n * 4)
        for c in range(n):
            acc = [0, 0, 0, 0]
            for dy in range(f):
                src = rows[r * f + dy]
                for dx in range(f):
                    o = (c * f + dx) * 4
                    a = src[o + 3]
                    acc[0] += src[o] * a
                    acc[1] += src[o + 1] * a
                    acc[2] += src[o + 2] * a
                    acc[3] += a
            a = acc[3]
            if a:
                row[c * 4 : c * 4 + 4] = bytes((acc[0] // a, acc[1] // a, acc[2] // a, a // (f * f)))
        out.append(bytes(row))
    return out


def png(rows, width, height):
    """PNG bytes of RGBA rows (deterministic: fixed zlib level, no timestamps)."""
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def sheet(images, cols, cell, background=(241, 230, 204, 255)):
    """A contact sheet of equally sized RGBA row images (row-major), on a parchment background."""
    n = len(images)
    rows_n = (n + cols - 1) // cols
    w = cols * cell
    out = [bytearray(bytes(background) * w) for _ in range(rows_n * cell)]
    for k, img in enumerate(images):
        ox = (k % cols) * cell
        oy = (k // cols) * cell
        for r, row in enumerate(img):
            dst = out[oy + r]
            for c in range(cell):
                a = row[c * 4 + 3]
                if a == 0:
                    continue
                o = (ox + c) * 4
                if a == 255:
                    dst[o : o + 4] = row[c * 4 : c * 4 + 4]
                else:
                    for i in range(3):
                        dst[o + i] = (row[c * 4 + i] * a + dst[o + i] * (255 - a)) // 255
    return [bytes(r) for r in out], w, rows_n * cell
