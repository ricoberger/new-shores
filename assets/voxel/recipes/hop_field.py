"""
Hop field tile (1 × 1; D-057 §3, V7 leftovers): a hop garden — four poles ten
voxels high in two rows along x with a wire along the pole tops, strings
hanging from the wire between the poles (one per row and tile), and bines of ragged leaves with pale
cones climbing both. The rows run along x on the painted ridges.
"""

from nsvoxel import parts as P
from nsvoxel.grid import hash3, mat
from nsvoxel.mats import TIMBER, TIMBER_LIGHT

GROUND_Z = 1  # authored on the old one-voxel ground plate: the build settles it on the terrain (D-068)

H = 10
BINE = mat("hemp", 1.05)
CONE = mat("pasture-mark", 1.1)
STRING = mat("thatch", 0.8)  # hemp twine


def climb(v, x, y, seed, prob):
    """Ragged leaves in runs two voxels high round the column (x, y), pale cones among them."""
    for z in range(2, H - 1):
        for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
            hh = hash3(x + dx, y + dy, z // 2, seed)
            if hh < prob - (0.25 if z > H - 4 else 0):
                v.set(x + dx, y + dy, z, CONE if hh < 0.1 and z % 2 else BINE)


def build(ctx):
    v = ctx.vox()
    seed = 29
    for y in (1, 5):
        for x in (1, 5):
            v.box(x, y, 1, x + 1, y + 1, H + 1, TIMBER)
            climb(v, x, y, seed + x + y, 0.34)
        for x in range(8):
            v.set(x, y, H, TIMBER_LIGHT)  # the wire along the row
        for x in ((3,) if y == 1 else (7,)):
            v.box(x, y, 2, x + 1, y + 1, H, STRING)
            climb(v, x, y, seed + 7 + x + y, 0.12)
    return P.colour_jitter(v, seed=seed)
