"""
Brewery (5 × 6; D-057 §3): a tall coursed-stone kettle house with red
tiles and a big copper vent hood on its ridge (smoke), its arched door
open on the copper brewing kettle; a framed malt store with a loft hoist;
a cask yard under a long tiled lean-to with casks stacked in tiers; a
dray of barrels, malt sacks, a tankard sign and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, OCHRE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, WHEAT

BEER = mat("ochre", 1.15)


def build(ctx):
    v = ctx.vox()  # 40 × 48
    seed = 151
    P.yard(v, 0, 0, 40, 48, "dirt", seed=seed)
    P.yard(v, 0, 36, 40, 48, "paved", seed=seed)
    # Kettle house: tall stone hall along y, tiles, the copper hood on the ridge.
    x0, x1, y0, y1 = 16, 30, 6, 32
    P.plinth(v, x0, y0, x1, y1)
    P.coursed_stone(v, x0, y0, x1, y1, 1, 15, seed=seed)
    P.dressed_quoins(v, x0, y0, x1, y1, 1, 15)
    r = P.roof(v, x0, x1, y0, y1, 15, "tiles", along="y", rise=1.3, seed=seed, m=mat("terracotta", 0.8))
    top = V.hood(v, 19, 14, 27, 22, r.ridge_z, vent=3)
    v.anchor("chimney", 23, 18, top)
    v.anchor("smoke", 23, 18, top + 1)
    f = P.Face(v, "y+", y1 - 1)
    # Arched door open on the kettle inside.
    for a in range(20, 26):
        for z in range(1, 10):
            f.put(a, z, None)
    v.box(20, y1 - 6, 0, 26, y1, 1, STONE_DARK)
    V.kettle(v, 23, y1 - 3.5, 1, r=2.6, h=4, hearth_h=2)
    v.box(22, y1 - 4, 9, 24, y1 - 3, 15, V.COPPER)  # the kettle's own flue
    for a in range(19, 27):
        f.put(a, 10, P.DRESSED)
    for z in range(1, 10):
        f.put(19, z, P.DRESSED)
        f.put(26, z, P.DRESSED)
    for z in (4, 9):
        P.casement(P.Face(v, "x-", x0), 10, z, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
        P.casement(P.Face(v, "x-", x0), 22, z, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    P.casement(f, 22, 12, 2, 3, frame=P.DRESSED, sill=P.DRESSED)
    V.signboard(f, 27, 8, w=2, h=2, colour=BEER, out=2)
    # Malt store at the back west: framed ochre loft, tiles, hoist.
    b = P.building(v, 2, 2, 15, 12, "citizen", along="x", upper=OCHRE, seed=seed, spacing=4, height=14)
    F = b.face("y+", upper=True)
    P.entrance(F, 7, 9, 2, 4, step=None, hinges=False)
    V.hoist(F, 8, 13, length=2, rope=3, load=CANVAS)
    P.entrance(b.face("y+"), 4, 2, 3, 5)
    P.casement(b.face("x-"), 6, 3, 2, 2, frame=P.DRESSED, sill=P.DRESSED)
    # Cask yard: a long lean-to on the kettle house's west wall, casks in tiers.
    P.lean_to(v, 2, 16, 14, 34, 10, "tiles", down="x-", posts=True)
    for y in range(16, 33, 4):
        for k, (x, z) in enumerate(((3, 1), (6, 1), (9, 1), (12, 1), (4, 4), (7, 4), (10, 4))):
            P.cask(v, x, y, z, h=3, m=TIMBER if (k + y) % 2 else TIMBER_LIGHT, lid=TIMBER_DARK)
    # Dray of barrels, malt sacks, cart.
    v.box(4, 38, 2, 14, 43, 3, TIMBER)
    for x in (4, 13):
        for y in (37, 43):
            v.box(x, y, 1, x + 1, y + 1, 3, IRON)
    for x in (5, 8, 11):
        P.cask(v, x, 39, 3, h=3)
    v.box(14, 40, 2, 18, 41, 3, TIMBER_DARK)  # shafts
    P.sacks(v, 31, 36, 1, n=3, m=CANVAS)
    P.bale(v, 33, 39, 1, w=3, d=2, h=2, m=WHEAT)
    P.lamp_post(v, 29, 41)
    v.anchor("cart", 22, 44, 1)
    P.scatter(v, 0, 0, 40, 36, 0.01, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)
