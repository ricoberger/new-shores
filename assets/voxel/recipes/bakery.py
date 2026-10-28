"""
Bakery (4 × 5; D-057 §3): a bakehouse with a coursed-stone ground floor
and a jettied ochre upper storey, tiles, a shop window under a striped
awning and a hanging bread sign; a domed brick bread oven against the
east wall with its chimney (smoke); flour sacks, a bread stall with
loaves and baskets, firewood and a hand cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, CANVAS, OCHRE, STONE, STONE_DARK, TERRACOTTA, TIMBER, WHEAT


def build(ctx):
    v = ctx.vox()  # 32 × 40
    P.yard(v, 0, 0, 32, 40, "dirt", seed=51)
    P.yard(v, 2, 26, 30, 38, "paved", seed=51)
    b = P.building(v, 3, 5, 22, 20, "citizen", along="x", upper=OCHRE, seed=51, spacing=5)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 9, 2, 3, 5, frame=P.DRESSED, lintel=P.DRESSED)
    P.casement(f, 14, 3, 4, 3, frame=TIMBER, sill=TIMBER)
    for a in (5, 13, 18):
        P.casement(F, a, 11, 2, 3, frame=None, sill=P.mat("timber", 1.38), shutters=P.mat("terracotta", 0.85), box=P.mat("flower"))
    P.awning(v, 13, 20, 19, 8, depth=3)
    P.trade_sign(f, 20, 7, WHEAT)
    # Domed oven against the east wall, chimney rising from it.
    v.ellipsoid(26.5, 12.5, 1, 4.5, 5, 6, lambda x, y, z: STONE if z < 3 else (P.BRICK if (x + z) % 2 else P.shade_of(P.BRICK, 0.9)), keep=lambda x, y, z: z >= 1)
    v.box(24, 7, 1, 29, 18, 2, STONE_DARK)
    v.box(25, 17, 1, 28, 18, 4, None)
    v.box(25, 17, 1, 28, 18, 3, P.mat("iron", 0.8))
    v.set(26, 17, 1, P.mat("terracotta", 1.25))
    P.chimney_stack(v, 25, 11, 4, b.roof.ridge_z - 2, brick=True, anchor=True)
    # Flour sacks, a bread stall, firewood.
    P.sacks(v, 3, 22, 1, n=3, m=CANVAS)
    P.sacks(v, 4, 24, 1, n=1, m=CANVAS)
    v.box(14, 27, 1, 20, 29, 3, TIMBER)
    for x in range(14, 20):
        v.set(x, 27 + x % 2, 3, WHEAT if x % 2 else P.mat("thatch", 1.2))
        v.set(x, 28 - x % 2, 3, P.mat("timber", 1.38))
    P.cask(v, 21, 27, 1, h=2, lid=P.mat("thatch", 1.15))
    P.woodpile(v, 23, 22, 1, length=6, along="x", rows=3)
    P.handcart(v, 3, 32, 1, along="x", load=CANVAS)
    P.lamp_post(v, 12, 26)
    v.set(19, 21, 9, BRASS)
    v.anchor("cart", 26, 36, 1)
    P.scatter(v, 0, 0, 32, 26, 0.02, seed=51, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=51)
