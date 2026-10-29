"""
Rendering house (3 × 3; D-057 §3): a squat stone boiling house with a
dark red-brown tile roof and a big brick stack (smoke), an open shed on its west side
over a great iron kettle on a brick hearth with its fire mouth, barrels
of tallow stacked in a pyramid, a bone heap, a tub and a cart.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, TIMBER, TIMBER_DARK, TIMBER_LIGHT

TALLOW = mat("plaster", 1.0)
BONE = mat("canvas", 1.05)
KETTLE = mat("iron", 0.85)
#: Dark warm tile (no cold slate field, ART_DIRECTION).
ROOF = mat("terracotta", 0.66)


def build(ctx):
    v = ctx.vox()  # 24 × 24
    seed = 131
    P.yard(v, 0, 0, 24, 24, "dirt", seed=seed)
    b = P.building(v, 11, 2, 22, 12, "stone", along="x", seed=seed, roof=ROOF, height=8, rise=1.2)
    f = b.face("y+")
    P.barn_gate(f, 14, 2, 4, 5)
    P.casement(b.face("x+"), 6, 3, 2, 2, frame=P.DRESSED, sill=P.DRESSED, bars=False)
    P.chimney_stack(v, 19, 4, 1, 17, brick=True, anchor=True)
    # Open shed on the west over the kettle.
    P.lean_to(v, 1, 11, 2, 13, 10, "tiles", down="x-", m=ROOF, posts=True)
    top = V.kettle(v, 6, 7.5, 1, r=3, h=3, m=KETTLE, rim=IRON, hearth_h=2)
    v.box(4, 6, top - 1, 8, 9, top, mat("terracotta", 0.65))  # the dark render inside
    v.box(5, 7, top, 7, 8, top + 1, TIMBER_LIGHT)  # paddle
    v.box(6, 7, top + 1, 7, 8, top + 3, TIMBER_LIGHT)
    # Barrels of tallow in a pyramid, bone heap, tub, cart.
    for k, (x, z) in enumerate(((12, 1), (15, 1), (18, 1), (13, 4), (16, 4))):
        P.cask(v, x, 15, z, h=3, m=TIMBER, lid=TALLOW)
    V.heap(v, 4, 18, r=2.8, h=3, m=BONE, seed=seed)
    V.vat(v, 9, 19, 1, r=1.8, h=3, liquid=TALLOW)
    v.box(20, 19, 1, 23, 20, 2, TIMBER_DARK)
    P.handcart(v, 14, 20, 1, along="x", load=TALLOW)
    v.anchor("cart", 6, 23, 1)
    P.scatter(v, 0, 0, 24, 24, 0.012, seed=seed, kinds=("pebble",))
    return P.colour_jitter(v, seed=seed)
