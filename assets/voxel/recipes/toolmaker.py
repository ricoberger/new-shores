"""Toolmaker (4 × 4): stone forge with an open front and glowing hearth, anvil, grindstone, a rack of tools, chimney."""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, STONE, STONE_DARK, TIMBER, TIMBER_DARK, TIMBER_LIGHT, OCHRE

GLOW = P.mat("flower", 1.0)


def build(ctx):
    v = ctx.vox()  # 32 × 32
    P.yard(v, 0, 0, 32, 32, "dirt", seed=58)
    P.yard(v, 2, 22, 30, 30, "paved", seed=58)
    top = P.house(v, 3, 4, 22, 16, "citizen", along="x", wall=OCHRE, seed=58)
    f = P.Face(v, "y+", 15)
    P.door(f, 6, 2, 3, 5)
    P.window(f, 15, 3, 4, 3, cross=True)
    P.smoke(v, 18, 7, 1, top)
    # Open forge lean-to on the side: hearth, anvil.
    for y in (5, 15):
        v.box(29, y, 1, 30, y + 1, 8, TIMBER)
    v.shed(22, 30, 5, 16, 8, P.mat("terracotta"), down="x+", ov=0)
    v.box(23, 6, 1, 27, 10, 3, STONE)
    v.box(24, 7, 3, 26, 9, 4, GLOW)
    v.box(23, 12, 1, 26, 13, 3, STONE_DARK)
    v.box(23, 12, 3, 27, 13, 4, IRON)
    # Grindstone and a tool rack.
    v.box(8, 22, 1, 9, 26, 4, TIMBER)
    v.box(9, 23, 1, 10, 26, 5, STONE)
    for x in range(14, 22, 2):
        v.box(x, 18, 1, x + 1, 19, 5, TIMBER_LIGHT)
        v.set(x, 18, 5, IRON)
    v.box(13, 18, 4, 22, 19, 5, TIMBER_DARK)
    v.anchor("cart", 26, 29, 1)
    return v.jitter(0.03, roles={"ochre", "stone"}, cell=2, seed=58)
