"""
Copper smelter (4 × 6; D-057 §3, V5): the tier-2 smelter's battered
blast furnace of coursed stone, its tiers streaked green with verdigris,
a sooty stack (smoke) and a glowing mouth; a bellows house of ashlar
with plastered upper storey and tiles; heaps of green-brown copper ore
and charcoal, stacked copper and brass ingots, slag and a cart.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, PLASTER, TIMBER_DARK, TIMBER_LIGHT

ROOF = mat("terracotta", 0.9)
SOOT = mat("iron", 0.9)
ORE = mat("deposit-iron", 0.95)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    seed = 113
    P.yard(v, 0, 0, 32, 48, "dirt", seed=seed)
    Q.furnace(v, 4, 3, size=15, tiers=4, step=4, streak=Q.VERDIGRIS, seed=seed)
    # Bellows house.
    b = Q.palazzo(v, 21, 4, 31, 18, (7, 5), upper=PLASTER, roof=ROOF, along="y", seed=seed)
    P.entrance(b.face("y+"), 24, 2, 3, 5, frame=Q.DRESSED, lintel=Q.DRESSED)
    Q.window(b.face("y+"), 25, 9, 2, 3, hood="key")
    Q.window(b.face("x+"), 11, 9, 2, 3, hood="key")
    v.box(18, 10, 9, 21, 11, 10, TIMBER_DARK)  # bellows beam into the furnace
    # Ore, charcoal, ingots, slag.
    Q.heap(v, 6, 26, 3.5, 3.5, 3, lambda x, y, z: Q.VERDIGRIS if (x + z) % 3 == 0 else ORE)
    Q.heap(v, 14, 26, 3.5, 3.5, 3, SOOT)
    for k in range(3):
        v.box(20, 24 + k * 2, 1 + k % 2, 28, 25 + k * 2, 2 + k % 2, Q.COPPER)
        v.box(20, 25 + k * 2, 1, 28, 26 + k * 2, 2, BRASS)
    for k in range(2):
        v.box(21, 25, 3 + k, 27, 29, 4 + k, Q.COPPER if k else BRASS)
    for x, y in ((18, 34), (19, 35), (20, 34), (21, 36)):
        v.box(x, y, 1, x + 1, y + 1, 2, mat("rock-deep", 0.8))
    P.woodpile(v, 3, 34, 1, length=8, along="x", rows=2)
    P.cask(v, 2, 24, 1)
    P.handcart(v, 22, 40, 1, along="x", load=Q.COPPER)
    v.anchor("cart", 12, 46, 1)
    P.scatter(v, 0, 0, 32, 48, 0.012, seed=seed, kinds=("pebble",))
    _ = TIMBER_LIGHT
    return P.colour_jitter(v, seed=seed)
