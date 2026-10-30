"""
City guard (4 × 4, D-062; D-060, Citizens, civic): a squat watch-house of coursed
stone with dressed quoins and a warm brown tiled roof whose gable faces
the street, a heraldic shield plaque over the door, a short crenellated
tower on the front corner, a timber gallery on posts along the west
wall, a red-and-white striped guard box beside the door, a rack of
halberds on the wall and a brazier on the apron (no smoke anchor: the
guard is not a producer).
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, CANVAS, DYE_BLUE, IRON, PLANK, STONE, STONE_DARK, TERRACOTTA, TIMBER, TIMBER_DARK, TIMBER_LIGHT

#: Warm brown roof tiles: a dark, browned terracotta with a darker ridge.
#: The tower is a shade greyer than the house, still warm.
TOWER = mat("cliff-upper", 1.0)
ROOF = mat("terracotta", 0.74)
RIDGE = mat("terracotta", 0.62)
COALS = mat("terracotta", 1.35)

#: Shield plaque rows from the bottom: (first, last) cell of each row of a 5-wide shield.
SHIELD = ((2, 2), (1, 3), (1, 3), (0, 4), (0, 4), (0, 4))


def shield(f, a, z):
    """A heraldic shield plaque (5 × 6) on a facade: brass rim, blue field with a white pale."""
    for j, (lo, hi) in enumerate(SHIELD):
        for i in range(lo, hi + 1):
            rim = i in (lo, hi) or j in (0, len(SHIELD) - 1)
            f.put(a + i, z + j, BRASS if rim else (CANVAS if i == 2 else DYE_BLUE), out=1)


def brazier(v, x, y, z=1):
    """An iron fire bowl on three legs with glowing coals."""
    for dx, dy in ((0, 0), (2, 0), (1, 2)):
        v.box(x + dx, y + dy, z, x + dx + 1, y + dy + 1, z + 3, IRON)
    v.box(x - 1, y - 1, z + 3, x + 4, y + 4, z + 4, IRON)
    v.box(x, y, z + 4, x + 3, y + 3, z + 5, COALS)


def halberds(f, a, z, n=2, gap=2):
    """A wall rack of halberds: a rail on pegs and tall poles with iron blades and brass spike."""
    for k in range(n):
        x = a + k * gap
        for zz in range(z, z + 8):
            f.put(x, zz, TIMBER_LIGHT, out=1)
        f.put(x, z + 8, IRON, out=1)
        f.put(x + 1, z + 7, IRON, out=1)
        f.put(x, z + 7, IRON, out=1)
        f.put(x, z + 9, BRASS, out=1)
    for i in range(a - 1, a + (n - 1) * gap + 2):
        f.put(i, z + 3, TIMBER_DARK, out=2)


def build(ctx):
    v = ctx.vox()  # 32 × 32
    seed = 83
    P.yard(v, 0, 0, 32, 32, "grass", seed=seed)
    P.yard(v, 4, 20, 29, 32, "paved", seed=seed)
    # The watch-house, gable to the street.
    x0, y0, x1, y1 = 3, 4, 22, 20
    b = D.warm_hall(v, x0, y0, x1, y1, 11, along="y", roof=ROOF, rise=0.85, seed=seed)
    f = b.face("y+")
    P.entrance(f, 9, 2, 4, 6, leaf=TIMBER_DARK, frame=D.SANDSTONE_TRIM, lintel=D.SANDSTONE_TRIM, steps=2)
    shield(f, 9, 9)
    P.casement(f, 4, 4, 2, 3, frame=D.SANDSTONE_TRIM, sill=D.SANDSTONE_TRIM, lintel=D.SANDSTONE_TRIM)
    for a in (7, 14):  # the back
        P.casement(b.face("y-"), a, 4, 2, 3, frame=D.SANDSTONE_TRIM, sill=D.SANDSTONE_TRIM)
    # Tower on the front corner: coursed stone, a corbel course, a crenellated parapet.
    tx0, ty0, tx1, ty1 = 22, 13, 29, 20
    P.plinth(v, tx0, ty0, tx1, ty1, 1, D.SANDSTONE_PLINTH, out=1)
    P.coursed_stone(v, tx0, ty0, tx1, ty1, 1, 18, TOWER, seed)
    P.dressed_quoins(v, tx0, ty0, tx1, ty1, 2, 18, m=D.SANDSTONE_QUOIN)
    Q.string_course(v, tx0, ty0, tx1, ty1, 17, m=D.SANDSTONE_TRIM)
    D.crenellation(v, tx0 - 1, ty0 - 1, tx1 + 1, ty1 + 1, 18, TOWER, merlon=2, gap=2, h=2, cap=D.SANDSTONE_TRIM)
    tf = P.Face(v, "y+", ty1 - 1)
    P.casement(tf, 25, 10, 1, 4, frame=D.SANDSTONE_TRIM, sill=D.SANDSTONE_TRIM, lintel=D.SANDSTONE_TRIM, bars=False)
    P.casement(P.Face(v, "x+", tx1 - 1), 16, 10, 1, 4, frame=D.SANDSTONE_TRIM, sill=D.SANDSTONE_TRIM, lintel=D.SANDSTONE_TRIM, bars=False)
    # Timber gallery along the west wall: floor on brackets and two posts, windows beneath.
    wf = b.face("x-")
    V.balcony(wf, 6, 16, 7, depth=2)
    for a in (6, 15):
        for z in range(2, 7):
            wf.put(a, z, TIMBER, out=2)
    for a in (8, 12):
        P.casement(wf, a, 3, 2, 3, frame=D.SANDSTONE_TRIM, sill=D.SANDSTONE_TRIM, lintel=None)
    # Street furniture: the striped guard box by the door, the halberd rack and the brazier.
    D.guard_box(v, 21, 22, 1, side="y+", w=5, d=4, h=8)
    halberds(f, 15, 2, n=2, gap=2)
    brazier(v, 2, 23, 1)
    P.lamp_post(v, 14, 27)
    P.lamp_post(v, 8, 27)
    P.scatter(v, 0, 0, 32, 32, 0.02, seed=seed, kinds=("pebble", "tuft"))
    v.anchor("door", 11, 22, 0)
    return P.colour_jitter(v, seed=seed)
