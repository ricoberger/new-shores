"""
Sailmaker (4 × 8; D-057 §3): a long sail loft — coursed-stone ground
floor with a jettied, timber-framed plaster loft, tiles, a loft door with
a hoist and a chimney (smoke); a sail stretched on a frame to be sewn,
canvas bolts, rope coils, a tar pot and a cart. The canvas is rigid
(sway is for sails at sea and flags, LIFE_LAYER §7).
"""

from nsvoxel import parts as P
from nsvoxel.mats import CANVAS, IRON, PLASTER, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SAILCLOTH = P.mat("canvas", 1.06)
ROPE = P.mat("canvas", 0.85)


def build(ctx):
    v = ctx.vox()  # 32 × 64
    seed = 63
    P.yard(v, 0, 0, 32, 64, "dirt", seed=seed)
    P.yard(v, 0, 0, 32, 3, "grass", seed=seed)
    b = P.building(v, 4, 4, 20, 36, "citizen", along="y", upper=PLASTER, seed=seed, spacing=4)
    for side in ("x+", "x-"):
        f, F = b.face(side), b.face(side, upper=True)
        for a in (7, 14, 21, 28):
            P.casement(f, a, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
            P.casement(F, a + 1, 11, 2, 3, frame=None, sill=TIMBER_LIGHT)
    f = b.face("y+")
    P.barn_gate(f, 9, 2, 6, 6)
    P.entrance(b.face("y+", upper=True), 10, 11, 4, 4, step=None, hinges=False)
    v.box(12, 37, 22, 13, 41, 23, TIMBER_DARK)  # hoist beam out of the gable
    v.box(12, 40, 17, 13, 41, 22, IRON)
    P.roof_chimney(v, b.roof, 6, 30, above=3, anchor=True)
    # A sail stretched on a frame in the yard.
    v.box(3, 42, 1, 4, 44, 4, TIMBER)
    v.box(27, 42, 1, 28, 44, 4, TIMBER)
    v.box(3, 52, 1, 4, 54, 4, TIMBER)
    v.box(27, 52, 1, 28, 54, 4, TIMBER)
    v.box(3, 42, 3, 28, 54, 4, TIMBER_LIGHT)
    v.box(4, 43, 3, 27, 53, 4, SAILCLOTH)
    for y in range(45, 53, 3):
        for x in range(5, 26):
            v.set(x, y, 3, P.shade_of(SAILCLOTH, 0.92))
    # Canvas bolts, rope coils, a tar pot, cart.
    for x in (22, 25):
        v.box(x, 38, 1, x + 2, 41, 3, CANVAS)
        v.set(x, 37, 1, TIMBER_LIGHT)
    for x, y in ((24, 6), (24, 10), (27, 8)):
        v.box(x, y, 1, x + 2, y + 2, 2, ROPE)
    v.box(26, 14, 1, 29, 17, 2, STONE)
    v.box(26, 14, 2, 29, 17, 4, IRON)
    P.handcart(v, 4, 58, 1, along="x", load=SAILCLOTH)
    v.anchor("cart", 26, 60, 1)
    P.scatter(v, 0, 0, 32, 64, 0.012, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
