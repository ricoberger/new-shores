"""
Candle foundry (4 × 4; D-057 §3, V5): a two-storey house of ashlar and
plaster with a tiled roof and a chimney over the tallow kettle (smoke),
and beside it a tall open shed on posts whose roof rides as high as the
house — under it dipping racks hung with rows of candles and a wax vat;
crates of finished candles, a bench of tapers set out to harden, a lamp
and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

ROOF = mat("terracotta", 0.96)


def build(ctx):
    v = ctx.vox()  # 32 × 32
    seed = 109
    P.yard(v, 0, 0, 32, 32, "paved", seed=seed)
    b = Q.palazzo(v, 2, 3, 15, 22, (7, 6), upper=PLASTER, roof=ROOF, along="y", seed=seed)
    f = b.face("y+")
    P.entrance(f, 6, 2, 3, 5, frame=Q.DRESSED, lintel=Q.DRESSED)
    Q.window(f, 10, 3, 2, 3, hood="key", surround=True)
    Q.window(f, 7, 9, 2, 3, hood="cornice")
    for a in (7, 15):
        Q.window(b.face("x-"), a, 3, 2, 3, hood="key", surround=True)
        Q.window(b.face("x-"), a, 9, 2, 3, hood="cornice")
    P.roof_chimney(v, b.roof, 6, 7, above=3, brick=True, anchor=True)
    # Tall shed: posts and a gabled roof at the house's eave height.
    for x in (16, 23, 29):
        for y in (3, 21):
            v.box(x, y, 1, x + 1, y + 1, 14, TIMBER)
    v.box(16, 3, 13, 30, 4, 14, TIMBER_DARK)
    v.box(16, 21, 13, 30, 22, 14, TIMBER_DARK)
    P.roof(v, 15, 31, 3, 22, 14, "tiles", along="y", m=ROOF, gable=TIMBER_LIGHT, solid=False, seed=seed)
    for y in (6, 11, 16):
        Q.candle_rack(v, 18, 28, y, 1, h=8)
    P.cask(v, 26, 18, 1, h=3, lid=Q.WAX)
    v.box(25, 17, 1, 30, 20, 2, IRON)
    # Yard: crates of candles, tapers hardening on a bench, a lamp, cart.
    for x in (17, 20):
        P.box_crate(v, x, 24, 1, contents=Q.WAX)
    P.bench(v, 2, 25, 1, 6)
    for x in range(3, 8):
        v.set(x, 25, 3, Q.WAX)
    P.lamp_post(v, 14, 27, h=6)
    P.handcart(v, 22, 27, 1, along="x", load=Q.WAX)
    v.anchor("cart", 8, 30, 1)
    _ = TIMBER_DARK
    return P.colour_jitter(v, seed=seed)
