"""
Toolmaker (4 × 4; D-057 §3): a workshop with a coursed-stone ground
floor, a jettied ochre upper storey and tiles (brick chimney with smoke),
a hanging sign; an open forge under a tiled lean-to with a glowing hearth
and its hood, an anvil on a block, a quench tub, a grindstone, a rack of
tools and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import IRON, OCHRE, STONE, STONE_DARK, STONE_LIGHT, TIMBER, TIMBER_DARK, TIMBER_LIGHT

GLOW = P.mat("flower", 1.0)


def build(ctx):
    v = ctx.vox()  # 32 × 32
    P.yard(v, 0, 0, 32, 32, "dirt", seed=58)
    P.yard(v, 2, 22, 30, 30, "paved", seed=58)
    b = P.building(v, 3, 4, 22, 16, "citizen", along="x", upper=OCHRE, seed=58, spacing=5)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 6, 2, 3, 5, frame=P.DRESSED, lintel=P.DRESSED)
    P.casement(f, 14, 3, 4, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    for a in (5, 11, 17):
        P.casement(F, a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=P.mat("dye-blue", 0.9))
    P.trade_sign(f, 11, 7, IRON)
    P.roof_chimney(v, b.roof, 18, 7, above=3, brick=True, anchor=True)
    # Open forge lean-to on the side: hearth, anvil.
    P.lean_to(v, 22, 30, 5, 16, 8, "tiles", down="x+", ov=1)
    v.box(23, 6, 1, 27, 10, 3, STONE)
    v.box(24, 7, 3, 26, 9, 4, GLOW)
    v.box(23, 6, 6, 27, 10, 7, STONE_DARK)  # hood
    v.box(24, 7, 7, 26, 9, 9, STONE_DARK)
    v.box(23, 12, 1, 25, 14, 3, TIMBER_DARK)  # anvil block
    v.box(22, 12, 3, 26, 14, 4, IRON)
    v.set(26, 13, 3, IRON)
    P.cask(v, 27, 12, 1, h=2, lid=P.mat("shallows"))
    # Grindstone and a tool rack.
    v.box(8, 22, 1, 9, 26, 4, TIMBER)
    v.box(9, 23, 1, 10, 26, 5, STONE)
    v.box(9, 24, 2, 10, 25, 4, STONE_LIGHT)
    for x in range(14, 22, 2):
        v.box(x, 19, 1, x + 1, 20, 5, TIMBER_LIGHT)
        v.set(x, 19, 5, IRON)
    v.box(13, 19, 4, 22, 20, 5, TIMBER_DARK)
    P.box_crate(v, 3, 23, 1, contents=IRON)
    P.handcart(v, 22, 24, 1, along="x", load=IRON)
    v.anchor("cart", 26, 29, 1)
    P.scatter(v, 0, 0, 32, 22, 0.02, seed=58, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=58)
