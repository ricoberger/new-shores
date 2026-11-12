"""
Harbour tower (2 × 2 shore, D-077 §6, Merchants, `look: civic`): a round
sandstone tower at the harbour mouth on a plank deck that lies under every
tile (timber piles under the deck's edge, bollards and a mooring ring at
the corners), a battered foot, arrow slits, a gallery of merlons and a
brass-caged beacon under a slate cone. 8 voxels per tile; shore model
(`placement: shore`, config.SHORE_MODELS).
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import mat
from nsvoxel.mats import BRASS, IRON, TIMBER_DARK, WINDOW

ROOF = mat("slate", 0.95)
FIRE = mat("ochre", 1.45)


def build(ctx):
    v = ctx.vox()  # 16 × 16
    seed = 79
    c = 8.0
    O.deck(v, 0, 0, 16, 16)
    for x, y in ((1, 1), (14, 1), (1, 14), (14, 14)):
        O.bollard(v, x, y, 1, 2)
    O.disc(v, c, c, 6.6, 1, 4, O.ASHLAR_DARK)  # the battered foot
    O.ring(v, c, c, 5.6, -1, 4, 24, O.ASHLAR, course=O.ASHLAR_DARK)
    O.disc(v, c, c, 5.6, 4, 24, O.ASHLAR)
    for z in (10, 16):  # arrow slits (the sea side y-, the land side y+, and the east)
        for x in (7, 8):
            v.set(x, 2, z, mat("window", 0.8))
            v.set(x, 13, z, mat("window", 0.8))
        v.set(13, 7, z, mat("window", 0.8))
        v.set(2, 8, z, mat("window", 0.8))
    P.entrance(P.Face(v, "y+", 13), 6, 4, 4, 6, arch=True, frame=O.CAP)
    # The gallery: a ring one voxel wider, merlons on its rim.
    O.disc(v, c, c, 6.6, 24, 26, O.ASHLAR_DARK)
    for x, y in O.cells_in_disc(c, c, 6.6, 5.6):
        if (x + y) % 2 == 0:
            for z in (26, 27):
                v.set(x, y, z, O.ASHLAR)
            v.set(x, y, 28, O.CAP)
    # The beacon: a brass cage of four posts round a flame, under a slate cone.
    for px, py in ((6, 6), (9, 6), (6, 9), (9, 9)):
        v.box(px, py, 26, px + 1, py + 1, 31, BRASS)
    v.box(7, 7, 26, 9, 9, 31, FIRE)
    v.box(5, 5, 31, 11, 11, 32, TIMBER_DARK)
    top = V.cone_roof(v, 8, 8, 4.0, 32, ROOF, rise=1.2)
    v.box(7, 7, top - 1, 9, 9, top + 2, BRASS)
    return P.colour_jitter(v, seed=seed)
