"""
Salt works (4 × 6; D-057 §3): an open boiling house on stone piers with
a dark tile roof and a ridge louvre for the steam, two big flat iron boiling
pans on brick furnaces with fire mouths, a tall brick stack (smoke); a
raised timber brine cistern on legs feeding a trough, a coursed-stone
salt store with red tiles, salt in sacks and moulds, a peat stack and a
cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, IRON, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SALT = mat("foam")
BRINE = mat("shallows", 1.2)
PEAT = mat("timber", 0.7)
GLOW = mat("flower", 1.0)
#: Dark warm tile (no cold slate field, ART_DIRECTION).
ROOF = mat("terracotta", 0.66)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 167
    P.yard(v, 0, 0, 32, 48, "dirt", seed=seed)
    P.yard(v, 0, 38, 32, 48, "paved", seed=seed)
    # Boiling house: stone piers, a dark tile roof with a long louvre, open sides.
    x0, x1, y0, y1 = 2, 24, 8, 30
    for x in (x0, 12, x1 - 1):
        for y in (y0, 19, y1 - 1):
            v.box(x, y, 1, x + 1, y + 1, 11, STONE)
    for y in (y0, y1 - 1):
        v.box(x0, y, 11, x1, y + 1, 12, TIMBER_DARK)
    r = P.roof(v, x0, x1, y0, y1, 12, "tiles", along="y", rise=0.9, ov=1, seed=seed, m=ROOF)
    v.box(10, 10, r.ridge_z, 16, 28, r.ridge_z + 2, TIMBER_LIGHT)
    v.box(9, 9, r.ridge_z + 2, 17, 29, r.ridge_z + 3, mat("terracotta", 0.56))
    # Two boiling pans on brick furnaces, fire mouths to the front and west.
    for py in (10, 20):
        v.box(4, py, 1, 22, py + 8, 3, P.BRICK)
        v.box(4, py, 3, 22, py + 8, 4, IRON)
        v.box(5, py + 1, 3, 21, py + 7, 4, BRINE)
        for x in range(6, 20, 4):
            v.box(x, py + 2, 4, x + 2, py + 6, 5, SALT)  # crystals raked to the edges
        v.box(3, py + 3, 1, 4, py + 5, 2, GLOW)
    P.chimney_stack(v, 26, 12, 1, 27, brick=True, anchor=True)
    v.box(22, 13, 1, 26, 15, 3, P.BRICK)  # flue to the stack
    # Brine cistern on legs and its trough.
    for x in (26, 30):
        for y in (20, 26):
            v.box(x, y, 1, x + 1, y + 1, 7, TIMBER)
    v.box(25, 19, 7, 32, 28, 11, TIMBER)
    for z in (8, 10):
        v.box(25, 19, z, 32, 28, z + 1, IRON)
    v.box(26, 20, 10, 31, 27, 11, BRINE)
    v.box(24, 23, 6, 26, 24, 7, TIMBER_LIGHT)
    # Salt store at the back: stone, tiles.
    b = P.building(v, 2, 0, 24, 7, "stone", along="x", seed=seed, height=7)
    # Moulds of salt, sacks, peat, cart.
    for x in range(3, 15, 3):
        v.box(x, 32, 1, x + 2, 34, 3, TIMBER_LIGHT)
        v.box(x, 32, 3, x + 2, 34, 4, SALT)
    P.sacks(v, 17, 32, 1, n=3, m=mat("plaster", 1.1))
    for k in range(3):
        v.box(26, 31 + k, 1 + k % 2 * 0, 31, 32 + k, 4 - k, PEAT)
    P.handcart(v, 3, 40, 1, along="x", load=SALT)
    P.sacks(v, 24, 40, 1, n=2, m=CANVAS)
    v.anchor("cart", 16, 44, 1)
    P.scatter(v, 0, 0, 32, 38, 0.01, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)
