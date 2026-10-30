"""
Surgery (3 × 3; D-060, Merchants, civic): a plastered house with quoins
and a steep dark red-brown tiled roof, its gable to the street with an
attic window, tall windows in white frames, a green-and-white striped
cloth awning over the front (sway group `cloth`), a barber's pole by the
door, a bench, a raised herb bed and a sign post with a mortar-and-pestle
plaque. No smoke anchor (no chimney: the surgery does not burn anything).
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, OCHRE, PLANK, STONE_DARK, TIMBER, TIMBER_DARK

ROOF = mat("terracotta", 0.62)
RIDGE = mat("terracotta", 0.5)
GREEN = P.cloth(mat("hemp", 1.0))
WHITE = P.cloth(CANVAS)
LEAF = mat("hemp", 0.72)
#: Plastered walls: yellow-ochre limewash, so the white frames and quoins stand out.
WALL = OCHRE

#: The plaque's pixels from the top row (5 × 5): M mortar, P pestle, . board.
PLAQUE = (
    "...P.",
    "..P..",
    "MMMMM",
    ".MMM.",
    "..M..",
)


def plaque(f, a, z):
    """A hanging board with a mortar and pestle in pixels (5 × 5 on a framed plank board)."""
    for i in range(-1, 6):
        for j in range(-1, 6):
            f.put(a + i, z + j, TIMBER if i in (-1, 5) or j in (-1, 5) else PLANK)
    for row, line in enumerate(PLAQUE):
        for col, ch in enumerate(line):
            if ch == "M":
                f.put(a + col, z + 4 - row, IRON, out=1)
            elif ch == "P":
                f.put(a + col, z + 4 - row, TIMBER_DARK, out=1)


def sign_post(v, x, y, z=1, arm=6):
    """A sign post: a post, an arm toward +x with a brace, two chains and the plaque hanging from it."""
    v.box(x, y, z, x + 1, y + 1, z + 11, TIMBER)
    v.box(x, y, z + 10, x + arm, y + 1, z + 11, TIMBER)
    for k in range(2):
        v.set(x + 1 + k, y, z + 9 - k, TIMBER_DARK)  # brace
    a0 = x + 1
    for a in (a0, a0 + 4):
        v.set(a, y, z + 9, IRON)
    plaque(P.Face(v, "y+", y), a0, z + 3)


def build(ctx):
    v = ctx.vox()  # 24 × 24
    seed = 85
    P.yard(v, 0, 0, 24, 24, "grass", seed=seed)
    P.yard(v, 5, 16, 19, 24, "paved", seed=seed)
    x0, y0, x1, y1 = 3, 3, 19, 15
    zt = 12
    P.plinth(v, x0, y0, x1, y1, 1, STONE_DARK, out=1)
    P.fill(v, x0, y0, x1, y1, 1, 2, STONE_DARK)
    P.fill(v, x0, y0, x1, y1, 2, zt, WALL)
    P.dressed_quoins(v, x0, y0, x1, y1, 2, zt)
    Q.string_course(v, x0, y0, x1, y1, 8)
    r = P.roof(v, x0, x1, y0, y1, zt, "tiles", along="y", rise=1.15, m=ROOF, ridge=RIDGE, gable=WALL, seed=seed)
    f = P.Face(v, "y+", y1 - 1)
    # Tall windows in white frames, the door between them, an attic window in the gable.
    for a in (5, 14):
        P.casement(f, a, 3, 2, 4, frame=CANVAS, sill=CANVAS)
    for a in (5, 14):
        P.casement(f, a, 9, 2, 3, frame=CANVAS, sill=CANVAS)
    P.entrance(f, 9, 2, 3, 5, leaf=LEAF, frame=CANVAS, step=STONE_DARK)
    P.casement(f, 10, 15, 2, 2, frame=CANVAS, sill=CANVAS, bars=False)
    for side, spots in (("x-", (6, 11)), ("x+", (6, 11)), ("y-", (7, 12))):
        sf = P.faces_of(v, x0, y0, x1, y1)[side]
        for a in spots:
            P.casement(sf, a, 3, 2, 4, frame=CANVAS, sill=CANVAS)
            P.casement(sf, a, 9, 2, 3, frame=CANVAS, sill=CANVAS)
    # The striped cloth awning over the front: it sways.
    V.face_awning(f, 4, 18, 9, depth=4, stripes=(GREEN, WHITE))
    # By the door: the barber's pole, a bench; the herb bed and the sign post at the sides.
    D.barber_pole(v, 15, 18, 1, h=11)
    P.bench(v, 5, 19, 1, 5, along="x")
    P.flower_bed(v, 0, 5, 3, 15, seed=seed)
    v.walls(0, 4, 3, 16, 1, 2, TIMBER)
    sign_post(v, 17, 20, 1, arm=6)
    P.scatter(v, 0, 0, 24, 24, 0.02, seed=seed, kinds=("pebble", "tuft"))
    v.anchor("door", 10, 17, 0)
    return P.colour_jitter(v, seed=seed)
