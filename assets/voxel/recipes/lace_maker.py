"""
Lace maker (3 × 5; V7 variety pass, tier IV): an L-plan two-storey cream
plaster house under slate (no chimney); in front two standing lace frames, a
tile and more tall, with white threads (plaster) and lace edgings, a counter
with a bolt of lace and a flower bed (V7 leftovers). 12 voxels per tile.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel import parts_kit as K
from nsvoxel import parts_v7 as W
from nsvoxel.grid import mat, shade_of
from nsvoxel import detail_v5 as Q
from nsvoxel.mats import PLASTER, TIMBER, TIMBER_DARK, TIMBER_LIGHT

VOXELS_PER_TILE = 12
GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

GOODS = mat("canvas", 1.35)
THREAD = mat("plaster", 1.12)  # white lace thread


def lace_frame(v, x0, x1, y, h=17):
    """
    A standing lace frame x0..x1 at y (two voxels deep): corner posts, a top and a bottom rail and a sheet of white
    thread — a column of thread every other voxel, a lace edging at the foot, a band of eyelets under the top rail
    and a tassel row — taller than a tile (12 voxels).
    """
    for x in (x0, x1 - 2):
        v.box(x, y, 1, x + 2, y + 2, h + 1, TIMBER)
    v.box(x0, y, h, x1, y + 2, h + 1, TIMBER_LIGHT)
    v.box(x0, y, 3, x1, y + 2, 4, TIMBER_DARK)
    for x in range(x0 + 2, x1 - 2):
        v.box(x, y, 4, x + 1, y + 1, h, THREAD)
        if (x - x0) % 2 == 1:
            for z in range(9, h - 4, 3):
                v.set(x, y, z, None)
    v.box(x0 + 2, y, 4, x1 - 2, y + 1, 7, THREAD)  # the lace edging
    for x in range(x0 + 3, x1 - 2, 2):
        v.set(x, y, 5, None)
    v.box(x0 + 2, y, h - 3, x1 - 2, y + 1, h - 1, THREAD)  # eyelet band
    for x in range(x0 + 3, x1 - 2, 2):
        v.set(x, y, h - 2, None)


def build(ctx):
    v = ctx.vox()  # 36 × 60
    seed = 159
    K.ground(v, 18, 49, 15, 13, seed, "paved")
    h = K.workshop(v, 6, 6, 36 - 6, 32, 4, "c", seed, door=("y+", 16), wins=[])
    lace_frame(v, 4, 18, 38)
    lace_frame(v, 20, 34, 38)
    for x in (6, 20):
        v.box(x, 52, 1, x + 1, 56, 3, TIMBER_DARK)
    v.box(6, 52, 3, 22, 56, 4, TIMBER_LIGHT)  # the counter
    Q.bolts(v, 8, 52, 4, [THREAD, GOODS], along="x", length=8)
    v.box(17, 51, 4, 21, 52, 6, THREAD)  # a length of lace laid over the front edge
    P.flower_bed(v, 24, 50, 32, 56, 1, seed=seed)
    P.handcart(v, 8, 44, 1, along="x", load=GOODS)
    v.anchor("cart", 14, 54, 1)
    K.tufts(v, seed, 0.02)
    return P.colour_jitter(v, seed=seed)
