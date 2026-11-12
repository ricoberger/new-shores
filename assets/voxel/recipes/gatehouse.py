"""
Gatehouse (3 × 3, D-077 §6, Citizens, `look: civic`): a squat gate block of
warm sandstone with a tall arched passage on the road axis (through y, six
voxels wide, paved ground under it), a raised iron portcullis in the upper
part of the arch, a crenellated top with two corner bartizans under slate
caps and a banner. A wall stub of the same stone leaves the two opposite
sides (x- and x+) at the height of the wall, so a `city_wall` meets the
gatehouse from both sides and the road passes between. 8 voxels per tile.
"""

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, IRON, TIMBER, TIMBER_DARK, TIMBER_LIGHT

BANNER = mat("dye-blue", 1.1)
ROOF = mat("slate", 0.95)
STUB_H = 9


def build(ctx):
    v = ctx.vox()  # 24 × 24
    seed = 73
    x0, x1, y0, y1, top = 5, 19, 3, 21, 20
    O.ashlar_box(v, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 0, 2, O.ASHLAR_DARK, course=1)
    O.ashlar_box(v, x0, y0, x1, y1, 2, top, O.ASHLAR, course=2)
    # The wall stubs on the x sides (the same thickness as the gate's arms, to the tile edge).
    for a, b in ((0, x0 - 1), (x1 + 1, 24)):
        O.ashlar_box(v, a, 9, b, 15, 0, STUB_H, O.ASHLAR, course=2)
        v.box(a, 9, STUB_H - 1, b, 15, STUB_H, O.CAP)
    # The passage: a stepped arch six wide, eleven high at the crown, through the whole block.
    for i, x in enumerate(range(9, 15)):
        h = (8, 10, 11, 11, 10, 8)[i]
        for y in range(y0 - 1, y1 + 1):
            for z in range(0, h):
                v.set(x, y, z, None)
    for y in (y0 - 1, y1):  # dressed jambs and voussoirs on both faces
        for z in range(0, 9):
            v.set(8, y, z, O.CAP)
            v.set(15, y, z, O.CAP)
        for x in range(9, 15):
            v.set(x, y, (8, 10, 11, 11, 10, 8)[x - 9], O.CAP)
    # The raised portcullis: iron bars hanging in the top of the arch at the front face.
    for x in range(9, 15, 2):
        for z in range(7, 11):
            if (x - 9) // 2 != 1 or z < 10:
                v.set(x, y0 + 1, z, IRON)
    for x in range(9, 15):
        v.set(x, y0 + 1, 8, IRON)
    # The gate road: paved ground through the passage and a little beyond.
    P.path(v, [(x, y) for x in range(9, 15) for y in range(0, 24)], kind="paved")
    O.merlons(v, x0, y0, x1, y1, top, h=2, step=2)
    # Corner bartizans: small round caps on the front corners.
    for bx in (x0 - 1, x1 - 2):
        O.ashlar_box(v, bx, y1 - 1, bx + 3, y1 + 2, 12, top + 3, O.ASHLAR, course=2)
        v.box(bx - 0, y1 - 1, top + 3, bx + 3, y1 + 2, top + 4, O.CAP)
        r = v.hip(bx, bx + 3, y1 - 1, y1 + 2, top + 4, ROOF, ov=0, rise=1.4, ridge=mat("slate", 0.8))
        v.box(bx + 1, y1, r, bx + 2, y1 + 1, r + 2, BRASS)
    v.box(11, 11, top, 13, 12, top + 9, TIMBER_DARK)  # a banner on a pole behind the merlons
    v.box(13, 11, top + 6, 17, 12, top + 9, P.cloth(BANNER, "flag"))
    return P.colour_jitter(v, seed=seed)
