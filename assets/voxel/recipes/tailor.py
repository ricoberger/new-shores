"""
Tailor (4 × 5; D-057 §3): a two-storey merchant shop (coursed-stone
ground floor, jettied plaster half-timber, brown tiles) with wide shop
windows full of cloth bolts in blue, red, green and ochre, a large
signboard with a pair of shears and a jettied gable to the street with
an oriel; a lean-to cutting shed on the west with a table of cloth, a
clothes line, crates of bolts and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, DYE_BLUE, FLOWER, IRON, OCHRE, PLASTER, TIMBER, TIMBER_LIGHT

RED = mat("terracotta", 1.15)
GREEN = mat("grass-b", 0.8)
FRAME = mat("terracotta", 0.6)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 107
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 0, 26, 32, 40, "paved", seed=seed)
    b = V.townhouse(v, 12, 6, 30, 24, "y", ground=10, top=19, infill=PLASTER, frame=FRAME, roof=mat("terracotta", 0.8), rise=1.5, seed=seed)
    f, F = b.face("y+"), b.face("y+", upper=True)
    V.shop_front(f, 13, 3, 6, 5, goods=(DYE_BLUE, RED, GREEN, OCHRE, CANVAS))
    P.entrance(f, 20, 2, 3, 6, leaf=DYE_BLUE, frame=P.DRESSED, lintel=P.DRESSED, steps=2)
    V.shop_front(f, 24, 3, 4, 5, goods=(RED, OCHRE, DYE_BLUE))
    # The large signboard across the jetty with shears.
    V.signboard(f, 15, 8, w=10, h=2, colour=DYE_BLUE, mark=[(1, 0), (2, 1), (3, 0), (5, 0), (6, 1), (7, 0)], out=2)
    v.set(20, 26, 9, IRON)
    v.set(19, 26, 9, IRON)
    V.oriel(F, 18, 12, 5, 6, depth=2, wall=PLASTER, frame=FRAME, roof=mat("terracotta", 0.8))
    for a in (14, 25):
        P.casement(F, a, 13, 2, 4, frame=None, sill=TIMBER_LIGHT, shutters=DYE_BLUE, box=FLOWER)
    G = P.Face(v, "y+", b.roof.y1 - 1)
    P.casement(G, 20, 21, 2, 3, frame=None, sill=TIMBER_LIGHT, bars=False)
    for a in (9, 15, 20):
        P.casement(b.face("x-", upper=True), a, 13, 2, 4, frame=None, sill=TIMBER_LIGHT, shutters=DYE_BLUE)
    V.shop_front(b.face("x-"), 15, 3, 5, 4, goods=(GREEN, CANVAS, RED))
    P.roof_chimney(v, b.roof, 26, 10, above=3, brick=True)
    # Cutting shed on the west: posts, tiled lean-to, a long table with cloth.
    P.lean_to(v, 2, 11, 8, 22, 9, "tiles", down="x-", m=mat("terracotta", 0.8), posts=True)
    v.box(3, 11, 1, 10, 19, 3, TIMBER)
    v.box(3, 11, 3, 10, 19, 4, TIMBER_LIGHT)
    v.box(4, 12, 4, 9, 14, 5, RED)
    v.box(5, 15, 4, 9, 18, 5, DYE_BLUE)
    for y in (12, 16):
        v.box(2, y, 1, 3, y + 2, 5, (GREEN, OCHRE)[y % 2])  # bolts standing on end
    P.washing_line(v, 2, 10, 4, 7, [DYE_BLUE, RED, CANVAS, GREEN])
    # Front: crates of bolts, a bench, the cart.
    for x in (2, 6):
        P.box_crate(v, x, 25, 1, contents=(DYE_BLUE if x == 2 else RED))
    P.bench(v, 26, 28, length=4)
    P.lamp_post(v, 11, 28)
    P.handcart(v, 16, 31, 1, along="x", load=CANVAS)
    v.anchor("cart", 6, 36, 1)
    P.scatter(v, 0, 0, 32, 24, 0.02, seed=seed)
    return P.colour_jitter(v, seed=seed)
