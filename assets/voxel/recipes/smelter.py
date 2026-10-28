"""Smelter (4 × 6): a stone blast furnace with a tall chimney and glowing mouth, bellows house, charcoal and ore piles, iron bars stacked."""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, IRON_ORE, STONE, STONE_DARK, TERRACOTTA, TIMBER, TIMBER_DARK

GLOW = P.mat("flower", 1.0)
SOOT = P.mat("iron", 0.9)


def build(ctx):
    v = ctx.vox()  # 32 × 48
    P.yard(v, 0, 0, 32, 48, "dirt", seed=57)
    # Furnace: a battered stone stack narrowing upward.
    for k, (x0, x1) in enumerate(((6, 20), (7, 19), (8, 18), (9, 17))):
        v.box(x0, x0 - 2, 1 + k * 4, x1, x1 - 2, 5 + k * 4, STONE if k % 2 == 0 else STONE_DARK)
    v.box(11, 9, 17, 15, 13, 26, STONE_DARK)
    v.box(10, 8, 26, 16, 14, 27, SOOT)
    v.anchor("chimney", 13, 11, 27)
    v.anchor("smoke", 13, 11, 28)
    # Glowing mouth at the front.
    v.box(11, 17, 1, 15, 18, 4, None)
    v.box(11, 16, 1, 15, 17, 4, GLOW)
    # Bellows house with a terracotta roof on the side.
    P.house(v, 21, 6, 30, 18, "citizen", along="y", wall=P.mat("plaster"), seed=57)
    P.door(P.Face(v, "y+", 17), 24, 2, 3, 5)
    # Piles: charcoal, ore, iron bars.
    v.ellipsoid(6, 26, 0, 3.5, 3.5, 3, SOOT, keep=lambda x, y, z: z >= 1)
    v.ellipsoid(14, 26, 0, 3.5, 3.5, 3, IRON_ORE, keep=lambda x, y, z: z >= 1)
    for k in range(3):
        v.box(20, 24 + k, 1 + k % 2, 28, 25 + k, 2 + k % 2, IRON)
    v.box(4, 34, 1, 12, 36, 3, TIMBER)
    v.box(18, 34, 1, 22, 38, 2, TIMBER_DARK)
    v.anchor("cart", 26, 44, 1)

    return v.jitter(0.04, roles={"stone"}, cell=2, seed=57)
