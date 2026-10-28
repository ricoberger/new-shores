"""
Meadery (4 × 5; D-057 §3): a brewhouse with a coursed-stone ground floor,
a jettied ochre upper storey and tiles, a brick chimney (smoke) over the
copper; a fermenting shed with casks on racks, a copper kettle on a
stone hearth, honey crates, stacked casks and a cart.
"""

from nsvoxel import parts as P
from nsvoxel.mats import BRASS, OCHRE, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

HONEY = P.mat("brass", 1.05)
COPPER = P.mat("terracotta", 1.2)


def build(ctx):
    v = ctx.vox()  # 32 × 40
    seed = 68
    P.yard(v, 0, 0, 32, 40, "dirt", seed=seed)
    P.yard(v, 0, 34, 32, 40, "grass", seed=seed)
    b = P.building(v, 4, 4, 22, 16, "citizen", along="x", upper=OCHRE, seed=seed, spacing=5)
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.entrance(f, 11, 2, 3, 5, frame=P.DRESSED, lintel=P.DRESSED)
    for a in (6, 17):
        P.casement(f, a, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED, lintel=P.DRESSED)
    for a in (5, 11, 17):
        P.casement(F, a, 11, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=P.mat("terracotta", 0.85))
    P.trade_sign(f, 9, 7, HONEY)
    P.roof_chimney(v, b.roof, 7, 8, above=3, brick=True, anchor=True)
    # Fermenting shed with casks.
    P.lean_to(v, 23, 30, 4, 16, 8, "tiles", down="x+", ov=1)
    v.box(24, 5, 1, 29, 15, 2, TIMBER)
    for y in (5, 8, 11):
        P.cask(v, 24, y, 2, h=3)
        P.cask(v, 27, y, 2, h=3)
    # Copper kettle on a hearth.
    v.box(4, 22, 1, 9, 27, 2, STONE)
    v.box(5, 23, 2, 8, 26, 5, COPPER)
    v.box(5, 23, 4, 8, 26, 5, P.shade_of(COPPER, 0.85))
    v.set(4, 24, 1, P.mat("flower"))
    # Honey crates, stacked casks, cart.
    for x in (12, 15):
        P.box_crate(v, x, 22, 1, contents=HONEY)
    v.box(19, 21, 1, 28, 23, 2, TIMBER_DARK)
    for x in (19, 22, 25):
        P.cask(v, x, 21, 2, h=2)
    P.cask(v, 20, 21, 4, h=2)
    P.cask(v, 23, 21, 4, h=2)
    v.set(26, 24, 1, BRASS)
    P.handcart(v, 12, 28, 1, along="x", load=HONEY)
    v.anchor("cart", 26, 37, 1)
    P.scatter(v, 0, 0, 32, 40, 0.02, seed=seed, kinds=("pebble", "tuft", "flower"))
    return P.colour_jitter(v, seed=seed)
