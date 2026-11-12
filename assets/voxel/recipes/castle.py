"""
Castle (12 × 12 since D-078 §5, was 8 × 8; D-077 §6, Patricians, `look: civic`;
12 voxels per tile): a
concentric-free square castle of warm sandstone. A curtain wall (a walkway
behind a crenellated parapet) runs round a cobbled inner yard, a round
tower with a slate cone at each corner, a gatehouse in the middle of the
front wall (y+; a tall arch, a portcullis, a drawbridge-less stone ramp)
and a square keep at the back with a hall roof of dark tile, a corner
turret, arrow slits and a banner. The yard is `path()` cobbles inside the
walls; a well, a lean-to stable and a few barrels stand in it. Wall stubs
leave no seam: the castle is a closed 12 × 12 block. Layout coordinates are
relative to the side S and the centre line C, so the plan scales with the
footprint.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import hash3, mat, shade_of
from nsvoxel.mats import BRASS, IRON, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12

ROOF = mat("slate", 0.95)
TILE = mat("tile-dark", 1.0)
RIDGE = mat("tile-dark", 0.72)
BANNER = mat("dye-blue", 1.1)
BANNER2 = mat("terracotta", 1.15)
S = 12 * 12  # the side in voxels
C = S // 2  # the centre line
WALL0, WALL1 = 11, S - 11  # the curtain's outer faces
WALL_H = 22
T = 4  # wall thickness


def curtain(v, seed):
    """Four walls with a walkway and a parapet of merlons on the outer rim."""
    for (a, b, c, d) in ((WALL0, WALL0, WALL1, WALL0 + T), (WALL0, WALL1 - T, WALL1, WALL1), (WALL0, WALL0, WALL0 + T, WALL1), (WALL1 - T, WALL0, WALL1, WALL1)):
        O.ashlar_box(v, a, b, c, d, 0, WALL_H, O.ASHLAR, course=3)
    # Merlons on the outer rim, the inner rim a low parapet.
    for x in range(WALL0, WALL1):
        for y in range(WALL0, WALL1):
            if WALL0 + T <= x < WALL1 - T and WALL0 + T <= y < WALL1 - T:
                continue
            outer = x in (WALL0, WALL1 - 1) or y in (WALL0, WALL1 - 1)
            inner = x in (WALL0 + T - 1, WALL1 - T) or y in (WALL0 + T - 1, WALL1 - T)
            if outer and (x + y) % 6 < 3:
                for z in range(WALL_H, WALL_H + 3):
                    v.set(x, y, z, O.ASHLAR)
                v.set(x, y, WALL_H + 3, O.CAP)
            elif inner and not outer and (x + y) % 6 < 2 and hash3(x, y, 9, seed) < 2:
                v.set(x, y, WALL_H, O.ASHLAR_DARK)
    # Arrow slits in the outer faces.
    for a in range(26, S - 22, 14):
        for z in (11, 12, 13):
            for (x, y) in ((a, WALL0), (a, WALL1 - 1), (WALL0, a), (WALL1 - 1, a)):
                if abs(a - C) > 12 or (x, y) != (a, WALL1 - 1):
                    v.set(x, y, z, mat("window", 0.8))


def corner_tower(v, cx, cy, seed):
    O.disc(v, cx, cy, 10.5, 0, 4, O.ASHLAR_DARK)
    O.disc(v, cx, cy, 9.2, 4, 34, O.ASHLAR)
    for z in range(4, 34):
        if (z - 4) % 3 == 2:
            for x, y in O.cells_in_disc(cx, cy, 9.2, 7.8):
                v.set(x, y, z, O.ASHLAR_DARK)
    O.disc(v, cx, cy, 10.5, 34, 36, O.ASHLAR_DARK)  # the gallery
    for x, y in O.cells_in_disc(cx, cy, 10.5, 9.2):
        if (x + y) % 4 < 2:
            for z in range(36, 39):
                v.set(x, y, z, O.ASHLAR)
            v.set(x, y, 39, O.CAP)
    for k, (dx, dy) in enumerate(((0, -7), (0, 7), (-7, 0), (7, 0))):  # arrow slits
        for z in (18, 19, 20, 26, 27):
            v.set(int(cx + dx), int(cy + dy), z, mat("window", 0.8))
    top = V.cone_roof(v, cx, cy, 10.2, 36, ROOF, rise=1.2)
    v.box(int(cx) - 1, int(cy) - 1, top - 1, int(cx) + 1, int(cy) + 1, top + 3, BRASS)
    return top


def gate(v, seed):
    """The gatehouse in the front wall (y+): a taller block with the arch through it, portcullis, bartizans."""
    x0, x1, y0, y1 = C - 12, C + 12, WALL1 - 10, WALL1 + 3
    O.ashlar_box(v, x0, y0, x1, y1, 0, 34, O.ASHLAR, course=3)
    for i, x in enumerate(range(C - 4, C + 4)):
        h = (11, 14, 16, 17, 17, 16, 14, 11)[i]
        for y in range(y0 - 1, y1 + 1):
            for z in range(0, h):
                v.set(x, y, z, None)
    for y in (y0, y1 - 1):  # dressed jambs and voussoirs
        for z in range(0, 12):
            v.set(C - 5, y, z, O.CAP)
            v.set(C + 4, y, z, O.CAP)
        for i, x in enumerate(range(C - 4, C + 4)):
            v.set(x, y, (11, 14, 16, 17, 17, 16, 14, 11)[i], O.CAP)
    for x in range(C - 4, C + 4, 2):  # the raised portcullis
        for z in range(13, 18):
            v.set(x, y1 - 2, z, IRON)
    for x in range(C - 4, C + 4):
        v.set(x, y1 - 2, 13, IRON)
    O.merlons(v, x0, y0, x1, y1, 34, h=3, step=3)
    for bx in (x0 - 2, x1 - 3):
        O.ashlar_box(v, bx, y1 - 3, bx + 5, y1 + 2, 18, 40, O.ASHLAR, course=3)
        top = v.hip(bx, bx + 5, y1 - 3, y1 + 2, 40, ROOF, ov=0, rise=1.4, ridge=mat("slate", 0.8))
        v.box(bx + 2, y1 - 1, top, bx + 3, y1, top + 3, BRASS)
    P.path(v, [(x, y) for x in range(C - 4, C + 4) for y in range(y1, S)], kind="paved")
    v.box(C - 8, y0 + 7, 34, C - 7, y0 + 8, 45, TIMBER_DARK)  # a banner above the gate
    v.box(C - 7, y0 + 7, 38, C + 1, y0 + 8, 45, P.cloth(BANNER2, "flag"))


#: The keep's x0, x1, y0, y1: at the back (y-), between the back corner towers.
KEEP = (C - 34, C + 34, 14, 54)


def keep(v, seed):
    """The keep at the back: a square block with a hall roof of dark tile, a corner turret, a forebuilding."""
    x0, x1, y0, y1 = KEEP
    O.ashlar_box(v, x0, y0, x1, y1, 0, 5, O.ASHLAR_DARK, course=1)
    O.ashlar_box(v, x0 + 1, y0 + 1, x1 - 1, y1 - 1, 5, 40, O.ASHLAR, course=3)
    for a in range(x0 + 6, x1 - 6, 10):  # windows in two rows on the yard side (y+)
        for z in (14, 28):
            P.casement(P.Face(v, "y+", y1 - 2), a, z, 3, 5, frame=O.CAP, sill=O.CAP, shutters=None, bars=False)
    P.entrance(P.Face(v, "y+", y1 - 2), C - 4, 5, 8, 14, arch=True, frame=O.CAP, leaf=TIMBER)
    r = P.roof(v, x0, x1, y0, y1, 40, "tiles", along="x", rise=0.75, ov=2, gable=O.ASHLAR, m=TILE, ridge=RIDGE, seed=seed)
    # The corner turret and the banner.
    O.disc(v, x0 + 4, y1 - 4, 5.0, 40, 52, O.ASHLAR)
    top = V.cone_roof(v, x0 + 4, y1 - 4, 6.5, 52, ROOF, rise=1.3)
    v.box(x0 + 3, y1 - 5, top - 1, x0 + 5, y1 - 3, top + 3, BRASS)
    v.box(x1 - 12, y0 + 12, 40, x1 - 11, y0 + 13, 58, TIMBER_DARK)
    v.box(x1 - 11, y0 + 12, 51, x1 + 1, y0 + 13, 58, P.cloth(BANNER, "flag"))


def yard(v, seed):
    """Cobbles inside the walls (declared ground), a well, a lean-to stable and barrels."""
    kx0, kx1, ky0, ky1 = KEEP
    P.path(v, [(x, y) for x in range(WALL0 + T, WALL1 - T) for y in range(WALL0 + T, WALL1 - T) if not (kx0 <= x < kx1 and ky0 <= y < ky1)], kind="paved")
    # A well in the yard, west of the gate's lane.
    wx, wy = 42.0, 84.0
    O.ring(v, wx, wy, 4.5, 2.6, 0, 4, O.ASHLAR)
    O.disc(v, wx, wy, 2.6, 0, 2, mat("shallows", 0.8))
    for y in (int(wy) - 3, int(wy) + 2):
        v.box(int(wx) - 4, y, 4, int(wx) - 3, y + 1, 14, TIMBER)
        v.box(int(wx) + 3, y, 4, int(wx) + 4, y + 1, 14, TIMBER)
    v.box(int(wx) - 4, int(wy) - 3, 14, int(wx) + 4, int(wy) + 4, 15, TIMBER_DARK)
    P.roof(v, int(wx) - 5, int(wx) + 5, int(wy) - 4, int(wy) + 5, 15, "thatch", along="x", rise=0.9, ov=0, gable=TIMBER, seed=seed)
    # The lean-to stable along the east wall, barrels by the keep.
    sx0, sx1 = WALL1 - T - 9, WALL1 - T - 1
    v.box(sx0, 64, 0, sx1, 104, 1, mat("timber", 1.3))
    P.lean_to(v, sx0, sx1, 64, 104, 11, kind="tiles", down="x-", ov=0, m=TILE, posts=True)
    for i, (x, y) in enumerate(((kx1 - 8, ky1 + 6), (kx1 - 5, ky1 + 6), (kx1 - 8, ky1 + 9), (kx1 - 2, ky1 + 8))):
        P.cask(v, x, y, 0, h=4)
    P.box_crate(v, 18, 108, 0, s=4)
    P.box_crate(v, 23, 108, 0, s=4)
    P.box_crate(v, 20, 108, 4, s=3)


def build(ctx):
    v = ctx.vox()  # S × S
    seed = 97
    curtain(v, seed)
    for cx, cy in ((float(WALL0), float(WALL0)), (float(WALL1), float(WALL0)), (float(WALL0), float(WALL1)), (float(WALL1), float(WALL1))):
        corner_tower(v, cx, cy, seed)
    gate(v, seed)
    keep(v, seed)
    yard(v, seed)
    v.anchor("door", C, WALL1 - 3, 0)
    return P.colour_jitter(v, seed=seed)
