"""
Printing press (4 × 5; D-057 §3): a long merchant hall (coursed-stone
ground floor, jettied ochre half-timber, red tiles, dormers) whose front
opens in a wide bay on posts round a large timber press — two tall
cheeks, the head, the screw and the bar, the bed with a sheet — with
type cases, stacks of paper and books, a signboard with an open book,
crates of books and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, OCHRE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

PAPER = mat("plaster", 1.12)
BOOK_A = mat("terracotta", 0.9)
BOOK_B = mat("dye-blue", 0.9)
BOOK_C = mat("ochre", 0.8)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 113
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 0, 26, 32, 40, "paved", seed=seed)
    b = V.townhouse(v, 2, 8, 30, 24, "x", ground=10, top=18, infill=OCHRE, frame=TIMBER_DARK, roof=mat("terracotta", 0.9), rise=1.4, seed=seed, braces=("x-", "x+"))
    f, F = b.face("y+"), b.face("y+", upper=True)
    gy = f.plane  # the ground-floor front wall
    # Open front bay: the upper storey carried on posts over a wide, deep opening.
    for x in range(4, 18):
        for y in range(gy - 7, gy + 2):
            for z in range(1, 10):
                v.set(x, y, z, None)
        v.set(x, gy, 9, TIMBER_DARK)
        for y in range(gy - 7, gy + 1):
            v.set(x, y, 0, STONE_DARK if (x + y) % 2 else P.mat("stone", 0.9))
    for x in (3, 10, 17):
        v.box(x, gy, 1, x + 1, gy + 1, 10, TIMBER)
    # The press: cheeks, head, screw, bar, bed with a sheet.
    py = gy - 4
    for x in (6, 12):
        v.box(x, py, 1, x + 1, py + 2, 10, TIMBER_LIGHT)
    v.box(6, py, 8, 13, py + 2, 10, TIMBER_LIGHT)
    v.box(9, py, 6, 10, py + 2, 9, IRON)
    v.box(10, py + 2, 7, 14, py + 3, 8, TIMBER_LIGHT)  # the bar
    v.box(5, py - 1, 3, 14, py + 3, 4, TIMBER)  # bed and carriage
    v.box(7, py, 4, 12, py + 2, 5, PAPER)
    for x in (5, 13):
        v.box(x, py + 2, 1, x + 1, py + 3, 3, TIMBER)
    # Type case and paper stacks in the bay.
    v.box(15, gy - 6, 1, 17, gy - 3, 6, TIMBER)
    for z in (2, 4):
        v.box(14, gy - 6, z, 15, gy - 3, z + 1, TIMBER_LIGHT)
    V.stack(v, 14, gy - 2, 17, gy, 1, 3, PAPER)
    P.entrance(f, 21, 2, 3, 6, frame=P.DRESSED, lintel=P.DRESSED, steps=2)
    P.casement(f, 26, 3, 2, 4, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    V.signboard(f, 21, 9, w=4, h=2, colour=PAPER, mark=[(0, 0), (1, 1), (2, 1), (3, 0)])
    for a in (5, 10, 15, 21, 26):
        P.casement(F, a, 12, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=mat("grass-b", 0.75))
    for side in ("x-",):
        P.casement(b.face(side), 13, 3, 2, 4, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
        P.casement(b.face(side, upper=True), 13, 12, 2, 3, frame=None, sill=TIMBER_LIGHT)
    P.dormer_on(v, b.roof, 8, 12, "y+", wall=OCHRE, h=3)
    P.dormer_on(v, b.roof, 20, 24, "y+", wall=OCHRE, h=3)
    P.roof_chimney(v, b.roof, 26, 12, above=3, brick=True)
    # Front: stacks of books and paper, crates, cart.
    for x, (m, h) in zip((20, 23, 26), ((BOOK_A, 4), (BOOK_B, 3), (BOOK_C, 5))):
        V.stack(v, x, 27, x + 2, 29, 1, h, m, band=PAPER)
    V.stack(v, 2, 27, 5, 29, 1, 4, PAPER)
    P.box_crate(v, 20, 31, 1, contents=BOOK_A)
    P.sacks(v, 26, 31, 1, n=2, m=CANVAS)
    P.lamp_post(v, 18, 27)
    P.handcart(v, 8, 30, 1, along="x", load=PAPER)
    v.anchor("cart", 8, 36, 1)
    P.scatter(v, 0, 0, 32, 8, 0.02, seed=seed)
    return P.colour_jitter(v, seed=seed)
