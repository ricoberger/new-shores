"""Meadow tile (1 × 1; D-057 §3): a flower meadow for the bees — grass tufts with white, yellow and blue flowers."""

from nsvoxel import parts as P
from nsvoxel.grid import hash3
from nsvoxel.mats import GRASS_A, GRASS_B

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)


def build(ctx):
    v = ctx.vox()
    for x in range(8):
        for y in range(8):
            v.set(x, y, 0, GRASS_A if hash3(x // 2, y // 2, 0, 29) < 0.6 else GRASS_B)
            if hash3(x, y, 1, 29) < 0.55:
                P.plant(v, x, y, 1, "meadow", seed=29)
    return P.colour_jitter(v, seed=29, scale=0.5)
