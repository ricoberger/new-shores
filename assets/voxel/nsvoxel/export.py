"""
Voxel grid → GLB through the existing writer (assets/build/nsassets/glb.py)
and the manifest entries the client reads unchanged
(client/src/render/models.ts): vertex colours are palette roles × shade
blended toward the role's shadow tone by the corner's occlusion; cloth
voxels (a sway group) lower the alpha byte like the kit-bashed sails.
"""

import hashlib
import math
import os
import sys

BUILD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "build")
if BUILD_DIR not in sys.path:
    sys.path.insert(0, BUILD_DIR)

from nsassets import glb, palette  # noqa: E402

from . import mesh  # noqa: E402

#: Share of the way to the shadow tone at full occlusion (level 3).
AO_STRENGTH = 0.62
#: Side faces' normals are tilted toward up by this much (normalise(n + k·up)):
#: axis-aligned walls facing away from the sun would otherwise get only the
#: cool sky fill and read as cold grey slabs (the kit models' bevels and
#: curved sails catch some sun). Rotation-safe, unlike a baked sun. Cloth
#: (a sway group) uses the up normal like the kit sails (lit from both sides).
SIDE_TILT = 0.5

_ROLES = None
_SHADOWS = None
PALETTE_SHA = None


def roles():
    global _ROLES, _SHADOWS, PALETTE_SHA
    if _ROLES is None:
        _ROLES, PALETTE_SHA = palette.load()
        _SHADOWS = palette.load_shadows()
    return _ROLES, _SHADOWS


def corner_color(m, level):
    """The colour of a material at an occlusion level (0..3), 0..1 floats."""
    r, s = roles()
    base = r[m[0]]
    sh = s[m[0]]
    k = m[1]
    t = level / 3.0 * AO_STRENGTH
    return tuple(min(1.0, max(0.0, b * k + (d * k - b * k) * t)) for b, d in zip(base, sh))


def to_recipe(p, w, d, scale, offset=(0.0, 0.0, 0.0)):
    """Voxel corner → recipe space (tiles; origin at the footprint's ground centre, z up)."""
    return ((p[0] - w / 2 - offset[0]) * scale, (p[1] - d / 2 - offset[1]) * scale, (p[2] - offset[2]) * scale)


def build_tris(cells, w, d, scale, ao=True, offset=(0.0, 0.0, 0.0)):
    """Triangles (recipe space) with colour keys and sway weights for glb.write."""
    tris = []
    ao_keys = []
    sway = []
    colors = {}
    keys = {}
    groups = {}
    for (x, y, z), m in cells.items():
        if len(m) > 2:
            lo, hi = groups.get(m[2], (math.inf, -math.inf))
            groups[m[2]] = (min(lo, z), max(hi, z + 1))
    any_sway = False
    for corners, m, levels, axis, sign in mesh.triangles(mesh.greedy(cells, ao=ao)):
        pts = [to_recipe(p, w, d, scale, offset) for p in corners]
        if len(m) > 2 or axis == 2:
            normal = (0.0, 0.0, 1.0)
        else:
            k = 1.0 / math.sqrt(1.0 + SIDE_TILT * SIDE_TILT)
            normal = (sign * k if axis == 0 else 0.0, sign * k if axis == 1 else 0.0, SIDE_TILT * k)
        tri_keys = []
        for lv in levels:
            col = tuple(palette.to_byte(c) for c in corner_color(m, lv))
            k = keys.get(col)
            if k is None:
                k = len(keys)
                keys[col] = k
                colors[("v", 0, k)] = tuple(c / 255.0 for c in col)
            tri_keys.append(k)
        tris.append((pts[0], pts[1], pts[2], "v", 0, None, normal))
        ao_keys.append(tuple(tri_keys))
        if len(m) > 2:
            any_sway = True
            lo, hi = groups[m[2]]
            h = hi - lo
            sway.append(tuple(0.3 + 0.7 * math.sin(math.pi * ((c[2] - lo) / h if h else 0.5)) for c in corners))
        else:
            sway.append(None)
    return tris, colors, ao_keys, (sway if any_sway else None)


def bounds_gltf(tris):
    """Bounds of triangles in glTF space (y up)."""
    if not tris:
        return [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
    pts = [glb.to_gltf(p) for t in tris for p in t[:3]]
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    return mn, mx


def _r(v):
    return round(v, 4) + 0.0


def write_model(name, cells, w, d, scale, ao=True, offset=(0.0, 0.0, 0.0)):
    """(GLB bytes, triangle count, glTF bounds) of a grid."""
    tris, colors, ao_keys, sway = build_tris(cells, w, d, scale, ao, offset)
    data = glb.write(name, tris, colors, ao_keys, sway)
    return data, len(tris), bounds_gltf(tris)


def file_info(path, data, n, bounds, budget=None):
    out = {
        "path": path,
        "triangles": n,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "bounds": {"min": [_r(c) for c in bounds[0]], "max": [_r(c) for c in bounds[1]]},
    }
    if budget is not None:
        out["budget"] = budget
    return out


def anchor_gltf(p, w, d, scale, offset=(0.0, 0.0, 0.0)):
    """A voxel-space anchor → glTF manifest anchor."""
    return [_r(c) for c in glb.to_gltf(to_recipe(p, w, d, scale, offset))]
