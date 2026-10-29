"""
Optician (4 × 4; D-057 §3, V5): a fine two-storey shop — an ashlar
ground floor with a wide glazed shop window under a cornice hood,
plastered upper storey with pedimented windows, string course, cornice,
tiled hipped roof with a chimney over the lens-grinding hearth (smoke) —
and a sign of brass spectacles on a wrought bracket; crates of glass
blanks, a grinding wheel by the door, a bench, a lamp and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, IRON, TIMBER_DARK, TIMBER_LIGHT, WINDOW

WALL = mat("plaster", 1.0)
ROOF = mat("terracotta", 0.9)
LENS = mat("shallows", 1.15)


def spectacles(v, x, y, z):
    """A spectacles sign in the x–z plane: two brass rings with lenses and a bridge (9 wide × 4 high)."""
    for ox in (0, 5):
        for i in range(4):
            for j in range(4):
                edge = i in (0, 3) or j in (0, 3)
                if (i, j) in ((0, 0), (0, 3), (3, 0), (3, 3)):
                    continue
                v.set(x + ox + i, y, z + j, BRASS if edge else LENS)
    v.set(x + 4, y, z + 2, BRASS)


def build(ctx):
    v = ctx.vox()  # 32 × 32
    seed = 117
    P.yard(v, 0, 0, 32, 32, "paved", seed=seed)
    b = Q.palazzo(v, 3, 3, 29, 21, (8, 7), upper=WALL, roof=ROOF, along="x", hip=True, seed=seed)
    f = b.face("y+")
    P.entrance(f, 6, 2, 3, 6, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED)
    Q.window(f, 12, 3, 8, 4, hood="cornice", surround=True)
    Q.window(f, 23, 3, 3, 4, hood="cornice", surround=True)
    for a in (6, 13, 20, 24):
        Q.window(f, a, 11, 2, 4, hood="pediment")
    for a in (8, 14):
        Q.window(b.face("x-"), a, 3, 2, 4, hood="key", surround=True)
        Q.window(b.face("x-"), a, 11, 2, 4, hood="pediment")
    P.roof_chimney(v, b.roof, 24, 7, above=3, brick=True, anchor=True)
    # The spectacles sign on a bracket over the shop window.
    v.box(15, 22, 13, 16, 26, 14, IRON)
    v.box(15, 25, 13, 16, 26, 14, IRON)
    spectacles(v, 11, 25, 9)
    # Yard: crates of glass, a grinding wheel, bench, lamp, cart.
    P.box_crate(v, 24, 24, 1, contents=WINDOW)
    P.box_crate(v, 27, 24, 1, contents=LENS)
    Q.wheel(v, 5, 25, 3, 2, "yz", rim=mat("stone", 0.9), spokes=None, hub=IRON)
    v.box(4, 23, 1, 7, 24, 2, TIMBER_LIGHT)
    P.bench(v, 12, 28, 1, 6)
    P.lamp_post(v, 2, 28, h=7)
    P.handcart(v, 22, 28, 1, along="x", load=WINDOW)
    v.anchor("cart", 30, 30, 1)
    return P.colour_jitter(v, seed=seed)
