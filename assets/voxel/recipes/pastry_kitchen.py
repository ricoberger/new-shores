"""
Pastry kitchen (4 × 5; D-057 §3): a merchant bakehouse — stone ground
floor, ochre half-timber upper storey, red tiles — with a shop front of
cakes and loaves under a striped awning and a signboard, and outside a
round dome oven of brick with its own flue (smoke), a peel, a woodpile,
flour sacks and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, FLOWER, OCHRE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT

CAKE = mat("ochre", 1.2)
ICING = mat("plaster", 1.12)
BERRY = mat("terracotta", 1.15)
GLOW = mat("flower", 1.0)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 103
    P.yard(v, 0, 0, 32, 40, "grass", seed=seed)
    P.yard(v, 0, 24, 32, 40, "paved", seed=seed)
    b = V.townhouse(v, 12, 8, 30, 22, "x", ground=9, top=17, infill=OCHRE, frame=TIMBER_DARK, roof=mat("terracotta"), rise=1.4, seed=seed, braces=("x-", "x+"))
    f, F = b.face("y+"), b.face("y+", upper=True)
    V.shop_front(f, 13, 3, 8, 4, goods=(CAKE, ICING, BERRY, WHEAT))
    V.face_awning(f, 12, 22, 8, depth=3, stripes=(ICING, BERRY))
    P.entrance(f, 23, 2, 3, 6, leaf=mat("terracotta", 0.75), frame=P.DRESSED, lintel=P.DRESSED, steps=2)
    V.signboard(f, 27, 6, w=2, h=3, colour=CAKE, mark=[(0, 1), (1, 1), (0, 2)])
    for a in (14, 25):
        P.casement(F, a, 11, 2, 4, frame=None, sill=TIMBER_LIGHT, shutters=mat("grass-b", 0.75), box=FLOWER)
    V.oriel(F, 19, 11, 4, 5, depth=1, wall=OCHRE, roof=mat("terracotta"))
    P.casement(b.face("x-"), 14, 3, 2, 4, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.entrance(b.face("x-"), 18, 2, 2, 5, frame=P.DRESSED)
    P.casement(b.face("x-", upper=True), 11, 11, 2, 4, frame=None, sill=TIMBER_LIGHT)
    P.casement(b.face("x-", upper=True), 17, 11, 2, 4, frame=None, sill=TIMBER_LIGHT)
    P.roof_chimney(v, b.roof, 26, 10, above=3, brick=True)
    # Dome oven on the west yard: a stone base, a brick dome, a glowing mouth, a flue.
    v.box(1, 10, 1, 10, 20, 3, STONE_DARK)
    V.dome(v, 5.5, 15, 4.4, 3, m=P.BRICK, finial=None, h=6)
    v.box(4, 19, 3, 7, 21, 6, P.BRICK)
    v.box(5, 20, 3, 6, 21, 5, GLOW)
    v.box(4, 20, 6, 7, 21, 7, P.DRESSED)
    P.chimney_stack(v, 5, 12, 7, 12, brick=True, anchor=True)
    v.box(1, 21, 1, 2, 22, 7, TIMBER_LIGHT)  # the peel leaning by the mouth
    v.box(0, 21, 7, 3, 22, 8, TIMBER_LIGHT)
    P.woodpile(v, 1, 3, 1, length=9, along="x", rows=3)
    # Yard: flour sacks, a table of trays, bench, lamp, cart.
    P.sacks(v, 2, 24, 1, n=3, m=CANVAS)
    v.box(10, 26, 1, 11, 28, 3, TIMBER)
    v.box(16, 26, 1, 17, 28, 3, TIMBER)
    v.box(10, 26, 3, 17, 28, 4, TIMBER_LIGHT)
    for x in range(11, 16, 2):
        v.set(x, 26, 4, CAKE)
        v.set(x + 1, 27, 4, BERRY)
    P.bench(v, 21, 27, length=4)
    P.lamp_post(v, 28, 27)
    P.cask(v, 2, 30, 1, h=3, m=TIMBER)
    P.handcart(v, 20, 33, 1, along="x", load=WHEAT)
    v.anchor("cart", 8, 36, 1)
    P.scatter(v, 0, 0, 32, 24, 0.02, seed=seed)
    return P.colour_jitter(v, seed=seed)
