"""Shared fixtures of the asset build tests (stdlib unittest; no bpy)."""

import os
import sys

BUILD_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BUILD_DIR not in sys.path:
    sys.path.insert(0, BUILD_DIR)

from nsassets import content, kits, palette, schema  # noqa: E402

ROLES, PALETTE_SHA = palette.load()
#: The content the build reads: config.CONTENT_DIR or NEW_SHORES_CONTENT_DIR
#: (committed recipes and models are checked against it).
LIVE_CONTENT = content.load()
#: Footprints the synthetic test recipes are drawn for (a 1.8-tile box fills
#: a 2 × 2 chapel), pinned so that pipeline tests do not follow balance data.
TEST_FOOTPRINTS = {"chapel": [2, 2], "house_settlers": [2, 2], "sailmaker": [2, 2], "sawmill": [2, 2], "wheat_field": [1, 1]}


def pinned(c, footprints):
    """A copy of content c with the given building footprints."""
    out = {"buildings": {k: dict(v) for k, v in c["buildings"].items()}, "ships": c["ships"]}
    for cid, fp in footprints.items():
        out["buildings"][cid]["footprint"] = list(fp)
    return out


#: The content of the pipeline unit tests (LIVE_CONTENT with TEST_FOOTPRINTS).
CONTENT = pinned(LIVE_CONTENT, TEST_FOOTPRINTS)
SCHEMA = schema.load()
KIT_FILES = kits.kit_files(kits.load_manifest())

#: A pinned KayKit piece (the fake loader returns cubes in the atlas's white cell).
A_KIT_FILE = ("kaykit_hexagon", "Assets/gltf/decoration/props/barrel.gltf")
#: The material of every fake kit triangle: the hexagon atlas's white cell, middle band (plaster × 1.0).
FAKE_MATERIAL = "Atlas/white@1"


def unit_box(n_parts=1, size=(1.8, 1.8, 0.5), role="plaster"):
    return [{"prim": "box", "size": list(size), "role": role, "name": f"body{i}"} for i in range(n_parts)]


def fake_loader(tris_per_file=None):
    """A kit loader without Blender: every kit piece is a 1-unit cube (12 triangles, material FAKE_MATERIAL)."""
    from nsassets import geometry

    def load(kit, rel, simplify):
        return [(a, b, c, FAKE_MATERIAL) for a, b, c in geometry.box((1.0, 1.0, 1.0))]

    return load
