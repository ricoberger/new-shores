"""
GLB (binary glTF 2.0) writer and reader for the export profile: one mesh,
one TRIANGLES primitive, one white material, POSITION / NORMAL / COLOR_0,
no textures, UVs, animations or extensions. Deterministic bytes: the same
triangles always give the same file.
"""

import json
import struct

from . import config, geometry
from .palette import to_byte

ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963
FLOAT = 5126
UNSIGNED_BYTE = 5121
UNSIGNED_SHORT = 5123
UNSIGNED_INT = 5125


def to_gltf(p):
    """Recipe space (Blender, z up) → glTF (y up): (x, z, −y)."""
    return (p[0], p[2], -p[1])


def _f32(v):
    return struct.unpack("<f", struct.pack("<f", v))[0]


def _json_float(v):
    """A float32 value as the shortest JSON float that round-trips (9 significant digits)."""
    r = float(f"{_f32(v):.9g}")
    return 0.0 if r == 0 else r


def vertex_data(tris, colors, ao=None):
    """
    Deduplicated vertices of flat-shaded triangles in glTF space: positions
    and normals rounded (stable bytes), colours as RGBA bytes. colors maps
    (role, shade) → colour, or with ao (one level triple per triangle)
    (role, shade, level) → colour. Returns (positions, normals, colors, indices).
    """
    index = {}
    positions, normals, cols, indices = [], [], [], []
    pd, nd = config.POSITION_DECIMALS, config.NORMAL_DECIMALS
    for k, t in enumerate(tris):
        a, b, c = (to_gltf(p) for p in t[:3])
        # An explicit normal (sails: up, lit from both sides) or the flat face normal.
        n = to_gltf(t[6]) if len(t) > 6 else geometry.normal(a, b, c)
        n = tuple(round(x, nd) + 0.0 for x in n)
        # Smooth-shaded triangles carry one normal per corner.
        ns = [tuple(round(x, nd) + 0.0 for x in to_gltf(m)) for m in t[7]] if len(t) > 7 else [n] * 3
        corner = [colors[(t[3], t[4], lvl)] for lvl in ao[k]] if ao is not None else [colors[(t[3], t[4])]] * 3
        for p, col, n in zip((a, b, c), corner, ns):
            q = tuple(round(x, pd) + 0.0 for x in p)
            key = (q, n, col)
            i = index.get(key)
            if i is None:
                i = len(positions)
                index[key] = i
                positions.append(q)
                normals.append(n)
                cols.append(col)
            indices.append(i)
    return positions, normals, cols, indices


def color_bytes(rgb):
    return tuple(to_byte(c) for c in rgb) + (255,)


def write(name, tris, colors, ao=None):
    """GLB bytes of the triangles; colors maps (role, shade) → (r, g, b) floats, with ao (role, shade, level) → (r, g, b)."""
    byte_colors = {k: color_bytes(v) for k, v in colors.items()}
    positions, normals, cols, indices = vertex_data(tris, byte_colors, ao)
    n = len(positions)
    pos_bin = b"".join(struct.pack("<3f", *p) for p in positions)
    nor_bin = b"".join(struct.pack("<3f", *v) for v in normals)
    col_bin = b"".join(struct.pack("<4B", *c) for c in cols)
    short = n < 65536
    idx_bin = b"".join(struct.pack("<H" if short else "<I", i) for i in indices)
    idx_bin += b"\x00" * ((4 - len(idx_bin) % 4) % 4)
    views, offset = [], 0
    blob = b""
    for data, target in ((pos_bin, ARRAY_BUFFER), (nor_bin, ARRAY_BUFFER), (col_bin, ARRAY_BUFFER), (idx_bin, ELEMENT_ARRAY_BUFFER)):
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target})
        blob += data
        offset += len(data)
    # The index view's byteLength excludes the padding.
    views[3]["byteLength"] = len(indices) * (2 if short else 4)
    mn = [_json_float(min(p[i] for p in positions)) for i in range(3)] if positions else [0.0] * 3
    mx = [_json_float(max(p[i] for p in positions)) for i in range(3)] if positions else [0.0] * 3
    doc = {
        "asset": {"version": "2.0", "generator": config.GENERATOR},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [
            {
                "name": name,
                "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "indices": 3, "material": 0, "mode": 4}],
            }
        ],
        "materials": [
            {"name": "palette", "pbrMetallicRoughness": {"baseColorFactor": [1.0, 1.0, 1.0, 1.0], "metallicFactor": 0.0, "roughnessFactor": 1.0}}
        ],
        "accessors": [
            {"bufferView": 0, "componentType": FLOAT, "count": n, "type": "VEC3", "min": mn, "max": mx},
            {"bufferView": 1, "componentType": FLOAT, "count": n, "type": "VEC3"},
            {"bufferView": 2, "componentType": UNSIGNED_BYTE, "normalized": True, "count": n, "type": "VEC4"},
            {"bufferView": 3, "componentType": UNSIGNED_SHORT if short else UNSIGNED_INT, "count": len(indices), "type": "SCALAR"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(doc, separators=(",", ":"), sort_keys=True).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    blob += b"\x00" * ((4 - len(blob) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    return (
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(js), b"JSON")
        + js
        + struct.pack("<I4s", len(blob), b"BIN\x00")
        + blob
    )


def read(data):
    """Parses a GLB: returns (json document, binary chunk)."""
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or total != len(data):
        raise ValueError("not a glTF 2.0 binary")
    jlen, jtype = struct.unpack_from("<I4s", data, 12)
    if jtype != b"JSON":
        raise ValueError("first chunk is not JSON")
    doc = json.loads(data[20 : 20 + jlen].decode("utf-8"))
    off = 20 + jlen
    binary = b""
    if off < len(data):
        blen, btype = struct.unpack_from("<I4s", data, off)
        if btype != b"BIN\x00":
            raise ValueError("second chunk is not BIN")
        binary = data[off + 8 : off + 8 + blen]
    return doc, binary


def accessor_values(doc, binary, index):
    """Values of an accessor as tuples (floats normalised for normalised integer types)."""
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    fmt, size = {FLOAT: ("f", 4), UNSIGNED_BYTE: ("B", 1), UNSIGNED_SHORT: ("H", 2), UNSIGNED_INT: ("I", 4)}[acc["componentType"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", comps * size)
    out = []
    for i in range(acc["count"]):
        v = struct.unpack_from("<" + fmt * comps, binary, start + i * stride)
        if acc.get("normalized"):
            mx = {UNSIGNED_BYTE: 255.0, UNSIGNED_SHORT: 65535.0}[acc["componentType"]]
            v = tuple(c / mx for c in v)
        out.append(v)
    return out
