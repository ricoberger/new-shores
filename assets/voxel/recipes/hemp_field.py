"""Hemp field tile (1 × 1; D-057 §3): rows of tall hemp plants of uneven height with darker tops between ploughed furrows."""

from nsvoxel import parts as P


def build(ctx):
    v = ctx.vox()
    P.crop_rows(v, 0, 0, 8, 8, "hemp", along="x", pitch=4, furrow=2, seed=23)
    return P.colour_jitter(v, seed=23, scale=0.5)
