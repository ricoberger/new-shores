"""
Tree plot (1 × 1 field; D-059/D-060 models; V7): one forest tree per tile —
the island's decor_tree_a–d meshes at their forest scale (the same recipes at
8 voxels per tile, not shrunk to the tile), so a lumberjack's plots read as
a piece of the forest. Six variants chosen per tile by the client's hash,
mixed like the forest: oak and beech (two each) dominate, a birch and a
conifer one in six each. The conifer is first: the far view's patch colour
is taken from variant 0, a dark forest green. The tree stands on the tile
centre with a seeded jitter of up to ±1 voxel (±2 left gaps in the grove); its crown may overhang the
tile by up to half a tile (config.SLACK_OVERRIDE, 4 voxels; the budget
config.BUDGET_OVERRIDE), so neighbours overlap into a canopy. No ground
(grass through) and no dirt disc; a fern at the foot on every third variant.
The birch has one light trunk colour (the decor birch's dark marks dropped).
Field models carry no sway groups, so the crowns are still.
"""

import importlib.util
import os

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat, shade_of

VARIANTS = 6
VOXELS_PER_TILE = 8
SLACK = 4  # the footprint slack (voxels): config.SLACK_OVERRIDE
TILE = 8


def _decor():
    """The decor recipes' module (the tree builders); its file starts with an underscore, so it is not a recipe of an ID."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_decor.py")
    spec = importlib.util.spec_from_file_location("voxrecipe_decor_trees", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Scratch:
    """What the decor builders need of a context: an unbounded grid."""

    def __init__(self, ctx):
        self.vox = lambda *a, **k: ctx.vox(0, 0)


def fern(v, x, y):
    """A low fern: a green cross, two voxels high at the centre."""
    g = mat("forest-floor", 1.25)
    v.set(x, y, 0, g)
    v.set(x, y, 1, shade_of(g, 1.1))
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        v.set(x + dx, y + dy, 0, shade_of(g, 0.95))


#: Variant → decor tree builder (name in _decor.py), with a fern at the foot on every third one.
SPECIES = ("tree_c", "tree_a", "tree_b", "tree_a", "tree_b", "tree_d")
FERN = (False, True, False, False, True, False)


def build(ctx):
    seed = 31 + ctx.variant
    decor = _decor()
    tree = getattr(decor, SPECIES[ctx.variant])(_Scratch(ctx))
    if SPECIES[ctx.variant] == "tree_d":  # one light trunk colour
        bark = mat("canvas", 0.95)
        for c, m in list(tree.cells.items()):
            if m[0] == "iron":
                tree.cells[c] = bark
    (bx0, by0, _), (bx1, by1, _) = tree.bounds()
    # The trunk cell (0, 0) goes to the tile centre (4, 4) plus a seeded jitter, clamped so the crown's
    # extent stays within the tile and the slack.
    ox = 4 + int(hash3(ctx.variant, 1, 3, seed) * 3) - 1
    oy = 4 + int(hash3(ctx.variant, 2, 3, seed) * 3) - 1
    ox = max(-SLACK - bx0, min(TILE + SLACK - bx1, ox))
    oy = max(-SLACK - by0, min(TILE + SLACK - by1, oy))
    v = ctx.vox()  # 8 × 8
    for (x, y, z), m in tree.cells.items():
        v.set(x + ox, y + oy, z, m[:2])  # no sway group: field models do not sway
    if FERN[ctx.variant]:
        fx, fy = ox + (2 if hash3(ctx.variant, 5, 5, seed) < 0.5 else -2), oy + (2 if hash3(ctx.variant, 6, 6, seed) < 0.5 else -2)
        fern(v, fx, fy)
    return P.colour_jitter(v, seed=seed)
