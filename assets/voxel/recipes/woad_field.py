"""
Woad field tile (1 × 1; D-057 §3): rows of blue-green woad rosettes on
ploughed soil, uneven tops, a few yellow flower heads.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.grid import mat
from nsvoxel.mats import FLOWER

#: Woad's blue-green leaves (the shallows' teal, darkened) and the bluer tips.
LEAF = mat("shallows", 0.7)
TIP = mat("shallows", 0.86)


def build(ctx):
    v = ctx.vox()
    seed = 31
    V.leafy_rows(v, 0, 0, 8, 8, LEAF, top=TIP, flower=FLOWER, along="y", pitch=4, furrow=1, h=2, seed=seed, share=0.55, flowers=0.06)
    return P.colour_jitter(v, seed=seed)
