"""
Smelter (4 × 6; D-057 §3): a battered blast furnace of coursed stone
narrowing upward with a sooty stack (smoke) and a glowing mouth, a
bellows house (stone ground floor, jettied plaster upper storey, tiles)
with its bellows beam, charcoal and ore heaps, stacked iron bars, slag,
a wheelbarrow and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, IRON_ORE, STONE, STONE_DARK, TIMBER_DARK

GLOW = P.mat("flower", 1.0)
SOOT = P.mat("iron", 0.9)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    P.yard(v, 0, 0, 32, 48, "dirt", seed=57)
    # Furnace: a battered stone stack narrowing upward.
    for k, (x0, x1) in enumerate(((6, 20), (7, 19), (8, 18), (9, 17))):
        P.coursed_stone(v, x0, x0 - 2, x1, x1 - 2, 1 + k * 4, 5 + k * 4, STONE if k % 2 == 0 else P.shade_of(STONE, 0.94), seed=57 + k)
        P.dressed_quoins(v, x0, x0 - 2, x1, x1 - 2, 1 + k * 4, 5 + k * 4)
    v.box(11, 9, 17, 15, 13, 26, STONE_DARK)
    v.box(11, 9, 23, 15, 13, 26, SOOT)
    v.box(10, 8, 26, 16, 14, 27, SOOT)
    v.anchor("chimney", 13, 11, 27)
    v.anchor("smoke", 13, 11, 28)
    # Glowing mouth at the front.
    v.box(11, 17, 1, 15, 18, 4, None)
    v.box(11, 16, 1, 15, 17, 4, GLOW)
    v.box(10, 17, 4, 16, 18, 5, P.DRESSED)
    v.box(10, 17, 1, 11, 18, 4, P.DRESSED)
    v.box(15, 17, 1, 16, 18, 4, P.DRESSED)
    # Bellows house with a terracotta roof on the side.
    b = P.building(v, 22, 6, 30, 18, "citizen", along="y", upper=P.mat("plaster"), seed=57, spacing=4)
    P.entrance(b.face("y+"), 24, 2, 3, 5, frame=P.DRESSED)
    P.casement(b.face("y+", upper=True), 25, 11, 2, 3, frame=None, sill=P.mat("timber", 1.38))
    P.casement(b.face("x+", upper=True), 11, 11, 2, 3, frame=None, sill=P.mat("timber", 1.38))
    v.box(19, 11, 9, 22, 12, 10, TIMBER_DARK)  # bellows beam into the furnace
    # Piles: charcoal, ore, iron bars.
    v.ellipsoid(6, 26, 0, 3.5, 3.5, 3, SOOT, keep=lambda x, y, z: z >= 1)
    v.ellipsoid(14, 26, 0, 3.5, 3.5, 3, IRON_ORE, keep=lambda x, y, z: z >= 1)
    for k in range(3):
        v.box(20, 24 + k, 1 + k % 2, 28, 25 + k, 2 + k % 2, IRON)
    P.woodpile(v, 4, 34, 1, length=8, along="x", rows=2)
    for x, y in ((18, 34), (19, 35), (20, 34), (21, 36)):
        v.box(x, y, 1, x + 1, y + 1, 2, P.mat("rock-deep", 0.8))  # slag
    P.handcart(v, 24, 32, 1, along="x", load=IRON)
    P.cask(v, 2, 22, 1)
    v.anchor("cart", 26, 44, 1)
    P.scatter(v, 0, 0, 32, 48, 0.012, seed=57, kinds=("pebble",))
    return P.colour_jitter(v, seed=57)
