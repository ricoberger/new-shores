"""
Repair crane (3 × 3 shore, D-077 §6, Merchants, `look: harbour`): the
shipyard's treadwheel crane on a plank deck that lies under every tile
(piles under the edge): a timber frame of four posts with cross braces, a
big treadwheel (a ring with rungs and spokes, a walker's platform inside it)
turning on the windlass shaft, a jib over the water carrying the block and
hook with a hanging crate, and a stone-weighted counter-arm at the back.
The jib and the hanging hook are in the sway group `arm` (export.ARM: a
sway weight rising from the jib's root to its tip), so the client's sway
swings them slowly about the root. 8 voxels per tile; shore model
(config.SHORE_MODELS).
"""

import math

from nsvoxel import parts as P
from nsvoxel import parts_d077 as O
from nsvoxel.grid import mat
from nsvoxel.mats import IRON, PLANK, STONE, TIMBER, TIMBER_DARK, TIMBER_LIGHT

ARM = mat("timber", 1.25, "arm")
HOOK = mat("iron", 1.0, "arm")
ROPE = mat("timber", 1.5, "arm")


def build(ctx):
    v = ctx.vox()  # 24 × 24
    seed = 83
    O.deck(v, 0, 0, 24, 24)
    # Four posts of the frame, braces between them, a top plate.
    for x in (6, 17):
        for y in (8, 15):
            v.box(x, y, 1, x + 2, y + 2, 20, TIMBER)
    for y in (8, 15):
        v.box(6, y, 19, 19, y + 2, 21, TIMBER_DARK)
        v.line((6, y, 3), (18, y, 17), TIMBER_LIGHT)
    for x in (6, 17):
        v.box(x, 8, 19, x + 2, 17, 21, TIMBER_DARK)
        for z in (7, 13):
            v.box(x, 8, z, x + 2, 17, z + 1, TIMBER_LIGHT)
    # The treadwheel in the middle (a ring in the x-z plane, rungs across y), the shaft through its hub.
    cx, cz, r = 12, 11, 7.0
    for y in (9, 15):  # two rims
        for x in range(24):
            for z in range(1, 24):
                d = math.hypot(x + 0.5 - cx - 0.5, z + 0.5 - cz)
                if r - 1.0 <= d <= r + 0.4:
                    v.set(x, y, z, PLANK)
    for k in range(16):  # rungs and spokes
        ang = k * math.pi / 8
        x, z = round(cx + math.cos(ang) * (r - 0.5)), round(cz + math.sin(ang) * (r - 0.5))
        for y in range(9, 16):
            v.set(x, y, z, TIMBER_LIGHT)
        if k % 2 == 0:
            for y in (9, 15):
                v.line((cx, y, cz), (x, y, z), TIMBER_DARK)
    v.box(cx - 1, 7, cz - 1, cx + 1, 18, cz + 1, IRON)  # shaft and hub
    # The jib on the top plate, out over the water (y-), with block, rope and hook.
    for y in range(0, 9):
        v.box(11, y, 21, 13, y + 1, 22, ARM)
    v.line((12, 8, 20), (12, 1, 21), ARM)
    for z in range(10, 21):
        v.set(12, 1, z, ROPE)
    v.box(11, 0, 8, 13, 1, 10, HOOK)
    v.box(11, 0, 10, 13, 1, 11, HOOK)
    # The counter-arm to the back with stones.
    v.box(11, 17, 21, 13, 23, 22, TIMBER_DARK)
    v.box(10, 20, 17, 14, 23, 21, STONE)
    for x, y in ((5, 5), (18, 5)):
        O.bollard(v, x, y, 1, 2)
    P.box_crate(v, 11, 0, 5, s=3)
    return P.colour_jitter(v, seed=seed)
