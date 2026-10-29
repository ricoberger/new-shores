"""
Clay pit (4 × 6, on a clay deposit; D-057 §3): an open pit with terraced
banks of cut clay (three steps, a ramp to the yard), a puddle and clay
lumps on its floor, a timber gantry hoist over it with a winch, rope and
bucket; in the yard a drying shed with stacked clay blocks, a tiled
workers' hut, barrows, spades and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import GRASS_B, IRON, TIMBER, TIMBER_DARK, TIMBER_LIGHT

CLAY = mat("terracotta", 1.22)
CLAY_WET = mat("terracotta", 1.02)
CLAY_CUT = mat("ochre", 0.9)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 73
    P.yard(v, 0, 0, 32, 48, "dirt", seed=seed)
    # Pit floor and terraced banks rising to the back and the east (open toward the yard and the west).
    x0, y0, x1, y1 = 0, 6, 24, 30
    for x in range(x0, x1):
        for y in range(y0, y1):
            v.set(x, y, 0, CLAY_WET)
    V.terraces(v, x0, y0, x1, y1, 3, CLAY, edge=CLAY_CUT, seed=seed, open_sides=("y+", "x-"))
    for x in range(0, 32):
        for y in range(0, 30):
            if v.get(x, y, 6) is not None:
                v.set(x, y, 6, GRASS_B)  # sod on the rim
    for x in range(5, 10):
        for y in range(18, 22):
            v.set(x, y, 0, mat("shallows", 0.85))
    for x, y in ((14, 11), (19, 16), (4, 12), (11, 25)):
        v.box(x, y, 1, x + 2, y + 2, 2, CLAY)
    # Gantry hoist over the pit: two A-frames, a beam, a winch, a rope and a bucket.
    for x in (6, 20):
        v.line((x, 10, 1), (x, 14, 15), TIMBER)
        v.line((x, 20, 1), (x, 15, 15), TIMBER)
    v.box(6, 14, 15, 21, 16, 16, TIMBER_DARK)
    v.box(21, 13, 9, 23, 17, 11, TIMBER_LIGHT)  # winch drum
    v.box(21, 12, 1, 22, 13, 11, TIMBER)
    v.box(21, 17, 1, 22, 18, 11, TIMBER)
    for z in range(5, 15):
        v.set(13, 15, z, mat("canvas", 0.85))
    P.cask(v, 12, 14, 2, h=3, m=TIMBER, lid=CLAY)
    v.set(13, 15, 5, IRON)
    # Drying shed with stacked clay blocks.
    P.lean_to(v, 2, 14, 34, 46, 8, "tiles", down="y+", posts=True)
    for x in range(3, 13, 3):
        for y in range(35, 45, 3):
            v.box(x, y, 1, x + 2, y + 2, 3 + (x + y) % 2, CLAY if (x + y) % 2 else CLAY_CUT)
    # Workers' hut: timber frame on stone, tiles, a chimney.
    b = P.building(v, 19, 34, 31, 44, "settler", along="x", seed=seed, spacing=4, kind="tiles", height=9)
    P.entrance(b.face("y+"), 23, 2, 3, 5)
    P.casement(b.face("y+"), 27, 4, 2, 2, frame=None, sill=TIMBER_LIGHT, shutters=TIMBER_LIGHT, bars=False)
    P.casement(b.face("x-"), 38, 4, 2, 2, frame=None, sill=TIMBER_LIGHT, bars=False)
    P.roof_chimney(v, b.roof, 27, 36, above=2)
    P.tool_rack(b.face("x-"), 35, 1, n=2)
    P.handcart(v, 15, 33, 1, along="x", load=CLAY)
    v.anchor("cart", 17, 46, 1)
    P.scatter(v, 0, 0, 32, 48, 0.015, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
