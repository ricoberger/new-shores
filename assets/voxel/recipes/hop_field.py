"""
Hop field tile (1 × 1; D-057 §3): a hop garden — tall poles in rows with
bines climbing them (leaves and pale cones), a wire along the pole tops
and hilled soil rows between.
"""

from nsvoxel import detail_v4 as V
from nsvoxel import parts as P
from nsvoxel.mats import TIMBER_LIGHT


def build(ctx):
    v = ctx.vox()
    seed = 29
    P.soil_rows(v, 0, 0, 8, 8, along="y", pitch=4, furrow=2)
    for x in (1, 5):
        V.hop_pole(v, x, 1 if x == 1 else 5, h=11, seed=seed + x)
        # The wire along the row (continues into the next tile).
        for y in range(8):
            v.set(x, y, 12, TIMBER_LIGHT)
    return P.colour_jitter(v, seed=seed)
