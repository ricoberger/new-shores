"""
Goldsmith (4 × 4; D-057 §3, V5): a fine two-storey shop in deep ochre —
ashlar ground floor with arched shop openings behind iron grilles,
plastered upper storey with balconied windows, cornice, a dark tiled hipped
roof with a brass finial and a forge chimney (smoke) — a hanging sign of
a gold ring on a wrought bracket, a striped awning over the door, a
strongbox, a bench, a lamp and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, CANVAS, DYE_BLUE, IRON, TIMBER_DARK

WALL = mat("ochre", 0.98)
ROOF = mat("terracotta", 0.66)  # dark terracotta


def ring(v, x, y, z, r=3):
    """A gold ring sign in the x–z plane (outer radius r) with a set stone on top."""
    for i in range(-r, r + 1):
        for j in range(-r, r + 1):
            d = (i * i + j * j) ** 0.5
            if r - 1.2 <= d <= r + 0.3:
                v.set(x + i, y, z + j, Q.GOLD)
    v.set(x, y, z + r + 1, DYE_BLUE)


def build(ctx):
    v = ctx.vox()  # 32 × 32
    seed = 119
    P.yard(v, 0, 0, 32, 32, "paved", seed=seed)
    b = Q.palazzo(v, 3, 3, 29, 21, (8, 7), upper=WALL, roof=ROOF, along="x", hip=True, seed=seed)
    Q.finial(v, 16, 12, b.top, BRASS, h=3)
    f = b.face("y+")
    P.entrance(f, 14, 2, 3, 6, leaf=TIMBER_DARK, frame=Q.DRESSED, lintel=Q.DRESSED, knob=BRASS)
    for a in (6, 22):
        Q.window(f, a, 3, 4, 4, hood="key", surround=True)
        Q.grille(f, a, 3, 4, 4)
    for a in (6, 11, 20, 25):
        Q.window(f, a, 11, 2, 4, hood="cornice")
    Q.balustrade(v, [(x, 21) for x in range(10, 23)], 10)
    for a in (8, 14):
        Q.window(b.face("x-"), a, 3, 2, 4, hood="key", surround=True)
        Q.grille(b.face("x-"), a, 3, 2, 4)
        Q.window(b.face("x-"), a, 11, 2, 4, hood="cornice")
    P.roof_chimney(v, b.roof, 24, 7, above=3, brick=True, anchor=True)
    # Striped awning over the door.
    for k in range(3):
        for x in range(13, 18):
            v.set(x, 21 + k, 8 - k // 2, DYE_BLUE if x % 2 else CANVAS)
    # The ring sign on a bracket.
    v.box(25, 21, 13, 26, 26, 14, IRON)
    ring(v, 25, 25, 9)
    # Strongbox, bench, lamp, cart.
    v.box(5, 23, 1, 9, 26, 3, TIMBER_DARK)
    v.box(5, 23, 3, 9, 26, 4, IRON)
    v.set(7, 26, 2, BRASS)
    P.bench(v, 10, 28, 1, 6)
    P.lamp_post(v, 2, 28, h=7)
    P.lamp_post(v, 29, 28, h=7)
    P.handcart(v, 18, 28, 1, along="x", load=Q.GOLD)
    v.anchor("cart", 26, 30, 1)
    return P.colour_jitter(v, seed=seed)
