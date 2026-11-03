"""
Cooperage (4 × 6; V7 rework after the Anno 1404 barrel cooperage, tier IV):
a half-timbered workshop of dark ashlar and cream plaster under slate with
a slim chimney (smoke) and an open arched work bay on the front, a big
pale pyramid of finished barrels, rows of barrels and half-built staves in
hoops on the forecourt, a hoop pile and a cart. 12 voxels per tile; paved
forecourt.
"""

from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, TIMBER_DARK

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

NEW = mat("timber", 1.5)  # pale new barrels


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 73
    K.ground(v, 26, 50, 19, 18, seed, "paved")
    h = K.workshop(v, 6, 6, 40, 34, 4, "e", seed, door=("y+", 30), smoke=True, chim=(32, 10), wins=[], out="kiln")
    W.arched_window(h.face("y+"), 10, 3, 6, 6)
    # Barrel pyramid.
    for row, n in enumerate((6, 5, 4, 3)):
        for i in range(n):
            P.barrel(v, 6 + i * 4 + row * 2, 40, 1 + row * 4, h=4, m=NEW)
    for i in range(7):
        P.barrel(v, 4 + i * 4, 50, 1, h=4, m=NEW)
    for i in range(6):
        P.barrel(v, 6 + i * 4, 50, 5, h=4, m=NEW)
    # Half-built staves in iron hoops and a hoop pile.
    for i in range(3):
        v.box(34 + i * 4, 40, 1, 36 + i * 4, 42, 7, TIMBER_DARK)
        v.box(34 + i * 4, 40, 3, 36 + i * 4, 42, 4, IRON)
    K.pile(v, 36, 54, 1, 4, 4, 3, IRON, seed)
    P.handcart(v, 26, 60, 1, along="x", load=NEW)
    v.anchor("cart", 32, 68, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
