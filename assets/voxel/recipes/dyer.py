"""
Dyer (4 × 5; D-057 §3): a dye house of coursed stone with a framed upper
storey, red tiles and a vat-fire chimney (smoke), an open vat shed with
three steaming vats of blue, red and yellow dye, and tall drying frames
across the yard hung with long lengths of blue and red cloth that sway;
casks of dye stuff, a rinsing trough and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, DYE_BLUE, OCHRE, PLASTER_WARM, TIMBER, TIMBER_DARK, TIMBER_LIGHT

RED = mat("terracotta", 1.15)
BLUE = mat("dye-blue", 1.0)
BLUE_LIGHT = mat("dye-blue", 1.3)
YELLOW = mat("flower", 0.95)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 109
    P.yard(v, 0, 0, 32, 40, "dirt", seed=seed)
    P.yard(v, 0, 32, 32, 40, "paved", seed=seed)
    # Dye house at the back east.
    b = P.building(v, 16, 2, 30, 14, "citizen", along="x", upper=PLASTER_WARM, seed=seed, spacing=4, height=14)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 18, 2, 3, 5)
    P.barn_gate(f, 23, 2, 4, 5)
    P.casement(F, 19, 10, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=DYE_BLUE)
    P.casement(F, 25, 10, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=DYE_BLUE)
    P.casement(b.face("x-"), 7, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED)
    P.roof_chimney(v, b.roof, 18, 6, above=4, brick=True, anchor=True)
    # Vat shed on the west: posts, tiled roof, three vats.
    P.lean_to(v, 1, 15, 2, 12, 10, "tiles", down="y+", posts=True)
    for k, (cx, liquid) in enumerate(((4, BLUE), (8.5, RED), (13, YELLOW))):
        V.vat(v, cx, 7, 1, r=2.2, h=4, liquid=liquid)
    v.box(2, 2, 1, 15, 3, 3, P.BRICK)  # firing bank behind the vats
    # Drying frames across the yard: blue and red cloth hanging long (sway).
    for y, cloths in ((17, (BLUE, RED, BLUE_LIGHT)), (22, (RED, BLUE, OCHRE)), (27, (BLUE_LIGHT, RED, BLUE))):
        V.drying_frame(v, 2, 26, y, 1, 13, cloths, every=4, drop=9)
    # Casks of dye stuff, rinsing trough, cart.
    P.trough(v, 28, 17, 1, length=8, along="y", water=True)
    for y in (26, 29):
        P.cask(v, 28, y, 1, lid=(BLUE if y == 26 else RED))
    P.sacks(v, 18, 33, 1, n=2, m=CANVAS)
    P.handcart(v, 3, 33, 1, along="x", load=BLUE)
    v.box(25, 33, 1, 30, 35, 3, TIMBER_DARK)
    v.box(26, 33, 3, 29, 35, 4, BLUE_LIGHT)
    v.anchor("cart", 12, 37, 1)
    P.scatter(v, 0, 32, 32, 40, 0.01, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)
