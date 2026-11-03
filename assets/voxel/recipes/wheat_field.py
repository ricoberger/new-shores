"""
Wheat field tile (1 × 1; D-057 §3): rows of wheat plants — stalks of
uneven height with darker ears — between furrows of ploughed soil.
Toned toward the palette's wheat pair (`wheat` #CFB04A / `wheat-mark`
#B08E30): the stalks sit a step under `wheat` and the ears take the
darker mark, so the field does not glow against the grass.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3, shade_of
from nsvoxel.mats import WHEAT, WHEAT_MARK

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

STALK = shade_of(WHEAT, 0.8)
STALK_LOW = shade_of(WHEAT, 0.68)


def plant(v, x, y, z, seed):
    """One wheat plant: a low stalk, sometimes a second, and an ear in the mark colour (a few lighter)."""
    h = hash3(x, y, 61, seed)
    n = 2 + (1 if h < 0.6 else 0)
    for k in range(n - 1):
        v.set(x, y, z + k, STALK if k else STALK_LOW)
    v.set(x, y, z + n - 1, WHEAT_MARK if h < 0.85 else shade_of(WHEAT, 0.92))


def build(ctx):
    v = ctx.vox()
    seed = 21
    P.soil_rows(v, 0, 0, 8, 8, "y", 4, 0, furrow=2)
    for x in range(8):
        for y in range(8):
            if x % 4 < 2:
                plant(v, x, y, 1, seed)
    return P.colour_jitter(v, seed=seed, scale=0.5)
