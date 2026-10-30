"""
Surgery (4 × 6, D-062; D-060, Patricians, civic): an ashlar ground floor
with tall windows under a brick upper storey with white-framed
pedimented windows, string course and cornice, a dark brown tiled gable roof
(no chimney: the surgery does not burn anything), a green-and-white
striped cloth awning over the front (sway group `cloth`), a barber's pole
by the door, a bench, a sign post with a mortar-and-pestle plaque and,
along the west side, a walled herb garden in raised beds with a well.
"""

from nsvoxel import parts as P
from nsvoxel import detail_d060 as D
from nsvoxel import detail_v4 as V
from nsvoxel import detail_v5 as Q
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, PLANK, STONE_DARK, TIMBER, TIMBER_DARK

ROOF = mat("timber", 1.12)
RIDGE = mat("timber", 0.92)
BRICK = mat("terracotta", 0.9)
GREEN = P.cloth(mat("hemp", 1.0))
WHITE = P.cloth(CANVAS)
LEAF = mat("hemp", 0.72)

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
    v = ctx.vox()  # 32 × 48
    seed = 85
    P.yard(v, 0, 0, 32, 48, "grass", seed=seed)
    P.yard(v, 10, 34, 32, 48, "paved", seed=seed)
    x0, y0, x1, y1 = 11, 8, 31, 34
    b = Q.palazzo(v, x0, y0, x1, y1, (8, 7), upper=BRICK, roof=ROOF, ridge=RIDGE, along="x", rise=1.0, seed=seed)
    f = b.face("y+")
    # Tall windows in the ashlar floor, the door between them, white-framed pedimented windows above.
    for a in (14, 26):
        Q.window(f, a, 3, 2, 5, hood="cornice", surround=True)
    P.entrance(f, 19, 2, 3, 6, leaf=LEAF, frame=Q.DRESSED, lintel=Q.DRESSED, step=STONE_DARK)
    for a in (13, 18, 23, 28):
        Q.window(f, a, 11, 2, 4, hood="pediment", frame=CANVAS)
    for side in ("x-", "x+"):
        sf = b.face(side)
        for a in (14, 21, 28):
            Q.window(sf, a, 3, 2, 5, hood="cornice", surround=True)
            Q.window(sf, a, 11, 2, 4, hood="pediment", frame=CANVAS)
    for a in (16, 24):
        Q.window(b.face("y-"), a, 3, 2, 5, hood="cornice", surround=True)
        Q.window(b.face("y-"), a, 11, 2, 4, hood="pediment", frame=CANVAS)
    # The striped cloth awning over the front: it sways.
    V.face_awning(f, 12, 30, 9, depth=4, stripes=(GREEN, WHITE))
    # By the door: the barber's pole, a bench; the sign post at the side.
    D.barber_pole(v, 16, 38, 1, h=11)
    P.bench(v, 22, 41, 1, 5, along="x")
    sign_post(v, 24, 43, 1, arm=6)
    P.lamp_post(v, 11, 45, h=7)
    # The herb garden on the west side: three raised beds, a path between and a well.
    for y in (9, 19, 29):
        P.flower_bed(v, 1, y, 8, y + 7, seed=seed + y)
        v.walls(0, y - 1, 9, y + 8, 1, 2, TIMBER)
    P.well(v, 4, 41)
    P.shrub(v, 1, 40, 1, r=2, seed=seed)
    P.scatter(v, 0, 0, 32, 48, 0.02, seed=seed, kinds=("pebble", "tuft"))
    v.anchor("door", 21, 38, 0)
    return P.colour_jitter(v, seed=seed)
