"""
Vine row (1 × 1 field; D-057 §3, V5, V7 leftovers): two rows along x of posts
every four voxels and a wire on top, the vines a ragged band of leaves on stocks,
grape clusters hanging under the leaves on both sides.
The rows run along x on the painted ridges; the posts line up across a chain
of tiles.
"""

from nsvoxel import detail_v5 as Q
from nsvoxel import parts as P
from nsvoxel.grid import hash3, shade_of
from nsvoxel.mats import TIMBER, TIMBER_DARK, TIMBER_LIGHT

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

LEAF = Q.VINE
H = 7


def build(ctx):
    v = ctx.vox()  # 8 × 8
    seed = 27
    for y in (1, 5):
        for x in range(8):
            if x % 4 == 0:
                v.box(x, y, 1, x + 1, y + 1, H + 1, TIMBER)
                continue
            v.box(x, y, 1, x + 1, y + 1, 4, TIMBER_DARK)  # the stock
            for z in range(4, H):
                v.set(x, y, z, shade_of(LEAF, 1.0 if z % 2 else 0.92))
            for side in (-1, 1):
                for z in range(4, H - (1 if hash3(x // 2, y + side, 43, seed) < 0.5 else 0)):
                    v.set(x, y + side, z, LEAF)
                if hash3(x, y + side, 42, seed) < 0.4:
                    v.set(x, y + side, 3, Q.GRAPE)
        for x in range(8):
            v.set(x, y, H, TIMBER_LIGHT)  # the wire along the posts' tops
    return P.colour_jitter(v, seed=seed)
