"""Shared fixtures of the asset build tests (stdlib unittest; no bpy)."""

import os
import sys

BUILD_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BUILD_DIR not in sys.path:
    sys.path.insert(0, BUILD_DIR)

from nsassets import content, kits, palette, schema  # noqa: E402

ROLES, PALETTE_SHA = palette.load()
CONTENT = content.load()
SCHEMA = schema.load()
KIT_FILES = kits.kit_files(kits.load_manifest())

#: A Medieval kit piece (the fake loader returns MI_Plaster cubes). The
#: restyled recipes no longer use that kit, so the piece is added to the
#: pinned files the tests check recipes against.
A_KIT_FILE = ("medieval", "glTF/DoorFrame_Flat_WoodDark.gltf")
KIT_FILES.setdefault(A_KIT_FILE, "0" * 64)


def unit_box(n_parts=1, size=(1.8, 1.8, 0.5), role="plaster"):
    return [{"prim": "box", "size": list(size), "role": role, "name": f"body{i}"} for i in range(n_parts)]


def fake_loader(tris_per_file=None):
    """A kit loader without Blender: every kit piece is a 1 m cube (12 triangles, material MI_Plaster)."""
    from nsassets import geometry

    def load(kit, rel, simplify):
        return [(a, b, c, "MI_Plaster") for a, b, c in geometry.box((1.0, 1.0, 1.0))]

    return load
