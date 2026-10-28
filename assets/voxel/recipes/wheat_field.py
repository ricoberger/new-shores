"""
Wheat field tile (1 × 1; D-057 §3): rows of wheat plants — stalks of
uneven height with darker ears — between furrows of ploughed soil.
"""

from nsvoxel import parts as P


def build(ctx):
    v = ctx.vox()
    P.crop_rows(v, 0, 0, 8, 8, "wheat", along="y", pitch=4, furrow=2, seed=21)
    return P.colour_jitter(v, seed=21, scale=0.5)
