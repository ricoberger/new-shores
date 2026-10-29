"""
Dye works (5 × 5; D-057 §3): an open vat hall on posts — a long tiled
roof with a raised smoke louvre over four big vats of blue, red, yellow
and indigo dye on a brick firing bank (smoke) — beside a stone dye store
with a framed upper storey, drying frames with long cloths (sway), casks
of woad and madder, a rinsing channel and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, PLASTER, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT

RED = mat("terracotta", 1.15)
BLUE = mat("dye-blue", 1.0)
INDIGO = mat("dye-blue", 0.7)
BLUE_LIGHT = mat("dye-blue", 1.3)
YELLOW = mat("flower", 0.95)


def build(ctx):
    v = ctx.vox()  # 40 × 40
    seed = 139
    P.yard(v, 0, 0, 40, 40, "dirt", seed=seed)
    P.yard(v, 0, 34, 40, 40, "paved", seed=seed)
    # Vat hall: posts, a long gabled tiled roof, a raised louvre (smoke), four vats.
    x0, x1, y0, y1 = 1, 28, 14, 32
    v.box(x0, y0, 0, x1, y1, 1, STONE_DARK)
    for x in range(x0, x1, 9):
        for y in (y0, y1 - 1):
            v.box(x, y, 1, x + 1, y + 1, 14, TIMBER)
    for x in (x1 - 1,):
        for y in (y0, y1 - 1):
            v.box(x, y, 1, x + 1, y + 1, 14, TIMBER)
    for y in (y0, y1 - 1):
        v.box(x0, y, 14, x1, y + 1, 15, TIMBER_DARK)
    r = P.roof(v, x0, x1, y0, y1, 15, "tiles", along="x", rise=0.9, ov=0, seed=seed)
    v.box(9, 21, r.top - 1, 19, 25, r.top + 2, TIMBER_LIGHT)  # louvre
    v.box(8, 20, r.top + 2, 20, 26, r.top + 3, mat("terracotta", 0.85))
    v.anchor("chimney", 14, 23, r.top + 3)
    v.anchor("smoke", 14, 23, r.top + 4)
    v.box(2, 19, 1, x1 - 1, 25, 2, P.BRICK)  # firing bank under the vats
    for k, (cx, liquid) in enumerate(((5, BLUE), (11.5, RED), (18, YELLOW), (24, INDIGO))):
        V.vat(v, cx, 23, 1, r=3, h=6, liquid=liquid)
        # A dyed cloth hauled over the front rim, dripping down the staves.
        x = int(cx) - 1
        v.box(x, 26, 3, x + 2, 27, 8, liquid)
        v.box(x, 25, 6, x + 2, 26, 8, liquid)
    v.box(3, 27, 0, 27, 29, 1, mat("shallows", 0.9))  # rinsing channel in the floor
    # Dye store: stone, framed plaster upper storey, tiles.
    b = P.building(v, 30, 4, 39, 22, "citizen", along="y", upper=PLASTER, seed=seed, spacing=4, height=14)
    P.entrance(b.face("y+"), 33, 2, 3, 5)
    P.casement(b.face("y+", upper=True), 33, 10, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=BLUE)
    # Drying frames with long cloths (sway).
    for y, cloths in ((3, (BLUE, RED, YELLOW, BLUE_LIGHT)), (8, (RED, INDIGO, BLUE, YELLOW))):
        V.drying_frame(v, 1, 29, y, 1, 15, cloths, every=4, drop=10)
    for y in (25, 28, 31):
        P.cask(v, 33, y, 1, lid=(BLUE, RED, INDIGO)[y % 3])
    P.sacks(v, 30, 34, 1, n=3, m=CANVAS)
    P.handcart(v, 3, 35, 1, along="x", load=BLUE)
    v.anchor("cart", 14, 38, 1)
    return P.colour_jitter(v, seed=seed)
