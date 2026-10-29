"""
Distillery (5 × 6; D-057 §3): a round coursed-stone still tower with a
ribbed copper dome and finial, a brick stack (smoke) beside it, joined to
a long barrel hall (stone ground floor, framed plaster upper storey, red
tiles, a loading door); a cask rack in the yard, a copper worm tub, a
signboard and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import CANVAS, PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

SPIRIT = mat("ochre", 1.2)


def build(ctx):
    v = ctx.vox()  # 40 × 48
    seed = 157
    P.yard(v, 0, 0, 40, 48, "dirt", seed=seed)
    P.yard(v, 0, 34, 40, 48, "paved", seed=seed)
    # Still tower on the west, its stack behind.
    V.still_tower(v, 9, 20, 7.5, 18, seed=seed)
    P.chimney_stack(v, 3, 10, 1, 24, brick=True, anchor=True)
    # Barrel hall along y on the east.
    b = P.building(v, 18, 4, 38, 30, "citizen", along="y", upper=PLASTER, seed=seed, spacing=4, height=15, roof=mat("terracotta"))
    f, F = b.face("y+"), b.face("y+", upper=True)
    P.barn_gate(f, 24, 2, 6, 6)
    P.entrance(F, 26, 10, 2, 4, step=None, hinges=False)
    V.hoist(F, 27, 14, length=2, rope=3, load=TIMBER_LIGHT)
    V.signboard(f, 32, 5, w=3, h=2, colour=SPIRIT)
    for a in (8, 14, 20):
        P.casement(b.face("x-", upper=True), a, 10, 2, 3, frame=None, sill=TIMBER_LIGHT, shutters=mat("grass-b", 0.75))
    P.casement(b.face("x-"), 24, 3, 2, 3, frame=P.DRESSED, sill=P.DRESSED)
    v.box(16, 18, 9, 18, 20, 10, V.COPPER)  # the lyne arm from the still into the hall
    # Worm tub, cask rack, sacks, cart.
    V.vat(v, 5, 32, 1, r=2.6, h=4, liquid=mat("shallows", 0.9))
    v.line((5, 29, 9), (6, 27, 14), V.COPPER)
    for y in (36, 40):
        v.box(20, y, 1, 38, y + 1, 2, TIMBER_DARK)
        for x in range(20, 38, 3):
            P.cask(v, x, y - 1, 2, h=3, m=TIMBER, lid=TIMBER_DARK)
    P.sacks(v, 12, 36, 1, n=2, m=CANVAS)
    P.lamp_post(v, 16, 40)
    v.anchor("cart", 8, 44, 1)
    P.scatter(v, 0, 0, 40, 34, 0.01, seed=seed, kinds=("pebble", "tuft"))
    return P.colour_jitter(v, seed=seed)
