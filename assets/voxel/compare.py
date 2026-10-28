"""Contact sheet of the voxel-compare shots (make voxel-compare): one row per
shot, today's build on the left, ?voxel=1 on the right, labelled with the
shot name. Pure stdlib (PNG decode/encode, area sampling).

    python3 assets/voxel/compare.py <current dir> <voxel dir> <out.png>
"""

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nsvoxel.parts import FONT  # noqa: E402
from nsvoxel.render import png  # noqa: E402

CELL_H = 300
GAP = 8
LABEL = 22
BG = (241, 230, 204)
INK = (79, 56, 36)


def read_png(path):
    """(width, height, rows of RGB bytes) of an 8-bit, non-interlaced RGB or RGBA PNG."""
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    pos = 8
    idat = b""
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + n]
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, inter = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and ctype in (2, 6) and inter == 0, (path, depth, ctype, inter)
        elif kind == b"IDAT":
            idat += body
        pos += 12 + n
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows = []
    prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    if bpp == 4:
        rows = [bytearray(b for i in range(0, stride, 4) for b in r[i:i + 3]) for r in rows]
    return w, h, rows


def scale(img, height):
    """Image scaled to a height (2 × 2 samples per output pixel)."""
    w, h, rows = img
    nw = max(1, round(w * height / h))
    out = []
    for y in range(height):
        line = bytearray(nw * 3)
        sy = [min(h - 1, int((y + o) * h / height)) for o in (0.25, 0.75)]
        for x in range(nw):
            sx = [min(w - 1, int((x + o) * w / nw)) for o in (0.25, 0.75)]
            for ch in range(3):
                line[x * 3 + ch] = sum(rows[a][b * 3 + ch] for a in sy for b in sx) // 4
        out.append(line)
    return nw, height, out


def text(canvas, x, y, s, k=3):
    for ch in s.upper():
        glyph = FONT.get(ch)
        if glyph:
            for gy, row in enumerate(glyph):
                for gx, bit in enumerate(row):
                    if bit == "1":
                        for dy in range(k):
                            for dx in range(k):
                                put(canvas, x + gx * k + dx, y + gy * k + dy, INK)
        x += 4 * k


def put(canvas, x, y, c):
    if 0 <= y < len(canvas) and 0 <= x * 4 < len(canvas[y]):
        canvas[y][x * 4:x * 4 + 4] = bytes((*c, 255))


def main(argv):
    cur, vox, out = argv
    names = sorted(n for n in os.listdir(cur) if n.endswith(".png") and os.path.exists(os.path.join(vox, n)))
    # Desktop first, then phone; within each the order of the run.
    names.sort(key=lambda n: ("phone" in n, n))
    pairs = [(n, scale(read_png(os.path.join(cur, n)), CELL_H), scale(read_png(os.path.join(vox, n)), CELL_H)) for n in names]
    width = GAP + max(a[0] + GAP + b[0] for _, a, b in pairs) + GAP
    height = LABEL + sum(LABEL + CELL_H + GAP for _ in pairs) + GAP
    canvas = [bytearray(bytes((*BG, 255)) * width) for _ in range(height)]
    text(canvas, GAP, 4, "TODAY", 3)
    text(canvas, GAP + pairs[0][1][0] + GAP, 4, "VOXEL", 3)
    y = LABEL
    for n, a, b in pairs:
        text(canvas, GAP, y + 4, n[:-4].replace("-", " ").replace("2x400", "dense").replace("8", ""), 3)
        y += LABEL
        x = GAP
        for img in (a, b):
            iw, ih, rows = img
            for r in range(ih):
                line = canvas[y + r]
                src = rows[r]
                for c in range(iw):
                    line[(x + c) * 4:(x + c) * 4 + 3] = src[c * 3:c * 3 + 3]
            x += iw + GAP
        y += CELL_H + GAP
    with open(out, "wb") as f:
        f.write(png([bytes(r) for r in canvas], width, height))
    print(f"{out}: {len(pairs)} pairs, {width}×{height}")


if __name__ == "__main__":
    main(sys.argv[1:])
