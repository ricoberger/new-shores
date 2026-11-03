"""
Woad field tile (1 × 1; D-057 §3): rows of green woad rosettes on ploughed
soil, uneven tops with yellow flower heads (woad flowers yellow; its
blue is the dyer's).
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import FLOWER

#: Woad's leaves (a dull, slightly grey green) and the lighter tops.
LEAF = mat("hemp", 0.82)
TIP = mat("hemp", 1.0)

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)


def build(ctx):
    v = ctx.vox()
    seed = 31
    V.leafy_rows(v, 0, 0, 8, 8, LEAF, top=TIP, flower=FLOWER, along="y", pitch=4, furrow=1, h=2, seed=seed, share=0.55, flowers=0.3)
    return P.colour_jitter(v, seed=seed)
