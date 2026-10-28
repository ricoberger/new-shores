"""Bakery (4 × 5): ochre bakehouse with a domed bread oven and its chimney on the side, flour sacks, a bread stall under an awning, firewood."""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, CANVAS, OCHRE, STONE, STONE_DARK, TERRACOTTA, TIMBER, WHEAT


def build(ctx):
    v = ctx.vox()  # 32 × 40
    P.yard(v, 0, 0, 32, 40, "dirt", seed=51)
    P.yard(v, 2, 26, 30, 38, "paved", seed=51)
    top = P.house(v, 3, 5, 22, 20, "citizen", along="x", wall=OCHRE, seed=51)
    f = P.Face(v, "y+", 19)
    P.door(f, 9, 2, 3, 5)
    P.window(f, 14, 3, 4, 3, frame=TIMBER, cross=True)
    P.windows(v, "x-", 3, 7, 18, 4)
    P.awning(v, 13, 19, 19, 8, depth=3)
    # Domed oven against the east wall, chimney rising from it.
    v.ellipsoid(26.5, 12.5, 1, 4.5, 5, 6, lambda x, y, z: STONE if z < 4 else P.mat("terracotta", 0.9), keep=lambda x, y, z: z >= 1)
    v.box(24, 7, 1, 29, 18, 2, STONE_DARK)
    v.box(25, 17, 1, 28, 18, 4, None)
    v.box(25, 17, 1, 28, 18, 3, P.mat("iron"))
    P.smoke(v, 25, 11, 4, top - 2)
    # Flour sacks, a bread stall, firewood.
    for x, y in ((3, 22), (5, 22), (3, 24)):
        P.sack(v, x, y, 1, m=CANVAS)
    v.box(14, 27, 1, 20, 29, 3, TIMBER)
    for x in range(14, 20):
        v.set(x, 27 + x % 2, 3, WHEAT if x % 2 else P.mat("thatch", 1.2))
    P.logs(v, 23, 22, 1, n=3, length=6, along="x")
    v.set(19, 20, 9, BRASS)
    v.anchor("cart", 26, 36, 1)

    return v.jitter(0.03, roles={"ochre", "stone"}, cell=2, seed=51)
