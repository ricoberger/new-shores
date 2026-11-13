"""
Tower (2 × 2, D-077 §6, Patricians since D-078 §2, `look: civic`; four
tiles of masonry, D-078 §6: 32 voxels to the merlons' cap, the roof
above): a square watch tower of coursed warm sandstone with a slight batter at the foot, arrow slits, a
timber door with a stone arch on the front (y+), a projecting crenellated
gallery on corbels under a pointed slate roof with a brass finial and a
pennant. Wall stubs of the same stone, as thick as the city wall (4
voxels) and as high (16), run from the foot to the footprint edge on the centre line of
each edge tile (two per side, voxels 2..6 and 10..14: the line a
`city_wall` tile's pieces run on, ART_DIRECTION §7), so a wall meets the
tower from any side. 8 voxels per tile.

One recipe, two IDs (D-078 §4): `harbour_tower` (2 × 2 shore, Patricians)
is the same tower raised one voxel onto the stone quay plinth of the
harbour buildings (parts_d078.plinth: slabs, capping, a dressed side
face into the water, mooring posts on the three water edges) — no
beacon, no light.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel import parts_d078 as Q
from nsvoxel import grid
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, IRON, SLATE, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WINDOW

BANNER = mat("dye-blue", 1.1)
ROOF = mat("slate", 0.95)
STUB_H = 16
#: The shaft's top (the gallery's floor course is at SHAFT - 1); masonry top SHAFT + 4 = 32 voxels, four tiles.
SHAFT = 28


def stubs(v, centres, x0, y0, x1, y1, w, h, sides="nsew"):
    """Wall stubs of w voxels thickness and h height from the block's sides to the footprint edge on each centre line, with a cap course."""
    fw, fd = v.w, v.d
    for c in centres:
        lo, hi = c - w // 2, c - w // 2 + w
        spans = {"w": (0, lo, x0, hi), "e": (x1, lo, fw, hi), "s": (lo, 0, hi, y0), "n": (lo, y1, hi, fd)}
        for side in sides:
            a, b, cc, d = spans[side]
            O.ashlar_box(v, a, b, cc, d, 0, h, O.ASHLAR, course=2)
            v.box(a, b, h - 1, cc, d, h, O.CAP)


def tower(v):
    """The tower standing on z = 0 of v."""
    x0, y0, x1, y1 = 3, 3, 13, 13
    O.ashlar_box(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 0, 3, O.ASHLAR_DARK, course=1)  # the battered foot
    O.ashlar_box(v, x0, y0, x1, y1, 3, SHAFT, O.ASHLAR, course=2)
    stubs(v, (4, 12), x0 - 1, y0 - 1, x1 + 1, y1 + 1, 4, STUB_H)
    # Arrow slits on the three other faces, the door arch on the front.
    for z in (10, 17, 22):
        for x in (7, 8):
            v.set(x, y0, z, mat("window", 0.8))
            v.set(x, y0, z + 1, mat("window", 0.8))
        for y in (7, 8):
            v.set(x0, y, z, mat("window", 0.8))
            v.set(x1 - 1, y, z, mat("window", 0.8))
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 6, 3, 4, 7, arch=True, frame=O.CAP, leaf=TIMBER)
    # The gallery on corbels: a one-voxel ring wider than the shaft, merlons above.
    for x in range(x0 - 1, x1 + 1):
        for y in range(y0 - 1, y1 + 1):
            v.set(x, y, SHAFT - 1, O.ASHLAR_DARK)
            v.set(x, y, SHAFT, O.ASHLAR)
    O.merlons(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, SHAFT + 1, h=2, step=2)
    # The pointed slate roof on four posts inside the merlons.
    top = v.hip(x0, x1, y0, y1, SHAFT + 3, ROOF, ov=0, rise=1.4, ridge=mat("slate", 0.8))
    for px, py in ((x0 + 1, y0 + 1), (x1 - 2, y0 + 1), (x0 + 1, y1 - 2), (x1 - 2, y1 - 2)):
        v.box(px, py, SHAFT + 1, px + 1, py + 1, SHAFT + 3, TIMBER_DARK)
    v.box(7, 7, top, 9, 9, top + 3, BRASS)
    v.box(8, 7, top + 3, 12, 8, top + 5, P.cloth(BANNER, "flag"))


def build(ctx):
    v = ctx.vox()  # 16 × 16
    tower(v)
    return P.colour_jitter(v, seed=71)


def build_harbour(ctx):
    v = ctx.vox()  # 16 × 16
    Q.plinth(v, 0, 0, v.w, v.d, vpt=8, seed=79)
    t = grid.Vox(v.w, v.d, v.name)
    tower(t)
    for (x, y, z), m in t.cells.items():
        v.set(x, y, z + 1, m)
    return P.colour_jitter(v, seed=79)


#: The two IDs of the recipe (model.recipe_modules: a RECIPES dict instead of build()).
RECIPES = {
    "tower": {"build": build},
    "harbour_tower": {"build": build_harbour},
}
