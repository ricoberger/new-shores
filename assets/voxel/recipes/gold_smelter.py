"""
Gold smelter (4 × 6; D-057 §3, V5): the tier-2 smelter's battered blast
furnace with its sooty stack (smoke) and glowing mouth, and beside it a
strongroom of dressed ashlar — cornice, a low hipped roof with a brass
finial, an iron-banded door, barred windows — behind a paling with a
guard's lamp; crucibles, a chest of gold bars at the door, charcoal, a
sentry bench and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, IRON, TIMBER_DARK

ROOF = mat("terracotta", 0.78)
SOOT = mat("iron", 0.9)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 115
    P.yard(v, 0, 0, 32, 48, "dirt", seed=seed)
    P.yard(v, 18, 22, 32, 44, "paved", seed=seed)
    Q.furnace(v, 3, 3, size=14, tiers=4, step=4, seed=seed)
    # Strongroom.
    x0, y0, x1, y1 = 20, 4, 31, 20
    P.plinth(v, x0, y0, x1, y1, 1, mat("stone", 0.84), out=1)
    Q.ashlar(v, x0, y0, x1, y1, 1, 12)
    Q.cornice(v, x0, y0, x1, y1, 12)
    r = P.roof(v, x0, x1, y0, y1, 13, "tiles", hip=True, m=ROOF, seed=seed, eaves=False)
    Q.finial(v, (x0 + x1) // 2, (y0 + y1) // 2, r.top, BRASS, h=3)
    f = P.Face(v, "y+", y1 - 1)
    P.entrance(f, 24, 2, 3, 6, leaf=IRON, frame=Q.DRESSED, lintel=Q.DRESSED, knob=BRASS)
    for a in (7, 13):
        ff = P.Face(v, "x-", x0)
        P.casement(ff, a, 6, 2, 3, frame=Q.DRESSED, sill=Q.DRESSED, bars=False)
        Q.grille(ff, a, 6, 2, 3)
    P.fence_ring(v, 18, 2, 32, 24, kind="picket", gaps={(x, 23) for x in range(23, 27)}, seed=seed)
    P.lamp_post(v, 19, 25, h=7)
    # Chest of gold bars, crucibles, charcoal, bench.
    v.box(27, 25, 1, 31, 28, 3, TIMBER_DARK)
    v.box(27, 25, 3, 31, 28, 4, Q.GOLD)
    v.box(28, 26, 4, 30, 27, 5, Q.GOLD)
    for x in (4, 7, 10):
        v.box(x, 21, 1, x + 2, 23, 3, mat("stone", 0.7))
        v.set(x, 21, 3, Q.GOLD)
    Q.heap(v, 8, 30, 3.5, 3.5, 3, SOOT)
    P.bench(v, 20, 30, 1, 5)
    P.woodpile(v, 3, 37, 1, length=8, along="x", rows=2)
    P.handcart(v, 22, 36, 1, along="x", load=Q.GOLD)
    v.anchor("cart", 12, 46, 1)
    P.scatter(v, 0, 0, 18, 48, 0.012, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)
