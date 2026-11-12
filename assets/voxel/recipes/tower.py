"""
Tower (2 × 2, D-077 §6, Citizens, `look: civic`): a square watch tower of
coursed warm sandstone with a slight batter at the foot, arrow slits, a
timber door with a stone arch on the front (y+), a projecting crenellated
gallery on corbels under a pointed slate roof with a brass finial and a
pennant. A wall stub of the same stone runs from the middle of each of the
four sides to the tile edge (stub joins on four sides), so a `city_wall`
line of ghost tiles meets it from any direction. 8 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import BRASS, IRON, SLATE, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WINDOW

BANNER = mat("dye-blue", 1.1)
ROOF = mat("slate", 0.95)
STUB_H = 8


def stubs(v, cx, cy, x0, y0, x1, y1, w, h, sides="nsew"):
    """Wall stubs of w voxels thickness and h height from the block's sides to the footprint edge, with a cap course."""
    lo, hi = cx - w // 2, cx - w // 2 + w
    lo_y, hi_y = cy - w // 2, cy - w // 2 + w
    fw, fd = v.w, v.d
    spans = {"w": (0, lo_y, x0, hi_y), "e": (x1, lo_y, fw, hi_y), "s": (lo, 0, hi, y0), "n": (lo, y1, hi, fd)}
    for side in sides:
        a, b, c, d = spans[side]
        O.ashlar_box(v, a, b, c, d, 0, h, O.ASHLAR, course=2)
        v.box(a, b, h - 1, c, d, h, O.CAP)


def build(ctx):
    v = ctx.vox()  # 16 × 16
    seed = 71
    x0, y0, x1, y1 = 3, 3, 13, 13
    O.ashlar_box(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 0, 3, O.ASHLAR_DARK, course=1)  # the battered foot
    O.ashlar_box(v, x0, y0, x1, y1, 3, 22, O.ASHLAR, course=2)
    stubs(v, 8, 8, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 4, STUB_H)
    # Arrow slits on the three other faces, the door arch on the front.
    for z in (10, 16):
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
            v.set(x, y, 21, O.ASHLAR_DARK)
            v.set(x, y, 22, O.ASHLAR)
    O.merlons(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 23, h=2, step=2)
    # The pointed slate roof on four posts inside the merlons.
    top = v.hip(x0, x1, y0, y1, 25, ROOF, ov=0, rise=1.4, ridge=mat("slate", 0.8))
    for px, py in ((x0 + 1, y0 + 1), (x1 - 2, y0 + 1), (x0 + 1, y1 - 2), (x1 - 2, y1 - 2)):
        v.box(px, py, 23, px + 1, py + 1, 25, TIMBER_DARK)
    v.box(7, 7, top, 9, 9, top + 3, BRASS)
    v.box(8, 7, top + 3, 12, 8, top + 5, P.cloth(BANNER, "flag"))
    return P.colour_jitter(v, seed=seed)
