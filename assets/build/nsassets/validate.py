"""Model validation: footprint fit, ship length, ground contact, triangle budgets, palette colours and the export profile."""

from . import config, glb
from .palette import shaded, to_byte


def _worst_parts(mesh, axis, beyond, upper):
    """Labels of the parts reaching furthest past a bound on an axis (recipe space)."""
    worst = {}
    for t in mesh.tris:
        for p in t[:3]:
            d = (p[axis] - beyond) if upper else (beyond - p[axis])
            if d > 1e-9:
                worst[t[5]] = max(worst.get(t[5], 0.0), d)
    return ", ".join(f"{k} (+{v:.2f})" for k, v in sorted(worst.items(), key=lambda kv: -kv[1])[:3])


def footprint_fit(mesh, w, h, tol=config.FOOTPRINT_TOLERANCE):
    """
    Problems of a building or field model against its footprint (w along x,
    h along y in recipe space): the XY bounds must lie inside the footprint
    grown by tol and cover the footprint shrunk by tol (lite models too).
    """
    out = []
    mn, mx = mesh.bounds()
    for axis, size, name in ((0, w, "x"), (1, h, "y")):
        half = size / 2
        if mx[axis] > half + tol + 1e-9:
            out.append(f"{name} max {mx[axis]:.3f} > allowed {half + tol:.3f} (footprint {w}×{h} + {tol}); parts: {_worst_parts(mesh, axis, half + tol, True)}")
        if mn[axis] < -half - tol - 1e-9:
            out.append(f"{name} min {mn[axis]:.3f} < allowed {-half - tol:.3f} (footprint {w}×{h} + {tol}); parts: {_worst_parts(mesh, axis, -half - tol, False)}")
        if mx[axis] < half - tol - 1e-9:
            out.append(f"{name} max {mx[axis]:.3f} < required {half - tol:.3f} (must cover footprint {w}×{h} − {tol})")
        if mn[axis] > -half + tol + 1e-9:
            out.append(f"{name} min {mn[axis]:.3f} > required {-half + tol:.3f} (must cover footprint {w}×{h} − {tol})")
    return out


def ground_contact(mesh, rng=config.GROUND_RANGE):
    mn, _ = mesh.bounds()
    if not rng[0] <= mn[2] <= rng[1]:
        return [f"lowest point z {mn[2]:.3f} outside the ground band [{rng[0]}, {rng[1]}]"]
    return []


def ship_length(mesh, length, tol=config.SHIP_LENGTH_TOLERANCE):
    mn, mx = mesh.bounds()
    measured = mx[0] - mn[0]
    if abs(measured - length) > tol + 1e-9:
        return [f"length {measured:.3f} tiles, allowed {length} ± {tol}"]
    return []


def budget(mesh, limit, file):
    n = len(mesh)
    if n <= limit:
        return []
    parts = sorted(mesh.labels().items(), key=lambda kv: -kv[1])[:4]
    return [f"{file}: {n} triangles > budget {limit}; largest parts: " + ", ".join(f"{k} {v}" for k, v in parts)]


def palette_check(mesh, roles, declared, file, tol=config.COLOR_TOLERANCE):
    """
    Every triangle's colour must be palette[role] × shade for a declared
    (role, shade) pair, without clamping, within tol per channel after the
    byte quantisation. Returns problems naming the part and the colour.
    """
    allowed = {}
    for role, shade in declared:
        allowed[(role, shade)] = tuple(c * shade for c in roles[role])
    out = []
    seen = set()
    for t in mesh.tris:
        key = (t[3], t[4])
        if key in seen:
            continue
        seen.add(key)
        if key not in allowed:
            out.append(f"{file}: {t[5]}: colour of undeclared role/shade {key}")
            continue
        exact = allowed[key]
        got = tuple(to_byte(c) / 255.0 for c in shaded(roles[key[0]], key[1]))
        if any(abs(g - e) > tol for g, e in zip(got, exact)):
            hexc = "#" + "".join(f"{to_byte(c):02X}" for c in got)
            out.append(f"{file}: {t[5]}: colour {hexc} is not palette {key[0]} × {key[1]} (channel above 1 clamped)")
    return out


def export_profile(data, file):
    """Problems of a GLB against the export profile (inspects the JSON chunk and the colour values)."""
    out = []
    try:
        doc, _ = glb.read(data)
    except (ValueError, KeyError) as e:
        return [f"{file}: unreadable GLB: {e}"]
    if len(doc.get("meshes", [])) != 1:
        out.append(f"{file}: {len(doc.get('meshes', []))} meshes, expected 1")
    else:
        prims = doc["meshes"][0]["primitives"]
        if len(prims) != 1:
            out.append(f"{file}: {len(prims)} primitives, expected 1")
        for p in prims:
            if p.get("mode", 4) != 4:
                out.append(f"{file}: primitive mode {p.get('mode')} is not TRIANGLES")
            attrs = sorted(p.get("attributes", {}))
            if attrs != ["COLOR_0", "NORMAL", "POSITION"]:
                out.append(f"{file}: attributes {attrs}, expected COLOR_0, NORMAL, POSITION")
            if "indices" in p:
                ct = doc["accessors"][p["indices"]]["componentType"]
                if ct not in (glb.UNSIGNED_SHORT, glb.UNSIGNED_INT):
                    out.append(f"{file}: index type {ct} is not UNSIGNED_SHORT/INT")
            if "targets" in p:
                out.append(f"{file}: morph targets")
    if len(doc.get("materials", [])) != 1:
        out.append(f"{file}: {len(doc.get('materials', []))} materials, expected 1")
    for key in ("textures", "images", "samplers", "animations", "skins", "cameras", "extensionsUsed", "extensionsRequired"):
        if doc.get(key):
            out.append(f"{file}: has {key}")
    for i, node in enumerate(doc.get("nodes", [])):
        if any(k in node for k in ("matrix", "translation", "rotation", "scale")):
            out.append(f"{file}: node {i} has a transform (expected identity)")
        if "children" in node:
            out.append(f"{file}: node {i} has children")
    return out
