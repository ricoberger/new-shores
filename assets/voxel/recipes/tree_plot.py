"""
Tree plot (1 × 1 field; D-059/D-060 models): a planted grove tile — a 2 × 2
grid of young trees (pitch 4 voxels) on grass, each standing on its own
disc of bare earth, trunks brown, round crowns in two greens with a
lighter top. The fields pipeline has no growth stages per field recipe
(stage models are a client follow-up), so this is the single full stage.
"""

from nsvoxel import parts as P
from nsvoxel.grid import shade_of
from nsvoxel.mats import CROWN, DIRT, TIMBER

#: The 2 × 2 planting grid, pitch 4: the trunk cells; a crown is 3 × 3 voxels, so one voxel
#: of grass lies between crowns, also across the tile edge, and the grove reads as trees.
SPOTS = ((2, 2), (6, 2), (2, 6), (6, 6))


def crown(v, tx, ty, z):
    """
    A round young crown of stacked slabs from layer z, 3 × 3 voxels about the
    trunk cell (tx, ty): the darker green underneath, the lighter green
    above it and a one-voxel cap in the lightest. Returns the top z.
    """
    v.box(tx - 1, ty - 1, z, tx + 2, ty + 2, z + 1, shade_of(CROWN, 0.84))
    v.box(tx - 1, ty - 1, z + 1, tx + 2, ty + 2, z + 2, CROWN)
    v.box(tx, ty, z + 2, tx + 1, ty + 1, z + 3, shade_of(CROWN, 1.16))
    return z + 3


def build(ctx):
    v = ctx.vox()  # 8 × 8
    seed = 31
    P.yard(v, 0, 0, 8, 8, "grass", seed=seed)
    for tx, ty in SPOTS:
        # A disc of bare earth (3 × 3) under the tree, a 1 × 1 trunk, a round crown.
        v.box(tx - 1, ty - 1, 0, tx + 2, ty + 2, 1, DIRT)
        v.box(tx, ty, 1, tx + 1, ty + 1, 4, TIMBER)
        crown(v, tx, ty, 4)
    return P.colour_jitter(v, seed=seed)
