"""
Malt house (4 × 6; V7 rework, tier IV; no 1404 render): a long malting hall
of dark ashlar and cream plaster under slate with arched windows and a
slim chimney (smoke), a brick-accent kiln tower (oast) with a conical
slate cap and a slim brick stack at its west end, pale heaps of malt and
grain sacks on the forecourt, a loading hatch. 12 voxels per tile; a paved
forecourt.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel.mats import CANVAS, SLATE

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

MALT = mat("wheat", 1.3)


def build(ctx):
    v = ctx.vox()  # 48 × 72
    seed = 71
    K.ground(v, 28, 52, 18, 16, seed, "paved")
    h = K.workshop(v, 18, 6, 44, 40, 4, "c", seed, door=("y+", 28), smoke=True, chim=(24, 10), wins=[22])
    # The oast: a brick-accent round tower with a slate cone.
    V.round_tower(v, 9, 16, 7, 1, 20, m=K.BRICK, seed=seed)
    V.cone_roof(v, 9, 16, 7.6, 20, SLATE, rise=1.6, tip=K.BRICK)
    v.box(8, 22, 1, 11, 24, 7, shade_of(K.BRICK, 0.4))
    # Malt and grain.
    K.pile(v, 8, 44, 1, 10, 6, 5, MALT, seed)
    K.pile(v, 8, 54, 1, 6, 5, 3, MALT, seed + 1)
    P.sacks(v, 24, 48, 1, n=4, m=CANVAS)
    P.sacks(v, 24, 56, 1, n=3, m=CANVAS)
    P.handcart(v, 28, 62, 1, along="x", load=MALT)
    v.anchor("cart", 32, 68, 1)
    K.tufts(v, seed)
    return P.colour_jitter(v, seed=seed)
