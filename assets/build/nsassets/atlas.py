"""
Gradient-atlas kits (KayKit): every triangle's UVs lie inside one cell of a
regular grid, and the position inside the cell's vertical gradient is the
light/dark shading the kit relies on. A face is classified by the cell of
its UV centroid (exact: no triangle spans cells) and by the gradient band
(light, mid, dark) of that centroid — no texture pixels are read, so the
result does not depend on the atlas image.
"""

import math

SEP = "@"


def classify(spec, uvs):
    """
    The material name 'Atlas/<swatch>@<band>' of a face with these UVs
    (glTF-imported Blender UVs: v = 0 at the bottom of the image) under a
    KIT_ATLAS_CELLS spec. Band 0 is the top (light) end of the gradient.
    """
    cols, rows = spec["grid"]
    u = sum(p[0] for p in uvs) / len(uvs)
    v = sum(p[1] for p in uvs) / len(uvs)
    # Rows count from the top of the image; Blender's v counts from the bottom.
    y = (1.0 - v) * rows
    col = int(math.floor(u * cols)) % cols
    row = int(math.floor(y)) % rows
    frac = y - math.floor(y)
    bands = len(spec["bands"])
    band = min(bands - 1, int(frac * bands))
    name = spec["cells"].get((col, row), spec["default"])[0]
    return f"Atlas/{name}{SEP}{band}"


def split(material):
    """'Atlas/wood@1' → ('Atlas/wood', 1); other names → (name, None)."""
    if material.startswith("Atlas/") and SEP in material:
        base, band = material.rsplit(SEP, 1)
        if band.isdigit():
            return base, int(band)
    return material, None


def swatch(spec, base):
    """(role, shade) of a swatch name ('Atlas/<name>') under a spec, or None."""
    name = base[len("Atlas/") :]
    for entry in list(spec["cells"].values()) + [spec["default"]]:
        if entry[0] == name:
            return entry[1], entry[2]
    return None


def names(spec):
    """Every swatch name of a spec (sorted, without the Atlas/ prefix)."""
    return sorted({e[0] for e in spec["cells"].values()} | {spec["default"][0]})
