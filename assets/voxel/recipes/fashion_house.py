"""
Fashion house (5 × 7; D-057 §3, V5): a three-storey shop on the
Patrician block — ashlar ground floor, plastered upper storeys, string
courses, cornice, tiled hipped roof with dormers — fronted by a
colonnade with a terrace and balustrade above, striped awnings over the
side windows, mannequins in fine dresses and tables of cloth bolts under
the colonnade, a blue-and-brass sign on the terrace, a delivery yard with crates
and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, CANVAS, DYE_BLUE, TIMBER_LIGHT

WALL = mat("ochre", 1.1)
ROOF = mat("terracotta", 0.92)
DRESSES = (DYE_BLUE, mat("terracotta", 1.1), mat("hemp-mark", 1.3), mat("canvas", 1.0))
CLOTH = (DYE_BLUE, mat("terracotta", 1.2), mat("ochre", 0.9), mat("canvas", 0.95), mat("hemp", 1.1))


def build(ctx):
    v = ctx.vox()  # 40 × 56
    seed = 103
    P.yard(v, 0, 0, 40, 56, "paved", seed=seed)
    P.yard(v, 0, 0, 40, 6, "dirt", seed=seed)
    b = Q.palazzo(v, 4, 8, 36, 34, (8, 6, 6), upper=WALL, roof=ROOF, along="x", hip=True, seed=seed)
    f = b.face("y+")
    P.entrance(f, 18, 2, 4, 7, leaf=DYE_BLUE, frame=Q.DRESSED, lintel=Q.DRESSED, step=None)
    for a in (6, 12, 24, 30):
        Q.window(f, a, 3, 3, 5, hood="cornice", surround=True)
    for a in (7, 13, 19, 25, 31):
        Q.window(f, a, 11, 2, 4, hood="pediment")
        Q.window(f, a, 17, 2, 3, hood="key")
    for side in ("x-", "x+"):
        for a in (12, 20, 28):
            Q.window(b.face(side), a, 4, 2, 4, hood="cornice", surround=True)
            Q.window(b.face(side), a, 11, 2, 4, hood="key")
    for a in (11, 23):
        Q.window(b.face("y-"), a, 11, 2, 4, hood="key")
    # Striped awnings over the side windows.
    for a in (12, 20, 28):
        for k in range(3):
            for i in range(-1, 3):
                c = DYE_BLUE if (a + i) % 2 == 0 else CANVAS
                v.set(3 - k, a + i, 8 - k // 2, c)
                v.set(36 + k, a + i, 8 - k // 2, c)
    P.dormer_on(v, b.roof, 14, 18, "y+", wall=WALL)
    P.dormer_on(v, b.roof, 22, 26, "y+", wall=WALL)
    P.roof_chimney(v, b.roof, 9, 14, above=3, brick=True, pots=2)
    # Colonnade with a terrace and balustrade on top.
    zt = Q.colonnade(v, 4, 36, 40, 1, 8, every=6, size=2)
    v.box(4, 34, zt - 1, 36, 42, zt, Q.DRESSED)
    Q.balustrade(v, [(x, 41) for x in range(4, 36)], zt)
    Q.balustrade(v, [(4, y) for y in range(35, 41)], zt)
    Q.balustrade(v, [(35, y) for y in range(35, 41)], zt)
    # Under the colonnade: mannequins and bolts.
    for i, x in enumerate((6, 11, 27, 32)):
        Q.mannequin(v, x, 36, 1, DRESSES[i])
    v.box(14, 36, 1, 17, 39, 2, TIMBER_LIGHT)
    Q.bolts(v, 24, 36, 2, CLOTH[3:], along="y", length=3)
    v.box(24, 36, 1, 26, 39, 2, TIMBER_LIGHT)
    Q.bolts(v, 14, 36, 2, CLOTH[:2], along="y", length=3)
    for k in range(3):
        v.set(20 + k, 42, zt + 3, DYE_BLUE)
        v.set(20 + k, 42, zt + 4, BRASS if k == 1 else DYE_BLUE)
    v.box(21, 42, zt + 2, 22, 43, zt + 3, BRASS)
    # Delivery yard at the back.
    for x in (4, 8, 12):
        P.box_crate(v, x, 2, 1, contents=CLOTH[(x // 4) % len(CLOTH)])
    P.sacks(v, 18, 2, 1, n=3, m=CANVAS)
    P.lamp_post(v, 2, 46, h=8)
    P.lamp_post(v, 37, 46, h=8)
    P.flower_bed(v, 8, 48, 16, 51, seed=seed)
    P.flower_bed(v, 24, 48, 32, 51, seed=seed + 1)
    P.handcart(v, 28, 1, 1, along="x", load=DYE_BLUE)
    v.anchor("cart", 36, 4, 1)
    return P.colour_jitter(v, seed=seed)
